let clipIdCounter = 0;

export class AudioClip {
  constructor(buffer, name) {
    this.id = ++clipIdCounter;
    this.type = 'audio';
    this.buffer = buffer;
    this.name = name || 'クリップ';
    this.offset = 0;
    this.trimStart = 0;
    this.duration = buffer ? buffer.duration : 0;
    this.fadeIn = 0;
    this.fadeOut = 0;
    this.gain = 1;
    this.pitchCorrected = false;
    this.selectionStart = null;
    this.selectionEnd = null;
    this.peaks = null;
  }

  endTime() { return this.offset + this.duration; }
  hasSelection() { return this.selectionStart !== null && this.selectionEnd !== null && this.selectionEnd > this.selectionStart; }
  clearSelection() { this.selectionStart = null; this.selectionEnd = null; }
  invalidatePeaks() { this.peaks = null; }

  replaceBuffer(newBuffer) {
    const oldDur = this.buffer ? this.buffer.duration : 0;
    this.buffer = newBuffer;
    this.peaks = null;
    if (this.trimStart + this.duration > newBuffer.duration) {
      this.trimStart = Math.min(this.trimStart, newBuffer.duration - 0.01);
      this.duration = newBuffer.duration - this.trimStart;
    }
    this.clearSelection();
  }

  computePeaks(target) {
    if (!this.buffer) return;
    if (this.peaks && this.peaks.length === target) return;
    const data = this.buffer.getChannelData(0);
    const startSample = Math.floor(this.trimStart * this.buffer.sampleRate);
    const endSample = Math.min(data.length, Math.floor((this.trimStart + this.duration) * this.buffer.sampleRate));
    const len = endSample - startSample;
    const block = Math.max(1, Math.floor(len / target));
    const peaks = new Float32Array(target);
    for (let i = 0; i < target; i++) {
      const s = startSample + i * block;
      const e = Math.min(s + block, endSample);
      let m = 0;
      for (let j = s; j < e; j++) {
        const v = Math.abs(data[j]);
        if (v > m) m = v;
      }
      peaks[i] = m;
    }
    this.peaks = peaks;
  }

  serialize() {
    return {
      type: 'audio',
      name: this.name,
      offset: this.offset,
      trimStart: this.trimStart,
      duration: this.duration,
      fadeIn: this.fadeIn,
      fadeOut: this.fadeOut,
      gain: this.gain,
      pitchCorrected: this.pitchCorrected,
    };
  }
}

export class MidiClip {
  constructor(name) {
    this.id = ++clipIdCounter;
    this.type = 'midi';
    this.name = name || 'MIDIクリップ';
    this.offset = 0;
    this.duration = 4;
    this.gain = 1;
    this.notes = [];
  }

  endTime() { return this.offset + this.duration; }
  hasSelection() { return false; }
  clearSelection() {}

  addNote(time, dur, midi, vel) {
    this.notes.push({ time, dur, midi, velocity: vel || 0.7 });
  }

  removeNoteIndex(idx) {
    if (idx >= 0 && idx < this.notes.length) this.notes.splice(idx, 1);
  }

  serialize() {
    return {
      type: 'midi',
      name: this.name,
      offset: this.offset,
      duration: this.duration,
      gain: this.gain,
      notes: this.notes.map(n => ({ ...n })),
    };
  }
}

export function deserializeClip(data, buffer) {
  if (data.type === 'midi') {
    const c = new MidiClip(data.name);
    c.offset = data.offset || 0;
    c.duration = data.duration || 4;
    c.gain = data.gain != null ? data.gain : 1;
    c.notes = (data.notes || []).map(n => ({ ...n }));
    return c;
  }
  const c = new AudioClip(buffer, data.name);
  c.offset = data.offset || 0;
  c.trimStart = data.trimStart || 0;
  c.duration = data.duration || (buffer ? buffer.duration : 0);
  c.fadeIn = data.fadeIn || 0;
  c.fadeOut = data.fadeOut || 0;
  c.gain = data.gain != null ? data.gain : 1;
  c.pitchCorrected = !!data.pitchCorrected;
  return c;
}
