// HTML builders for the bottom sheet. Pure functions of (app state) -> html string,
// plus a tiny delegated click protocol: elements with data-act / data-id.
import { STRUCT, CULTURE_COLORS } from '../sim/defs.js';
import { structAt, TECH_TREE } from '../sim/sim.js';
import { fmt } from '../render/renderer.js';

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAT_LABEL = { housing: 'Housing', food: 'Food', water: 'Water', energy: 'Energy', industry: 'Industry', commerce: 'Commerce', civic: 'Civic', education: 'Education', health: 'Health', culture: 'Culture & memory', transit: 'Transit', military: 'Fortification', ruin: 'Ruins & scars' };
const STATUS_LABEL = { active: '', damaged: 'damaged', abandoned: 'abandoned', ruin: 'ruin', obsolete: 'obsolete', sacred: 'sacred', fortified: 'fortified', construction: 'under construction', converted: 'repurposed' };

function closeBtn() { return `<button class="close" data-act="close" aria-label="Close">✕</button>`; }
function factionChip(w, id) { const f = w.factions[id]; if (!f) return '<span class="tag">no administration</span>'; return `<span class="link" data-act="faction" data-id="${f.id}"><span class="dot" style="background:${f.color}"></span>${esc(f.name)}</span>`; }
function districtLink(w, id, snap) { const d = w.districts[id]; if (!d) return ''; const nm = snap && snap.d[id] ? snap.d[id].name : d.name; return `<span class="link" data-act="district" data-id="${id}">${esc(nm)}</span>`; }
function eventLink(w, id) { const e = w.events.find(x => x.id === id); if (!e) return ''; return `<span class="link" data-act="event" data-id="${e.id}">${esc(e.title)} (Year ${e.year})</span>`; }
function bar(label, v, cls = '', fmtv = null) { const pct = Math.max(0, Math.min(100, Math.round(v * 100))); return `<div>${label}</div><div class="bar ${cls}"><i style="width:${pct}%"></i></div><div class="num">${fmtv !== null ? fmtv : pct + '%'}</div>`; }
function ratioBar(label, r) { const cls = r < 0.9 ? 'warn' : r >= 1 ? 'ok' : ''; return bar(label, Math.min(1, r / 1.3), cls, Math.round(r * 100) + '%'); }

// ---------------------------------------------------------------- memory
export function memoryLines(w, ev, year) {
  const out = [];
  const cohorts = w.cohorts.filter(c => c.born <= year && year - c.born < 100);
  const remnants = w.structures.filter(s => s.layers.some(l => l.cause === ev.id && l.year <= year));
  const reinterpreted = remnants.find(s => { const L = structAt(s, year); const first = s.layers.find(l => l.cause === ev.id); return first && L.type !== first.type; });
  for (const c of cohorts) {
    const age = year - c.born;
    const rel = c.born - ev.year;
    let text;
    if (rel <= -5) { const m = c.memories[ev.id]; text = m > 0.6 ? `lived through it; it defines them` : m > 0 ? `remember it first-hand` : `were adults when it happened`; }
    else if (rel <= 40) text = `grew up hearing stories about it`;
    else if (rel <= 90) text = `consider it ancient history`;
    else text = `know it only as a name`;
    if (rel > 40 && reinterpreted) text += `; to them, the ${STRUCT[structAt(reinterpreted, year).type].label.toLowerCase()} it left behind has always been just that`;
    out.push(`<div class="memory"><b>${esc(c.name)}</b> <span class="sub">(born Y${c.born}, age ${age}, ${Math.round(c.share * 100)}% of people)</span><br>${text}.</div>`);
  }
  return out.join('');
}

