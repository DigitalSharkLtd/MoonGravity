import * as THREE from 'three';
import { PhysicsWorld } from '../core/Physics';

/**
 * Layered (2.5D) navigation grid: every XZ cell can hold several walkable floors
 * (terrain, building floors, bridges, roofs). Edges connect neighbouring floors that are
 * within a step, plus one-way drops and jump-ups (low lunar gravity makes both cheap).
 */
export interface NavNode {
  i: number; // cell x
  j: number; // cell z
  y: number; // floor height
  x: number;
  z: number;
  edges: number[]; // node ids
  costs: number[];
  jump: Uint8Array | null; // per-edge flag: requires a jump
}

const MAX_LAYERS = 4;

export class NavGrid {
  cell: number;
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  nodes: NavNode[] = [];
  /** cell → node ids */
  private cells: Int32Array; // nx*nz*MAX_LAYERS, -1 = none
  buildMs = 0;

  constructor(world: PhysicsWorld, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, cell: number) {
    const t0 = performance.now();
    this.cell = cell;
    this.x0 = bounds.minX;
    this.z0 = bounds.minZ;
    this.nx = Math.floor((bounds.maxX - bounds.minX) / cell) + 1;
    this.nz = Math.floor((bounds.maxZ - bounds.minZ) / cell) + 1;
    this.cells = new Int32Array(this.nx * this.nz * MAX_LAYERS).fill(-1);
    const hf = world.hf;
    const probe = new THREE.Vector3();
    const n = new THREE.Vector3();
    const dirDown = new THREE.Vector3(0, -1, 0);
    const origin = new THREE.Vector3();
    const list: import('../core/Physics').Collider[] = [];
    const floors: number[] = [];
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + i * cell;
        const z = this.z0 + j * cell;
        floors.length = 0;
        // terrain floor
        hf.normalAt(x, z, n);
        const th = hf.heightAt(x, z);
        if (n.y > 0.62) floors.push(th);
        // collider tops in this column
        world.query(x - 0.05, z - 0.05, x + 0.05, z + 0.05, -1e4, 1e4, list);
        for (const c of list) {
          if (c.noMove || c.dynamic) continue;
          origin.set(x, c.max.y + 0.2, z);
          const t = world.rayCollider(c, origin, dirDown, c.max.y - c.min.y + 0.4, n);
          if (t === Infinity || n.y < 0.62) continue;
          const y = origin.y - t;
          if (y < th - 0.2) continue;
          floors.push(y);
        }
        floors.sort((a, b) => a - b);
        let layer = 0;
        let last = -1e9;
        for (const y of floors) {
          if (y - last < 0.3) continue; // merge near-identical floors
          // clearance: capsule must fit (standing), and not inside geometry
          probe.set(x, y + 0.5, z);
          if (world.pointBlocked(probe, 0.36)) continue;
          probe.y = y + 1.4;
          if (world.pointBlocked(probe, 0.36)) continue;
          last = y;
          if (layer >= MAX_LAYERS) break;
          const id = this.nodes.length;
          this.nodes.push({ i, j, y, x, z, edges: [], costs: [], jump: null });
          this.cells[(j * this.nx + i) * MAX_LAYERS + layer] = id;
          layer++;
        }
      }
    }
    // edges
    const jumps: number[][] = this.nodes.map(() => []);
    for (let ai = 0; ai < this.nodes.length; ai++) {
      const a = this.nodes[ai];
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ci = a.i + di;
          const cj = a.j + dj;
          if (ci < 0 || cj < 0 || ci >= this.nx || cj >= this.nz) continue;
          const base = (cj * this.nx + ci) * MAX_LAYERS;
          const horiz = Math.hypot(di, dj) * cell;
          for (let l = 0; l < MAX_LAYERS; l++) {
            const bid = this.cells[base + l];
            if (bid < 0) break;
            const b = this.nodes[bid];
            const dy = b.y - a.y;
            let cost = -1;
            let jump = 0;
            if (Math.abs(dy) <= 0.6 * Math.max(1, horiz)) cost = horiz + Math.abs(dy);
            else if (dy < 0 && dy > -7) cost = horiz + 1 + -dy * 0.2; // drop down
            else if (dy > 0 && dy < 2.0) {
              cost = horiz + 3 + dy; // jump up (≈2.1 m jump apex)
              jump = 1;
            }
            if (cost < 0) continue;
            // diagonal moves must not cut corners through walls
            if (di && dj) {
              const s1 = this.nodeAt(a.i + di, a.j, a.y);
              const s2 = this.nodeAt(a.i, a.j + dj, a.y);
              if (s1 < 0 || s2 < 0) continue;
            }
            a.edges.push(bid);
            a.costs.push(cost);
            jumps[ai].push(jump); // (was nodes.indexOf(a): quadratic over ~25k nodes)
          }
        }
      }
    }
    this.nodes.forEach((nd, k) => {
      if (jumps[k].some((v) => v)) nd.jump = Uint8Array.from(jumps[k]);
    });
    // connected areas (undirected): a search between two different areas can never succeed —
    // those failed searches expanded thousands of nodes and were most of the bot AI's CPU time
    const N = this.nodes.length;
    const parent = new Int32Array(N);
    for (let k = 0; k < N; k++) parent[k] = k;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    for (let k = 0; k < N; k++) for (const e of this.nodes[k].edges) {
      const ra = find(k);
      const rb = find(e);
      if (ra !== rb) parent[ra] = rb;
    }
    this.area = new Int32Array(N);
    for (let k = 0; k < N; k++) this.area[k] = find(k);
    this.buildMs = performance.now() - t0;
  }

  /** node id on a cell closest to height y (within 1.5 m), -1 if none */
  nodeAt(i: number, j: number, y: number): number {
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    const base = (j * this.nx + i) * MAX_LAYERS;
    let best = -1;
    let bd = 1.6;
    for (let l = 0; l < MAX_LAYERS; l++) {
      const id = this.cells[base + l];
      if (id < 0) break;
      const d = Math.abs(this.nodes[id].y - y);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  /** Nearest node to a world position (searches a small neighbourhood). */
  nearest(p: THREE.Vector3): number {
    const ci = Math.round((p.x - this.x0) / this.cell);
    const cj = Math.round((p.z - this.z0) / this.cell);
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r <= 4 && best < 0; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
          const base = (j * this.nx + i) * MAX_LAYERS;
          for (let l = 0; l < MAX_LAYERS; l++) {
            const id = this.cells[base + l];
            if (id < 0) break;
            const nd = this.nodes[id];
            const d = (nd.x - p.x) ** 2 + (nd.z - p.z) ** 2 + ((nd.y - p.y) * 2) ** 2;
            if (d < bd) {
              bd = d;
              best = id;
            }
          }
        }
      }
    }
    return best;
  }

  /** connected-area id per node (see constructor) */
  area = new Int32Array(0);
  private gScore = new Float32Array(0);
  private came = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private run = 0;

  /** A* from a to b. Returns node id path (inclusive) or null. */
  /** open-list heap storage, reused between searches (no per-call allocation) */
  private heapF = new Float32Array(4096);
  private heapI = new Int32Array(4096);

  /**
   * A* over the nav graph. Weighted (heuristic × 1.25): slightly greedy, expands several times fewer
   * nodes than plain A* for near-identical routes — path search was the biggest cost of the bot AI.
   */
  /**
   * `partial`: if the goal can't be reached (e.g. a platform you can drop from but not climb to),
   * return the route to the reachable node closest to it instead of null.
   */
  path(a: number, b: number, maxExpand = 16000, partial = false): number[] | null {
    if (a < 0 || b < 0) return null;
    if (this.area.length && this.area[a] !== this.area[b]) return null; // different areas: no route
    const N = this.nodes.length;
    if (this.gScore.length !== N) {
      this.gScore = new Float32Array(N);
      this.came = new Int32Array(N);
      this.stamp = new Uint32Array(N);
      this.closed = new Uint32Array(N);
    }
    const run = ++this.run;
    const nodes = this.nodes;
    const gScore = this.gScore;
    const came = this.came;
    const stamp = this.stamp;
    const closed = this.closed;
    const goal = nodes[b];
    const gx = goal.x;
    const gy = goal.y;
    const gz = goal.z;
    const W = 1.25;
    let hf = this.heapF;
    let hi = this.heapI;
    let n = 0;
    const push = (f: number, id: number): void => {
      if (n >= hf.length) {
        const nf = new Float32Array(hf.length * 2);
        const ni = new Int32Array(hi.length * 2);
        nf.set(hf);
        ni.set(hi);
        hf = this.heapF = nf;
        hi = this.heapI = ni;
      }
      let k = n++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (hf[p] <= f) break;
        hf[k] = hf[p];
        hi[k] = hi[p];
        k = p;
      }
      hf[k] = f;
      hi[k] = id;
    };
    const pop = (): number => {
      const top = hi[0];
      n--;
      if (n > 0) {
        const lf = hf[n];
        const li = hi[n];
        let k = 0;
        for (;;) {
          let c = k * 2 + 1;
          if (c >= n) break;
          if (c + 1 < n && hf[c + 1] < hf[c]) c++;
          if (hf[c] >= lf) break;
          hf[k] = hf[c];
          hi[k] = hi[c];
          k = c;
        }
        hf[k] = lf;
        hi[k] = li;
      }
      return top;
    };
    const h = (nd: NavNode): number => (Math.hypot(nd.x - gx, nd.z - gz) + Math.abs(nd.y - gy) * 0.5) * W;
    gScore[a] = 0;
    stamp[a] = run;
    came[a] = -1;
    push(h(nodes[a]), a);
    let expanded = 0;
    let best = a;
    let bestH = Infinity;
    const route = (end: number): number[] => {
      const out: number[] = [];
      for (let c = end; c >= 0; c = came[c]) out.push(c);
      return out.reverse();
    };
    const fail = (): number[] | null => (partial && best !== a ? route(best) : null);
    while (n > 0) {
      const cur = pop();
      if (cur === b) return route(b);
      if (closed[cur] === run) continue;
      closed[cur] = run;
      if (++expanded > maxExpand) return fail();
      const nd = nodes[cur];
      if (partial) {
        const hc = h(nd);
        if (hc < bestH) {
          bestH = hc;
          best = cur;
        }
      }
      const edges = nd.edges;
      const costs = nd.costs;
      const g0 = gScore[cur];
      for (let e = 0; e < edges.length; e++) {
        const nb = edges[e];
        if (closed[nb] === run) continue;
        const g = g0 + costs[e];
        if (stamp[nb] !== run || g < gScore[nb]) {
          stamp[nb] = run;
          gScore[nb] = g;
          came[nb] = cur;
          push(g + h(nodes[nb]), nb);
        }
      }
    }
    return fail();
  }

  edgeNeedsJump(from: number, to: number): boolean {
    const nd = this.nodes[from];
    if (!nd.jump) return false;
    const e = nd.edges.indexOf(to);
    return e >= 0 && nd.jump[e] === 1;
  }

  /** random walkable node near a point (for roaming) */
  randomNear(p: THREE.Vector3, r: number): number {
    for (let k = 0; k < 20; k++) {
      const x = p.x + (Math.random() * 2 - 1) * r;
      const z = p.z + (Math.random() * 2 - 1) * r;
      const id = this.nearest(new THREE.Vector3(x, p.y, z));
      if (id >= 0) return id;
    }
    return this.nearest(p);
  }
}
