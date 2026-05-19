import { escapeHtml, formatTime, gainToDb, panLabel } from './utils.js';
import { renderPluginChain } from './plugin-chain-view.js';

export function appendTrackView(app, track) {
  if (app.engine.tracks.length === 1) {
    app.tracksEl.classList.remove('empty');
    app.tracksEl.innerHTML = '';
  }
  const el = document.createElement('div');
  el.className = 'track';
  el.style.setProperty('--track-color', track.color);
  el.innerHTML = trackTemplate(track, app.engine.tracks.indexOf(track));
  track.el = el;
  track.canvas = el.querySelector('.track-wave-canvas');
  app.tracksEl.appendChild(el);
  bindTrackEvents(app, track, el);
  const pluginContainer = el.querySelector('.plugin-chain');
  if (pluginContainer) renderPluginChain(app, track, pluginContainer);
  requestAnimationFrame(() => {
    app.layoutAllClips();
    app.engine.tracks.forEach(t => { if (t.el) app.drawWave(t); });
  });
}

function trackTemplate(track, index) {
  const ch = `CH ${String(index + 1).padStart(2, '0')}`;
  const dur = track.buffer.duration;
  return `
    <div class="track-color"></div>
    <div class="track-controls">
      <div class="track-name-row">
        <span class="track-num">${ch}</span>
        <input class="track-name" type="text" value="${escapeHtml(track.name)}">
        <button class="track-delete" title="削除">×</button>
      </div>
      <div class="track-mix-row">
        <div class="ms-buttons">
          <button class="knob-mini mute" title="ミュート">M</button>
          <button class="knob-mini solo" title="ソロ">S</button>
        </div>
        <button class="knob-mini pitch ${track.pitchCorrected ? 'active' : ''}" title="ピッチ補正">ピッチ</button>
      </div>
      ${faderRow('音量', 'gain', 0, 2, 0.01, track.gain, gainToDb(track.gain))}
      ${faderRow('パン', 'pan', -1, 1, 0.01, track.pan, panLabel(track.pan))}
      <div class="track-meter"><div class="track-meter-fill"></div></div>
      <div class="section-toggle edit-toggle"><span>編集</span><span class="chevron">›</span></div>
      <div class="edit-rack">
        ${faderRow('オフセット', 'offset', 0, 60, 0.001, track.offset, track.offset.toFixed(3) + 's')}
        ${faderRow('始端カット', 'trimStart', 0, Math.max(0, dur - 0.1), 0.001, track.trimStart, track.trimStart.toFixed(3) + 's')}
        ${faderRow('終端カット', 'trimEnd', 0, Math.max(0, dur - 0.1), 0.001, track.trimEnd, track.trimEnd.toFixed(3) + 's')}
        ${faderRow('フェードイン', 'fadeIn', 0, 10, 0.001, track.fadeIn, track.fadeIn.toFixed(3) + 's')}
        ${faderRow('フェードアウト', 'fadeOut', 0, 10, 0.001, track.fadeOut, track.fadeOut.toFixed(3) + 's')}
      </div>
      <div class="section-toggle fx-toggle"><span>エフェクト</span><span class="chevron">›</span></div>
    </div>
    <div class="track-wave-wrap">
      <span class="track-offset-display">${offsetLabel(track)}</span>
      <div class="selection-toolbar"></div>
      <div class="track-clip" style="border-color:${track.color}; background:${track.color}1A">
        <div class="clip-header" title="ドラッグして位置を変更">
          <span class="clip-name">${escapeHtml(track.name)}</span>
        </div>
        <canvas class="track-wave-canvas"></canvas>
        <div class="selection-overlay"></div>
      </div>
    </div>
    <div class="fx-rack">
      ${fxModule('ハイパスフィルタ', 'HPF', [
        fxParam('周波数', 'hpfFreq', 20, 500, 1, track.hpfFreq, `${track.hpfFreq} Hz`),
      ])}
      ${fxModule('イコライザ', '3-Band EQ', [
        fxParam('低域',  'eqLow',  -12, 12, 0.1, track.eqLow,  `${track.eqLow.toFixed(1)} dB`),
        fxParam('中域',  'eqMid',  -12, 12, 0.1, track.eqMid,  `${track.eqMid.toFixed(1)} dB`),
        fxParam('高域', 'eqHigh', -12, 12, 0.1, track.eqHigh, `${track.eqHigh.toFixed(1)} dB`),
      ])}
      ${fxModule('コンプレッサー', 'COMP', [
        fxParam('閾値',  'compThreshold', -60, 0,    0.5,   track.compThreshold, `${track.compThreshold} dB`),
        fxParam('レシオ',   'compRatio',      1,  20,   0.1,   track.compRatio,     `${track.compRatio.toFixed(1)}:1`),
        fxParam('アタック',  'compAttack',     0,  0.2,  0.001, track.compAttack,    `${(track.compAttack*1000).toFixed(1)}ms`),
        fxParam('リリース', 'compRelease',    0.01, 1,  0.01,  track.compRelease,   `${(track.compRelease*1000).toFixed(0)}ms`),
      ])}
      ${fxModule('リバーブ', 'REV', [
        fxParam('ミックス', 'reverbMix', 0, 1, 0.01, track.reverbMix, `${Math.round(track.reverbMix*100)}%`),
      ])}
      <div class="plugin-chain"></div>
    </div>
  `;
}

