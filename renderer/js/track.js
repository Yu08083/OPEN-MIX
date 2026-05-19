import { TRACK_COLORS } from './utils.js';
import { AudioClip, MidiClip, deserializeClip } from './clip.js';
import { Plugin } from './plugins/base.js';
import { getPluginDef } from './plugins/registry.js';

let trackIdCounter = 0;

export class Track {
  constructor(name, color, type) {
    this.id = ++trackIdCounter;
    this.name = name || `トラック ${this.id}`;
    this.color = color || TRACK_COLORS[(this.id - 1) % TRACK_COLORS.length];
    this.type = type || 'audio';

    this.gain = 1.0;
    this.pan = 0;
    this.muted = false;
    this.soloed = false;

    this.clips = [];

    this.hpfFreq = 20;
    this.eqLow = 0;
    this.eqMid = 0;
    this.eqHigh = 0;
    this.compThreshold = -24;
    this.compRatio = 4;
    this.compAttack = 0.003;
    this.compRelease = 0.25;
    this.reverbMix = 0;

    this.pluginChain = [];

    this.fxOpen = false;
    this.editOpen = false;

    this.hpf = null; this.eqL = null; this.eqM = null; this.eqH = null;
    this.comp = null;
    this.chainIn = null; this.chainOut = null;
    this.mixIn = null;
    this.dryGain = null; this.wetGain = null;
    this.reverb = null;
    this.gainNode = null;
    this.panNode = null;
    this.outGain = null;
    this.analyser = null;
    this.sources = [];
    this.synthNodes = [];

    this.ctx = null;
    this.el = null;
  }

  effectiveDuration() {
    let max = 0;
    for (const c of this.clips) {
      const end = c.endTime();
      if (end > max) max = end;
    }
    return max;
  }

  addClip(clip) { this.clips.push(clip); return clip; }

  removeClip(clip) {
    const idx = this.clips.indexOf(clip);
    if (idx >= 0) this.clips.splice(idx, 1);
  }

  buildGraph(ctx, dest, reverbIR) {
    this.ctx = ctx;
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

    this.hpf.connect(this.eqL).connect(this.eqM).connect(this.eqH).connect(this.comp).connect(this.chainIn);
    this.chainOut.connect(this.mixIn);
    this.mixIn.connect(this.dryGain).connect(this.gainNode);
    this.mixIn.connect(this.reverb).connect(this.wetGain).connect(this.gainNode);
    this.gainNode.connect(this.panNode).connect(this.outGain).connect(dest);
    this.outGain.connect(this.analyser);

    this.panNode.pan.value = this.pan;
    this._applyMix();
    this._rewirePluginChain();
  }

  getInputNode() { return this.hpf; }

