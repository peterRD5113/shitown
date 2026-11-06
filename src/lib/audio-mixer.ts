/**
 * Broadcast-grade Web Audio API Mixer with Intelligent Automatic Loudness Balancing:
 * 1. Active Speech RMS Normalization: Measures the speaker's actual talking loudness
 *    (ignoring silence) and automatically boosts/normalizes quiet mic recordings to -13 dBFS.
 * 2. BGM RMS Loudness Matching: Measures the AI-generated BGM's RMS loudness (since Fal.ai
 *    tracks are often mastered very loud at -9 dBFS) and automatically scales the BGM down
 *    so its base level sits 16 dB below the normalized voice.
 * 3. Adaptive Lookahead Voice Ducking: Whenever the user speaks, BGM smoothly dips an additional
 *    9 dB (putting BGM ~24 dB below the spoken words) and gently swells back only during
 *    the 1.5s intro, long pauses, and 2.5s outro.
 */

export interface MixOptions {
  voiceGain?: number;
  bgmGain?: number;
  duckingDepthDb?: number;
  introSeconds?: number;
  outroSeconds?: number;
}

/**
 * Computes active RMS (ignoring near-silent frames) and peak amplitude of a stereo/mono buffer.
 */
function analyzeAudioLoudness(
  left: Float32Array,
  right: Float32Array
): { activeRms: number; overallRms: number; peak: number } {
  let peak = 0;
  let totalSq = 0;
  const len = left.length;

  // First pass: find peak and overall RMS
  for (let i = 0; i < len; i++) {
    const l = left[i];
    const r = right[i];
    const absMax = Math.max(Math.abs(l), Math.abs(r));
    if (absMax > peak) peak = absMax;
    const mono = 0.5 * (l + r);
    totalSq += mono * mono;
  }

  const overallRms = Math.sqrt(totalSq / Math.max(1, len));

  // Second pass: compute RMS over 50ms windows that exceed noise gate (12% of peak or 0.008)
  const windowSize = 2205; // 50ms at 44.1kHz
  const gateThreshold = Math.max(0.006, peak * 0.12);
  let activeSqSum = 0;
  let activeSampleCount = 0;

  for (let start = 0; start < len; start += windowSize) {
    const end = Math.min(len, start + windowSize);
    let winSq = 0;
    for (let i = start; i < end; i++) {
      const mono = 0.5 * (left[i] + right[i]);
      winSq += mono * mono;
    }
    const winRms = Math.sqrt(winSq / (end - start));
    if (winRms >= gateThreshold) {
      activeSqSum += winSq;
      activeSampleCount += end - start;
    }
  }

  const activeRms =
    activeSampleCount > 0
      ? Math.sqrt(activeSqSum / activeSampleCount)
      : Math.max(overallRms, 0.01);

  return {
    activeRms: Math.max(activeRms, 0.005),
    overallRms: Math.max(overallRms, 0.005),
    peak: Math.max(peak, 0.01),
  };
}

