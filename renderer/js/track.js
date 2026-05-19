import { TRACK_COLORS } from './utils.js';
import { Plugin } from './plugins/base.js';
import { getPluginDef } from './plugins/registry.js';

let trackIdCounter = 0;

export class Track {
  constructor(file, buffer) {
    this.id = ++trackIdCounter;
    this.name = file.name.replace(/\.[^.]+$/, '');
    this.color = TRACK_COLORS[(this.id - 1) % TRACK_COLORS.length];
    this.buffer = buffer;
    this.filename = file.name;

    this.gain = 1.0;
    this.pan = 0;
    this.muted = false;
    this.soloed = false;
    this.offset = 0;

    this.trimStart = 0;
    this.trimEnd = 0;
    this.fadeIn = 0;
    this.fadeOut = 0;

    this.hpfFreq = 20;
    this.eqLow = 0;
    this.eqMid = 0;
    this.eqHigh = 0;
    this.compThreshold = -24;
    this.compRatio = 4;
    this.compAttack = 0.003;
    this.compRelease = 0.25;
    this.reverbMix = 0;

    this.pitchCorrected = false;
    this.pluginChain = [];

    this.selectionStart = null;
    this.selectionEnd = null;

    this.fxOpen = false;
    this.editOpen = false;

    this.fadeGain = null;
    this.hpf = null;
    this.eqL = null; this.eqM = null; this.eqH = null;
    this.comp = null;
    this.chainIn = null;
    this.chainOut = null;
    this.mixIn = null;
    this.dryGain = null; this.wetGain = null;
    this.reverb = null;
    this.gainNode = null;
    this.panNode = null;
    this.outGain = null;
    this.analyser = null;
    this.source = null;

    this.ctx = null;
    this.el = null;
    this.canvas = null;
    this.peaks = null;
  }

  effectiveDuration() {
    if (!this.buffer) return 0;
    return Math.max(0, this.buffer.duration - this.trimStart - this.trimEnd);
  }

  buildGraph(ctx, dest, reverbIR) {
    this.ctx = ctx;
    this.fadeGain = ctx.createGain();
    this.fadeGain.gain.value = 1;

    this.hpf = ctx.createBiquadFilter();
    this.hpf.type = 'highpass';
    this.hpf.frequency.value = this.hpfFreq;
    this.hpf.Q.value = 0.7;

    this.eqL = ctx.createBiquadFilter();
    this.eqL.type = 'lowshelf';
    this.eqL.frequency.value = 200;
    this.eqL.gain.value = this.eqLow;

    this.eqM = ctx.createBiquadFilter();
    this.eqM.type = 'peaking';
    this.eqM.frequency.value = 1000;
    this.eqM.Q.value = 1.0;
    this.eqM.gain.value = this.eqMid;

    this.eqH = ctx.createBiquadFilter();
    this.eqH.type = 'highshelf';
    this.eqH.frequency.value = 4000;
    this.eqH.gain.value = this.eqHigh;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = this.compThreshold;
    this.comp.ratio.value = this.compRatio;
    this.comp.attack.value = this.compAttack;
    this.comp.release.value = this.compRelease;
    this.comp.knee.value = 6;

    this.chainIn = ctx.createGain();
    this.chainOut = ctx.createGain();

    this.mixIn = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = reverbIR;
    this.gainNode = ctx.createGain();
    this.panNode = ctx.createStereoPanner();
    this.outGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;

    this.fadeGain.connect(this.hpf)
      .connect(this.eqL).connect(this.eqM).connect(this.eqH)
      .connect(this.comp).connect(this.chainIn);
    this.chainOut.connect(this.mixIn);
    this.mixIn.connect(this.dryGain).connect(this.gainNode);
    this.mixIn.connect(this.reverb).connect(this.wetGain).connect(this.gainNode);
    this.gainNode.connect(this.panNode).connect(this.outGain).connect(dest);
    this.outGain.connect(this.analyser);

    this.panNode.pan.value = this.pan;
    this._applyMix();
    this._rewirePluginChain();
  }

  _rewirePluginChain() {
    if (!this.chainIn || !this.chainOut) return;
    try { this.chainIn.disconnect(); } catch (e) {}
    this.pluginChain.forEach(p => {
      if (p.nodes) { try { p.nodes.output.disconnect(); } catch (e) {} }
    });
    let prev = this.chainIn;
    for (const plugin of this.pluginChain) {
      if (plugin.bypassed || !plugin.nodes) continue;
      prev.connect(plugin.nodes.input);
      prev = plugin.nodes.output;
    }
    prev.connect(this.chainOut);
  }

