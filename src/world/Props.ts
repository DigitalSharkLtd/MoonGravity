import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { Noise } from '../core/Noise';
import { PhysicsWorld } from '../core/Physics';
import { MapDef } from './MapDefs';
import { toonMat } from '../render/Toon';

function rockGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const n = new Noise(seed);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const flat = 0.55 + (seed % 5) * 0.08;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = 1 + 0.28 * n.noise3(v.x * 1.3, v.y * 1.3, v.z * 1.3) + 0.12 * n.noise3(v.x * 3, v.y * 3, v.z * 3);
    v.multiplyScalar(d);
    v.y *= flat;
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3; // flat-ish bottom
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/**
 * Boulders + pebbles scattered over the terrain (instanced). Big boulders get sphere colliders.
 */
export function scatterRocks(scene: THREE.Group, world: PhysicsWorld, def: MapDef, avoid: (x: number, z: number, r: number) => boolean): void {
  const rng = new Rng(def.seed + 777);
  const hf = world.hf;
  const variants = 5;
  const geos = Array.from({ length: variants }, (_, i) => {
    const g = rockGeometry(def.seed + i * 13, 1);
    g.computeVertexNormals();
    return g;
  });
  const mats = [toonMat(0x9c988f, { flat: true, rim: 0.25 }), toonMat(0x8a877f, { flat: true, rim: 0.25 }), toonMat(0xaaa59b, { flat: true, rim: 0.25 })];
  const perVariant: THREE.Matrix4[][] = geos.map(() => []);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const ex = def.halfX + def.margin * 0.7;
  const ez = def.halfZ + def.margin * 0.7;
  const count = Math.floor(((ex * ez) / 900) * 12);
  const nrm = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const x = rng.range(-ex, ex);
    const z = rng.range(-ez, ez);
    // log-normal-ish sizes: mostly small, a few large boulders
    const u = rng.next();
    const size = 0.18 + Math.pow(u, 5) * 2.6;
    if (avoid(x, z, size + 1.5)) continue;
    hf.normalAt(x, z, nrm);
    if (nrm.y < 0.72 && size > 0.6) continue;
    const y = hf.heightAt(x, z) - size * 0.25;
    p.set(x, y, z);
    e.set(rng.range(-0.3, 0.3), rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3));
    q.setFromEuler(e);
    s.set(size * rng.range(0.8, 1.3), size * rng.range(0.7, 1.1), size * rng.range(0.8, 1.3));
    m.compose(p, q, s);
    perVariant[i % variants].push(m.clone());
    if (size > 0.7 && Math.abs(x) < def.halfX + 2 && Math.abs(z) < def.halfZ + 2) {
      world.addSphere(new THREE.Vector3(x, y + size * 0.1, z), size * 0.78, false);
    }
  }
  // clusters of boulders on crater rims
  perVariant.forEach((list, vi) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geos[vi], mats[vi % mats.length], list.length);
    list.forEach((mm, k) => mesh.setMatrixAt(k, mm));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  });
}
