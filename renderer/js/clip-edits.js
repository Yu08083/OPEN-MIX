export function silenceClipRange(clip, start, end) {
  if (!clip.buffer) return;
  const sr = clip.buffer.sampleRate;
  const absStart = clip.trimStart + start;
  const absEnd = clip.trimStart + end;
  const startSample = Math.max(0, Math.floor(absStart * sr));
  const endSample = Math.min(clip.buffer.length, Math.floor(absEnd * sr));
  const fade = Math.min(64, Math.floor((endSample - startSample) / 2));
  for (let c = 0; c < clip.buffer.numberOfChannels; c++) {
    const data = clip.buffer.getChannelData(c);
    for (let i = startSample; i < endSample; i++) data[i] = 0;
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      if (startSample - 1 - i >= 0) data[startSample - 1 - i] *= (1 - k);
      if (endSample + i < clip.buffer.length) data[endSample + i] *= k;
    }
  }
  clip.peaks = null;
}

export function applyGainToClipRange(clip, start, end, factor) {
  if (!clip.buffer) return;
  const sr = clip.buffer.sampleRate;
  const absStart = clip.trimStart + start;
  const absEnd = clip.trimStart + end;
  const startSample = Math.max(0, Math.floor(absStart * sr));
  const endSample = Math.min(clip.buffer.length, Math.floor(absEnd * sr));
  const fade = Math.min(128, Math.floor((endSample - startSample) / 4));
  for (let c = 0; c < clip.buffer.numberOfChannels; c++) {
    const data = clip.buffer.getChannelData(c);
    for (let i = startSample + fade; i < endSample - fade; i++) data[i] *= factor;
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      const mix = 1 + (factor - 1) * k;
      if (startSample + i < data.length) data[startSample + i] *= mix;
      if (endSample - 1 - i >= 0) data[endSample - 1 - i] *= mix;
    }
  }
  clip.peaks = null;
}

export function applyFadeToClipRange(clip, start, end, type) {
  if (!clip.buffer) return;
  const sr = clip.buffer.sampleRate;
  const absStart = clip.trimStart + start;
  const absEnd = clip.trimStart + end;
  const startSample = Math.max(0, Math.floor(absStart * sr));
  const endSample = Math.min(clip.buffer.length, Math.floor(absEnd * sr));
  const length = endSample - startSample;
  if (length <= 0) return;
  for (let c = 0; c < clip.buffer.numberOfChannels; c++) {
    const data = clip.buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const ratio = i / length;
      const factor = type === 'in' ? ratio : (1 - ratio);
      data[startSample + i] *= factor;
    }
  }
  clip.peaks = null;
}

export function deleteClipRange(clip, start, end) {
  if (!clip.buffer) return;
  const sr = clip.buffer.sampleRate;
  const absStart = clip.trimStart + start;
  const absEnd = clip.trimStart + end;
  const startSample = Math.max(0, Math.floor(absStart * sr));
  const endSample = Math.min(clip.buffer.length, Math.floor(absEnd * sr));
  const removeLen = endSample - startSample;
  if (removeLen <= 0) return;
  const newLen = clip.buffer.length - removeLen;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const newBuf = ctx.createBuffer(clip.buffer.numberOfChannels, newLen, sr);
  for (let c = 0; c < clip.buffer.numberOfChannels; c++) {
    const src = clip.buffer.getChannelData(c);
    const dst = newBuf.getChannelData(c);
    for (let i = 0; i < startSample; i++) dst[i] = src[i];
    for (let i = endSample; i < clip.buffer.length; i++) {
      dst[startSample + (i - endSample)] = src[i];
    }
  }
  ctx.close();
  clip.buffer = newBuf;
  clip.duration = Math.max(0.05, clip.duration - (end - start));
  clip.peaks = null;
  clip.clearSelection();
}

export function normalizeClipRange(clip, start, end) {
  if (!clip.buffer) return;
  const sr = clip.buffer.sampleRate;
  const absStart = clip.trimStart + start;
  const absEnd = clip.trimStart + end;
  const startSample = Math.max(0, Math.floor(absStart * sr));
  const endSample = Math.min(clip.buffer.length, Math.floor(absEnd * sr));
  let peak = 0;
  for (let c = 0; c < clip.buffer.numberOfChannels; c++) {
    const data = clip.buffer.getChannelData(c);
    for (let i = startSample; i < endSample; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak < 1e-6) return;
  applyGainToClipRange(clip, start, end, 0.95 / peak);
}