// ---------------------------------------------------------------- structure
export function structurePanel(app, s) {
  const w = app.world, year = app.viewYear, snap = app.snap;
  const L = structAt(s, year);
  const plot = w.plots[s.plot];
  const did = snap.owners[s.plot] - 1;
  const cat = STRUCT[L.type].cat;
  const layers = s.layers.filter(l => l.year <= year);
  const items = [];
  layers.forEach((l, i) => {
    const prev = layers[i - 1];
    let head = '';
    if (i === 0) head = `${STRUCT[l.type].label} built`;
    else if (prev.type !== l.type) head = `Converted from ${STRUCT[prev.type].label.toLowerCase()} to ${STRUCT[l.type].label.toLowerCase()}`;
    else if (prev.status !== l.status) head = { damaged: 'Damaged', abandoned: 'Abandoned', ruin: 'Fell into ruin', obsolete: 'Made obsolete', sacred: 'Consecrated', fortified: 'Fortified', active: 'Restored', demolished: 'Demolished' }[l.status] || l.status;
    else if (l.addon && !(prev.addon)) head = l.addon === 'rooftop' ? 'Rooftop farm added' : 'Enclosed';
    else head = 'Changed';
    const by = l.by !== undefined ? l.by : (i === 0 ? s.by : undefined);
    items.push(`<li><span class="yr">Year ${l.year}</span><b>${esc(head)}</b>${by !== undefined && w.factions[by] ? ` <span class="sub">by ${factionChip(w, by)}</span>` : ''}<br>${esc(l.note || '')}${l.cause ? `<br><span class="sub">↳ ${eventLink(w, l.cause)}</span>` : ''}</li>`);
  });
  const cause = layers.map(l => l.cause).filter(Boolean).pop();
  const causeEv = cause ? w.events.find(e => e.id === cause) : null;
  const status = STATUS_LABEL[L.status] || L.status;
  const scars = [plot.scar && snap.flags[s.plot] & (4 | 8 | 16 | 32) ? `<span class="tag warn">${plot.scar === 'breach' ? 'hull breach scar' : plot.scar === 'barricade' ? 'old barricade line' : 'blighted ground'}</span>` : '', snap.flags[s.plot] & 2 ? '<span class="tag" style="color:#b48ce8">sacred ground</span>' : ''].join(' ');
  return `${closeBtn()}
    <h2>${esc(STRUCT[L.type].label)} ${status ? `<span class="tag ${L.status === 'damaged' || L.status === 'ruin' ? 'warn' : L.status === 'sacred' ? '' : ''}">${status}</span>` : ''}${L.addon === 'rooftop' ? '<span class="tag ok">rooftop farm</span>' : ''}${L.addon === 'enclosed' ? '<span class="tag">enclosed</span>' : ''}</h2>
    <p class="sub">${CAT_LABEL[cat]} · in ${districtLink(w, did, snap)} · age ${year - s.built} years${s.origType !== L.type ? ` · originally a ${STRUCT[s.origType].label.toLowerCase()}` : ''} ${scars}</p>
    <h3>Why it exists</h3>
    <ul class="lineage">${items.join('')}</ul>
    ${causeEv ? `<h3>How the living remember the ${esc(causeEv.title)}</h3>${memoryLines(w, causeEv, year)}` : ''}
    <div class="row"><button class="btn" data-act="district" data-id="${did}">District</button><button class="btn" data-act="plot" data-id="${s.plot}">This plot</button></div>`;
}

export function linePanel(app, l) {
  const w = app.world, year = app.viewYear, snap = app.snap;
  const layers = l.layers.filter(x => x.year <= year);
  const L = layers[layers.length - 1];
  const items = layers.map((x, i) => `<li><span class="yr">Year ${x.year}</span><b>${i === 0 ? (l.type === 'conduit' ? 'Conduit laid' : 'Tunnel begun') : (STATUS_LABEL[x.status] || x.status || 'changed')}${x.enclosed ? ' — enclosed' : ''}</b><br>${esc(x.note || '')}${x.cause ? `<br><span class="sub">↳ ${eventLink(w, x.cause)}</span>` : ''}</li>`).join('');
  return `${closeBtn()}<h2>${l.type === 'conduit' ? 'Trunk conduit' : 'Transit tunnel'} <span class="tag">${STATUS_LABEL[L.status] || L.status}</span></h2>
  <p class="sub">${districtLink(w, l.from, snap)} ↔ ${districtLink(w, l.to, snap)} · built by ${factionChip(w, l.by)}</p>
  <h3>Lineage</h3><ul class="lineage">${items}</ul>`;
}

