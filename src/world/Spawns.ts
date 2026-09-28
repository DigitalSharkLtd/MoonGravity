import * as THREE from 'three';
import type { PhysicsWorld } from '../core/Physics';
import type { SpawnPoint } from './Layouts';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** forward of a body with this yaw (Body.reset convention: yaw 0 looks down -Z) */
const dirOf = (yaw: number, out: THREE.Vector3) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));

/** free distance from p along a horizontal direction, checked at knee and chest height */
function free(phys: PhysicsWorld, p: THREE.Vector3, dir: THREE.Vector3, max: number): number {
  let best = max;
  for (const h of [0.45, 1.25]) {
    const hit = phys.raycast(_o.copy(p).setY(p.y + h), dir, max, { forMove: true });
    if (hit) best = Math.min(best, hit.t);
  }
  return best;
}

/** how much elbow room a standing body has at p (min free distance around it, capped) */
function clearance(phys: PhysicsWorld, p: THREE.Vector3, cap = 2.5): number {
  let c = cap;
  for (let k = 0; k < 12; k++) c = Math.min(c, free(phys, p, dirOf((k / 12) * Math.PI * 2, _d), cap));
  return c;
}

/** standable: floor right under p (same level) and head room above */
function standable(phys: PhysicsWorld, p: THREE.Vector3, floorY: number): boolean {
  const down = phys.raycast(_o.copy(p).setY(p.y + 1), DOWN, 1.6);
  if (!down || Math.abs(down.point.y - floorY) > 0.35) return false;
  const up = phys.raycast(_o.copy(p).setY(p.y + 0.3), UP, 2.2, { forMove: true });
  return !up;
}

/**
 * Tidy every spawn point after the level is built: a spawn boxed in by furniture (a table right in
 * front, crates at the side) moves to the roomiest spot within 3 m on the same floor, and every spawn
 * faces the most open direction (the door / corridor) instead of a wall or a table — players used to
 * respawn facing a table they had to walk around every time.
 */
export function tidySpawns(phys: PhysicsWorld, spawns: SpawnPoint[]): number {
  let moved = 0;
  const p = new THREE.Vector3();
  for (const s of spawns) {
    const floor = phys.raycast(_o.copy(s.pos).setY(s.pos.y + 1), DOWN, 2.5);
    const floorY = floor ? floor.point.y : s.pos.y;
    // 1. room to stand: move out of cramped spots
    let bestC = clearance(phys, s.pos);
    if (bestC < 1.2) {
      let best: THREE.Vector3 | null = null;
      for (let r = 0.75; r <= 3; r += 0.75) {
        for (let k = 0; k < 12; k++) {
          dirOf((k / 12) * Math.PI * 2, _d);
          if (free(phys, s.pos, _d, r + 0.5) < r + 0.4) continue; // must be able to walk there
          p.copy(s.pos).addScaledVector(_d, r);
          if (!standable(phys, p, floorY)) continue;
          if (spawns.some((o) => o !== s && Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 1.1 && Math.abs(o.pos.y - p.y) < 1.5)) continue; // never onto another spawn
          const c = clearance(phys, p) - r * 0.15;
          if (c > bestC + 0.2) {
            bestC = c;
            best = p.clone();
          }
        }
      }
      if (best) {
        s.pos.x = best.x;
        s.pos.z = best.z;
        moved++;
      }
    }
    // 2. face the way out: most free distance, mildly preferring the designed facing
    let bestYaw = s.yaw;
    let bestScore = -Infinity;
    for (let k = 0; k < 24; k++) {
      const yaw = s.yaw + (k / 24) * Math.PI * 2;
      const f = free(phys, s.pos, dirOf(yaw, _d), 30);
      let da = Math.abs(((yaw - s.yaw + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (!Number.isFinite(da)) da = 0;
      const score = Math.min(f, 30) - da * 2.5;
      if (score > bestScore) {
        bestScore = score;
        bestYaw = yaw;
      }
    }
    if (free(phys, s.pos, dirOf(s.yaw, _d), 30) < 6) s.yaw = bestYaw; // only re-aim spawns that face a nearby obstacle
  }
  return moved;
}
