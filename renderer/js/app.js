import { Engine } from './engine.js';
import { Track } from './track.js';
import { appendTrackView, refreshTrackUIValues } from './track-view.js';
import { renderPluginChain } from './plugin-chain-view.js';
import { formatTime, gainToDb } from './utils.js';
import { serializeProject, projectToBlob, defaultProjectFilename, loadProjectFromFile, applyProject } from './project.js';
import { PitchModal } from './pitch-view.js';

const isElectron = !!window.electron;

export class App {
  constructor() {
    this.engine = new Engine();
    this.tracksEl = document.getElementById('tracks');
    this.timelineEl = document.getElementById('timeline');
    this.playhead = document.getElementById('playhead');
    this.pitchModal = new PitchModal(this);
    this.selectedTrack = null;

    this.engine.onTimeUpdate = t => this._onTime(t);
    this.engine.onPlayState  = p => this._updateTransport(p);

    this._bindGlobalEvents();
    this._meterLoop();
  }

  selectTrack(track) {
    this.selectedTrack = track;
    this.engine.tracks.forEach(t => {
      if (t.el) t.el.classList.toggle('selected', t === track);
    });
  }

  selectTrackByIndex(idx) {
    const t = this.engine.tracks[idx];
    if (t) this.selectTrack(t);
  }

  selectAdjacentTrack(delta) {
    if (this.engine.tracks.length === 0) return;
    const cur = this.selectedTrack ? this.engine.tracks.indexOf(this.selectedTrack) : -1;
    const next = (cur + delta + this.engine.tracks.length) % this.engine.tracks.length;
    this.selectTrack(this.engine.tracks[next]);
  }

