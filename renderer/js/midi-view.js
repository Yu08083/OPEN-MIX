import { escapeHtml } from './utils.js';

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function midiName(m) {
  const oct = Math.floor(m / 12) - 1;
  return NOTE_NAMES[((m % 12) + 12) % 12] + oct;
}

export class MidiEditor {
  constructor(app) {
    this.app = app;
    this.backdrop = document.getElementById('midi-modal-backdrop');
    this.modal = document.getElementById('midi-modal');
    this.track = null;
    this.clip = null;
    this.minMidi = 48;
    this.maxMidi = 84;
    this.selectedNoteIdx = -1;
    this.dragging = null;
    this.backdrop.addEventListener('click', e => {
      if (e.target === this.backdrop) this.close();
    });
  }

  isOpen() { return this.backdrop.classList.contains('active'); }

  open(track, clip) {
    this.track = track;
    this.clip = clip;
    this.selectedNoteIdx = -1;
    this._computeBounds();
    this.render();
    this.backdrop.classList.add('active');
  }
  close() {
    this.backdrop.classList.remove('active');
    if (this.track && this.app) this.app.drawClip(this.clip);
    this.track = null;
    this.clip = null;
  }

  _computeBounds() {
    if (this.clip.notes.length === 0) {
      this.minMidi = 48; this.maxMidi = 84;
    } else {
      let lo = 127, hi = 0;
      for (const n of this.clip.notes) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; }
      this.minMidi = Math.max(0, Math.floor(lo - 6));
      this.maxMidi = Math.min(127, Math.ceil(hi + 6));
      if (this.maxMidi - this.minMidi < 24) {
        const c = (this.minMidi + this.maxMidi) / 2;
        this.minMidi = Math.max(0, Math.floor(c - 12));
        this.maxMidi = Math.min(127, Math.ceil(c + 12));
      }
    }
  }

  render() {
    this.modal.innerHTML = `
      <div class="modal-header">
        <div>
          <div class="modal-title">MIDIエディタ</div>
          <div class="modal-subtitle">${escapeHtml(this.clip.name)} · ${this.clip.duration.toFixed(2)}秒</div>
        </div>
        <button class="modal-close" id="midi-close">×</button>
      </div>
      <div class="modal-section">
        <div class="pitch-help">
          空のマス目を<strong>クリック</strong>でノート追加、ノートを<strong>ドラッグ</strong>で移動、<strong>右端</strong>をドラッグで長さ変更、<strong>Delete</strong>で削除。
        </div>
        <div class="pitch-canvas-wrap" style="height: 400px;">
          <canvas class="pitch-canvas" id="midi-canvas"></canvas>
        </div>
      </div>
      <div class="modal-section">
        <div class="modal-control">
          <span>クリップ長</span>
          <input type="range" class="slider" id="midi-duration" min="0.5" max="32" step="0.25" value="${this.clip.duration}">
          <span id="midi-duration-val">${this.clip.duration.toFixed(2)}s</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="t-btn" id="midi-clear-all">全ノート削除</button>
        <button class="t-btn primary" id="midi-done">完了</button>
      </div>
    `;
    this.canvas = document.getElementById('midi-canvas');
    document.getElementById('midi-close').addEventListener('click', () => this.close());
    document.getElementById('midi-done').addEventListener('click', () => this.close());
    document.getElementById('midi-clear-all').addEventListener('click', () => {
      if (!confirm('すべてのノートを削除しますか？')) return;
      this.clip.notes = [];
      this.draw();
    });
    document.getElementById('midi-duration').addEventListener('input', e => {
      this.clip.duration = parseFloat(e.target.value);
      document.getElementById('midi-duration-val').textContent = this.clip.duration.toFixed(2) + 's';
      this.draw();
    });

    this.canvas.addEventListener('mousedown', e => this._mouseDown(e));
    window.addEventListener('mousemove', this._mmh = e => this._mouseMove(e));
    window.addEventListener('mouseup', this._muh = e => this._mouseUp(e));
    this.draw();
  }

  draw() {
    const canvas = this.canvas;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const labelW = 48;
    const range = this.maxMidi - this.minMidi;
    const rowH = h / range;
    for (let m = this.minMidi; m <= this.maxMidi; m++) {
      const y = h - (m - this.minMidi) * rowH;
      const cls = ((m % 12) + 12) % 12;
      const isBlack = [1, 3, 6, 8, 10].indexOf(cls) >= 0;
      ctx.fillStyle = isBlack ? 'rgba(0, 0, 0, 0.05)' : 'transparent';
      ctx.fillRect(labelW, y - rowH, w - labelW, rowH);
      ctx.strokeStyle = cls === 0 ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.05)';
      ctx.lineWidth = cls === 0 ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(labelW, y); ctx.lineTo(w, y); ctx.stroke();
      if (rowH > 12 || cls === 0) {
        ctx.fillStyle = cls === 0 ? '#1A1A1A' : '#6A6660';
        ctx.font = (cls === 0 ? '600 ' : '500 ') + '10px "Noto Sans JP", sans-serif';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(midiName(m), labelW - 4, y - rowH / 2);
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.moveTo(labelW, 0); ctx.lineTo(labelW, h); ctx.stroke();

    const beatDur = this.app.engine.beatDuration();
    const numBeats = Math.ceil(this.clip.duration / beatDur);
    for (let i = 0; i <= numBeats; i++) {
      const t = i * beatDur;
      if (t > this.clip.duration) break;
      const x = labelW + (t / this.clip.duration) * (w - labelW);
      const isBar = i % this.app.engine.beatsPerBar === 0;
      ctx.strokeStyle = isBar ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.08)';
      ctx.lineWidth = isBar ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    this.clip.notes.forEach((n, idx) => {
      const x = labelW + (n.time / this.clip.duration) * (w - labelW);
      const wd = Math.max(3, (n.dur / this.clip.duration) * (w - labelW));
      const y = h - (n.midi - this.minMidi + 1) * rowH;
      const isSel = idx === this.selectedNoteIdx;
      ctx.fillStyle = isSel ? '#0550C2' : 'rgba(5, 80, 194, 0.7)';
      ctx.fillRect(x, y, wd, rowH);
      ctx.strokeStyle = isSel ? '#043E96' : 'rgba(5, 80, 194, 1)';
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, wd - 1, rowH - 1);
      if (wd > 30 && rowH > 10) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '500 9px "Noto Sans JP", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(midiName(n.midi), x + 4, y + rowH / 2);
      }
    });
  }

  _mouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const labelW = 48;
    if (x < labelW) return;
    const range = this.maxMidi - this.minMidi;
    const rowH = rect.height / range;
    const midi = this.maxMidi - Math.floor(y / rowH) - 1;
    const time = ((x - labelW) / (rect.width - labelW)) * this.clip.duration;

    for (let i = 0; i < this.clip.notes.length; i++) {
      const n = this.clip.notes[i];
      const nx = labelW + (n.time / this.clip.duration) * (rect.width - labelW);
      const nw = Math.max(3, (n.dur / this.clip.duration) * (rect.width - labelW));
      const ny = rect.height - (n.midi - this.minMidi + 1) * rowH;
      if (x >= nx && x <= nx + nw && y >= ny && y <= ny + rowH) {
        this.selectedNoteIdx = i;
        const onRightEdge = x >= nx + nw - 8;
        this.dragging = {
          mode: onRightEdge ? 'resize' : 'move',
          startX: e.clientX, startY: e.clientY,
          startTime: n.time, startDur: n.dur, startMidi: n.midi,
        };
        this.draw();
        e.preventDefault();
        return;
      }
    }

    let snappedTime = this.app.engine.snapTime(time);
    if (snappedTime > this.clip.duration - 0.05) snappedTime = Math.max(0, this.clip.duration - 0.5);
    const newNote = {
      time: Math.max(0, snappedTime),
      dur: Math.min(this.app.engine.beatDuration(), this.clip.duration - snappedTime),
      midi: Math.max(0, Math.min(127, midi)),
      velocity: 0.7,
    };
    this.clip.notes.push(newNote);
    this.selectedNoteIdx = this.clip.notes.length - 1;
    this.dragging = {
      mode: 'move',
      startX: e.clientX, startY: e.clientY,
      startTime: newNote.time, startDur: newNote.dur, startMidi: newNote.midi,
    };
    this.draw();
    e.preventDefault();
  }

  _mouseMove(e) {
    if (!this.dragging) return;
    const note = this.clip.notes[this.selectedNoteIdx];
    if (!note) return;
    const rect = this.canvas.getBoundingClientRect();
    const labelW = 48;
    const range = this.maxMidi - this.minMidi;
    const rowH = rect.height / range;
    const dx = e.clientX - this.dragging.startX;
    const dy = e.clientY - this.dragging.startY;
    const dt = (dx / (rect.width - labelW)) * this.clip.duration;
    const dMidi = -Math.round(dy / rowH);

    if (this.dragging.mode === 'move') {
      let newTime = this.dragging.startTime + dt;
      newTime = this.app.engine.snapTime(newTime);
      newTime = Math.max(0, Math.min(this.clip.duration - note.dur, newTime));
      note.time = newTime;
      note.midi = Math.max(0, Math.min(127, this.dragging.startMidi + dMidi));
    } else if (this.dragging.mode === 'resize') {
      let newDur = this.dragging.startDur + dt;
      newDur = this.app.engine.snapTime(note.time + newDur) - note.time;
      newDur = Math.max(0.05, Math.min(this.clip.duration - note.time, newDur));
      note.dur = newDur;
    }
    this.draw();
  }

  _mouseUp() {
    this.dragging = null;
  }

  handleKey(e) {
    if (e.code === 'Escape') { e.preventDefault(); this.close(); return; }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this.selectedNoteIdx >= 0) {
      e.preventDefault();
      this.clip.notes.splice(this.selectedNoteIdx, 1);
      this.selectedNoteIdx = -1;
      this.draw();
    }
  }
}
