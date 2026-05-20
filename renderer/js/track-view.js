import { escapeHtml, formatTime, gainToDb, panLabel } from './utils.js';
import { renderPluginChain } from './plugin-chain-view.js';
import { AudioClip, MidiClip } from './clip.js';

export function appendTrackView(app, track) {
  if (app.engine.tracks.length === 1) {
    app.tracksEl.classList.remove('empty');
    app.tracksEl.innerHTML = '';
  }
  const el = document.createElement('div');
  el.className = 'track ' + (track.type === 'midi' ? 'midi-track' : 'audio-track');
  el.style.setProperty('--track-color', track.color);
  el.innerHTML = trackTemplate(track, app.engine.tracks.indexOf(track));
  track.el = el;
  app.tracksEl.appendChild(el);
  bindTrackEvents(app, track, el);
  const pluginContainer = el.querySelector('.plugin-chain');
  if (pluginContainer) renderPluginChain(app, track, pluginContainer);
  renderClips(app, track);
  requestAnimationFrame(() => {
    app.layoutAllClips();
    app.engine.tracks.forEach(t => app.drawAllClipsOf(t));
  });
}

function trackTemplate(track, index) {
  const ch = `CH ${String(index + 1).padStart(2, '0')}`;
  return `
    <div class="track-color"></div>
    <div class="track-controls">
      <div class="track-name-row">
        <span class="track-num">${ch}</span>
        <input class="track-name" type="text" value="${escapeHtml(track.name)}">
        <button class="track-delete" title="トラックを削除">×</button>
      </div>
      <div class="track-type-badge">${track.type === 'midi' ? 'MIDI' : 'AUDIO'}</div>
      <div class="track-mix-row">
        <div class="ms-buttons">
          <button class="knob-mini mute" title="ミュート">M</button>
          <button class="knob-mini solo" title="ソロ">S</button>
          ${track.type === 'audio' ? '<button class="knob-mini freeze" title="フリーズ（エフェクト込みでバウンス、CPU軽減）">F</button>' : ''}
        </div>
        ${track.type === 'audio' ? '<button class="knob-mini pitch" title="ピッチ補正">ピッチ</button>' : ''}
      </div>
      ${faderRow('音量', 'gain', 0, 2, 0.01, track.gain, gainToDb(track.gain))}
      ${faderRow('パン', 'pan', -1, 1, 0.01, track.pan, panLabel(track.pan))}
      <div class="track-meter"><div class="track-meter-fill"></div></div>
      <div class="section-toggle fx-toggle"><span>エフェクト</span><span class="chevron">›</span></div>
    </div>
    <div class="track-clips-area">
      <span class="track-offset-display"></span>
      <div class="selection-toolbar"></div>
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
        `<div class="fx-ir-row">
          <span class="fx-ir-name" data-ir-name>${track.customIRName ? '読込済: ' + escapeHtml(track.customIRName) : '内蔵プロシージャルIR'}</span>
          <button class="fx-ir-btn" data-ir-load>IR読込</button>
          <button class="fx-ir-btn" data-ir-clear ${track.customIRName ? '' : 'disabled'}>解除</button>
        </div>`,
      ])}
      <div class="plugin-chain"></div>
    </div>
  `;
}

function faderRow(label, p, min, max, step, value, display) {
  return `
    <div class="fader-row">
      <span class="fader-label">${label}</span>
      <input type="range" class="slider" min="${min}" max="${max}" step="${step}" value="${value}" data-p="${p}">
      <span class="fader-value editable-value" data-d="${p}">${display}</span>
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
      <span class="editable-value" data-fxd="${fx}">${display}</span>
    </div>
  `;
}

export function renderClips(app, track) {
  if (!track.el) return;
  const area = track.el.querySelector('.track-clips-area');
  if (!area) return;
  area.querySelectorAll('.track-clip').forEach(n => n.remove());
  for (const clip of track.clips) {
    const clipEl = createClipElement(app, track, clip);
    area.appendChild(clipEl);
  }
}

