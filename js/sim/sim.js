// The Century Engine — yearly simulation step.
// Pure logic: no DOM. Everything random comes from w.rngState.
import { RNG } from '../rng.js';
import { STRUCT, GRID_COLS, GRID_ROWS, COHORT_SPAN, CULTURE_COLORS } from './defs.js';
import { nextId, addFaction, neighbors, place, freeSlot, addLine, clamp, formatNum } from './gen.js';
import { crisisName, revoltName, revolutionaryRename, sacredRename, authoritarianRename, migrantDistrictName, originName, cohortName, shortFaction, districtName, coreName } from '../names.js';

export const TECH_TREE = [
  { id: 'recycling', label: 'Closed-loop water recycling', cost: 60 },
  { id: 'hydroponics', label: 'Hydroponic agriculture', cost: 150 },
  { id: 'hullweave', label: 'Self-sealing hull weave', cost: 270 },
  { id: 'fusion', label: 'Compact fusion', cost: 420 },
  { id: 'maglev', label: 'Maglev transit', cost: 600 },
  { id: 'biofilters', label: 'Soil biofilters', cost: 820 },
  { id: 'arcology', label: 'Arcology construction', cost: 1100 },
];

const COST = { housing: 0.6, tower: 1.6, farm: 0.5, hydroponic: 1.2, rooftop: 0.2, waterplant: 1.8, reservoir: 1.0, recycler: 2.4, fission: 3.0, solar: 1.2, fusion: 6, factory: 1.5, fabricator: 3, market: 0.6, civic: 1.2, assembly: 1.0, garrison: 1.2, school: 0.8, academy: 2.0, clinic: 0.8, hospital: 2.2, temple: 0.6, park: 0.4, memorial: 0.2, museum: 1.0, station: 1.0, barricade: 0.1 };

// ---------------------------------------------------------------- helpers
export function structAt(s, year) {
  let L = s.layers[0];
  for (const l of s.layers) { if (l.year <= year) L = l; else break; }
  return L;
}
export function isLive(s) { return s.removed === null && (s.status === 'active' || s.status === 'fortified' || s.status === 'damaged'); }
export function livingFactions(w) { return w.factions.filter(f => !f.dissolved); }
export function ruler(w) { return livingFactions(w).reduce((a, b) => (b.power > (a ? a.power : -1) ? b : a), null); }
export function totalPop(w) { return w.districts.reduce((a, d) => a + d.pop, 0); }
function activeDistricts(w) { return w.districts.filter(d => !d.abandoned && d.plots.length); }

function addEvent(w, e) {
  e.id = nextId(w); e.year = w.year;
  if (e.district === undefined) e.district = -1;
  if (e.faction === undefined) e.faction = -1;
  if (e.severity === undefined) e.severity = 1;
  w.events.push(e);
  if (e.severity >= 2) rememberEvent(w, e);
  if (e.district >= 0) w.districts[e.district].history.push({ year: w.year, text: e.title + (e.text ? ' — ' + e.text : ''), event: e.id });
  return e;
}
function addLayer(w, s, patch) {
  const prev = s.layers[s.layers.length - 1];
  const L = { year: w.year, type: patch.type || prev.type, status: patch.status || prev.status, note: patch.note || '', cause: patch.cause || null, addon: patch.addon !== undefined ? patch.addon : prev.addon };
  if (patch.by !== undefined) { L.by = patch.by; s.by = patch.by; }
  s.layers.push(L);
  s.type = L.type; s.status = L.status; s.addon = L.addon;
  if (L.status === 'demolished') s.removed = w.year;
}
function grieve(w, f, text, against = -1) {
  if (!f || f.dissolved) return;
  f.grievances.push({ year: w.year, text, against });
  if (f.grievances.length > 12) f.grievances.shift();
}
function recentCrisis(w, within = 6) {
  for (let i = w.events.length - 1; i >= 0; i--) {
    const e = w.events[i];
    if (w.year - e.year > within) break;
    if (e.crisis) return e;
  }
  return null;
}
function sponsor(w, type) {
  const c = STRUCT[type].cat;
  const arch = c === 'water' || c === 'energy' || c === 'industry' || c === 'transit' ? 'engineers' : c === 'food' ? 'cultivators' : c === 'commerce' ? 'guild' : null;
  const f = arch && livingFactions(w).find(f => f.arch === arch);
  return (f || ruler(w)).id;
}
function districtEco(w, d) {
  if (!d.plots.length) return 0;
  let s = 0; for (const id of d.plots) s += w.plots[id].soil; return s / d.plots.length;
}
function borderPlots(w, d, other = null) {
  const out = [];
  for (const id of d.plots) {
    const p = w.plots[id];
    if (neighbors(w, p).some(n => n.district !== d.id && (other === null || n.district === other))) out.push(p);
  }
  return out;
}
function ordinal(w, kind) { w.crisisCount[kind] = (w.crisisCount[kind] || 0) + 1; return w.crisisCount[kind] - 1; }

function rememberEvent(w, e) {
  for (const c of w.cohorts) {
    const age = w.year - c.born;
    if (age < 0 || age > 95) continue;
    const f = age < 5 ? 0.45 : age <= 45 ? 1 : 0.8;
    c.memories[e.id] = Math.min(1, (e.severity / 3) * f);
  }
}

// ---------------------------------------------------------------- tick
export function tick(w) {
  const rng = new RNG(w.rngState);
  w.year++;
  const S = w.stats = computeSupply(w);
  updateWealthAndSentiment(w, S, rng);
  updatePopulation(w, S, rng);
  updateEcologyAndHull(w, S, rng);
  updateFactions(w, S, rng);
  crises(w, S, rng);
  politics(w, S, rng);
  autonomousBuilding(w, S, rng);
  technology(w, S, rng);
  projects(w, S, rng);
  migrationWaves(w, S, rng);
  religion(w, S, rng);
  factionLifecycle(w, S, rng);
  cohorts(w, rng);
  maybeIntervention(w, S, rng);
  w.rngState = rng.getState();
}

// ---------------------------------------------------------------- supply
export function computeSupply(w) {
  const T = w.tech;
  const pop = totalPop(w);
  let food = 0, water = 0, energy = 0, industry = 0;
  const byD = {};
  for (const d of w.districts) byD[d.id] = { housing: 0, food: 0, water: 0, health: 0, edu: 0, commerce: 0, culture: 0, industry: 0, civic: 0 };
  const foodMul = 1 + (T.biofilters ? 0.15 : 0);
  const waterMul = (T.recycling ? 1.25 : 1);
  for (const s of w.structures) {
    if (!isLive(s)) continue;
    const def = STRUCT[s.type];
    const eff = s.status === 'damaged' ? 0.45 : 1;
    const b = byD[s.district] || (byD[s.district] = { housing: 0, food: 0, water: 0, health: 0, edu: 0, commerce: 0, culture: 0, industry: 0, civic: 0 });
    const plot = w.plots[s.plot];
    switch (def.cat) {
      case 'housing': b.housing += def.cap * eff * (T.arcology ? 1.3 : 1); if (s.addon === 'rooftop') { food += 700 * eff; b.food += 700 * eff; } break;
      case 'food': { const o = s.type === 'farm' ? def.out * (0.4 + plot.soil) : def.out; food += o * eff * foodMul; b.food += o * eff; break; }
      case 'water': { const o = def.out * waterMul * (s.type === 'waterplant' ? (0.6 + 0.4 * plot.hull) : 1); water += o * eff; b.water += o * eff; break; }
      case 'energy': energy += def.out * eff; break;
      case 'industry': industry += def.out * eff; b.industry += def.out * eff; break;
      case 'health': b.health += (s.type === 'hospital' ? 26000 : 8000) * eff; break;
      case 'education': b.edu += (s.type === 'academy' ? 30000 : 9000) * eff; break;
      case 'commerce': b.commerce += 1; break;
      case 'culture': b.culture += 1; break;
      case 'civic': b.civic += 1; break;
    }
  }
  for (const l of w.lines) {
    if (l.removed !== null || l.status !== 'active') continue;
    if (l.type === 'conduit') water += STRUCT.conduit.out * waterMul;
  }
  // trade adds imports
  const tradeMul = w.trade === 'open' ? 1.12 : w.trade === 'limited' ? 1.04 : 1;
  food *= tradeMul; water *= (w.trade === 'open' ? 1.05 : 1);
  const factories = industry;
  const eDemand = pop * 0.55 + factories * 500 + 800;
  const energyR = Math.min(1.5, energy / eDemand);
  const eFactor = clamp(energyR, 0.3, 1);
  water *= (0.5 + 0.5 * eFactor);
  const rationMul = w.rationing ? 0.82 : 1;
  const fDemand = pop * rationMul + 1;
  const wDemand = pop * rationMul + 1;
  const foodR = food / fDemand, waterR = water / wDemand;
  const eduAvg = pop ? w.districts.reduce((a, d) => a + d.edu * d.pop, 0) / pop : 0;
  let live = 0; for (const s of w.structures) if (s.removed === null && s.status !== 'ruin') live++;
  const upkeep = live * 0.012 + (w.program ? 1.2 : 0);
  // labour always produces something, so a collapsed grid can be rebuilt out of the ruins
  const floor = 0.9 + pop / 50000;
  const budget = Math.max(floor, industry * eFactor * (0.55 + 0.45 * eduAvg) * (w.trade === 'open' ? 1.15 : 1) - upkeep);
  const housing = w.districts.reduce((a, d) => a + (byD[d.id] ? byD[d.id].housing : 0), 0);
  // inequality: population-weighted spread of wealth
  const avgW = pop ? w.districts.reduce((a, d) => a + d.wealth * d.pop, 0) / pop : 0.5;
  const ineq = pop ? Math.sqrt(w.districts.reduce((a, d) => a + d.pop * (d.wealth - avgW) ** 2, 0) / pop) : 0;
  const eco = w.plots.reduce((a, p) => a + p.soil, 0) / w.plots.reduce((a, p) => a + p.soil0, 0);
  const hull = w.plots.reduce((a, p) => a + p.hull, 0) / w.plots.length;
  return { pop, food, water, energy, industry, foodR, waterR, energyR, budget, housing, byD, eduAvg, avgW, ineq, eco, hull, housingR: housing / Math.max(1, pop), tradeMul };
}

