import { clamp } from './utils.js';
import { audioBufferToWav } from './wav.js';

export class Engine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.masterAnalyser = null;
    this.reverbIR = null;

    this.isPlaying = false;
    this.startTime = 0;
    this.pausePos = 0;
    this.rafId = null;

    this.tracks = [];

    this.bpm = 120;
    this.beatsPerBar = 4;
    this.beatUnit = 4;
    this.snapEnabled = true;
    this.snapResolution = 4;

    this.onTimeUpdate = () => {};
    this.onPlayState = () => {};
  }

  ensure() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);
    this.reverbIR = this._makeIR(this.ctx, 2.0, 2.5);
  }

  _makeIR(ctx, duration, decay) {
    const len = Math.floor(ctx.sampleRate * duration);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return ir;
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  addTrack(track) {
    this.tracks.push(track);
    track.buildGraph(this.ctx, this.masterGain, this.reverbIR);
    this._reapplySolo();
  }

  removeTrack(track) {
    const i = this.tracks.indexOf(track);
    if (i < 0) return;
    track.disconnect();
    this.tracks.splice(i, 1);
    this._reapplySolo();
  }

  anySoloed() {
    return this.tracks.some(t => t.soloed && t.clips.length > 0);
  }

  _reapplySolo() {
    const s = this.anySoloed();
    this.tracks.forEach(t => t.applyAudibility(s));
  }

  totalDuration() {
    let max = 0;
    this.tracks.forEach(t => {
      max = Math.max(max, t.effectiveDuration());
    });
    return max;
  }

  beatDuration() { return 60 / this.bpm; }
  barDuration() { return this.beatDuration() * this.beatsPerBar; }

  snapTime(t) {
    if (!this.snapEnabled) return t;
    const grid = this.beatDuration() * (4 / this.snapResolution);
    return Math.round(t / grid) * grid;
  }

  play() {
    this.ensure();
    this.resume();
    if (this.isPlaying) return;
    const total = this.totalDuration();
    if (total === 0) return;
    if (this.pausePos >= total) this.pausePos = 0;

    const when = this.ctx.currentTime + 0.05;
    this.tracks.forEach(t => t.scheduleClips(this.ctx, when, this.pausePos));
    this.startTime = when - this.pausePos;
    this.isPlaying = true;
    this.onPlayState(true);
    this._tick();
  }

  pause() {
    if (!this.isPlaying) return;
    this.pausePos = clamp(this.ctx.currentTime - this.startTime, 0, this.totalDuration());
    this.tracks.forEach(t => t.stopAllSources());
    this.isPlaying = false;
    this.onPlayState(false);
    this._stopTick();
  }

  stop() {
    this.tracks.forEach(t => t.stopAllSources());
    this.isPlaying = false;
    this.pausePos = 0;
    this.onPlayState(false);
    this._stopTick();
    this.onTimeUpdate(0);
  }

  seek(pos) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    this.pausePos = clamp(pos, 0, this.totalDuration());
    this.onTimeUpdate(this.pausePos);
    if (wasPlaying) this.play();
  }

  currentPos() {
    if (this.isPlaying) return Math.max(0, this.ctx.currentTime - this.startTime);
    return this.pausePos;
  }

  _tick() {
    this.onTimeUpdate(this.currentPos());
    if (this.isPlaying) {
      if (this.currentPos() >= this.totalDuration()) {
        this.stop();
        return;
      }
      this.rafId = requestAnimationFrame(() => this._tick());
    }
  }

  _stopTick() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  masterLevel() {
    if (!this.masterAnalyser) return 0;
    const buf = new Uint8Array(this.masterAnalyser.fftSize);
    this.masterAnalyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    return peak;
  }

  async renderToWav(progressCb) {
    const total = this.totalDuration();
    if (total === 0) throw new Error('クリップが配置されていません');

    const sr = this.ctx.sampleRate;
    const off = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
    const masterG = off.createGain();
    masterG.gain.value = this.masterGain.gain.value;
    masterG.connect(off.destination);

    const ir = this._makeIR(off, 2.0, 2.5);
    const anySolo = this.anySoloed();

    for (const t of this.tracks) {
      if (t.clips.length === 0) continue;
      t.cloneGraphForOffline(off, masterG, ir, anySolo);
    }

    progressCb && progressCb(0.3);
    const rendered = await off.startRendering();
    progressCb && progressCb(1.0);
    return audioBufferToWav(rendered);
  }
}
