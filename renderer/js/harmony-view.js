import { shiftPitchBySemitones, setScratchCtx } from './pitch.js';
import { Track } from './track.js';
import { AudioClip } from './clip.js';
import { escapeHtml } from './utils.js';
import { appendTrackView, renderClips } from './track-view.js';

const PRESETS = [
  { label: '1オクターブ下',  semitones: -12 },
  { label: '完全5度下',      semitones: -7  },
  { label: '完全4度下',      semitones: -5  },
  { label: '短3度下',        semitones: -3  },
  { label: '短3度上',        semitones: 3   },
  { label: '長3度上',        semitones: 4   },
  { label: '完全4度上',      semitones: 5   },
  { label: '完全5度上',      semitones: 7   },
  { label: '1オクターブ上',  semitones: 12  },
];

export class HarmonyModal {
  constructor(app) {
    this.app = app;
    this.backdrop = document.getElementById('harmony-modal-backdrop');
    this.modal = document.getElementById('harmony-modal');
    this.track = null;
    this.clip = null;
    this.semitones = 7;
    this.gainPct = 70;
    this.backdrop.addEventListener('click', e => { if (e.target === this.backdrop) this.close(); });
  }

  open(track, clip) {
    if (!clip || clip.type !== 'audio') { alert('オーディオクリップのみ対応'); return; }
    this.track = track;
    this.clip = clip;
    this.render();
    this.backdrop.classList.add('active');
  }
  close() {
    this.backdrop.classList.remove('active');
    this.track = null; this.clip = null;
  }

  render() {
    this.modal.innerHTML = `
      <div class="modal-header">
        <div>
          <div class="modal-title">ハモリ作成</div>
          <div class="modal-subtitle">${escapeHtml(this.clip.name)} を音程シフトして新トラックに複製</div>
        </div>
        <button class="modal-close" id="harm-close">×</button>
      </div>

      <div class="modal-section">
        <div class="modal-section-label">プリセット（クリックで音程セット）</div>
        <div class="harmony-presets">
          ${PRESETS.map(p => `
            <button class="harmony-preset-btn" data-semi="${p.semitones}">
              <span class="harmony-preset-label">${p.label}</span>
              <span class="harmony-preset-semi">${p.semitones > 0 ? '+' : ''}${p.semitones}st</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-label">音程シフト（半音単位）</div>
        <div class="modal-control">
          <span>シフト</span>
          <input type="range" class="slider" id="harm-semi" min="-24" max="24" step="1" value="${this.semitones}">
          <span id="harm-semi-val">${this.semitones > 0 ? '+' : ''}${this.semitones} st</span>
        </div>
        <div class="modal-control">
          <span>音量</span>
          <input type="range" class="slider" id="harm-gain" min="0" max="100" step="1" value="${this.gainPct}">
          <span id="harm-gain-val">${this.gainPct}%</span>
        </div>
      </div>

      <div class="pitch-help">
        新しい音声トラックが追加され、同じ位置に音程シフトされたクリップが配置されます。元のクリップはそのままです。複数のハモリを作りたい場合は、何度でも実行できます。
      </div>

      <div class="modal-footer">
        <button class="t-btn" id="harm-cancel">キャンセル</button>
        <button class="t-btn primary" id="harm-generate">ハモリ生成</button>
      </div>
    `;

    document.getElementById('harm-close').addEventListener('click', () => this.close());
    document.getElementById('harm-cancel').addEventListener('click', () => this.close());
    document.getElementById('harm-generate').addEventListener('click', () => this.generate());

    document.getElementById('harm-semi').addEventListener('input', e => {
      this.semitones = parseInt(e.target.value);
      document.getElementById('harm-semi-val').textContent =
        `${this.semitones > 0 ? '+' : ''}${this.semitones} st`;
    });
    document.getElementById('harm-gain').addEventListener('input', e => {
      this.gainPct = parseInt(e.target.value);
      document.getElementById('harm-gain-val').textContent = this.gainPct + '%';
    });

    this.modal.querySelectorAll('.harmony-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.semitones = parseInt(btn.dataset.semi);
        document.getElementById('harm-semi').value = this.semitones;
        document.getElementById('harm-semi-val').textContent =
          `${this.semitones > 0 ? '+' : ''}${this.semitones} st`;
      });
    });
  }

  async generate() {
    if (!this.clip || !this.clip.buffer) return;
    const c = this.clip;
    this.app.engine.ensure();
    setScratchCtx(this.app.engine.ctx);

    this.app._showOverlay(`ハモリ生成中（${this.semitones > 0 ? '+' : ''}${this.semitones} 半音）…`);
    try {
      const sr = c.buffer.sampleRate;
      const numCh = c.buffer.numberOfChannels;
      const startS = Math.max(0, Math.floor(c.trimStart * sr));
      const endS = Math.min(c.buffer.length, Math.floor((c.trimStart + c.duration) * sr));
      const len = endS - startS;
      if (len <= 0) throw new Error('対象クリップが空です');
      const ctx = this.app.engine.ctx;
      const sub = ctx.createBuffer(numCh, len, sr);
      for (let ch = 0; ch < numCh; ch++) {
        const src = c.buffer.getChannelData(ch);
        const dst = sub.getChannelData(ch);
        for (let i = 0; i < len; i++) dst[i] = src[startS + i];
      }
      const shifted = await shiftPitchBySemitones(sub, this.semitones, p => {
        document.getElementById('overlay-fill').style.width = (p * 100) + '%';
      });

      const harmName = `${this.track.name} ハモリ ${this.semitones > 0 ? '+' : ''}${this.semitones}`;
      const newTrack = new Track(harmName, undefined, 'audio');
      this.app.engine.addTrack(newTrack);
      appendTrackView(this.app, newTrack);

      const clipName = `${c.name} ${this.semitones > 0 ? '+' : ''}${this.semitones}st`;
      const newClip = new AudioClip(shifted, clipName);
      newClip.offset = c.offset;
      newClip.trimStart = 0;
      newClip.duration = shifted.duration;
      newClip.fadeIn = c.fadeIn;
      newClip.fadeOut = c.fadeOut;
      newClip.gain = c.gain * (this.gainPct / 100);
      newTrack.addClip(newClip);
      renderClips(this.app, newTrack);
      this.app.refreshAll();
      this.app.selectTrack(newTrack);
      this.app.selectClip(newTrack, newClip);

      this.close();
    } catch (err) {
      alert('ハモリ生成失敗: ' + err.message);
    }
    this.app._hideOverlay();
  }
}
