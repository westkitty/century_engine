// Procedural generation of a new habitat civilization from a seed.
import { RNG } from '../rng.js';
import { GRID_COLS, GRID_ROWS, WORLD_W, WORLD_H, FACTION_ARCHETYPES, CULTURE_COLORS, SLOTS_PER_PLOT, STRUCT } from './defs.js';
import { districtName, factionName, habitatName, originName, cohortName } from '../names.js';

export function generateWorld(seed) {
  const rng = new RNG('gen:' + seed);
  const w = {
    seed,
    name: habitatName(rng),
    year: 1,
    rngState: null,
    plots: [],
    verts: [],
    districts: [],
    factions: [],
    structures: [],
    lines: [],
    events: [],
    cohorts: [],
    decisions: [],
    pending: null,
    lastIntervention: -100,
    crisisCount: {},
    techPoints: 0,
    tech: {},
    trade: 'limited', // closed | limited | open
    rationing: false,
    rationingSince: 0,
    projects: [],
    nextId: 1,
    counters: {},
    stats: {},
    culture: {
      communal: rng.float(0.2, 0.8),
      technocratic: rng.float(0.2, 0.8),
      openness: rng.float(0.15, 0.85),
      piety: rng.float(0.1, 0.7),
    },
    pressures: [],
    origin: originName(rng),
  };
  w.founderOrigin = w.origin;

  // ---- geometry: jittered grid of plots ----
  const cw = WORLD_W / GRID_COLS, ch = WORLD_H / GRID_ROWS;
  for (let iy = 0; iy <= GRID_ROWS; iy++) {
    for (let ix = 0; ix <= GRID_COLS; ix++) {
      let x = ix * cw, y = iy * ch;
      if (ix > 0 && ix < GRID_COLS) x += rng.float(-0.28, 0.28) * cw;
      if (iy > 0 && iy < GRID_ROWS) y += rng.float(-0.28, 0.28) * ch;
      w.verts.push([Math.round(x), Math.round(y)]);
    }
  }
  const V = (ix, iy) => iy * (GRID_COLS + 1) + ix;
  // ecological base fields: fertility band around the middle, hull weakness near ends
  const fertPhase = rng.float(0, Math.PI * 2);
  for (let iy = 0; iy < GRID_ROWS; iy++) {
    for (let ix = 0; ix < GRID_COLS; ix++) {
      const id = iy * GRID_COLS + ix;
      const fx = ix / GRID_COLS, fy = iy / GRID_ROWS;
      let soil = 0.45 + 0.35 * Math.sin(fx * Math.PI) + 0.2 * Math.sin(fy * Math.PI * 2 + fertPhase) + rng.float(-0.15, 0.15);
      soil = clamp(soil, 0.1, 1);
      let hull = 0.75 + 0.2 * Math.sin(fx * Math.PI) + rng.float(-0.12, 0.12);
      hull = clamp(hull, 0.35, 1);
      w.plots.push({
        id, ix, iy,
        v: [V(ix, iy), V(ix + 1, iy), V(ix + 1, iy + 1), V(ix, iy + 1)],
        soil, soil0: soil, hull, hull0: hull,
        district: -1, breached: false, sacred: false, scar: null,
        slots: new Array(SLOTS_PER_PLOT).fill(null),
      });
    }
  }
  // habitat-specific weak seams (pressure) and dead zones (ecology)
  const seams = rng.range(1, 3);
  for (let s = 0; s < seams; s++) {
    const sx = rng.int(GRID_COLS), sy = rng.int(GRID_ROWS);
    for (const p of w.plots) {
      const d = Math.hypot(p.ix - sx, (p.iy - sy) * 1.5);
      if (d < 2.6) { p.hull = clamp(p.hull - (2.6 - d) * 0.18, 0.2, 1); p.hull0 = p.hull; }
    }
    w.pressures.push({ kind: 'weak-hull', text: `Structural weakness in the hull near column ${sx + 1}.` });
  }
  if (rng.chance(0.6)) {
    const dx = rng.int(GRID_COLS), dy = rng.int(GRID_ROWS);
    for (const p of w.plots) {
      const d = Math.hypot(p.ix - dx, (p.iy - dy) * 1.5);
      if (d < 2.2) { p.soil = clamp(p.soil - (2.2 - d) * 0.25, 0.05, 1); p.soil0 = p.soil; }
    }
    w.pressures.push({ kind: 'poor-soil', text: 'A band of regolith that never took to cultivation.' });
  }

  // ---- districts: seeded growth ----
  const nDist = rng.range(6, 9);
  const seeds = [];
  const taken = new Set();
  let tries = 0;
  while (seeds.length < nDist && tries++ < 500) {
    const p = rng.pick(w.plots);
    if (taken.has(p.id)) continue;
    if (seeds.some(s => Math.abs(s.ix - p.ix) < 3 && Math.abs(s.iy - p.iy) < 2)) continue;
    seeds.push(p); taken.add(p.id);
  }
  const kinds = ['civic', 'agri', 'industry', 'residential', 'agri', 'residential', 'mixed', 'industry', 'residential'];
  seeds.forEach((p, i) => {
    const kind = i < kinds.length ? kinds[i] : rng.pick(['residential', 'mixed']);
    const nm = districtName(rng, kind);
    const d = {
      id: i, name: nm, core: nm.split(' ')[0], kind, founded: 1,
      names: [],
      culture: 0, pop: 0, wealth: rng.float(0.4, 0.6), sentiment: 0.65, edu: 0.3, health: 0.5,
      ctrl: -1, infl: {}, damage: 0, abandoned: false, plots: [],
      history: [], lowSince: 0, unrest: 0, born: 0, deaths: 0,
      services: {},
    };
    d.names.push({ year: 1, name: d.name, reason: 'Founding survey' });
    d.history.push({ year: 1, text: `Founded during the habitat's settlement as a ${kind} district.` });
    w.districts.push(d);
    p.district = i; d.plots.push(p.id);
  });
  // growth with per-district appetite
  const appetite = w.districts.map(() => rng.float(0.6, 1.4));
  const frontier = seeds.map(p => [p]);
  let remaining = w.plots.length - seeds.length;
  let guard = 0;
  while (remaining > 0 && guard++ < 20000) {
    const di = rng.weighted(w.districts.map(d => d.id), id => appetite[id] * Math.max(1, frontier[id].length));
    const fr = frontier[di];
    if (!fr.length) { if (frontier.every(f => !f.length)) break; continue; }
    const from = rng.pick(fr);
    const nbs = neighbors(w, from).filter(n => n.district === -1);
    if (!nbs.length) { fr.splice(fr.indexOf(from), 1); continue; }
    const n = rng.pick(nbs);
    n.district = di; w.districts[di].plots.push(n.id); fr.push(n); remaining--;
  }
  for (const p of w.plots) if (p.district === -1) { // fallback
    const nb = neighbors(w, p).find(n => n.district >= 0);
    p.district = nb ? nb.district : 0; w.districts[p.district].plots.push(p.id);
  }

  // ---- factions ----
  const start = ['authority', 'engineers', 'cultivators'];
  if (w.culture.communal > 0.5) start.push('collective'); else start.push('guild');
  start.forEach((arch, i) => addFaction(w, rng, arch, 1, 'Present since the habitat was settled.'));

  // initial influence: authority everywhere, others by district kind
  for (const d of w.districts) {
    for (const f of w.factions) {
      let base = 0.2 + rng.float(0, 0.15);
      if (f.arch === 'authority') base += 0.25;
      if (f.arch === 'cultivators' && d.kind === 'agri') base += 0.4;
      if (f.arch === 'engineers' && d.kind === 'industry') base += 0.4;
      if (f.arch === 'guild' && d.kind === 'mixed') base += 0.3;
      if (f.arch === 'collective' && d.kind === 'residential') base += 0.3;
      d.infl[f.id] = base;
    }
  }

  // ---- population & starting structures ----
  const totalPop = rng.range(38000, 70000);
  const weights = w.districts.map(d => d.plots.length * (d.kind === 'agri' ? 0.5 : d.kind === 'industry' ? 0.7 : 1.2));
  const wsum = weights.reduce((a, b) => a + b, 0);
  w.districts.forEach((d, i) => { d.pop = Math.round(totalPop * weights[i] / wsum); });

  const auth = w.factions.find(f => f.arch === 'authority');
  const eng = w.factions.find(f => f.arch === 'engineers');
  const cult = w.factions.find(f => f.arch === 'cultivators');
  for (const d of w.districts) {
    const plots = d.plots.map(id => w.plots[id]);
    // housing to cover pop
    let cap = 0;
    let g = 0;
    while (cap < d.pop * 0.9 && g++ < 60) {
      const s = place(w, rng, d, 'housing', 1, auth.id, 'Built during the founding settlement.');
      if (!s) break; cap += STRUCT.housing.cap;
    }
    const nFarm = d.kind === 'agri' ? Math.round(plots.length * 1.6) : d.kind === 'mixed' ? 2 : 1;
    for (let i = 0; i < nFarm; i++) place(w, rng, d, 'farm', 1, cult.id, 'Laid out in the founding agricultural plan.');
    if (d.kind === 'industry') { for (let i = 0; i < 3; i++) place(w, rng, d, 'factory', 1, eng.id, 'Part of the original industrial core.'); place(w, rng, d, 'fission', 1, eng.id, 'Original reactor installed before settlement.'); }
    if (d.kind === 'civic') { place(w, rng, d, 'civic', 1, auth.id, 'Seat of the founding administration.'); place(w, rng, d, 'school', 1, auth.id, 'The first school.'); place(w, rng, d, 'clinic', 1, auth.id, 'Founding medical station.'); place(w, rng, d, 'market', 1, auth.id, 'The founders\' exchange.'); }
    if (d.kind === 'mixed') { place(w, rng, d, 'market', 1, auth.id, 'Founding-era market.'); place(w, rng, d, 'factory', 1, eng.id, 'Light workshop from the settlement era.'); }
    if (d.kind === 'residential') { place(w, rng, d, 'clinic', 1, auth.id, 'Neighbourhood clinic from the settlement era.'); }
    place(w, rng, d, 'waterplant', 1, eng.id, 'Original water processing unit.');
  }
  // a couple of conduits connecting the water plant districts to the main civic district
  const civic = w.districts.find(d => d.kind === 'civic') || w.districts[0];
  for (let i = 0; i < 2; i++) {
    const from = rng.pick(w.districts.filter(d => d !== civic));
    addLine(w, from, civic, 'conduit', 1, eng.id, 'Original trunk conduit from the settlement plan.');
  }
  place(w, rng, civic, 'solar', 1, eng.id, 'Founding mirror array along the sun-line.');
  // top up founding infrastructure so the colony starts viable (about 15-25% headroom)
  const sumOut = (cat) => w.structures.reduce((a, s) => a + (STRUCT[s.type].cat === cat ? (s.type === 'farm' ? STRUCT.farm.out * (0.4 + w.plots[s.plot].soil) : STRUCT[s.type].out || STRUCT[s.type].cap || 0) : 0), 0);
  const need = { water: totalPop * 1.2, food: totalPop * 1.2, energy: totalPop * 0.55 + 8000, housing: totalPop * 1.15 };
  let guardN = 0;
  while (sumOut('water') + w.lines.filter(l => l.type === 'conduit').length * STRUCT.conduit.out < need.water && guardN++ < 40) place(w, rng, rng.pick(w.districts), 'waterplant', 1, eng.id, 'Founding water plant.');
  guardN = 0;
  while (sumOut('food') < need.food && guardN++ < 80) { const d = rng.weighted(w.districts, d => d.kind === 'agri' ? 4 : d.kind === 'mixed' ? 1 : 0.3); place(w, rng, d, 'farm', 1, cult.id, 'Laid out in the founding agricultural plan.'); }
  guardN = 0;
  while (sumOut('energy') < need.energy && guardN++ < 20) place(w, rng, rng.weighted(w.districts, d => d.kind === 'industry' ? 4 : 1), rng.chance(0.5) ? 'fission' : 'solar', 1, eng.id, 'Founding power installation.');
  guardN = 0;
  while (sumOut('housing') < need.housing && guardN++ < 80) place(w, rng, rng.weighted(w.districts, d => d.pop / 1000 + 0.1), 'housing', 1, auth.id, 'Built during the founding settlement.');

  // ---- cohorts ----
  w.cohorts.push({ id: 0, name: cohortName(rng, 0, 1), born: -40, share: 0.35, memories: {} });
  w.cohorts.push({ id: 1, name: cohortName(rng, 1, 1), born: -20, share: 0.4, memories: {} });
  w.cohorts.push({ id: 2, name: 'Habitat-born', born: 0, share: 0.25, memories: {} });
  w.nextCohort = 3;

  // starting tech
  w.techPoints = rng.float(0, 10) + w.culture.technocratic * 10;

  // historical pressures: things that will bite later
  if (w.culture.openness > 0.6) w.pressures.push({ kind: 'migration', text: 'Open docking policy attracts arrivals from other habitats.' });
  if (w.culture.piety > 0.5) w.pressures.push({ kind: 'piety', text: 'A strong devotional tradition among the founders.' });
  if (w.districts.filter(d => d.kind === 'agri').length < 2) w.pressures.push({ kind: 'food', text: 'Too little land was reserved for agriculture.' });

  w.rngState = new RNG('sim:' + seed).getState();
  w.events.push({ id: nextId(w), year: 1, type: 'founding', title: `${w.name} settled`, text: `${formatNum(totalPop)} settlers from ${w.origin} take up residence across ${w.districts.length} districts.`, severity: 1, district: -1, faction: -1 });
  return w;
}

