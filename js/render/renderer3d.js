// Presentation only: all dated state comes from snapshots and structure layers.
import * as T from 'three';
import { OrbitControls } from '../../vendor/OrbitControls.js';
import { WORLD_W as L, WORLD_H as H, STRUCT } from '../sim/defs.js';
import { structAt } from '../sim/sim.js';
import { RNG } from '../rng.js';
import { Renderer } from './renderer.js';
const R = H / (2 * Math.PI);
const COLORS = {
  housing: '#d8c9a8',
  food: '#7fc46a',
  water: '#5cc8e8',
  energy: '#f0c050',
  industry: '#a0a4b0',
  commerce: '#f08a4b',
  civic: '#f2ecd8',
  education: '#5ee0b0',
  health: '#ffffff',
  culture: '#b48ce8',
  transit: '#c0c8d8',
  military: '#c0453f',
  ruin: '#6e6a66',
};
const shape = (type) =>
  /farm|solar|rooftop|wall|barricade|hullpatch/.test(type)
    ? 'flat'
    : /water|reservoir|recycler|fission|station/.test(type)
      ? 'cyl'
      : /temple|school|memorial/.test(type)
        ? 'cone'
        : /fusion|park/.test(type)
          ? 'sphere'
          : 'box';
export const cylinderPoint = (x, y, height = 0) =>
  new T.Vector3(x - L / 2, (R - height) * Math.cos(y / R), (R - height) * Math.sin(y / R));
