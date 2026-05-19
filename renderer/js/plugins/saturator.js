function buildCurve(drive) {
  const k = 1 + drive * 12;
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * 2 / (n - 1) - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

export const Saturator = {
  id: 'saturator',
  name: 'サチュレーター',
  tag: 'SAT',
  paramDefs: [
    { name: 'drive', label: 'ドライブ', min: 0, max: 1, default: 0.4, step: 0.01, format: v => Math.round(v * 100) + '%' },
    { name: 'mix',   label: 'ミックス',   min: 0, max: 1, default: 1.0, step: 0.01, format: v => Math.round(v * 100) + '%' },
    { name: 'out',   label: '出力',   min: 0, max: 2, default: 1.0, step: 0.01, format: v => v.toFixed(2) + 'x' },
  ],
  defaults() {
    return Object.fromEntries(this.paramDefs.map(p => [p.name, p.default]));
  },
  build(ctx, params) {
    const input = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.oversample = '2x';
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const out = ctx.createGain();
    const output = ctx.createGain();

    input.connect(shaper).connect(wet).connect(out);
    input.connect(dry).connect(out);
    out.connect(output);

    shaper.curve = buildCurve(params.drive);
    dry.gain.value = 1 - params.mix;
    wet.gain.value = params.mix;
    out.gain.value = params.out;

    return { input, output, shaper, dry, wet, out };
  },
  applyParam(nodes, name, value) {
    if (name === 'drive') nodes.shaper.curve = buildCurve(value);
    else if (name === 'mix') {
      nodes.dry.gain.value = 1 - value;
      nodes.wet.gain.value = value;
    } else if (name === 'out') nodes.out.gain.value = value;
  },
};
