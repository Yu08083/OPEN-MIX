import {
  analyzePitchCurve, correctPitch, correctPitchWithNotes, correctPitchRange,
  correctPitchWithCachedCurve,
  segmentPitchCurve, snapMidiToScale,
  getScaleOptions, getKeyOptions,
  freqToMidi, midiToFreq, midiToNoteName,
  setScratchCtx,
} from './pitch.js';
import { escapeHtml } from './utils.js';

export class PitchModal {
  constructor(app) {
    this.app = app;
    this.backdrop = document.getElementById('pitch-modal-backdrop');
    this.modal = document.getElementById('pitch-modal');
    this.track = null;
    this.clip = null;
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
    this.originalBuffer = null;
    this.applied = false;
    this.rendering = false;
    this.rerunRender = false;
    this.renderTimer = null;
    this.livePreview = true;
    this.backdrop.addEventListener('click', e => { if (e.target === this.backdrop) this.close(); });
  }

  async openForClip(track, clip) {
    if (!clip || clip.type !== 'audio') return;
    this.app.engine.ensure();
    setScratchCtx(this.app.engine.ctx);
    this.track = track; this.clip = clip;
    this.curve = null; this.notes = []; this.selectedNoteIdx = -1;
    this.rangeMode = false;
    this.applied = false;
    this.originalBuffer = this._cloneBuffer(clip.buffer);
    this.render();
    this.backdrop.classList.add('active');
    await this.analyze();
  }
  async openForClipRange(track, clip, start, end) {
    if (!clip || clip.type !== 'audio') return;
    this.app.engine.ensure();
    setScratchCtx(this.app.engine.ctx);
    this.track = track; this.clip = clip;
    this.curve = null; this.notes = []; this.selectedNoteIdx = -1;
    this.rangeMode = true;
    this.rangeStart = start; this.rangeEnd = end;
    this.applied = false;
    this.originalBuffer = this._cloneBuffer(clip.buffer);
    this.render();
    this.backdrop.classList.add('active');
    await this.analyze();
  }
  close() {
    if (!this.applied && this.originalBuffer && this.clip) {
      this.clip.buffer = this.originalBuffer;
      this.clip.peaks = null;
      this.app.drawClip(this.clip);
    }
    if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
    this.backdrop.classList.remove('active');
    this.track = null; this.clip = null;
    this.originalBuffer = null;
  }

