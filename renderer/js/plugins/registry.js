import { Saturator } from './saturator.js';
import { Widener } from './widener.js';
import { Delay } from './delay.js';
import { Chorus } from './chorus.js';
import { Limiter } from './limiter.js';

export const PLUGIN_REGISTRY = {
  saturator: Saturator,
  widener: Widener,
  delay: Delay,
  chorus: Chorus,
  limiter: Limiter,
};

export function getPluginList() {
  return Object.values(PLUGIN_REGISTRY).map(def => ({
    id: def.id,
    name: def.name,
    tag: def.tag,
  }));
}

export function getPluginDef(id) {
  return PLUGIN_REGISTRY[id] || null;
}
