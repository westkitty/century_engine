// Canvas renderer for the habitat cutaway. Pure presentation: it reads a
// world + a per-year snapshot and draws; it never mutates simulation state.
import { GRID_COLS, GRID_ROWS, WORLD_W, WORLD_H, STRUCT, CULTURE_COLORS } from '../sim/defs.js';
import { RNG } from '../rng.js';
import { structAt } from '../sim/sim.js';

const DISTRICT_PALETTE = ['#3b4a6b', '#4a5a3d', '#5b4a63', '#3d5a5e', '#6b4f3b', '#4f5a6b', '#5a3f4a', '#3f5a4a', '#5a5a3f', '#465a6b', '#6b4560', '#3f6b5a', '#5f4a3f', '#4a3f6b', '#6b6040', '#405a40', '#6b4040', '#40606b', '#5a4a6b', '#4a6b4a'];
const CAT_COLOR = { housing: '#d8c9a8', food: '#7fc46a', water: '#5cc8e8', energy: '#f0c050', industry: '#a0a4b0', commerce: '#f08a4b', civic: '#f2ecd8', education: '#5ee0b0', health: '#f5f5f5', culture: '#b48ce8', transit: '#c0c8d8', military: '#c0453f', ruin: '#6e6a66' };
const FRAME = 34, CAP = 90;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.cam = { x: WORLD_W / 2, y: WORLD_H / 2, s: 0.5 };
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = 1; this.H = 1; this.insets = { top: 60, bottom: 130, left: 0, right: 0 };
    this.stars = []; this.world = null; this.tverts = []; this.polys = []; this.slotPos = [];
    this.labelCache = { year: -1, owners: null, labels: [] };
    this.resize();
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    // In portrait the cylinder stands upright so it fills the phone screen.
    this.portrait = this.H > this.W * 1.15;
  }
  // rotated ("view") coordinates: portrait maps world (x,y) -> (y, WORLD_W - x)
  R(x, y) { return this.portrait ? [y, WORLD_W - x] : [x, y]; }
  Rinv(X, Y) { return this.portrait ? [WORLD_W - Y, X] : [X, Y]; }
  setWorld(w) {
    this.world = w;
    const rng = new RNG('stars:' + w.seed);
    this.stars = Array.from({ length: 260 }, () => ({ x: rng.next(), y: rng.next(), b: rng.float(0.2, 1), r: rng.float(0.4, 1.4) }));
    // foreshortened vertices: rows near the top/bottom curve away from the viewer
    this.tverts = w.verts.map(([x, y]) => [x, WORLD_H / 2 - (WORLD_H / 2) * Math.cos(Math.PI * y / WORLD_H)]);
    this.polys = w.plots.map(p => p.v.map(i => this.tverts[i]));
    this.slotPos = w.plots.map(p => {
      const [a, b, c, d] = p.v.map(i => this.tverts[i]);
      const lerp2 = (u, v) => { const top = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; const bot = [d[0] + (c[0] - d[0]) * u, d[1] + (c[1] - d[1]) * u]; return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v]; };
      return [lerp2(0.27, 0.3), lerp2(0.73, 0.3), lerp2(0.27, 0.72), lerp2(0.73, 0.72)].map(pt => ({ x: pt[0], y: pt[1], size: Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(d[0] - a[0], d[1] - a[1])) * 0.36 }));
    });
    this.centers = this.polys.map(poly => [poly.reduce((s, p) => s + p[0], 0) / 4, poly.reduce((s, p) => s + p[1], 0) / 4]);
    this.labelCache.year = -1;
  }
  // ---- camera
  fit() {
    const availW = this.W - this.insets.left - this.insets.right - 24, availH = this.H - this.insets.top - this.insets.bottom - 24;
    const ext = this.portrait ? [WORLD_H + 2 * FRAME + 60, WORLD_W + 2 * CAP + 40] : [WORLD_W + 2 * CAP + 40, WORLD_H + 2 * FRAME + 60];
    this.cam.s = Math.max(0.05, Math.min(availW / ext[0], availH / ext[1]));
    const c = this.R(WORLD_W / 2, WORLD_H / 2);
    this.cam.x = c[0] + (this.insets.right - this.insets.left) / 2 / this.cam.s; this.cam.y = c[1] + (this.insets.bottom - this.insets.top) / 2 / this.cam.s;
    this.minS = this.cam.s * 0.6;
  }
  toScreen(x, y) { const [X, Y] = this.R(x, y); return [(X - this.cam.x) * this.cam.s + this.W / 2, (Y - this.cam.y) * this.cam.s + this.H / 2]; }
  toWorld(sx, sy) { return this.Rinv((sx - this.W / 2) / this.cam.s + this.cam.x, (sy - this.H / 2) / this.cam.s + this.cam.y); }
  pan(dx, dy) { this.cam.x -= dx / this.cam.s; this.cam.y -= dy / this.cam.s; this.clampCam(); }
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.s = Math.max(this.minS || 0.1, Math.min(6, this.cam.s * f));
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx; this.cam.y += wy - ny; this.clampCam();
  }
  clampCam() { const mx = this.portrait ? WORLD_H : WORLD_W, my = this.portrait ? WORLD_W : WORLD_H; this.cam.x = Math.max(-250, Math.min(mx + 250, this.cam.x)); this.cam.y = Math.max(-300, Math.min(my + 300, this.cam.y)); }

  // ---- hit testing
  hitTest(sx, sy, year) {
    const [wx, wy] = this.toWorld(sx, sy);
    const w = this.world; if (!w) return null;
    let bestS = null, bestD = Infinity;
    const r = Math.max(10 / this.cam.s, 14);
    for (const s of w.structures) {
      if (s.built > year || (s.removed !== null && s.removed <= year)) continue;
      const sp = this.slotPos[s.plot][s.slot];
      const d = Math.hypot(sp.x - wx, sp.y - wy);
      if (d < r && d < bestD) { bestD = d; bestS = s; }
    }
    if (bestS) return { kind: 'structure', id: bestS.id };
    // lines: distance to segment
    for (const l of w.lines) {
      if (l.built > year) continue;
      const [a, b] = this.lineEnds(l);
      if (distSeg(wx, wy, a[0], a[1], b[0], b[1]) < r * 0.8) return { kind: 'line', id: l.id };
    }
    for (let i = 0; i < this.polys.length; i++) if (pointInPoly(wx, wy, this.polys[i])) return { kind: 'plot', id: i };
    return null;
  }
  lineEnds(l) {
    const w = this.world;
    const c = (did) => { const d = w.districts[did]; const ids = d.plots.length ? d.plots : [w.plots.find(p => p.district === did) ? w.plots.find(p => p.district === did).id : 0]; let x = 0, y = 0; for (const id of ids) { x += this.centers[id][0]; y += this.centers[id][1]; } return [x / ids.length, y / ids.length]; };
    return [c(l.from), c(l.to)];
  }

  // ---- main draw
  render(st) {
    const { ctx } = this; const w = this.world; if (!w || !st.snap) return;
    const dpr = this.dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = st.time;
    this.drawBackground(t);
    ctx.save();
    ctx.translate(this.W / 2, this.H / 2); ctx.scale(this.cam.s, this.cam.s); ctx.translate(-this.cam.x, -this.cam.y);
    if (this.portrait) ctx.transform(0, -1, 1, 0, 0, WORLD_W);
    this.drawFrame(t);
    this.drawPlots(st);
    this.drawBorders(st);
    if (st.arch) this.drawArchaeologyUnder(st);
    this.drawLines(st);
    this.drawStructures(st);
    if (st.arch) this.drawArchaeologyOver(st);
    this.drawSelection(st);
    ctx.restore();
    this.drawLabels(st);
    this.drawCrisisVignette(st);
  }
  drawBackground(t) {
    const { ctx, W, H } = this;
    const g = ctx.createRadialGradient(W * 0.5, H * 0.45, 10, W * 0.5, H * 0.45, Math.max(W, H) * 0.8);
    g.addColorStop(0, '#0b0e1c'); g.addColorStop(1, '#03040a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const drift = (t * 0.004) % 1;
    for (const s of this.stars) {
      const y = ((s.y + drift) % 1) * H;
      const tw = 0.6 + 0.4 * Math.sin(t * 0.7 + s.x * 40);
      ctx.globalAlpha = s.b * tw * 0.9; ctx.fillStyle = '#dfe6ff';
      ctx.beginPath(); ctx.arc(s.x * W, y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  drawFrame(t) {
    const { ctx } = this;
    // hull shell
    ctx.fillStyle = '#141826';
    roundRect(ctx, -FRAME, -FRAME, WORLD_W + 2 * FRAME, WORLD_H + 2 * FRAME, 26); ctx.fill();
    ctx.strokeStyle = 'rgba(180,190,220,0.25)'; ctx.lineWidth = 2; ctx.stroke();
    // window strips along the hull (light lets in from the mirrors)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const y = side < 0 ? -FRAME + 8 + i * 8 : WORLD_H + FRAME - 12 - i * 8;
        const pulse = 0.5 + 0.2 * Math.sin(t * 0.3 + i);
        ctx.fillStyle = `rgba(255,240,200,${0.12 * pulse})`; ctx.fillRect(40, y, WORLD_W - 80, 3);
      }
    }
    // end caps with slowly rotating spokes
    for (const side of [0, 1]) {
      const cx = side ? WORLD_W + FRAME + CAP / 2 : -FRAME - CAP / 2, cy = WORLD_H / 2;
      const rx = CAP / 2, ry = WORLD_H / 2 + FRAME;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(rx / ry, 1);
      const g = ctx.createRadialGradient(0, 0, 4, 0, 0, ry); g.addColorStop(0, '#2a3048'); g.addColorStop(1, '#0d1020');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ry, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(180,190,220,0.25)'; ctx.lineWidth = 2 * ry / rx; ctx.stroke();
      ctx.strokeStyle = 'rgba(150,170,220,0.22)'; ctx.lineWidth = 1.5 * ry / rx;
      for (let i = 0; i < 8; i++) { const a = t * 0.08 + i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * ry, Math.sin(a) * ry); ctx.stroke(); }
      ctx.fillStyle = '#e8d8a0'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  plotFill(st, i) {
    const w = this.world, snap = st.snap;
    const owner = snap.owners[i] - 1, flags = snap.flags[i], soil = snap.soil[i] / 255;
    const ds = owner >= 0 ? snap.d[owner] : null;
    if (flags & 1) return '#1a0f12'; // breached: sealed & dark
    if (ds && ds.ab) return '#16181c';
    let base;
    switch (st.mode) {
      case 'control': { const f = ds && ds.ctrl >= 0 ? w.factions[ds.ctrl] : null; base = f ? mix(f.color, '#141826', 0.55) : '#22242c'; break; }
      case 'culture': base = ds ? mix(CULTURE_COLORS[(ds.cul || 0) % CULTURE_COLORS.length], '#141826', 0.55) : '#22242c'; break;
      case 'sentiment': base = ds ? mix('#e05a7a', '#7fc46a', clamp01(ds.sent)) : '#22242c'; base = mix(base, '#141826', 0.45); break;
      case 'wealth': base = ds ? mix('#2a3048', '#e0c26a', clamp01(ds.wealth)) : '#22242c'; break;
      case 'ecology': base = mix('#4a3a2a', '#3f8a4a', soil); break;
      default: {
        base = DISTRICT_PALETTE[owner % DISTRICT_PALETTE.length] || '#22242c';
        const d = w.districts[owner];
        if (d && d.kind === 'agri') base = mix(base, '#5c8a3a', 0.35 * soil + 0.1);
        if (d && d.kind === 'industry') base = mix(base, '#6a6a70', 0.3);
        if (ds && ds.cul) base = mix(base, CULTURE_COLORS[ds.cul % CULTURE_COLORS.length], 0.18);
      }
    }
    if (flags & 8) base = mix(base, '#3a2a1a', 0.6);
    if (flags & 2) base = mix(base, '#7a5aa8', 0.22);
    return base;
  }
  drawPlots(st) {
    const { ctx } = this; const w = this.world; const t = st.time;
    for (let i = 0; i < this.polys.length; i++) {
      const poly = this.polys[i];
      ctx.fillStyle = this.plotFill(st, i);
      pathPoly(ctx, poly); ctx.fill();
      // ground texture: faint grid for dense wards, rows for fields
      const flags = st.snap.flags[i];
      if (flags & 1) { ctx.save(); ctx.strokeStyle = `rgba(224,90,122,${0.35 + 0.2 * Math.sin(t * 2 + i)})`; ctx.lineWidth = 1.2; hatch(ctx, poly, 14); ctx.restore(); }
      else if (flags & 8) { ctx.save(); ctx.strokeStyle = 'rgba(120,90,60,0.35)'; ctx.lineWidth = 1; hatch(ctx, poly, 10); ctx.restore(); }
      if (flags & 4 && !(flags & 1)) { ctx.save(); ctx.strokeStyle = 'rgba(224,90,122,0.25)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); pathPoly(ctx, poly); ctx.stroke(); ctx.restore(); }
      if (flags & 2) { ctx.save(); ctx.strokeStyle = `rgba(180,140,232,${0.25 + 0.1 * Math.sin(t + i)})`; ctx.lineWidth = 1.5; pathPoly(ctx, poly); ctx.stroke(); ctx.restore(); }
    }
    // curvature shading: rows further from the middle fall into shadow
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.25, 'rgba(0,0,0,0.05)'); g.addColorStop(0.5, 'rgba(255,240,200,0.05)'); g.addColorStop(0.75, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    // day/night terminator drifting with the rotation
    const ty = ((t * 9) % (WORLD_H * 1.8)) - WORLD_H * 0.4;
    const g2 = ctx.createLinearGradient(0, ty - 160, 0, ty + 160); g2.addColorStop(0, 'rgba(255,240,200,0)'); g2.addColorStop(0.5, 'rgba(255,240,200,0.05)'); g2.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.restore();
  }
  edgeList(owners) {
    const edges = [];
    const w = this.world;
    for (const p of w.plots) {
      const o = owners[p.id];
      const poly = this.polys[p.id];
      if (p.ix + 1 < GRID_COLS && owners[p.id + 1] !== o) edges.push([poly[1], poly[2], o, owners[p.id + 1]]);
      if (p.iy + 1 < GRID_ROWS && owners[p.id + GRID_COLS] !== o) edges.push([poly[3], poly[2], o, owners[p.id + GRID_COLS]]);
    }
    return edges;
  }
  drawBorders(st) {
    const { ctx } = this;
    const edges = this.edgeList(st.snap.owners);
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.2 / Math.sqrt(this.cam.s);
    for (const [a, b, o1, o2] of edges) {
      let col = 'rgba(255,255,255,0.55)';
      if (st.mode === 'control') { const d = st.snap.d[o1 - 1]; const f = d && d.ctrl >= 0 ? this.world.factions[d.ctrl] : null; col = f ? f.color : col; }
      ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  drawLines(st) {
    const { ctx } = this; const w = this.world; const year = st.year; const t = st.time;
    for (const l of w.lines) {
      if (l.built > year) continue;
      let L = l.layers[0]; for (const x of l.layers) if (x.year <= year) L = x;
      const status = year >= l.built ? L.status : 'construction';
      const [a, b] = this.lineEnds(l);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 40];
      const prog = (l.status === 'construction' && year >= l.built) ? Math.max(0.05, l.progress) : (status === 'abandoned' ? Math.max(0.15, l.progress || 0.4) : 1);
      ctx.save();
      if (l.type === 'conduit') {
        ctx.lineWidth = 4; ctx.strokeStyle = status === 'obsolete' ? 'rgba(120,130,150,0.35)' : 'rgba(60,140,200,0.55)';
        if (L.enclosed) { ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(120,130,150,0.5)'; qcurve(ctx, a, mid, b, 1); ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = status === 'obsolete' ? 'rgba(90,110,140,0.4)' : 'rgba(60,140,200,0.7)'; }
        qcurve(ctx, a, mid, b, 1); ctx.stroke();
        if (status === 'active') { ctx.setLineDash([6, 14]); ctx.lineDashOffset = -t * 30; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(140,220,255,0.9)'; qcurve(ctx, a, mid, b, 1); ctx.stroke(); }
        else { ctx.setLineDash([2, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(120,130,150,0.5)'; qcurve(ctx, a, mid, b, 1); ctx.stroke(); }
      } else {
        // transit tunnel
        ctx.lineWidth = 7; ctx.strokeStyle = status === 'active' ? 'rgba(30,34,48,0.9)' : 'rgba(30,34,48,0.6)';
        qcurve(ctx, a, mid, b, 1); ctx.stroke();
        ctx.lineWidth = 3;
        if (status === 'active') { ctx.strokeStyle = 'rgba(190,200,220,0.7)'; qcurve(ctx, a, mid, b, 1); ctx.stroke(); this.transitDots(a, mid, b, t, l.id); }
        else if (status === 'construction') { ctx.strokeStyle = 'rgba(224,194,106,0.8)'; ctx.setLineDash([8, 6]); ctx.lineDashOffset = -t * 10; qcurve(ctx, a, mid, b, prog); ctx.stroke(); }
        else if (status === 'abandoned') { ctx.strokeStyle = 'rgba(110,106,102,0.7)'; ctx.setLineDash([4, 8]); qcurve(ctx, a, mid, b, prog); ctx.stroke(); }
        else if (status === 'converted') { ctx.strokeStyle = 'rgba(240,138,75,0.8)'; ctx.setLineDash([3, 4]); qcurve(ctx, a, mid, b, prog); ctx.stroke(); }
      }
      ctx.restore();
    }
  }
  transitDots(a, m, b, t, seed) {
    const { ctx } = this;
    for (let k = 0; k < 3; k++) {
      const u = ((t * 0.12 + k / 3 + (seed % 7) / 7) % 1);
      const pt = qpoint(a, m, b, u);
      ctx.fillStyle = '#fff4d0'; ctx.shadowColor = '#fff4d0'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(pt[0], pt[1], 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
  drawStructures(st) {
    const { ctx } = this; const w = this.world; const year = st.year; const t = st.time;
    const px = this.cam.s * 28;
    const lod = px < 3.5 ? 0 : px < 9 ? 1 : 2;
    const archAlpha = st.arch ? 0.4 : 1;
    for (const s of w.structures) {
      if (s.built > year || (s.removed !== null && s.removed <= year)) continue;
      const L = structAt(s, year);
      if (L.status === 'demolished') continue;
      const sp = this.slotPos[s.plot][s.slot];
      const under = year - s.built < 2;
      ctx.save();
      const dead = L.status === 'ruin' || L.status === 'abandoned' || L.status === 'obsolete';
      ctx.globalAlpha = (dead ? 0.7 : 1) * (st.arch && !dead ? archAlpha : 1);
      if (lod === 0) {
        ctx.fillStyle = CAT_COLOR[STRUCT[L.type].cat] || '#ccc'; ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.size * 0.35, 0, Math.PI * 2); ctx.fill();
      } else {
        drawGlyph(ctx, L.type, L.status, L.addon, sp.x, sp.y, sp.size, t, s.id, lod, under);
      }
      ctx.restore();
    }
  }
  drawArchaeologyUnder(st) {
    // previous district boundaries, coloured by age
    const { ctx } = this; const years = [];
    const y = st.year;
    for (const dy of [160, 100, 50]) if (y - dy >= 1) years.push(y - dy);
    if (!years.includes(1)) years.unshift(1);
    const hist = st.history;
    ctx.save(); ctx.lineCap = 'round';
    years.forEach((yy, i) => {
      const snap = hist.get(yy); if (!snap || snap.year === y) return;
      const edges = this.edgeList(snap.owners);
      const cur = new Set(this.edgeList(st.snap.owners).map(e => e[0][0] + ',' + e[0][1] + ',' + e[1][0] + ',' + e[1][1]));
      ctx.strokeStyle = `hsla(${30 + i * 40}, 70%, 65%, 0.75)`; ctx.lineWidth = 1.6 / Math.sqrt(this.cam.s); ctx.setLineDash([5, 6]);
      for (const [a, b] of edges) { if (cur.has(a[0] + ',' + a[1] + ',' + b[0] + ',' + b[1])) continue; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    });
    ctx.restore();
    // scars: barricade lines that never became structures
    for (let i = 0; i < this.polys.length; i++) if (st.snap.flags[i] & 16) { ctx.save(); ctx.strokeStyle = 'rgba(192,69,63,0.8)'; ctx.lineWidth = 3; ctx.setLineDash([6, 3]); pathPoly(ctx, this.polys[i]); ctx.stroke(); ctx.restore(); }
  }
  drawArchaeologyOver(st) {
    const { ctx } = this; const w = this.world; const year = st.year;
    const px = this.cam.s * 28; if (px < 3.5) return;
    for (const s of w.structures) {
      if (s.built > year) continue;
      const L = structAt(s, year);
      const sp = this.slotPos[s.plot][s.slot];
      // earlier incarnations show through
      const earlier = s.layers.filter(l => l.year <= year && l.type !== L.type);
      if (earlier.length) {
        const first = earlier[0];
        ctx.save(); ctx.globalAlpha = 0.85; ctx.setLineDash([2, 2]);
        ctx.strokeStyle = CAT_COLOR[STRUCT[first.type].cat] || '#fff'; ctx.lineWidth = 1.2;
        ghostGlyph(ctx, first.type, sp.x, sp.y, sp.size * 1.25);
        ctx.restore();
      }
      if (s.removed !== null && s.removed <= year) { ctx.save(); ctx.globalAlpha = 0.6; ctx.setLineDash([2, 3]); ctx.strokeStyle = '#8a857f'; ctx.lineWidth = 1; ghostGlyph(ctx, s.origType, sp.x, sp.y, sp.size); ctx.restore(); }
      if (L.status === 'ruin' || L.status === 'abandoned' || L.status === 'obsolete') { ctx.save(); ctx.strokeStyle = 'rgba(224,194,106,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.size * 0.9, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    }
  }
  drawSelection(st) {
    const sel = st.selection; if (!sel) return;
    const { ctx } = this; const w = this.world;
    ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 12; ctx.lineWidth = 2 / Math.sqrt(this.cam.s);
    if (sel.kind === 'plot' || sel.kind === 'district') {
      const owners = st.snap.owners;
      const ids = sel.kind === 'plot' ? [sel.id] : w.plots.filter(p => owners[p.id] - 1 === sel.id).map(p => p.id);
      for (const id of ids) { pathPoly(ctx, this.polys[id]); ctx.stroke(); }
    } else if (sel.kind === 'structure') {
      const s = w.structures.find(x => x.id === sel.id); if (s) { const sp = this.slotPos[s.plot][s.slot]; ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.size * 1.1, 0, Math.PI * 2); ctx.stroke(); }
    } else if (sel.kind === 'line') {
      const l = w.lines.find(x => x.id === sel.id); if (l) { const [a, b] = this.lineEnds(l); ctx.lineWidth = 10; ctx.globalAlpha = 0.35; qcurve(ctx, a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 40], b, 1); ctx.stroke(); }
    }
    ctx.restore();
  }
  drawLabels(st) {
    const { ctx } = this; const w = this.world; const snap = st.snap;
    if (this.labelCache.year !== st.year || this.labelCache.owners !== snap.owners) {
      const acc = {};
      for (const p of w.plots) { const o = snap.owners[p.id] - 1; if (o < 0) continue; const c = this.centers[p.id]; (acc[o] = acc[o] || { x: 0, y: 0, n: 0 }); acc[o].x += c[0]; acc[o].y += c[1]; acc[o].n++; }
      this.labelCache = { year: st.year, owners: snap.owners, labels: Object.entries(acc).map(([id, a]) => ({ id: +id, x: a.x / a.n, y: a.y / a.n, n: a.n })) };
    }
    const fs = Math.max(10, Math.min(16, 9 + this.cam.s * 10));
    ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const lb of this.labelCache.labels) {
      const ds = snap.d[lb.id]; if (!ds) continue;
      const [sx, sy] = this.toScreen(lb.x, lb.y);
      if (sx < -100 || sx > this.W + 100 || sy < 0 || sy > this.H) continue;
      if (this.cam.s < 0.28 && lb.n < 4) continue;
      const name = ds.name;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(5,6,12,0.85)'; ctx.fillStyle = ds.ab ? '#7a7a80' : '#f2f2f6';
      ctx.strokeText(name, sx, sy); ctx.fillText(name, sx, sy);
      if (this.cam.s > 0.45) {
        ctx.font = `400 ${fs * 0.72}px Inter, system-ui, sans-serif`;
        const sub = ds.ab ? 'abandoned' : fmt(ds.pop);
        ctx.fillStyle = '#b6bacb'; ctx.strokeText(sub, sx, sy + fs * 0.95); ctx.fillText(sub, sx, sy + fs * 0.95);
        if (st.arch) {
          const d = w.districts[lb.id]; const older = d.names.filter(n => n.year <= st.year && n.name !== name);
          if (older.length) { ctx.font = `italic 400 ${fs * 0.72}px Inter, system-ui, sans-serif`; ctx.fillStyle = '#e0c26a'; const txt = 'formerly ' + older[older.length - 1].name; ctx.strokeText(txt, sx, sy - fs * 0.95); ctx.fillText(txt, sx, sy - fs * 0.95); }
        }
        ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
      }
    }
  }
  drawCrisisVignette(st) {
    const s = st.snap.s; const worst = Math.min(s.foodR, s.waterR, s.energyR);
    if (worst >= 0.85) return;
    const { ctx, W, H } = this; const k = (0.85 - worst) * 1.2 * (0.7 + 0.3 * Math.sin(st.time * 2));
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(224,90,122,0)'); g.addColorStop(1, `rgba(224,90,122,${Math.min(0.35, k)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // ---- export
  snapshotPNG(st) {
    const off = document.createElement('canvas');
    const scale = 2; off.width = (WORLD_W + 2 * CAP + 2 * FRAME + 80) * scale; off.height = (WORLD_H + 2 * FRAME + 120) * scale;
    const r = Object.create(Renderer.prototype);
    Object.assign(r, this, { canvas: off, ctx: off.getContext('2d'), W: off.width / scale, H: off.height / scale, dpr: scale, cam: { x: WORLD_W / 2, y: WORLD_H / 2 + 10, s: 1 }, labelCache: { year: -1 }, portrait: false });
    r.render(Object.assign({}, st, { selection: null }));
    const ctx = off.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.font = '600 22px Inter, system-ui, sans-serif'; ctx.fillStyle = '#e0c26a'; ctx.textAlign = 'left';
    ctx.fillText(`${this.world.name} — Year ${st.year} — seed "${this.world.seed}"`, 24, r.H - 24);
    return off;
  }
}

// ---------------------------------------------------------------- glyphs
function drawGlyph(ctx, type, status, addon, x, y, sz, t, id, lod, under) {
  const def = STRUCT[type]; const cat = def.cat;
  const col = CAT_COLOR[cat] || '#ccc';
  const dead = status === 'ruin' || status === 'abandoned' || status === 'obsolete';
  const fill = dead ? '#4a4a50' : col;
  ctx.lineJoin = 'round';
  if (status === 'ruin') { ctx.setLineDash([2, 2]); ctx.strokeStyle = '#8a857f'; ctx.lineWidth = 1.2; ctx.strokeRect(x - sz * 0.5, y - sz * 0.45, sz, sz * 0.9); ctx.setLineDash([]); ctx.fillStyle = '#3a3836'; ctx.fillRect(x - sz * 0.5, y + sz * 0.1, sz * 0.5, sz * 0.35); ctx.fillRect(x + sz * 0.15, y - sz * 0.45, sz * 0.35, sz * 0.4); return; }
  if (under && lod === 2) { ctx.strokeStyle = 'rgba(224,194,106,0.9)'; ctx.setLineDash([2, 2]); ctx.lineWidth = 1; ctx.strokeRect(x - sz * 0.6, y - sz * 0.6, sz * 1.2, sz * 1.2); ctx.setLineDash([]); }
  switch (type) {
    case 'housing': case 'tower': {
      const h = type === 'tower' ? sz * 1.5 : sz * 0.9, wd = type === 'tower' ? sz * 0.7 : sz;
      ctx.fillStyle = dead ? '#3f3f46' : '#3a3d4c'; ctx.fillRect(x - wd / 2, y - h / 2, wd, h);
      ctx.strokeStyle = fill; ctx.lineWidth = 1; ctx.strokeRect(x - wd / 2, y - h / 2, wd, h);
      if (lod === 2 && !dead) { const cols = type === 'tower' ? 2 : 3, rows = type === 'tower' ? 5 : 3; for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const on = ((id * 7 + i * 13 + j * 31) % 11) / 11 < 0.6 + 0.3 * Math.sin(t * 0.5 + id + j); ctx.fillStyle = on ? 'rgba(255,225,160,0.9)' : 'rgba(255,225,160,0.15)'; ctx.fillRect(x - wd / 2 + wd * (i + 0.25) / cols, y - h / 2 + h * (j + 0.25) / rows, wd / cols * 0.5, h / rows * 0.4); } }
      if (addon === 'rooftop') { ctx.fillStyle = '#7fc46a'; ctx.fillRect(x - wd / 2, y - h / 2 - sz * 0.18, wd, sz * 0.16); ctx.strokeStyle = '#4a8a3a'; ctx.lineWidth = 0.8; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x - wd / 2 + wd * i / 4, y - h / 2 - sz * 0.18); ctx.lineTo(x - wd / 2 + wd * i / 4, y - h / 2 - 0.02 * sz); ctx.stroke(); } }
      break;
    }
    case 'farm': { ctx.fillStyle = dead ? '#4a4638' : '#3f6f34'; ctx.fillRect(x - sz * 0.6, y - sz * 0.45, sz * 1.2, sz * 0.9); if (lod === 2) { ctx.strokeStyle = dead ? '#5a5648' : '#8fd070'; ctx.lineWidth = 1; for (let i = 0; i < 4; i++) { const yy = y - sz * 0.35 + i * sz * 0.24; ctx.beginPath(); ctx.moveTo(x - sz * 0.55, yy); ctx.lineTo(x + sz * 0.55, yy); ctx.stroke(); } } break; }
    case 'hydroponic': { ctx.fillStyle = dead ? '#3a4a48' : '#1f4f4a'; ctx.fillRect(x - sz * 0.55, y - sz * 0.55, sz * 1.1, sz * 1.1); if (lod === 2) { ctx.strokeStyle = `rgba(110,240,190,${dead ? 0.3 : 0.6 + 0.3 * Math.sin(t * 2 + id)})`; ctx.lineWidth = 1.2; for (let i = 0; i < 3; i++) { const yy = y - sz * 0.35 + i * sz * 0.35; ctx.beginPath(); ctx.moveTo(x - sz * 0.45, yy); ctx.lineTo(x + sz * 0.45, yy); ctx.stroke(); } } break; }
    case 'waterplant': case 'recycler': { ctx.fillStyle = dead ? '#3a4048' : '#1e4a68'; ctx.beginPath(); ctx.arc(x, y, sz * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = fill; ctx.lineWidth = 1.5; ctx.stroke(); if (lod === 2) { ctx.strokeStyle = dead ? '#666' : '#9fe3ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, sz * 0.3, t * (type === 'recycler' ? 2 : 1), t * (type === 'recycler' ? 2 : 1) + Math.PI * 1.3); ctx.stroke(); } if (addon === 'enclosed') { ctx.strokeStyle = '#8a8f9a'; ctx.lineWidth = 2; ctx.strokeRect(x - sz * 0.7, y - sz * 0.7, sz * 1.4, sz * 1.4); } break; }
    case 'reservoir': { ctx.fillStyle = dead ? '#3a4048' : '#2a6a9a'; ctx.beginPath(); ctx.ellipse(x, y, sz * 0.65, sz * 0.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = fill; ctx.lineWidth = 1; ctx.stroke(); if (!dead && lod === 2) { ctx.strokeStyle = 'rgba(160,230,255,0.6)'; ctx.beginPath(); ctx.ellipse(x, y, sz * 0.4, sz * 0.2, 0, Math.PI * 1.1 + Math.sin(t) * 0.2, Math.PI * 1.9); ctx.stroke(); } if (addon === 'enclosed') { ctx.strokeStyle = '#8a8f9a'; ctx.lineWidth = 2; ctx.strokeRect(x - sz * 0.75, y - sz * 0.55, sz * 1.5, sz * 1.1); } break; }
    case 'fission': { poly(ctx, x, y, sz * 0.62, 8, 0); ctx.fillStyle = dead ? '#4a4638' : '#5a4a20'; ctx.fill(); ctx.strokeStyle = fill; ctx.lineWidth = 1.5; ctx.stroke(); if (lod === 2) { ctx.fillStyle = dead ? '#777' : '#f0c050'; ctx.beginPath(); ctx.arc(x, y, sz * 0.18, 0, Math.PI * 2); ctx.fill(); } break; }
    case 'solar': { ctx.strokeStyle = dead ? '#666' : '#f5d878'; ctx.lineWidth = 2; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x - sz * 0.5, y + i * sz * 0.3 + sz * 0.15); ctx.lineTo(x + sz * 0.5, y + i * sz * 0.3 - sz * 0.15); ctx.stroke(); } break; }
    case 'fusion': { const p = 0.7 + 0.3 * Math.sin(t * 3); ctx.fillStyle = dead ? '#3a4048' : '#1a3a48'; ctx.beginPath(); ctx.arc(x, y, sz * 0.7, 0, Math.PI * 2); ctx.fill(); if (!dead) { ctx.shadowColor = '#9fe3ff'; ctx.shadowBlur = 14 * p; ctx.fillStyle = `rgba(200,245,255,${p})`; ctx.beginPath(); ctx.arc(x, y, sz * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; } ctx.strokeStyle = fill; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, sz * 0.7, 0, Math.PI * 2); ctx.stroke(); break; }
    case 'factory': case 'fabricator': { ctx.fillStyle = dead ? '#3f3f44' : '#4a4d58'; ctx.fillRect(x - sz * 0.6, y - sz * 0.3, sz * 1.2, sz * 0.75); ctx.fillStyle = dead ? '#555' : '#6a6e7a'; ctx.fillRect(x + sz * 0.25, y - sz * 0.75, sz * 0.2, sz * 0.5); if (type === 'fabricator') ctx.fillRect(x - sz * 0.45, y - sz * 0.75, sz * 0.2, sz * 0.5); if (lod === 2 && !dead) { ctx.fillStyle = `rgba(200,200,210,${0.15 + 0.1 * Math.sin(t * 1.5 + id)})`; ctx.beginPath(); ctx.arc(x + sz * 0.35, y - sz * 0.9 - (t * 6 + id) % 8, sz * 0.15, 0, Math.PI * 2); ctx.fill(); } break; }
    case 'market': { ctx.fillStyle = dead ? '#4a3f38' : '#8a4a20'; ctx.fillRect(x - sz * 0.6, y - sz * 0.2, sz * 1.2, sz * 0.5); ctx.fillStyle = dead ? '#666' : '#f08a4b'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x - sz * 0.4 + i * sz * 0.4, y - sz * 0.2, sz * 0.2, Math.PI, 0); ctx.fill(); } if (lod === 2 && !dead) { ctx.fillStyle = 'rgba(255,220,160,0.8)'; for (let k = 0; k < 3; k++) { const u = (t * 0.4 + k / 3 + id % 5 / 5) % 1; ctx.beginPath(); ctx.arc(x - sz * 0.5 + u * sz, y + sz * 0.42, 1.2, 0, Math.PI * 2); ctx.fill(); } } break; }
    case 'civic': case 'museum': { ctx.fillStyle = dead ? '#444' : (type === 'museum' ? '#6a5a30' : '#5a5a68'); ctx.fillRect(x - sz * 0.6, y - sz * 0.35, sz * 1.2, sz * 0.8); ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(x - sz * 0.7, y - sz * 0.35); ctx.lineTo(x, y - sz * 0.75); ctx.lineTo(x + sz * 0.7, y - sz * 0.35); ctx.closePath(); ctx.fill(); if (lod === 2) { ctx.strokeStyle = fill; ctx.lineWidth = 1.2; for (let i = 0; i < 4; i++) { const xx = x - sz * 0.45 + i * sz * 0.3; ctx.beginPath(); ctx.moveTo(xx, y - sz * 0.3); ctx.lineTo(xx, y + sz * 0.4); ctx.stroke(); } } break; }
    case 'assembly': { poly(ctx, x, y, sz * 0.62, 6, Math.PI / 6); ctx.fillStyle = dead ? '#444' : '#5a5030'; ctx.fill(); ctx.strokeStyle = '#e0c26a'; ctx.lineWidth = 1.5; ctx.stroke(); if (lod === 2) { ctx.fillStyle = '#e0c26a'; ctx.beginPath(); ctx.arc(x, y, sz * 0.15, 0, Math.PI * 2); ctx.fill(); } break; }
    case 'garrison': { ctx.fillStyle = dead ? '#444' : '#4a2a2a'; ctx.fillRect(x - sz * 0.55, y - sz * 0.55, sz * 1.1, sz * 1.1); ctx.strokeStyle = '#c0453f'; ctx.lineWidth = 2; ctx.strokeRect(x - sz * 0.55, y - sz * 0.55, sz * 1.1, sz * 1.1); if (lod === 2) { ctx.beginPath(); ctx.moveTo(x - sz * 0.3, y); ctx.lineTo(x + sz * 0.3, y); ctx.moveTo(x, y - sz * 0.3); ctx.lineTo(x, y + sz * 0.3); ctx.stroke(); } break; }
    case 'school': { ctx.fillStyle = dead ? '#444' : '#2a5a50'; ctx.beginPath(); ctx.moveTo(x, y - sz * 0.6); ctx.lineTo(x + sz * 0.6, y + sz * 0.45); ctx.lineTo(x - sz * 0.6, y + sz * 0.45); ctx.closePath(); ctx.fill(); ctx.strokeStyle = fill; ctx.lineWidth = 1.2; ctx.stroke(); break; }
    case 'academy': { poly(ctx, x, y, sz * 0.65, 6, 0); ctx.fillStyle = dead ? '#444' : '#2a5a50'; ctx.fill(); ctx.strokeStyle = fill; ctx.lineWidth = 1.5; ctx.stroke(); if (lod === 2) { poly(ctx, x, y, sz * 0.3, 6, 0); ctx.stroke(); } break; }
    case 'clinic': case 'hospital': { const k = type === 'hospital' ? 1.25 : 0.95; ctx.fillStyle = dead ? '#444' : '#e8e8ee'; ctx.fillRect(x - sz * 0.5 * k, y - sz * 0.45 * k, sz * k, sz * 0.9 * k); ctx.fillStyle = dead ? '#666' : '#e05a7a'; ctx.fillRect(x - sz * 0.1, y - sz * 0.3 * k, sz * 0.2, sz * 0.6 * k); ctx.fillRect(x - sz * 0.3 * k, y - sz * 0.1, sz * 0.6 * k, sz * 0.2); break; }
    case 'temple': { const sacred = status === 'sacred'; if (sacred && lod === 2) { ctx.shadowColor = '#b48ce8'; ctx.shadowBlur = 10 + 4 * Math.sin(t + id); } ctx.fillStyle = dead ? '#444' : '#4a3a6a'; ctx.fillRect(x - sz * 0.5, y - sz * 0.1, sz, sz * 0.6); ctx.fillStyle = '#b48ce8'; ctx.beginPath(); ctx.moveTo(x, y - sz * 0.95); ctx.lineTo(x + sz * 0.35, y - sz * 0.1); ctx.lineTo(x - sz * 0.35, y - sz * 0.1); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; break; }
    case 'park': { ctx.fillStyle = dead ? '#3a3f38' : '#2f6a3a'; ctx.beginPath(); ctx.arc(x, y, sz * 0.6, 0, Math.PI * 2); ctx.fill(); if (lod === 2) { ctx.fillStyle = '#7fc46a'; for (let i = 0; i < 3; i++) { const a = i * 2.1 + t * 0.1; ctx.beginPath(); ctx.arc(x + Math.cos(a) * sz * 0.3, y + Math.sin(a) * sz * 0.3, sz * 0.15, 0, Math.PI * 2); ctx.fill(); } } break; }
    case 'memorial': { ctx.fillStyle = '#f2f2f6'; ctx.fillRect(x - sz * 0.08, y - sz * 0.8, sz * 0.16, sz * 1.2); ctx.fillStyle = '#9a9aa8'; ctx.fillRect(x - sz * 0.35, y + sz * 0.35, sz * 0.7, sz * 0.12); break; }
    case 'station': { ctx.fillStyle = dead ? '#444' : '#2a2f40'; ctx.fillRect(x - sz * 0.5, y - sz * 0.3, sz, sz * 0.6); ctx.strokeStyle = '#c0c8d8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, sz * 0.22, 0, Math.PI * 2); ctx.stroke(); break; }
    case 'barricade': case 'wall': { ctx.strokeStyle = type === 'wall' ? '#8a8f9a' : '#c0453f'; ctx.lineWidth = type === 'wall' ? 4 : 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - sz * 0.7, y + sz * 0.5); ctx.lineTo(x + sz * 0.7, y - sz * 0.5); ctx.stroke(); if (type === 'barricade' && lod === 2) { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - sz * 0.5, y - sz * 0.3); ctx.lineTo(x + sz * 0.5, y + sz * 0.3); ctx.stroke(); } break; }
    case 'hullpatch': { poly(ctx, x, y, sz * 0.6, 8, Math.PI / 8); ctx.fillStyle = '#3a3f4a'; ctx.fill(); ctx.strokeStyle = '#8a8f9a'; ctx.lineWidth = 1.5; ctx.stroke(); if (lod === 2) { ctx.fillStyle = '#c0c8d8'; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; ctx.beginPath(); ctx.arc(x + Math.cos(a) * sz * 0.42, y + Math.sin(a) * sz * 0.42, 1.1, 0, Math.PI * 2); ctx.fill(); } } break; }
    case 'rooftop': { ctx.fillStyle = '#7fc46a'; ctx.fillRect(x - sz * 0.5, y - sz * 0.3, sz, sz * 0.6); break; }
    case 'conduit': case 'tunnel': case 'ruin': default: { ctx.fillStyle = fill; ctx.fillRect(x - sz * 0.4, y - sz * 0.4, sz * 0.8, sz * 0.8); }
  }
  if (status === 'damaged') { ctx.strokeStyle = `rgba(255,140,60,${0.6 + 0.4 * Math.sin(t * 6 + id)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - sz * 0.4, y - sz * 0.5); ctx.lineTo(x - sz * 0.1, y - sz * 0.1); ctx.lineTo(x + sz * 0.1, y + sz * 0.05); ctx.lineTo(x + sz * 0.4, y + sz * 0.5); ctx.stroke(); }
  if (status === 'fortified') { ctx.strokeStyle = '#c0453f'; ctx.lineWidth = 2; ctx.strokeRect(x - sz * 0.8, y - sz * 0.8, sz * 1.6, sz * 1.6); }
  if (status === 'abandoned' && lod === 2) { ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - sz * 0.6, y - sz * 0.6); ctx.lineTo(x + sz * 0.6, y + sz * 0.6); ctx.moveTo(x + sz * 0.6, y - sz * 0.6); ctx.lineTo(x - sz * 0.6, y + sz * 0.6); ctx.stroke(); }
}
function ghostGlyph(ctx, type, x, y, sz) {
  const cat = STRUCT[type].cat;
  if (cat === 'water' || cat === 'energy' || type === 'park') { ctx.beginPath(); ctx.arc(x, y, sz * 0.6, 0, Math.PI * 2); ctx.stroke(); }
  else if (cat === 'civic' || cat === 'culture') { poly(ctx, x, y, sz * 0.65, 6, 0); ctx.stroke(); }
  else if (cat === 'food') { ctx.strokeRect(x - sz * 0.65, y - sz * 0.5, sz * 1.3, sz); }
  else ctx.strokeRect(x - sz * 0.55, y - sz * 0.55, sz * 1.1, sz * 1.1);
}

// ---------------------------------------------------------------- geometry helpers
function pathPoly(ctx, poly) { ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]); ctx.closePath(); }
function poly(ctx, x, y, r, n, rot) { ctx.beginPath(); for (let i = 0; i < n; i++) { const a = rot + i * Math.PI * 2 / n; if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); }
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function hatch(ctx, poly, step) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  ctx.save(); pathPoly(ctx, poly); ctx.clip(); ctx.beginPath();
  for (let x = x0 - (y1 - y0); x < x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x + (y1 - y0), y1); }
  ctx.stroke(); ctx.restore();
}
function qcurve(ctx, a, m, b, frac) {
  ctx.beginPath(); ctx.moveTo(a[0], a[1]);
  if (frac >= 1) { ctx.quadraticCurveTo(m[0], m[1], b[0], b[1]); return; }
  const n = 16; for (let i = 1; i <= n; i++) { const p = qpoint(a, m, b, frac * i / n); ctx.lineTo(p[0], p[1]); }
}
function qpoint(a, m, b, u) { const v = 1 - u; return [v * v * a[0] + 2 * v * u * m[0] + u * u * b[0], v * v * a[1] + 2 * v * u * m[1] + u * u * b[1]]; }
function pointInPoly(x, y, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside; } return inside; }
function distSeg(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1; let u = ((px - ax) * dx + (py - ay) * dy) / l2; u = Math.max(0, Math.min(1, u)); return Math.hypot(px - (ax + u * dx), py - (ay + u * dy)); }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function hex(c) { if (c[0] === '#') { const h = c.slice(1); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; } const m = c.match(/\d+/g); return [+m[0], +m[1], +m[2]]; }
export function mix(a, b, k) { const A = hex(a), B = hex(b); return `rgb(${Math.round(A[0] + (B[0] - A[0]) * k)},${Math.round(A[1] + (B[1] - A[1]) * k)},${Math.round(A[2] + (B[2] - A[2]) * k)})`; }
export function fmt(n) { return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)); }
