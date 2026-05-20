import { Engine } from './engine.js';
import { Track } from './track.js';
import { AudioClip, MidiClip } from './clip.js';
import { appendTrackView, refreshTrackUIValues, renderClips } from './track-view.js';
import { renderPluginChain } from './plugin-chain-view.js';
import { formatTime, gainToDb } from './utils.js';
import { serializeProject, projectToBlob, defaultProjectFilename, loadProjectFromFile, applyProject } from './project.js';
import { PitchModal } from './pitch-view.js';
import { MidiEditor } from './midi-view.js';
import { MasterModal } from './master-view.js';
import { HarmonyModal } from './harmony-view.js';

const isElectron = !!window.electron;

export class App {
  constructor() {
    this.engine = new Engine();
    this.tracksEl = document.getElementById('tracks');
    this.timelineEl = document.getElementById('timeline');
    this.playhead = document.getElementById('playhead');
    this.pitchModal = new PitchModal(this);
    this.midiEditor = new MidiEditor(this);
    this.masterModal = new MasterModal(this);
    this.harmonyModal = new HarmonyModal(this);
    this.selectedTrack = null;
    this.selectedClip = null;
    this.clipboard = null;

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

  selectClip(track, clip) {
    this.selectTrack(track);
    this.selectedClip = clip;
    this.engine.tracks.forEach(t => {
      for (const c of t.clips) {
        if (c.el) c.el.classList.toggle('selected', c === clip);
      }
    });
  }

  getGlobalDuration() {
    let max = 5;
    for (const t of this.engine.tracks) {
      max = Math.max(max, t.effectiveDuration());
    }
    return max + 2;
  }

  layoutTrackClip(track, clip) {
    if (!track.el || !clip.el) return;
    const globalDur = this.getGlobalDuration();
    const leftPct = (clip.offset / globalDur) * 100;
    const widthPct = Math.max(1, (clip.duration / globalDur) * 100);
    clip.el.style.left = leftPct + '%';
    clip.el.style.width = widthPct + '%';
  }

  layoutAllClips() {
    for (const t of this.engine.tracks) {
      for (const c of t.clips) this.layoutTrackClip(t, c);
    }
  }

  drawClip(clip) {
    if (!clip.canvas) return;
    if (clip.type === 'audio') this._drawAudioClip(clip);
    else this._drawMidiClip(clip);
  }

  drawAllClipsOf(track) {
    for (const c of track.clips) this.drawClip(c);
  }

  _drawAudioClip(clip) {
    const canvas = clip.canvas;
    if (!clip.buffer) return;
    const dpr = window.devicePixelRatio || 1;
    const wrap = canvas.parentElement;
    const w = Math.max(1, wrap.clientWidth);
    const h = Math.max(1, wrap.clientHeight - 22);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    clip.computePeaks(Math.max(80, Math.floor(w)));
    const peaks = clip.peaks;
    if (!peaks) return;
    const mid = h / 2;
    const color = clip.el ? clip.el.style.borderColor : '#0550C2';
    ctx.fillStyle = color;
    const step = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const amp = peaks[i] * (mid * 0.85);
      ctx.fillRect(i * step, mid - amp, Math.max(0.5, step), amp * 2);
    }
  }