function createClipElement(app, track, clip) {
  const el = document.createElement('div');
  el.className = 'track-clip ' + (clip.type === 'midi' ? 'midi-clip' : 'audio-clip');
  el.dataset.clipId = clip.id;
  el.style.borderColor = track.color;
  el.style.background = track.color + '1A';
  el.innerHTML = `
    <div class="clip-header" title="ドラッグして位置変更">
      <span class="clip-name">${escapeHtml(clip.name)}</span>
      <div class="clip-actions">
        ${clip.type === 'audio' ? '<button class="clip-action-btn" data-act="harmony" title="ハモリ作成">♬</button>' : ''}
        <button class="clip-action-btn" data-act="split" title="再生位置で分割">⊟</button>
        <button class="clip-action-btn" data-act="duplicate" title="複製">⎘</button>
        <button class="clip-action-btn" data-act="delete" title="削除">×</button>
      </div>
    </div>
    <canvas class="clip-canvas"></canvas>
    <div class="selection-overlay"></div>
    <div class="clip-resize-left" title="左端をドラッグで開始位置を変更"></div>
    <div class="clip-resize-right" title="右端をドラッグで長さを変更"></div>
  `;
  clip.el = el;
  clip.canvas = el.querySelector('.clip-canvas');
  bindClipEvents(app, track, clip, el);
  return el;
}

function bindClipEvents(app, track, clip, el) {
  const header = el.querySelector('.clip-header');
  const resizeLeft = el.querySelector('.clip-resize-left');
  const resizeRight = el.querySelector('.clip-resize-right');
  const overlay = el.querySelector('.selection-overlay');
  const toolbar = track.el.querySelector('.selection-toolbar');

  bindClipDrag(app, track, clip, header);
  bindClipResize(app, track, clip, resizeLeft, 'left');
  bindClipResize(app, track, clip, resizeRight, 'right');

  el.querySelectorAll('.clip-action-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => e.stopPropagation());
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'split') app.splitClipAtPlayhead(track, clip);
      else if (act === 'duplicate') app.duplicateClip(track, clip);
      else if (act === 'delete') app.deleteClip(track, clip);
      else if (act === 'harmony') app.openHarmonyForClip(track, clip);
    });
  });

  if (clip.type === 'audio') {
    bindAudioClipSelection(app, track, clip, el, overlay, toolbar);
  } else {
    el.addEventListener('dblclick', e => {
      if (e.target.closest('.clip-actions, .clip-resize-left, .clip-resize-right, .clip-header')) return;
      app.openMidiEditor(track, clip);
    });
    el.addEventListener('mousedown', e => {
      if (e.target.closest('.clip-actions, .clip-resize-left, .clip-resize-right, .clip-header')) return;
      app.selectClip(track, clip);
    });
  }
}