  addPlugin(pluginDef) {
    if (!this.ctx) return null;
    const plugin = new Plugin(pluginDef).attach(this.ctx);
    this.pluginChain.push(plugin);
    this._rewirePluginChain();
    return plugin;
  }

  removePlugin(index) {
    const plugin = this.pluginChain[index];
    if (!plugin) return;
    plugin.detach();
    this.pluginChain.splice(index, 1);
    this._rewirePluginChain();
  }

  movePlugin(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.pluginChain.length) return;
    if (toIndex < 0 || toIndex >= this.pluginChain.length) return;
    const [p] = this.pluginChain.splice(fromIndex, 1);
    this.pluginChain.splice(toIndex, 0, p);
    this._rewirePluginChain();
  }

  togglePluginBypass(index) {
    const p = this.pluginChain[index];
    if (!p) return;
    p.setBypass(!p.bypassed);
    this._rewirePluginChain();
  }

  _applyMix() {
    if (this.dryGain) this.dryGain.gain.value = 1 - this.reverbMix;
    if (this.wetGain) this.wetGain.gain.value = this.reverbMix;
    if (this.gainNode) this.gainNode.gain.value = this.gain;
  }

  applyAudibility(anySoloed) {
    if (!this.outGain) return;
    const audible = this.muted ? false : (anySoloed ? this.soloed : true);
    this.outGain.gain.value = audible ? 1 : 0;
  }

  startSource(ctx, when, globalPos) {
    if (!this.buffer) return;
    const effDur = this.effectiveDuration();
    if (effDur <= 0) return;
    const trackEnd = this.offset + effDur;
    if (globalPos >= trackEnd) return;

    let bufOffset, startDelay, localStart, playDuration;
    if (globalPos < this.offset) {
      bufOffset = this.trimStart;
      startDelay = this.offset - globalPos;
      localStart = 0;
      playDuration = effDur;
    } else {
      bufOffset = this.trimStart + (globalPos - this.offset);
      startDelay = 0;
      localStart = globalPos - this.offset;
      playDuration = effDur - localStart;
    }

    this._scheduleFade(when, startDelay, localStart, playDuration, effDur);

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.fadeGain);
    try { src.start(when + startDelay, bufOffset, playDuration); } catch (e) {}
    this.source = src;
  }

  _scheduleFade(when, startDelay, localStart, playDuration, effDur) {
    if (!this.fadeGain) return;
    const g = this.fadeGain.gain;
    const atStart = when + startDelay;
    const fIn = Math.min(this.fadeIn, effDur);
    const fOut = Math.min(this.fadeOut, effDur);

    let initial;
    if (fIn > 0 && localStart < fIn) initial = localStart / fIn;
    else if (fOut > 0 && localStart > effDur - fOut) initial = Math.max(0, (effDur - localStart) / fOut);
    else initial = 1;

    g.cancelScheduledValues(when);
    g.setValueAtTime(initial, atStart);

    if (fIn > 0 && localStart < fIn) {
      const fadeInEndAbs = atStart + (fIn - localStart);
      g.linearRampToValueAtTime(1, fadeInEndAbs);
    }
    if (fOut > 0) {
      const fadeOutStartLocal = effDur - fOut;
      if (localStart < fadeOutStartLocal) {
        const fadeOutStartAbs = atStart + (fadeOutStartLocal - localStart);
        g.setValueAtTime(1, fadeOutStartAbs);
      }
      const endAbs = atStart + playDuration;
      g.linearRampToValueAtTime(0, endAbs);
    }
  }

  stopSource() {
    if (this.source) {
      try { this.source.stop(); } catch (e) {}
      try { this.source.disconnect(); } catch (e) {}
      this.source = null;
    }
  }

  disconnect() {
    this.stopSource();
    this.pluginChain.forEach(p => p.detach());
    const nodes = [
      this.fadeGain, this.hpf, this.eqL, this.eqM, this.eqH, this.comp,
      this.chainIn, this.chainOut,
      this.mixIn, this.dryGain, this.wetGain, this.reverb,
      this.gainNode, this.panNode, this.outGain, this.analyser,
    ];
    nodes.forEach(n => { if (n) { try { n.disconnect(); } catch (e) {} } });
  }

  peakLevel() {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    return peak;
  }

  computePeaks(target) {
    if (!this.buffer) return;
    if (this.peaks && this.peaks.length === target) return;
    const data = this.buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / target));
    const peaks = new Float32Array(target);
    for (let i = 0; i < target; i++) {
      const s = i * block;
      const e = Math.min(s + block, data.length);
      let m = 0;
      for (let j = s; j < e; j++) {
        const v = Math.abs(data[j]);
        if (v > m) m = v;
      }
      peaks[i] = m;
    }
    this.peaks = peaks;
  }

  invalidatePeaks() { this.peaks = null; }

  cloneGraph(offCtx, masterDest, ir, anySoloed) {
    const fade = offCtx.createGain();
    fade.gain.value = 1;

    const hpf = offCtx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = this.hpfFreq;
    hpf.Q.value = 0.7;

    const eqL = offCtx.createBiquadFilter();
    eqL.type = 'lowshelf';
    eqL.frequency.value = 200;
    eqL.gain.value = this.eqLow;

    const eqM = offCtx.createBiquadFilter();
    eqM.type = 'peaking';
    eqM.frequency.value = 1000;
    eqM.Q.value = 1.0;
    eqM.gain.value = this.eqMid;

    const eqH = offCtx.createBiquadFilter();
    eqH.type = 'highshelf';
    eqH.frequency.value = 4000;
    eqH.gain.value = this.eqHigh;

    const comp = offCtx.createDynamicsCompressor();
    comp.threshold.value = this.compThreshold;
    comp.ratio.value = this.compRatio;
    comp.attack.value = this.compAttack;
    comp.release.value = this.compRelease;
    comp.knee.value = 6;

    const chainOutOff = offCtx.createGain();

    const mixIn = offCtx.createGain();
    const dry = offCtx.createGain();
    dry.gain.value = 1 - this.reverbMix;
    const wet = offCtx.createGain();
    wet.gain.value = this.reverbMix;
    const reverb = offCtx.createConvolver();
    reverb.buffer = ir;
    const gainN = offCtx.createGain();
    gainN.gain.value = this.gain;
    const panN = offCtx.createStereoPanner();
    panN.pan.value = this.pan;
    const outG = offCtx.createGain();
    const audible = this.muted ? false : (anySoloed ? this.soloed : true);
    outG.gain.value = audible ? 1 : 0;

    fade.connect(hpf).connect(eqL).connect(eqM).connect(eqH).connect(comp);

    let last = comp;
    for (const plugin of this.pluginChain) {
      if (plugin.bypassed) continue;
      const cloned = plugin.cloneForOffline(offCtx);
      last.connect(cloned.nodes.input);
      last = cloned.nodes.output;
    }
    last.connect(chainOutOff);
    chainOutOff.connect(mixIn);

    mixIn.connect(dry).connect(gainN);
    mixIn.connect(reverb).connect(wet).connect(gainN);
    gainN.connect(panN).connect(outG).connect(masterDest);

    const effDur = this.effectiveDuration();
    const fIn = Math.min(this.fadeIn, effDur);
    const fOut = Math.min(this.fadeOut, effDur);
    const start = this.offset;
    const end = start + effDur;

    if (fIn > 0) {
      fade.gain.setValueAtTime(0, start);
      fade.gain.linearRampToValueAtTime(1, start + fIn);
    } else {
      fade.gain.setValueAtTime(1, start);
    }
    if (fOut > 0) {
      fade.gain.setValueAtTime(1, Math.max(start + fIn, end - fOut));
      fade.gain.linearRampToValueAtTime(0, end);
    }

    const src = offCtx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(fade);
    return { src, bufOffset: this.trimStart, duration: effDur };
  }

  serialize() {
    return {
      name: this.name,
      filename: this.filename,
      color: this.color,
      gain: this.gain,
      pan: this.pan,
      muted: this.muted,
      soloed: this.soloed,
      offset: this.offset,
      trimStart: this.trimStart,
      trimEnd: this.trimEnd,
      fadeIn: this.fadeIn,
      fadeOut: this.fadeOut,
      hpfFreq: this.hpfFreq,
      eqLow: this.eqLow, eqMid: this.eqMid, eqHigh: this.eqHigh,
      compThreshold: this.compThreshold,
      compRatio: this.compRatio,
      compAttack: this.compAttack,
      compRelease: this.compRelease,
      reverbMix: this.reverbMix,
      pitchCorrected: this.pitchCorrected,
      pluginChain: this.pluginChain.map(p => p.serialize()),
    };
  }

  applySerialized(s) {
    const keys = [
      'name','color','gain','pan','muted','soloed','offset',
      'trimStart','trimEnd','fadeIn','fadeOut',
      'hpfFreq','eqLow','eqMid','eqHigh',
      'compThreshold','compRatio','compAttack','compRelease',
      'reverbMix','pitchCorrected'
    ];
    keys.forEach(k => { if (s[k] !== undefined) this[k] = s[k]; });

    if (this.hpf) this.hpf.frequency.value = this.hpfFreq;
    if (this.eqL) this.eqL.gain.value = this.eqLow;
    if (this.eqM) this.eqM.gain.value = this.eqMid;
    if (this.eqH) this.eqH.gain.value = this.eqHigh;
    if (this.comp) {
      this.comp.threshold.value = this.compThreshold;
      this.comp.ratio.value = this.compRatio;
      this.comp.attack.value = this.compAttack;
      this.comp.release.value = this.compRelease;
    }
    if (this.panNode) this.panNode.pan.value = this.pan;
    this._applyMix();

    this.pluginChain.forEach(p => p.detach());
    this.pluginChain = [];
    if (Array.isArray(s.pluginChain) && this.ctx) {
      for (const ps of s.pluginChain) {
        const def = getPluginDef(ps.id);
        if (!def) continue;
        const plugin = new Plugin(def, ps.params).attach(this.ctx);
        plugin.bypassed = !!ps.bypassed;
        this.pluginChain.push(plugin);
      }
      this._rewirePluginChain();
    }
  }

  replaceBuffer(newBuffer) {
    this.buffer = newBuffer;
    this.peaks = null;
    if (this.trimStart + this.trimEnd >= newBuffer.duration) {
      this.trimStart = 0;
      this.trimEnd = 0;
    }
    this.selectionStart = null;
    this.selectionEnd = null;
  }

  hasSelection() {
    return this.selectionStart !== null
        && this.selectionEnd !== null
        && this.selectionEnd > this.selectionStart;
  }

  clearSelection() {
    this.selectionStart = null;
    this.selectionEnd = null;
  }

  silenceRange(start, end) {
    if (!this.buffer) return;
    const sr = this.buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(start * sr));
    const endSample = Math.min(this.buffer.length, Math.floor(end * sr));
    const fade = Math.min(64, Math.floor((endSample - startSample) / 2));
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      const data = this.buffer.getChannelData(c);
      for (let i = startSample; i < endSample; i++) data[i] = 0;
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        if (startSample - 1 - i >= 0) data[startSample - 1 - i] *= (1 - k);
        if (endSample + i < this.buffer.length) data[endSample + i] *= k;
      }
    }
    this.peaks = null;
  }

  applyGainToRange(start, end, factor) {
    if (!this.buffer) return;
    const sr = this.buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(start * sr));
    const endSample = Math.min(this.buffer.length, Math.floor(end * sr));
    const fade = Math.min(128, Math.floor((endSample - startSample) / 4));
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      const data = this.buffer.getChannelData(c);
      for (let i = startSample + fade; i < endSample - fade; i++) data[i] *= factor;
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        const mix = 1 + (factor - 1) * k;
        if (startSample + i < data.length) data[startSample + i] *= mix;
        if (endSample - 1 - i >= 0) data[endSample - 1 - i] *= mix;
      }
    }
    this.peaks = null;
  }

  applyFadeToRange(start, end, type) {
    if (!this.buffer) return;
    const sr = this.buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(start * sr));
    const endSample = Math.min(this.buffer.length, Math.floor(end * sr));
    const length = endSample - startSample;
    if (length <= 0) return;
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      const data = this.buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        const ratio = i / length;
        const factor = type === 'in' ? ratio : (1 - ratio);
        data[startSample + i] *= factor;
      }
    }
    this.peaks = null;
  }

  deleteRange(start, end) {
    if (!this.buffer) return;
    const sr = this.buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(start * sr));
    const endSample = Math.min(this.buffer.length, Math.floor(end * sr));
    const removeLen = endSample - startSample;
    if (removeLen <= 0) return;
    const newLen = this.buffer.length - removeLen;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const newBuf = ctx.createBuffer(this.buffer.numberOfChannels, newLen, sr);
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      const src = this.buffer.getChannelData(c);
      const dst = newBuf.getChannelData(c);
      for (let i = 0; i < startSample; i++) dst[i] = src[i];
      for (let i = endSample; i < this.buffer.length; i++) {
        dst[startSample + (i - endSample)] = src[i];
      }
      const xfade = Math.min(64, Math.floor(removeLen / 2));
      for (let i = 0; i < xfade && startSample - xfade + i >= 0 && startSample + i < newLen; i++) {
        const k = i / xfade;
        dst[startSample - xfade + i] *= (1 - k);
      }
    }
    ctx.close();
    this.replaceBuffer(newBuf);
  }

  insertSilence(at, durationSec) {
    if (!this.buffer) return;
    const sr = this.buffer.sampleRate;
    const atSample = Math.max(0, Math.min(this.buffer.length, Math.floor(at * sr)));
    const insertLen = Math.floor(durationSec * sr);
    if (insertLen <= 0) return;
    const newLen = this.buffer.length + insertLen;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const newBuf = ctx.createBuffer(this.buffer.numberOfChannels, newLen, sr);
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      const src = this.buffer.getChannelData(c);
      const dst = newBuf.getChannelData(c);
      for (let i = 0; i < atSample; i++) dst[i] = src[i];
      for (let i = atSample; i < this.buffer.length; i++) {
        dst[i + insertLen] = src[i];
      }
    }
    ctx.close();
    this.replaceBuffer(newBuf);
  }

  normalizeRange(start, end) {
    if (!this.buffer) return;
    const sr = this.buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(start * sr));
    const endSample = Math.min(this.buffer.length, Math.floor(end * sr));
    let peak = 0;
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      const data = this.buffer.getChannelData(c);
      for (let i = startSample; i < endSample; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
    }
    if (peak < 1e-6) return;
    const factor = 0.95 / peak;
    this.applyGainToRange(start, end, factor);
  }

  async applyPitchToRange(start, end, options, progressCb) {
    if (!this.buffer) return;
    const { correctPitchRange } = await import('./pitch.js');
    await correctPitchRange(this.buffer, start, end, options, progressCb);
    this.peaks = null;
    this.pitchCorrected = true;
  }

  async applyPitchToRangeWithNotes(start, end, notes, options, progressCb) {
    if (!this.buffer) return;
    const { correctPitchWithNotes } = await import('./pitch.js');
    const sr = this.buffer.sampleRate;
    const numCh = this.buffer.numberOfChannels;
    const startSample = Math.max(0, Math.floor(start * sr));
    const endSample = Math.min(this.buffer.length, Math.floor(end * sr));
    const rangeLen = endSample - startSample;
    if (rangeLen < 2048) return;
    const padSamples = Math.min(4096, startSample, this.buffer.length - endSample);
    const subLen = rangeLen + padSamples * 2;
    const subStart = startSample - padSamples;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const subBuf = ctx.createBuffer(numCh, subLen, sr);
    for (let c = 0; c < numCh; c++) {
      const src = this.buffer.getChannelData(c);
      const dst = subBuf.getChannelData(c);
      for (let i = 0; i < subLen; i++) dst[i] = src[subStart + i];
    }
    const offsetTime = subStart / sr;
    const shiftedNotes = notes.map(n => ({
      startTime: n.startTime - offsetTime,
      endTime: n.endTime - offsetTime,
      targetMidi: n.targetMidi,
      detectedMidi: n.detectedMidi,
    }));
    const correctedSub = await correctPitchWithNotes(subBuf, shiftedNotes, options, progressCb);
    const fadeLen = Math.min(512, Math.floor(rangeLen / 8), padSamples);
    for (let c = 0; c < numCh; c++) {
      const src = correctedSub.getChannelData(c);
      const dst = this.buffer.getChannelData(c);
      for (let i = 0; i < rangeLen; i++) {
        const targetIdx = startSample + i;
        const srcIdx = padSamples + i;
        let mix = 1;
        if (fadeLen > 0) {
          if (i < fadeLen) mix = i / fadeLen;
          else if (i >= rangeLen - fadeLen) mix = (rangeLen - i) / fadeLen;
        }
        dst[targetIdx] = src[srcIdx] * mix + dst[targetIdx] * (1 - mix);
      }
    }
    ctx.close();
    this.peaks = null;
    this.pitchCorrected = true;
  }
}
