// Curated mood presets & procedural Web Audio offline beds so the app works 100% out-of-the-box
// even before the user enters an ElevenLabs or Fal.ai API key, AND provides exact prompts for the cloud APIs.

export type BackingMode = "ambience" | "music";

export interface MoodPreset {
  id: string;
  title: string;
  subtitle: string;
  mode: BackingMode;
  prompt: string;
  tempoLabel: string;
  keySignature: string;
}

export const MOOD_PRESETS: MoodPreset[] = [
  {
    id: "cafe-rain",
    title: "午後窗邊雨聲",
    subtitle: "東京喫茶店窗外細雨與溫暖黑膠底噪",
    mode: "ambience",
    prompt:
      "Cozy Tokyo jazz cafe ambience with gentle rain pattering on window glass, warm vinyl crackle, soft room tone, seamless loop, no talking",
    tempoLabel: "LOOP · AMBIENCE",
    keySignature: "Warm Room Tone",
  },
  {
    id: "warm-guitar-piano",
    title: "溫暖木吉他與鋼琴",
    subtitle: "柔和指彈木吉他與立式鋼琴分解和弦",
    mode: "music",
    prompt:
      "Warm fingerpicked acoustic guitar and felt upright piano, intimate slow ballad instrumental background music for spoken voiceover, no vocals",
    tempoLabel: "72 BPM · BALLAD",
    keySignature: "F Major",
  },
  {
    id: "midnight-lofi",
    title: "深夜電台 Lo-Fi",
    subtitle: "Rhodes 電鋼琴與微醺慢板爵士鼓刷",
    mode: "music",
    prompt:
      "Late night jazz kissa lo-fi instrumental, warm Fender Rhodes chords, upright bass, soft brushed snare, nostalgic and calm, no vocals",
    tempoLabel: "68 BPM · JAZZ LO-FI",
    keySignature: "D Minor 9",
  },
  {
    id: "ocean-breeze",
    title: "海浪與遠方微風",
    subtitle: "平靜海岸線潮汐往復與傍晚微風",
    mode: "ambience",
    prompt:
      "Calm coastal ocean waves gently washing ashore at dusk, soft breeze, peaceful ambient soundscape, seamless loop, no voices",
    tempoLabel: "LOOP · COASTAL",
    keySignature: "Natural Tide",
  },
  {
    id: "cinematic-strings",
    title: "電影感微光弦樂",
    subtitle: "大提琴長音鋪墊與室內樂溫暖和聲",
    mode: "music",
    prompt:
      "Intimate chamber strings and solo cello with soft felt piano, emotional cinematic underscore for personal storytelling, gentle dynamics, no vocals",
    tempoLabel: "64 BPM · CHAMBER",
    keySignature: "C Major 7",
  },
  {
    id: "campfire-night",
    title: "露營柴火與夜蟲",
    subtitle: "溫暖松木柴火劈啪聲與靜謐夏夜環境音",
    mode: "ambience",
    prompt:
      "Warm crackling campfire in a quiet forest night with gentle distant crickets, cozy outdoor ambience, seamless loop",
    tempoLabel: "LOOP · NIGHT FIRE",
    keySignature: "Warm Crackle",
  },
];

/**
 * Generates a rich, warm stereo AudioBuffer in the browser for any preset ID
 * when using the built-in Offline Sample engine (or as an instant fallback).
 */
