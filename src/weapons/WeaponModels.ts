import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toonMat, glowMat } from '../render/Toon';
import { WeaponId, WEAPONS } from './WeaponDefs';
import { hazardTex } from '../render/Textures';

export interface WeaponModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  glows: THREE.Mesh[];
  /** parts that animate (drum spin, charge rings) */
  spin?: THREE.Object3D;
}

const gun = () => toonMat(0x2e3340, { spec: 0.9, rim: 0.5 });
const white = () => toonMat(0xe6e4de, { spec: 0.6, rim: 0.35 });
const gray = () => toonMat(0x7b8292, { spec: 0.8, rim: 0.4 });

/** bevelled boxes: soft specular edges read as machined parts instead of CG cubes */
const boxCache = new Map<string, THREE.BufferGeometry>();
function roundedBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let geo = boxCache.get(key);
  if (!geo) {
    const r = Math.min(0.018, Math.min(w, h, d) * 0.24);
    geo = new RoundedBoxGeometry(w, h, d, 2, r);
    boxCache.set(key, geo);
  }
  return geo;
}

function box(g: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(roundedBox(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  g.add(mesh);
  return mesh;
}
function cylZ(g: THREE.Object3D, r: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 16, rTop?: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop ?? r, r, len, seg), m);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}
function ring(g: THREE.Object3D, r: number, t: number, z: number, y: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, t, 6, 16), m);
  mesh.position.set(0, y, z);
  g.add(mesh);
  return mesh;
}

