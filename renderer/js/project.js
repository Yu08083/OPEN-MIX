const PROJECT_VERSION = 2;

export function serializeProject(engine) {
  return {
    version: PROJECT_VERSION,
    app: 'OPEN MIX',
    savedAt: new Date().toISOString(),
    masterGain: engine.masterGain ? engine.masterGain.gain.value : 1,
    bpm: engine.bpm,
    beatsPerBar: engine.beatsPerBar,
    snapEnabled: engine.snapEnabled,
    snapResolution: engine.snapResolution,
    tracks: engine.tracks.map(t => t.serialize()),
  };
}

export function projectToBlob(project) {
  return new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
}

export function defaultProjectFilename() {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12);
  return `openmix_${stamp}.json`;
}

export async function loadProjectFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data.tracks || !Array.isArray(data.tracks)) {
    throw new Error('プロジェクトファイルが不正です');
  }
  return data;
}

export function applyProject(engine, masterSlider, masterDisplay, project, bufferByName) {
  if (typeof project.bpm === 'number') engine.bpm = project.bpm;
  if (typeof project.beatsPerBar === 'number') engine.beatsPerBar = project.beatsPerBar;
  if (typeof project.snapEnabled === 'boolean') engine.snapEnabled = project.snapEnabled;
  if (typeof project.snapResolution === 'number') engine.snapResolution = project.snapResolution;

  const tracksByName = new Map();
  engine.tracks.forEach(t => tracksByName.set(t.name, t));

  let matched = 0;
  let missing = [];
  project.tracks.forEach(ps => {
    const t = tracksByName.get(ps.name);
    if (t) {
      t.applySerialized(ps, bufferByName || {});
      matched++;
      if (Array.isArray(ps.clips)) {
        ps.clips.forEach(cd => {
          if (cd.type === 'audio' && !(bufferByName && bufferByName[cd.name])) {
            missing.push(cd.name);
          }
        });
      }
    } else {
      if (Array.isArray(ps.clips)) {
        ps.clips.forEach(cd => {
          if (cd.type === 'audio') missing.push(cd.name);
        });
      }
    }
  });

  engine._reapplySolo();

  if (typeof project.masterGain === 'number' && engine.masterGain) {
    engine.masterGain.gain.value = project.masterGain;
    if (masterSlider) masterSlider.value = project.masterGain;
    if (masterDisplay) {
      const db = project.masterGain <= 0.001
        ? '-∞ dB'
        : (20 * Math.log10(project.masterGain) >= 0 ? '+' : '') + (20 * Math.log10(project.masterGain)).toFixed(1) + ' dB';
      masterDisplay.textContent = db;
    }
  }

  const bpmInput = document.getElementById('bpm-input');
  if (bpmInput) bpmInput.value = engine.bpm;
  const snapBtn = document.getElementById('snap-toggle');
  if (snapBtn) snapBtn.classList.toggle('active', engine.snapEnabled);
  const snapRes = document.getElementById('snap-resolution');
  if (snapRes) snapRes.value = engine.snapResolution;

  return { matched, missing, totalInProject: project.tracks.length };
}
