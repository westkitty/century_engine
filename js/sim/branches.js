// Timeline branches. Each branch is fully described by (seed, decisions[]),
// where decisions are answers to intervention prompts keyed by year. A branch
// forked at year Y inherits its parent's decisions with year <= Y.
// Replaying is deterministic, so persistence only needs seeds and decisions;
// the in-memory world + history are rebuilt on load.
import { generateWorld } from './gen.js';
import { tick, applyDecision } from './sim.js';
import { History } from './history.js';

export class Branch {
  constructor({ id, name, parent, forkYear, decisions, seed, color }) {
    this.id = id; this.name = name; this.parent = parent ?? null; this.forkYear = forkYear ?? 1;
    this.decisions = decisions || []; this.seed = seed; this.color = color || '#e0c26a';
    this.world = null; this.history = null; this.headYear = 1;
  }
  serialize() { return { id: this.id, name: this.name, parent: this.parent, forkYear: this.forkYear, decisions: this.decisions, seed: this.seed, color: this.color, headYear: this.headYear }; }
}

const BRANCH_COLORS = ['#e0c26a', '#5cc8e8', '#e05a7a', '#7fc46a', '#b48ce8', '#f08a4b', '#5ee0b0', '#d8d05a'];

export class Timelines {
  constructor(seed) {
    this.seed = seed; this.branches = []; this.active = null; this.nextBranchId = 1;
  }
  // ---- creation / replay
  createRoot() {
    const b = new Branch({ id: 0, name: 'Prime', parent: null, forkYear: 1, decisions: [], seed: this.seed, color: BRANCH_COLORS[0] });
    b.world = generateWorld(this.seed); b.history = new History();
    b.world.stats = {}; b.history.record(b.world); b.headYear = 1;
    this.branches.push(b); this.active = b; return b;
  }
  /** Run branch `b` forward to `targetYear`, answering prompts from b.decisions. Returns false if it stopped on an unanswered prompt. */
  advance(b, targetYear, onEvent) {
    const w = b.world;
    while (w.year < targetYear) {
      if (w.pending) {
        const dec = b.decisions.find(x => x.year === w.pending.year && x.kind === w.pending.kind);
        if (!dec) return false;
        applyDecision(w, dec.option);
      }
      const before = w.events.length;
      tick(w);
      b.history.record(w); b.headYear = w.year;
      if (onEvent) for (let i = before; i < w.events.length; i++) onEvent(w.events[i]);
      if (w.pending) {
        const dec = b.decisions.find(x => x.year === w.pending.year && x.kind === w.pending.kind);
        if (dec) applyDecision(w, dec.option); else return false;
      }
    }
    return true;
  }
  /** Rebuild a branch's world from scratch up to `year` by deterministic replay. */
  rebuild(b, year) {
    b.world = generateWorld(b.seed); b.history = new History(); b.world.stats = {}; b.history.record(b.world); b.headYear = 1;
    if (b.parent !== null) {
      this.advance(b, b.forkYear);
      // A fork may diverge immediately: allow a fresh intervention right away.
      // This is part of the deterministic replay so saved forks rebuild identically.
      b.world.lastIntervention = Math.min(b.world.lastIntervention, b.forkYear - 12);
    }
    this.advance(b, year);
  }
  fork(fromBranch, year, name) {
    const inherited = fromBranch.decisions.filter(d => d.year <= year);
    const b = new Branch({ id: this.nextBranchId++, name: name || `Branch ${this.nextBranchId - 1}`, parent: fromBranch.id, forkYear: year, decisions: inherited, seed: this.seed, color: BRANCH_COLORS[(this.nextBranchId - 1) % BRANCH_COLORS.length] });
    this.branches.push(b);
    this.rebuild(b, year);
    return b;
  }
  decide(b, option) {
    const w = b.world; if (!w.pending) return;
    // remove any inherited decision for the same prompt so the fork can diverge
    b.decisions = b.decisions.filter(d => !(d.year === w.pending.year && d.kind === w.pending.kind));
    b.decisions.push({ year: w.pending.year, kind: w.pending.kind, option });
    applyDecision(w, option);
    b.history.record(w);
  }
  get(id) { return this.branches.find(b => b.id === id); }
  // ---- persistence
  serialize() {
    return { seed: this.seed, nextBranchId: this.nextBranchId, active: this.active ? this.active.id : 0, branches: this.branches.map(b => b.serialize()) };
  }
  static deserialize(data, onProgress) {
    const t = new Timelines(data.seed);
    t.nextBranchId = data.nextBranchId || 1;
    for (const bd of data.branches) {
      const b = new Branch(bd);
      t.branches.push(b);
      t.rebuild(b, bd.headYear || 1);
      if (onProgress) onProgress(b);
    }
    t.active = t.get(data.active) || t.branches[0];
    return t;
  }
}
