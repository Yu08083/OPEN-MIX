import {
  analyzePitchCurve, correctPitch, correctPitchWithNotes,
  segmentPitchCurve, snapMidiToScale,
  getScaleOptions, getKeyOptions,
  freqToMidi, midiToFreq, midiToNoteName,
} from './pitch.js';
import { escapeHtml } from './utils.js';

export class PitchModal {
  constructor(app) {
    this.app = app;
    this.backdrop = document.getElementById('pitch-modal-backdrop');
    this.modal = document.getElementById('pitch-modal');
    this.track = null;
    this.curve = null;
    this.notes = [];
    this.scale = 'chromatic';
    this.key = 0;
    this.strength = 1.0;
    this.rangeMode = false;
    this.rangeStart = 0;
    this.rangeEnd = 0;
    this.selectedNoteIdx = -1;
    this.dragging = false;
    this.dragStartY = 0;
    this.dragStartMidi = 0;
    this.minMidi = 48;
    this.maxMidi = 84;
    this.totalTime = 1;
    this.backdrop.addEventListener('click', e => {
      if (e.target === this.backdrop) this.close();
    });
  }

  async open(track) {
    this.track = track;
    this.curve = null;
    this.notes = [];
    this.selectedNoteIdx = -1;
    this.rangeMode = false;
    this.render();
    this.backdrop.classList.add('active');
    await this.analyze();
  }

  async openForRange(track, start, end) {
    this.track = track;
    this.curve = null;
    this.notes = [];
    this.selectedNoteIdx = -1;
    this.rangeMode = true;
    this.rangeStart = start;
    this.rangeEnd = end;
    this.render();
    this.backdrop.classList.add('active');
    await this.analyze();
  }

  close() {
    this.backdrop.classList.remove('active');
    this.track = null;
  }