function offsetLabel(track) {
  const eff = track.buffer.duration - track.trimStart - track.trimEnd;
  return `${formatTime(track.offset)} · ${formatTime(Math.max(0, eff))}`;
}

function faderRow(label, p, min, max, step, value, display) {
  return `
    <div class="fader-row">
      <span class="fader-label">${label}</span>
      <input type="range" class="slider" min="${min}" max="${max}" step="${step}" value="${value}" data-p="${p}">
      <span class="fader-value" data-d="${p}">${display}</span>
    </div>
  `;
}

function fxModule(name, tag, paramsHtml) {
  return `
    <div class="fx-module">
      <div class="fx-header">
        <span class="fx-name">${name}</span>
        <span class="fx-tag">${tag}</span>
      </div>
      ${paramsHtml.join('')}
    </div>
  `;
}

function fxParam(label, fx, min, max, step, value, display) {
  return `
    <div class="fx-param">
      <span>${label}</span>
      <input type="range" class="slider" min="${min}" max="${max}" step="${step}" value="${value}" data-fx="${fx}">
      <span data-fxd="${fx}">${display}</span>
    </div>
  `;
}

function bindTrackEvents(app, track, el) {
  el.addEventListener('mousedown', e => {
    if (e.target.closest('input, button, select, textarea, .track-delete')) return;
    app.selectTrack(track);
  });

  el.querySelector('.track-name').addEventListener('input', e => {
    track.name = e.target.value;
    const clipName = el.querySelector('.clip-name');
    if (clipName) clipName.textContent = track.name;
  });

  el.querySelector('.track-delete').addEventListener('click', () => {
    if (!confirm(`「${track.name}」を削除しますか？`)) return;
    app.deleteTrack(track);
  });

  el.querySelector('.knob-mini.mute').addEventListener('click', e => {
    track.muted = !track.muted;
    e.currentTarget.classList.toggle('active', track.muted);
    app.engine._reapplySolo();
  });
  el.querySelector('.knob-mini.solo').addEventListener('click', e => {
    track.soloed = !track.soloed;
    e.currentTarget.classList.toggle('active', track.soloed);
    app.engine._reapplySolo();
  });

  el.querySelector('.knob-mini.pitch').addEventListener('click', () => {
    app.openPitchModal(track);
  });

  el.querySelectorAll('[data-p]').forEach(input => {
    const p = input.dataset.p;
    const disp = el.querySelector(`[data-d="${p}"]`);
    input.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      track[p] = v;
      if (p === 'gain') {
        track._applyMix();
        disp.textContent = gainToDb(v);
      } else if (p === 'pan') {
        track.panNode.pan.value = v;
        disp.textContent = panLabel(v);
      } else if (p === 'offset') {
        disp.textContent = v.toFixed(3) + 's';
        el.querySelector('.track-offset-display').textContent = offsetLabel(track);
        app.refreshAll();
      } else if (p === 'trimStart' || p === 'trimEnd') {
        disp.textContent = v.toFixed(3) + 's';
        el.querySelector('.track-offset-display').textContent = offsetLabel(track);
        app.refreshAll();
      } else if (p === 'fadeIn' || p === 'fadeOut') {
        disp.textContent = v.toFixed(3) + 's';
      }
    });
  });

  el.querySelectorAll('[data-fx]').forEach(input => {
    const fx = input.dataset.fx;
    const disp = el.querySelector(`[data-fxd="${fx}"]`);
    input.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      track[fx] = v;
      applyFxParam(track, fx, v);
      disp.textContent = formatFxDisplay(fx, v);
    });
  });

  el.querySelectorAll('[data-d], [data-fxd]').forEach(disp => {
    disp.classList.add('editable-value');
    disp.addEventListener('click', e => attachValueEditor(e.currentTarget, el));
  });

  el.querySelector('.fx-toggle').addEventListener('click', () => {
    track.fxOpen = !track.fxOpen;
    el.classList.toggle('fx-open', track.fxOpen);
  });
  el.querySelector('.edit-toggle').addEventListener('click', () => {
    track.editOpen = !track.editOpen;
    el.classList.toggle('edit-open', track.editOpen);
  });

  bindWaveformInteraction(app, track, el);
}

