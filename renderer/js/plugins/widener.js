export const Widener = {
  id: 'widener',
  name: 'Stereo Widener',
  tag: 'WIDE',
  paramDefs: [
    { name: 'width', label: 'Width', min: 0, max: 2, default: 1.0, step: 0.01, format: v => (v * 100).toFixed(0) + '%' },
  ],
  defaults() {
    return Object.fromEntries(this.paramDefs.map(p => [p.name, p.default]));
  },
  build(ctx, params) {
    const input = ctx.createGain();
    const output = ctx.createGain();

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);

    const lPlusR = ctx.createGain();
    const lMinusR = ctx.createGain();
    const lMinusRNeg = ctx.createGain();
    lMinusRNeg.gain.value = -1;

    const midGain = ctx.createGain();
    const sideGain = ctx.createGain();
    midGain.gain.value = 0.5;
    sideGain.gain.value = 0.5 * params.width;

    const midToL = ctx.createGain();
    const midToR = ctx.createGain();
    const sideToL = ctx.createGain();
    const sideToRNeg = ctx.createGain();
    sideToRNeg.gain.value = -1;

    input.connect(splitter);

    splitter.connect(lPlusR, 0);
    splitter.connect(lPlusR, 1);
    lPlusR.connect(midGain);

    splitter.connect(lMinusR, 0);
    splitter.connect(lMinusRNeg, 1);
    lMinusRNeg.connect(lMinusR);
    lMinusR.connect(sideGain);

    midGain.connect(midToL);
    midGain.connect(midToR);
    sideGain.connect(sideToL);
    sideGain.connect(sideToRNeg);

    midToL.connect(merger, 0, 0);
    sideToL.connect(merger, 0, 0);
    midToR.connect(merger, 0, 1);
    sideToRNeg.connect(merger, 0, 1);

    merger.connect(output);

    return { input, output, sideGain };
  },
  applyParam(nodes, name, value) {
    if (name === 'width') nodes.sideGain.gain.value = 0.5 * value;
  },
};
