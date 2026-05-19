export const Delay = {
  id: 'delay',
  name: 'ディレイ',
  tag: 'DLY',
  paramDefs: [
    { name: 'time',     label: 'タイム',     min: 0.01, max: 2.0, default: 0.25, step: 0.001, format: v => (v * 1000).toFixed(0) + 'ms' },
    { name: 'feedback', label: 'フィードバック', min: 0,    max: 0.95, default: 0.4, step: 0.01,  format: v => Math.round(v * 100) + '%' },
    { name: 'mix',      label: 'ミックス',      min: 0,    max: 1,    default: 0.3, step: 0.01,  format: v => Math.round(v * 100) + '%' },
    { name: 'tone',     label: 'トーン',     min: 200,  max: 8000, default: 4000, step: 50,   format: v => Math.round(v) + 'Hz' },
  ],
  defaults() {
    return Object.fromEntries(this.paramDefs.map(p => [p.name, p.default]));
  },
  build(ctx, params) {
    const input = ctx.createGain();
    const output = ctx.createGain();

    const delay = ctx.createDelay(2.1);
    delay.delayTime.value = params.time;

    const feedback = ctx.createGain();
    feedback.gain.value = params.feedback;

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = params.tone;
    tone.Q.value = 0.5;

    const dry = ctx.createGain();
    const wet = ctx.createGain();
    dry.gain.value = 1 - params.mix;
    wet.gain.value = params.mix;

    input.connect(dry).connect(output);
    input.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(wet);
    wet.connect(output);

    return { input, output, delay, feedback, tone, dry, wet };
  },
  applyParam(nodes, name, value) {
    if (name === 'time') nodes.delay.delayTime.setTargetAtTime(value, nodes.delay.context.currentTime, 0.02);
    else if (name === 'feedback') nodes.feedback.gain.value = value;
    else if (name === 'mix') {
      nodes.dry.gain.value = 1 - value;
      nodes.wet.gain.value = value;
    } else if (name === 'tone') nodes.tone.frequency.value = value;
  },
};
