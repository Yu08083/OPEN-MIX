const SCALES = {
  chromatic: [0,1,2,3,4,5,6,7,8,9,10,11],
  major: [0,2,4,5,7,9,11],
  minor: [0,2,3,5,7,8,10],
  pentatonic_major: [0,2,4,7,9],
  pentatonic_minor: [0,3,5,7,10],
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function getScaleOptions() {
  return [
    { id: 'chromatic', name: 'クロマチック（全音）' },
    { id: 'major', name: 'メジャー' },
    { id: 'minor', name: 'マイナー' },
    { id: 'pentatonic_major', name: 'メジャーペンタトニック' },
    { id: 'pentatonic_minor', name: 'マイナーペンタトニック' },
  ];
}

export function getKeyOptions() {
  return NOTE_NAMES.map((n, i) => ({ id: i, name: n }));
}

export function freqToMidi(freq) {
  if (freq <= 0) return -Infinity;
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function snapToScale(freq, key, scaleId) {
  if (freq <= 0) return 0;
  const scale = SCALES[scaleId] || SCALES.chromatic;
  const midi = freqToMidi(freq);
  const rounded = Math.round(midi);
  let best = rounded;
  let bestDist = Infinity;
  for (let offset = -6; offset <= 6; offset++) {
    const candidate = rounded + offset;
    const cls = ((candidate - key) % 12 + 12) % 12;
    if (scale.indexOf(cls) >= 0) {
      const dist = Math.abs(midi - candidate);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  return midiToFreq(best);
}

export function yinDetect(buffer, sampleRate, threshold = 0.1) {
  const N = buffer.length;
  const W = N >> 1;
  const minPeriod = Math.max(2, Math.floor(sampleRate / 880));
  const maxPeriod = Math.min(Math.floor(sampleRate / 75), W - 1);
  if (maxPeriod <= minPeriod) return 0;

  const d = new Float32Array(maxPeriod + 1);
  d[0] = 1;
  for (let tau = 1; tau <= maxPeriod; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }
  let running = 0;
  for (let tau = 1; tau <= maxPeriod; tau++) {
    running += d[tau];
    d[tau] = d[tau] * tau / (running || 1);
  }
  let tau = minPeriod;
  while (tau < maxPeriod) {
    if (d[tau] < threshold) {
      while (tau + 1 < maxPeriod && d[tau + 1] < d[tau]) tau++;
      if (tau > 0 && tau < maxPeriod) {
        const a = d[tau - 1], b = d[tau], c = d[tau + 1];
        const denom = a - 2 * b + c;
        if (Math.abs(denom) > 1e-10) {
          const x0 = tau + 0.5 * (a - c) / denom;
          return sampleRate / x0;
        }
      }
      return sampleRate / tau;
    }
    tau++;
  }
  return 0;
}

export async function analyzePitchCurve(buffer, progressCb) {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const windowSize = 2048;
  const hop = 1024;
  const numFrames = Math.max(0, Math.floor((data.length - windowSize) / hop));
  const result = new Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const w = data.subarray(i * hop, i * hop + windowSize);
    const f = yinDetect(w, sr);
    result[i] = { time: (i * hop + windowSize / 2) / sr, freq: f };
    if (progressCb && i % 30 === 0) {
      progressCb(i / numFrames);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  if (progressCb) progressCb(1);
  return result;
}

function fft(re, im) {
  const N = re.length;
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let size = 2; size <= N; size *= 2) {
    const half = size >> 1;
    const ang = -2 * Math.PI / size;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < N; i += size) {
      let pRe = 1, pIm = 0;
      for (let k = 0; k < half; k++) {
        const tRe = pRe * re[i + k + half] - pIm * im[i + k + half];
        const tIm = pRe * im[i + k + half] + pIm * re[i + k + half];
        re[i + k + half] = re[i + k] - tRe;
        im[i + k + half] = im[i + k] - tIm;
        re[i + k] += tRe;
        im[i + k] += tIm;
        const nRe = pRe * wRe - pIm * wIm;
        pIm = pRe * wIm + pIm * wRe;
        pRe = nRe;
      }
    }
  }
}

function ifft(re, im) {
  const N = re.length;
  for (let i = 0; i < N; i++) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < N; i++) {
    re[i] /= N;
    im[i] = -im[i] / N;
  }
}

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
  }
  return w;
}

function wrapPhase(p) {
  return p - 2 * Math.PI * Math.round(p / (2 * Math.PI));
}