export function nextId(w) { return w.nextId++; }

export function addFaction(w, rng, arch, year, originText, opts = {}) {
  const a = FACTION_ARCHETYPES[arch];
  const f = {
    id: w.factions.length, arch, name: opts.name || factionName(rng, arch),
    ideology: { ...a.ideology }, color: a.color,
    power: 0, founded: year, dissolved: null, origin: originText,
    allies: [], rivals: [], grievances: [], institutions: 0, territory: 0,
    home: opts.home ?? -1, purpose: opts.purpose || null,
  };
  // slight ideological variation per world
  for (const k in f.ideology) f.ideology[k] = clamp(f.ideology[k] + rng.float(-0.1, 0.1), 0, 1);
  w.factions.push(f);
  for (const d of w.districts) if (d.infl[f.id] === undefined) d.infl[f.id] = opts.infl ? (opts.infl[d.id] || 0.05) : 0.05;
  return f;
}

export function neighbors(w, p) {
  const out = [];
  const at = (ix, iy) => (ix < 0 || iy < 0 || ix >= GRID_COLS || iy >= GRID_ROWS) ? null : w.plots[iy * GRID_COLS + ix];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = at(p.ix + dx, p.iy + dy); if (n) out.push(n); }
  return out;
}

export function freeSlot(w, d, rng) {
  const plots = d.plots.map(id => w.plots[id]).filter(p => !p.breached);
  rng.shuffle(plots);
  for (const p of plots) {
    const si = p.slots.findIndex(s => s === null);
    if (si >= 0) return { plot: p, slot: si };
  }
  return null;
}

export function place(w, rng, d, type, year, by, note, cause = null) {
  const fs = freeSlot(w, d, rng);
  if (!fs) return null;
  const s = {
    id: nextId(w), type, origType: type, plot: fs.plot.id, slot: fs.slot, district: d.id,
    built: year, by, removed: null, status: 'active', level: 1,
    layers: [{ year, type, status: 'active', note, cause }],
  };
  fs.plot.slots[fs.slot] = s.id;
  w.structures.push(s);
  return s;
}

export function addLine(w, from, to, type, year, by, note, cause = null) {
  const l = { id: nextId(w), type, from: from.id, to: to.id, built: year, by, removed: null, status: 'active', progress: 1, layers: [{ year, type, status: 'active', note, cause }] };
  w.lines.push(l);
  return l;
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function formatNum(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)); }