// ---------------------------------------------------------------- wealth/sentiment/classes
function updateWealthAndSentiment(w, S, rng) {
  const rul = ruler(w);
  for (const d of w.districts) {
    if (d.abandoned) { d.sentiment = 0; d.unrest = 0; continue; }
    const b = bd(S, d);
    const perCap = d.pop > 0 ? (b.commerce * 6000 + b.industry * 9000) / d.pop : 0;
    const ctrl = w.factions[d.ctrl];
    let target = 0.32 + 0.35 * clamp(perCap, 0, 1) + 0.12 * d.edu + (ctrl && ctrl.arch === 'guild' ? 0.1 : 0) + (w.trade === 'open' ? 0.06 : 0) - 0.25 * d.damage;
    if (rul && rul.ideology.communal > 0.7) target = 0.6 * target + 0.4 * S.avgW; // levelling
    d.wealth += (clamp(target, 0.05, 1) - d.wealth) * 0.08;
    // district-level supply: wealthier districts get served first during shortage
    const priority = 0.75 + 0.5 * d.wealth;
    const fR = clamp(S.foodR * priority, 0, 1.2), wR = clamp(S.waterR * priority, 0, 1.2), eR = clamp(S.energyR * priority, 0, 1.2);
    d.supply = { food: fR, water: wR, energy: eR };
    const overcrowd = d.pop > 0 ? clamp(d.pop / Math.max(1, b.housing) - 1, 0, 1) : 0;
    d.overcrowd = overcrowd;
    d.health += (clamp(0.25 + 0.55 * Math.min(1, b.health / Math.max(1, d.pop)) + 0.1 * Math.min(fR, 1) - 0.2 * overcrowd - 0.15 * d.damage + (w.tech.biofilters ? 0.05 : 0), 0.05, 1) - d.health) * 0.2;
    d.edu += (clamp(0.15 + 0.7 * Math.min(1, b.edu / Math.max(1, d.pop)) + 0.1 * d.wealth, 0.05, 1) - d.edu) * 0.15;
    let st = 0.58 + 0.25 * (Math.min(fR, 1) - 1) * 2 + 0.25 * (Math.min(wR, 1) - 1) * 2 + 0.1 * (Math.min(eR, 1) - 1) + 0.12 * (d.health - 0.5) + 0.04 * Math.min(b.culture, 3)
      - 0.22 * overcrowd - 0.3 * d.damage - (w.rationing ? 0.07 : 0) - 0.5 * Math.max(0, S.avgW - d.wealth) + 0.05 * (d.edu - 0.4);
    if (ctrl) {
      // people dislike being ruled by a faction ideologically distant from the habitat's culture
      const dist = Math.abs(ctrl.ideology.communal - w.culture.communal) + Math.abs(ctrl.ideology.tradition - (1 - w.culture.technocratic)) * 0.5;
      st -= 0.08 * dist;
      if (ctrl.ideology.control < 0.3) st -= 0.03;
      if (rul && rul !== ctrl && rul.rivals.includes(ctrl.id)) st -= 0.04;
    }
    d.sentiment += (clamp(st, 0, 1) - d.sentiment) * 0.3;
    if (d.sentiment < 0.4) d.unrest = clamp(d.unrest + 0.1 + (0.4 - d.sentiment) * 1.5, 0, 1.6);
    else d.unrest = Math.max(0, d.unrest - 0.12);
  }
}

// ---------------------------------------------------------------- population & migration
function updatePopulation(w, S, rng) {
  const act = activeDistricts(w);
  const attract = {};
  for (const d of w.districts) {
    if (d.abandoned) { attract[d.id] = -9; continue; }
    const b = bd(S, d);
    const room = (b.housing - d.pop) / Math.max(1, d.pop);
    attract[d.id] = clamp(room, -1, 1) * 0.6 + 0.3 * d.wealth + 0.3 * d.sentiment - 0.6 * d.damage + 0.1 * (b.commerce > 0 ? 1 : 0);
  }
  const avgA = act.length ? act.reduce((a, d) => a + attract[d.id], 0) / act.length : 0;
  const flows = [];
  for (const d of act) {
    const fR = d.supply.food, wR = d.supply.water;
    const birth = 0.019 * (0.5 + 0.5 * d.health) * (1 - 0.7 * clamp(d.overcrowd, 0, 1)) * (1 - 0.45 * d.edu) * (1 - 0.3 * clamp(S.pop / 900000, 0, 1));
    let death = 0.010 * (1.4 - 0.8 * d.health);
    if (fR < 1) death += (1 - fR) * 0.09;
    if (wR < 1) death += (1 - wR) * 0.13;
    if (d.overcrowd > 0.1) death += 0.012 * d.overcrowd;
    const born = d.pop * birth, died = d.pop * death;
    d.born = born; d.deaths = died;
    d.pop = Math.max(0, d.pop + born - died);
    // out-migration from unattractive districts
    if (attract[d.id] < avgA - 0.05) {
      const rate = clamp((avgA - attract[d.id]) * 0.06, 0, 0.06);
      const n = d.pop * rate;
      if (n > 5) flows.push({ from: d, n });
      d.pop -= n;
    }
  }
  const dests = act.filter(d => attract[d.id] > avgA - 0.02);
  for (const fl of flows) {
    const pool = dests.filter(d => d !== fl.from);
    if (!pool.length) { fl.from.pop += fl.n; continue; }
    const sum = pool.reduce((a, d) => a + Math.max(0.01, attract[d.id] - avgA + 0.3), 0);
    for (const d of pool) {
      const share = fl.n * Math.max(0.01, attract[d.id] - avgA + 0.3) / sum;
      d.pop += share;
      d.inflow = d.inflow || {}; d.inflow[fl.from.id] = (d.inflow[fl.from.id] || 0) * 0.5 + share;
      if (fl.from.culture !== d.culture && share > d.pop * 0.03) d.mix = (d.mix || 0) + share / d.pop;
    }
  }
  for (const d of w.districts) { if (d.inflow) for (const k in d.inflow) d.inflow[k] *= 0.7; d.pop = Math.round(d.pop); }
}

// ---------------------------------------------------------------- ecology & hull
function updateEcologyAndHull(w, S, rng) {
  const farmLoad = new Float32Array(w.plots.length), indLoad = new Float32Array(w.plots.length);
  for (const s of w.structures) {
    if (!isLive(s)) continue;
    if (s.type === 'farm') farmLoad[s.plot] += 1;
    if (STRUCT[s.type].cat === 'industry') { indLoad[s.plot] += 1; for (const n of neighbors(w, w.plots[s.plot])) indLoad[n.id] += 0.5; }
  }
  const maintain = S.budget > S.pop / 9000 ? 0.0025 : 0.0008; // healthy industry keeps the hull maintained
  for (const p of w.plots) {
    const stress = Math.min(farmLoad[p.id], 2.5) * (w.tech.biofilters ? 0.0006 : 0.0018) + indLoad[p.id] * 0.0015;
    const recover = (w.tech.biofilters ? 0.006 : 0.003) * (p.scar === 'blight' && !w.tech.biofilters ? 0.15 : 1);
    p.soil = clamp(p.soil - stress + (stress < 0.001 ? recover : 0) * (p.soil < p.soil0 ? 1 : 0), 0.03, 1);
    p.hull = clamp(p.hull - 0.0016 - indLoad[p.id] * 0.0008 + (p.breached ? 0 : maintain) * (p.hull < p.hull0 ? 1 : 0) + (w.tech.hullweave ? 0.002 : 0), 0.05, 1);
  }
}

// ---------------------------------------------------------------- factions
function fit(w, f, d, S) {
  const b = bd(S, d);
  const scarcity = clamp(2 - d.supply.food - d.supply.water, 0, 1);
  const poorer = clamp((S.avgW - d.wealth) * 2, 0, 1);
  const trauma = traumaLevel(w);
  switch (f.arch) {
    case 'authority': return 0.3 + 0.5 * d.sentiment - 0.4 * scarcity + 0.3 * (d.kind === 'civic') + 0.1 * Math.min(b.civic, 2);
    case 'guild': return 0.1 + 0.45 * d.wealth + (w.trade === 'open' ? 0.2 : w.trade === 'closed' ? -0.2 : 0) + 0.1 * Math.min(b.commerce, 3) - 0.3 * scarcity;
    case 'cultivators': return 0.15 + 0.6 * (d.kind === 'agri') + 0.3 * (b.food > d.pop * 0.5 ? 1 : 0) + 0.3 * memoryOf(w, 'famine');
    case 'engineers': return 0.2 + 0.5 * (d.kind === 'industry') + 0.3 * d.edu + 0.3 * (d.damage > 0 ? 1 : 0) + 0.25 * w.culture.technocratic;
    case 'collective': return 0.1 + 0.6 * scarcity + 0.6 * poorer + 0.4 * d.overcrowd + 0.3 * w.culture.communal;
    case 'faith': return 0.05 + 0.5 * (1 - d.edu) + 0.5 * trauma + 0.3 * (1 - d.sentiment) + 0.4 * w.culture.piety + 0.2 * (w.plots[d.plots[0]] && d.plots.some(id => w.plots[id].sacred) ? 1 : 0);
    case 'rationing': return (w.rationing ? 0.8 : -0.1) + 0.4 * scarcity + 0.25 * f.institutions;
    case 'separatist': return (d.id === f.home ? 0.6 : 0.05) + 0.4 * poorer + 0.4 * d.damage + 0.1 * f.grievances.length;
    case 'migrant': return 0.05 + 0.8 * (d.culture > 0 ? 1 : 0) + 0.3 * (d.mix || 0) + 0.2 * w.culture.openness;
  }
  return 0.2;
}
function memoryOf(w, kind) {
  let m = 0;
  for (let i = w.events.length - 1; i >= 0 && w.year - w.events[i].year < 60; i--) if (w.events[i].crisis === kind) m = Math.max(m, 1 - (w.year - w.events[i].year) / 60);
  return m;
}
function traumaLevel(w) {
  let t = 0;
  for (let i = w.events.length - 1; i >= 0 && w.year - w.events[i].year < 50; i--) { const e = w.events[i]; if (e.severity >= 3) t = Math.max(t, (1 - (w.year - e.year) / 50)); }
  return t;
}
function updateFactions(w, S, rng) {
  const live = livingFactions(w);
  const inst = {}; for (const f of live) inst[f.id] = 0;
  for (const s of w.structures) if (isLive(s) && STRUCT[s.type].cat === 'civic' && inst[s.by] !== undefined) inst[s.by]++;
  for (const f of live) f.institutions = inst[f.id];
  for (const d of w.districts) {
    if (d.abandoned) continue;
    let sum = 0;
    for (const f of live) {
      const ft = fit(w, f, d, S);
      let v = (d.infl[f.id] || 0.05) + 0.05 * (ft - 0.45) + rng.float(-0.01, 0.01);
      if (d.ctrl === f.id) v += 0.01 - 0.02 * Math.min(1, (w.year - (d.ctrlSince || 0)) / 60) * (1 - d.sentiment);
      // institutions inside the district cement influence
      v = clamp(v, 0.01, 1.5); d.infl[f.id] = v; sum += v;
    }
    for (const f of live) d.infl[f.id] /= sum;
    // control with hysteresis
    let best = null, second = 0;
    for (const f of live) { const v = d.infl[f.id]; if (!best || v > d.infl[best.id]) { second = best ? d.infl[best.id] : second; best = f; } else if (v > second) second = v; }
    const cur = w.factions[d.ctrl];
    if (!cur || cur.dissolved) { d.ctrl = best.id; if (cur) addEvent(w, { type: 'control', title: `${best.name} takes over ${d.name}`, text: `Administration passed to ${best.name} after ${cur.name} dissolved.`, district: d.id, faction: best.id }); continue; }
    if (best.id !== d.ctrl && d.infl[best.id] > d.infl[d.ctrl] + 0.08) {
      const violent = d.unrest > 0.5;
      if (violent) continue; // violent transitions are resolved by revolts in politics()
      d.ctrl = best.id; d.ctrlSince = w.year;
      addEvent(w, { type: 'control', title: `${best.name} wins ${d.name}`, text: `The district council passed peacefully from ${cur.name} to ${best.name}.`, district: d.id, faction: best.id, severity: 1 });
      grieve(w, cur, `Lost the council of ${d.name} to ${best.name}.`, best.id);
    }
  }
  // power, territory, allies and rivals
  for (const f of live) {
    let p = 0, t = 0;
    for (const d of w.districts) { if (d.abandoned) continue; p += (d.infl[f.id] || 0) * d.pop; if (d.ctrl === f.id) t++; }
    f.power = (S.pop ? p / S.pop : 0) + f.institutions * 0.03;
    f.territory = t;
  }
  for (const f of live) {
    for (const g of live) {
      if (g === f) continue;
      const dist = ideoDist(f, g);
      const gr = f.grievances.filter(x => x.against === g.id && w.year - x.year < 60).length;
      const ally = f.allies.includes(g.id), rival = f.rivals.includes(g.id);
      if (!ally && !rival && dist < 0.35 && gr === 0 && rng.chance(0.08)) f.allies.push(g.id);
      if (ally && (dist > 0.55 || gr > 0)) f.allies.splice(f.allies.indexOf(g.id), 1);
      if (!rival && (dist > 0.7 || gr >= 2) && rng.chance(0.15)) f.rivals.push(g.id);
      if (rival && dist < 0.45 && gr === 0 && rng.chance(0.05)) f.rivals.splice(f.rivals.indexOf(g.id), 1);
    }
  }
}
function ideoDist(f, g) { let s = 0; for (const k in f.ideology) s += Math.abs(f.ideology[k] - g.ideology[k]); return s / 2; }