  _handleKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (this.pitchModal.backdrop.classList.contains('active')) {
      if (e.code === 'Escape') this.pitchModal.close();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      this.engine.tracks.forEach(t => {
        if (t.hasSelection()) {
          t.clearSelection();
          if (t.el) {
            const ov = t.el.querySelector('.selection-overlay');
            const tb = t.el.querySelector('.selection-toolbar');
            if (ov) ov.style.display = 'none';
            if (tb) tb.classList.remove('active');
          }
        }
      });
      return;
    }
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.code === 'KeyS') { e.preventDefault(); if (!document.getElementById('btn-save-project').disabled) this._saveProject(); return; }
    if (mod && e.code === 'KeyO') { e.preventDefault(); this._loadProjectFlow(); return; }
    if (mod && e.code === 'KeyE') { e.preventDefault(); if (!document.getElementById('btn-export').disabled) this._export(); return; }
    if (mod && e.code === 'KeyN') {
      e.preventDefault();
      if (this.engine.tracks.length > 0 && confirm('全トラックを削除して新規プロジェクトにしますか？')) {
        [...this.engine.tracks].forEach(t => this.deleteTrack(t));
      }
      return;
    }
    if (mod) return;

    if (e.code === 'Space')  { e.preventDefault(); if (this.engine.isPlaying) this.engine.pause(); else this.engine.play(); return; }
    if (e.code === 'Enter')  { e.preventDefault(); this.engine.stop(); return; }
    if (e.code === 'Home')   { e.preventDefault(); this.engine.seek(0); return; }
    if (e.code === 'End')    { e.preventDefault(); this.engine.seek(this.engine.totalDuration()); return; }
    if (e.code === 'ArrowLeft')  { e.preventDefault(); this.engine.seek(this.engine.currentPos() - (e.shiftKey ? 5 : 1)); return; }
    if (e.code === 'ArrowRight') { e.preventDefault(); this.engine.seek(this.engine.currentPos() + (e.shiftKey ? 5 : 1)); return; }
    if (e.code === 'ArrowUp')    { e.preventDefault(); this.selectAdjacentTrack(-1); return; }
    if (e.code === 'ArrowDown')  { e.preventDefault(); this.selectAdjacentTrack(1); return; }

    if (e.code === 'KeyM' && this.selectedTrack) {
      e.preventDefault();
      this.selectedTrack.muted = !this.selectedTrack.muted;
      const btn = this.selectedTrack.el && this.selectedTrack.el.querySelector('.knob-mini.mute');
      if (btn) btn.classList.toggle('active', this.selectedTrack.muted);
      this.engine._reapplySolo();
      return;
    }
    if (e.code === 'KeyS' && this.selectedTrack) {
      e.preventDefault();
      this.selectedTrack.soloed = !this.selectedTrack.soloed;
      const btn = this.selectedTrack.el && this.selectedTrack.el.querySelector('.knob-mini.solo');
      if (btn) btn.classList.toggle('active', this.selectedTrack.soloed);
      this.engine._reapplySolo();
      return;
    }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this.selectedTrack) {
      e.preventDefault();
      const t = this.selectedTrack;
      if (confirm(`「${t.name}」を削除しますか？`)) {
        this.selectedTrack = null;
        this.deleteTrack(t);
      }
      return;
    }
    if (e.code === 'KeyP' && this.selectedTrack) {
      e.preventDefault();
      this.openPitchModal(this.selectedTrack);
      return;
    }
    const digitMatch = e.code.match(/^Digit([1-9])$/);
    if (digitMatch) {
      e.preventDefault();
      this.selectTrackByIndex(parseInt(digitMatch[1]) - 1);
    }
  }

  async deleteTrack(track) {
    if (this.selectedTrack === track) this.selectedTrack = null;
    this.engine.removeTrack(track);
    track.el.remove();
    if (this.engine.tracks.length === 0) this._renderEmptyState();
    this.refreshAll();
  }

  drawWave(track) {
    const canvas = track.canvas;
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth || 600;
    const h = 80;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    track.computePeaks(Math.max(200, Math.floor(w)));
    const peaks = track.peaks;
    if (!peaks) return;

    const mid = h / 2;
    const totalDur = track.buffer.duration;
    const trimStartX = (track.trimStart / totalDur) * w;
    const trimEndX = w - (track.trimEnd / totalDur) * w;

    ctx.fillStyle = track.color + '18';
    const step = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const amp = peaks[i] * (mid * 0.9);
      ctx.fillRect(i * step, mid - amp, Math.max(0.5, step), amp * 2);
    }

    ctx.fillStyle = track.color + '55';
    const sStart = Math.max(0, Math.floor(trimStartX / step));
    const sEnd = Math.min(peaks.length, Math.ceil(trimEndX / step));
    for (let i = sStart; i < sEnd; i++) {
      const amp = peaks[i] * (mid * 0.9);
      ctx.fillRect(i * step, mid - amp, Math.max(0.5, step), amp * 2);
    }

    if (track.trimStart > 0) {
      ctx.fillStyle = 'rgba(26,26,26,0.18)';
      ctx.fillRect(0, 0, trimStartX, h);
    }
    if (track.trimEnd > 0) {
      ctx.fillStyle = 'rgba(26,26,26,0.18)';
      ctx.fillRect(trimEndX, 0, w - trimEndX, h);
    }
  }

  refreshAll() {
    this._renderTimeline();
    this._updateTransport(this.engine.isPlaying);
    document.getElementById('time-duration').textContent = formatTime(this.engine.totalDuration());
    const has = this.engine.tracks.length > 0;
    document.getElementById('btn-export').disabled = !has;
    document.getElementById('btn-save-project').disabled = !has;
    this.engine.tracks.forEach((t, i) => {
      if (t.el) {
        t.el.querySelector('.track-num').textContent = `CH ${String(i + 1).padStart(2, '0')}`;
        this.drawWave(t);
      }
    });
  }

  refreshTrackPitchBadge(track) {
    if (!track.el) return;
    const btn = track.el.querySelector('.knob-mini.pitch');
    if (btn) btn.classList.toggle('active', track.pitchCorrected);
  }

  openPitchModal(track) {
    this.pitchModal.open(track);
  }

  openPitchModalForRange(track, start, end) {
    return this.pitchModal.openForRange(track, start, end);
  }

  _bindGlobalEvents() {
    document.getElementById('btn-play').addEventListener('click', () => this.engine.play());
    document.getElementById('btn-pause').addEventListener('click', () => this.engine.pause());
    document.getElementById('btn-stop').addEventListener('click', () => this.engine.stop());
    document.getElementById('btn-export').addEventListener('click', () => this._export());

    document.getElementById('btn-save-project').addEventListener('click', () => this._saveProject());
    document.getElementById('btn-load-project').addEventListener('click', () => this._loadProjectFlow());
    document.getElementById('load-project-input').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (f) await this._loadProjectFromFile(f);
      e.target.value = '';
    });

    document.getElementById('master-gain').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      this.engine.ensure();
      this.engine.masterGain.gain.value = v;
      document.getElementById('master-gain-val').textContent = gainToDb(v);
    });

    document.getElementById('add-track-btn').addEventListener('click', () => this._addTrackFlow());
    document.getElementById('add-track-input').addEventListener('change', e => {
      [...e.target.files].forEach(f => this._loadAudioFile(f));
      e.target.value = '';
    });

    const dropTargets = [this.tracksEl, document.getElementById('add-track')];
    dropTargets.forEach(el => {
      el.addEventListener('dragover', e => {
        e.preventDefault();
        this.tracksEl.classList.add('dragover');
      });
      el.addEventListener('dragleave', () => this.tracksEl.classList.remove('dragover'));
      el.addEventListener('drop', e => {
        e.preventDefault();
        this.tracksEl.classList.remove('dragover');
        [...e.dataTransfer.files].forEach(f => {
          if (f.type.startsWith('audio') || /\.(wav|mp3|m4a|ogg|aac|flac)$/i.test(f.name)) {
            this._loadAudioFile(f);
          } else if (/\.json$/i.test(f.name)) {
            this._loadProjectFromFile(f);
          }
        });
      });
    });

    window.addEventListener('keydown', e => this._handleKey(e));

    this.timelineEl.addEventListener('click', e => {
      const total = this.engine.totalDuration();
      if (total === 0) return;
      const rect = this.timelineEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      this.engine.seek((x / rect.width) * total);
    });

    window.addEventListener('resize', () => {
      this.engine.tracks.forEach(t => { if (t.el) this.drawWave(t); });
      this._renderTimeline();
    });
  }

  async _addTrackFlow() {
    if (isElectron) {
      const res = await window.electron.showOpenDialog({
        title: 'オーディオファイルを選択',
        filters: [{ name: 'Audio', extensions: ['wav','mp3','m4a','ogg','aac','flac'] }],
        properties: ['openFile', 'multiSelections'],
      });
      if (res.canceled || !res.filePaths) return;
      for (const p of res.filePaths) {
        const data = await window.electron.readFile(p);
        const name = p.split(/[\\/]/).pop();
        const file = new File([data], name, { type: 'audio/' + name.split('.').pop() });
        await this._loadAudioFile(file);
      }
    } else {
      document.getElementById('add-track-input').click();
    }
  }

  async _loadAudioFile(file) {
    this.engine.ensure();
    await this.engine.resume();
    this._showOverlay(`読み込み中: ${file.name}`);
    try {
      const arr = await file.arrayBuffer();
      const buf = await this.engine.ctx.decodeAudioData(arr);
      const track = new Track(file, buf);
      this.engine.addTrack(track);
      appendTrackView(this, track);
      this.refreshAll();
    } catch (err) {
      alert('読み込み失敗: ' + err.message);
    }
    this._hideOverlay();
  }

  async _saveProject() {
    const project = serializeProject(this.engine);
    const json = JSON.stringify(project, null, 2);
    const filename = defaultProjectFilename();
    if (isElectron) {
      const res = await window.electron.showSaveDialog({
        title: 'プロジェクトを保存',
        defaultPath: filename,
        filters: [{ name: 'OPEN MIX project', extensions: ['json'] }],
      });
      if (res.canceled || !res.filePath) return;
      try {
        await window.electron.writeFile(res.filePath, json);
      } catch (err) {
        alert('保存失敗: ' + err.message);
      }
    } else {
      const blob = projectToBlob(project);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async _loadProjectFlow() {
    if (isElectron) {
      const res = await window.electron.showOpenDialog({
        title: 'プロジェクトを開く',
        filters: [{ name: 'OPEN MIX project', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (res.canceled || !res.filePaths || !res.filePaths.length) return;
      const data = await window.electron.readFile(res.filePaths[0]);
      const name = res.filePaths[0].split(/[\\/]/).pop();
      const file = new File([data], name, { type: 'application/json' });
      await this._loadProjectFromFile(file);
    } else {
      document.getElementById('load-project-input').click();
    }
  }

  async _loadProjectFromFile(file) {
    try {
      const project = await loadProjectFromFile(file);
      if (this.engine.tracks.length === 0) {
        alert('先に音声ファイルを読み込んでください。プロジェクトはファイル名でマッチします。');
        return;
      }
      const masterSlider = document.getElementById('master-gain');
      const masterDisp = document.getElementById('master-gain-val');
      const result = applyProject(this.engine, masterSlider, masterDisp, project);
      this.engine.tracks.forEach(t => {
        refreshTrackUIValues(t);
        if (t.el) {
          const pc = t.el.querySelector('.plugin-chain');
          if (pc) renderPluginChain(this, t, pc);
        }
      });
      this.refreshAll();
      let msg = `プロジェクト適用: ${result.matched}/${result.totalInProject} トラックがマッチ`;
      if (result.unmatched.length > 0) {
        msg += '\nマッチしなかったファイル名:\n' + result.unmatched.join('\n');
      }
      alert(msg);
    } catch (err) {
      alert('プロジェクト読み込み失敗: ' + err.message);
    }
  }

  _renderEmptyState() {
    this.tracksEl.classList.add('empty');
    this.tracksEl.innerHTML = `
      <div class="tracks-empty">
        <div class="tracks-empty-msg">音源ファイルをここにドロップ</div>
        <div class="tracks-empty-sub">WAV · MP3 · M4A · OGG · 複数同時可</div>
      </div>`;
  }

  _renderTimeline() {
    const total = this.engine.totalDuration();
    this.timelineEl.querySelectorAll('.timeline-tick').forEach(n => n.remove());
    if (total === 0) return;
    const width = this.timelineEl.clientWidth;
    const interval = total < 30 ? 1 : total < 120 ? 5 : total < 300 ? 10 : 30;
    for (let t = 0; t <= total; t += interval) {
      const x = (t / total) * width;
      const tick = document.createElement('div');
      tick.className = 'timeline-tick' + (t % (interval * 5) === 0 ? ' major' : '');
      tick.style.left = x + 'px';
      tick.textContent = formatTime(t);
      this.timelineEl.appendChild(tick);
    }
  }

  _onTime(t) {
    document.getElementById('time-current').textContent = formatTime(t);
    const total = this.engine.totalDuration();
    if (total > 0) {
      const x = (t / total) * this.timelineEl.clientWidth;
      this.playhead.style.left = x + 'px';
    } else this.playhead.style.left = '0px';
  }

  _updateTransport(playing) {
    const has = this.engine.tracks.length > 0;
    document.getElementById('btn-play').disabled  = !has || playing;
    document.getElementById('btn-pause').disabled = !has || !playing;
    document.getElementById('btn-stop').disabled  = !has;
    document.getElementById('btn-play').classList.toggle('playing', playing);
  }

  _meterLoop() {
    const update = () => {
      if (this.engine.ctx) {
        this.engine.tracks.forEach(t => {
          if (!t.el) return;
          const fill = t.el.querySelector('.track-meter-fill');
          if (fill) fill.style.width = Math.min(100, t.peakLevel() * 100) + '%';
        });
        const mLvl = this.engine.masterLevel();
        const mFill = document.getElementById('master-meter-fill');
        if (mFill) mFill.style.width = Math.min(100, mLvl * 100) + '%';
      }
      requestAnimationFrame(update);
    };
    update();
  }

  async _export() {
    this._showOverlay('書き出し中…');
    try {
      const blob = await this.engine.renderToWav(p => {
        document.getElementById('overlay-fill').style.width = (p * 100) + '%';
      });
      const filename = 'openmix_' + new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12) + '.wav';

      if (isElectron) {
        const res = await window.electron.showSaveDialog({
          title: 'WAVを書き出し',
          defaultPath: filename,
          filters: [{ name: 'WAV audio', extensions: ['wav'] }],
        });
        if (res.canceled || !res.filePath) {
          this._hideOverlay();
          return;
        }
        const arr = new Uint8Array(await blob.arrayBuffer());
        await window.electron.writeFile(res.filePath, arr);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) {
      alert('書き出し失敗: ' + err.message);
    }
    this._hideOverlay();
  }

  _showOverlay(msg) {
    document.getElementById('overlay-msg').textContent = msg;
    document.getElementById('overlay-fill').style.width = '0%';
    document.getElementById('overlay').classList.add('active');
  }
  _hideOverlay() { document.getElementById('overlay').classList.remove('active'); }
}
