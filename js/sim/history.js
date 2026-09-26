// Per-year compact snapshots so the renderer can show any past year without
// re-simulating. Structures and lines carry their own dated layers, so only
// district/faction/plot scalars need to be recorded each year.

export function snapshot(w) {
  const n = w.plots.length;
  const owners = new Uint8Array(n), flags = new Uint8Array(n), soil = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = w.plots[i];
    owners[i] = p.district + 1;
    flags[i] = (p.breached ? 1 : 0) | (p.sacred ? 2 : 0) | (p.scar === 'breach' ? 4 : 0) | (p.scar === 'blight' ? 8 : 0) | (p.scar === 'barricade' ? 16 : 0) | (p.scar === 'blight-healed' ? 32 : 0);
    soil[i] = Math.round(p.soil * 255);
  }
  const S = w.stats || {};
  return {
    year: w.year,
    owners, flags, soil,
    d: w.districts.map(d => ({
      name: d.name, pop: Math.round(d.pop), ctrl: d.ctrl, sent: r2(d.sentiment), wealth: r2(d.wealth), dmg: r2(d.damage), ab: d.abandoned ? 1 : 0, cul: d.culture,
      edu: r2(d.edu), health: r2(d.health), unrest: r2(d.unrest), sup: d.supply ? [r2(d.supply.food), r2(d.supply.water), r2(d.supply.energy)] : [1, 1, 1], oc: r2(d.overcrowd || 0),
    })),
    f: w.factions.map(f => ({ power: r2(f.power), terr: f.territory, alive: !f.dissolved, inst: f.institutions, allies: f.allies.slice(), rivals: f.rivals.slice() })),
    s: { pop: Math.round(S.pop || 0), foodR: r2(S.foodR || 1), waterR: r2(S.waterR || 1), energyR: r2(S.energyR || 1), housingR: r2(S.housingR || 1), budget: r2(S.budget || 0), eco: r2(S.eco || 1), hull: r2(S.hull || 1), ineq: r2(S.ineq || 0), edu: r2(S.eduAvg || 0), tech: Math.round(w.techPoints), trade: w.trade, ration: w.rationing ? 1 : 0, techs: Object.keys(w.tech).filter(k => !k.endsWith('Ev')).length },
    cohorts: w.cohorts.map(c => ({ id: c.id, name: c.name, born: c.born, share: r2(c.share) })),
    rulerId: (() => { let b = null; for (const f of w.factions) if (!f.dissolved && (!b || f.power > b.power)) b = f; return b ? b.id : -1; })(),
  };
}
function r2(v) { return Math.round((v || 0) * 1000) / 1000; }

export class History {
  constructor() { this.years = []; this.start = 1; }
  record(w) { const s = snapshot(w); this.years[s.year - this.start] = s; this.years.length = s.year - this.start + 1; }
  get(year) { const i = Math.max(0, Math.min(this.years.length - 1, year - this.start)); return this.years[i]; }
  get lastYear() { return this.years.length ? this.years[this.years.length - 1].year : this.start; }
  truncate(year) { this.years.length = Math.max(0, year - this.start + 1); }
}