  render() {
    if (!this.track) return;
    const scales = getScaleOptions();
    const keys = getKeyOptions();
    this.modal.innerHTML = `
      <div class="modal-header">
        <div>
          <div class="modal-title">ピッチ補正${this.rangeMode ? '（選択範囲のみ）' : ''}</div>
          <div class="modal-subtitle">${escapeHtml(this.track.name)}${this.rangeMode ? ` · ${this.rangeStart.toFixed(2)}s 〜 ${this.rangeEnd.toFixed(2)}s` : ''}</div>
        </div>
        <button class="modal-close" id="pitch-close">×</button>
      </div>

      <div class="modal-section">
        <div class="modal-section-label">音程エディタ</div>
        <div class="pitch-canvas-wrap">
          <canvas class="pitch-canvas" id="pitch-canvas"></canvas>
        </div>
        <div class="pitch-help">
          青いノートを<strong>上下にドラッグ</strong>して音程を変えられます。Shift+ドラッグでセント単位の微調整。クリックで選択。
        </div>
        <div id="pitch-note-info-area"></div>
      </div>

      <div class="modal-section">
        <div class="modal-grid">
          <div>
            <div class="modal-section-label">スケール</div>
            <select class="select" id="pitch-scale">
              ${scales.map(s => `<option value="${s.id}" ${this.scale===s.id?'selected':''}>${s.name}</option>`).join('')}
            </select>
          </div>
          <div>
            <div class="modal-section-label">キー</div>
            <select class="select" id="pitch-key">
              ${keys.map(k => `<option value="${k.id}" ${this.key===k.id?'selected':''}>${k.name}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-label">補正の強さ</div>
        <div class="modal-control">
          <span>強度</span>
          <input type="range" class="slider" id="pitch-strength" min="0" max="1" step="0.001" value="${this.strength}">
          <span id="pitch-strength-val">${Math.round(this.strength*100)}%</span>
        </div>
      </div>

      <div class="pitch-warn">
        位相ボコーダ方式。強くかけるとロボット感が出ます。スケール変更時、手動で動かしてないノートは自動で再スナップされます。
      </div>

      <div class="modal-footer">
        <button class="t-btn" id="pitch-snap-all">全ノートをスケールに再スナップ</button>
        <button class="t-btn" id="pitch-reanalyze">再解析</button>
        <button class="t-btn" id="pitch-cancel">キャンセル</button>
        <button class="t-btn primary" id="pitch-apply">適用</button>
      </div>
    `;
    this.canvas = document.getElementById('pitch-canvas');
    this.noteInfoArea = document.getElementById('pitch-note-info-area');
    this.bindEvents();
    this.renderNoteInfo();
  }

  bindEvents() {
    document.getElementById('pitch-close').addEventListener('click', () => this.close());
    document.getElementById('pitch-cancel').addEventListener('click', () => this.close());
    document.getElementById('pitch-scale').addEventListener('change', e => {
      this.scale = e.target.value;
      this.resnapNonManualNotes();
      this.drawCanvas();
      this.renderNoteInfo();
    });
    document.getElementById('pitch-key').addEventListener('change', e => {
      this.key = parseInt(e.target.value);
      this.resnapNonManualNotes();
      this.drawCanvas();
      this.renderNoteInfo();
    });
    document.getElementById('pitch-strength').addEventListener('input', e => {
      this.strength = parseFloat(e.target.value);
      document.getElementById('pitch-strength-val').textContent = Math.round(this.strength * 100) + '%';
    });
    document.getElementById('pitch-reanalyze').addEventListener('click', () => this.analyze());
    document.getElementById('pitch-apply').addEventListener('click', () => this.apply());
    document.getElementById('pitch-snap-all').addEventListener('click', () => {
      this.notes.forEach(n => {
        n.targetMidi = snapMidiToScale(n.detectedMidi, this.key, this.scale);
        n.manuallyEdited = false;
      });
      this.drawCanvas();
      this.renderNoteInfo();
    });

    this.canvas.addEventListener('mousedown', e => this.onCanvasMouseDown(e));
    window.addEventListener('mousemove', this._mouseMoveHandler = e => this.onCanvasMouseMove(e));
    window.addEventListener('mouseup', this._mouseUpHandler = e => this.onCanvasMouseUp(e));
  }

  resnapNonManualNotes() {
    this.notes.forEach(n => {
      if (!n.manuallyEdited) {
        n.targetMidi = snapMidiToScale(n.detectedMidi, this.key, this.scale);
      }
    });
  }

  async analyze() {
    if (!this.track || !this.track.buffer) return;
    this.app._showOverlay('ピッチ解析中…');
    try {
      this.curve = await analyzePitchCurve(this.track.buffer, p => {
        document.getElementById('overlay-fill').style.width = (p * 100) + '%';
      });
      const filtered = this.rangeMode
        ? this.curve.filter(p => p.time >= this.rangeStart && p.time <= this.rangeEnd)
        : this.curve;
      this.notes = segmentPitchCurve(filtered);
      this.resnapNonManualNotes();
      this.computePitchBounds();
      this.drawCanvas();
      this.renderNoteInfo();
    } catch (err) {
      alert('解析失敗: ' + err.message);
    }
    this.app._hideOverlay();
  }

  computePitchBounds() {
    if (this.notes.length === 0) {
      this.minMidi = 48;
      this.maxMidi = 84;
    } else {
      let lo = Infinity, hi = -Infinity;
      this.notes.forEach(n => {
        const a = Math.min(n.detectedMidi, n.targetMidi);
        const b = Math.max(n.detectedMidi, n.targetMidi);
        if (a < lo) lo = a;
        if (b > hi) hi = b;
      });
      this.minMidi = Math.floor(lo - 4);
      this.maxMidi = Math.ceil(hi + 4);
      if (this.maxMidi - this.minMidi < 18) {
        const center = (this.minMidi + this.maxMidi) / 2;
        this.minMidi = Math.floor(center - 9);
        this.maxMidi = Math.ceil(center + 9);
      }
    }
    if (this.rangeMode) {
      this.totalTime = this.rangeEnd - this.rangeStart;
    } else {
      this.totalTime = this.track.buffer.duration;
    }
  }

  drawCanvas() {
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

    const rowHeight = h / (this.maxMidi - this.minMidi);
    for (let m = this.minMidi; m < this.maxMidi; m++) {
      const y = h - (m - this.minMidi + 1) * rowHeight;
      const cls = ((m % 12) + 12) % 12;
      const isBlack = [1, 3, 6, 8, 10].indexOf(cls) >= 0;
      ctx.fillStyle = isBlack ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.0)';
      ctx.fillRect(40, y, w - 40, rowHeight);
      ctx.strokeStyle = cls === 0 ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.05)';
      ctx.lineWidth = cls === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      if (rowHeight > 14 || cls === 0) {
        ctx.fillStyle = cls === 0 ? '#1A1A1A' : '#6A6660';
        ctx.font = (cls === 0 ? '600 ' : '500 ') + '10px "Noto Sans JP", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(midiToNoteName(m), 36, y + rowHeight / 2);
      }
    }

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.moveTo(40, 0);
    ctx.lineTo(40, h);
    ctx.stroke();

    if (this.curve) {
      ctx.fillStyle = 'rgba(90, 85, 76, 0.45)';
      const tStart = this.rangeMode ? this.rangeStart : 0;
      const tEnd = this.rangeMode ? this.rangeEnd : this.track.buffer.duration;
      for (const p of this.curve) {
        if (p.freq <= 0) continue;
        if (p.time < tStart || p.time > tEnd) continue;
        const midi = freqToMidi(p.freq);
        const x = 40 + ((p.time - tStart) / this.totalTime) * (w - 40);
        const y = h - ((midi - this.minMidi) / (this.maxMidi - this.minMidi)) * h;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    this.notes.forEach((note, idx) => {
      const tStart = this.rangeMode ? this.rangeStart : 0;
      const x1 = 40 + ((note.startTime - tStart) / this.totalTime) * (w - 40);
      const x2 = 40 + ((note.endTime - tStart) / this.totalTime) * (w - 40);
      const wid = Math.max(3, x2 - x1);

      const yDet = h - ((note.detectedMidi - this.minMidi) / (this.maxMidi - this.minMidi)) * h;
      ctx.fillStyle = 'rgba(90, 85, 76, 0.22)';
      ctx.fillRect(x1, yDet - rowHeight / 2, wid, rowHeight);

      const yTgt = h - ((note.targetMidi - this.minMidi + 0.5) / (this.maxMidi - this.minMidi)) * h;
      const isSelected = idx === this.selectedNoteIdx;
      ctx.fillStyle = isSelected
        ? 'rgba(5, 80, 194, 0.85)'
        : (note.manuallyEdited ? 'rgba(5, 80, 194, 0.65)' : 'rgba(5, 80, 194, 0.50)');
      ctx.fillRect(x1, yTgt - rowHeight / 2 + 1, wid, rowHeight - 2);
      ctx.strokeStyle = isSelected ? '#043E96' : 'rgba(5, 80, 194, 0.9)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(x1 + 0.5, yTgt - rowHeight / 2 + 1, wid - 1, rowHeight - 2);

      if (note.manuallyEdited) {
        ctx.fillStyle = '#FAF8F2';
        ctx.font = '600 9px "Noto Sans JP", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (wid > 16) ctx.fillText('●', x1 + wid - 6, yTgt);
      }
    });
  }

  renderNoteInfo() {
    if (!this.noteInfoArea) return;
    if (this.notes.length === 0) {
      this.noteInfoArea.innerHTML = `<div class="pitch-note-info-empty">音程ノートが検出されませんでした</div>`;
      return;
    }
    if (this.selectedNoteIdx < 0) {
      this.noteInfoArea.innerHTML = `<div class="pitch-note-info-empty">${this.notes.length} 個のノートを検出。クリックで選択、ドラッグで音程変更。</div>`;
      return;
    }
    const note = this.notes[this.selectedNoteIdx];
    const detectedCents = ((note.detectedMidi - note.targetMidi) * 100).toFixed(0);
    const dur = (note.endTime - note.startTime).toFixed(2);
    this.noteInfoArea.innerHTML = `
      <div class="pitch-note-info">
        <span>選択ノート <strong>#${this.selectedNoteIdx + 1}</strong></span>
        <span>長さ <strong>${dur}s</strong></span>
        <span>検出 <span class="detected"><strong>${midiToNoteName(Math.round(note.detectedMidi))}</strong> (${detectedCents}¢)</span></span>
        <span>目標 <span class="target"><strong>${midiToNoteName(Math.round(note.targetMidi))}</strong></span></span>
        <button id="pitch-reset-note">この音を自動に戻す</button>
      </div>
    `;
    const rb = document.getElementById('pitch-reset-note');
    if (rb) rb.addEventListener('click', () => {
      const n = this.notes[this.selectedNoteIdx];
      n.targetMidi = snapMidiToScale(n.detectedMidi, this.key, this.scale);
      n.manuallyEdited = false;
      this.drawCanvas();
      this.renderNoteInfo();
    });
  }

  onCanvasMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 40) return;
    const tStart = this.rangeMode ? this.rangeStart : 0;
    const t = tStart + ((x - 40) / (rect.width - 40)) * this.totalTime;

    let foundIdx = -1;
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (t >= n.startTime && t <= n.endTime) {
        const rowH = rect.height / (this.maxMidi - this.minMidi);
        const yTgt = rect.height - ((n.targetMidi - this.minMidi + 0.5) / (this.maxMidi - this.minMidi)) * rect.height;
        if (Math.abs(y - yTgt) < rowH * 1.5) { foundIdx = i; break; }
      }
    }
    if (foundIdx === -1) {
      this.selectedNoteIdx = -1;
      this.drawCanvas();
      this.renderNoteInfo();
      return;
    }
    this.selectedNoteIdx = foundIdx;
    this.dragging = true;
    this.dragStartY = e.clientY;
    this.dragStartMidi = this.notes[foundIdx].targetMidi;
    this.canvas.classList.add('dragging');
    this.drawCanvas();
    this.renderNoteInfo();
    e.preventDefault();
  }

  onCanvasMouseMove(e) {
    if (!this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const dy = e.clientY - this.dragStartY;
    const range = this.maxMidi - this.minMidi;
    const semitoneDelta = -(dy / rect.height) * range;
    const note = this.notes[this.selectedNoteIdx];
    if (!note) return;
    let newMidi = this.dragStartMidi + semitoneDelta;
    if (!e.shiftKey) newMidi = Math.round(newMidi);
    else newMidi = Math.round(newMidi * 100) / 100;
    newMidi = Math.max(this.minMidi, Math.min(this.maxMidi - 1, newMidi));
    note.targetMidi = newMidi;
    note.manuallyEdited = true;
    this.drawCanvas();
    this.renderNoteInfo();
  }

  onCanvasMouseUp() {
    if (this.dragging) {
      this.dragging = false;
      this.canvas.classList.remove('dragging');
    }
  }

  async apply() {
    if (!this.track || !this.track.buffer) return;
    if (this.notes.length === 0) {
      alert('ピッチ補正対象のノートがありません。');
      return;
    }
    const target = this.rangeMode
      ? `「${this.track.name}」の選択範囲（${this.rangeStart.toFixed(2)}〜${this.rangeEnd.toFixed(2)}s）`
      : `「${this.track.name}」全体`;
    if (!confirm(`${target}にピッチ補正を適用します。元の音声データは書き換えられます。続けますか？`)) return;

    this.app._showOverlay('ピッチ補正適用中…');
    try {
      if (this.rangeMode) {
        await this.track.applyPitchToRangeWithNotes(
          this.rangeStart, this.rangeEnd,
          this.notes,
          { strength: this.strength },
          p => { document.getElementById('overlay-fill').style.width = (p * 100) + '%'; }
        );
      } else {
        const newBuf = await correctPitchWithNotes(this.track.buffer, this.notes, {
          strength: this.strength,
        }, p => {
          document.getElementById('overlay-fill').style.width = (p * 100) + '%';
        });
        this.track.replaceBuffer(newBuf);
      }
      this.track.pitchCorrected = true;
      this.app.drawWave(this.track);
      this.app.refreshTrackPitchBadge(this.track);
      this.close();
    } catch (err) {
      alert('適用失敗: ' + err.message);
    }
    this.app._hideOverlay();
  }
}