  _rewirePluginChain() {
    if (!this.chainIn || !this.chainOut) return;
    try { this.chainIn.disconnect(); } catch (e) {}
    this.pluginChain.forEach(p => { if (p.nodes) { try { p.nodes.output.disconnect(); } catch (e) {} } });
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

  scheduleClips(ctx, when, globalPos) {
    if (this.type === 'audio') {
      for (const clip of this.clips) {
        this._scheduleAudioClip(ctx, clip, when, globalPos);
      }
    } else if (this.type === 'midi') {
      for (const clip of this.clips) {
        this._scheduleMidiClip(ctx, clip, when, globalPos);
      }
    }
  }

  _scheduleAudioClip(ctx, clip, when, globalPos) {
    if (!clip.buffer) return;
    const clipStart = clip.offset;
    const clipEnd = clip.offset + clip.duration;
    if (globalPos >= clipEnd) return;

    let startDelay, bufOffset, playDuration, localStart;
    if (globalPos < clipStart) {
      startDelay = clipStart - globalPos;
      bufOffset = clip.trimStart;
      localStart = 0;
      playDuration = clip.duration;
    } else {
      startDelay = 0;
      const into = globalPos - clipStart;
      bufOffset = clip.trimStart + into;
      localStart = into;
      playDuration = clip.duration - into;
    }
    if (playDuration <= 0) return;

    const fade = ctx.createGain();
    fade.gain.value = 1;
    fade.connect(this.hpf);

    const fIn = Math.min(clip.fadeIn, clip.duration);
    const fOut = Math.min(clip.fadeOut, clip.duration);
    const g = fade.gain;
    const atStart = when + startDelay;
    let initial;
    if (fIn > 0 && localStart < fIn) initial = localStart / fIn;
    else if (fOut > 0 && localStart > clip.duration - fOut) initial = Math.max(0, (clip.duration - localStart) / fOut);
    else initial = 1;
    g.cancelScheduledValues(when);
    g.setValueAtTime(initial * clip.gain, atStart);
    if (fIn > 0 && localStart < fIn) {
      g.linearRampToValueAtTime(clip.gain, atStart + (fIn - localStart));
    }
    if (fOut > 0) {
      const foLocal = clip.duration - fOut;
      if (localStart < foLocal) {
        g.setValueAtTime(clip.gain, atStart + (foLocal - localStart));
      }
      g.linearRampToValueAtTime(0, atStart + playDuration);
    }

    const src = ctx.createBufferSource();
    src.buffer = clip.buffer;
    src.connect(fade);
    try { src.start(atStart, bufOffset, playDuration); } catch (e) {}
    this.sources.push(src);
    this.synthNodes.push(fade);
  }

  _scheduleMidiClip(ctx, clip, when, globalPos) {
    const clipStart = clip.offset;
    const clipEnd = clip.offset + clip.duration;
    if (globalPos >= clipEnd) return;

    for (const note of clip.notes) {
      const noteStart = clipStart + note.time;
      const noteEnd = noteStart + note.dur;
      if (noteEnd <= globalPos) continue;

      let startDelay = noteStart - globalPos;
      let dur = note.dur;
      if (startDelay < 0) {
        dur += startDelay;
        startDelay = 0;
      }
      if (dur <= 0) continue;

      const at = when + startDelay;
      const freq = 440 * Math.pow(2, (note.midi - 69) / 12);

      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = freq;
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = freq * 0.5;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 2000;
      filt.Q.value = 1.5;
      const env = ctx.createGain();
      const peak = (note.velocity || 0.7) * clip.gain * 0.25;

      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(peak, at + 0.008);
      env.gain.linearRampToValueAtTime(peak * 0.6, at + 0.08);
      env.gain.setValueAtTime(peak * 0.6, at + Math.max(0.08, dur - 0.05));
      env.gain.linearRampToValueAtTime(0, at + dur);

      osc1.connect(filt);
      osc2.connect(filt);
      filt.connect(env);
      env.connect(this.hpf);
      osc1.start(at); osc1.stop(at + dur + 0.02);
      osc2.start(at); osc2.stop(at + dur + 0.02);
      this.synthNodes.push(env, filt, osc1, osc2);
    }
  }

  stopAllSources() {
    this.sources.forEach(s => { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} });
    this.sources = [];
    this.synthNodes.forEach(n => { try { n.disconnect(); } catch (e) {} });
    this.synthNodes = [];
  }