// ---------------------------------------------------------------- crises
function crises(w, S, rng) {
  const c = w.crisisState || (w.crisisState = {});
  aging(w, S, rng);
  // ---- water
  track(w, S, rng, c, 'water', S.waterR < 0.88, S.waterR > 0.97, 2, (ev) => {
    ev.text = `Water output covers only ${Math.round(S.waterR * 100)}% of demand. Wealthier districts are served first; the poorer wards run dry.`;
    const rul = ruler(w);
    if (rul && rul.ideology.communal > 0.55 && !w.rationing) { w.rationing = true; w.rationingSince = w.year; ev.text += ` ${rul.name} imposes rationing.`; }
  }, () => { if (w.rationing && w.year - w.rationingSince > 4) { w.rationing = false; addEvent(w, { type: 'policy', title: 'Rationing lifted', text: 'Supplies recovered enough to end rationing.', severity: 1 }); } });
  // ---- famine
  track(w, S, rng, c, 'famine', S.foodR < 0.85, S.foodR > 0.97, 2, (ev) => {
    ev.text = `Harvests cover ${Math.round(S.foodR * 100)}% of need. Households begin planting on rooftops.`;
    let n = 0;
    for (const s of w.structures) {
      if (n >= 6) break;
      if (isLive(s) && STRUCT[s.type].cat === 'housing' && !s.addon && rng.chance(0.35)) { addLayer(w, s, { addon: 'rooftop', note: `Rooftop farm planted during ${the(ev.title)}.`, cause: ev.id }); n++; }
    }
  });
  // ---- blackout
  track(w, S, rng, c, 'blackout', S.energyR < 0.75, S.energyR > 0.92, 2, (ev) => { ev.text = `Power output at ${Math.round(S.energyR * 100)}% of demand. Water plants and factories run on rotation; the sun-line dims over the outer wards.`; });
  // ---- plague
  const dense = w.districts.filter(d => !d.abandoned && d.overcrowd > 0.25 && d.health < 0.45);
  if (dense.length && !c.plagueUntil && rng.chance(0.05 + (w.trade === 'open' ? 0.03 : 0))) {
    const name = crisisName(rng, 'plague', ordinal(w, 'plague'));
    const src = rng.pick(dense);
    const ev = addEvent(w, { type: 'crisis', crisis: 'plague', title: name, text: `An epidemic spreads from the crowded blocks of ${src.name}.`, district: src.id, severity: 3 });
    for (const d of w.districts) { if (d.abandoned) continue; const k = 0.02 + 0.08 * d.overcrowd * (1.2 - d.health); d.pop = Math.round(d.pop * (1 - k)); }
    c.plagueUntil = w.year + rng.range(2, 4); c.plagueSrc = src.id; c.plagueEv = ev.id;
  } else if (c.plagueUntil && w.year >= c.plagueUntil) {
    c.plagueUntil = 0;
    const d = w.districts[c.plagueSrc];
    const s = place(w, rng, d, 'clinic', w.year, ruler(w).id, `Built after the epidemic of Year ${w.events.find(e => e.id === c.plagueEv).year}.`, c.plagueEv);
    if (s) addEvent(w, { type: 'build', title: `Clinic opens in ${d.name}`, text: 'A response to the epidemic.', district: d.id });
  }
  // ---- hull pressure failures
  for (const p of w.plots) {
    if (p.breached || p.hull > 0.42) continue;
    if (!rng.chance(0.018 * (0.42 - p.hull) / 0.42 + 0.004)) continue;
    const d = w.districts[p.district];
    const name = crisisName(rng, 'breach', ordinal(w, 'breach'));
    p.breached = true; p.scar = 'breach';
    const ev = addEvent(w, { type: 'crisis', crisis: 'breach', title: name, text: `Hull pressure failed beneath ${d.name}. The sector was sealed; ${d.pop > 2000 ? 'thousands' : 'hundreds'} were displaced.`, district: d.id, severity: 3, plot: p.id });
    for (const sid of p.slots) if (sid) { const s = w.structures.find(x => x.id === sid); if (s && isLive(s)) addLayer(w, s, { status: rng.chance(0.6) ? 'ruin' : 'damaged', note: `Wrecked in ${the(name)}.`, cause: ev.id }); }
    const lost = Math.round(d.pop / Math.max(1, d.plots.length) * 0.35);
    d.pop -= lost;
    const dest = activeDistricts(w).filter(x => x !== d); if (dest.length) rng.pick(dest).pop += lost;
    d.damage = d.plots.filter(id => w.plots[id].breached).length / d.plots.length;
    grieve(w, w.factions[d.ctrl], `The hull failed under ${d.name} while the administration looked elsewhere.`);
  }
  // ---- blight
  for (const s of w.structures) {
    if (!isLive(s) || s.type !== 'farm') continue;
    const p = w.plots[s.plot];
    if (p.soil < 0.15 && p.scar !== 'blight' && rng.chance(0.025)) {
      const d = w.districts[p.district];
      let ev = c.blightEv && w.year - c.blightEv.year < 20 ? c.blightEv : null;
      let name;
      if (ev) { name = ev.title; ev.text += ` It spread to ${d.name} in Year ${w.year}.`; d.history.push({ year: w.year, text: `The ${name} spread here; a field died.`, event: ev.id }); }
      else { name = crisisName(rng, 'blight', ordinal(w, 'blight')); ev = c.blightEv = addEvent(w, { type: 'crisis', crisis: 'blight', title: name, text: `Exhausted soil in ${d.name} collapsed into a dead field. The plot will not grow food again for generations.`, district: d.id, severity: 2, plot: p.id }); }
      p.scar = 'blight'; p.soil = 0.05;
      for (const sid of p.slots) if (sid) { const x = w.structures.find(y => y.id === sid); if (x && isLive(x) && x.type === 'farm') addLayer(w, x, { status: 'abandoned', note: `Left fallow after ${the(name)}.`, cause: ev.id }); }
      grieve(w, livingFactions(w).find(f => f.arch === 'cultivators'), `The soil of ${d.name} was worked to death.`);
      break;
    }
  }
  // ---- abandonment of badly damaged districts
  for (const d of w.districts) {
    if (d.abandoned || d.damage < 0.45) continue;
    d.damageSince = d.damageSince || w.year;
    const rul = ruler(w);
    if (w.year - d.damageSince > 7 && S.budget < 3) abandonDistrict(w, rng, d, 'The administration could not afford repairs; the sector was sealed and its people dispersed.');
    else if (rul && S.budget > 6 && rng.chance(0.3)) repairDistrict(w, rng, d, rul);
  }
}
function track(w, S, rng, c, kind, cond, resolved, needYears, onStart, onEnd) {
  const st = c[kind] || (c[kind] = { years: 0, active: null });
  if (cond) {
    st.years++;
    if (!st.active && st.years >= needYears) {
      const name = crisisName(rng, kind, ordinal(w, kind));
      const worst = activeDistricts(w).sort((a, b) => a.wealth - b.wealth)[0];
      const ev = addEvent(w, { type: 'crisis', crisis: kind, title: name, text: '', district: worst ? worst.id : -1, severity: 3 });
      onStart(ev); st.active = ev.id; st.start = w.year;
    }
  } else { st.years = 0; }
  if (st.active && resolved) {
    const ev = w.events.find(e => e.id === st.active);
    addEvent(w, { type: 'resolution', title: `${ev.title} ends`, text: `After ${w.year - st.start} years, supply recovered.`, severity: 1, cause: ev.id });
    ev.ended = w.year; st.active = null; if (onEnd) onEnd();
  }
}
function abandonDistrict(w, rng, d, why) {
  d.abandoned = true; d.abandonedYear = w.year; d.damage = 1;
  const ev = addEvent(w, { type: 'abandon', title: `${d.name} abandoned`, text: why, district: d.id, severity: 3 });
  const dest = activeDistricts(w);
  if (dest.length) { const per = d.pop / dest.length; for (const x of dest) { x.pop += per; x.inflow = x.inflow || {}; x.inflow[d.id] = per; } }
  d.pop = 0;
  for (const s of w.structures) if (s.district === d.id && isLive(s)) addLayer(w, s, { status: 'abandoned', note: `Abandoned when ${d.name} was sealed.`, cause: ev.id });
  for (const l of w.lines) if ((l.from === d.id || l.to === d.id) && l.status === 'active') { l.status = 'abandoned'; l.layers.push({ year: w.year, type: l.type, status: 'abandoned', note: `Cut off when ${d.name} was sealed.`, cause: ev.id }); }
  const f = w.factions[d.ctrl];
  grieve(w, f, `${d.name}, our district, was abandoned by the habitat.`);
  d.ctrl = -1;
}
function repairDistrict(w, rng, d, f) {
  const breached = d.plots.map(id => w.plots[id]).filter(p => p.breached);
  const ev = addEvent(w, { type: 'repair', title: `${d.name} resealed`, text: `${f.name} funded a hull repair programme. The scars remain visible.`, district: d.id, faction: f.id, severity: 2 });
  for (const p of breached) { p.breached = false; p.hull = Math.max(p.hull, w.tech.hullweave ? 0.9 : 0.7); p.hull0 = Math.max(p.hull0, p.hull); const si = p.slots.findIndex(x => x === null); const s = si >= 0 ? place(w, rng, d, 'hullpatch', w.year, f.id, `Pressure patch welded over the breach of Year ${d.damageSince}.`, ev.id) : null; }
  d.damage = 0; d.damageSince = 0;
}