function bindClipDrag(app, track, clip, headerEl) {
  headerEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.clip-actions')) return;
    e.preventDefault();
    e.stopPropagation();
    app.selectClip(track, clip);

    const area = track.el.querySelector('.track-clips-area');
    const areaRect = area.getBoundingClientRect();
    const globalDur = app.getGlobalDuration();
    const startX = e.clientX;
    const startOffset = clip.offset;

    const onMove = me => {
      const dx = me.clientX - startX;
      const dt = (dx / areaRect.width) * globalDur;
      let newOffset = Math.max(0, startOffset + dt);
      newOffset = app.engine.snapTime(newOffset);
      clip.offset = newOffset;
      app.layoutAllClips();
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

function bindClipResize(app, track, clip, handle, side) {
  if (!handle) return;
  handle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const area = track.el.querySelector('.track-clips-area');
    const areaRect = area.getBoundingClientRect();
    const globalDur = app.getGlobalDuration();
    const startX = e.clientX;
    const startOffset = clip.offset;
    const startTrim = clip.type === 'audio' ? clip.trimStart : 0;
    const startDur = clip.duration;
    const bufDur = clip.type === 'audio' && clip.buffer ? clip.buffer.duration : Infinity;

    const onMove = me => {
      const dx = me.clientX - startX;
      const dt = (dx / areaRect.width) * globalDur;
      if (side === 'left') {
        let delta = dt;
        if (clip.type === 'audio') {
          const newTrim = Math.max(0, Math.min(bufDur - 0.05, startTrim + delta));
          const actualDelta = newTrim - startTrim;
          clip.trimStart = newTrim;
          clip.offset = Math.max(0, app.engine.snapTime(startOffset + actualDelta));
          clip.duration = Math.max(0.05, startDur - actualDelta);
        } else {
          const snappedOffset = Math.max(0, app.engine.snapTime(startOffset + delta));
          const actualDelta = snappedOffset - startOffset;
          clip.offset = snappedOffset;
          clip.duration = Math.max(0.1, startDur - actualDelta);
        }
      } else {
        let newDur = Math.max(0.05, startDur + dt);
        newDur = app.engine.snapTime(clip.offset + newDur) - clip.offset;
        newDur = Math.max(0.05, newDur);
        if (clip.type === 'audio' && clip.buffer) {
          newDur = Math.min(newDur, bufDur - clip.trimStart);
        }
        clip.duration = newDur;
      }
      clip.invalidatePeaks && clip.invalidatePeaks();
      app.layoutAllClips();
      app.drawClip(clip);
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

function bindAudioClipSelection(app, track, clip, clipEl, overlay, toolbar) {
  let downX = null;
  let downTime = null;
  let dragging = false;
  const DRAG_THRESHOLD = 5;

  const xToTimeInClip = clientX => {
    const rect = clipEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return (x / rect.width) * clip.duration;
  };

  clipEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.clip-header, .clip-actions, .clip-resize-left, .clip-resize-right, .selection-toolbar')) return;
    downX = e.clientX;
    downTime = xToTimeInClip(e.clientX);
    dragging = false;
    app.selectClip(track, clip);
  });

  window.addEventListener('mousemove', e => {
    if (downX === null) return;
    if (!dragging && Math.abs(e.clientX - downX) < DRAG_THRESHOLD) return;
    dragging = true;
    const currentTime = xToTimeInClip(e.clientX);
    clip.selectionStart = Math.min(downTime, currentTime);
    clip.selectionEnd = Math.max(downTime, currentTime);
    updateClipSelection(app, track, clip);
  });

  window.addEventListener('mouseup', e => {
    if (downX === null) return;
    if (!dragging) {
      app.engine.seek(clip.offset + downTime);
    } else {
      if (clip.selectionEnd - clip.selectionStart < 0.02) {
        clip.clearSelection();
      }
      updateClipSelection(app, track, clip);
    }
    downX = null;
    downTime = null;
    dragging = false;
  });
}

function updateClipSelection(app, track, clip) {
  if (!clip.el) return;
  const overlay = clip.el.querySelector('.selection-overlay');
  const toolbar = track.el.querySelector('.selection-toolbar');
  if (!clip.hasSelection()) {
    overlay.style.display = 'none';
    toolbar.classList.remove('active');
    return;
  }
  const leftPct = (clip.selectionStart / clip.duration) * 100;
  const widthPct = ((clip.selectionEnd - clip.selectionStart) / clip.duration) * 100;
  overlay.style.display = 'block';
  overlay.style.left = leftPct + '%';
  overlay.style.width = widthPct + '%';

  app.activeSelectionClip = clip;
  app.activeSelectionTrack = track;

  const selDur = clip.selectionEnd - clip.selectionStart;
  toolbar.innerHTML = `
    <span class="sel-info">
      <span class="sel-info-label">範囲選択</span>
      <span class="sel-info-time">${escapeHtml(clip.name)} : ${clip.selectionStart.toFixed(2)}s → ${clip.selectionEnd.toFixed(2)}s (${selDur.toFixed(2)}s)</span>
    </span>
    <div class="sel-actions">
      <button class="sel-btn" data-op="silence">無音化</button>
      <button class="sel-btn" data-op="normalize">正規化</button>
      <button class="sel-btn" data-op="gain-up">音量+</button>
      <button class="sel-btn" data-op="gain-down">音量−</button>
      <button class="sel-btn" data-op="fade-in">フェードイン</button>
      <button class="sel-btn" data-op="fade-out">フェードアウト</button>
      <button class="sel-btn" data-op="pitch">ピッチ補正</button>
      <button class="sel-btn danger" data-op="delete">削除</button>
      <button class="sel-btn ghost" data-op="clear">×</button>
    </div>
  `;
  toolbar.classList.add('active');

  toolbar.querySelectorAll('button[data-op]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await app.runClipSelectionOp(track, clip, btn.dataset.op);
      updateClipSelection(app, track, clip);
    });
  });
}

