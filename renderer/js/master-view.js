export class MasterModal {
  constructor(app) {
    this.app = app;
    this.backdrop = document.getElementById('master-modal-backdrop');
    this.modal = document.getElementById('master-modal');
    this.backdrop.addEventListener('click', e => { if (e.target === this.backdrop) this.close(); });
  }

  open() {
    this.render();
    this.backdrop.classList.add('active');
  }
  close() { this.backdrop.classList.remove('active'); }

  render() {
    const s = this.app.engine.masterSettings;
    this.modal.innerHTML = `
      <div class="modal-header">
        <div>
          <div class="modal-title">マスターチャンネル設定</div>
          <div class="modal-subtitle">全体に最終EQ・コンプ・リミッターを適用</div>
        </div>
        <button class="modal-close" id="master-close">×</button>
      </div>

      <div class="modal-section">
        <div class="modal-section-label">マスターEQ（3バンド）</div>
        ${this._row('低域 (200Hz)', 'eqLow', -12, 12, 0.1, s.eqLow, v => `${v.toFixed(1)} dB`)}
        ${this._row('中域 (1.5kHz)', 'eqMid', -12, 12, 0.1, s.eqMid, v => `${v.toFixed(1)} dB`)}
        ${this._row('高域 (5kHz)', 'eqHigh', -12, 12, 0.1, s.eqHigh, v => `${v.toFixed(1)} dB`)}
      </div>

      <div class="modal-section">
        <div class="modal-section-label">マスターコンプレッサー</div>
        ${this._row('閾値', 'compThreshold', -60, 0, 0.5, s.compThreshold, v => `${v.toFixed(0)} dB`)}
        ${this._row('レシオ', 'compRatio', 1, 20, 0.1, s.compRatio, v => `${v.toFixed(1)}:1`)}
        ${this._row('アタック', 'compAttack', 0, 0.2, 0.001, s.compAttack, v => `${(v*1000).toFixed(1)}ms`)}
        ${this._row('リリース', 'compRelease', 0.01, 1, 0.01, s.compRelease, v => `${(v*1000).toFixed(0)}ms`)}
      </div>

      <div class="modal-section">
        <div class="modal-section-label">マスターリミッター</div>
        <label class="pitch-live-toggle">
          <input type="checkbox" id="master-limiter-on" ${s.limiterEnabled ? 'checked' : ''}>
          <span>リミッター有効（クリップ防止）</span>
        </label>
        ${this._row('閾値', 'limiterThreshold', -12, 0, 0.1, s.limiterThreshold, v => `${v.toFixed(1)} dB`)}
      </div>

      <div class="modal-footer">
        <button class="t-btn" id="master-reset">リセット</button>
        <button class="t-btn primary" id="master-done">完了</button>
      </div>
    `;
    document.getElementById('master-close').addEventListener('click', () => this.close());
    document.getElementById('master-done').addEventListener('click', () => this.close());
    document.getElementById('master-reset').addEventListener('click', () => {
      this.app.engine.resetMasterSettings();
      this.render();
    });
    document.getElementById('master-limiter-on').addEventListener('change', e => {
      this.app.engine.applyMasterSettings({ limiterEnabled: e.target.checked });
    });
    this.modal.querySelectorAll('[data-ms]').forEach(input => {
      const key = input.dataset.ms;
      const disp = this.modal.querySelector(`[data-msd="${key}"]`);
      input.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        this.app.engine.applyMasterSettings({ [key]: v });
        disp.textContent = disp.dataset.fmt === 'db1' ? `${v.toFixed(1)} dB`
          : disp.dataset.fmt === 'db0' ? `${v.toFixed(0)} dB`
          : disp.dataset.fmt === 'ratio' ? `${v.toFixed(1)}:1`
          : disp.dataset.fmt === 'ms1' ? `${(v*1000).toFixed(1)}ms`
          : disp.dataset.fmt === 'ms0' ? `${(v*1000).toFixed(0)}ms`
          : String(v);
      });
    });
  }

  _row(label, key, min, max, step, value, fmt) {
    const display = fmt(value);
    const fmtCode = key === 'compThreshold' ? 'db0'
      : key === 'compRatio' ? 'ratio'
      : key === 'compAttack' ? 'ms1'
      : key === 'compRelease' ? 'ms0'
      : 'db1';
    return `
      <div class="modal-control">
        <span>${label}</span>
        <input type="range" class="slider" min="${min}" max="${max}" step="${step}" value="${value}" data-ms="${key}">
        <span data-msd="${key}" data-fmt="${fmtCode}">${display}</span>
      </div>
    `;
  }
}
