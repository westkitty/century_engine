// The Century Engine — application shell. Wires simulation, history, renderer and UI.
import { Timelines } from './sim/branches.js';
import { Renderer, fmt } from './render/renderer.js';
import * as P from './ui/panels.js';
import { saveLocal, loadLocal, download, exportWorld } from './storage.js';

let Renderer3D;
try {
  // r169 requires WebGL2. Dynamic import also preserves fallback on module failure.
  const probe = document.createElement('canvas').getContext('webgl2');
  if (probe) { probe.getExtension('WEBGL_lose_context')?.loseContext(); ({ Renderer3D } = await import('./render/renderer3d.js')); }
} catch (e) { console.warn('3D unavailable; using 2D.', e); }

const $ = (id) => document.getElementById(id);
const MODES = ['districts', 'control', 'culture', 'sentiment', 'wealth', 'ecology'];
const MODE_LABEL = { districts: 'Districts', control: 'Control', culture: 'Culture', sentiment: 'Sentiment', wealth: 'Wealth', ecology: 'Ecology' };

class App {
  constructor() {
    this.canvas = $('world');
    try { this.renderer = Renderer3D ? new Renderer3D(this.canvas) : new Renderer(this.canvas); }
    catch (e) {
      console.warn('3D initialization failed; using 2D.', e);
      const replacement = this.canvas.cloneNode(); this.canvas.replaceWith(replacement); this.canvas = replacement;
      this.renderer = new Renderer(this.canvas);
    }
    this.timelines = null; this.branch = null;
    this.viewYear = 1; this.playing = false; this.speed = 3; this.acc = 0;
    this.mode = 'districts'; this.arch = false; this.selection = null;
    this.time = 0; this.lastT = performance.now();
    this.sheetState = 'hidden'; this.panel = null;
    this.toastQueue = []; this.lastToast = 0; this.dirty = false; this.lastSave = 0;
    this.bindUI();
    this.bindCanvas();
    this.bindScrubber();
    window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }
  get world() { return this.branch.world; }
  get snap() { return this.branch.history.get(this.viewYear); }
  get atHead() { return this.viewYear >= this.branch.headYear; }

