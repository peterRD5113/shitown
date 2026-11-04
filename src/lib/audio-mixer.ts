/**
 * Broadcast-grade Web Audio API Mixer with:
 * - Intro Padding (1.5s BGM swell before voice starts)
 * - Automatic Voice Ducking (envelope follower that dips BGM when speaker talks and restores during pauses)
 * - Outro Padding (2.5s BGM tail fade-out after voice finishes)
 * - 16-bit PCM WAV Encoder for instant download & server archiving
 */

export interface MixOptions {
  voiceGain: number; // e.g. 1.0 (100%)
  bgmGain: number; // e.g. 0.32 (32%)
  duckingDepthDb: number; // e.g. 9 (reduces BGM by 9 dB when voice speaks)
  introSeconds?: number; // default 1.5s
  outroSeconds?: number; // default 2.5s
}

export async function renderAutoDuckedMix(
  voiceBuffer: AudioBuffer,
  bgmBuffer: AudioBuffer,
  options: MixOptions
): Promise<{ mixedBuffer: AudioBuffer; wavBlob: Blob; durationSeconds: number }> {
  const sampleRate = 44100;
  const introSec = options.introSeconds ?? 1.5;
  const outroSec = options.outroSeconds ?? 2.5;
  const totalDuration = introSec + voiceBuffer.duration + outroSec;
  const totalFrames = Math.ceil(totalDuration * sampleRate);

  // Resample voice and bgm into a unified OfflineAudioContext first
  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

  const voiceSource = offlineCtx.createBufferSource();
  voiceSource.buffer = voiceBuffer;
  const voiceGainNode = offlineCtx.createGain();
  voiceGainNode.gain.value = options.voiceGain;
  voiceSource.connect(voiceGainNode);
  voiceGainNode.connect(offlineCtx.destination);
  voiceSource.start(introSec);

  const renderedVoiceOnly = await offlineCtx.startRendering();

  // Now compute the envelope of the voice to apply smooth broadcast sidechain ducking on the BGM
  const vLeft = renderedVoiceOnly.getChannelData(0);
  const vRight = renderedVoiceOnly.getChannelData(1);

  const bgmLeftRaw = bgmBuffer.getChannelData(0);
  const bgmRightRaw = bgmBuffer.numberOfChannels > 1 ? bgmBuffer.getChannelData(1) : bgmLeftRaw;
  const bgmSampleRatio = bgmBuffer.sampleRate / sampleRate;

  const outCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
  const mixedBuffer = outCtx.createBuffer(2, totalFrames, sampleRate);
  const outL = mixedBuffer.getChannelData(0);
  const outR = mixedBuffer.getChannelData(1);

  const duckLinearRatio = Math.pow(10, -Math.abs(options.duckingDepthDb) / 20);
  const attackCoeff = Math.exp(-1 / (0.045 * sampleRate)); // 45ms fast attack when voice starts
  const releaseCoeff = Math.exp(-1 / (0.42 * sampleRate)); // 420ms warm release during speech pauses
  let env = 0;

  const fadeInFrames = Math.floor(1.2 * sampleRate);
  const fadeOutFrames = Math.floor(2.2 * sampleRate);

  for (let i = 0; i < totalFrames; i++) {
    const vl = vLeft[i];
    const vr = vRight[i];
    const voiceAmp = Math.max(Math.abs(vl), Math.abs(vr));

    // Envelope follower
    if (voiceAmp > env) {
      env = attackCoeff * env + (1 - attackCoeff) * voiceAmp;
    } else {
      env = releaseCoeff * env + (1 - releaseCoeff) * voiceAmp;
    }

    // Determine how much to duck BGM (threshold ~ 0.025)
    const speechActivity = Math.min(1, Math.max(0, (env - 0.02) / 0.12));
    const currentDuckMultiplier = 1 - speechActivity * (1 - duckLinearRatio);

    // Master fade-in and fade-out envelope for BGM
    let masterFade = 1;
    if (i < fadeInFrames) {
      masterFade = i / fadeInFrames;
    } else if (i > totalFrames - fadeOutFrames) {
      masterFade = Math.max(0, (totalFrames - i) / fadeOutFrames);
    }

    // Loop BGM seamlessly if shorter than totalFrames
    const bgmIdx = Math.floor(i * bgmSampleRatio) % bgmBuffer.length;
    const bl = bgmLeftRaw[bgmIdx] * options.bgmGain * currentDuckMultiplier * masterFade;
    const br = bgmRightRaw[bgmIdx] * options.bgmGain * currentDuckMultiplier * masterFade;

    // Soft-clipping limiter so voice + bgm never distorts
    outL[i] = Math.tanh(vl + bl);
    outR[i] = Math.tanh(vr + br);
  }

  const wavBlob = audioBufferToWavBlob(mixedBuffer);
  return { mixedBuffer, wavBlob, durationSeconds: totalDuration };
}

export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}