  _drawMidiClip(clip) {
    const canvas = clip.canvas;
    const dpr = window.devicePixelRatio || 1;
    const wrap = canvas.parentElement;
    const w = Math.max(1, wrap.clientWidth);
    const h = Math.max(1, wrap.clientHeight - 22);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (clip.notes.length === 0) {
      ctx.fillStyle = '#8A857A';
      ctx.font = '600 10px "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ダブルクリックで編集', w / 2, h / 2);
      return;
    }
    let minMidi = 127, maxMidi = 0;
    for (const n of clip.notes) {
      if (n.midi < minMidi) minMidi = n.midi;
      if (n.midi > maxMidi) maxMidi = n.midi;
    }
    if (maxMidi - minMidi < 6) { const c = (minMidi + maxMidi) / 2; minMidi = Math.floor(c - 3); maxMidi = Math.ceil(c + 3); }
    const color = clip.el ? clip.el.style.borderColor : '#0550C2';
    ctx.fillStyle = color;
    const rowH = h / (maxMidi - minMidi + 1);
    for (const n of clip.notes) {
      const x = (n.time / clip.duration) * w;
      const wid = Math.max(2, (n.dur / clip.duration) * w);
      const y = h - (n.midi - minMidi + 0.5) * rowH;
      ctx.fillRect(x, y - rowH * 0.4, wid, rowH * 0.8);
    }
  }

  refreshAll() {
    this._renderTimeline();
    this._updateTransport(this.engine.isPlaying);
    document.getElementById('time-duration').textContent = formatTime(this.engine.totalDuration());
    const has = this.engine.tracks.length > 0;
    document.getElementById('btn-export').disabled = !has;
    document.getElementById('btn-save-project').disabled = !has;
    this.layoutAllClips();
    this.engine.tracks.forEach((t, i) => {
      if (t.el) {
        t.el.querySelector('.track-num').textContent = `CH ${String(i + 1).padStart(2, '0')}`;
        this.drawAllClipsOf(t);
      }
    });
  }

  _renderTimeline() {
    const total = Math.max(this.engine.totalDuration(), 30);
    const globalDur = this.getGlobalDuration();
    this.timelineEl.innerHTML = '';
    const playhead = document.createElement('div');
    playhead.className = 'timeline-playhead';
    playhead.id = 'playhead';
    this.timelineEl.appendChild(playhead);
    this.playhead = playhead;

    const bd = this.engine.beatDuration();
    const numBeats = Math.ceil(globalDur / bd);
    for (let i = 0; i <= numBeats; i++) {
      const t = i * bd;
      const xPct = (t / globalDur) * 100;
      if (xPct > 100) break;
      const tick = document.createElement('div');
      tick.className = 'timeline-tick';
      const isBar = i % this.engine.beatsPerBar === 0;
      if (isBar) {
        tick.classList.add('major');
        tick.textContent = `${i / this.engine.beatsPerBar + 1}`;
      }
      tick.style.left = xPct + '%';
      this.timelineEl.appendChild(tick);
    }
    this._updatePlayhead(this.engine.currentPos());
  }

  _updatePlayhead(t) {
    if (!this.playhead) return;
    const globalDur = this.getGlobalDuration();
    const xPct = (t / globalDur) * 100;
    this.playhead.style.left = xPct + '%';
    document.getElementById('time-current').textContent = formatTime(t);
    this.engine.tracks.forEach(track => {
      for (const c of track.clips) {
        if (!c.el) continue;
        const ph = c.el.querySelector('.clip-playhead');
        if (t >= c.offset && t <= c.offset + c.duration) {
          const localPct = ((t - c.offset) / c.duration) * 100;
          if (ph) {
            ph.style.display = 'block';
            ph.style.left = localPct + '%';
          }
        } else if (ph) {
          ph.style.display = 'none';
        }
      }
    });
  }

  _onTime(t) {
    this._updatePlayhead(t);
  }

  _updateTransport(isPlaying) {
    document.getElementById('btn-play').classList.toggle('playing', isPlaying);
    document.getElementById('btn-play').disabled = false;
    document.getElementById('btn-pause').disabled = !isPlaying;
    document.getElementById('btn-stop').disabled = !isPlaying;
  }

  _meterLoop() {
    const fill = document.getElementById('master-meter-fill');
    const update = () => {
      const lv = this.engine.masterLevel();
      fill.style.width = (lv * 100) + '%';
      for (const t of this.engine.tracks) {
        if (!t.el) continue;
        const tf = t.el.querySelector('.track-meter-fill');
        if (tf) tf.style.width = (t.peakLevel() * 100) + '%';
      }
      requestAnimationFrame(update);
    };
    update();
  }

  _bindGlobalEvents() {
    const playBtn = document.getElementById('btn-play');
    playBtn.disabled = false;
    playBtn.addEventListener('click', () => this.engine.play());
    document.getElementById('btn-pause').addEventListener('click', () => this.engine.pause());
    document.getElementById('btn-stop').addEventListener('click', () => this.engine.stop());

    document.getElementById('btn-export').addEventListener('click', () => this._export());
    document.getElementById('btn-save-project').addEventListener('click', () => this._saveProject());
    document.getElementById('btn-load-project').addEventListener('click', () => this._loadProjectFlow());
    document.getElementById('btn-add-midi-track').addEventListener('click', () => this._addMidiTrack());
    document.getElementById('btn-master-settings').addEventListener('click', () => this.masterModal.open());

    document.getElementById('load-project-input').addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) this._loadProjectFromFile(f);
      e.target.value = '';
    });

    const bpmInput = document.getElementById('bpm-input');
    if (bpmInput) {
      bpmInput.value = this.engine.bpm;
      bpmInput.addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        if (v >= 20 && v <= 300) {
          this.engine.bpm = v;
          this._renderTimeline();
        }
      });
    }
    const snapBtn = document.getElementById('snap-toggle');
    if (snapBtn) {
      snapBtn.classList.toggle('active', this.engine.snapEnabled);
      snapBtn.addEventListener('click', () => {
        this.engine.snapEnabled = !this.engine.snapEnabled;
        snapBtn.classList.toggle('active', this.engine.snapEnabled);
      });
    }
    const snapResSel = document.getElementById('snap-resolution');
    if (snapResSel) {
      snapResSel.value = this.engine.snapResolution;
      snapResSel.addEventListener('change', e => {
        this.engine.snapResolution = parseInt(e.target.value);
      });
    }

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
      el.addEventListener('dragover', e => { e.preventDefault(); this.tracksEl.classList.add('dragover'); });
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
      const globalDur = this.getGlobalDuration();
      const rect = this.timelineEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      this.engine.seek((x / rect.width) * globalDur);
    });

    window.addEventListener('resize', () => {
      this.engine.tracks.forEach(t => this.drawAllClipsOf(t));
      this._renderTimeline();
    });
  }

  _handleKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (this.pitchModal.backdrop.classList.contains('active')) {
      if (e.code === 'Escape') this.pitchModal.close();
      return;
    }
    if (this.midiEditor.isOpen()) {
      this.midiEditor.handleKey(e);
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      this.engine.tracks.forEach(t => {
        for (const c of t.clips) {
          if (c.hasSelection && c.hasSelection()) {
            c.clearSelection();
            if (c.el) {
              const ov = c.el.querySelector('.selection-overlay');
              if (ov) ov.style.display = 'none';
            }
          }
        }
        if (t.el) {
          const tb = t.el.querySelector('.selection-toolbar');
          if (tb) tb.classList.remove('active');
        }
      });
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyS') { e.preventDefault(); this._saveProject(); return; }
    if (mod && e.code === 'KeyO') { e.preventDefault(); this._loadProjectFlow(); return; }
    if (mod && e.code === 'KeyE') { e.preventDefault(); this._export(); return; }
    if (mod && e.code === 'KeyC' && this.selectedClip) { e.preventDefault(); this.clipboard = this.selectedClip; return; }
    if (mod && e.code === 'KeyV' && this.clipboard) {
      e.preventDefault();
      this._pasteClipAtPlayhead();
      return;
    }
    if (mod && e.code === 'KeyD' && this.selectedClip) {
      e.preventDefault();
      this.duplicateClip(this.selectedTrack, this.selectedClip);
      return;
    }
    if (mod) return;
    if (e.code === 'Space')  { e.preventDefault(); if (this.engine.isPlaying) this.engine.pause(); else this.engine.play(); return; }
    if (e.code === 'Enter')  { e.preventDefault(); this.engine.stop(); return; }
    if (e.code === 'Home')   { e.preventDefault(); this.engine.seek(0); return; }
    if (e.code === 'End')    { e.preventDefault(); this.engine.seek(this.engine.totalDuration()); return; }
    if (e.code === 'ArrowLeft')  { e.preventDefault(); this.engine.seek(this.engine.currentPos() - (e.shiftKey ? 5 : 1)); return; }
    if (e.code === 'ArrowRight') { e.preventDefault(); this.engine.seek(this.engine.currentPos() + (e.shiftKey ? 5 : 1)); return; }
    if (e.code === 'KeyS' && this.selectedClip) {
      e.preventDefault();
      this.splitClipAtPlayhead(this.selectedTrack, this.selectedClip);
      return;
    }
    if ((e.code === 'Delete' || e.code === 'Backspace') && this.selectedClip) {
      e.preventDefault();
      this.deleteClip(this.selectedTrack, this.selectedClip);
      return;
    }
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
      const trackName = file.name.replace(/\.[^.]+$/, '');
      const track = new Track(trackName, undefined, 'audio');
      this.engine.addTrack(track);
      appendTrackView(this, track);
      const clip = new AudioClip(buf, trackName);
      track.addClip(clip);
      renderClips(this, track);
      this.refreshAll();
    } catch (err) {
      alert('読み込み失敗: ' + err.message);
    }
    this._hideOverlay();
  }

  _addMidiTrack() {
    this.engine.ensure();
    const track = new Track('MIDIトラック', undefined, 'midi');
    this.engine.addTrack(track);
    appendTrackView(this, track);
    const clip = new MidiClip('MIDI 1');
    clip.offset = this.engine.snapTime(this.engine.currentPos());
    clip.duration = this.engine.barDuration();
    track.addClip(clip);
    renderClips(this, track);
    this.refreshAll();
  }

  splitClipAtPlayhead(track, clip) {
    const t = this.engine.currentPos();
    if (t <= clip.offset || t >= clip.offset + clip.duration) {
      alert('再生位置がクリップ内にありません。');
      return;
    }
    const splitTime = t - clip.offset;
    if (clip.type === 'audio') {
      const second = new AudioClip(clip.buffer, clip.name + ' (2)');
      second.offset = t;
      second.trimStart = clip.trimStart + splitTime;
      second.duration = clip.duration - splitTime;
      second.gain = clip.gain;
      clip.duration = splitTime;
      track.addClip(second);
    } else {
      const second = new MidiClip(clip.name + ' (2)');
      second.offset = t;
      second.duration = clip.duration - splitTime;
      second.gain = clip.gain;
      for (const n of clip.notes) {
        if (n.time >= splitTime) {
          second.notes.push({ ...n, time: n.time - splitTime });
        }
      }
      clip.notes = clip.notes.filter(n => n.time < splitTime);
      clip.duration = splitTime;
      track.addClip(second);
    }
    renderClips(this, track);
    this.refreshAll();
  }

  duplicateClip(track, clip) {
    let newClip;
    if (clip.type === 'audio') {
      newClip = new AudioClip(clip.buffer, clip.name + ' (copy)');
      newClip.trimStart = clip.trimStart;
      newClip.duration = clip.duration;
      newClip.fadeIn = clip.fadeIn;
      newClip.fadeOut = clip.fadeOut;
    } else {
      newClip = new MidiClip(clip.name + ' (copy)');
      newClip.duration = clip.duration;
      newClip.notes = clip.notes.map(n => ({ ...n }));
    }
    newClip.gain = clip.gain;
    newClip.offset = clip.offset + clip.duration;
    track.addClip(newClip);
    renderClips(this, track);
    this.refreshAll();
  }

  deleteClip(track, clip) {
    if (!confirm(`クリップ「${clip.name}」を削除しますか？`)) return;
    track.removeClip(clip);
    if (this.selectedClip === clip) this.selectedClip = null;
    renderClips(this, track);
    this.refreshAll();
  }

  _pasteClipAtPlayhead() {
    if (!this.clipboard) return;
    const src = this.clipboard;
    let targetTrack = this.selectedTrack;
    if (!targetTrack || targetTrack.type !== src.type) {
      targetTrack = this.engine.tracks.find(t => t.type === src.type);
    }
    if (!targetTrack) {
      if (src.type === 'audio') {
        alert('オーディオトラックがありません。先にトラックを追加してください。');
        return;
      } else {
        this._addMidiTrack();
        targetTrack = this.engine.tracks[this.engine.tracks.length - 1];
      }
    }
    let newClip;
    if (src.type === 'audio') {
      newClip = new AudioClip(src.buffer, src.name + ' (paste)');
      newClip.trimStart = src.trimStart;
      newClip.duration = src.duration;
      newClip.fadeIn = src.fadeIn; newClip.fadeOut = src.fadeOut;
    } else {
      newClip = new MidiClip(src.name + ' (paste)');
      newClip.duration = src.duration;
      newClip.notes = src.notes.map(n => ({ ...n }));
    }
    newClip.gain = src.gain;

    let dest = this.engine.snapTime(this.engine.currentPos());
    const overlapping = targetTrack.clips.find(c =>
      Math.abs(c.offset - dest) < 0.001
    );
    if (overlapping) {
      dest = this.engine.snapTime(overlapping.endTime());
    }
    newClip.offset = dest;
    targetTrack.addClip(newClip);
    renderClips(this, targetTrack);
    this.selectTrack(targetTrack);
    this.selectClip(targetTrack, newClip);
    this.refreshAll();
    this.engine.seek(newClip.offset + newClip.duration);
  }

  async deleteTrack(track) {
    if (this.selectedTrack === track) this.selectedTrack = null;
    if (this.selectedClip && track.clips.indexOf(this.selectedClip) >= 0) this.selectedClip = null;
    this.engine.removeTrack(track);
    track.el.remove();
    if (this.engine.tracks.length === 0) this._renderEmptyState();
    this.refreshAll();
  }

  _renderEmptyState() {
    this.tracksEl.classList.add('empty');
    this.tracksEl.innerHTML = `
      <div class="tracks-empty">
        <div class="tracks-empty-msg">音源ファイルをここにドロップ</div>
        <div class="tracks-empty-sub">WAV · MP3 · M4A · OGG · 複数同時可</div>
      </div>
    `;
  }

  async runClipSelectionOp(track, clip, op) {
    if (clip.type !== 'audio') return;
    if (!clip.hasSelection() && op !== 'clear') return;
    const s = clip.selectionStart, e = clip.selectionEnd;
    const { silenceClipRange, normalizeClipRange, applyGainToClipRange, applyFadeToClipRange, deleteClipRange } = await import('./clip-edits.js');
    switch (op) {
      case 'silence':   silenceClipRange(clip, s, e); this.drawClip(clip); break;
      case 'normalize': normalizeClipRange(clip, s, e); this.drawClip(clip); break;
      case 'gain-up':   applyGainToClipRange(clip, s, e, Math.pow(10, 3/20)); this.drawClip(clip); break;
      case 'gain-down': applyGainToClipRange(clip, s, e, Math.pow(10, -3/20)); this.drawClip(clip); break;
      case 'fade-in':   applyFadeToClipRange(clip, s, e, 'in'); this.drawClip(clip); break;
      case 'fade-out':  applyFadeToClipRange(clip, s, e, 'out'); this.drawClip(clip); break;
      case 'delete':
        if (!confirm(`選択範囲（${(e - s).toFixed(2)}秒）を削除しますか？`)) return;
        deleteClipRange(clip, s, e);
        this.drawClip(clip);
        this.refreshAll();
        break;
      case 'pitch':
        await this.openPitchModalForClipRange(track, clip, s, e);
        this.drawClip(clip);
        break;
      case 'clear':
        clip.clearSelection();
        break;
    }
  }

  openPitchModalForClip(track, clip) {
    this.pitchModal.openForClip(track, clip);
  }
  openPitchModalForClipRange(track, clip, start, end) {
    return this.pitchModal.openForClipRange(track, clip, start, end);
  }
  refreshTrackPitchBadge(track) {}

  openMidiEditor(track, clip) {
    this.midiEditor.open(track, clip);
  }

  openHarmonyForClip(track, clip) {
    this.harmonyModal.open(track, clip);
  }

  async _saveProject() {
    const has = this.engine.tracks.length > 0;
    if (!has) return;
    const json = serializeProject(this.engine);
    if (isElectron) {
      const res = await window.electron.showSaveDialog({
        title: 'プロジェクトを保存',
        defaultPath: defaultProjectFilename(),
        filters: [{ name: 'Project', extensions: ['json'] }],
      });
      if (res.canceled || !res.filePath) return;
      try { await window.electron.writeFile(res.filePath, json); }
      catch (err) { alert('保存失敗: ' + err.message); }
    } else {
      const blob = projectToBlob(json);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = defaultProjectFilename(); a.click();
      URL.revokeObjectURL(url);
    }
  }

  async _loadProjectFlow() {
    if (isElectron) {
      const res = await window.electron.showOpenDialog({
        title: 'プロジェクトを読み込み',
        filters: [{ name: 'Project', extensions: ['json'] }],
        properties: ['openFile'],
      });
      if (res.canceled || !res.filePaths || res.filePaths.length === 0) return;
      const p = res.filePaths[0];
      const data = await window.electron.readFile(p);
      const name = p.split(/[\\/]/).pop();
      const file = new File([data], name, { type: 'application/json' });
      this._loadProjectFromFile(file);
    } else {
      document.getElementById('load-project-input').click();
    }
  }

  async _loadProjectFromFile(file) {
    try {
      const project = await loadProjectFromFile(file);
      const bufferByName = {};
      for (const t of this.engine.tracks) {
        for (const c of t.clips) {
          if (c.type === 'audio' && c.buffer) bufferByName[c.name] = c.buffer;
        }
      }
      const masterSlider = document.getElementById('master-gain');
      const masterDisp = document.getElementById('master-gain-val');
      const result = applyProject(this.engine, masterSlider, masterDisp, project, bufferByName);
      this.engine.tracks.forEach(t => {
        refreshTrackUIValues(t);
        renderClips(this, t);
        if (t.el) {
          const pc = t.el.querySelector('.plugin-chain');
          if (pc) renderPluginChain(this, t, pc);
        }
      });
      this.refreshAll();
      if (result && result.missing && result.missing.length > 0) {
        alert(`一部のオーディオ参照を解決できませんでした：\n${result.missing.join('\n')}`);
      }
    } catch (err) {
      alert('プロジェクト読み込み失敗: ' + err.message);
    }
  }

  async _export() {
    if (this.engine.tracks.length === 0) return;
    this._showOverlay('書き出し中…');
    try {
      const blob = await this.engine.renderToWav(p => {
        document.getElementById('overlay-fill').style.width = (p * 100) + '%';
      });
      if (isElectron) {
        const res = await window.electron.showSaveDialog({
          title: 'WAVを書き出し',
          defaultPath: `mix_${Date.now()}.wav`,
          filters: [{ name: 'WAV', extensions: ['wav'] }],
        });
        if (!res.canceled && res.filePath) {
          const arr = new Uint8Array(await blob.arrayBuffer());
          await window.electron.writeFile(res.filePath, arr);
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `mix_${Date.now()}.wav`; a.click();
        URL.revokeObjectURL(url);
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
  _hideOverlay() {
    document.getElementById('overlay').classList.remove('active');
  }
}