// ---------------------------------------------------------------- politics
function politics(w, S, rng) {
  const rul = ruler(w);
  for (const d of w.districts) {
    if (d.abandoned) continue;
    const cur = w.factions[d.ctrl];
    if (!cur) continue;
    if (d.unrest > 0.5 && !(d.lastProtest > w.year - 10)) {
      d.lastProtest = w.year;
      addEvent(w, { type: 'protest', title: `Protests in ${d.name}`, text: `Crowds gather against ${cur.name} over ${grievanceCause(w, d, S)}.`, district: d.id, faction: cur.id, severity: 1 });
    }
    if (d.unrest > 1.25 && !(d.lastRevolt > w.year - 25)) {
      d.lastRevolt = w.year;
      // challenger: strongest non-controlling faction
      const chal = livingFactions(w).filter(f => f.id !== d.ctrl).sort((a, b) => d.infl[b.id] - d.infl[a.id])[0];
      if (!chal) continue;
      revolt(w, S, rng, d, cur, chal);
      d.unrest = 0.2;
    }
  }
  // revolution: challenger nationally outweighs the ruler amid widespread discontent
  if (rul) {
    const chal = livingFactions(w).filter(f => f !== rul).sort((a, b) => b.power - a.power)[0];
    const meanSent = S.pop ? w.districts.reduce((a, d) => a + d.sentiment * d.pop, 0) / S.pop : 0.5;
    if (chal && chal.power > rul.power * 0.85 && meanSent < 0.47 && rng.chance(0.25) && !(w.lastRevolution > w.year - 30)) revolution(w, rng, rul, chal);
  }
  // old barricades harden into boundary walls
  for (const s of w.structures) if (s.type === 'barricade' && s.status === 'active' && w.year - s.built > 30 && rng.chance(0.1)) addLayer(w, s, { type: 'wall', note: `Nobody removed the barricade. After thirty years it is simply where ${w.districts[s.district].name} ends.` });
}
function grievanceCause(w, d, S) {
  if (d.supply.water < 0.85) return 'the water shortage';
  if (d.supply.food < 0.85) return 'hunger';
  if (d.overcrowd > 0.2) return 'overcrowding';
  if (S.avgW - d.wealth > 0.12) return 'neglect of the poorer wards';
  if (d.damage > 0) return 'the unrepaired breach';
  if (w.rationing) return 'rationing';
  return 'the administration';
}
function revolt(w, S, rng, d, cur, chal) {
  const name = revoltName(rng, d.name, w.year);
  const pSuccess = clamp(d.infl[chal.id] / (d.infl[chal.id] + d.infl[cur.id]) + 0.25 * (1 - d.sentiment) - (cur.arch === 'authority' ? 0.1 : 0), 0.15, 0.85);
  const success = rng.chance(pSuccess);
  const ev = addEvent(w, { type: 'revolt', title: name, text: success ? `${chal.name} seized ${d.name} from ${cur.name}.` : `${cur.name} crushed an uprising led by ${chal.name}.`, district: d.id, faction: chal.id, severity: 3 });
  d.pop = Math.round(d.pop * (1 - rng.float(0.005, 0.02)));
  // barricades on the frontier facing districts still held by the incumbent
  const border = borderPlots(w, d).filter(p => neighbors(w, p).some(n => n.district !== d.id && w.districts[n.district].ctrl === cur.id));
  rng.shuffle(border);
  let n = 0;
  for (const p of border) {
    if (n >= 3) break;
    const si = p.slots.findIndex(s => s === null);
    if (si < 0) { p.scar = p.scar || 'barricade'; n++; continue; }
    const s = { id: nextId(w), type: 'barricade', origType: 'barricade', plot: p.id, slot: si, district: d.id, built: w.year, by: chal.id, removed: null, status: 'active', layers: [{ year: w.year, type: 'barricade', status: 'active', note: `Thrown up during ${the(name)}.`, cause: ev.id }] };
    p.slots[si] = s.id; w.structures.push(s); n++;
  }
  const civic = w.structures.filter(s => s.district === d.id && isLive(s) && STRUCT[s.type].cat === 'civic');
  if (success) {
    d.ctrl = chal.id; d.ctrlSince = w.year; d.infl[cur.id] *= 0.5; d.infl[chal.id] += 0.15;
    for (const s of civic) addLayer(w, s, { type: chal.ideology.control > 0.5 ? 'assembly' : 'garrison', status: 'active', by: chal.id, note: `Seized and repurposed by ${chal.name} in ${the(name)}.`, cause: ev.id });
    if (rng.chance(0.45)) renameDistrict(w, rng, d, chal.arch === 'faith' ? sacredRename(rng, d.core) : chal.ideology.control < 0.4 ? authoritarianRename(rng, d.core, shortFaction(chal.name)) : revolutionaryRename(rng, d.core), `Renamed after ${the(name)}.`);
    grieve(w, cur, `Driven out of ${d.name} in ${the(name)}.`, chal.id);
    d.sentiment = Math.min(0.6, d.sentiment + 0.2);
    // large districts can split along the barricade line
    if (d.plots.length >= 8 && w.districts.length < 16 && rng.chance(0.35)) splitDistrict(w, rng, d, cur, chal, name, ev.id);
  } else {
    for (const s of civic) if (rng.chance(0.6)) addLayer(w, s, { status: 'fortified', note: `Fortified during ${the(name)}.`, cause: ev.id });
    const g = place(w, rng, d, 'garrison', w.year, cur.id, `Garrison built by ${cur.name} after ${the(name)}.`, ev.id);
    grieve(w, chal, `Our rising in ${d.name} was put down by ${cur.name}.`, cur.id);
    d.infl[chal.id] *= 0.6;
    d.sentiment = Math.max(0.25, d.sentiment); d.unrest = 0;
  }
  if (rng.chance(0.5)) place(w, rng, d, 'memorial', w.year + 2, success ? chal.id : cur.id, `Memorial to the dead of ${the(name)}.`, ev.id);
}
function splitDistrict(w, rng, d, cur, chal, name, cause) {
  // BFS from a border plot to peel off roughly a third of the district
  const start = borderPlots(w, d)[0] || w.plots[d.plots[0]];
  const want = Math.floor(d.plots.length / 3);
  const taken = new Set([start.id]); const q = [start];
  while (q.length && taken.size < want) { const p = q.shift(); for (const n of neighbors(w, p)) if (n.district === d.id && !taken.has(n.id)) { taken.add(n.id); q.push(n); } }
  if (taken.size < 2) return;
  const nd = newDistrict(w, rng, coreName(rng) + ' ' + rng.pick(['Barricades', 'Redoubt', 'Hold', 'Quarter']), 'residential', [...taken], d.culture, `Split from ${d.name} along the barricade line of ${the(name)}.`);
  nd.ctrl = cur.id; nd.infl = { ...d.infl }; nd.infl[cur.id] = Math.max(nd.infl[cur.id], 0.5);
  nd.pop = Math.round(d.pop * taken.size / (d.plots.length + taken.size)); d.pop -= nd.pop;
  addEvent(w, { type: 'border', title: `${nd.name} splits from ${d.name}`, text: `The barricade line of ${the(name)} became a permanent boundary; ${cur.name} kept the far side.`, district: nd.id, faction: cur.id, severity: 2, cause });
}
function newDistrict(w, rng, name, kind, plotIds, culture, originText) {
  const d = { id: w.districts.length, name, core: name.split(' ').filter(x => !['Little','New','The'].includes(x))[0] || name, kind, founded: w.year, names: [{ year: w.year, name, reason: originText }], culture, pop: 0, wealth: 0.4, sentiment: 0.55, edu: 0.3, health: 0.5, ctrl: -1, infl: {}, damage: 0, abandoned: false, plots: [], history: [{ year: w.year, text: originText }], unrest: 0, supply: { food: 1, water: 1, energy: 1 }, overcrowd: 0, services: {} };
  for (const f of w.factions) d.infl[f.id] = 0.1;
  for (const id of plotIds) {
    const p = w.plots[id]; const old = w.districts[p.district];
    if (old) old.plots.splice(old.plots.indexOf(id), 1);
    p.district = d.id; d.plots.push(id);
    for (const sid of p.slots) if (sid) { const s = w.structures.find(x => x.id === sid); if (s) s.district = d.id; }
  }
  w.districts.push(d);
  return d;
}
function renameDistrict(w, rng, d, name, reason) {
  const old = d.name; d.name = name; d.names.push({ year: w.year, name, reason });
  d.history.push({ year: w.year, text: `Renamed from ${old} to ${name}. ${reason}` });
}
function revolution(w, rng, rul, chal) {
  w.lastRevolution = w.year;
  const name = rng.pick([`The ${coreName(rng)} Revolution`, `The ${rng.pick(['Spring', 'Winter', 'Lantern', 'Ration', 'Long'])} Revolution`, `Fall of the ${shortFaction(rul.name)}`]);
  const ev = addEvent(w, { type: 'revolution', title: name, text: `${chal.name} overthrew the ${rul.name}, which had governed the habitat's central institutions.`, faction: chal.id, severity: 3 });
  for (const d of w.districts) {
    if (d.abandoned) continue;
    d.infl[chal.id] = (d.infl[chal.id] || 0.1) + 0.25; d.infl[rul.id] = (d.infl[rul.id] || 0.1) * 0.4;
    if (d.ctrl === rul.id && rng.chance(0.7)) d.ctrl = chal.id;
    if (rng.chance(0.3)) renameDistrict(w, rng, d, chal.arch === 'faith' ? sacredRename(rng, d.core) : chal.ideology.control < 0.4 ? authoritarianRename(rng, d.core, shortFaction(chal.name)) : revolutionaryRename(rng, d.core), `Renamed in ${the(name)}.`);
    d.sentiment = Math.min(0.7, d.sentiment + 0.15); d.unrest = 0;
  }
  for (const s of w.structures) {
    if (!isLive(s) || STRUCT[s.type].cat !== 'civic' || s.by !== rul.id) continue;
    const r = rng.next();
    if (r < 0.5) addLayer(w, s, { type: chal.ideology.control > 0.5 ? 'assembly' : 'garrison', by: chal.id, status: 'active', note: `Taken over by ${chal.name} in ${the(name)}.`, cause: ev.id });
    else if (r < 0.75) addLayer(w, s, { type: 'museum', by: chal.id, status: 'active', note: `The old ${STRUCT[s.type].label.toLowerCase()} of the ${rul.name} was turned into a museum after ${the(name)}.`, cause: ev.id });
    else addLayer(w, s, { type: 'housing', by: chal.id, status: 'active', note: `Converted into housing after ${the(name)}.`, cause: ev.id });
  }
  grieve(w, rul, `Overthrown in ${the(name)}.`, chal.id);
  chal.power += 0.2;
}