/** Stylised chunky sci-fi guns. Barrel points to -Z, grip near the origin. */
export function buildWeaponModel(id: WeaponId, tint?: number): WeaponModel {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  const glows: THREE.Mesh[] = [];
  const col = WEAPONS[id].color;
  const glow = glowMat(col, 2.2);
  let spin: THREE.Object3D | undefined;
  const accent = toonMat(tint ?? 0x2f7cf6, { spec: 0.6 });

  switch (id) {
    case 'pulse': {
      box(g, 0.09, 0.13, 0.5, 0, 0.03, -0.18, white());
      box(g, 0.07, 0.07, 0.3, 0, 0.1, -0.12, gun());
      cylZ(g, 0.03, 0.3, 0, 0.03, -0.55, gun());
      cylZ(g, 0.045, 0.08, 0, 0.03, -0.72, gray());
      box(g, 0.06, 0.16, 0.08, 0, -0.08, -0.02, gun(), -0.25); // grip
      box(g, 0.06, 0.18, 0.1, 0, -0.09, -0.24, gun(), 0.2); // magazine
      box(g, 0.07, 0.1, 0.22, 0, 0.0, 0.16, gun()); // stock
      box(g, 0.095, 0.04, 0.2, 0, 0.1, -0.3, accent);
      const cell = box(g, 0.1, 0.05, 0.14, 0, 0.0, -0.36, glow);
      glows.push(cell);
      box(g, 0.05, 0.05, 0.12, 0, 0.16, -0.12, gun()); // sight
      muzzle.position.set(0, 0.03, -0.78);
      break;
    }
    case 'rail': {
      box(g, 0.1, 0.14, 0.5, 0, 0.02, -0.12, gun());
      box(g, 0.035, 0.05, 0.75, 0.035, 0.05, -0.6, gray());
      box(g, 0.035, 0.05, 0.75, -0.035, 0.05, -0.6, gray());
      for (let i = 0; i < 5; i++) {
        const r = ring(g, 0.065, 0.014, -0.35 - i * 0.12, 0.05, glow);
        glows.push(r);
      }
      box(g, 0.06, 0.16, 0.08, 0, -0.09, 0.0, gun(), -0.25);
      box(g, 0.07, 0.12, 0.26, 0, 0.0, 0.25, white());
      cylZ(g, 0.035, 0.26, 0, 0.16, -0.08, gun()); // scope
      cylZ(g, 0.045, 0.04, 0, 0.16, -0.22, glowMat(0xb58cff, 1.5));
      box(g, 0.1, 0.03, 0.3, 0, 0.1, -0.1, accent);
      muzzle.position.set(0, 0.05, -1.0);
      break;
    }
    case 'plasma': {
      box(g, 0.14, 0.15, 0.42, 0, 0.02, -0.18, gun());
      cylZ(g, 0.07, 0.2, 0, 0.03, -0.46, white(), 10, 0.09);
      cylZ(g, 0.09, 0.05, 0, 0.03, -0.58, gray(), 10);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), glow);
      orb.position.set(0, 0.12, -0.2);
      g.add(orb);
      glows.push(orb);
      box(g, 0.16, 0.05, 0.14, 0, 0.12, -0.2, gray());
      box(g, 0.07, 0.17, 0.08, 0, -0.09, 0.0, gun(), -0.3);
      box(g, 0.08, 0.06, 0.2, 0, -0.06, -0.3, gun()); // pump
      box(g, 0.08, 0.12, 0.2, 0, 0.0, 0.14, white());
      box(g, 0.145, 0.04, 0.16, 0, -0.03, -0.12, accent);
      muzzle.position.set(0, 0.03, -0.62);
      break;
    }
    case 'glauncher': {
      const drum = cylZ(g, 0.1, 0.22, 0, 0.0, -0.18, toonMat(0xffc21a, { spec: 0.5 }), 8);
      spin = drum;
      cylZ(g, 0.055, 0.42, 0, 0.06, -0.42, gun());
      cylZ(g, 0.065, 0.06, 0, 0.06, -0.62, gray());
      box(g, 0.08, 0.1, 0.3, 0, 0.1, -0.1, gun());
      box(g, 0.06, 0.16, 0.08, 0, -0.12, 0.02, gun(), -0.25);
      box(g, 0.07, 0.1, 0.22, 0, -0.02, 0.18, gun());
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.05, 8), toonMat(0xffffff, { map: hazardTex() }));
      band.rotation.x = Math.PI / 2;
      band.position.set(0, 0, -0.18);
      g.add(band);
      const lamp = box(g, 0.03, 0.03, 0.06, 0.05, 0.15, -0.1, glow);
      glows.push(lamp);
      muzzle.position.set(0, 0.06, -0.66);
      break;
    }
    case 'twinarc': {
      // twin compact SMGs side by side (the model is held in the right hand; the left twin floats mirrored)
      for (const x of [0, -0.16]) {
        box(g, 0.07, 0.11, 0.3, x, 0.03, -0.1, white());
        box(g, 0.05, 0.14, 0.07, x, -0.07, 0.01, gun(), -0.25);
        cylZ(g, 0.024, 0.14, x, 0.04, -0.31, gun());
        for (let i = 0; i < 3; i++) glows.push(ring(g, 0.04, 0.01, -0.16 - i * 0.05, 0.04, glow));
        const r0 = glows[glows.length - 1];
        r0.position.x = x;
        box(g, 0.072, 0.03, 0.18, x, 0.1, -0.1, accent);
        box(g, 0.02, 0.08, 0.16, x, 0.02, -0.12, glow);
      }
      muzzle.position.set(-0.08, 0.04, -0.4);
      break;
    }
    case 'sealer': {
      // foam emitter: canister + wide nozzle + green glow tank
      box(g, 0.12, 0.13, 0.36, 0, 0.02, -0.12, white());
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 12), glow);
      tank.rotation.x = Math.PI / 2;
      tank.position.set(0, 0.13, -0.1);
      g.add(tank);
      glows.push(tank);
      cylZ(g, 0.05, 0.18, 0, 0.02, -0.38, gun(), 12, 0.07);
      cylZ(g, 0.075, 0.04, 0, 0.02, -0.48, gray(), 12);
      box(g, 0.06, 0.16, 0.08, 0, -0.09, 0.0, gun(), -0.25);
      box(g, 0.125, 0.04, 0.2, 0, -0.03, -0.14, accent);
      muzzle.position.set(0, 0.02, -0.52);
      break;
    }
    case 'blade': {
      // plasma katana: grip + guard + emissive blade core with a metal spine
      const grip = cylZ(g, 0.024, 0.2, 0, 0, 0.06, gun(), 10);
      grip.rotation.x = Math.PI / 2;
      box(g, 0.12, 0.03, 0.05, 0, 0, -0.05, accent);
      const bladeCore = box(g, 0.012, 0.075, 0.95, 0, 0.0, -0.55, glow);
      glows.push(bladeCore);
      box(g, 0.016, 0.02, 0.95, 0, 0.045, -0.55, gray());
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 4), glow);
      tip.rotation.x = -Math.PI / 2;
      tip.position.set(0, 0.005, -1.08);
      g.add(tip);
      glows.push(tip);
      muzzle.position.set(0, 0, -0.9);
      break;
    }
    case 'riveter': {
      box(g, 0.13, 0.15, 0.42, 0, 0.02, -0.15, toonMat(0xd8c9a8, { spec: 0.5 }));
      cylZ(g, 0.045, 0.3, 0, 0.04, -0.46, gun(), 10);
      cylZ(g, 0.06, 0.05, 0, 0.04, -0.62, gray(), 10);
      // rivet magazine drum on top
      const drum = cylZ(g, 0.06, 0.12, 0, 0.14, -0.1, toonMat(0xff9f43, { spec: 0.6 }), 12);
      drum.rotation.set(0, 0, Math.PI / 2);
      spin = drum;
      box(g, 0.06, 0.16, 0.08, 0, -0.09, 0.0, gun(), -0.25);
      box(g, 0.08, 0.1, 0.18, 0, 0.0, 0.16, gun());
      const coil = box(g, 0.135, 0.03, 0.12, 0, -0.03, -0.3, glow);
      glows.push(coil);
      muzzle.position.set(0, 0.04, -0.66);
      break;
    }
    case 'burst': {
      box(g, 0.08, 0.12, 0.56, 0, 0.03, -0.2, toonMat(0x3a3f4c, { spec: 0.8 }));
      box(g, 0.085, 0.05, 0.3, 0, 0.1, -0.16, toonMat(0xe6e14d, { spec: 0.5 }));
      cylZ(g, 0.026, 0.26, 0, 0.03, -0.58, gun());
      box(g, 0.06, 0.16, 0.08, 0, -0.08, -0.02, gun(), -0.25);
      box(g, 0.055, 0.2, 0.09, 0, -0.1, -0.26, gun(), 0.12);
      box(g, 0.07, 0.1, 0.24, 0, 0.0, 0.18, gun());
      cylZ(g, 0.03, 0.18, 0, 0.17, -0.12, gun()); // scope
      const lens = cylZ(g, 0.032, 0.01, 0, 0.17, -0.215, glow);
      glows.push(lens);
      // drone antenna
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.18), gray());
      ant.position.set(0.04, 0.2, 0.05);
      g.add(ant);
      muzzle.position.set(0, 0.03, -0.72);
      break;
    }
    case 'nuke': {
      const tube = cylZ(g, 0.13, 1.1, 0, 0.05, -0.3, toonMat(0xffc21a, { spec: 0.5 }), 14);
      tube.castShadow = true;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.18, 14), toonMat(0xffffff, { map: hazardTex() }));
      stripe.rotation.x = Math.PI / 2;
      stripe.position.set(0, 0.05, 0.05);
      g.add(stripe);
      cylZ(g, 0.15, 0.08, 0, 0.05, -0.86, gun(), 14);
      cylZ(g, 0.15, 0.1, 0, 0.05, 0.27, gun(), 14);
      // warhead peeking out
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 12), toonMat(0xd9d9d9, { spec: 1 }));
      head.rotation.x = -Math.PI / 2;
      head.position.set(0, 0.05, -0.95);
      g.add(head);
      const rad = new THREE.Mesh(new THREE.CircleGeometry(0.07, 3), toonMat(0x111111));
      rad.position.set(0.136, 0.05, -0.35);
      rad.rotation.y = Math.PI / 2;
      g.add(rad);
      box(g, 0.06, 0.16, 0.08, 0, -0.12, -0.1, gun(), -0.25);
      box(g, 0.06, 0.14, 0.08, 0, -0.1, -0.45, gun(), 0.2);
      box(g, 0.05, 0.12, 0.2, 0.14, 0.14, -0.2, gun()); // sight
      const l = box(g, 0.03, 0.03, 0.03, 0.14, 0.21, -0.28, glowMat(0xff3030, 4));
      glows.push(l);
      muzzle.position.set(0, 0.05, -1.05);
      break;
    }
    case 'singularity': {
      box(g, 0.16, 0.16, 0.5, 0, 0.02, -0.15, gun());
      const cage = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = box(cage, 0.02, 0.02, 0.3, Math.cos((i * Math.PI) / 2) * 0.1, Math.sin((i * Math.PI) / 2) * 0.1, 0, gray());
        b.userData.k = i;
      }
      cage.position.set(0, 0.03, -0.55);
      g.add(cage);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), glowMat(0xb06cff, 3));
      orb.position.set(0, 0.03, -0.55);
      g.add(orb);
      glows.push(orb);
      spin = cage;
      box(g, 0.07, 0.17, 0.08, 0, -0.1, 0.02, gun(), -0.3);
      box(g, 0.17, 0.05, 0.3, 0, 0.12, -0.15, toonMat(0x6b3fb0, { spec: 0.6 }));
      muzzle.position.set(0, 0.03, -0.75);
      break;
    }
    case 'helios': {
      box(g, 0.16, 0.1, 0.26, 0, 0.03, -0.12, white());
      box(g, 0.14, 0.02, 0.2, 0, 0.09, -0.12, glowMat(0xff6060, 1.4));
      cylZ(g, 0.03, 0.14, 0, 0.03, -0.3, gun());
      const lens = cylZ(g, 0.035, 0.02, 0, 0.03, -0.38, glowMat(0xff3030, 4));
      glows.push(lens);
      box(g, 0.06, 0.14, 0.07, 0, -0.07, 0.0, gun(), -0.25);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.25), gray());
      ant.position.set(0.06, 0.2, 0.0);
      g.add(ant);
      muzzle.position.set(0, 0.03, -0.4);
      break;
    }
  }
  g.add(muzzle);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return { group: g, muzzle, glows, spin };
}
