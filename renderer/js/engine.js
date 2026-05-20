import { clamp } from './utils.js';
import { audioBufferToWav } from './wav.js';

export class Engine {
  constructor() {
    this.ctx = null;
    this.masterIn = null;
    this.masterEqLow = null;
    this.masterEqMid = null;
    this.masterEqHigh = null;
    this.masterComp = null;
    this.masterLimiter = null;
    this.masterLimiterBypass = null;
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

    this.masterSettings = {
      eqLow: 0, eqMid: 0, eqHigh: 0,
      compThreshold: -18, compRatio: 2, compAttack: 0.01, compRelease: 0.2,
      limiterThreshold: -1, limiterEnabled: true,
    };

    this.onTimeUpdate = () => {};
    this.onPlayState = () => {};
  }

  ensure() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.masterIn = this.ctx.createGain();

    this.masterEqLow = this.ctx.createBiquadFilter();
    this.masterEqLow.type = 'lowshelf';
    this.masterEqLow.frequency.value = 200;
    this.masterEqLow.gain.value = this.masterSettings.eqLow;

    this.masterEqMid = this.ctx.createBiquadFilter();
    this.masterEqMid.type = 'peaking';
    this.masterEqMid.frequency.value = 1500;
    this.masterEqMid.Q.value = 1;
    this.masterEqMid.gain.value = this.masterSettings.eqMid;

    this.masterEqHigh = this.ctx.createBiquadFilter();
    this.masterEqHigh.type = 'highshelf';
    this.masterEqHigh.frequency.value = 5000;
    this.masterEqHigh.gain.value = this.masterSettings.eqHigh;

    this.masterComp = this.ctx.createDynamicsCompressor();
    this.masterComp.threshold.value = this.masterSettings.compThreshold;
    this.masterComp.ratio.value = this.masterSettings.compRatio;
    this.masterComp.attack.value = this.masterSettings.compAttack;
    this.masterComp.release.value = this.masterSettings.compRelease;
    this.masterComp.knee.value = 6;

    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.value = this.masterSettings.limiterThreshold;
    this.masterLimiter.ratio.value = 20;
    this.masterLimiter.attack.value = 0.001;
    this.masterLimiter.release.value = 0.05;
    this.masterLimiter.knee.value = 0;

    this.masterLimiterBypass = this.ctx.createGain();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;

    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;

    this.masterIn
      .connect(this.masterEqLow)
      .connect(this.masterEqMid)
      .connect(this.masterEqHigh)
      .connect(this.masterComp);
    this._wireMasterLimiter();
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);

    this.reverbIR = this._makeIR(this.ctx, 2.0, 2.5);
  }

  _wireMasterLimiter() {
    try { this.masterComp.disconnect(); } catch (e) {}
    try { this.masterLimiter.disconnect(); } catch (e) {}
    try { this.masterLimiterBypass.disconnect(); } catch (e) {}
    if (this.masterSettings.limiterEnabled) {
      this.masterComp.connect(this.masterLimiter).connect(this.masterGain);
    } else {
      this.masterComp.connect(this.masterLimiterBypass).connect(this.masterGain);
    }
  }

  applyMasterSettings(s) {
    Object.assign(this.masterSettings, s);
    if (!this.ctx) return;
    this.masterEqLow.gain.value = this.masterSettings.eqLow;
    this.masterEqMid.gain.value = this.masterSettings.eqMid;
    this.masterEqHigh.gain.value = this.masterSettings.eqHigh;
    this.masterComp.threshold.value = this.masterSettings.compThreshold;
    this.masterComp.ratio.value = this.masterSettings.compRatio;
    this.masterComp.attack.value = this.masterSettings.compAttack;
    this.masterComp.release.value = this.masterSettings.compRelease;
    this.masterLimiter.threshold.value = this.masterSettings.limiterThreshold;
    this._wireMasterLimiter();
  }

  resetMasterSettings() {
    this.applyMasterSettings({
      eqLow: 0, eqMid: 0, eqHigh: 0,
      compThreshold: -18, compRatio: 2, compAttack: 0.01, compRelease: 0.2,
      limiterThreshold: -1, limiterEnabled: true,
    });
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
    track.buildGraph(this.ctx, this.masterIn, this.reverbIR);
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
    this.tracks.forEach(t => { max = Math.max(max, t.effectiveDuration()); });
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
      if (this.currentPos() >= this.totalDuration()) { this.stop(); return; }
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

    const masterIn = off.createGain();
    const eqLow = off.createBiquadFilter(); eqLow.type = 'lowshelf'; eqLow.frequency.value = 200; eqLow.gain.value = this.masterSettings.eqLow;
    const eqMid = off.createBiquadFilter(); eqMid.type = 'peaking'; eqMid.frequency.value = 1500; eqMid.Q.value = 1; eqMid.gain.value = this.masterSettings.eqMid;
    const eqHigh = off.createBiquadFilter(); eqHigh.type = 'highshelf'; eqHigh.frequency.value = 5000; eqHigh.gain.value = this.masterSettings.eqHigh;
    const comp = off.createDynamicsCompressor();
    comp.threshold.value = this.masterSettings.compThreshold;
    comp.ratio.value = this.masterSettings.compRatio;
    comp.attack.value = this.masterSettings.compAttack;
    comp.release.value = this.masterSettings.compRelease;
    comp.knee.value = 6;
    const limiter = off.createDynamicsCompressor();
    limiter.threshold.value = this.masterSettings.limiterThreshold;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;
    limiter.knee.value = 0;
    const masterG = off.createGain();
    masterG.gain.value = this.masterGain ? this.masterGain.gain.value : 1;

    masterIn.connect(eqLow).connect(eqMid).connect(eqHigh).connect(comp);
    if (this.masterSettings.limiterEnabled) comp.connect(limiter).connect(masterG);
    else comp.connect(masterG);
    masterG.connect(off.destination);

    const ir = this._makeIR(off, 2.0, 2.5);
    const anySolo = this.anySoloed();

    for (const t of this.tracks) {
      if (t.clips.length === 0) continue;
      t.cloneGraphForOffline(off, masterIn, ir, anySolo);
    }

    progressCb && progressCb(0.3);
    const rendered = await off.startRendering();
    progressCb && progressCb(1.0);
    return audioBufferToWav(rendered);
  }
}