// ---------------------------------------------------------------- autonomous building
function autonomousBuilding(w, S, rng) {
  const rul = ruler(w); if (!rul) return;
  let budget = S.budget * 0.55 + (w.reserve || 0);
  for (const pr of w.projects) if (pr.status === 'construction') budget -= 1.2; // committed
  const pop = S.pop;
  const cr = recentCrisis(w);
  const needs = [];
  const cov = (cat) => w.districts.reduce((a, d) => a + (bd(S, d)[cat] || 0), 0);
  const pr = w.priority || null;
  if (S.waterR < 1.08) needs.push({ what: w.tech.recycling ? 'recycler' : (rng.chance(0.5) ? 'waterplant' : 'reservoir'), urgency: (1.1 - S.waterR) * 4 + 1 });
  if (S.foodR < 1.1) needs.push({ what: w.tech.hydroponics ? 'hydroponic' : 'farm', urgency: (1.12 - S.foodR) * 4 + (pr === 'agri' ? 1 : 0) + 0.9 });
  if (S.energyR < 1.1) needs.push({ what: w.tech.fusion ? 'fusion' : (rng.chance(0.4) ? 'solar' : 'fission'), urgency: (1.12 - S.energyR) * 4 + 0.9 });
  if (S.housingR < 1.08) needs.push({ what: 'housing', urgency: (1.1 - S.housingR) * 5 + (pr === 'housing' ? 1 : 0) + 0.8 });
  if (cov('health') < pop * 0.9) needs.push({ what: pop > 120000 && w.tech.recycling ? 'hospital' : 'clinic', urgency: 0.6 });
  if (cov('edu') < pop * 0.9) needs.push({ what: pop > 100000 ? 'academy' : 'school', urgency: 0.55 + 0.3 * w.culture.technocratic });
  if (cov('commerce') < pop / 16000) needs.push({ what: 'market', urgency: 0.4 + (w.trade === 'open' ? 0.3 : 0) });
  if (S.industry < pop / 14000 + 1) needs.push({ what: w.tech.fusion ? 'fabricator' : 'factory', urgency: 0.7 + (pr === 'industry' ? 1 : 0) });
  if (cov('culture') < pop / 25000 && S.avgW > 0.45) needs.push({ what: 'park', urgency: 0.3 });
  if (cov('civic') < w.districts.filter(d => !d.abandoned).length / 2) needs.push({ what: rul.ideology.control > 0.5 ? 'assembly' : 'civic', urgency: 0.35 });
  needs.sort((a, b) => b.urgency - a.urgency);
  let built = 0;
  for (const nd of needs) {
    if (built >= 4) break;
    let cost = (COST[nd.what] || 1) * (1 + S.pop / 250000);
    if (nd.urgency > 2.5) cost *= 0.5; // emergency works: everything else stops
    if (budget < cost) continue;
    const d = chooseDistrict(w, S, rng, nd.what);
    if (!d) { w.spacePressure = (w.spacePressure || 0) + 1; continue; }
    const by = STRUCT[nd.what].cat === 'housing' ? rul.id : sponsor(w, nd.what);
    let note;
    const src = d.inflow && Object.entries(d.inflow).sort((a, b) => b[1] - a[1])[0];
    if (cr && (STRUCT[nd.what].cat === STRUCTCAT_FOR_CRISIS[cr.crisis] || nd.urgency > 2)) note = `Built in Year ${w.year} after ${the(cr.title)}.`;
    else if (STRUCT[nd.what].cat === 'housing' && src && src[1] > 300 && w.districts[src[0]]) note = `Expanded after migration from ${w.districts[src[0]].name}.`;
    else note = defaultNote(w, nd.what, S);
    const s = placeOrDensify(w, rng, d, nd.what, by, note, cr ? cr.id : null);
    if (s) { budget -= cost; built++; }
  }
  w.reserve = clamp(budget, 0, 12);
  // obsolete infrastructure gets converted when there is demand for space
  if (w.spacePressure > 3) { convertObsolete(w, S, rng, rul); w.spacePressure = 0; }
  // crowded districts squat and rebuild their own derelicts
  const crowded = activeDistricts(w).filter(d => d.overcrowd > 0.08);
  if (crowded.length && rng.chance(0.5)) {
    const d = rng.pick(crowded);
    const der = w.structures.filter(x => x.district === d.id && x.removed === null && (x.status === 'abandoned' || x.status === 'ruin' || x.status === 'obsolete') && !w.plots[x.plot].sacred && !w.plots[x.plot].breached);
    if (der.length) {
      const x = rng.pick(der); const was = STRUCT[x.origType].label.toLowerCase();
      const cr2 = recentCrisis(w, 10);
      addLayer(w, x, { type: 'housing', status: 'active', by: rul.id, note: cr2 ? `Emergency housing built into the shell of the old ${was} after ${the(cr2.title)}. The old walls still set the shape of the block.` : `Squatters from overcrowded ${d.name} rebuilt the derelict ${was} as housing; its outline survives in the block plan.`, cause: cr2 ? cr2.id : null });
      addEvent(w, { type: 'convert', title: `Old ${was} becomes housing`, text: `In ${d.name}, the derelict ${was} was rebuilt as homes.`, district: d.id, severity: 1 });
    }
  }
}
const STRUCTCAT_FOR_CRISIS = { water: 'water', famine: 'food', blackout: 'energy', plague: 'health', breach: 'housing' };
function defaultNote(w, type, S) {
  const cat = STRUCT[type].cat;
  const m = { water: 'Built to meet growing water demand.', food: 'Planted to feed a growing population.', energy: 'Added as the grid approached capacity.', housing: 'Built for a growing population.', industry: 'Built to expand the habitat\'s productive capacity.', health: 'Opened to extend medical coverage.', education: 'Opened to extend schooling.', commerce: 'Grew up where trade concentrated.', culture: 'Laid out during a prosperous decade.', civic: 'Built to administer the district.' };
  return m[cat] || 'Built.';
}
function chooseDistrict(w, S, rng, type) {
  const cat = STRUCT[type].cat;
  const cands = activeDistricts(w).filter(d => freeSlot(w, d, rng));
  if (!cands.length) return null;
  return rng.weighted(cands, d => {
    const b = bd(S, d);
    if (type === 'farm') return 0.1 + districtEco(w, d) * 2 + (d.kind === 'agri' ? 1.5 : 0);
    if (cat === 'housing') return 0.1 + Math.max(0, d.pop - b.housing) / 1000 + d.pop / 20000 + (d.kind === 'agri' ? -0.5 : 0);
    if (cat === 'industry' || cat === 'energy') return 0.2 + (d.kind === 'industry' ? 2 : 0) + (d.pop < 3000 ? 0.5 : 0);
    if (cat === 'health') return 0.1 + Math.max(0, d.pop - b.health) / 5000;
    if (cat === 'education') return 0.1 + Math.max(0, d.pop - b.edu) / 5000;
    if (cat === 'commerce') return 0.1 + d.pop / 10000 + d.wealth + (d.mix || 0) * 3;
    if (cat === 'culture') return 0.2 + d.wealth + (1 - d.sentiment);
    if (cat === 'civic') return 0.2 + (b.civic ? 0 : 1) + d.pop / 20000;
    return 0.5 + d.pop / 20000;
  });
}
function placeOrDensify(w, rng, d, type, by, note, cause) {
  let s = place(w, rng, d, type, w.year, by, note, cause);
  if (s) return s;
  return null;
}
function convertObsolete(w, S, rng, rul) {
  const cands = w.structures.filter(s => s.removed === null && (s.status === 'abandoned' || s.status === 'ruin' || s.status === 'obsolete') && !w.plots[s.plot].breached && !w.plots[s.plot].sacred);
  if (!cands.length) {
    // densify: housing -> tower
    const h = w.structures.filter(s => isLive(s) && s.type === 'housing' && w.districts[s.district].pop > 6000);
    if (h.length && (w.reserve || 0) > 1.5) { const s = rng.pick(h); addLayer(w, s, { type: 'tower', note: `Rebuilt as a tower when ${w.districts[s.district].name} ran out of ground.` }); w.reserve -= 1.5; }
    return;
  }
  const s = rng.pick(cands);
  const d = w.districts[s.district];
  if (d.abandoned) return;
  const wasLabel = STRUCT[s.origType].label.toLowerCase();
  const r = rng.next();
  const to = r < 0.55 ? 'housing' : r < 0.8 ? 'market' : 'park';
  addLayer(w, s, { type: to, status: 'active', by: rul.id, note: to === 'housing' ? `The derelict ${wasLabel} was converted into housing as ${d.name} ran out of space.` : to === 'market' ? `Traders moved into the disused ${wasLabel}; the shape of the old structure still dictates the stalls.` : `The ruined ${wasLabel} was cleared and planted as a park.` });
  addEvent(w, { type: 'convert', title: `${STRUCT[s.origType].label} converted in ${d.name}`, text: `Reused as ${STRUCT[to].label.toLowerCase()}.`, district: d.id, severity: 1 });
}

// ---------------------------------------------------------------- technology
function technology(w, S, rng) {
  const academies = w.structures.filter(s => isLive(s) && s.type === 'academy').length;
  w.techPoints += 0.25 + S.eduAvg * 1.1 + Math.min(4, S.industry) * 0.06 + Math.min(academies, 6) * 0.12 + w.culture.technocratic * 0.3 + (w.program ? 1.6 : 0) + (w.trade === 'open' ? 0.2 : 0);
  if (w.program) { w.program.years--; if (w.program.years <= 0) w.program = null; }
  for (const t of TECH_TREE) {
    if (w.tech[t.id] || w.techPoints < t.cost) continue;
    w.tech[t.id] = w.year;
    const ev = addEvent(w, { type: 'tech', title: t.label, text: techText(t.id), severity: 2 });
    applyTech(w, S, rng, t.id, ev);
  }
  // gradual physical consequences of past transitions
  if (w.tech.fusion && w.year > w.tech.fusion + 3) {
    const old = w.structures.filter(s => isLive(s) && s.type === 'fission');
    if (old.length && S.energyR > 1.15 && rng.chance(0.5)) {
      const s = rng.pick(old);
      addLayer(w, s, { status: 'obsolete', note: `Shut down after the fusion transition of Year ${w.tech.fusion}. The containment shell was too costly to demolish.`, cause: w.tech.fusionEv });
    }
  }
  if (w.tech.recycling && w.year > w.tech.recycling + 15) {
    for (const l of w.lines) if (l.type === 'conduit' && l.status === 'active' && S.waterR > 1.15 && rng.chance(0.15)) { l.status = 'obsolete'; l.layers.push({ year: w.year, type: 'conduit', status: 'obsolete', note: `Decommissioned once recyclers made the trunk conduit redundant.` }); }
  }
  if (w.tech.hydroponics) {
    const farms = w.structures.filter(s => isLive(s) && s.type === 'farm' && w.plots[s.plot].soil < 0.5);
    if (farms.length && S.foodR < 1.15 && rng.chance(0.35) && (w.reserve || 0) > 1) { const s = rng.pick(farms); addLayer(w, s, { type: 'hydroponic', note: `Poor soil here was covered with hydroponic stacks in Year ${w.year}.` }); w.reserve -= 1; }
  }
  if (w.tech.biofilters) {
    for (const p of w.plots) if (p.scar === 'blight' && p.soil > 0.35 && rng.chance(0.2)) {
      p.scar = 'blight-healed';
      for (const sid of p.slots) if (sid) { const s = w.structures.find(x => x.id === sid); if (s && s.status === 'abandoned' && s.type === 'farm') addLayer(w, s, { type: 'park', status: 'active', note: `The dead field, healed by biofilters, was kept as a park rather than farmed again.` }); }
    }
  }
  // old structures gain generic obsolescence: abandoned things decay into ruins
  for (const s of w.structures) if (s.status === 'abandoned' && w.year - s.layers[s.layers.length - 1].year > 40 && rng.chance(0.05) && !w.plots[s.plot].sacred) addLayer(w, s, { status: 'ruin', note: 'Collapsed into ruin after decades of neglect.' });
}
function techText(id) {
  return { recycling: 'Water can now be recovered almost completely. Old trunk conduits will slowly fall silent.', hydroponics: 'Food no longer depends on soil. Exhausted fields begin to be covered with stacks.', hullweave: 'The hull can heal small failures on its own; breached sectors become repairable.', fusion: 'A compact fusion core replaces the fission plants — which are too radioactive to remove.', maglev: 'Transit tubes run at maglev speeds; old stations are refitted.', biofilters: 'Dead soil can be revived. Old blight scars slowly green over.', arcology: 'Housing can be stacked into arcologies; density rises sharply.' }[id];
}
function applyTech(w, S, rng, id, ev) {
  const eng = livingFactions(w).find(f => f.arch === 'engineers') || ruler(w);
  if (id === 'fusion') {
    w.tech.fusionEv = ev.id;
    const d = activeDistricts(w).sort((a, b) => (b.kind === 'industry') - (a.kind === 'industry'))[0];
    const s = place(w, rng, d, 'fusion', w.year, eng.id, `The habitat's first fusion core, lit in Year ${w.year}.`, ev.id);
  }
  if (id === 'maglev') for (const l of w.lines) if (l.type === 'tunnel' && l.status === 'active') l.layers.push({ year: w.year, type: 'tunnel', status: 'active', note: 'Refitted for maglev.', cause: ev.id });
  if (id === 'hullweave') for (const d of w.districts) if (d.abandoned && rng.chance(0.5)) resettle(w, rng, d, null, ev.id);
}