function bindWaveformInteraction(app, track, el) {
  const waveWrap = el.querySelector('.track-wave-wrap');
  const clip = el.querySelector('.track-clip');
  const clipHeader = el.querySelector('.clip-header');
  const overlay = el.querySelector('.selection-overlay');
  const toolbar = el.querySelector('.selection-toolbar');

  bindClipDrag(app, track, clipHeader);

  let downX = null;
  let downTime = null;
  let dragging = false;
  const DRAG_THRESHOLD = 5;

  const xToTime = clientX => {
    const rect = clip.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return (x / rect.width) * track.buffer.duration;
  };

  clip.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.selection-toolbar')) return;
    if (e.target.closest('.clip-header')) return;
    downX = e.clientX;
    downTime = xToTime(e.clientX);
    dragging = false;
    app.selectTrack(track);
  });

  window.addEventListener('mousemove', e => {
    if (downX === null) return;
    if (!dragging && Math.abs(e.clientX - downX) < DRAG_THRESHOLD) return;
    dragging = true;
    const currentTime = xToTime(e.clientX);
    track.selectionStart = Math.min(downTime, currentTime);
    track.selectionEnd = Math.max(downTime, currentTime);
    updateSelectionUI(track, overlay, toolbar);
  });

  window.addEventListener('mouseup', e => {
    if (downX === null) return;
    if (!dragging) {
      app.engine.seek(track.offset + downTime);
    } else {
      if (track.selectionEnd - track.selectionStart < 0.02) {
        track.clearSelection();
      }
      updateSelectionUI(track, overlay, toolbar);
    }
    downX = null;
    downTime = null;
    dragging = false;
  });

  toolbar.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-op]');
    if (!btn) return;
    const op = btn.dataset.op;
    await runSelectionOp(app, track, op);
    updateSelectionUI(track, overlay, toolbar);
  });
}

