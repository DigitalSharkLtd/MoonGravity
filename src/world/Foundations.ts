import * as THREE from 'three';
import type { PhysicsWorld } from '../core/Physics';
import type { Heightfield } from './Heightfield';

/**
 * Site grading: before a foundation is poured the ground is levelled, so buildings stand level
 * instead of floating on the downhill side and being buried on the uphill side.
 *
 * Runs after every structure is placed: for each grounded footprint (static colliders that sit on
 * the regolith) the heightfield under it is set to the foundation height, with a smooth graded
 * skirt around it. Structures deliberately sunk into regolith (bunkers, berms) and structures
 * raised on legs / platforms are left untouched.
 */
export interface GradeStats {
  footprints: number;
  cells: number;
  box: { i0: number; i1: number; j0: number; j1: number } | null;
}

const MARGIN = 0.35; // levelled apron beyond the walls
const SKIRT = 2.6; // graded blend back to the natural terrain
const SINK = 0.04; // foundation slab slightly below the ground line (no seams)

export function gradeFoundations(physics: PhysicsWorld, hf: Heightfield): GradeStats {
  const nx = hf.nx;
  const nz = hf.nz;
  const cell = hf.cell;
  const n = nx * nz;
  const bestT = new Float32Array(n); // strongest influence per cell
  const bestArea = new Float32Array(n);
  const target = new Float32Array(n);
  const lp = new THREE.Vector3();
  let footprints = 0;
  let cells = 0;
  let bi0 = nx;
  let bi1 = -1;
  let bj0 = nz;
  let bj1 = -1;
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  // stairs / ramps (tilted colliders touching the ground) must keep meeting the natural ground at
  // their foot: protect that ground from grading, fading out over a short distance
  const protect = new Float32Array(n);
  for (const c of physics.colliders) {
    if (c.dynamic || c.noMove) continue;
    const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(c.rot).y;
    if (upY >= 0.97) continue;
    const g = hf.heightAt(c.center.x, c.center.z);
    if (c.min.y > g + 1.5) continue;
    const pad = 0.8;
    const fade = 1.6;
    const i0 = Math.max(0, Math.floor((c.min.x - pad - fade - hf.x0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((c.max.x + pad + fade - hf.x0) / cell));
    const j0 = Math.max(0, Math.floor((c.min.z - pad - fade - hf.z0) / cell));
    const j1 = Math.min(nz - 1, Math.ceil((c.max.z + pad + fade - hf.z0) / cell));
    for (let j = j0; j <= j1; j++) {
      const z = hf.z0 + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = hf.x0 + i * cell;
        const ox = Math.max(0, c.min.x - pad - x, x - c.max.x - pad);
        const oz = Math.max(0, c.min.z - pad - z, z - c.max.z - pad);
        const p = 1 - smooth(0, fade, Math.hypot(ox, oz));
        const k = j * nx + i;
        if (p > protect[k]) protect[k] = p;
      }
    }
  }

  for (const c of physics.colliders) {
    if (c.kind === 'sphere' || c.noMove || c.dynamic) continue;
    const hx = c.half.x;
    const hz = c.kind === 'cyl' ? c.half.x : c.half.z;
    const height = c.max.y - c.min.y;
    const area = c.kind === 'cyl' ? Math.PI * hx * hx : 4 * hx * hz;
    if (area < 1.2 || height < 0.35) continue;
    // only yaw-rotated pieces have a meaningful ground footprint
    const upY = new THREE.Vector3(0, 1, 0).applyQuaternion(c.rot).y;
    if (upY < 0.97) continue;
    const base = c.min.y;
    // sample the natural ground at the corners and centre of the footprint
    let hmin = Infinity;
    let hmax = -Infinity;
    for (const [sx, sz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      lp.set(sx * hx, 0, sz * hz).applyQuaternion(c.rot);
      const h = hf.heightAt(c.center.x + lp.x, c.center.z + lp.z);
      hmin = Math.min(hmin, h);
      hmax = Math.max(hmax, h);
    }
    if (base > hmax + 1.0) continue; // on legs / a platform / upper floor
    if (base < hmin - 0.5) continue; // deliberately dug in (bunker under a mound, sunken berm)
    if (hmax - hmin > 4) continue; // straddles a cliff or the pit edge: leave the terrain alone
    if (hmax - hmin < 0.03 && Math.abs(base - hmin) < 0.06) continue; // already level
    footprints++;
    const R = Math.hypot(hx, hz) + MARGIN + SKIRT;
    const i0 = Math.max(0, Math.floor((c.center.x - R - hf.x0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((c.center.x + R - hf.x0) / cell));
    const j0 = Math.max(0, Math.floor((c.center.z - R - hf.z0) / cell));
    const j1 = Math.min(nz - 1, Math.ceil((c.center.z + R - hf.z0) / cell));
    for (let j = j0; j <= j1; j++) {
      const z = hf.z0 + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = hf.x0 + i * cell;
        lp.set(x - c.center.x, 0, z - c.center.z).applyQuaternion(c.inv);
        let o: number;
        if (c.kind === 'cyl') o = Math.max(0, Math.hypot(lp.x, lp.z) - hx - MARGIN);
        else o = Math.hypot(Math.max(0, Math.abs(lp.x) - hx - MARGIN), Math.max(0, Math.abs(lp.z) - hz - MARGIN));
        const t = 1 - smooth(0, SKIRT, o);
        if (t <= 0) continue;
        const k = j * nx + i;
        // strongest influence wins; inside two footprints the bigger building decides
        if (t > bestT[k] + 1e-4 || (t >= 0.999 && bestT[k] >= 0.999 && area > bestArea[k])) {
          bestT[k] = t;
          bestArea[k] = area;
          target[k] = base - SINK;
        }
        bi0 = Math.min(bi0, i);
        bi1 = Math.max(bi1, i);
        bj0 = Math.min(bj0, j);
        bj1 = Math.max(bj1, j);
      }
    }
  }
  const H = hf.data;
  for (let k = 0; k < n; k++) {
    const t = bestT[k] * (1 - protect[k]);
    if (t <= 0) continue;
    H[k] = H[k] * (1 - t) + target[k] * t;
    cells++;
  }
  return { footprints, cells, box: bi1 >= 0 ? { i0: bi0, i1: bi1, j0: bj0, j1: bj1 } : null };
}