// ---------------------------------------------------------------- transit projects
function projects(w, S, rng) {
  for (const pr of w.projects) {
    if (pr.status !== 'construction') continue;
    const l = w.lines.find(x => x.id === pr.line);
    if (S.budget >= 1.6) { pr.progress += 1.2 / pr.cost; pr.starved = 0; }
    else if (S.budget >= 0.8) { pr.progress += 0.5 / pr.cost; pr.starved = 0; }
    else pr.starved++;
    l.progress = Math.min(1, pr.progress);
    if (pr.progress >= 1) {
      pr.status = 'done'; l.status = 'active';
      l.layers.push({ year: w.year, type: 'tunnel', status: 'active', note: `Opened in Year ${w.year} after ${w.year - pr.start} years of construction.` });
      const a = w.districts[l.from], b = w.districts[l.to];
      const ev = addEvent(w, { type: 'transit', title: `${a.name}–${b.name} line opens`, text: `The transit tube links the two districts. Trade quickens along it.`, district: a.id, severity: 1 });
      place(w, rng, a, 'station', w.year, l.by, `Terminus of the ${a.name}–${b.name} line.`, ev.id); place(w, rng, b, 'station', w.year, l.by, `Terminus of the ${a.name}–${b.name} line.`, ev.id);
      a.wealth += 0.05; b.wealth += 0.05;
    } else if (pr.starved >= 4) {
      pr.status = 'abandoned'; l.status = 'abandoned';
      const a = w.districts[l.from], b = w.districts[l.to];
      l.layers.push({ year: w.year, type: 'tunnel', status: 'abandoned', note: `Construction abandoned at ${Math.round(pr.progress * 100)}% when industrial output collapsed. The empty bore was left in the hull.` });
      addEvent(w, { type: 'transit', title: `${a.name}–${b.name} tunnel abandoned`, text: 'Funding ran out. The half-finished bore remains beneath the districts.', district: a.id, severity: 2 });
      grieve(w, livingFactions(w).find(f => f.arch === 'engineers'), `The ${a.name} tunnel was starved of funds and abandoned.`);
    }
  }
  const active = w.projects.some(p => p.status === 'construction');
  const built = w.lines.filter(l => l.type === 'tunnel' && (l.status === 'active' || l.progress < 1 && l.status !== 'abandoned')).length;
  if (!active && S.pop > 55000 && S.budget > 2.2 && built < Math.floor(activeDistricts(w).length / 2) && rng.chance(0.12)) {
    const ds = activeDistricts(w).sort((a, b) => b.pop - a.pop);
    const pairs = [];
    for (let i = 0; i < Math.min(5, ds.length); i++) for (let j = i + 1; j < Math.min(6, ds.length); j++) if (!w.lines.some(l => l.type === 'tunnel' && ((l.from === ds[i].id && l.to === ds[j].id) || (l.from === ds[j].id && l.to === ds[i].id)))) pairs.push([ds[i], ds[j]]);
    if (pairs.length) {
      const [a, b] = rng.pick(pairs);
      const eng = livingFactions(w).find(f => f.arch === 'engineers') || ruler(w);
      const l = addLine(w, a, b, 'tunnel', w.year, eng.id, `Bored to connect ${a.name} and ${b.name}, begun in Year ${w.year}.`);
      l.status = 'construction'; l.progress = 0;
      w.projects.push({ id: nextId(w), line: l.id, start: w.year, cost: rng.range(8, 16), progress: 0, starved: 0, status: 'construction' });
      addEvent(w, { type: 'transit', title: `Tunnel begun: ${a.name}–${b.name}`, text: `${eng.name} begins boring a transit tube.`, district: a.id, faction: eng.id, severity: 1 });
    }
  }
  // abandoned tunnels get reused by informal markets when a neighbouring district is crowded
  for (const l of w.lines) if (l.type === 'tunnel' && l.status === 'abandoned' && w.year - l.layers[l.layers.length - 1].year > 12 && rng.chance(0.04)) {
    const d = w.districts[l.from];
    if (d.abandoned) continue;
    l.status = 'converted';
    l.layers.push({ year: w.year, type: 'tunnel', status: 'converted', note: `Traders and squatters moved into the abandoned bore; it is now an underground market.` });
    addEvent(w, { type: 'convert', title: `Tunnel market in ${d.name}`, text: 'The abandoned transit bore has become a covered market.', district: d.id, severity: 1 });
    d.wealth += 0.03;
  }
}

// ---------------------------------------------------------------- migration waves
function migrationWaves(w, S, rng) {
  const p = 0.012 + 0.03 * w.culture.openness + (w.trade === 'open' ? 0.02 : w.trade === 'closed' ? -0.01 : 0);
  if (w.pendingWave || !rng.chance(p) || w.year < 15) return;
  const origin = originName(rng);
  const size = Math.round(S.pop * rng.float(0.04, 0.12));
  const wave = { origin, size, year: w.year };
  const rul = ruler(w);
  // player may be asked; otherwise ruler decides by openness
  if (w.year - w.lastIntervention >= 20 && !w.pending) { w.pendingWave = wave; return; }
  if (rul && rul.ideology.openness > 0.45) admitWave(w, rng, wave, `${rul.name} admitted them.`); else refuseWave(w, rng, wave, `${rul.name} turned the ships away.`);
}
export function admitWave(w, rng, wave, how) {
  const S = w.stats;
  const ev = addEvent(w, { type: 'migration', title: `Arrivals from ${wave.origin}`, text: `${formatNum(wave.size)} migrants arrive from ${wave.origin}. ${how}`, severity: 2 });
  const abandoned = w.districts.find(d => d.abandoned && d.damage < 1.01 && w.tech.hullweave);
  if (abandoned) { resettle(w, rng, abandoned, wave, ev.id); return ev; }
  const roomy = activeDistricts(w).filter(d => bd(S, d).housing - d.pop > wave.size * 0.8);
  if (roomy.length && rng.chance(0.5)) {
    const d = rng.pick(roomy); d.pop += wave.size; d.mix = (d.mix || 0) + wave.size / d.pop;
    d.history.push({ year: w.year, text: `Absorbed ${formatNum(wave.size)} arrivals from ${wave.origin}.` });
    return ev;
  }
  // carve a new quarter from the least dense district's periphery
  if (w.districts.length >= 16) { const d = activeDistricts(w).sort((a, b) => b.plots.length - a.plots.length)[0]; d.pop += wave.size; d.mix = (d.mix || 0) + wave.size / d.pop; d.history.push({ year: w.year, text: `Absorbed ${formatNum(wave.size)} arrivals from ${wave.origin}.` }); return ev; }
  const donor = activeDistricts(w).filter(d => d.plots.length >= 5).sort((a, b) => a.pop / a.plots.length - b.pop / b.plots.length)[0];
  if (!donor) return ev;
  const border = borderPlots(w, donor); if (!border.length) return ev;
  const start = rng.pick(border); const taken = new Set([start.id]); const q = [start];
  const want = rng.range(2, 4);
  while (q.length && taken.size < want) { const p = q.shift(); for (const n of neighbors(w, p)) if (n.district === donor.id && !taken.has(n.id) && taken.size < want) { taken.add(n.id); q.push(n); } }
  const culture = (w.cultureCount = (w.cultureCount || 0) + 1);
  const nd = newDistrict(w, rng, migrantDistrictName(rng, wave.origin), 'residential', [...taken], culture, `Founded by ${formatNum(wave.size)} arrivals from ${wave.origin} on land ceded by ${donor.name}.`);
  nd.origin = wave.origin; nd.pop = wave.size; nd.ctrl = donor.ctrl; nd.infl = { ...donor.infl };
  const mig = livingFactions(w).find(f => f.arch === 'migrant');
  const by = mig ? mig.id : ruler(w).id;
  for (let i = 0; i < 3; i++) place(w, rng, nd, 'housing', w.year, by, `Built to house arrivals from ${wave.origin}.`, ev.id);
  place(w, rng, nd, 'market', w.year + 3, by, `Market of the ${wave.origin} community.`, ev.id);
  addEvent(w, { type: 'border', title: `${nd.name} founded`, text: `A new cultural district on land ceded by ${donor.name}.`, district: nd.id, severity: 1, cause: ev.id });
  return ev;
}
export function refuseWave(w, rng, wave, how) {
  const ev = addEvent(w, { type: 'migration', title: `Ships from ${wave.origin} refused`, text: `${formatNum(wave.size)} would-be settlers from ${wave.origin} were denied docking. ${how}`, severity: 2 });
  w.culture.openness = clamp(w.culture.openness - 0.05, 0, 1);
  grieve(w, livingFactions(w).find(f => f.arch === 'guild'), `The ${wave.origin} ships were turned away with their cargo.`);
  const mig = livingFactions(w).find(f => f.arch === 'migrant'); grieve(w, mig, `Our kin from ${wave.origin} were refused.`);
  return ev;
}
function resettle(w, rng, d, wave, cause) {
  d.abandoned = false; d.damage = 0; d.damageSince = 0;
  for (const id of d.plots) { const p = w.plots[id]; if (p.breached) { p.breached = false; p.hull = 0.85; p.hull0 = 0.9; } }
  const who = wave ? `arrivals from ${wave.origin}` : 'settlers from the crowded core';
  if (wave) { d.pop = wave.size; d.culture = (w.cultureCount = (w.cultureCount || 0) + 1); renameDistrict(w, rng, d, migrantDistrictName(rng, wave.origin), `Resettled by ${who}.`); }
  else { d.pop = 1500; }
  d.ctrl = ruler(w).id;
  addEvent(w, { type: 'resettle', title: `${d.name} resettled`, text: `The sealed sector was reopened by ${who}, who built among the ruins.`, district: d.id, severity: 2, cause });
  for (const s of w.structures) if (s.district === d.id && (s.status === 'abandoned' || s.status === 'ruin')) {
    if (rng.chance(0.5)) addLayer(w, s, { type: 'housing', status: 'active', note: `Rebuilt as housing by ${who} when the sector was reopened.`, cause });
  }
}

