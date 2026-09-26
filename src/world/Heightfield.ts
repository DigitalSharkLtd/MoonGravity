import * as THREE from 'three';

export interface RayHit {
  t: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  metal: boolean;
  colliderId: number; // -1 terrain, >=0 collider index, -2 fighter
  fighter?: unknown;
  collider?: unknown;
  part?: 'head' | 'body' | 'legs';
}

/** Regular grid heightfield. Vertex (i,j) is at world (x0 + i*cell, z0 + j*cell). */
export class Heightfield {
  readonly nx: number;
  readonly nz: number;
  readonly cell: number;
  readonly x0: number;
  readonly z0: number;
  readonly data: Float32Array;
  /** incremented whenever the terrain is deformed (nukes) */
  version = 0;

  constructor(nx: number, nz: number, cell: number, x0: number, z0: number) {
    this.nx = nx;
    this.nz = nz;
    this.cell = cell;
    this.x0 = x0;
    this.z0 = z0;
    this.data = new Float32Array(nx * nz);
  }

  get x1(): number {
    return this.x0 + (this.nx - 1) * this.cell;
  }
  get z1(): number {
    return this.z0 + (this.nz - 1) * this.cell;
  }

  idx(i: number, j: number): number {
    return j * this.nx + i;
  }

  get(i: number, j: number): number {
    i = i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
    j = j < 0 ? 0 : j >= this.nz ? this.nz - 1 : j;
    return this.data[j * this.nx + i];
  }

  heightAt(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell;
    const fz = (z - this.z0) / this.cell;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    let tx = fx - i;
    let tz = fz - j;
    if (i < 0) {
      i = 0;
      tx = 0;
    } else if (i >= this.nx - 1) {
      i = this.nx - 2;
      tx = 1;
    }
    if (j < 0) {
      j = 0;
      tz = 0;
    } else if (j >= this.nz - 1) {
      j = this.nz - 2;
      tz = 1;
    }
    const d = this.data;
    const k = j * this.nx + i;
    const h00 = d[k];
    const h10 = d[k + 1];
    const h01 = d[k + this.nx];
    const h11 = d[k + this.nx + 1];
    // triangle interpolation matching the rendered mesh split (diagonal from (0,0) to (1,1))
    if (tx >= tz) return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
    return h00 + (h11 - h01) * tx + (h01 - h00) * tz;
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const e = this.cell;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  /** Ray march + bisection. dir must be normalized. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out?: RayHit): RayHit | null {
    const step = Math.max(this.cell * 0.9, 0.4);
    let prevT = 0;
    let prevD = origin.y - this.heightAt(origin.x, origin.z);
    if (prevD < 0) return null; // starts below ground
    let t = 0;
    while (t < maxDist) {
      // adaptive step: take bigger strides when far above the ground
      const s = Math.max(step, Math.min(prevD * 0.6, 8));
      t = Math.min(maxDist, t + s);
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const d = y - this.heightAt(x, z);
      if (d <= 0) {
        let a = prevT;
        let b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) * 0.5;
          const dm = origin.y + dir.y * m - this.heightAt(origin.x + dir.x * m, origin.z + dir.z * m);
          if (dm > 0) a = m;
          else b = m;
        }
        const hit = out ?? { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), metal: false, colliderId: -1 };
        hit.t = b;
        hit.point.copy(origin).addScaledVector(dir, b);
        this.normalAt(hit.point.x, hit.point.z, hit.normal);
        hit.metal = false;
        hit.colliderId = -1;
        hit.fighter = undefined;
        hit.part = undefined;
        return hit;
      }
      prevT = t;
      prevD = d;
      if (t >= maxDist) break;
    }
    return null;
  }

  /**
   * Blast a crater into the terrain (used by tactical nukes). Returns the affected index box.
   */
  deform(cx: number, cz: number, radius: number, depth: number): { i0: number; i1: number; j0: number; j1: number } {
    const R = radius * 1.8;
    const i0 = Math.max(0, Math.floor((cx - R - this.x0) / this.cell));
    const i1 = Math.min(this.nx - 1, Math.ceil((cx + R - this.x0) / this.cell));
    const j0 = Math.max(0, Math.floor((cz - R - this.z0) / this.cell));
    const j1 = Math.min(this.nz - 1, Math.ceil((cz + R - this.z0) / this.cell));
    const rim = depth * 0.28;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + i * this.cell;
        const z = this.z0 + j * this.cell;
        const r = Math.hypot(x - cx, z - cz) / radius;
        let dh = 0;
        if (r < 1) dh = rim + depth * (r * r - 1);
        else if (r < 1.8) {
          const t = (r - 1) / 0.8;
          dh = rim * (1 - t) * (1 - t);
        }
        this.data[j * this.nx + i] += dh;
      }
    }
    this.version++;
    return { i0, i1, j0, j1 };
  }
}