export async function synthesizeOfflineBackingBuffer(
  presetId: string,
  durationSeconds: number,
  sampleRate = 44100
): Promise<AudioBuffer> {
  const safeDuration = Math.max(6, Math.min(240, durationSeconds));
  const ctx = new OfflineAudioContext(2, Math.ceil(safeDuration * sampleRate), sampleRate);
  const length = ctx.length;
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Seeded pseudo-random for consistent vinyl/rain texture
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646 - 0.5;
  };

  // Musical chord progressions per preset (frequencies in Hz)
  const progressions: Record<string, number[][]> = {
    "cafe-rain": [
      [174.61, 220.0, 261.63, 329.63], // Fmaj7
      [146.83, 174.61, 220.0, 261.63], // Dm7
      [196.0, 246.94, 293.66, 349.23], // G7
      [130.81, 196.0, 246.94, 329.63], // Cmaj7
    ],
    "warm-guitar-piano": [
      [174.61, 261.63, 349.23, 440.0], // F
      [164.81, 246.94, 329.63, 392.0], // Em7
      [146.83, 220.0, 261.63, 349.23], // Dm7
      [196.0, 246.94, 293.66, 392.0], // G
    ],
    "midnight-lofi": [
      [146.83, 220.0, 261.63, 329.63], // Dm9
      [196.0, 246.94, 293.66, 349.23], // G13
      [130.81, 196.0, 246.94, 329.63], // Cmaj9
      [110.0, 164.81, 220.0, 277.18], // A7alt
    ],
    "ocean-breeze": [
      [130.81, 196.0, 293.66, 329.63], // Cadd9
      [174.61, 220.0, 261.63, 329.63], // Fmaj7
    ],
    "cinematic-strings": [
      [130.81, 196.0, 246.94, 329.63], // Cmaj7
      [110.0, 164.81, 220.0, 261.63], // Am7
      [174.61, 220.0, 261.63, 349.23], // Fmaj7
      [196.0, 246.94, 293.66, 392.0], // G
    ],
    "campfire-night": [
      [146.83, 220.0, 293.66, 369.99], // D
      [196.0, 246.94, 293.66, 392.0], // G
    ],
  };

  const chords = progressions[presetId] || progressions["warm-guitar-piano"];
  const isAmbienceHeavy =
    presetId === "cafe-rain" || presetId === "ocean-breeze" || presetId === "campfire-night";

  let pinkL = 0;
  let pinkR = 0;
  const barDuration = 3.2; // seconds per chord

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const barIndex = Math.floor(t / barDuration) % chords.length;
    const barPhase = (t % barDuration) / barDuration;
    const chord = chords[barIndex];

    // Smooth chord envelope
    const env = Math.sin(Math.PI * barPhase);

    // Warm harmonic pad / Rhodes / acoustic pluck synthesis
    let musicalL = 0;
    let musicalR = 0;
    for (let n = 0; n < chord.length; n++) {
      const freq = chord[n];
      const detune = (n - 1.5) * 0.35;
      const noteDelay = n * 0.14;
      const localT = Math.max(0, (t % barDuration) - noteDelay);
      const pluckEnv = Math.exp(-localT * (isAmbienceHeavy ? 1.1 : 1.6)) * Math.min(1, localT * 18);

      const sL =
        Math.sin(2 * Math.PI * (freq - detune * 0.5) * t) * 0.65 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.18;
      const sR =
        Math.sin(2 * Math.PI * (freq + detune * 0.5) * t) * 0.65 +
        Math.sin(2 * Math.PI * freq * 2 * t + 0.4) * 0.18;

      musicalL += sL * (isAmbienceHeavy ? env * 0.12 : pluckEnv * 0.24);
      musicalR += sR * (isAmbienceHeavy ? env * 0.12 : pluckEnv * 0.24);
    }

    // Filtered ambient texture (rain / ocean waves / campfire crackle)
    const whiteL = rand();
    const whiteR = rand();
    pinkL = 0.985 * pinkL + 0.015 * whiteL;
    pinkR = 0.985 * pinkR + 0.015 * whiteR;

    let ambienceL = 0;
    let ambienceR = 0;
    if (presetId === "cafe-rain") {
      const droplet = Math.abs(whiteL) > 0.492 ? whiteL * 0.22 : 0;
      ambienceL = pinkL * 0.9 + droplet;
      ambienceR = pinkR * 0.9 + (Math.abs(whiteR) > 0.492 ? whiteR * 0.22 : 0);
    } else if (presetId === "ocean-breeze") {
      const waveSwell = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.14 * t));
      ambienceL = pinkL * 1.4 * waveSwell;
      ambienceR = pinkR * 1.4 * waveSwell;
    } else if (presetId === "campfire-night") {
      const crackleL = Math.abs(whiteL) > 0.495 ? whiteL * 0.38 : 0;
      const crackleR = Math.abs(whiteR) > 0.495 ? whiteR * 0.38 : 0;
      ambienceL = pinkL * 0.6 + crackleL;
      ambienceR = pinkR * 0.6 + crackleR;
    } else {
      // Subtle vinyl surface warmth for musical beds
      ambienceL = pinkL * 0.18;
      ambienceR = pinkR * 0.18;
    }

    left[i] = Math.max(-0.95, Math.min(0.95, musicalL + ambienceL));
    right[i] = Math.max(-0.95, Math.min(0.95, musicalR + ambienceR));
  }

  return buffer;
}
