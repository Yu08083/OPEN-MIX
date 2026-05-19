import { analyzePitchCurve, correctPitch, getScaleOptions, getKeyOptions, freqToMidi } from './pitch.js';
import { freqToNoteName, escapeHtml } from './utils.js';

export class PitchModal {
  constructor(app) {
    this.app = app;
    this.backdrop = document.getElementById('pitch-modal-backdrop');
    this.modal = document.getElementById('pitch-modal');
    this.track = null;
    this.curve = null;
    this.scale = 'chromatic';
    this.key = 0;
    this.strength = 1.0;
    this.rangeMode = false;
    this.rangeStart = 0;
    this.rangeEnd = 0;
    this.backdrop.addEventListener('click', e => {
      if (e.target === this.backdrop) this.close();
    });
  }

  async open(track) {
    this.track = track;
    this.curve = null;
    this.rangeMode = false;
    this.render();
    this.backdrop.classList.add('active');
    await this.analyze();
  }

  async openForRange(track, start, end) {
    this.track = track;
    this.curve = null;
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
        <div class="modal-section-label">検出ピッチ</div>
        <div class="pitch-canvas-wrap">
          <canvas class="pitch-canvas" id="pitch-canvas"></canvas>
        </div>
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
        <div class="modal-section-label">補正量</div>
        <div class="modal-control">
          <span>強さ</span>
          <input type="range" class="slider" id="pitch-strength" min="0" max="1" step="0.01" value="${this.strength}">
          <span id="pitch-strength-val">${Math.round(this.strength*100)}%</span>
        </div>
      </div>

      <div class="pitch-warn">
        位相ボコーダ方式。子音やビブラートに弱く、強くかけるとロボット感が出ます。微調整向き。
      </div>

      <div class="modal-footer">
        <button class="t-btn" id="pitch-reanalyze">再解析</button>
        <button class="t-btn" id="pitch-cancel">キャンセル</button>
        <button class="t-btn primary" id="pitch-apply">適用</button>
      </div>
    `;

    this.canvas = document.getElementById('pitch-canvas');
    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('pitch-close').addEventListener('click', () => this.close());
    document.getElementById('pitch-cancel').addEventListener('click', () => this.close());
    document.getElementById('pitch-scale').addEventListener('change', e => {
      this.scale = e.target.value;
      this.drawCurve();
    });
    document.getElementById('pitch-key').addEventListener('change', e => {
      this.key = parseInt(e.target.value);
      this.drawCurve();
    });
    document.getElementById('pitch-strength').addEventListener('input', e => {
      this.strength = parseFloat(e.target.value);
      document.getElementById('pitch-strength-val').textContent = Math.round(this.strength * 100) + '%';
    });
    document.getElementById('pitch-reanalyze').addEventListener('click', () => this.analyze());
    document.getElementById('pitch-apply').addEventListener('click', () => this.apply());
  }

  async analyze() {
    if (!this.track || !this.track.buffer) return;
    this.app._showOverlay('ピッチ解析中…');
    try {
      this.curve = await analyzePitchCurve(this.track.buffer, p => {
        document.getElementById('overlay-fill').style.width = (p * 100) + '%';
      });
      this.drawCurve();
    } catch (err) {
      alert('解析失敗: ' + err.message);
    }
    this.app._hideOverlay();
  }

  drawCurve() {
    const canvas = this.canvas;
    if (!canvas || !this.curve) return;
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

    const validFreqs = this.curve.filter(p => p.freq > 0).map(p => freqToMidi(p.freq));
    if (validFreqs.length === 0) {
      ctx.fillStyle = '#9D9A92';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ピッチが検出されませんでした', w / 2, h / 2);
      return;
    }

    const minMidi = Math.floor(Math.min(...validFreqs) - 2);
    const maxMidi = Math.ceil(Math.max(...validFreqs) + 2);
    const totalTime = this.curve[this.curve.length - 1].time;

    ctx.strokeStyle = '#D8D3C5';
    ctx.lineWidth = 0.5;
    for (let m = minMidi; m <= maxMidi; m++) {
      const y = h - ((m - minMidi) / (maxMidi - minMidi)) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      if (m % 12 === 0) {
        ctx.fillStyle = '#9D9A92';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(freqToNoteName(440 * Math.pow(2, (m - 69) / 12)), 2, y - 2);
      }
    }

    ctx.fillStyle = this.track.color;
    for (let i = 0; i < this.curve.length; i++) {
      const p = this.curve[i];
      if (p.freq <= 0) continue;
      const midi = freqToMidi(p.freq);
      const x = (p.time / totalTime) * w;
      const y = h - ((midi - minMidi) / (maxMidi - minMidi)) * h;
      ctx.fillRect(x, y - 1, 2, 2);
    }
  }

  async apply() {
    if (!this.track || !this.track.buffer) return;
    const target = this.rangeMode
      ? `「${this.track.name}」の選択範囲（${this.rangeStart.toFixed(2)}〜${this.rangeEnd.toFixed(2)}s）`
      : `「${this.track.name}」全体`;
    if (!confirm(`${target}にピッチ補正を適用します。元の音声データは書き換えられます。続けますか？`)) return;

    this.app._showOverlay(this.rangeMode ? '範囲ピッチ補正中…' : 'ピッチ補正適用中…');
    try {
      if (this.rangeMode) {
        await this.track.applyPitchToRange(this.rangeStart, this.rangeEnd, {
          strength: this.strength,
          scale: this.scale,
          key: this.key,
        }, p => {
          document.getElementById('overlay-fill').style.width = (p * 100) + '%';
        });
      } else {
        const newBuf = await correctPitch(this.track.buffer, {
          strength: this.strength,
          scale: this.scale,
          key: this.key,
        }, p => {
          document.getElementById('overlay-fill').style.width = (p * 100) + '%';
        });
        this.track.replaceBuffer(newBuf);
        this.track.pitchCorrected = true;
      }
      this.app.drawWave(this.track);
      this.app.refreshTrackPitchBadge(this.track);
      this.close();
    } catch (err) {
      alert('適用失敗: ' + err.message);
    }
    this.app._hideOverlay();
  }
}