export async function renderAutoDuckedMix(
  voiceBuffer: AudioBuffer,
  bgmBuffer: AudioBuffer,
  options: MixOptions = {}
): Promise<{ mixedBuffer: AudioBuffer; wavBlob: Blob; durationSeconds: number }> {
  const sampleRate = 44100;
  const introSec = options.introSeconds ?? 1.5;
  const outroSec = options.outroSeconds ?? 2.5;
  const totalDuration = introSec + voiceBuffer.duration + outroSec;
  const totalFrames = Math.ceil(totalDuration * sampleRate);

  // 1. Resample voice into unified 44.1kHz stereo OfflineAudioContext
  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
  const voiceSource = offlineCtx.createBufferSource();
  voiceSource.buffer = voiceBuffer;
  voiceSource.connect(offlineCtx.destination);
  voiceSource.start(introSec);

  const renderedVoiceOnly = await offlineCtx.startRendering();
  const vLeft = renderedVoiceOnly.getChannelData(0);
  const vRight = renderedVoiceOnly.getChannelData(1);

  const bgmLeftRaw = bgmBuffer.getChannelData(0);
  const bgmRightRaw =
    bgmBuffer.numberOfChannels > 1 ? bgmBuffer.getChannelData(1) : bgmLeftRaw;
  const bgmSampleRatio = bgmBuffer.sampleRate / sampleRate;

  // 2. Measure actual voice loudness vs. actual BGM loudness
  const voiceStartFrame = Math.floor(introSec * sampleRate);
  const voiceEndFrame = Math.min(
    totalFrames,
    Math.floor((introSec + voiceBuffer.duration) * sampleRate)
  );
  const voiceStats = analyzeAudioLoudness(
    vLeft.subarray(voiceStartFrame, voiceEndFrame),
    vRight.subarray(voiceStartFrame, voiceEndFrame)
  );
  const bgmStats = analyzeAudioLoudness(bgmLeftRaw, bgmRightRaw);

  // Target active speech RMS = 0.22 (~ -13 dBFS) so quiet phone recordings become clear and warm
  const targetVoiceRms = 0.22;
  // Cap boost at +20 dB (10x) so background room noise isn't over-amplified, and keep peak <= 0.92
  const autoVoiceGain = Math.min(
    10.0,
    0.92 / voiceStats.peak,
    targetVoiceRms / voiceStats.activeRms
  );

  const normalizedVoiceRms = voiceStats.activeRms * autoVoiceGain;

  // Target BGM base RMS (during intro/outro/pauses) = 48% of normalized voice RMS (~ -6.3 dB below voice)
  const targetBgmBaseRms = normalizedVoiceRms * 0.48;
  const autoBgmBaseGain = Math.min(
    1.8,
    targetBgmBaseRms / bgmStats.activeRms
  );

  // During active speech, duck BGM by a gentle 5.5 dB (so BGM sits at ~25% of voice amplitude while talking: clearly audible and warm, without overpowering speech)
  const duckDb = options.duckingDepthDb ?? 5.5;
  const duckLinearRatio = Math.pow(10, -Math.abs(duckDb) / 20); // ~0.531

  // 3. Compute lookahead speech envelope (40ms lookahead so BGM ducks *before* the consonant hits)
  const lookaheadFrames = Math.floor(0.04 * sampleRate);
  const attackCoeff = Math.exp(-1 / (0.025 * sampleRate)); // 25ms fast ducking attack
  const releaseCoeff = Math.exp(-1 / (0.65 * sampleRate)); // 650ms gentle recovery during pauses
  let env = 0;

  const outCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
  const mixedBuffer = outCtx.createBuffer(2, totalFrames, sampleRate);
  const outL = mixedBuffer.getChannelData(0);
  const outR = mixedBuffer.getChannelData(1);

  const fadeInFrames = Math.floor(1.2 * sampleRate);
  const fadeOutFrames = Math.floor(2.2 * sampleRate);

  // Adaptive speech detection threshold based on normalized voice level
  const speechThreshold = normalizedVoiceRms * 0.14;
  const speechFullRange = normalizedVoiceRms * 0.45;

  for (let i = 0; i < totalFrames; i++) {
    // Look ahead slightly for ducking detection so music dips right as the user starts speaking
    const lookIdx = Math.min(totalFrames - 1, i + lookaheadFrames);
    const lookVl = vLeft[lookIdx] * autoVoiceGain;
    const lookVr = vRight[lookIdx] * autoVoiceGain;
    const voiceAmp = Math.max(Math.abs(lookVl), Math.abs(lookVr));

    if (voiceAmp > env) {
      env = attackCoeff * env + (1 - attackCoeff) * voiceAmp;
    } else {
      env = releaseCoeff * env + (1 - releaseCoeff) * voiceAmp;
    }

    const speechActivity = Math.min(
      1,
      Math.max(0, (env - speechThreshold) / Math.max(0.01, speechFullRange))
    );
    const currentDuckMultiplier = 1 - speechActivity * (1 - duckLinearRatio);

    // Master fade-in and fade-out envelope for BGM
    let masterFade = 1;
    if (i < fadeInFrames) {
      masterFade = i / fadeInFrames;
    } else if (i > totalFrames - fadeOutFrames) {
      masterFade = Math.max(0, (totalFrames - i) / fadeOutFrames);
    }

    // Current voice sample (with soft saturation protection)
    const vl = vLeft[i] * autoVoiceGain;
    const vr = vRight[i] * autoVoiceGain;

    // Loop BGM seamlessly if shorter than totalFrames
    const bgmIdx = Math.floor(i * bgmSampleRatio) % bgmBuffer.length;
    const effectiveBgmGain =
      autoBgmBaseGain * currentDuckMultiplier * masterFade;
    const bl = bgmLeftRaw[bgmIdx] * effectiveBgmGain;
    const br = bgmRightRaw[bgmIdx] * effectiveBgmGain;

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
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export type ReferencePlacementMode =
  | "style"
  | "extend-after"
  | "extend-both"
  | "extend-before";

/**
 * Places a reference clip at the start ("extend-after"), middle ("extend-both"),
 * or end ("extend-before") of a backing track buffer with smooth equal-power crossfades.
 */
export async function composeReferencePlacementBuffer(
  referenceBuffer: AudioBuffer,
  extensionBedBuffer: AudioBuffer,
  placement: ReferencePlacementMode,
  targetDurationSec: number
): Promise<AudioBuffer> {
  if (placement === "style") {
    return extensionBedBuffer;
  }

  const sampleRate = 44100;
  const totalFrames = Math.max(1, Math.ceil(targetDurationSec * sampleRate));

  // Resample referenceBuffer into 44.1kHz stereo
  const maxRefSec = Math.min(
    referenceBuffer.duration,
    Math.max(3, targetDurationSec * 0.45)
  );
  const refFrames = Math.max(1, Math.floor(maxRefSec * sampleRate));
  const refOffline = new OfflineAudioContext(2, refFrames, sampleRate);
  const refSrc = refOffline.createBufferSource();
  refSrc.buffer = referenceBuffer;
  refSrc.connect(refOffline.destination);
  refSrc.start(0, 0, maxRefSec);
  const renderedRef = await refOffline.startRendering();

  const refL = renderedRef.getChannelData(0);
  const refR = renderedRef.getChannelData(1);

  const bedL = extensionBedBuffer.getChannelData(0);
  const bedR =
    extensionBedBuffer.numberOfChannels > 1
      ? extensionBedBuffer.getChannelData(1)
      : bedL;
  const bedRatio = extensionBedBuffer.sampleRate / sampleRate;

  // Match RMS loudness between reference clip and extension bed
  const refStats = analyzeAudioLoudness(refL, refR);
  const bedStats = analyzeAudioLoudness(bedL, bedR);
  const refScale = Math.min(
    2.2,
    Math.max(0.35, bedStats.activeRms / Math.max(0.01, refStats.activeRms))
  );

  let refStartFrame = 0;
  if (placement === "extend-after") {
    refStartFrame = 0;
  } else if (placement === "extend-both") {
    refStartFrame = Math.max(0, Math.floor((totalFrames - refFrames) / 2));
  } else if (placement === "extend-before") {
    refStartFrame = Math.max(0, totalFrames - refFrames);
  }
  const refEndFrame = Math.min(totalFrames, refStartFrame + refFrames);
  const crossfadeFrames = Math.min(
    Math.floor(0.45 * sampleRate),
    Math.floor(refFrames * 0.25)
  );

  const outCtx = new OfflineAudioContext(2, totalFrames, sampleRate);
  const outBuf = outCtx.createBuffer(2, totalFrames, sampleRate);
  const outL = outBuf.getChannelData(0);
  const outR = outBuf.getChannelData(1);

  for (let i = 0; i < totalFrames; i++) {
    const bedIdx = Math.floor(i * bedRatio) % extensionBedBuffer.length;
    const bSampleL = bedL[bedIdx];
    const bSampleR = bedR[bedIdx];

    if (i >= refStartFrame && i < refEndFrame) {
      const localIdx = i - refStartFrame;
      const rSampleL = refL[localIdx] * refScale;
      const rSampleR = refR[localIdx] * refScale;

      // Compute equal-power crossfade weight (1 = pure reference, 0 = pure extension bed)
      let refWeight = 1.0;
      if (placement !== "extend-after" && localIdx < crossfadeFrames) {
        const phase = localIdx / Math.max(1, crossfadeFrames);
        refWeight = Math.sin(phase * 0.5 * Math.PI);
      } else if (
        placement !== "extend-before" &&
        refEndFrame - i <= crossfadeFrames
      ) {
        const phase = (refEndFrame - i) / Math.max(1, crossfadeFrames);
        refWeight = Math.sin(phase * 0.5 * Math.PI);
      }

      const bedWeight = Math.sqrt(Math.max(0, 1 - refWeight * refWeight));
      outL[i] = rSampleL * refWeight + bSampleL * bedWeight;
      outR[i] = rSampleR * refWeight + bSampleR * bedWeight;
    } else {
      outL[i] = bSampleL;
      outR[i] = bSampleR;
    }
  }

  return outBuf;
}

