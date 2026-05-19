export class Plugin {
  constructor(def, params = null) {
    this.def = def;
    this.params = { ...def.defaults() };
    if (params) Object.assign(this.params, params);
    this.nodes = null;
    this.bypassed = false;
  }

  attach(ctx) {
    this.nodes = this.def.build(ctx, this.params);
    return this;
  }

  detach() {
    if (this.nodes) {
      const all = Object.values(this.nodes).filter(n => n && typeof n.disconnect === 'function');
      all.forEach(n => { try { n.disconnect(); } catch (e) {} });
    }
    this.nodes = null;
  }

  setParam(name, value) {
    this.params[name] = value;
    if (this.nodes && this.def.applyParam) {
      this.def.applyParam(this.nodes, name, value);
    }
  }

  setBypass(b) {
    this.bypassed = b;
  }

  cloneForOffline(offCtx) {
    return new Plugin(this.def, this.params).attach(offCtx);
  }

  serialize() {
    return {
      id: this.def.id,
      bypassed: this.bypassed,
      params: { ...this.params },
    };
  }
}