export async function correctPitch(buffer, options, progressCb) {
  const { strength = 1, scale = 'chromatic', key = 0 } = options;
  const sr = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const length = buffer.length;
  const fftSize = 2048;
  const hop = fftSize >> 2;
  const half = fftSize >> 1;
  const win = hannWindow(fftSize);

  const inputs = [];
  const outputs = [];
  for (let c = 0; c < numCh; c++) {
    inputs.push(buffer.getChannelData(c));
    outputs.push(new Float32Array(length));
  }
  const normalize = new Float32Array(length);
  const numFrames = Math.max(0, Math.floor((length - fftSize) / hop));

  const prevInPhase = [];
  const accumOutPhase = [];
  for (let c = 0; c < numCh; c++) {
    prevInPhase.push(new Float32Array(half));
    accumOutPhase.push(new Float32Array(half));
  }

  const mag = new Float32Array(half);
  const trueOmega = new Float32Array(half);

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hop;

    const det = inputs[0].subarray(start, start + fftSize);
    const freq = yinDetect(det, sr);

    let ratio = 1;
    if (freq > 0) {
      const target = snapToScale(freq, key, scale);
      if (target > 0) ratio = 1 + strength * (target / freq - 1);
    }

    for (let c = 0; c < numCh; c++) {
      const re = new Float32Array(fftSize);
      const im = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        re[i] = inputs[c][start + i] * win[i];
      }

      if (Math.abs(ratio - 1) > 0.001) {
        fft(re, im);

        for (let k = 1; k < half; k++) {
          mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
          const phase = Math.atan2(im[k], re[k]);
          const omega = 2 * Math.PI * k / fftSize;
          const expected = omega * hop;
          const diff = wrapPhase(phase - prevInPhase[c][k] - expected);
          trueOmega[k] = omega + diff / hop;
          prevInPhase[c][k] = phase;
        }

        const outRe = new Float32Array(fftSize);
        const outIm = new Float32Array(fftSize);

        for (let kOut = 1; kOut < half; kOut++) {
          const kInFloat = kOut / ratio;
          const kIn = Math.floor(kInFloat);
          if (kIn < 1 || kIn + 1 >= half) continue;
          const frac = kInFloat - kIn;

          const m = mag[kIn] * (1 - frac) + mag[kIn + 1] * frac;
          if (m < 1e-10) continue;

          const tOm = trueOmega[kIn] * (1 - frac) + trueOmega[kIn + 1] * frac;
          const shiftedOm = tOm * ratio;

          accumOutPhase[c][kOut] = wrapPhase(accumOutPhase[c][kOut] + shiftedOm * hop);
          outRe[kOut] = m * Math.cos(accumOutPhase[c][kOut]);
          outIm[kOut] = m * Math.sin(accumOutPhase[c][kOut]);
        }

        outRe[0] = re[0];
        for (let k = 1; k < half; k++) {
          outRe[fftSize - k] = outRe[k];
          outIm[fftSize - k] = -outIm[k];
        }

        ifft(outRe, outIm);
        for (let i = 0; i < fftSize; i++) {
          outputs[c][start + i] += outRe[i] * win[i];
        }
      } else {
        for (let i = 0; i < fftSize; i++) {
          outputs[c][start + i] += re[i] * win[i];
        }
      }
    }

    for (let i = 0; i < fftSize; i++) {
      normalize[start + i] += win[i] * win[i];
    }

    if (frame % 25 === 0 && progressCb) {
      progressCb(frame / numFrames);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  for (let c = 0; c < numCh; c++) {
    for (let i = 0; i < length; i++) {
      if (normalize[i] > 1e-6) outputs[c][i] /= normalize[i];
    }
  }
  if (progressCb) progressCb(1);

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const newBuf = ctx.createBuffer(numCh, length, sr);
  for (let c = 0; c < numCh; c++) {
    newBuf.copyToChannel(outputs[c], c);
  }
  ctx.close();
  return newBuf;
}

export async function correctPitchRange(buffer, startSec, endSec, options, progressCb) {
  const sr = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const startSample = Math.max(0, Math.floor(startSec * sr));
  const endSample = Math.min(buffer.length, Math.floor(endSec * sr));
  const rangeLen = endSample - startSample;
  if (rangeLen < 2048) return;

  const padSamples = Math.min(4096, startSample, buffer.length - endSample);
  const subLen = rangeLen + padSamples * 2;
  const subStart = startSample - padSamples;

  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const subBuf = ctx.createBuffer(numCh, subLen, sr);
  for (let c = 0; c < numCh; c++) {
    const src = buffer.getChannelData(c);
    const dst = subBuf.getChannelData(c);
    for (let i = 0; i < subLen; i++) dst[i] = src[subStart + i];
  }

  const correctedSub = await correctPitch(subBuf, options, progressCb);

  const fadeLen = Math.min(512, Math.floor(rangeLen / 8), padSamples);
  for (let c = 0; c < numCh; c++) {
    const src = correctedSub.getChannelData(c);
    const dst = buffer.getChannelData(c);
    for (let i = 0; i < rangeLen; i++) {
      const targetIdx = startSample + i;
      const srcIdx = padSamples + i;
      let mix = 1;
      if (fadeLen > 0) {
        if (i < fadeLen) mix = i / fadeLen;
        else if (i >= rangeLen - fadeLen) mix = (rangeLen - i) / fadeLen;
      }
      dst[targetIdx] = src[srcIdx] * mix + dst[targetIdx] * (1 - mix);
    }
  }
  ctx.close();
}
