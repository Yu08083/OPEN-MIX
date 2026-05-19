export const TRACK_COLORS = [
  '#C8472B', '#1F4E5F', '#5A7A4F', '#B8841F',
  '#7C3F58', '#2E5266', '#8B4513', '#4A6741',
];

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function gainToDb(v) {
  if (v <= 0.001) return '-∞ dB';
  const db = 20 * Math.log10(v);
  return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
}

export function panLabel(v) {
  if (Math.abs(v) < 0.01) return 'C';
  return (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100);
}

export function freqToNoteName(freq) {
  if (freq <= 0) return '—';
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const semis = Math.round(12 * Math.log2(freq / 440)) + 69;
  const octave = Math.floor(semis / 12) - 1;
  return names[((semis % 12) + 12) % 12] + octave;
}