// ---------------------------------------------------------------- religion & new factions
function religion(w, S, rng) {
  const faith = livingFactions(w).find(f => f.arch === 'faith');
  const trauma = traumaLevel(w);
  const meanEdu = S.eduAvg; const meanSent = S.pop ? w.districts.reduce((a, d) => a + d.sentiment * d.pop, 0) / S.pop : 0.5;
  if (!faith && w.year > 20 && trauma > 0.45 && meanEdu < 0.62 && rng.chance(0.06 + 0.1 * w.culture.piety)) {
    const ev0 = w.events.slice().reverse().find(e => e.severity >= 3);
    const home = ev0 && ev0.district >= 0 ? ev0.district : rng.pick(activeDistricts(w)).id;
    const f = addFaction(w, rng, 'faith', w.year, `Arose among survivors of ${ev0 ? the(ev0.title) : 'the dark years'} in ${w.districts[home].name}.`, { home, purpose: ev0 ? ev0.id : null });
    w.districts[home].infl[f.id] = 0.35;
    const ev = addEvent(w, { type: 'faction', title: `${f.name} founded`, text: f.origin, district: home, faction: f.id, severity: 2 });
    if (w.year - w.lastIntervention >= 12 && !w.pending) w.pendingRecognition = { faction: f.id, event: ev.id };
  }
  if (faith && faith.power > 0.12 && rng.chance(0.09)) {
    // consecrate an obsolete or ruined structure
    const cands = w.structures.filter(s => s.removed === null && (s.status === 'obsolete' || s.status === 'abandoned' || s.status === 'ruin') && !w.plots[s.plot].sacred && !w.districts[s.district].abandoned);
    if (cands.length) {
      const s = rng.weighted(cands, x => 1 + 2 * (w.districts[x.district].infl[faith.id] || 0));
      const p = w.plots[s.plot]; p.sacred = true;
      const was = STRUCT[s.origType].label.toLowerCase();
      const purpose = faith.purpose ? w.events.find(e => e.id === faith.purpose) : null;
      addLayer(w, s, { type: 'temple', status: 'sacred', by: faith.id, note: `The dead ${was} was consecrated by the ${faith.name}${purpose ? ` in memory of ${the(purpose.title)}` : ''}.`, cause: faith.purpose });
      addEvent(w, { type: 'sacred', title: `${STRUCT[s.origType].label} consecrated`, text: `In ${w.districts[s.district].name}, the ${faith.name} made a shrine of the old ${was}.`, district: s.district, faction: faith.id, severity: 1 });
    } else if (rng.chance(0.3)) {
      const d = rng.weighted(activeDistricts(w), x => 0.1 + (x.infl[faith.id] || 0));
      place(w, rng, d, 'temple', w.year, faith.id, `Built by the ${faith.name}.`);
    }
  }
  // rationing council
  if (w.rationing && w.year - w.rationingSince >= 3 && !w.factions.some(f => f.arch === 'rationing' && !f.dissolved)) {
    const f = addFaction(w, rng, 'rationing', w.year, `Created to administer rationing during ${the((recentCrisis(w, 10) || { title: 'the shortage' }).title)}.`);
    const d = activeDistricts(w).sort((a, b) => b.pop - a.pop)[0];
    d.infl[f.id] = 0.3;
    place(w, rng, d, 'civic', w.year, f.id, `Headquarters of the ${f.name}, set up to administer rationing.`);
    addEvent(w, { type: 'faction', title: `${f.name} established`, text: f.origin, district: d.id, faction: f.id, severity: 2 });
  }
  // separatists
  if (w.year > 25 && !w.factions.some(f => f.arch === 'separatist' && (!f.dissolved || w.year - f.dissolved < 70))) {
    for (const d of activeDistricts(w)) {
      d.neglect = (S.avgW - d.wealth > 0.12 || d.damage > 0) ? (d.neglect || 0) + 1 : 0;
      if (d.neglect > 15 && rng.chance(0.1) && !w.factions.some(f => f.arch === 'separatist' && f.home === d.id)) {
        const f = addFaction(w, rng, 'separatist', w.year, `Formed in ${d.name} after years of neglect by the central administration.`, { home: d.id });
        d.infl[f.id] = 0.4;
        const ev = addEvent(w, { type: 'faction', title: `${f.name} formed in ${d.name}`, text: f.origin, district: d.id, faction: f.id, severity: 2 });
        if (w.year - w.lastIntervention >= 12 && !w.pending) w.pendingRecognition = { faction: f.id, event: ev.id };
        break;
      }
    }
  }
  // migrant association
  if (!w.factions.some(f => f.arch === 'migrant' && !f.dissolved)) {
    const mig = w.districts.filter(d => d.culture > 0 && !d.abandoned);
    const share = mig.reduce((a, d) => a + d.pop, 0) / Math.max(1, S.pop);
    if (mig.length && share > 0.12 && rng.chance(0.1)) {
      const home = mig.sort((a, b) => b.pop - a.pop)[0];
      const f = addFaction(w, rng, 'migrant', w.year, `Founded by the ${home.origin || 'newcomer'} communities of ${home.name}.`, { home: home.id });
      for (const d of mig) d.infl[f.id] = 0.35;
      const ev = addEvent(w, { type: 'faction', title: `${f.name} founded`, text: f.origin, district: home.id, faction: f.id, severity: 2 });
      if (w.year - w.lastIntervention >= 12 && !w.pending) w.pendingRecognition = { faction: f.id, event: ev.id };
    }
  }
}
function factionLifecycle(w, S, rng) {
  for (const f of livingFactions(w)) {
    if (f.power < 0.04 && f.institutions === 0) f.weak = (f.weak || 0) + 1; else f.weak = 0;
    if (f.weak > 12 && w.factions.filter(x => !x.dissolved).length > 2) {
      f.dissolved = w.year;
      addEvent(w, { type: 'faction', title: `${f.name} dissolves`, text: f.arch === 'rationing' ? 'With no shortage left to administer and no offices to defend, the board quietly ceased to exist.' : 'Its constituency had drifted away.', faction: f.id, severity: 1 });
      for (const d of w.districts) delete d.infl[f.id];
    }
    if (f.arch === 'rationing' && !w.rationing && f.institutions > 0 && !f.notedSurvival && w.year - f.founded > 20) { f.notedSurvival = true; f.origin += ` Rationing ended in Year ${w.year - 1}, but the board kept its offices and its powers.`; }
  }
}

// ---------------------------------------------------------------- cohorts
function cohorts(w, rng) {
  if (w.year % COHORT_SPAN === 0) w.cohorts.push({ id: w.nextCohort, name: cohortName(rng, w.nextCohort++, w.year), born: w.year, share: 0, memories: {} });
  let sum = 0;
  for (const c of w.cohorts) { const age = w.year - c.born; c.raw = age < 0 ? 0 : age < 20 ? 0.6 + age / 50 : age < 65 ? 1 : Math.max(0, 1 - (age - 65) / 30); sum += c.raw; }
  for (const c of w.cohorts) c.share = sum ? c.raw / sum : 0;
  w.cohorts = w.cohorts.filter(c => w.year - c.born < 100);
}

// ---------------------------------------------------------------- interventions
function maybeIntervention(w, S, rng) {
  if (w.pending) return;
  const gap = w.year - w.lastIntervention;
  let iv = null;
  const cr = recentCrisis(w, 1);
  if (w.pendingWave) { const wv = w.pendingWave; iv = { kind: 'migration', title: `Ships from ${wv.origin}`, text: `${formatNum(wv.size)} people from ${wv.origin} request docking. Housing stands at ${Math.round(S.housingR * 100)}% of need.`, data: wv, options: [{ id: 'admit', label: 'Admit them', desc: 'A new community — and pressure on housing and water.' }, { id: 'refuse', label: 'Turn them away', desc: 'The habitat grows more insular; traders and newcomers remember.' }] }; }
  else if (w.pendingRecognition) { const f = w.factions[w.pendingRecognition.faction]; iv = { kind: 'recognition', title: `${f.name} demands recognition`, text: `${f.origin} They ask for a seat in the habitat's institutions.`, data: w.pendingRecognition, options: [{ id: 'recognize', label: 'Recognize them', desc: 'They gain an assembly house and legitimacy; rivals resent it.' }, { id: 'suppress', label: 'Suppress them', desc: 'Garrisons in their home district; a grievance that will last generations.' }, { id: 'ignore', label: 'Ignore them', desc: 'Let the matter resolve itself.' }] }; }
  else if (gap < 8) return;
  else if (cr && cr.crisis === 'water' && !cr.answered) { cr.answered = true; iv = { kind: 'water', title: cr.title, text: cr.text, data: { event: cr.id }, options: [{ id: 'ration', label: 'Impose rationing', desc: 'Everyone gets less. Resentment grows in the poorer wards, and a board is needed to run it.' }, { id: 'program', label: 'Emergency water programme', desc: 'Divert industry into recyclers and reservoirs for a decade.' }, { id: 'defer', label: 'Let the districts cope', desc: 'The wealthy will buy water; the poor will not.' }] }; }
  else if (cr && cr.crisis === 'famine' && !cr.answered) { cr.answered = true; iv = { kind: 'famine', title: cr.title, text: cr.text, data: { event: cr.id }, options: [{ id: 'rooftops', label: 'Rooftop farming decree', desc: 'Every roof becomes a field. Cheap, ugly, and permanent.' }, { id: 'trade', label: 'Open external trade', desc: 'Food arrives by ship, along with merchants, migrants and sickness.' }, { id: 'ration', label: 'Ration food', desc: 'Fewer die; everyone is angrier.' }] }; }
  else if (cr && cr.crisis === 'breach' && !cr.answered) { cr.answered = true; const d = w.districts[cr.district]; iv = { kind: 'breach', title: cr.title, text: `${cr.text} Repairs would consume the habitat's industry for years.`, data: { event: cr.id, district: d.id }, options: [{ id: 'repair', label: 'Fund the repair', desc: 'Ten lean years of construction; the district survives, scarred.' }, { id: 'abandon', label: 'Seal the district', desc: 'Its people scatter to the other wards; the ruins stay.' }, { id: 'defer', label: 'Wait and see', desc: 'Maybe the engineers manage on their own.' }] }; }
  else if (S.ineq > 0.16 && w.districts.some(d => d.sentiment < 0.4) && !(w.lastIneq > w.year - 40)) { w.lastIneq = w.year; iv = { kind: 'inequality', title: 'The two habitats', text: `Wealth spread: ${Math.round(S.ineq * 100)}. The rich wards drink while the outer ring queues at standpipes.`, options: [{ id: 'redistribute', label: 'Redistribute supplies', desc: 'Level the districts. The guilds and the wealthy wards will not forget.' }, { id: 'defer', label: 'Leave it to the market', desc: 'Unrest will find its own outlet.' }] }; }
  else if ((w.spacePressureTotal = (w.spacePressureTotal || 0) + (w.spacePressure || 0)) > 6 && !(w.lastExpansion > w.year - 50)) { w.lastExpansion = w.year; w.spacePressureTotal = 0; iv = { kind: 'expansion', title: 'The habitat is full', text: 'There is no empty ground left. Something must give way when the next thing is built.', options: [{ id: 'housing', label: 'Prioritize housing', desc: 'Towers replace blocks; farms are squeezed.' }, { id: 'agri', label: 'Prioritize agriculture', desc: 'Food security first; the crowding worsens.' }, { id: 'industry', label: 'Prioritize industry', desc: 'Faster building and technology; more pollution and hull stress.' }] }; }
  else if (!w.program && S.budget > 3 && w.techPoints > 20 && !(w.lastProgram > w.year - 45)) { const next = TECH_TREE.find(t => !w.tech[t.id]); if (next) { w.lastProgram = w.year; iv = { kind: 'program', title: `Fund ${next.label.toLowerCase()}?`, text: `${(livingFactions(w).find(f => f.arch === 'engineers') || ruler(w)).name} proposes a fifteen-year research programme.`, data: { tech: next.id }, options: [{ id: 'fund', label: 'Fund the programme', desc: 'Industry is diverted for fifteen years; the transition comes sooner.' }, { id: 'decline', label: 'Decline', desc: 'Spend the output on today\'s needs.' }] }; } }
  else if (w.trade !== 'open' && livingFactions(w).some(f => f.arch === 'guild' && f.power > 0.2) && !(w.lastTrade > w.year - 40)) { w.lastTrade = w.year; iv = { kind: 'trade', title: 'Open the docks?', text: 'The merchant houses want the habitat opened to external trade.', options: [{ id: 'open', label: 'Open trade', desc: 'Imports, wealth and arrivals — and dependence on the outside.' }, { id: 'close', label: 'Seal the docks', desc: 'Self-reliance; the guild remembers.' }] }; }
  else if (w.trade === 'open' && (w.crisisState.plague && w.crisisState.plague.years > 0 || S.foodR > 1.3) && !(w.lastTrade > w.year - 40) && rng.chance(0.3)) { w.lastTrade = w.year; iv = { kind: 'trade', title: 'Close the docks?', text: 'Voices call for sealing the habitat against the outside.', options: [{ id: 'close', label: 'Close trade', desc: 'Isolation; merchants lose everything.' }, { id: 'open', label: 'Keep the docks open', desc: 'Business as usual.' }] }; }
  if (!iv) return;
  iv.id = nextId(w); iv.year = w.year;
  w.pending = iv;
}

