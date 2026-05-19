export const Limiter = {
  id: 'limiter',
  name: 'Limiter',
  tag: 'LIM',
  paramDefs: [
    { name: 'ceiling', label: 'Ceiling', min: -12, max: 0, default: -1, step: 0.1, format: v => v.toFixed(1) + ' dB' },
    { name: 'release', label: 'Release', min: 0.01, max: 1, default: 0.05, step: 0.01, format: v => (v * 1000).toFixed(0) + 'ms' },
    { name: 'gain',    label: 'In Gain', min: 0, max: 4, default: 1.0, step: 0.01, format: v => v.toFixed(2) + 'x' },
  ],
  defaults() {
    return Object.fromEntries(this.paramDefs.map(p => [p.name, p.default]));
  },
  build(ctx, params) {
    const input = ctx.createGain();
    const inGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    const output = ctx.createGain();

    inGain.gain.value = params.gain;
    comp.threshold.value = params.ceiling;
    comp.knee.value = 0;
    comp.ratio.value = 20;
    comp.attack.value = 0.001;
    comp.release.value = params.release;

    input.connect(inGain).connect(comp).connect(output);

    return { input, output, inGain, comp };
  },
  applyParam(nodes, name, value) {
    if (name === 'ceiling') nodes.comp.threshold.value = value;
    else if (name === 'release') nodes.comp.release.value = value;
    else if (name === 'gain') nodes.inGain.gain.value = value;
  },
};
