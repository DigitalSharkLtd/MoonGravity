import * as THREE from 'three';
import { Heightfield, RayHit } from '../world/Heightfield';

export const MOON_G = 1.62;
/** gravity felt by characters: heavier than the real Moon so jumps read higher-and-shorter instead of
 *  long floaty arcs (projectiles and debris keep true lunar ballistics) */
export const BODY_G = 5.5;
/** hold the jump key this long to light the jetpack (a tap is a plain jump) */
export const JET_HOLD = 0.5;

export type ColliderKind = 'box' | 'cyl' | 'sphere';

export interface Collider {
  id: number;
  kind: ColliderKind;
  /** mag-boots can stick to it */
  metal: boolean;
  center: THREE.Vector3;
  rot: THREE.Quaternion;
  inv: THREE.Quaternion;
  /** box: half extents. cyl: (radius, halfHeight, radius). sphere: (r, r, r) */
  half: THREE.Vector3;
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** bullets pass through (e.g. own-team shield) */
  team?: number;
  dynamic?: boolean;
  enabled: boolean;
  /** blocks movement but not projectiles (e.g. invisible boundaries) */
  noShoot?: boolean;
  /** does not block movement (e.g. shield domes let teammates through) */
  noMove?: boolean;
  tag?: string;
}

export interface Contact {
  normal: THREE.Vector3;
  depth: number;
  metal: boolean;
  terrain: boolean;
  collider: Collider | null;
}

const _v = new THREE.Vector3();
const _q = new THREE.Vector3();
const _c = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Static world collision: heightfield terrain + oriented primitives in a uniform XZ grid.
 */
export class PhysicsWorld {
  hf: Heightfield;
  colliders: Collider[] = [];
  dynamic: Collider[] = [];
  private cellSize = 8;
  private grid = new Map<number, Collider[]>();
  private stamp = 0;
  private stamps: number[] = [];
  bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

  constructor(hf: Heightfield) {
    this.hf = hf;
  }

  private key(ix: number, iz: number): number {
    return (ix + 2048) * 4096 + (iz + 2048);
  }

  addBox(center: THREE.Vector3, half: THREE.Vector3, rot: THREE.Quaternion = new THREE.Quaternion(), metal = true, extra: Partial<Collider> = {}): Collider {
    return this.add('box', center, half, rot, metal, extra);
  }
  addCylinder(center: THREE.Vector3, radius: number, halfHeight: number, rot: THREE.Quaternion = new THREE.Quaternion(), metal = true, extra: Partial<Collider> = {}): Collider {
    return this.add('cyl', center, new THREE.Vector3(radius, halfHeight, radius), rot, metal, extra);
  }
  addSphere(center: THREE.Vector3, r: number, metal = true, extra: Partial<Collider> = {}): Collider {
    return this.add('sphere', center, new THREE.Vector3(r, r, r), new THREE.Quaternion(), metal, extra);
  }