function dispose(group) {
  const geometries = new Set(),
    materials = new Set();
  group.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) materials.add(o.material);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  group.clear();
}
export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.is3D = true;
    this.gl = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.gl.localClippingEnabled = true;
    this.scene = new T.Scene();
    this.scene.background = new T.Color('#05060c');
    this.root = new T.Group();
    this.scene.add(this.root);
    this.static = new T.Group();
    this.dynamic = new T.Group();
    this.root.add(this.static, this.dynamic);
    this.camera = new T.PerspectiveCamera(38, 1, 1, 20000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 100;
    this.controls.maxDistance = 5000;
    this.scene.add(new T.AmbientLight(0xb8c8ef, 1.7));
    this.light = new T.DirectionalLight(0xffe4b5, 2.5);
    this.scene.add(this.light);
    this.clip = new T.Plane(new T.Vector3(0, 0, -1), 0);
    this.insets = { top: 60, bottom: 130, left: 0, right: 0 };
    this.labels = document.getElementById('labels');
    this.ctx = this.labels.getContext('2d');
    this.ray = new T.Raycaster();
    this.units = [];
    this.pickables = [];
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(16, 16, 10, 0, Math.PI * 2);
    ctx.fill();
    this.unitTexture = new T.CanvasTexture(c);
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.resize();
    this.fit();
  }
  material(options = {}) {
    return new T.MeshStandardMaterial({ roughness: 0.85, clippingPlanes: [this.clip], ...options });
  }
  resize() {
    const b = this.canvas.getBoundingClientRect();
    this.W = Math.max(1, b.width);
    this.H = Math.max(1, b.height);
    this.gl.setSize(this.W, this.H, false);
    this.camera.aspect = this.W / this.H;
    this.camera.updateProjectionMatrix();
    const dpr = this.gl.getPixelRatio();
    this.labels.width = this.W * dpr;
    this.labels.height = this.H * dpr;
    this.portrait = this.H > this.W * 1.15;
    this.root.rotation.z = this.portrait ? Math.PI / 2 : 0;
  }
  fit() {
    const aw = Math.max(100, this.W - this.insets.left - this.insets.right - 40),
      ah = Math.max(100, this.H - this.insets.top - this.insets.bottom - 40);
    const width = this.portrait ? R * 2.9 : L + 120,
      height = this.portrait ? L + 120 : R * 3.2;
    const tan = Math.tan(T.MathUtils.degToRad(this.camera.fov / 2));
    const distance =
      Math.max(width / ((aw / this.W) * this.camera.aspect), height / (ah / this.H)) / (2 * tan) + R;
    const scale = (2 * distance * tan) / this.H;
    this.controls.target.set(
      ((this.insets.right - this.insets.left) * scale) / 2,
      ((this.insets.top - this.insets.bottom) * scale) / 2,
      0,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.position
      .copy(this.controls.target)
      .add(new T.Vector3(this.portrait ? 180 : 100, 80, distance));
    this.controls.update();
  }
  setWorld(world) {
    this.world = world;
    dispose(this.static);
    dispose(this.dynamic);
    this.key = null;
    this.polys = world.plots.map((p) => p.v.map((i) => world.verts[i]));
    this.centers = this.polys.map((p) => [
      p.reduce((s, v) => s + v[0], 0) / 4,
      p.reduce((s, v) => s + v[1], 0) / 4,
    ]);
    this.slots = this.polys.map((p) =>
      [
        [0.27, 0.3],
        [0.73, 0.3],
        [0.27, 0.72],
        [0.73, 0.72],
      ].map(([u, v]) =>
        [0, 1].map(
          (k) => (p[0][k] * (1 - u) + p[1][k] * u) * (1 - v) + (p[3][k] * (1 - u) + p[2][k] * u) * v,
        ),
      ),
    );
    const hull = new T.Mesh(
      new T.CylinderGeometry(R + 3, R + 3, L, 96, 1, true),
      this.material({ color: '#182234', side: T.BackSide }),
    );
    hull.rotation.z = Math.PI / 2;
    this.static.add(hull);
    const sun = new T.Mesh(
      new T.CylinderGeometry(1.4, 1.4, L, 8),
      new T.MeshBasicMaterial({ color: '#fff2be' }),
    );
    sun.rotation.z = Math.PI / 2;
    this.static.add(sun);
    this.spokes = [];
    for (const x of [-L / 2, L / 2]) {
      const g = new T.Group();
      g.position.x = x;
      const pts = [];
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        pts.push(new T.Vector3(0, 0, 0), new T.Vector3(0, R * Math.cos(a), R * Math.sin(a)));
      }
      const lines = new T.LineSegments(
        new T.BufferGeometry().setFromPoints(pts),
        new T.LineBasicMaterial({ color: '#63738f', transparent: true, opacity: 0.6 }),
      );
      g.add(lines);
      this.static.add(g);
      this.spokes.push(g);
      const ring = new T.Mesh(
        new T.TorusGeometry(R + 3, 2.2, 6, 96),
        new T.MeshBasicMaterial({ color: '#64748e' }),
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.x = x;
      this.static.add(ring);
    }
    if (this.stars) {
      this.scene.remove(this.stars);
      this.stars.geometry.dispose();
      this.stars.material.dispose();
    }
    const rng = new RNG(`stars:${world.seed}`),
      pts = [];
    for (let i = 0; i < 700; i++)
      pts.push(new T.Vector3(rng.float(-6000, 6000), rng.float(-6000, 6000), rng.float(-5000, -2500)));
    this.stars = new T.Points(
      new T.BufferGeometry().setFromPoints(pts),
      new T.PointsMaterial({ color: '#a3b2d2', size: 2, sizeAttenuation: false }),
    );
    this.scene.add(this.stars);
  }
  // Curved interpolation prevents long edges and tubes from cutting through the tube.
  path(a, b, height = 2) {
    return Array.from({ length: 17 }, (_, i) =>
      cylinderPoint(a[0] + ((b[0] - a[0]) * i) / 16, a[1] + ((b[1] - a[1]) * i) / 16, height),
    );
  }
  borders(owners, dashed = false, current = null) {
    const edges = Renderer.prototype.edgeList.call(this, owners),
      pts = [];
    const keys =
      current &&
      new Set(Renderer.prototype.edgeList.call(this, current).map((e) => JSON.stringify(e.slice(0, 2))));
    for (const [a, b] of edges) {
      if (keys?.has(JSON.stringify([a, b]))) continue;
      const p = this.path(a, b, dashed ? 3 : 1.5);
      for (let i = 1; i < p.length; i++) pts.push(p[i - 1], p[i]);
    }
    const mat = dashed
      ? new T.LineDashedMaterial({
          color: '#edbc7b',
          dashSize: 5,
          gapSize: 4,
          transparent: true,
          opacity: 0.8,
          clippingPlanes: [this.clip],
        })
      : new T.LineBasicMaterial({
          color: '#a7b8d0',
          transparent: true,
          opacity: 0.5,
          clippingPlanes: [this.clip],
        });
    const lines = new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), mat);
    lines.computeLineDistances();
    this.dynamic.add(lines);
  }
  rebuild(st) {
    dispose(this.dynamic);
    this.units = [];
    this.pickables = [];
    const positions = [],
      colors = [];
    this.facePlots = [];
    for (const p of this.world.plots) {
      const poly = this.polys[p.id],
        col = new T.Color(Renderer.prototype.plotFill.call(this, st, p.id));
      if (st.selection?.kind === 'district' && st.snap.owners[p.id] === st.selection.id + 1)
        col.multiplyScalar(1.7);
      const point = (u, v) =>
        cylinderPoint(
          (poly[0][0] * (1 - u) + poly[1][0] * u) * (1 - v) + (poly[3][0] * (1 - u) + poly[2][0] * u) * v,
          (poly[0][1] * (1 - u) + poly[1][1] * u) * (1 - v) + (poly[3][1] * (1 - u) + poly[2][1] * u) * v,
        );
      for (let j = 0; j < 4; j++) {
        const a = point(0, j / 4),
          b = point(1, j / 4),
          c = point(1, (j + 1) / 4),
          d = point(0, (j + 1) / 4);
        for (const v of [a, b, c, a, c, d]) {
          positions.push(...v);
          colors.push(col.r, col.g, col.b);
        }
        this.facePlots.push(p.id, p.id);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const plots = new T.Mesh(geo, this.material({ vertexColors: true, side: T.DoubleSide }));
    plots.userData.kind = 'plot';
    this.dynamic.add(plots);
    this.pickables.push(plots);
    this.borders(st.snap.owners);
    if (st.arch && st.history)
      for (const year of [...new Set([1, st.year - 50, st.year - 100, st.year - 160])].filter(
        (y) => y >= 1 && y < st.year,
      ))
        this.borders(st.history.get(year).owners, true, st.snap.owners);
    const geometries = {
      box: new T.BoxGeometry(1, 1, 1),
      flat: new T.BoxGeometry(1, 1, 1),
      cyl: new T.CylinderGeometry(0.5, 0.5, 1, 12),
      cone: new T.ConeGeometry(0.5, 1, 8),
      sphere: new T.SphereGeometry(0.5, 12, 8),
    };
    const groups = Object.fromEntries(Object.keys(geometries).map((k) => [k, []]));
    const active = [];
    for (const s of this.world.structures) {
      if (s.built > st.year) continue;
      const layer = structAt(s, st.year),
        removed = s.removed !== null && s.removed <= st.year;
      if (!removed) {
        groups[shape(layer.type)].push({ s, layer });
        active.push({ s, layer });
      }
      if (st.arch) {
        const types = new Set(
          s.layers.filter((l) => l.year <= st.year && (removed || l.type !== layer.type)).map((l) => l.type),
        );
        for (const type of types) {
          const ghost = new T.Mesh(
            geometries[shape(type)].clone(),
            this.material({
              color: COLORS[STRUCT[type].cat],
              wireframe: true,
              transparent: true,
              opacity: 0.65,
            }),
          );
          this.place(ghost, s, type, 1.12);
          this.dynamic.add(ghost);
        }
      }
    }
    for (const [kind, items] of Object.entries(groups)) {
      if (!items.length) {
        geometries[kind].dispose();
        continue;
      }
      const mesh = new T.InstancedMesh(
        geometries[kind],
        this.material({ transparent: st.arch, opacity: st.arch ? 0.4 : 1 }),
        items.length,
      );
      mesh.userData = { kind: 'structure', ids: items.map((i) => i.s.id) };
      const dummy = new T.Object3D();
      items.forEach(({ s, layer }, i) => {
        this.place(dummy, s, layer.type);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        let color = COLORS[STRUCT[layer.type].cat];
        if (['abandoned', 'ruin', 'obsolete'].includes(layer.status)) color = '#68616b';
        if (layer.status === 'damaged') color = '#e58b57';
        if (layer.status === 'construction') color = '#58667c';
        if (st.selection?.kind === 'structure' && st.selection.id === s.id) color = '#ffffff';
        mesh.setColorAt(i, new T.Color(color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.dynamic.add(mesh);
      this.pickables.push(mesh);
    }
    this.districtCenters = st.snap.d.map((_, id) => {
      const ids = this.world.plots.filter((p) => st.snap.owners[p.id] === id + 1).map((p) => p.id);
      return ids.length
        ? ids.reduce(
            (a, i) => [a[0] + this.centers[i][0] / ids.length, a[1] + this.centers[i][1] / ids.length],
            [0, 0],
          )
        : null;
    });
    for (const l of this.world.lines) {
      if (l.built > st.year) continue;
      const layer = l.layers.filter((x) => x.year <= st.year).at(-1);
      if (!layer) continue;
      const a = this.districtCenters[l.from],
        b = this.districtCenters[l.to];
      if (!a || !b) continue;
      const curve = new T.CatmullRomCurve3(this.path(a, b, 5));
      const mesh = new T.Mesh(
        new T.TubeGeometry(curve, 32, l.type === 'tunnel' ? 2 : 1.2, 5, false),
        this.material({
          color: ['obsolete', 'abandoned'].includes(layer.status)
            ? '#555d6b'
            : l.type === 'tunnel'
              ? '#a3b6d1'
              : '#4296c8',
        }),
      );
      mesh.userData = { kind: 'line', id: l.id };
      this.dynamic.add(mesh);
      this.pickables.push(mesh);
      if (!['obsolete', 'abandoned', 'construction'].includes(layer.status))
        this.addUnit(
          {
            id: `line-${l.id}`,
            type: l.type === 'tunnel' ? 'Transit pod' : 'Water flow',
            district: l.from,
            curve,
            phase: 0.2,
          },
          l.type === 'tunnel' ? '#ffffff' : '#65d8ff',
        );
    }
    const rng = new RNG(`units:${this.world.seed}:${st.year}`);
    st.snap.d.forEach((ds, did) => {
      const buildings = active.filter(({ s }) => st.snap.owners[s.plot] === did + 1);
      if (!buildings.length || ds.ab) return;
      const homes = buildings.filter(({ layer }) => STRUCT[layer.type].cat === 'housing');
      const count = Math.min(
        35,
        Math.round(
          (240 * ds.pop) /
            Math.max(
              1,
              st.snap.d.reduce((sum, d) => sum + d.pop, 0),
            ),
        ),
      );
      for (let i = 0; i < count; i++) {
        const home = rng.pick(homes.length ? homes : buildings),
          work = rng.pick(buildings);
        const cohort = rng.weighted(st.snap.cohorts, (c) => c.share);
        this.addUnit(
          {
            id: `citizen-${did}-${i}`,
            type: ds.unrest > 0.5 ? 'Protester' : 'Citizen',
            name: `${rng.pick(['Ari', 'Mira', 'Ren', 'Sol', 'Ira', 'Tavi', 'Neri', 'Lio'])} ${rng.pick(['Vale', 'Chen', 'Okoro', 'Sen', 'Reyes', 'Noor', 'Park', 'Dara'])}`,
            district: did,
            cohort,
            home: home.s.id,
            work: work.s.id,
            a: this.slots[home.s.plot][home.s.slot],
            b: this.slots[work.s.plot][work.s.slot],
            phase: rng.next(),
            year: st.year,
          },
          ds.unrest > 0.5 ? '#ff799a' : '#ffdf9b',
        );
      }
    });
    for (const { s, layer } of active.filter((x) => x.layer.status === 'damaged').slice(0, 24))
      this.addUnit(
        {
          id: `repair-${s.id}`,
          type: 'Repair drone',
          district: st.snap.owners[s.plot] - 1,
          a: this.slots[s.plot][s.slot],
          b: this.slots[s.plot][s.slot],
          height: 35,
          phase: rng.next(),
        },
        '#73ffdc',
      );
    for (const e of this.world.events
      .filter((e) => e.type === 'migration' && e.year <= st.year && e.year > st.year - 5)
      .slice(-3))
      this.addUnit(
        { id: `ship-${e.id}`, type: 'Migration ship', event: e.id, ship: true, phase: rng.next() },
        '#caacff',
      );
  }
  place(obj, s, type, mult = 1) {
    const [x, y] = this.slots[s.plot][s.slot],
      kind = shape(type),
      height = (kind === 'flat' ? 3 : type === 'tower' ? 32 : kind === 'cone' ? 23 : 15) * mult;
    obj.position.copy(cylinderPoint(x, y, height / 2));
    obj.quaternion.setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      new T.Vector3(0, -Math.cos(y / R), -Math.sin(y / R)),
    );
    obj.scale.set(22 * mult, height, 18 * mult);
  }
  addUnit(data, color) {
    const sprite = new T.Sprite(
      new T.SpriteMaterial({ map: this.unitTexture, color, depthTest: true, clippingPlanes: [this.clip] }),
    );
    sprite.userData = { kind: 'unit', ...data };
    this.dynamic.add(sprite);
    this.units.push(sprite);
  }
  updateClip() {
    this.root.updateMatrixWorld(true);
    const local = this.root.worldToLocal(this.camera.position.clone());
    local.x = 0;
    if (local.lengthSq() < 1) local.set(0, 0, 1);
    local.normalize().negate();
    this.clip.normal.copy(local).transformDirection(this.root.matrixWorld);
    this.clip.constant = 0;
  }
  visiblePoint(p) {
    const world = this.root.localToWorld(p.clone());
    const screen = world.clone().project(this.camera);
    return this.clip.distanceToPoint(world) >= 0 && screen.z > -1 && screen.z < 1 ? screen : null;
  }
  render(st) {
    if (!this.world || !st.snap) return;
    this.state = st;
    const key = `${st.year}:${st.mode}:${st.arch}:${st.selection?.kind}:${st.selection?.id}`;
    if (this.key !== key || this.lastSnap !== st.snap) {
      this.rebuild(st);
      this.key = key;
      this.lastSnap = st.snap;
    }
    this.controls.update();
    this.updateClip();
    this.light.position.copy(this.camera.position);
    const t = this.reducedMotion.matches ? 0 : st.time;
    this.spokes.forEach((g) => (g.rotation.x = t * 0.025));
    for (const unit of this.units) {
      const u = unit.userData,
        f = (t * 0.065 + u.phase) % 1,
        ping = (1 - Math.cos(f * Math.PI * 2)) / 2;
      if (u.curve) unit.position.copy(u.curve.getPoint(f));
      else if (u.ship) unit.position.set(L / 2 + 45 + Math.sin(f * 6.28) * 20, 35, -40);
      else
        unit.position.copy(
          cylinderPoint(u.a[0] + (u.b[0] - u.a[0]) * ping, u.a[1] + (u.b[1] - u.a[1]) * ping, u.height || 8),
        );
      const world = this.root.localToWorld(unit.position.clone()),
        distance = world.distanceTo(this.camera.position),
        pixel = (2 * distance * Math.tan(T.MathUtils.degToRad(this.camera.fov / 2))) / this.H;
      unit.scale.setScalar(Math.max(u.ship ? 15 : 4, pixel * (u.ship ? 8 : 4)));
      unit.visible = this.clip.distanceToPoint(world) >= 0;
    }
    this.gl.render(this.scene, this.camera);
    this.drawLabels(st);
  }
  drawLabels(st) {
    const ctx = this.ctx,
      dpr = this.gl.getPixelRatio();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    const boxes = [];
    this.districtCenters.forEach((c, id) => {
      if (!c || st.snap.d[id].ab) return;
      const p = this.visiblePoint(cylinderPoint(...c, 38));
      if (!p) return;
      const x = ((p.x + 1) * this.W) / 2,
        y = ((1 - p.y) * this.H) / 2,
        name = st.snap.d[id].name,
        width = ctx.measureText(name).width + 12;
      if (
        x < width / 2 + 12 ||
        x > this.W - this.insets.right - width / 2 - 12 ||
        y < this.insets.top + 12 ||
        y > this.H - this.insets.bottom - 12 ||
        boxes.some((b) => Math.abs(x - b.x) < (width + b.w) / 2 && Math.abs(y - b.y) < 25)
      )
        return;
      boxes.push({ x, y, w: width });
      ctx.fillStyle = 'rgba(5,6,12,.78)';
      ctx.fillRect(x - width / 2, y - 12, width, 18);
      ctx.fillStyle = '#dce4f4';
      ctx.fillText(name, x, y);
    });
    if (st.arch) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#edbc7b';
      ctx.fillText(
        this.W < 500
          ? 'PAST · wireframe types / dashed borders'
          : 'ARCHAEOLOGY · wireframes: former types · dashes: past borders',
        16,
        this.H - this.insets.bottom - 12,
      );
    }
  }
  hitTest(sx, sy, year) {
    if (!this.state || year !== this.state.year) return null;
    // Screen-space touch tolerance, restricted to the visible (unclipped) half.
    let nearest = null,
      best = 13;
    for (const sprite of this.units) {
      const p = this.visiblePoint(sprite.position);
      if (!p) continue;
      const d = Math.hypot(((p.x + 1) * this.W) / 2 - sx, ((1 - p.y) * this.H) / 2 - sy);
      if (d < best) {
        best = d;
        nearest = sprite.userData;
      }
    }
    if (nearest) {
      const sprite = this.units.find((s) => s.userData === nearest),
        world = this.root.localToWorld(sprite.position.clone());
      this.ray.set(this.camera.position, world.clone().sub(this.camera.position).normalize());
      const obstruction = this.ray
        .intersectObjects(this.pickables, false)
        .find((h) => this.clip.distanceToPoint(h.point) >= 0);
      if (!obstruction || obstruction.distance >= world.distanceTo(this.camera.position) - 3)
        return { ...nearest };
    }
    this.ray.setFromCamera(new T.Vector2((sx / this.W) * 2 - 1, 1 - (sy / this.H) * 2), this.camera);
    for (const hit of this.ray.intersectObjects(this.pickables, false)) {
      if (this.clip.distanceToPoint(hit.point) < 0) continue;
      const d = hit.object.userData;
      return {
        kind: d.kind,
        id: d.kind === 'plot' ? this.facePlots[hit.faceIndex] : d.ids ? d.ids[hit.instanceId] : d.id,
      };
    }
    return null;
  }
  snapshotPNG(st) {
    this.render(st);
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(this.canvas, 0, 0);
    ctx.drawImage(this.labels, 0, 0);
    return c;
  }
}