export function applyDecision(w, optionId) {
  const iv = w.pending; if (!iv) return;
  const rng = new RNG(w.rngState);
  w.pending = null; w.lastIntervention = w.year;
  w.decisions.push({ year: w.year, kind: iv.kind, option: optionId });
  const opt = iv.options.find(o => o.id === optionId) || iv.options[iv.options.length - 1];
  const rul = ruler(w);
  const mark = (title, text, extra = {}) => addEvent(w, Object.assign({ type: 'decision', title, text: `Steward's decision: ${text}`, severity: 2 }, extra));
  const K = iv.kind, o = opt.id;
  if (K === 'migration') { const wv = iv.data; w.pendingWave = null; if (o === 'admit') admitWave(w, rng, wv, 'The Steward opened the docks.'); else refuseWave(w, rng, wv, 'The Steward refused them.'); }
  else if (K === 'recognition') {
    const f = w.factions[iv.data.faction]; w.pendingRecognition = null; const home = w.districts[f.home >= 0 ? f.home : 0];
    if (o === 'recognize') { const s = place(w, rng, home, 'assembly', w.year, f.id, `Granted to the ${f.name} when the Steward recognized them.`, iv.data.event); for (const d of w.districts) d.infl[f.id] = (d.infl[f.id] || 0.05) + 0.1; mark(`${f.name} recognized`, `${f.name} was granted a seat in the institutions${s ? ` and an assembly house in ${home.name}` : ''}.`, { faction: f.id, district: home.id }); for (const g of livingFactions(w)) if (g !== f && ideoDist(g, f) > 0.6) grieve(w, g, `The Steward legitimised the ${f.name}.`, f.id); }
    else if (o === 'suppress') { place(w, rng, home, 'garrison', w.year, rul.id, `Built to keep watch on the ${f.name}.`, iv.data.event); for (const d of w.districts) d.infl[f.id] = (d.infl[f.id] || 0.05) * 0.5; home.infl[f.id] += 0.15; home.sentiment -= 0.15; grieve(w, f, `Suppressed by the Steward's garrisons.`, rul.id); mark(`${f.name} suppressed`, `Garrisons were sent to ${home.name}.`, { faction: f.id, district: home.id }); }
    else mark(`${f.name} ignored`, 'The petition went unanswered.', { faction: f.id });
  }
  else if (K === 'water') {
    if (o === 'ration') { w.rationing = true; w.rationingSince = w.year; mark('Water rationing imposed', 'Every ward receives a fixed allocation.'); }
    else if (o === 'program') { w.program = { years: 10, kind: 'water' }; w.reserve = (w.reserve || 0) + 6; const d = activeDistricts(w).sort((a, b) => a.supply.water - b.supply.water)[0]; place(w, rng, d, w.tech.recycling ? 'recycler' : 'reservoir', w.year, sponsor(w, 'reservoir'), `Emergency works ordered by the Steward during ${the(iv.title)}.`, iv.data.event); place(w, rng, d, 'waterplant', w.year + 1, sponsor(w, 'waterplant'), `Emergency works ordered by the Steward during ${the(iv.title)}.`, iv.data.event); mark('Emergency water programme', 'Industry diverted into water works for a decade.', { district: d.id }); }
    else mark('No action on water', 'The districts were left to cope.');
  }
  else if (K === 'famine') {
    if (o === 'rooftops') { let n = 0; for (const s of w.structures) if (isLive(s) && STRUCT[s.type].cat === 'housing' && !s.addon && n++ < 40) addLayer(w, s, { addon: 'rooftop', note: `Rooftop farm planted under the Steward's decree during ${the(iv.title)}.`, cause: iv.data.event }); mark('Rooftop farming decree', 'Every flat roof was ordered planted.'); }
    else if (o === 'trade') { w.trade = 'open'; w.culture.openness = clamp(w.culture.openness + 0.1, 0, 1); mark('Docks opened for food', 'External trade opened to import food.'); }
    else { w.rationing = true; w.rationingSince = w.year; mark('Food rationing imposed', 'Fixed rations for every ward.'); }
  }
  else if (K === 'breach') {
    const d = w.districts[iv.data.district];
    if (o === 'repair') { w.program = { years: 10, kind: 'repair' }; repairDistrict(w, rng, d, rul); w.reserve = 0; mark('Repair funded', `The breach beneath ${d.name} was sealed at great cost.`, { district: d.id }); }
    else if (o === 'abandon') { abandonDistrict(w, rng, d, 'The Steward ordered the sector sealed.'); mark(`${d.name} sealed`, 'The district was written off.', { district: d.id }); }
    else mark('Breach left to the engineers', 'No central funds were committed.');
  }
  else if (K === 'inequality') {
    if (o === 'redistribute') { const avg = w.stats.avgW; for (const d of w.districts) { d.wealth = d.wealth * 0.5 + avg * 0.5; if (d.wealth < avg) d.sentiment += 0.1; else d.sentiment -= 0.08; } grieve(w, livingFactions(w).find(f => f.arch === 'guild'), 'The Steward confiscated the wealth of the trading wards.'); w.culture.communal = clamp(w.culture.communal + 0.08, 0, 1); mark('Redistribution decree', 'Supplies and wealth were levelled between wards.'); }
    else mark('Inequality tolerated', 'Nothing was done.');
  }
  else if (K === 'expansion') { w.priority = o; mark(`Expansion priority: ${o}`, `Future construction favours ${o}.`); }
  else if (K === 'program') { if (o === 'fund') { w.program = { years: 15, kind: iv.data.tech }; mark('Research programme funded', `Fifteen years of industry committed to ${TECH_TREE.find(t => t.id === iv.data.tech).label.toLowerCase()}.`); } else mark('Research declined', 'The proposal was shelved.'); }
  else if (K === 'trade') { if (o === 'open') { w.trade = 'open'; w.culture.openness = clamp(w.culture.openness + 0.1, 0, 1); mark('Docks opened', 'External trade opened.'); } else { w.trade = 'closed'; w.culture.openness = clamp(w.culture.openness - 0.1, 0, 1); grieve(w, livingFactions(w).find(f => f.arch === 'guild'), 'The Steward sealed the docks.'); mark('Docks sealed', 'External trade closed.'); } }
  w.rngState = rng.getState();
}

const EMPTY_B = { housing: 0, food: 0, water: 0, health: 0, edu: 0, commerce: 0, culture: 0, industry: 0, civic: 0 };
function bd(S, d) { return (S.byD && S.byD[d.id]) || EMPTY_B; }


// ---------------------------------------------------------------- aging infrastructure
function aging(w, S, rng) {
  const scarce = S.budget < S.pop / 40000 + 1;
  const indNear = new Float32Array(w.plots.length);
  for (const s of w.structures) if (isLive(s) && STRUCT[s.type].cat === 'industry') { indNear[s.plot] += 1; for (const n of neighbors(w, w.plots[s.plot])) indNear[n.id] += 0.5; }
  let failures = 0;
  for (const s of w.structures) {
    if (!isLive(s) || s.status === 'damaged') continue;
    const cat = STRUCT[s.type].cat;
    if (cat !== 'water' && cat !== 'energy' && cat !== 'industry' && cat !== 'housing' && cat !== 'transit') continue;
    const age = w.year - s.layers[s.layers.length - 1].year;
    if (age < 45) continue;
    const p = 0.003 * (age - 45) / 40 * (scarce ? 2.2 : 1) * (w.tech.hullweave ? 0.7 : 1);
    if (failures < 3 && rng.chance(p)) {
      failures++;
      addLayer(w, s, { status: 'damaged', note: `Failed in Year ${w.year} after ${age} years of service${scarce ? '; there was no money for maintenance' : ''}.` });
      if (cat === 'water' || cat === 'energy') addEvent(w, { type: 'failure', title: `${STRUCT[s.type].label} fails in ${w.districts[s.district].name}`, text: `${age} years old and ${scarce ? 'unmaintained' : 'worn out'}.`, district: s.district, severity: 1 });
    }
    // contamination of water infrastructure by neighbouring industry
    if (cat === 'water' && indNear[s.plot] >= 1 && rng.chance(0.005 * indNear[s.plot] * (s.addon === 'enclosed' ? 0.15 : 1))) {
      const d = w.districts[s.district];
      const ev = addEvent(w, { type: 'crisis', crisis: 'contamination', title: `${d.name} contamination`, text: `Industrial runoff poisoned the ${STRUCT[s.type].label.toLowerCase()} in ${d.name}. Sickness followed; the works were sealed off.`, district: d.id, severity: 2 });
      addLayer(w, s, { status: 'damaged', note: s.addon === 'enclosed' ? `Contaminated again in Year ${w.year} despite the containment shell.` : `Contaminated by industrial runoff in Year ${w.year}; enclosed behind a containment shell.`, cause: ev.id, addon: 'enclosed' });
      d.health = Math.max(0.1, d.health - 0.2); d.pop = Math.round(d.pop * 0.985);
      grieve(w, w.factions[d.ctrl], `The water of ${d.name} was poisoned while the factories kept running.`);
    }
  }
  for (const l of w.lines) if (l.type === 'conduit' && l.status === 'active' && rng.chance(0.004)) {
    const a = w.districts[l.from];
    const ev = addEvent(w, { type: 'crisis', crisis: 'contamination', title: `${a.name} conduit contamination`, text: `The trunk conduit from ${a.name} was found contaminated. It was enclosed in a sealed casing rather than replaced.`, district: a.id, severity: 2 });
    l.layers.push({ year: w.year, type: 'conduit', status: 'active', note: 'Enclosed after contamination.', cause: ev.id, enclosed: true }); l.enclosed = true;
    a.health = Math.max(0.1, a.health - 0.15);
  }
  // repairs come first in the budget
  const damaged = w.structures.filter(s => s.removed === null && s.status === 'damaged');
  let fund = S.budget * 0.35 + (w.reserve || 0);
  let n = 0;
  for (const s of damaged) {
    const cost = 0.6 * (1 + S.pop / 250000);
    if (fund < cost || n >= 3) break;
    if (w.plots[s.plot].breached) continue;
    if (w.year - s.layers[s.layers.length - 1].year < 2) continue;
    fund -= cost; n++;
    addLayer(w, s, { status: 'active', note: s.addon === 'enclosed' ? `Rebuilt inside its containment shell in Year ${w.year}.` : `Repaired in Year ${w.year}.` });
  }
  w.reserve = Math.max(0, (w.reserve || 0) - (S.budget * 0.35 + (w.reserve || 0) - fund));
}

function the(title) { return /^The /.test(title) ? title.replace(/^The /, 'the ') : 'the ' + title; }
