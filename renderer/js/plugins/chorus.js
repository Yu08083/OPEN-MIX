export const Chorus = {
  id: 'chorus',
  name: 'コーラス',
  tag: 'CHO',
  paramDefs: [
    { name: 'rate',  label: 'レート',  min: 0.1, max: 8,    default: 1.5, step: 0.01, format: v => v.toFixed(2) + 'Hz' },
    { name: 'depth', label: '深さ', min: 0,   max: 0.01, default: 0.003, step: 0.0001, format: v => (v * 1000).toFixed(1) + 'ms' },
    { name: 'mix',   label: 'ミックス',   min: 0,   max: 1,    default: 0.4, step: 0.01, format: v => Math.round(v * 100) + '%' },
  ],
  defaults() {
    return Object.fromEntries(this.paramDefs.map(p => [p.name, p.default]));
  },
  build(ctx, params) {
    const input = ctx.createGain();
    const output = ctx.createGain();

    const dry = ctx.createGain();
    const wet = ctx.createGain();
    dry.gain.value = 1 - params.mix;
    wet.gain.value = params.mix;

    input.connect(dry).connect(output);

    const baseDelay = 0.012;
    const delays = [];
    const lfos = [];
    const depths = [];

    for (let i = 0; i < 3; i++) {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = baseDelay + i * 0.003;

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = params.rate * (1 + i * 0.15);

      const depthGain = ctx.createGain();
      depthGain.gain.value = params.depth;

      lfo.connect(depthGain).connect(delay.delayTime);
      lfo.start();

      input.connect(delay);
      delay.connect(wet);

      delays.push(delay);
      lfos.push(lfo);
      depths.push(depthGain);
    }

    wet.connect(output);

    return { input, output, dry, wet, delays, lfos, depths };
  },
  applyParam(nodes, name, value) {
    if (name === 'rate') {
      nodes.lfos.forEach((lfo, i) => {
        lfo.frequency.setTargetAtTime(value * (1 + i * 0.15), lfo.context.currentTime, 0.02);
      });
    } else if (name === 'depth') {
      nodes.depths.forEach(d => { d.gain.value = value; });
    } else if (name === 'mix') {
      nodes.dry.gain.value = 1 - value;
      nodes.wet.gain.value = value;
    }
  },
};
