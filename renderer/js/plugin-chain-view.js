import { escapeHtml } from './utils.js';
import { getPluginList, getPluginDef } from './plugins/registry.js';

export function renderPluginChain(app, track, containerEl) {
  containerEl.innerHTML = pluginChainTemplate(track);
  bindPluginChainEvents(app, track, containerEl);
}

function pluginChainTemplate(track) {
  const tiles = track.pluginChain.map((plugin, idx) => pluginTile(plugin, idx, track.pluginChain.length)).join('');
  const list = getPluginList();
  const addOptions = list.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  return `
    <div class="plugin-chain-header">
      <span class="plugin-chain-label">Plugin Chain</span>
      <div class="plugin-chain-add">
        <select class="select plugin-add-select">
          <option value="">+ Add Plugin</option>
          ${addOptions}
        </select>
      </div>
    </div>
    <div class="plugin-chain-tiles">
      ${tiles || '<div class="plugin-chain-empty">プラグインが追加されていません</div>'}
    </div>
  `;
}

function pluginTile(plugin, idx, total) {
  const def = plugin.def;
  const params = def.paramDefs.map(p => pluginParam(p, plugin.params[p.name], idx)).join('');
  return `
    <div class="plugin-tile ${plugin.bypassed ? 'bypassed' : ''}" data-idx="${idx}">
      <div class="plugin-tile-header">
        <div class="plugin-tile-title">
          <span class="plugin-tile-name">${escapeHtml(def.name)}</span>
          <span class="plugin-tile-tag">${def.tag}</span>
        </div>
        <div class="plugin-tile-actions">
          <button class="plugin-tile-btn p-bypass" title="${plugin.bypassed ? 'Enable' : 'Bypass'}">${plugin.bypassed ? '○' : '●'}</button>
          <button class="plugin-tile-btn p-up" title="Move up" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="plugin-tile-btn p-down" title="Move down" ${idx === total - 1 ? 'disabled' : ''}>↓</button>
          <button class="plugin-tile-btn p-remove" title="Remove">×</button>
        </div>
      </div>
      <div class="plugin-tile-body">
        ${params}
      </div>
    </div>
  `;
}

function pluginParam(def, value, pluginIdx) {
  const display = def.format ? def.format(value) : String(value);
  return `
    <div class="plugin-param">
      <span class="plugin-param-label">${escapeHtml(def.label)}</span>
      <input type="range" class="slider plugin-param-slider"
        min="${def.min}" max="${def.max}" step="${def.step || 0.01}" value="${value}"
        data-plugin-idx="${pluginIdx}" data-param="${def.name}">
      <span class="plugin-param-value" data-pdisplay="${def.name}">${display}</span>
    </div>
  `;
}

function bindPluginChainEvents(app, track, containerEl) {
  const selectEl = containerEl.querySelector('.plugin-add-select');
  if (selectEl) {
    selectEl.addEventListener('change', e => {
      const id = e.target.value;
      if (!id) return;
      const def = getPluginDef(id);
      if (def) {
        track.addPlugin(def);
        renderPluginChain(app, track, containerEl);
      }
      e.target.value = '';
    });
  }

  containerEl.querySelectorAll('.plugin-tile').forEach(tileEl => {
    const idx = parseInt(tileEl.dataset.idx);
    const plugin = track.pluginChain[idx];
    if (!plugin) return;

    tileEl.querySelector('.p-bypass').addEventListener('click', () => {
      track.togglePluginBypass(idx);
      renderPluginChain(app, track, containerEl);
    });
    tileEl.querySelector('.p-up').addEventListener('click', () => {
      if (idx > 0) {
        track.movePlugin(idx, idx - 1);
        renderPluginChain(app, track, containerEl);
      }
    });
    tileEl.querySelector('.p-down').addEventListener('click', () => {
      if (idx < track.pluginChain.length - 1) {
        track.movePlugin(idx, idx + 1);
        renderPluginChain(app, track, containerEl);
      }
    });
    tileEl.querySelector('.p-remove').addEventListener('click', () => {
      if (!confirm(`プラグイン「${plugin.def.name}」を削除しますか？`)) return;
      track.removePlugin(idx);
      renderPluginChain(app, track, containerEl);
    });

    tileEl.querySelectorAll('.plugin-param-slider').forEach(sl => {
      const paramName = sl.dataset.param;
      const def = plugin.def.paramDefs.find(p => p.name === paramName);
      const disp = tileEl.querySelector(`[data-pdisplay="${paramName}"]`);
      sl.addEventListener('input', e => {
        const v = parseFloat(e.target.value);
        plugin.setParam(paramName, v);
        if (disp) disp.textContent = def && def.format ? def.format(v) : String(v);
      });
    });
  });
}