function bindTrackEvents(app, track, el) {
  el.addEventListener('mousedown', e => {
    if (e.target.closest('input, button, select, textarea, .track-delete')) return;
    if (e.target.closest('.track-clip')) return;
    app.selectTrack(track);
  });

  el.querySelector('.track-name').addEventListener('input', e => {
    track.name = e.target.value;
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

  const freezeBtn = el.querySelector('.knob-mini.freeze');
  if (freezeBtn) {
    freezeBtn.classList.toggle('active', track.frozen);
    freezeBtn.addEventListener('click', async () => {
      if (track.frozen) {
        track.unfreeze();
        freezeBtn.classList.remove('active');
        el.classList.remove('frozen');
      } else {
        if (track.clips.length === 0) { alert('クリップがないためフリーズできません'); return; }
        app._showOverlay(`「${track.name}」をフリーズ中…`);
        try {
          await track.freeze(app.engine);
          freezeBtn.classList.add('active');
          el.classList.add('frozen');
        } catch (err) {
          alert('フリーズ失敗: ' + err.message);
        }
        app._hideOverlay();
      }
    });
  }

  const irLoadBtn = el.querySelector('[data-ir-load]');
  const irClearBtn = el.querySelector('[data-ir-clear]');
  const irNameEl = el.querySelector('[data-ir-name]');
  if (irLoadBtn) {
    irLoadBtn.addEventListener('click', async () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/wav,audio/x-wav,.wav,audio/*';
      input.style.display = 'none';
      input.addEventListener('change', async e => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          app.engine.ensure();
          const buf = await app.engine.ctx.decodeAudioData(await f.arrayBuffer());
          track.setCustomIR(buf, f.name);
          irNameEl.textContent = '読込済: ' + f.name;
          irClearBtn.disabled = false;
        } catch (err) {
          alert('IR読込失敗: ' + err.message);
        }
      });
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 1000);
    });
  }
  if (irClearBtn) {
    irClearBtn.addEventListener('click', () => {
      track.clearCustomIR(app.engine.reverbIR);
      irNameEl.textContent = '内蔵プロシージャルIR';
      irClearBtn.disabled = true;
    });
  }

  const pitchBtn = el.querySelector('.knob-mini.pitch');
  if (pitchBtn) {
    pitchBtn.addEventListener('click', () => {
      if (track.clips.length === 0) return;
      const target = app.selectedClip && track.clips.indexOf(app.selectedClip) >= 0
        ? app.selectedClip : track.clips[0];
      app.openPitchModalForClip(track, target);
    });
  }

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
    disp.addEventListener('click', e => attachValueEditor(e.currentTarget, el));
  });

  el.querySelector('.fx-toggle').addEventListener('click', () => {
    track.fxOpen = !track.fxOpen;
    el.classList.toggle('fx-open', track.fxOpen);
  });
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
  input.min = min; input.max = max; input.step = step;
  input.className = 'editable-value-input';
  disp.style.display = 'none';
  disp.parentNode.insertBefore(input, disp.nextSibling);
  input.focus(); input.select();
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
  const cancel = () => { if (done) return; done = true; input.remove(); disp.style.display = ''; };
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
}