// ---------------------------------------------------------------- plot
export function plotPanel(app, id) {
  const w = app.world, year = app.viewYear, snap = app.snap;
  const p = w.plots[id]; const did = snap.owners[id] - 1; const flags = snap.flags[id];
  const structs = w.structures.filter(s => s.plot === id && s.built <= year && (s.removed === null || s.removed > year));
  const soil = snap.soil[id] / 255;
  const items = structs.map(s => { const L = structAt(s, year); return `<li data-act="structure" data-id="${s.id}"><span class="yr">Y${s.built}</span>${esc(STRUCT[L.type].label)} ${STATUS_LABEL[L.status] ? `<span class="tag">${STATUS_LABEL[L.status]}</span>` : ''}</li>`; }).join('');
  const past = w.structures.filter(s => s.plot === id && s.removed !== null && s.removed <= year);
  return `${closeBtn()}<h2>Plot ${p.ix + 1}·${p.iy + 1}</h2>
  <p class="sub">in ${districtLink(w, did, snap)} ${flags & 1 ? '<span class="tag warn">breached — sealed</span>' : ''} ${flags & 4 && !(flags & 1) ? '<span class="tag warn">old breach, patched</span>' : ''} ${flags & 8 ? '<span class="tag warn">blighted</span>' : ''} ${flags & 32 ? '<span class="tag ok">healed blight</span>' : ''} ${flags & 2 ? '<span class="tag" style="color:#b48ce8">sacred</span>' : ''} ${flags & 16 ? '<span class="tag warn">barricade line</span>' : ''}</p>
  <div class="bars">${bar('Soil', soil, soil < 0.3 ? 'warn' : 'ok')}${bar('Hull integrity', p.hull, p.hull < 0.45 ? 'warn' : '')}</div>
  <h3>Structures (${structs.length}/4 slots)</h3><ul class="evlist">${items || '<li class="sub">Open ground.</li>'}</ul>
  ${past.length ? `<h3>Demolished here</h3><ul class="evlist">${past.map(s => `<li data-act="structure" data-id="${s.id}"><span class="yr">Y${s.built}–${s.removed}</span>${esc(STRUCT[s.origType].label)}</li>`).join('')}</ul>` : ''}
  <div class="row"><button class="btn" data-act="district" data-id="${did}">Open district</button></div>`;
}

