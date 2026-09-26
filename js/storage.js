// Local persistence and import/export.
const KEY = 'century-engine:v1';

export function saveLocal(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { console.warn('save failed', e); return false; }
}
export function loadLocal() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
export function clearLocal() { localStorage.removeItem(KEY); }

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

/** Build a self-describing export of a branch: full current state plus everything needed to replay. */
export function exportWorld(timelines, branch) {
  const w = branch.world;
  const strip = (o) => JSON.parse(JSON.stringify(o));
  return {
    format: 'century-engine/1',
    exportedAt: new Date().toISOString(),
    seed: w.seed,
    habitat: w.name,
    branch: { id: branch.id, name: branch.name, year: w.year },
    timelines: timelines.serialize(),
    state: {
      year: w.year, stats: w.stats, tech: w.tech, techPoints: w.techPoints, trade: w.trade, rationing: w.rationing, culture: w.culture, pressures: w.pressures, rngState: w.rngState,
      plots: w.plots.map(p => ({ id: p.id, ix: p.ix, iy: p.iy, district: p.district, soil: p.soil, hull: p.hull, breached: p.breached, sacred: p.sacred, scar: p.scar })),
      verts: w.verts,
    },
    districts: strip(w.districts),
    factions: strip(w.factions),
    structures: strip(w.structures),
    lines: strip(w.lines),
    events: strip(w.events),
    cohorts: strip(w.cohorts),
    decisions: strip(branch.decisions),
    timeline: branch.history.years.map(s => ({ year: s.year, pop: s.s.pop, foodR: s.s.foodR, waterR: s.s.waterR, energyR: s.s.energyR, ineq: s.s.ineq, eco: s.s.eco, tech: s.s.tech, ruler: s.rulerId, districts: s.d.map(d => [d.name, d.pop, d.ctrl]) })),
  };
}