  private add(kind: ColliderKind, center: THREE.Vector3, half: THREE.Vector3, rot: THREE.Quaternion, metal: boolean, extra: Partial<Collider>): Collider {
    const c: Collider = {
      id: this.colliders.length + this.dynamic.length * 100000,
      kind,
      metal,
      center: center.clone(),
      rot: rot.clone(),
      inv: rot.clone().invert(),
      half: half.clone(),
      min: new THREE.Vector3(),
      max: new THREE.Vector3(),
      enabled: true,
      ...extra,
    };
    this.computeAabb(c);
    if (c.dynamic) {
      this.dynamic.push(c);
      return c;
    }
    c.id = this.colliders.length;
    this.colliders.push(c);
    this.stamps.push(0);
    const x0 = Math.floor(c.min.x / this.cellSize);
    const x1 = Math.floor(c.max.x / this.cellSize);
    const z0 = Math.floor(c.min.z / this.cellSize);
    const z1 = Math.floor(c.max.z / this.cellSize);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let list = this.grid.get(k);
        if (!list) {
          list = [];
          this.grid.set(k, list);
        }
        list.push(c);
      }
    }
    return c;
  }

  removeDynamic(c: Collider): void {
    const i = this.dynamic.indexOf(c);
    if (i >= 0) this.dynamic.splice(i, 1);
  }

  computeAabb(c: Collider): void {
    if (c.kind === 'sphere') {
      c.min.copy(c.center).subScalar(c.half.x);
      c.max.copy(c.center).addScalar(c.half.x);
      return;
    }
    // transform the 8 corners of the local box (cylinder uses its bounding box)
    c.min.set(Infinity, Infinity, Infinity);
    c.max.set(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? c.half.x : -c.half.x, i & 2 ? c.half.y : -c.half.y, i & 4 ? c.half.z : -c.half.z)
        .applyQuaternion(c.rot)
        .add(c.center);
      c.min.min(_v);
      c.max.max(_v);
    }
  }

  /** Collect static colliders overlapping an AABB (deduplicated). */
  query(minX: number, minZ: number, maxX: number, maxZ: number, minY: number, maxY: number, out: Collider[]): Collider[] {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(minX / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const z0 = Math.floor(minZ / this.cellSize);
    const z1 = Math.floor(maxZ / this.cellSize);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (this.stamps[c.id] === s || !c.enabled) continue;
          this.stamps[c.id] = s;
          if (c.max.x < minX || c.min.x > maxX || c.max.z < minZ || c.min.z > maxZ || c.max.y < minY || c.min.y > maxY) continue;
          out.push(c);
        }
      }
    }
    for (const c of this.dynamic) {
      if (!c.enabled) continue;
      if (c.max.x < minX || c.min.x > maxX || c.max.z < minZ || c.min.z > maxZ || c.max.y < minY || c.min.y > maxY) continue;
      out.push(c);
    }
    return out;
  }

  /**
   * Signed distance from p to collider surface, writing the closest surface point and outward normal.
   */
  closest(c: Collider, p: THREE.Vector3, outPoint: THREE.Vector3, outNormal: THREE.Vector3): number {
    const q = _q.copy(p).sub(c.center).applyQuaternion(c.inv);
    const h = c.half;
    let dist: number;
    if (c.kind === 'sphere') {
      const l = q.length();
      if (l < 1e-6) q.set(0, 1, 0);
      else q.divideScalar(l);
      outNormal.copy(q);
      outPoint.copy(q).multiplyScalar(h.x);
      dist = l - h.x;
    } else if (c.kind === 'box') {
      const dx = Math.abs(q.x) - h.x;
      const dy = Math.abs(q.y) - h.y;
      const dz = Math.abs(q.z) - h.z;
      if (dx > 0 || dy > 0 || dz > 0) {
        outPoint.set(Math.max(-h.x, Math.min(h.x, q.x)), Math.max(-h.y, Math.min(h.y, q.y)), Math.max(-h.z, Math.min(h.z, q.z)));
        outNormal.copy(q).sub(outPoint);
        dist = outNormal.length();
        if (dist > 1e-6) outNormal.divideScalar(dist);
        else outNormal.set(0, 1, 0);
      } else {
        // inside: push out through the nearest face
        outPoint.copy(q);
        if (dx >= dy && dx >= dz) {
          outNormal.set(Math.sign(q.x) || 1, 0, 0);
          outPoint.x = outNormal.x * h.x;
          dist = dx;
        } else if (dy >= dz) {
          outNormal.set(0, Math.sign(q.y) || 1, 0);
          outPoint.y = outNormal.y * h.y;
          dist = dy;
        } else {
          outNormal.set(0, 0, Math.sign(q.z) || 1);
          outPoint.z = outNormal.z * h.z;
          dist = dz;
        }
      }
    } else {
      // cylinder along local Y
      const r = Math.hypot(q.x, q.z);
      const R = h.x;
      const H = h.y;
      const dr = r - R;
      const dy = Math.abs(q.y) - H;
      const rx = r > 1e-6 ? q.x / r : 1;
      const rz = r > 1e-6 ? q.z / r : 0;
      if (dr > 0 || dy > 0) {
        const cr = Math.min(r, R);
        outPoint.set(rx * cr, Math.max(-H, Math.min(H, q.y)), rz * cr);
        outNormal.copy(q).sub(outPoint);
        dist = outNormal.length();
        if (dist > 1e-6) outNormal.divideScalar(dist);
        else outNormal.set(rx, 0, rz);
      } else if (dr > dy) {
        outPoint.set(rx * R, q.y, rz * R);
        outNormal.set(rx, 0, rz);
        dist = dr;
      } else {
        const sy = Math.sign(q.y) || 1;
        outPoint.set(q.x, sy * H, q.z);
        outNormal.set(0, sy, 0);
        dist = dy;
      }
    }
    outPoint.applyQuaternion(c.rot).add(c.center);
    outNormal.applyQuaternion(c.rot);
    return dist;
  }

  private tmpList: Collider[] = [];

  /**
   * Push a sphere out of the world. Returns contacts appended to `contacts`.
   */
  resolveSphere(center: THREE.Vector3, r: number, contacts: Contact[], ignoreTerrain = false): void {
    // terrain: local plane approximation
    if (!ignoreTerrain) {
      const h = this.hf.heightAt(center.x, center.z);
      if (center.y - r < h + 0.5) {
        this.hf.normalAt(center.x, center.z, _n);
        const dist = (center.y - h) * _n.y;
        if (dist < r) {
          const depth = r - dist;
          center.addScaledVector(_n, depth);
          contacts.push({ normal: _n.clone(), depth, metal: false, terrain: true, collider: null });
        }
      }
    }
    const list = this.query(center.x - r, center.z - r, center.x + r, center.z + r, center.y - r, center.y + r, this.tmpList);
    for (const c of list) {
      if (c.noMove) continue;
      const d = this.closest(c, center, _c, _n);
      if (d < r) {
        const depth = r - d;
        center.addScaledVector(_n, depth);
        contacts.push({ normal: _n.clone(), depth, metal: c.metal, terrain: false, collider: c });
      }
    }
  }

  /**
   * Nearest metal surface point to p within maxDist (used by mag-boots).
   * `prefer`: in concave corners (several surfaces within `slack` of the nearest one) pick the surface
   * whose normal is most aligned with this direction instead of the marginally nearer one, so the
   * boots don't flip-flop between the two faces of a corner.
   */
  nearestMetal(p: THREE.Vector3, maxDist: number, outPoint: THREE.Vector3, outNormal: THREE.Vector3, filter?: (n: THREE.Vector3) => boolean, prefer?: THREE.Vector3, slack = 0.12): number {
    const list = this.query(p.x - maxDist, p.z - maxDist, p.x + maxDist, p.z + maxDist, p.y - maxDist, p.y + maxDist, this.tmpList);
    let best = Infinity;
    let bestScore = -Infinity;
    const cand = this.metalCand;
    cand.length = 0;
    const pt = new THREE.Vector3();
    const nn = new THREE.Vector3();
    for (const c of list) {
      if (!c.metal || c.noMove) continue;
      const d = this.closest(c, p, pt, nn);
      if (d >= maxDist) continue;
      if (filter && !filter(nn)) continue;
      if (!prefer) {
        if (d < best) {
          best = d;
          outPoint.copy(pt);
          outNormal.copy(nn);
        }
        continue;
      }
      cand.push({ d, p: pt.clone(), n: nn.clone() });
      if (d < best) best = d;
    }
    if (!prefer || !cand.length) return best;
    let bestD = Infinity;
    for (const c of cand) {
      if (c.d > best + slack) continue;
      // normal from the contact point to the query point (smooth around edges)
      const dir = _v.copy(p).sub(c.p);
      const l = dir.length();
      const al = l > 1e-5 ? dir.dot(prefer) / l : c.n.dot(prefer);
      const score = al - (c.d - best) * 2;
      if (score > bestScore) {
        bestScore = score;
        bestD = c.d;
        outPoint.copy(c.p);
        outNormal.copy(c.n);
      }
    }
    return bestD;
  }
  private metalCand: { d: number; p: THREE.Vector3; n: THREE.Vector3 }[] = [];

  /** Is point inside any solid (used for spawn checks). */
  pointBlocked(p: THREE.Vector3, r: number): boolean {
    if (p.y - r < this.hf.heightAt(p.x, p.z)) return true;
    const list = this.query(p.x - r, p.z - r, p.x + r, p.z + r, p.y - r, p.y + r, this.tmpList);
    for (const c of list) {
      if (c.noMove) continue;
      if (this.closest(c, p, _c, _n) < r) return true;
    }
    return false;
  }

  // ---------------- raycasting ----------------

  rayCollider(c: Collider, origin: THREE.Vector3, dir: THREE.Vector3, maxT: number, outN: THREE.Vector3): number {
    const o = _o.copy(origin).sub(c.center).applyQuaternion(c.inv);
    const d = _d.copy(dir).applyQuaternion(c.inv);
    const h = c.half;
    let tHit = Infinity;
    if (c.kind === 'sphere') {
      const b = o.dot(d);
      const cc = o.lengthSq() - h.x * h.x;
      const disc = b * b - cc;
      if (disc < 0) return Infinity;
      const s = Math.sqrt(disc);
      let t = -b - s;
      if (t < 0) t = -b + s; // inside: hit the far wall (shield domes)
      if (t < 0 || t > maxT) return Infinity;
      outN.copy(o).addScaledVector(d, t).normalize();
      if (cc < 0) outN.negate();
      tHit = t;
    } else if (c.kind === 'box') {
      let tmin = -Infinity;
      let tmax = Infinity;
      let axis = -1;
      let sign = 1;
      for (let a = 0; a < 3; a++) {
        const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
        const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
        const ha = a === 0 ? h.x : a === 1 ? h.y : h.z;
        if (Math.abs(da) < 1e-9) {
          if (oa < -ha || oa > ha) return Infinity;
          continue;
        }
        let t1 = (-ha - oa) / da;
        let t2 = (ha - oa) / da;
        let s = -1;
        if (t1 > t2) {
          const tt = t1;
          t1 = t2;
          t2 = tt;
          s = 1;
        }
        if (t1 > tmin) {
          tmin = t1;
          axis = a;
          sign = s;
        }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return Infinity;
      }
      if (tmin < 0 || tmin > maxT || axis < 0) return Infinity;
      outN.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
      tHit = tmin;
    } else {
      const R = h.x;
      const H = h.y;
      // side
      const a = d.x * d.x + d.z * d.z;
      if (a > 1e-9) {
        const b = o.x * d.x + o.z * d.z;
        const cc = o.x * o.x + o.z * o.z - R * R;
        const disc = b * b - a * cc;
        if (disc >= 0) {
          const t = (-b - Math.sqrt(disc)) / a;
          if (t >= 0 && t <= maxT) {
            const y = o.y + d.y * t;
            if (y >= -H && y <= H) {
              tHit = t;
              outN.set(o.x + d.x * t, 0, o.z + d.z * t).normalize();
            }
          }
        }
      }
      // caps
      if (Math.abs(d.y) > 1e-9) {
        for (const sy of [1, -1]) {
          const t = (sy * H - o.y) / d.y;
          if (t >= 0 && t < tHit && t <= maxT) {
            const x = o.x + d.x * t;
            const z = o.z + d.z * t;
            if (x * x + z * z <= R * R && sy * d.y < 0) {
              tHit = t;
              outN.set(0, sy, 0);
            }
          }
        }
      }
      if (tHit === Infinity) return Infinity;
    }
    outN.applyQuaternion(c.rot);
    return tHit;
  }

  /**
   * Raycast world (terrain + colliders). `team` lets friendly shields be ignored.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, opts: { team?: number; ignoreTerrain?: boolean; forMove?: boolean } = {}): RayHit | null {
    let best: RayHit | null = null;
    let bestT = maxDist;
    if (!opts.ignoreTerrain) {
      const th = this.hf.raycast(origin, dir, maxDist);
      if (th) {
        best = th;
        bestT = th.t;
      }
    }
    // DDA over grid cells in XZ
    const cs = this.cellSize;
    let ix = Math.floor(origin.x / cs);
    let iz = Math.floor(origin.z / cs);
    const stepX = dir.x > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dir.x) > 1e-9 ? cs / Math.abs(dir.x) : Infinity;
    const tDeltaZ = Math.abs(dir.z) > 1e-9 ? cs / Math.abs(dir.z) : Infinity;
    let tMaxX = Math.abs(dir.x) > 1e-9 ? ((dir.x > 0 ? (ix + 1) * cs : ix * cs) - origin.x) / dir.x : Infinity;
    let tMaxZ = Math.abs(dir.z) > 1e-9 ? ((dir.z > 0 ? (iz + 1) * cs : iz * cs) - origin.z) / dir.z : Infinity;
    const s = ++this.stamp;
    const n = new THREE.Vector3();
    let tCell = 0;
    for (let guard = 0; guard < 400; guard++) {
      const list = this.grid.get(this.key(ix, iz));
      if (list) {
        for (const c of list) {
          if (this.stamps[c.id] === s || !c.enabled) continue;
          this.stamps[c.id] = s;
          if (c.noShoot && !opts.forMove) continue;
          if (opts.team !== undefined && c.team === opts.team) continue;
          const t = this.rayCollider(c, origin, dir, bestT, n);
          if (t < bestT) {
            bestT = t;
            best = { t, point: new THREE.Vector3().copy(origin).addScaledVector(dir, t), normal: n.clone(), metal: c.metal, colliderId: c.id };
          }
        }
      }
      tCell = Math.min(tMaxX, tMaxZ);
      if (tCell > bestT) break;
      if (tMaxX < tMaxZ) {
        ix += stepX;
        tMaxX += tDeltaX;
      } else {
        iz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    for (const c of this.dynamic) {
      if (!c.enabled) continue;
      if (c.noShoot && !opts.forMove) continue;
      if (opts.team !== undefined && c.team === opts.team) continue;
      const t = this.rayCollider(c, origin, dir, bestT, n);
      if (t < bestT) {
        bestT = t;
        best = { t, point: new THREE.Vector3().copy(origin).addScaledVector(dir, t), normal: n.clone(), metal: c.metal, colliderId: 100000 + this.dynamic.indexOf(c), collider: c };
      }
    }
    return best;
  }

  /** Line of sight test. */
  visible(a: THREE.Vector3, b: THREE.Vector3): boolean {
    _v.copy(b).sub(a);
    const len = _v.length();
    if (len < 1e-4) return true;
    _v.divideScalar(len);
    const hit = this.raycast(a, _v, len - 0.05);
    return hit === null;
  }
}