  _cloneBuffer(buf) {
    const ctx = this.app.engine.ctx;
    if (!ctx) throw new Error('Audio context not initialized');
    const copy = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      copy.copyToChannel(buf.getChannelData(c), c);
    }
    return copy;
  }

  render() {
    if (!this.clip) return;
    const scales = getScaleOptions();
    const keys = getKeyOptions();
    this.modal.innerHTML = `
      <div class="modal-header">
        <div>
          <div class="modal-title">ピッチ補正${this.rangeMode ? '（選択範囲のみ）' : ''}</div>
          <div class="modal-subtitle">${escapeHtml(this.clip.name)}${this.rangeMode ? ` · ${this.rangeStart.toFixed(2)}s 〜 ${this.rangeEnd.toFixed(2)}s` : ''}</div>
        </div>
        <button class="modal-close" id="pitch-close">×</button>
      </div>
      <div class="pitch-transport">
        <button class="t-btn" id="pitch-play">▶ 再生</button>
        <button class="t-btn" id="pitch-pause">⏸ 一時停止</button>
        <button class="t-btn" id="pitch-stop">■ 停止</button>
        <label class="pitch-live-toggle">
          <input type="checkbox" id="pitch-live-checkbox" ${this.livePreview ? 'checked' : ''}>
          <span>編集と同時にプレビュー</span>
        </label>
        <span class="pitch-render-status" id="pitch-render-status"></span>
      </div>
      <div class="modal-section">
        <div class="modal-section-label">音程エディタ</div>
        <div class="pitch-canvas-wrap"><canvas class="pitch-canvas" id="pitch-canvas"></canvas></div>
        <div class="pitch-help">青いノートを<strong>上下にドラッグ</strong>して音程変更。Shift+ドラッグでセント微調整。離した瞬間にプレビュー更新されるので、再生したまま編集できる。</div>
        <div id="pitch-note-info-area"></div>
      </div>
      <div class="modal-section">
        <div class="modal-grid">
          <div><div class="modal-section-label">スケール</div>
            <select class="select" id="pitch-scale">${scales.map(s => `<option value="${s.id}" ${this.scale===s.id?'selected':''}>${s.name}</option>`).join('')}</select></div>
          <div><div class="modal-section-label">キー</div>
            <select class="select" id="pitch-key">${keys.map(k => `<option value="${k.id}" ${this.key===k.id?'selected':''}>${k.name}</option>`).join('')}</select></div>
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
      <div class="modal-footer">
        <button class="t-btn" id="pitch-snap-all">全ノートをスケールに再スナップ</button>
        <button class="t-btn" id="pitch-reanalyze">再解析</button>
        <button class="t-btn" id="pitch-revert">破棄して閉じる</button>
        <button class="t-btn primary" id="pitch-apply">適用して閉じる</button>
      </div>
    `;
    this.canvas = document.getElementById('pitch-canvas');
    this.noteInfoArea = document.getElementById('pitch-note-info-area');
    document.getElementById('pitch-close').addEventListener('click', () => this.close());
    document.getElementById('pitch-revert').addEventListener('click', () => this.close());
    document.getElementById('pitch-play').addEventListener('click', () => this.app.engine.play());
    document.getElementById('pitch-pause').addEventListener('click', () => this.app.engine.pause());
    document.getElementById('pitch-stop').addEventListener('click', () => this.app.engine.stop());
    document.getElementById('pitch-live-checkbox').addEventListener('change', e => {
      this.livePreview = e.target.checked;
    });
    document.getElementById('pitch-scale').addEventListener('change', e => {
      this.scale = e.target.value; this.resnap(); this.drawCanvas(); this.renderNoteInfo();
      this.schedulePreviewRender();
    });
    document.getElementById('pitch-key').addEventListener('change', e => {
      this.key = parseInt(e.target.value); this.resnap(); this.drawCanvas(); this.renderNoteInfo();
      this.schedulePreviewRender();
    });
    document.getElementById('pitch-strength').addEventListener('input', e => {
      this.strength = parseFloat(e.target.value);
      document.getElementById('pitch-strength-val').textContent = Math.round(this.strength * 100) + '%';
    });
    document.getElementById('pitch-strength').addEventListener('change', () => {
      this.schedulePreviewRender();
    });
    document.getElementById('pitch-reanalyze').addEventListener('click', () => this.analyze());
    document.getElementById('pitch-apply').addEventListener('click', () => this.applyAndClose());
    document.getElementById('pitch-snap-all').addEventListener('click', () => {
      this.notes.forEach(n => { n.targetMidi = snapMidiToScale(n.detectedMidi, this.key, this.scale); n.manuallyEdited = false; });
      this.drawCanvas(); this.renderNoteInfo();
      this.schedulePreviewRender();
    });
    this.canvas.addEventListener('mousedown', e => this.onMouseDown(e));
    window.addEventListener('mousemove', e => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
    this.renderNoteInfo();
  }

  resnap() {
    this.notes.forEach(n => { if (!n.manuallyEdited) n.targetMidi = snapMidiToScale(n.detectedMidi, this.key, this.scale); });
  }

  async analyze() {
    if (!this.clip || !this.clip.buffer) return;
    this.app._showOverlay('ピッチ解析中…');
    try {
      const subBuf = this._getSubBuffer();
      this.curve = await analyzePitchCurve(subBuf, p => { document.getElementById('overlay-fill').style.width = (p * 100) + '%'; });
      this.notes = segmentPitchCurve(this.curve);
      this.resnap();
      this._computeBounds();
      this.drawCanvas(); this.renderNoteInfo();
    } catch (err) { alert('解析失敗: ' + err.message); }
    this.app._hideOverlay();
  }

  _getSubBuffer() {
    const c = this.clip;
    const sr = c.buffer.sampleRate;
    const startSec = this.rangeMode ? this.rangeStart : 0;
    const endSec = this.rangeMode ? this.rangeEnd : c.duration;
    const absStart = c.trimStart + startSec;
    const absEnd = c.trimStart + endSec;
    const startS = Math.max(0, Math.floor(absStart * sr));
    const endS = Math.min(c.buffer.length, Math.floor(absEnd * sr));
    const len = endS - startS;
    if (len <= 0) throw new Error('解析対象が空です（クリップが短すぎる可能性）');
    const ctx = this.app.engine.ctx;
    if (!ctx) throw new Error('オーディオコンテキスト未初期化');
    const sub = ctx.createBuffer(c.buffer.numberOfChannels, len, sr);
    for (let ch = 0; ch < c.buffer.numberOfChannels; ch++) {
      const src = c.buffer.getChannelData(ch);
      const dst = sub.getChannelData(ch);
      for (let i = 0; i < len; i++) dst[i] = src[startS + i];
    }
    return sub;
  }

  _computeBounds() {
    if (this.notes.length === 0) { this.minMidi = 48; this.maxMidi = 84; }
    else {
      let lo = Infinity, hi = -Infinity;
      this.notes.forEach(n => { const a = Math.min(n.detectedMidi, n.targetMidi); const b = Math.max(n.detectedMidi, n.targetMidi); if (a < lo) lo = a; if (b > hi) hi = b; });
      this.minMidi = Math.floor(lo - 4); this.maxMidi = Math.ceil(hi + 4);
      if (this.maxMidi - this.minMidi < 18) { const c = (this.minMidi + this.maxMidi) / 2; this.minMidi = Math.floor(c - 9); this.maxMidi = Math.ceil(c + 9); }
    }
    this.totalTime = this.rangeMode ? (this.rangeEnd - this.rangeStart) : this.clip.duration;
  }

  drawCanvas() {
    const canvas = this.canvas; if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const wrap = canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    const rowH = h / (this.maxMidi - this.minMidi);
    for (let m = this.minMidi; m < this.maxMidi; m++) {
      const y = h - (m - this.minMidi + 1) * rowH;
      const cls = ((m % 12) + 12) % 12;
      const isBlack = [1,3,6,8,10].indexOf(cls) >= 0;
      ctx.fillStyle = isBlack ? 'rgba(0,0,0,0.05)' : 'transparent';
      ctx.fillRect(40, y, w - 40, rowH);
      ctx.strokeStyle = cls === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.05)';
      ctx.lineWidth = cls === 0 ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(w, y); ctx.stroke();
      if (rowH > 14 || cls === 0) {
        ctx.fillStyle = cls === 0 ? '#1A1A1A' : '#6A6660';
        ctx.font = (cls === 0 ? '600 ' : '500 ') + '10px "Noto Sans JP", sans-serif';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(midiToNoteName(m), 36, y + rowH / 2);
      }
    }
    if (this.curve) {
      ctx.fillStyle = 'rgba(90,85,76,0.45)';
      for (const p of this.curve) {
        if (p.freq <= 0) continue;
        const midi = freqToMidi(p.freq);
        const x = 40 + (p.time / this.totalTime) * (w - 40);
        const y = h - ((midi - this.minMidi) / (this.maxMidi - this.minMidi)) * h;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
    this.notes.forEach((note, idx) => {
      const x1 = 40 + (note.startTime / this.totalTime) * (w - 40);
      const x2 = 40 + (note.endTime / this.totalTime) * (w - 40);
      const wid = Math.max(3, x2 - x1);
      const yDet = h - ((note.detectedMidi - this.minMidi) / (this.maxMidi - this.minMidi)) * h;
      ctx.fillStyle = 'rgba(90,85,76,0.22)';
      ctx.fillRect(x1, yDet - rowH/2, wid, rowH);
      const yTgt = h - ((note.targetMidi - this.minMidi + 0.5) / (this.maxMidi - this.minMidi)) * h;
      const isSel = idx === this.selectedNoteIdx;
      ctx.fillStyle = isSel ? 'rgba(5,80,194,0.85)' : (note.manuallyEdited ? 'rgba(5,80,194,0.65)' : 'rgba(5,80,194,0.50)');
      ctx.fillRect(x1, yTgt - rowH/2 + 1, wid, rowH - 2);
      ctx.strokeStyle = isSel ? '#043E96' : 'rgba(5,80,194,0.9)';
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.strokeRect(x1 + 0.5, yTgt - rowH/2 + 1, wid - 1, rowH - 2);
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
    const cents = ((note.detectedMidi - note.targetMidi) * 100).toFixed(0);
    const dur = (note.endTime - note.startTime).toFixed(2);
    this.noteInfoArea.innerHTML = `
      <div class="pitch-note-info">
        <span>選択ノート <strong>#${this.selectedNoteIdx + 1}</strong></span>
        <span>長さ <strong>${dur}s</strong></span>
        <span>検出 <span class="detected"><strong>${midiToNoteName(Math.round(note.detectedMidi))}</strong> (${cents}¢)</span></span>
        <span>目標 <span class="target"><strong>${midiToNoteName(Math.round(note.targetMidi))}</strong></span></span>
        <button id="pitch-reset-note">この音を自動に戻す</button>
      </div>
    `;
    const rb = document.getElementById('pitch-reset-note');
    if (rb) rb.addEventListener('click', () => {
      const n = this.notes[this.selectedNoteIdx];
      n.targetMidi = snapMidiToScale(n.detectedMidi, this.key, this.scale);
      n.manuallyEdited = false;
      this.drawCanvas(); this.renderNoteInfo();
    });
  }

  onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < 40) return;
    const t = ((x - 40) / (rect.width - 40)) * this.totalTime;
    let foundIdx = -1;
    for (let i = 0; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (t >= n.startTime && t <= n.endTime) {
        const rowH = rect.height / (this.maxMidi - this.minMidi);
        const yTgt = rect.height - ((n.targetMidi - this.minMidi + 0.5) / (this.maxMidi - this.minMidi)) * rect.height;
        if (Math.abs(y - yTgt) < rowH * 1.5) { foundIdx = i; break; }
      }
    }
    if (foundIdx === -1) { this.selectedNoteIdx = -1; this.drawCanvas(); this.renderNoteInfo(); return; }
    this.selectedNoteIdx = foundIdx;
    this.dragging = true;
    this.dragStartY = e.clientY;
    this.dragStartMidi = this.notes[foundIdx].targetMidi;
    this.drawCanvas(); this.renderNoteInfo();
    e.preventDefault();
  }
  onMouseMove(e) {
    if (!this.dragging) return;
    const rect = this.canvas.getBoundingClientRect();
    const dy = e.clientY - this.dragStartY;
    const range = this.maxMidi - this.minMidi;
    const delta = -(dy / rect.height) * range;
    const note = this.notes[this.selectedNoteIdx]; if (!note) return;
    let newMidi = this.dragStartMidi + delta;
    if (!e.shiftKey) newMidi = Math.round(newMidi);
    else newMidi = Math.round(newMidi * 100) / 100;
    newMidi = Math.max(this.minMidi, Math.min(this.maxMidi - 1, newMidi));
    note.targetMidi = newMidi;
    note.manuallyEdited = true;
    this.drawCanvas(); this.renderNoteInfo();
  }
  onMouseUp() {
    if (this.dragging) {
      this.dragging = false;
      this.schedulePreviewRender();
    }
  }

  schedulePreviewRender() {
    if (!this.livePreview) return;
    if (!this.curve || this.notes.length === 0) return;
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.renderPreview();
    }, 150);
  }

  async renderPreview() {
    if (!this.clip || !this.originalBuffer || !this.curve) return;
    if (this.rendering) { this.rerunRender = true; return; }
    this.rendering = true;
    this._setRenderStatus('プレビュー更新中…');
    try {
      const src = this._cloneBuffer(this.originalBuffer);
      if (this.rangeMode) {
        await this._renderRangePreview(src);
      } else {
        const result = await correctPitchWithCachedCurve(src, this.curve, this.notes, { strength: this.strength });
        this.clip.buffer = result;
      }
      this.clip.peaks = null;
      if (this.clip.el) this.app.drawClip(this.clip);
    } catch (err) {
      console.error('preview failed', err);
      this._setRenderStatus('プレビュー失敗');
      setTimeout(() => this._setRenderStatus(''), 2000);
    }
    this.rendering = false;
    if (this.rerunRender) {
      this.rerunRender = false;
      this._setRenderStatus('');
      this.renderPreview();
    } else {
      this._setRenderStatus('✓ プレビュー反映');
      setTimeout(() => { if (!this.rendering) this._setRenderStatus(''); }, 1500);
    }
  }

  async _renderRangePreview(srcBuffer) {
    const c = this.clip;
    const sr = srcBuffer.sampleRate;
    const startSec = this.rangeStart;
    const endSec = this.rangeEnd;
    const absStart = c.trimStart + startSec;
    const absEnd = c.trimStart + endSec;
    const startS = Math.max(0, Math.floor(absStart * sr));
    const endS = Math.min(srcBuffer.length, Math.floor(absEnd * sr));
    const rangeLen = endS - startS;
    if (rangeLen < 2048) { this.clip.buffer = srcBuffer; return; }
    const padS = Math.min(4096, startS, srcBuffer.length - endS);
    const subLen = rangeLen + padS * 2;
    const subStart = startS - padS;
    const ctx = this.app.engine.ctx;
    const sub = ctx.createBuffer(srcBuffer.numberOfChannels, subLen, sr);
    for (let ch = 0; ch < srcBuffer.numberOfChannels; ch++) {
      const s = srcBuffer.getChannelData(ch);
      const d = sub.getChannelData(ch);
      for (let i = 0; i < subLen; i++) d[i] = s[subStart + i];
    }
    const subCurve = this.curve.map(p => ({ time: p.time + padS / sr, freq: p.freq }));
    const subNotes = this.notes.map(n => ({
      startTime: n.startTime + padS / sr,
      endTime: n.endTime + padS / sr,
      targetMidi: n.targetMidi,
      detectedMidi: n.detectedMidi,
    }));
    const corrected = await correctPitchWithCachedCurve(sub, subCurve, subNotes, { strength: this.strength });
    const fadeLen = Math.min(512, Math.floor(rangeLen / 8), padS);
    for (let ch = 0; ch < srcBuffer.numberOfChannels; ch++) {
      const cs = corrected.getChannelData(ch);
      const ds = srcBuffer.getChannelData(ch);
      for (let i = 0; i < rangeLen; i++) {
        const ti = startS + i;
        const si = padS + i;
        let mix = 1;
        if (fadeLen > 0) {
          if (i < fadeLen) mix = i / fadeLen;
          else if (i >= rangeLen - fadeLen) mix = (rangeLen - i) / fadeLen;
        }
        ds[ti] = cs[si] * mix + ds[ti] * (1 - mix);
      }
    }
    this.clip.buffer = srcBuffer;
  }

  _setRenderStatus(msg) {
    const el = document.getElementById('pitch-render-status');
    if (el) el.textContent = msg;
  }

  async applyAndClose() {
    if (!this.clip || !this.originalBuffer) { this.close(); return; }
    if (this.rendering) {
      this._setRenderStatus('レンダー完了待ち…');
      while (this.rendering) await new Promise(r => setTimeout(r, 100));
    }
    if (this.notes.length > 0 && this.curve) {
      const stillOriginal = this.clip.buffer === this.originalBuffer;
      if (stillOriginal) {
        this.app._showOverlay('ピッチ補正適用中…');
        try { await this.renderPreview(); } catch (e) {}
        this.app._hideOverlay();
      }
    }
    this.applied = true;
    this.clip.pitchCorrected = true;
    this.close();
  }

}