  disconnect() {
    this.stopAllSources();
    this.pluginChain.forEach(p => p.detach());
    const nodes = [
      this.hpf, this.eqL, this.eqM, this.eqH, this.comp,
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

  cloneGraphForOffline(offCtx, masterDest, ir, anySoloed) {
    const hpf = offCtx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = this.hpfFreq; hpf.Q.value = 0.7;
    const eqL = offCtx.createBiquadFilter();
    eqL.type = 'lowshelf'; eqL.frequency.value = 200; eqL.gain.value = this.eqLow;
    const eqM = offCtx.createBiquadFilter();
    eqM.type = 'peaking'; eqM.frequency.value = 1000; eqM.Q.value = 1.0; eqM.gain.value = this.eqMid;
    const eqH = offCtx.createBiquadFilter();
    eqH.type = 'highshelf'; eqH.frequency.value = 4000; eqH.gain.value = this.eqHigh;
    const comp = offCtx.createDynamicsCompressor();
    comp.threshold.value = this.compThreshold;
    comp.ratio.value = this.compRatio;
    comp.attack.value = this.compAttack;
    comp.release.value = this.compRelease;
    comp.knee.value = 6;
    const chainOutOff = offCtx.createGain();
    const mixIn = offCtx.createGain();
    const dry = offCtx.createGain(); dry.gain.value = 1 - this.reverbMix;
    const wet = offCtx.createGain(); wet.gain.value = this.reverbMix;
    const reverb = offCtx.createConvolver(); reverb.buffer = ir;
    const gainN = offCtx.createGain(); gainN.gain.value = this.gain;
    const panN = offCtx.createStereoPanner(); panN.pan.value = this.pan;
    const outG = offCtx.createGain();
    const audible = this.muted ? false : (anySoloed ? this.soloed : true);
    outG.gain.value = audible ? 1 : 0;

    hpf.connect(eqL).connect(eqM).connect(eqH).connect(comp);
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

    const scheduleAt = 0;
    if (this.type === 'audio') {
      for (const clip of this.clips) {
        if (!clip.buffer) continue;
        const fade = offCtx.createGain();
        fade.connect(hpf);
        const fIn = Math.min(clip.fadeIn, clip.duration);
        const fOut = Math.min(clip.fadeOut, clip.duration);
        if (fIn > 0) {
          fade.gain.setValueAtTime(0, clip.offset);
          fade.gain.linearRampToValueAtTime(clip.gain, clip.offset + fIn);
        } else {
          fade.gain.setValueAtTime(clip.gain, clip.offset);
        }
        if (fOut > 0) {
          const foAt = clip.offset + clip.duration - fOut;
          fade.gain.setValueAtTime(clip.gain, Math.max(clip.offset + fIn, foAt));
          fade.gain.linearRampToValueAtTime(0, clip.offset + clip.duration);
        }
        const src = offCtx.createBufferSource();
        src.buffer = clip.buffer;
        src.connect(fade);
        src.start(clip.offset, clip.trimStart, clip.duration);
      }
    } else if (this.type === 'midi') {
      for (const clip of this.clips) {
        for (const note of clip.notes) {
          const at = clip.offset + note.time;
          const dur = note.dur;
          const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
          const osc1 = offCtx.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = freq;
          const osc2 = offCtx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = freq * 0.5;
          const filt = offCtx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 2000; filt.Q.value = 1.5;
          const env = offCtx.createGain();
          const peak = (note.velocity || 0.7) * clip.gain * 0.25;
          env.gain.setValueAtTime(0, at);
          env.gain.linearRampToValueAtTime(peak, at + 0.008);
          env.gain.linearRampToValueAtTime(peak * 0.6, at + 0.08);
          env.gain.setValueAtTime(peak * 0.6, at + Math.max(0.08, dur - 0.05));
          env.gain.linearRampToValueAtTime(0, at + dur);
          osc1.connect(filt); osc2.connect(filt); filt.connect(env); env.connect(hpf);
          osc1.start(at); osc1.stop(at + dur + 0.02);
          osc2.start(at); osc2.stop(at + dur + 0.02);
        }
      }
    }
  }

  serialize() {
    return {
      name: this.name,
      color: this.color,
      type: this.type,
      gain: this.gain,
      pan: this.pan,
      muted: this.muted,
      soloed: this.soloed,
      hpfFreq: this.hpfFreq,
      eqLow: this.eqLow, eqMid: this.eqMid, eqHigh: this.eqHigh,
      compThreshold: this.compThreshold,
      compRatio: this.compRatio,
      compAttack: this.compAttack,
      compRelease: this.compRelease,
      reverbMix: this.reverbMix,
      pluginChain: this.pluginChain.map(p => p.serialize()),
      clips: this.clips.map(c => c.serialize()),
    };
  }

  applySerialized(s, bufferByName) {
    const keys = ['name','color','gain','pan','muted','soloed',
      'hpfFreq','eqLow','eqMid','eqHigh',
      'compThreshold','compRatio','compAttack','compRelease','reverbMix'];
    keys.forEach(k => { if (s[k] !== undefined) this[k] = s[k]; });
    if (s.type) this.type = s.type;

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

    this.clips = [];
    if (Array.isArray(s.clips)) {
      for (const cd of s.clips) {
        const buffer = cd.type === 'audio' && bufferByName ? bufferByName[cd.name] : null;
        const clip = deserializeClip(cd, buffer);
        this.clips.push(clip);
      }
    }
  }
}
