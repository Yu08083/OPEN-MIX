const PROJECT_VERSION = 1;

export function serializeProject(engine) {
  return {
    version: PROJECT_VERSION,
    app: 'OPEN MIX',
    savedAt: new Date().toISOString(),
    masterGain: engine.masterGain ? engine.masterGain.gain.value : 1,
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
    throw new Error('Invalid project file');
  }
  return data;
}

export function applyProject(engine, masterSlider, masterDisplay, project) {
  const tracksByFilename = new Map();
  engine.tracks.forEach(t => tracksByFilename.set(t.filename, t));

  let matched = 0;
  let unmatched = [];
  project.tracks.forEach(ps => {
    const t = tracksByFilename.get(ps.filename);
    if (t) {
      t.applySerialized(ps);
      matched++;
    } else {
      unmatched.push(ps.filename);
    }
  });

  engine._reapplySolo();

  if (typeof project.masterGain === 'number' && engine.masterGain) {
    engine.masterGain.gain.value = project.masterGain;
    masterSlider.value = project.masterGain;
    const db = project.masterGain <= 0.001
      ? '-∞ dB'
      : (20 * Math.log10(project.masterGain) >= 0 ? '+' : '') + (20 * Math.log10(project.masterGain)).toFixed(1) + ' dB';
    masterDisplay.textContent = db;
  }

  return { matched, unmatched, totalInProject: project.tracks.length };
}
