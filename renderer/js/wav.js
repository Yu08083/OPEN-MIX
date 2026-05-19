import { clamp } from './utils.js';

export function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const len = buffer.length * numCh * 2 + 44;
  const out = new ArrayBuffer(len);
  const view = new DataView(out);
  let p = 0;

  function ws(s) { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); }
  function w32(v) { view.setUint32(p, v, true); p += 4; }
  function w16(v) { view.setUint16(p, v, true); p += 2; }

  ws('RIFF'); w32(len - 8); ws('WAVE');
  ws('fmt '); w32(16); w16(1); w16(numCh); w32(sr); w32(sr * numCh * 2); w16(numCh * 2); w16(16);
  ws('data'); w32(buffer.length * numCh * 2);

  const channels = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));

  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = clamp(channels[c][i], -1, 1);
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      p += 2;
    }
  }

  return new Blob([out], { type: 'audio/wav' });
}