function bindClipDrag(app, track, clipHeader) {
  if (!clipHeader) return;
  clipHeader.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    app.selectTrack(track);

    const wrap = track.el.querySelector('.track-wave-wrap');
    const wrapRect = wrap.getBoundingClientRect();
    const globalDur = app.getGlobalDuration();
    const startX = e.clientX;
    const startOffset = track.offset;

    const onMove = me => {
      const dx = me.clientX - startX;
      const dt = (dx / wrapRect.width) * globalDur;
      let newOffset = Math.max(0, startOffset + dt);
      track.offset = newOffset;
      app.layoutAllClips();
      const slider = track.el.querySelector('[data-p="offset"]');
      if (slider) slider.value = track.offset;
      const disp = track.el.querySelector('[data-d="offset"]');
      if (disp) disp.textContent = track.offset.toFixed(3) + 's';
      const offsetDisp = track.el.querySelector('.track-offset-display');
      if (offsetDisp) offsetDisp.textContent = offsetLabel(track);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      app.refreshAll();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function updateSelectionUI(track, overlay, toolbar) {
  if (!track.hasSelection()) {
    overlay.style.display = 'none';
    toolbar.classList.remove('active');
    return;
  }
  const dur = track.buffer.duration;
  const leftPct  = (track.selectionStart / dur) * 100;
  const widthPct = ((track.selectionEnd - track.selectionStart) / dur) * 100;
  overlay.style.display = 'block';
  overlay.style.left = leftPct + '%';
  overlay.style.width = widthPct + '%';

  const selDur = track.selectionEnd - track.selectionStart;
  toolbar.innerHTML = `
    <span class="sel-info">
      <span class="sel-info-label">範囲選択</span>
      <span class="sel-info-time">${track.selectionStart.toFixed(2)}s → ${track.selectionEnd.toFixed(2)}s (${selDur.toFixed(2)}s)</span>
    </span>
    <div class="sel-actions">
      <button class="sel-btn" data-op="silence" title="範囲を無音にする">無音化</button>
      <button class="sel-btn" data-op="normalize" title="範囲のピーク音量を最大化">正規化</button>
      <button class="sel-btn" data-op="gain-up" title="範囲の音量を上げる">音量+</button>
      <button class="sel-btn" data-op="gain-down" title="範囲の音量を下げる">音量−</button>
      <button class="sel-btn" data-op="fade-in" title="範囲全体にフェードインを適用">フェードイン</button>
      <button class="sel-btn" data-op="fade-out" title="範囲全体にフェードアウトを適用">フェードアウト</button>
      <button class="sel-btn" data-op="pitch" title="範囲だけにピッチ補正を適用">ピッチ補正</button>
      <button class="sel-btn danger" data-op="delete" title="範囲を切り取って詰める">削除</button>
      <button class="sel-btn ghost" data-op="clear" title="選択を解除">×</button>
    </div>
  `;
  toolbar.classList.add('active');
}

async function runSelectionOp(app, track, op) {
  if (!track.hasSelection() && op !== 'clear') return;
  const s = track.selectionStart, e = track.selectionEnd;
  switch (op) {
    case 'silence':
      track.silenceRange(s, e);
      app.drawWave(track);
      break;
    case 'normalize':
      track.normalizeRange(s, e);
      app.drawWave(track);
      break;
    case 'gain-up':
      track.applyGainToRange(s, e, Math.pow(10, 3/20));
      app.drawWave(track);
      break;
    case 'gain-down':
      track.applyGainToRange(s, e, Math.pow(10, -3/20));
      app.drawWave(track);
      break;
    case 'fade-in':
      track.applyFadeToRange(s, e, 'in');
      app.drawWave(track);
      break;
    case 'fade-out':
      track.applyFadeToRange(s, e, 'out');
      app.drawWave(track);
      break;
    case 'delete':
      if (!confirm(`選択範囲（${(e - s).toFixed(2)}秒）を削除しますか？\n削除後はその分だけ全体が短くなります。`)) return;
      track.deleteRange(s, e);
      app.drawWave(track);
      app.refreshAll();
      break;
    case 'pitch':
      await app.openPitchModalForRange(track, s, e);
      app.drawWave(track);
      break;
    case 'clear':
      track.clearSelection();
      break;
  }
}

function attachValueEditor(disp, rootEl) {
  const key = disp.dataset.d || disp.dataset.fxd;
  if (!key) return;
  const slider = rootEl.querySelector(`[data-p="${key}"], [data-fx="${key}"]`);
  if (!slider) return;
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const step = parseFloat(slider.step);
  const decimals = step < 0.001 ? 4 : (step < 0.01 ? 3 : (step < 0.1 ? 2 : (step < 1 ? 1 : 0)));
  const currentValue = parseFloat(slider.value);

  const input = document.createElement('input');
  input.type = 'number';
  input.value = currentValue.toFixed(decimals);
  input.min = min;
  input.max = max;
  input.step = step;
  input.className = 'editable-value-input';

  disp.style.display = 'none';
  disp.parentNode.insertBefore(input, disp.nextSibling);
  input.focus();
  input.select();

  let done = false;
  const commit = () => {
    if (done) return; done = true;
    let v = parseFloat(input.value);
    if (isNaN(v)) v = currentValue;
    v = Math.max(min, Math.min(max, v));
    slider.value = v;
    slider.dispatchEvent(new Event('input'));
    input.remove();
    disp.style.display = '';
  };
  const cancel = () => {
    if (done) return; done = true;
    input.remove();
    disp.style.display = '';
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

function applyFxParam(track, fx, v) {
  if (!track.hpf) return;
  switch (fx) {
    case 'hpfFreq':       track.hpf.frequency.value = v; break;
    case 'eqLow':         track.eqL.gain.value = v; break;
    case 'eqMid':         track.eqM.gain.value = v; break;
    case 'eqHigh':        track.eqH.gain.value = v; break;
    case 'compThreshold': track.comp.threshold.value = v; break;
    case 'compRatio':     track.comp.ratio.value = v; break;
    case 'compAttack':    track.comp.attack.value = v; break;
    case 'compRelease':   track.comp.release.value = v; break;
    case 'reverbMix':     track._applyMix(); break;
  }
}

function formatFxDisplay(fx, v) {
  switch (fx) {
    case 'hpfFreq':       return `${Math.round(v)} Hz`;
    case 'eqLow':
    case 'eqMid':
    case 'eqHigh':        return `${v.toFixed(1)} dB`;
    case 'compThreshold': return `${v.toFixed(0)} dB`;
    case 'compRatio':     return `${v.toFixed(1)}:1`;
    case 'compAttack':    return `${(v*1000).toFixed(1)}ms`;
    case 'compRelease':   return `${(v*1000).toFixed(0)}ms`;
    case 'reverbMix':     return `${Math.round(v*100)}%`;
    default:              return String(v);
  }
}

export function refreshTrackUIValues(track) {
  if (!track.el) return;
  const setVal = (sel, v, disp) => {
    const inp = track.el.querySelector(sel);
    if (inp) inp.value = v;
    if (disp !== undefined) {
      const d = track.el.querySelector(sel.replace('[data-p=', '[data-d=').replace('[data-fx=', '[data-fxd='));
      if (d) d.textContent = disp;
    }
  };
  const setSliderAndDisp = (key, value, displayStr) => {
    const inp = track.el.querySelector(`[data-p="${key}"]`);
    if (inp) inp.value = value;
    const d = track.el.querySelector(`[data-d="${key}"]`);
    if (d) d.textContent = displayStr;
  };
  const setFxSliderAndDisp = (key, value, displayStr) => {
    const inp = track.el.querySelector(`[data-fx="${key}"]`);
    if (inp) inp.value = value;
    const d = track.el.querySelector(`[data-fxd="${key}"]`);
    if (d) d.textContent = displayStr;
  };

  setSliderAndDisp('gain', track.gain, gainToDb(track.gain));
  setSliderAndDisp('pan', track.pan, panLabel(track.pan));
  setSliderAndDisp('offset', track.offset, track.offset.toFixed(3) + 's');
  setSliderAndDisp('trimStart', track.trimStart, track.trimStart.toFixed(3) + 's');
  setSliderAndDisp('trimEnd', track.trimEnd, track.trimEnd.toFixed(3) + 's');
  setSliderAndDisp('fadeIn', track.fadeIn, track.fadeIn.toFixed(3) + 's');
  setSliderAndDisp('fadeOut', track.fadeOut, track.fadeOut.toFixed(3) + 's');

  setFxSliderAndDisp('hpfFreq', track.hpfFreq, `${Math.round(track.hpfFreq)} Hz`);
  setFxSliderAndDisp('eqLow', track.eqLow, `${track.eqLow.toFixed(1)} dB`);
  setFxSliderAndDisp('eqMid', track.eqMid, `${track.eqMid.toFixed(1)} dB`);
  setFxSliderAndDisp('eqHigh', track.eqHigh, `${track.eqHigh.toFixed(1)} dB`);
  setFxSliderAndDisp('compThreshold', track.compThreshold, `${track.compThreshold.toFixed(0)} dB`);
  setFxSliderAndDisp('compRatio', track.compRatio, `${track.compRatio.toFixed(1)}:1`);
  setFxSliderAndDisp('compAttack', track.compAttack, `${(track.compAttack*1000).toFixed(1)}ms`);
  setFxSliderAndDisp('compRelease', track.compRelease, `${(track.compRelease*1000).toFixed(0)}ms`);
  setFxSliderAndDisp('reverbMix', track.reverbMix, `${Math.round(track.reverbMix*100)}%`);

  const nameInp = track.el.querySelector('.track-name');
  if (nameInp) nameInp.value = track.name;

  const muteBtn = track.el.querySelector('.knob-mini.mute');
  if (muteBtn) muteBtn.classList.toggle('active', track.muted);
  const soloBtn = track.el.querySelector('.knob-mini.solo');
  if (soloBtn) soloBtn.classList.toggle('active', track.soloed);
  const pitchBtn = track.el.querySelector('.knob-mini.pitch');
  if (pitchBtn) pitchBtn.classList.toggle('active', track.pitchCorrected);

  const offsetDisp = track.el.querySelector('.track-offset-display');
  if (offsetDisp) {
    const eff = track.buffer.duration - track.trimStart - track.trimEnd;
    offsetDisp.textContent = `${formatTime(track.offset)} · ${formatTime(Math.max(0, eff))}`;
  }
}