// ---------------------------------------------------------------- district
export function districtPanel(app, id) {
  const w = app.world, year = app.viewYear, snap = app.snap;
  const d = w.districts[id]; const ds = snap.d[id]; if (!d || !ds) return `${closeBtn()}<p>No such district.</p>`;
  const plots = w.plots.filter(p => snap.owners[p.id] - 1 === id).map(p => p.id);
  const structs = w.structures.filter(s => plots.includes(s.plot) && s.built <= year && (s.removed === null || s.removed > year));
  const cats = {}; for (const s of structs) { const L = structAt(s, year); const c = STRUCT[L.type].cat; cats[c] = cats[c] || { n: 0, dead: 0 }; cats[c].n++; if (['ruin', 'abandoned', 'obsolete'].includes(L.status)) cats[c].dead++; }
  const hist = d.history.filter(h => h.year <= year);
  const names = d.names.filter(n => n.year <= year);
  const infl = Object.entries(d.infl).map(([fid, v]) => [w.factions[fid], v]).filter(([f]) => f && !(f.dissolved && f.dissolved <= year) && f.founded <= year).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const cul = ds.cul ? `<span class="tag" style="color:${CULTURE_COLORS[ds.cul % CULTURE_COLORS.length]}">${esc(d.origin || 'newcomer')} community</span>` : '<span class="tag">founder culture</span>';
  return `${closeBtn()}<h2>${esc(ds.name)} ${ds.ab ? '<span class="tag warn">abandoned</span>' : ''}</h2>
  <p class="sub">${d.kind} district · founded Year ${d.founded} · ${plots.length} plots · ${cul}</p>
  <p>Administered by ${ds.ctrl >= 0 ? factionChip(w, ds.ctrl) : '<span class="tag">nobody</span>'}</p>
  <div class="grid2"><div class="kv"><span>Population</span><b>${fmt(ds.pop)}</b></div><div class="kv"><span>Wealth</span><b>${Math.round(ds.wealth * 100)}</b></div><div class="kv"><span>Overcrowding</span><b>${Math.round(ds.oc * 100)}%</b></div><div class="kv"><span>Unrest</span><b>${Math.round(ds.unrest * 100)}</b></div></div>
  <h3>Conditions</h3>
  <div class="bars">${bar('Sentiment', ds.sent, ds.sent < 0.4 ? 'warn' : ds.sent > 0.6 ? 'ok' : '')}${bar('Health', ds.health, ds.health < 0.4 ? 'warn' : '')}${bar('Education', ds.edu)}${ratioBar('Food', ds.sup[0])}${ratioBar('Water', ds.sup[1])}${ratioBar('Energy', ds.sup[2])}${ds.dmg ? bar('Hull damage', ds.dmg, 'warn') : ''}</div>
  <h3>Political influence</h3>
  <div class="bars">${infl.map(([f, v]) => bar(`<span class="link" data-act="faction" data-id="${f.id}"><span class="dot" style="background:${f.color}"></span>${esc(f.name.split(' ').slice(0, 2).join(' '))}</span>`, v, '', Math.round(v * 100) + '%')).join('')}</div>
  <h3>Built environment (${structs.length})</h3>
  <div class="grid2">${Object.entries(cats).sort((a, b) => b[1].n - a[1].n).map(([c, v]) => `<div class="kv"><span>${CAT_LABEL[c]}</span><b>${v.n}${v.dead ? ` <span class="sub">(${v.dead} derelict)</span>` : ''}</b></div>`).join('')}</div>
  ${names.length > 1 ? `<h3>Names</h3><ul class="lineage">${names.map(n => `<li><span class="yr">Year ${n.year}</span><b>${esc(n.name)}</b><br><span class="sub">${esc(n.reason)}</span></li>`).join('')}</ul>` : ''}
  <h3>History</h3>
  <ul class="lineage">${hist.slice(-14).reverse().map(h => `<li class="${h.event ? 'ev' : ''}" ${h.event ? `data-act="event" data-id="${h.event}"` : ''}><span class="yr">Year ${h.year}</span>${esc(h.text)}</li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------- faction
export function factionPanel(app, id) {
  const w = app.world, year = app.viewYear, snap = app.snap;
  const f = w.factions[id]; const fs = snap.f[id];
  const terr = w.districts.filter((d, i) => snap.d[i] && snap.d[i].ctrl === id && !snap.d[i].ab);
  const gr = f.grievances.filter(g => g.year <= year);
  const names = (ids) => ids.map(i => w.factions[i]).filter(g => g && g.founded <= year && !(g.dissolved && g.dissolved <= year)).map(g => factionChip(w, g.id)).join(', ') || '<span class="sub">none</span>';
  const ideo = f.ideology;
  const purpose = f.purpose ? w.events.find(e => e.id === f.purpose) : null;
  return `${closeBtn()}<h2><span class="dot" style="background:${f.color};width:14px;height:14px"></span>${esc(f.name)} ${f.dissolved && f.dissolved <= year ? `<span class="tag warn">dissolved Year ${f.dissolved}</span>` : snap.rulerId === id ? '<span class="tag acc">governing</span>' : ''}</h2>
  <p class="sub">${f.arch} · founded Year ${f.founded}${f.home >= 0 ? ` · home: ${districtLink(w, f.home, snap)}` : ''}</p>
  <p>${esc(f.origin)}${purpose ? ` <span class="sub">↳ ${eventLink(w, purpose.id)}</span>` : ''}</p>
  <div class="grid2"><div class="kv"><span>Power</span><b>${fs ? Math.round(fs.power * 100) : 0}</b></div><div class="kv"><span>Districts held</span><b>${terr.length}</b></div><div class="kv"><span>Institutions</span><b>${fs ? fs.inst : 0}</b></div><div class="kv"><span>Grievances</span><b>${gr.length}</b></div></div>
  <h3>Ideology</h3>
  <div class="bars">${bar('Pluralist', ideo.control, 'acc')}${bar('Communal', ideo.communal, 'acc')}${bar('Traditional', ideo.tradition, 'acc')}${bar('Open', ideo.openness, 'acc')}</div>
  <h3>Territory</h3><p>${terr.map(d => districtLink(w, d.id, snap)).join(', ') || '<span class="sub">none</span>'}</p>
  <h3>Allies</h3><p>${names(fs ? fs.allies : f.allies)}</p>
  <h3>Rivals</h3><p>${names(fs ? fs.rivals : f.rivals)}</p>
  ${gr.length ? `<h3>Grievances</h3><ul class="lineage">${gr.slice(-8).reverse().map(g => `<li><span class="yr">Year ${g.year}</span>${esc(g.text)}${g.against >= 0 && w.factions[g.against] ? ` <span class="sub">— against ${factionChip(w, g.against)}</span>` : ''}</li>`).join('')}</ul>` : ''}`;
}

// ---------------------------------------------------------------- event
export function eventPanel(app, id) {
  const w = app.world, year = app.viewYear, snap = app.snap;
  const e = w.events.find(x => x.id === id); if (!e) return `${closeBtn()}<p>Unknown event.</p>`;
  const consequences = w.structures.filter(s => s.layers.some(l => l.cause === e.id && l.year <= year)).slice(0, 12);
  const lines = w.lines.filter(l => l.layers.some(x => x.cause === e.id && x.year <= year));
  const follow = w.events.filter(x => x.cause === e.id && x.year <= year);
  return `${closeBtn()}<h2>${esc(e.title)} <span class="tag ${e.severity >= 3 ? 'warn' : e.severity === 2 ? 'acc' : ''}">Year ${e.year}${e.ended ? `–${e.ended}` : ''}</span></h2>
  <p class="sub">${e.type}${e.district >= 0 ? ` · ${districtLink(w, e.district, snap)}` : ''}${e.faction >= 0 ? ` · ${factionChip(w, e.faction)}` : ''}</p>
  <p>${esc(e.text || '')}</p>
  ${e.cause ? `<p class="sub">Caused by ${eventLink(w, e.cause)}</p>` : ''}
  ${consequences.length || lines.length || follow.length ? `<h3>What it left behind</h3><ul class="evlist">${consequences.map(s => { const l = s.layers.find(x => x.cause === e.id); const L = structAt(s, year); return `<li data-act="structure" data-id="${s.id}"><span class="yr">Y${l.year}</span>${esc(STRUCT[L.type].label)} in ${esc(snap.d[snap.owners[s.plot] - 1]?.name || '?')}${L.type !== l.type ? ` <span class="sub">(was ${STRUCT[l.type].label.toLowerCase()})</span>` : ''} <span class="sub">— ${esc(l.note)}</span></li>`; }).join('')}${lines.map(l => `<li data-act="line" data-id="${l.id}"><span class="yr">Y${l.layers.find(x => x.cause === e.id).year}</span>${l.type === 'conduit' ? 'Conduit' : 'Tunnel'} ${esc(l.layers.find(x => x.cause === e.id).note)}</li>`).join('')}${follow.map(x => `<li data-act="event" data-id="${x.id}"><span class="yr">Y${x.year}</span>${esc(x.title)}</li>`).join('')}</ul>` : ''}
  ${e.severity >= 2 ? `<h3>How the generations remember it</h3>${memoryLines(w, e, year)}` : ''}`;
}

// ---------------------------------------------------------------- overview / cohorts
export function overviewPanel(app) {
  const w = app.world, year = app.viewYear, snap = app.snap, s = snap.s;
  const rul = w.factions[snap.rulerId];
  const factions = w.factions.filter(f => f.founded <= year && !(f.dissolved && f.dissolved <= year)).sort((a, b) => (snap.f[b.id]?.power || 0) - (snap.f[a.id]?.power || 0));
  const techs = TECH_TREE.filter(t => w.tech[t.id] && w.tech[t.id] <= year);
  const cohorts = snap.cohorts.filter(c => c.share > 0.005);
  const recent = w.events.filter(e => e.year <= year && e.severity >= 2).slice(-10).reverse();
  return `${closeBtn()}<h2>${esc(w.name)} <span class="tag">Year ${year}</span></h2>
  <p class="sub">seed "${esc(w.seed)}" · ${w.districts.filter((d, i) => snap.d[i] && !snap.d[i].ab).length} districts · governed by ${rul ? factionChip(w, rul.id) : '—'} · trade ${s.trade}${s.ration ? ' · <span class="tag warn">rationing</span>' : ''}</p>
  <div class="grid2"><div class="kv"><span>Population</span><b>${fmt(s.pop)}</b></div><div class="kv"><span>Inequality</span><b>${Math.round(s.ineq * 100)}</b></div><div class="kv"><span>Industry budget</span><b>${s.budget.toFixed(1)}</b></div><div class="kv"><span>Knowledge</span><b>${s.tech}</b></div></div>
  <h3>Supply</h3><div class="bars">${ratioBar('Food', s.foodR)}${ratioBar('Water', s.waterR)}${ratioBar('Energy', s.energyR)}${ratioBar('Housing', s.housingR)}${bar('Ecology', s.eco, s.eco < 0.6 ? 'warn' : 'ok')}${bar('Hull', s.hull, s.hull < 0.6 ? 'warn' : '')}${bar('Education', s.edu)}</div>
  <h3>Founding pressures</h3><p class="sub">${w.pressures.map(p => esc(p.text)).join(' ')}</p>
  <h3>Factions</h3><div class="bars">${factions.map(f => bar(`<span class="link" data-act="faction" data-id="${f.id}"><span class="dot" style="background:${f.color}"></span>${esc(f.name.split(' ').slice(0, 2).join(' '))}</span>`, snap.f[f.id]?.power || 0, '', (snap.f[f.id]?.terr || 0) + ' d.')).join('')}</div>
  <h3>Generations alive</h3>${cohorts.map(c => { const live = w.cohorts.find(x => x.id === c.id); const mem = live ? Object.entries(live.memories).map(([eid, v]) => [w.events.find(e => e.id === +eid), v]).filter(([e]) => e && e.year <= year).sort((a, b) => b[1] - a[1]).slice(0, 2) : []; return `<div class="memory"><b>${esc(c.name)}</b> <span class="sub">born Y${c.born} · ${Math.round(c.share * 100)}%</span>${mem.length ? `<br><span class="sub">marked by: </span>${mem.map(([e]) => eventLink(w, e.id)).join(', ')}` : ''}</div>`; }).join('')}
  <h3>Technology</h3><p>${techs.length ? techs.map(t => `<span class="tag ok">${esc(t.label)} · Y${w.tech[t.id]}</span>`).join(' ') : '<span class="sub">Founding-era technology only.</span>'}</p>
  <h3>Recent history</h3><ul class="evlist">${recent.map(e => `<li data-act="event" data-id="${e.id}"><span class="yr">Y${e.year}</span>${esc(e.title)}</li>`).join('')}</ul>
  <div class="row"><button class="btn" data-act="allevents">Full chronicle</button></div>`;
}
export function chroniclePanel(app) {
  const w = app.world, year = app.viewYear;
  const evs = w.events.filter(e => e.year <= year).slice().reverse();
  return `${closeBtn()}<h2>Chronicle <span class="tag">${evs.length} entries</span></h2><ul class="evlist">${evs.map(e => `<li data-act="event" data-id="${e.id}"><span class="yr">Y${e.year}</span>${e.severity >= 3 ? '<span class="tag warn">major</span> ' : ''}${esc(e.title)}</li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------- intervention
export function interventionPanel(app, iv) {
  return `<div class="ivHead"><span class="tag acc">Intervention · Year ${iv.year}</span><h2>${esc(iv.title)}</h2><p>${esc(iv.text)}</p></div>
  <p class="sub">The simulation is paused. Most of history runs without you; this is one of the few moments where the Steward's word carries.</p>
  ${iv.options.map(o => `<button class="btn block" data-act="decide" data-id="${o.id}"><span>${esc(o.label)}</span><small>${esc(o.desc)}</small></button>`).join('<div style="height:8px"></div>')}`;
}

// ---------------------------------------------------------------- fork
export function forkPanel(app) {
  return `${closeBtn()}<h2>Fork timeline at Year ${app.viewYear}</h2>
  <p>History up to this year is kept exactly as it happened in <b>${esc(app.branch.name)}</b>. From here, the new branch runs on its own: your decisions can differ, and so will everything that follows.</p>
  <input type="text" id="forkName" placeholder="Branch name" value="${esc(defaultBranchName(app))}" maxlength="32">
  <div class="row"><button class="btn primary" data-act="dofork">Create branch</button><button class="btn" data-act="close">Cancel</button></div>`;
}
function defaultBranchName(app) { const y = app.viewYear; const e = app.world.events.filter(x => x.year <= y && x.severity >= 2).pop(); return e ? `After the ${e.title}`.slice(0, 32) : `Fork at Year ${y}`; }

// ---------------------------------------------------------------- branches & comparison
export function branchesPanel(app) {
  const T = app.timelines; const bs = T.branches;
  const maxYear = Math.max(...bs.map(b => b.headYear), 10);
  const W = 360, rowH = 28, padL = 10, padR = 40;
  const x = (y) => padL + (y - 1) / Math.max(1, maxYear - 1) * (W - padL - padR);
  const rows = bs.map((b, i) => {
    const parent = b.parent !== null ? bs.findIndex(x => x.id === b.parent) : -1;
    const y0 = 14 + i * rowH;
    const conn = parent >= 0 ? `<path d="M${x(b.forkYear)} ${14 + parent * rowH} L${x(b.forkYear)} ${y0}" stroke="${b.color}" stroke-width="1.5" stroke-dasharray="3 3" fill="none"/>` : '';
    const active = b === app.branch;
    return `${conn}<g class="b" data-act="switch" data-id="${b.id}"><rect x="0" y="${y0 - 12}" width="${W}" height="${rowH - 2}" fill="${active ? 'rgba(255,255,255,0.06)' : 'transparent'}" rx="6"/><line x1="${x(b.forkYear)}" y1="${y0}" x2="${x(b.headYear)}" y2="${y0}" stroke="${b.color}" stroke-width="${active ? 4 : 2.5}" stroke-linecap="round"/><circle cx="${x(b.headYear)}" cy="${y0}" r="4" fill="${b.color}"/><text x="${x(b.headYear) + 8}" y="${y0 + 4}" font-size="10">Y${b.headYear}</text><text x="${x(b.forkYear) + 4}" y="${y0 - 3}" font-size="10" fill="${active ? '#fff' : '#aab'}">${esc(b.name)}</text></g>`;
  }).join('');
  const svg = `<svg class="branchTree" viewBox="0 0 ${W} ${14 + bs.length * rowH}" xmlns="http://www.w3.org/2000/svg">${rows}</svg>`;
  const list = bs.map(b => { const snap = b.history.get(b.headYear); return `<div class="kv"><span><span class="dot" style="background:${b.color}"></span>${esc(b.name)}${b === app.branch ? ' <span class="tag acc">active</span>' : ''}<br><span class="sub">forked Y${b.forkYear} · now Y${b.headYear} · ${fmt(snap.s.pop)} people · ${b.decisions.length} decisions</span></span><span class="row" style="margin:0">${b !== app.branch ? `<button class="btn" data-act="switch" data-id="${b.id}">Switch</button><button class="btn" data-act="compare" data-id="${b.id}">Compare</button>` : ''}${b.id !== 0 && bs.length > 1 ? `<button class="btn danger" data-act="delbranch" data-id="${b.id}">✕</button>` : ''}</span></div>`; }).join('');
  return `${closeBtn()}<h2>Timelines <span class="tag">${bs.length}</span></h2><p class="sub">Every branch shares the same seed. Scrub to an earlier year and tap Fork to create a new one.</p>${svg}${list}
  <div class="row"><button class="btn primary" data-act="fork">⑂ Fork at Year ${app.viewYear}</button></div>`;
}

export function comparePanel(app, other) {
  const A = app.branch, B = other;
  const y = Math.min(A.headYear, B.headYear);
  const sa = A.history.get(y), sb = B.history.get(y);
  const wa = A.world, wb = B.world;
  const row = (label, a, b) => `<tr><td>${label}</td><td style="color:${A.color}">${a}</td><td style="color:${B.color}">${b}</td></tr>`;
  const count = (w, pred) => w.events.filter(e => e.year <= y && pred(e)).length;
  const techs = (w) => TECH_TREE.filter(t => w.tech[t.id] && w.tech[t.id] <= y).length;
  const rulerName = (w, s) => w.factions[s.rulerId] ? w.factions[s.rulerId].name : '—';
  const distNames = (s) => new Set(s.d.filter(d => !d.ab).map(d => d.name));
  const na = distNames(sa), nb = distNames(sb);
  const onlyA = [...na].filter(n => !nb.has(n)), onlyB = [...nb].filter(n => !na.has(n));
  const structCount = (w) => { const c = {}; for (const s of w.structures) { if (s.built > y || (s.removed !== null && s.removed <= y)) continue; const L = structAt(s, y); const k = STRUCT[L.type].cat; c[k] = (c[k] || 0) + 1; } return c; };
  const ca = structCount(wa), cb = structCount(wb);
  const cats = [...new Set([...Object.keys(ca), ...Object.keys(cb)])];
  const evA = wa.events.filter(e => e.year <= y && e.severity >= 3 && e.year > Math.min(A.forkYear, B.forkYear)).map(e => e.title);
  const evB = wb.events.filter(e => e.year <= y && e.severity >= 3 && e.year > Math.min(A.forkYear, B.forkYear)).map(e => e.title);
  return `${closeBtn()}<h2>Compare at Year ${y}</h2>
  <p class="sub"><span class="dot" style="background:${A.color}"></span>${esc(A.name)} vs <span class="dot" style="background:${B.color}"></span>${esc(B.name)} — diverged at Year ${Math.max(A.forkYear, B.forkYear)}</p>
  <table class="cmp"><tr><th></th><th style="color:${A.color}">${esc(A.name)}</th><th style="color:${B.color}">${esc(B.name)}</th></tr>
  ${row('Population', fmt(sa.s.pop), fmt(sb.s.pop))}
  ${row('Living districts', sa.d.filter(d => !d.ab).length, sb.d.filter(d => !d.ab).length)}
  ${row('Abandoned', sa.d.filter(d => d.ab).length, sb.d.filter(d => d.ab).length)}
  ${row('Government', esc(rulerName(wa, sa)), esc(rulerName(wb, sb)))}
  ${row('Trade', sa.s.trade, sb.s.trade)}
  ${row('Technologies', techs(wa), techs(wb))}
  ${row('Inequality', Math.round(sa.s.ineq * 100), Math.round(sb.s.ineq * 100))}
  ${row('Ecology', Math.round(sa.s.eco * 100) + '%', Math.round(sb.s.eco * 100) + '%')}
  ${row('Hull', Math.round(sa.s.hull * 100) + '%', Math.round(sb.s.hull * 100) + '%')}
  ${row('Crises', count(wa, e => e.type === 'crisis'), count(wb, e => e.type === 'crisis'))}
  ${row('Revolts', count(wa, e => e.type === 'revolt'), count(wb, e => e.type === 'revolt'))}
  ${row('Revolutions', count(wa, e => e.type === 'revolution'), count(wb, e => e.type === 'revolution'))}
  ${row('Migrant communities', sa.d.filter(d => d.cul && !d.ab).length, sb.d.filter(d => d.cul && !d.ab).length)}
  ${row('Factions alive', sa.f.filter(f => f.alive).length, sb.f.filter(f => f.alive).length)}
  ${cats.map(c => row(CAT_LABEL[c], ca[c] || 0, cb[c] || 0)).join('')}
  </table>
  <h3>District names</h3><ul class="diff">${onlyA.map(n => `<li style="color:${A.color}">${esc(n)}</li>`).join('')}${onlyB.map(n => `<li style="color:${B.color}">${esc(n)}</li>`).join('')}${!onlyA.length && !onlyB.length ? '<li class="sub">Identical.</li>' : ''}</ul>
  <h3>Major events since divergence</h3><div class="grid2"><ul class="diff" style="padding-left:16px;color:${A.color}">${evA.map(t => `<li>${esc(t)}</li>`).join('') || '<li class="sub">none</li>'}</ul><ul class="diff" style="padding-left:16px;color:${B.color}">${evB.map(t => `<li>${esc(t)}</li>`).join('') || '<li class="sub">none</li>'}</ul></div>
  <div class="row"><button class="btn" data-act="switch" data-id="${B.id}">Switch to ${esc(B.name)}</button><button class="btn" data-act="branches">Back</button></div>`;
}

// ---------------------------------------------------------------- menu
export function menuPanel(app, savedInfo) {
  return `${closeBtn()}<h2>The Century Engine</h2>
  <p class="sub">${esc(app.world.name)} · seed "${esc(app.world.seed)}" · Year ${app.branch.headYear} · ${app.timelines.branches.length} timeline${app.timelines.branches.length > 1 ? 's' : ''}</p>
  <div class="row"><button class="btn primary" data-act="save">Save</button><button class="btn" data-act="load" ${savedInfo ? '' : 'disabled'}>Load${savedInfo ? ` <small class="sub">(${esc(savedInfo)})</small>` : ''}</button></div>
  <h3>New civilization</h3>
  <input type="text" id="seedInput" placeholder="Seed (any text)" value="" maxlength="40">
  <div class="row"><button class="btn primary" data-act="new">Start from seed</button><button class="btn" data-act="newrandom">Random seed</button></div>
  <h3>World file</h3>
  <div class="row"><button class="btn" data-act="export">Export JSON</button><button class="btn" data-act="import">Import JSON</button><button class="btn" data-act="snapshot">Snapshot PNG</button></div>
  <h3>How to play</h3>
  <p>Watch a civilization inside a rotating cylinder accumulate history. <b>Tap</b> anything to learn why it exists. <b>Drag the timeline</b> to travel through past eras — the habitat itself changes. <b>Fork</b> an earlier year to try a different history, then <b>compare</b> branches.</p>
  <p>Turn on <b>Archaeology</b> to see older construction under the present: previous boundaries (dashed, coloured by age), ghosts of converted buildings, derelict structures ringed in gold, and former names.</p>
  <p>Layers: districts · political control · culture · sentiment · wealth · ecology.</p>
  <p class="sub">Everything runs locally in your browser and autosaves. Saves store only the seed and your decisions — history is replayed deterministically.</p>`;
}