  // ---------------------------------------------------------------- lifecycle
  async boot() {
    const saved = loadLocal();
    if (saved && saved.timelines) {
      this.showOverlay('Replaying saved history…');
      await nextFrame();
      try {
        this.timelines = Timelines.deserialize(saved.timelines);
        this.setBranch(this.timelines.active, saved.viewYear);
        this.toast({ title: 'Restored', text: `${this.world.name}, Year ${this.branch.headYear}.`, severity: 1 });
      } catch (e) { console.error(e); this.newCivilization(randomSeed()); }
      this.hideOverlay();
    } else {
      this.newCivilization(randomSeed());
      this.openPanel('menu');
    }
    requestAnimationFrame((t) => this.frame(t));
  }
  newCivilization(seed) {
    this.timelines = new Timelines(seed);
    const b = this.timelines.createRoot();
    this.setBranch(b, 1);
    this.playing = false; this.selection = null;
    this.toast({ title: `${this.world.name}`, text: `Seed "${seed}". ${fmt(this.snap.s.pop || this.world.districts.reduce((a, d) => a + d.pop, 0))} settlers. Press ▶ to begin.`, severity: 2 });
    this.autosave(true);
  }
  setBranch(b, viewYear) {
    this.branch = b; this.timelines.active = b;
    this.renderer.setWorld(b.world);
    this.viewYear = Math.min(viewYear ?? b.headYear, b.headYear);
    this.renderer.fit();
    $('habName').textContent = b.world.name;
    $('branchName').textContent = b.name; $('branchName').style.color = b.color;
    this.selection = null; this.updateClock(); this.drawScrub();
    if (b.world.pending && this.atHead) this.showIntervention();
  }
  onResize() {
    const r = this.renderer; const before = `${r.W}x${r.H}`;
    r.resize();
    const scrubH = $('scrubWrap').offsetHeight;
    document.documentElement.style.setProperty('--scrubH', scrubH + 'px');
    r.insets.top = 60; r.insets.bottom = scrubH + 4;
    const desktop = window.innerWidth >= 900;
    r.insets.right = desktop && this.sheetState !== 'hidden' ? 420 : 0;
    if (`${r.W}x${r.H}` !== before || !this.fitted) { r.fit(); this.fitted = true; }
    this.drawScrub();
  }
  // ---------------------------------------------------------------- loop
  frame(now) {
    const dt = Math.min(0.1, (now - this.lastT) / 1000); this.lastT = now; this.time += dt;
    if (this.playing) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= 1 && steps < 12 && this.playing) { this.acc -= 1; this.step(); steps++; }
      if (this.acc > 3) this.acc = 0;
    }
    this.renderer.render({ year: this.viewYear, snap: this.snap, mode: this.mode, arch: this.arch, selection: this.selection, time: this.time, history: this.branch.history });
    if (this.dirty && now - this.lastSave > 8000) this.autosave();
    requestAnimationFrame((t) => this.frame(t));
  }
  step() {
    const b = this.branch, w = b.world;
    if (!this.atHead) { this.viewYear = b.headYear; }
    const ok = this.timelines.advance(b, w.year + 1, (e) => this.onEvent(e));
    this.viewYear = b.headYear; this.dirty = true;
    if (!ok) { this.wasPlaying = true; this.setPlaying(false); this.showIntervention(); }
    this.updateClock();
    if (w.year % 4 === 0) this.drawScrub();
    if (this.panel && this.panel.kind !== 'intervention' && w.year % 5 === 0) this.refreshPanel();
  }
  onEvent(e) {
    if (e.severity >= 3 || (e.severity === 2 && this.speed <= 10) || ['tech', 'revolution', 'abandon', 'faction'].includes(e.type)) this.toast(e);
  }
  setPlaying(p) {
    if (p && !this.atHead) { this.viewYear = this.branch.headYear; this.updateClock(); }
    if (p && this.world.pending) { this.showIntervention(); return; }
    this.playing = p; $('playBtn').textContent = p ? '❚❚' : '▶'; $('playBtn').classList.toggle('on', p);
    if (!p) this.autosave();
  }
  updateClock() {
    $('yearLabel').textContent = `Year ${this.viewYear}`;
    const s = this.snap.s; $('popLabel').textContent = `${fmt(s.pop)} people`;
    const past = !this.atHead; $('viewingPast').classList.toggle('hidden', !past); $('viewYearLabel').textContent = this.viewYear;
    $('forkBtn').textContent = `⑂ Fork Y${this.viewYear}`;
  }
  // ---------------------------------------------------------------- persistence
  autosave(force = false) {
    if (!this.timelines) return;
    this.lastSave = performance.now(); this.dirty = false;
    saveLocal({ timelines: this.timelines.serialize(), viewYear: this.viewYear, savedAt: Date.now() });
  }
  async loadSaved() {
    const saved = loadLocal(); if (!saved) return;
    this.setPlaying(false); this.showOverlay('Replaying saved history…'); await nextFrame();
    this.timelines = Timelines.deserialize(saved.timelines); this.setBranch(this.timelines.active, saved.viewYear);
    this.hideOverlay(); this.closeSheet(); this.toast({ title: 'Loaded', text: `${this.world.name}, Year ${this.branch.headYear}.`, severity: 1 });
  }
  doExport() {
    const data = exportWorld(this.timelines, this.branch);
    download(`century-engine_${slug(this.world.name)}_${this.world.seed}_Y${this.branch.headYear}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    this.toast({ title: 'Exported', text: 'World file downloaded.', severity: 1 });
  }
  async doImport(file) {
    try {
      const text = await file.text(); const data = JSON.parse(text);
      const tl = data.timelines || (data.seed ? { seed: data.seed, branches: [{ id: 0, name: 'Prime', parent: null, forkYear: 1, decisions: data.decisions || [], seed: data.seed, headYear: data.state?.year || 1 }], active: 0, nextBranchId: 1 } : null);
      if (!tl) throw new Error('Not a Century Engine world file');
      this.setPlaying(false); this.showOverlay('Replaying imported history…'); await nextFrame();
      this.timelines = Timelines.deserialize(tl); this.setBranch(this.timelines.active);
      this.hideOverlay(); this.closeSheet(); this.autosave(true);
      this.toast({ title: 'Imported', text: `${this.world.name}, Year ${this.branch.headYear}.`, severity: 2 });
    } catch (e) { this.hideOverlay(); this.toast({ title: 'Import failed', text: e.message, severity: 3 }); }
  }
  doSnapshot() {
    const c = this.renderer.snapshotPNG({ year: this.viewYear, snap: this.snap, mode: this.mode, arch: this.arch, time: this.time, history: this.branch.history });
    c.toBlob((blob) => { download(`${slug(this.world.name)}_Y${this.viewYear}.png`, blob); }, 'image/png');
  }
  // ---------------------------------------------------------------- UI: sheet
  openPanel(kind, id, extra) {
    this.panel = { kind, id, extra };
    this.refreshPanel();
    const sheet = $('sheet'); const wasHidden = sheet.classList.contains('hidden'); sheet.classList.remove('hidden', 'peek');
    if (wasHidden) sheet.classList.remove('full');
    if (kind === 'intervention') sheet.classList.add('full');
    this.sheetState = 'half'; document.body.classList.add('sheet-open');
    if (window.innerWidth >= 900 && wasHidden) { this.renderer.insets.right = 420; this.renderer.fit(); }
  }
  refreshPanel() {
    if (!this.panel) return;
    const { kind, id, extra } = this.panel; const w = this.world; let html = '';
    try {
      switch (kind) {
        case 'unit': html = P.unitPanel(this, extra); break;
        case 'structure': { const s = w.structures.find(x => x.id === id); html = s ? P.structurePanel(this, s) : ''; break; }
        case 'line': { const l = w.lines.find(x => x.id === id); html = l ? P.linePanel(this, l) : ''; break; }
        case 'plot': html = P.plotPanel(this, id); break;
        case 'district': html = P.districtPanel(this, id); break;
        case 'faction': html = P.factionPanel(this, id); break;
        case 'event': html = P.eventPanel(this, id); break;
        case 'overview': html = P.overviewPanel(this); break;
        case 'chronicle': html = P.chroniclePanel(this); break;
        case 'intervention': html = P.interventionPanel(this, w.pending); break;
        case 'fork': html = P.forkPanel(this); break;
        case 'branches': html = P.branchesPanel(this); break;
        case 'compare': html = P.comparePanel(this, this.timelines.get(id)); break;
        case 'menu': { const s = loadLocal(); html = P.menuPanel(this, s ? `Year ${s.timelines.branches.find(b => b.id === s.timelines.active)?.headYear ?? '?'}` : null); break; }
      }
    } catch (e) { console.error(e); html = `<button class="close" data-act="close">✕</button><p>Could not render panel: ${e.message}</p>`; }
    if (!html) { this.closeSheet(); return; }
    const body = $('sheetBody'); const keepScroll = body.scrollTop; body.innerHTML = html; if (kind === this.lastPanelKind) body.scrollTop = keepScroll; this.lastPanelKind = kind;
  }
  closeSheet() {
    if (this.panel && this.panel.kind === 'intervention' && this.world.pending) return; // must decide
    $('sheet').classList.add('hidden'); this.sheetState = 'hidden'; this.panel = null; document.body.classList.remove('sheet-open');
    if (window.innerWidth >= 900) { this.renderer.insets.right = 0; this.renderer.fit(); }
  }
  showIntervention() { if (!this.world.pending) return; this.openPanel('intervention'); this.selection = null; }
  select(hit) {
    this.selection = hit;
    if (!hit) { if (this.panel && ['structure', 'plot', 'district', 'line', 'unit'].includes(this.panel.kind)) this.closeSheet(); return; }
    if (hit.kind === 'plot') { const did = this.snap.owners[hit.id] - 1; if (did >= 0) { this.selection = { kind: 'district', id: did, plot: hit.id }; this.openPanel('district', did); } else this.openPanel('plot', hit.id); }
    else this.openPanel(hit.kind, hit.id, hit);
  }
  // ---------------------------------------------------------------- UI: toasts
  toast(e) {
    const box = $('toasts'); if (box.children.length >= 3) box.firstElementChild.remove();
    const el = document.createElement('div'); el.className = `toast sev${e.severity || 1}`;
    el.innerHTML = `<span class="y">${e.year ? 'Y' + e.year : ''}</span><b>${escapeHtml(e.title)}</b>${e.text ? ` <span class="sub">${escapeHtml(e.text).slice(0, 140)}</span>` : ''}`;
    if (e.id) el.addEventListener('click', () => { this.openPanel('event', e.id); el.remove(); });
    box.appendChild(el);
    setTimeout(() => el.classList.add('fade'), 4200); setTimeout(() => el.remove(), 4800);
  }
  showOverlay(t) { $('overlayText').textContent = t; $('overlay').classList.remove('hidden'); }
  hideOverlay() { $('overlay').classList.add('hidden'); }
  // ---------------------------------------------------------------- actions
  act(act, id, el) {
    const T = this.timelines;
    switch (act) {
      case 'close': this.closeSheet(); break;
      case 'structure': this.selection = { kind: 'structure', id: +id }; this.openPanel('structure', +id); break;
      case 'line': this.selection = { kind: 'line', id: +id }; this.openPanel('line', +id); break;
      case 'plot': this.selection = { kind: 'plot', id: +id }; this.openPanel('plot', +id); break;
      case 'district': this.selection = { kind: 'district', id: +id }; this.openPanel('district', +id); break;
      case 'faction': this.openPanel('faction', +id); break;
      case 'event': { const e = this.world.events.find(x => x.id === +id); if (e && e.district >= 0) this.selection = { kind: 'district', id: e.district }; this.openPanel('event', +id); break; }
      case 'allevents': this.openPanel('chronicle'); break;
      case 'decide': { this.timelines.decide(this.branch, id); this.panel = null; this.closeSheet(); this.dirty = true; this.autosave(); this.updateClock(); this.drawScrub(); const last = this.world.events[this.world.events.length - 1]; if (last && last.type === 'decision') this.toast(last); if (this.wasPlaying) { this.wasPlaying = false; this.setPlaying(true); } break; }
      case 'fork': this.setPlaying(false); this.openPanel('fork'); break;
      case 'dofork': {
        const name = ($('forkName')?.value || '').trim() || `Fork at Year ${this.viewYear}`;
        this.showOverlay('Replaying history to fork point…');
        setTimeout(() => { const b = T.fork(this.branch, this.viewYear, name); this.setBranch(b); this.hideOverlay(); this.closeSheet(); this.drawScrub(); this.autosave(true); this.toast({ title: `Branch created: ${name}`, text: `Diverging from Year ${b.forkYear}. Play to see what happens differently.`, severity: 2 }); if (b.world.pending) this.showIntervention(); }, 30);
        break;
      }
      case 'branches': this.openPanel('branches'); break;
      case 'switch': { const b = T.get(+id); if (b) { this.setPlaying(false); this.setBranch(b); this.closeSheet(); this.drawScrub(); this.autosave(true); } break; }
      case 'compare': this.openPanel('compare', +id); break;
      case 'delbranch': { const b = T.get(+id); if (b && b.id !== 0) { T.branches = T.branches.filter(x => x !== b && x.parent !== b.id); if (this.branch === b || !T.branches.includes(this.branch)) this.setBranch(T.branches[0]); this.refreshPanel(); this.autosave(true); } break; }
      case 'save': this.autosave(true); this.toast({ title: 'Saved', text: 'Stored in this browser.', severity: 1 }); this.refreshPanel(); break;
      case 'load': this.loadSaved(); break;
      case 'new': { const seed = ($('seedInput')?.value || '').trim() || randomSeed(); this.closeSheet(); this.newCivilization(seed); break; }
      case 'newrandom': this.closeSheet(); this.newCivilization(randomSeed()); break;
      case 'export': this.doExport(); break;
      case 'import': $('importFile').click(); break;
      case 'snapshot': this.doSnapshot(); break;
    }
  }
  // ---------------------------------------------------------------- bindings
  bindUI() {
    $('sheetBody').addEventListener('click', (ev) => { const el = ev.target.closest('[data-act]'); if (!el) return; ev.preventDefault(); this.act(el.dataset.act, el.dataset.id, el); });
    $('menuBtn').addEventListener('click', () => this.panel?.kind === 'menu' ? this.closeSheet() : this.openPanel('menu'));
    $('popBtn').addEventListener('click', () => this.openPanel('overview'));
    $('archBtn').addEventListener('click', () => { this.arch = !this.arch; $('archBtn').classList.toggle('on', this.arch); if (this.arch) this.toast({ title: 'Archaeology overlay', text: 'Older layers show through the present. Gold rings mark derelict structures; dashed lines are former boundaries.', severity: 1 }); });
    $('layerBtn').addEventListener('click', () => { this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]; $('layerLabel').textContent = MODE_LABEL[this.mode]; $('layerBtn').classList.toggle('on', this.mode !== 'districts'); });
    $('branchBtn').addEventListener('click', () => this.panel?.kind === 'branches' ? this.closeSheet() : this.openPanel('branches'));
    $('fitBtn').addEventListener('click', () => this.renderer.fit());
    $('playBtn').addEventListener('click', () => this.setPlaying(!this.playing));
    document.querySelectorAll('.spd').forEach(b => b.addEventListener('click', () => { this.speed = +b.dataset.s; document.querySelectorAll('.spd').forEach(x => x.classList.toggle('on', x === b)); if (!this.playing) this.setPlaying(true); }));
    document.querySelector('.spd[data-s="3"]').classList.add('on');
    $('forkBtn').addEventListener('click', () => this.act('fork'));
    $('jumpPresent').addEventListener('click', () => { this.viewYear = this.branch.headYear; this.updateClock(); this.drawScrub(); this.refreshPanel(); });
    $('importFile').addEventListener('change', (ev) => { const f = ev.target.files[0]; if (f) this.doImport(f); ev.target.value = ''; });
    // sheet drag (mobile)
    const sheet = $('sheet'), handle = $('sheetHandle'); let sy0 = 0, h0 = 0, dragging = false;
    handle.addEventListener('pointerdown', (e) => { dragging = true; sy0 = e.clientY; h0 = sheet.offsetHeight; handle.setPointerCapture(e.pointerId); sheet.style.transition = 'none'; });
    handle.addEventListener('pointermove', (e) => { if (!dragging) return; const h = Math.max(80, Math.min(window.innerHeight * 0.9, h0 - (e.clientY - sy0))); sheet.style.height = h + 'px'; });
    const endDrag = (e) => { if (!dragging) return; dragging = false; sheet.style.transition = ''; const h = sheet.offsetHeight; sheet.style.height = ''; sheet.classList.remove('peek', 'full'); if (h < 150) { if (this.panel?.kind === 'intervention') sheet.classList.add('peek'); else this.closeSheet(); } else if (h > window.innerHeight * 0.62) sheet.classList.add('full'); };
    handle.addEventListener('pointerup', endDrag); handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('click', () => { if (this.sheetState === 'hidden') return; sheet.classList.toggle('full'); });
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ') { e.preventDefault(); this.setPlaying(!this.playing); }
      if (e.key === 'a') $('archBtn').click(); if (e.key === 'l') $('layerBtn').click(); if (e.key === 'Escape') this.closeSheet();
      if (e.key === 'ArrowLeft') { this.setPlaying(false); this.viewYear = Math.max(1, this.viewYear - (e.shiftKey ? 10 : 1)); this.updateClock(); this.drawScrub(); this.refreshPanel(); }
      if (e.key === 'ArrowRight') { this.viewYear = Math.min(this.branch.headYear, this.viewYear + (e.shiftKey ? 10 : 1)); this.updateClock(); this.drawScrub(); this.refreshPanel(); }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.autosave(true); } });
  }
  bindCanvas() {
    if (this.renderer.is3D) {
      const c = this.canvas, pointers = new Set(); let tap = null;
      c.addEventListener('pointerdown', e => { pointers.add(e.pointerId); tap = pointers.size === 1 ? { id:e.pointerId, x:e.clientX, y:e.clientY, t:performance.now() } : null; });
      c.addEventListener('pointermove', e => { if(tap && Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>7) tap=null; });
      c.addEventListener('pointerup', e => { if(tap && tap.id===e.pointerId && performance.now()-tap.t<500) { const r=c.getBoundingClientRect(); this.select(this.renderer.hitTest(e.clientX-r.left,e.clientY-r.top,this.viewYear)); } pointers.delete(e.pointerId); tap=null; });
      c.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); tap=null; });
      return;
    }
    const c = this.canvas; const pts = new Map(); let tapStart = null; let lastPinch = null; let moved = false;
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 1) { tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; moved = false; } lastPinch = null; });
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId); const cur = { x: e.clientX, y: e.clientY };
      if (pts.size === 1) { const dx = cur.x - prev.x, dy = cur.y - prev.y; if (Math.hypot(cur.x - (tapStart?.x || 0), cur.y - (tapStart?.y || 0)) > 6) moved = true; if (moved) this.renderer.pan(dx, dy); }
      else if (pts.size === 2) {
        pts.set(e.pointerId, cur); const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (lastPinch) { this.renderer.zoomAt(mx, my, d / lastPinch.d); this.renderer.pan(mx - lastPinch.mx, my - lastPinch.my); }
        lastPinch = { d, mx, my }; moved = true;
      }
      pts.set(e.pointerId, cur);
    });
    const up = (e) => {
      if (pts.size === 1 && tapStart && !moved && performance.now() - tapStart.t < 400) { const r = c.getBoundingClientRect(); this.select(this.renderer.hitTest(e.clientX - r.left, e.clientY - r.top, this.viewYear)); }
      pts.delete(e.pointerId); if (pts.size < 2) lastPinch = null; if (pts.size === 0) tapStart = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); lastPinch = null; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); const r = c.getBoundingClientRect(); this.renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    c.addEventListener('dblclick', (e) => { const r = c.getBoundingClientRect(); this.renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, 1.8); });
  }
  // ---------------------------------------------------------------- scrubber
  bindScrubber() {
    const s = $('scrub'); let dragging = false;
    const setFromX = (clientX) => { const r = s.getBoundingClientRect(); const u = Math.max(0, Math.min(1, (clientX - r.left - 8) / (r.width - 16))); const head = this.branch.headYear; const y = Math.round(1 + u * (head - 1)); if (y !== this.viewYear) { this.viewYear = y; this.updateClock(); this.drawScrub(); if (this.panel && this.panel.kind !== 'intervention') this.refreshPanel(); } };
    s.addEventListener('pointerdown', (e) => { dragging = true; s.setPointerCapture(e.pointerId); this.setPlaying(false); setFromX(e.clientX); });
    s.addEventListener('pointermove', (e) => { if (dragging) setFromX(e.clientX); });
    const end = () => { dragging = false; };
    s.addEventListener('pointerup', end); s.addEventListener('pointercancel', end);
  }
  drawScrub() {
    if (!this.branch) return;
    const c = $('scrub'); const dpr = window.devicePixelRatio || 1; const r = c.getBoundingClientRect(); if (!r.width) return;
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); const W = r.width, H = r.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(12,14,24,0.86)'; roundRect(ctx, 0, 0, W, H, 10); ctx.fill();
    const b = this.branch; const head = Math.max(2, b.headYear); const x = (y) => 8 + (y - 1) / (head - 1) * (W - 16);
    const hist = b.history;
    // population curve
    const maxPop = Math.max(1, ...hist.years.map(s => s.s.pop));
    ctx.beginPath(); for (let i = 0; i < hist.years.length; i++) { const s = hist.years[i]; const px = x(s.year), py = H - 6 - (s.s.pop / maxPop) * (H - 24); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.lineTo(x(head), H - 6); ctx.lineTo(x(1), H - 6); ctx.closePath(); ctx.fillStyle = 'rgba(92,200,232,0.12)'; ctx.fill();
    // scarcity band (red where any ratio < 0.9)
    for (let i = 0; i < hist.years.length; i++) { const s = hist.years[i].s; const worst = Math.min(s.foodR, s.waterR, s.energyR); if (worst < 0.9) { ctx.fillStyle = `rgba(224,90,122,${Math.min(0.6, (0.9 - worst) * 1.5)})`; ctx.fillRect(x(hist.years[i].year) - 0.5, H - 6, Math.max(1, (W - 16) / (head - 1)) + 0.5, 4); } }
    // fork point of this branch
    if (b.forkYear > 1) { ctx.strokeStyle = b.color; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x(b.forkYear), 4); ctx.lineTo(x(b.forkYear), H - 4); ctx.stroke(); ctx.setLineDash([]); }
    // event ticks
    for (const e of b.world.events) {
      if (e.severity < 2 && e.type !== 'tech') continue;
      const px = x(e.year); const col = e.type === 'tech' ? '#5ee0b0' : e.type === 'decision' ? '#e0c26a' : e.severity >= 3 ? '#e05a7a' : '#8b90a6';
      ctx.fillStyle = col; const h = e.severity >= 3 ? 14 : 9; ctx.fillRect(px - 1, 8 + (e.type === 'tech' ? 0 : 4), 2, h);
    }
    // year labels
    ctx.fillStyle = 'rgba(139,144,166,0.9)'; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
    const stepY = head > 600 ? 200 : head > 250 ? 100 : head > 100 ? 50 : head > 40 ? 20 : 10;
    for (let y = stepY; y < head; y += stepY) ctx.fillText(String(y), x(y), H - 10);
    // handle
    const hx = x(this.viewYear);
    ctx.fillStyle = 'rgba(224,194,106,0.25)'; ctx.fillRect(hx, 0, x(head) - hx, H);
    ctx.strokeStyle = '#e0c26a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, 2); ctx.lineTo(hx, H - 2); ctx.stroke();
    ctx.fillStyle = '#e0c26a'; ctx.beginPath(); ctx.arc(hx, H / 2, 7, 0, Math.PI * 2); ctx.fill();
  }
}

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function randomSeed() { const a = ['amber', 'basalt', 'cobalt', 'delta', 'ember', 'fathom', 'gale', 'halcyon', 'iris', 'juniper', 'kestrel', 'lumen', 'meridian', 'nadir', 'orbit', 'pilgrim', 'quartz', 'relay', 'sable', 'tether', 'umbra', 'vesper', 'wick', 'yonder', 'zenith']; return `${a[Math.floor(Math.random() * a.length)]}-${a[Math.floor(Math.random() * a.length)]}-${Math.floor(Math.random() * 900 + 100)}`; }
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function nextFrame() { return new Promise(r => requestAnimationFrame(() => setTimeout(r, 20))); }

const app = new App();
window.century = app;
app.boot();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
