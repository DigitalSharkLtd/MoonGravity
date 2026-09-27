import * as THREE from 'three';
import { toonMat, glowMat } from '../render/Toon';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';
import { P2, side, sect, latheY, rbox, put, mergeStatic, bandGeo } from '../render/HardSurface';
import { hazardTex } from '../render/Textures';
import type { PickupKind } from '../world/Layouts';

/*
 * Match props: pickup pads (+ floating items) and the supply drop-pod.
 * Contract used by Match: pickup group children named 'ring' (scaled around the pad centre)
 * and 'item' (spins around Y, bobs around y = 0.8); pod returns its group and the beacon beam.
 */

const white = () => toonMat(0xaeaca6, { spec: 0.5, rim: 0.4 });
const dark = () => toonMat(0x2c313c, { spec: 0.9, rim: 0.45 });
const steel = () => toonMat(0x9098a6, { spec: 0.85, rim: 0.4 });

function lit(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = put(parent, geo, mat, x, y, z, rx, ry, rz);
  m.layers.set(LAYER_NO_OUTLINE);
  return m;
}

export const PICKUP_COLOR: Record<PickupKind, number> = { o2: 0x7dd8ff, armor: 0xffd24a, ammo: 0xff8a3a, grenade: 0x9dff7a };

export function buildPickupMesh(kind: PickupKind): THREE.Group {
  const g = new THREE.Group();
  const col = PICKUP_COLOR[kind];
  const D = dark();
  const S = steel();
  const glow = glowMat(col, 1.8);
  // pad: octagonal chamfered base, inner steel deck, emitter lights at the corners
  const base = new THREE.Group();
  put(base, latheY([[0, 0], [0.8, 0], [0.84, 0.04], [0.8, 0.1], [0.7, 0.13], [0, 0.13]], 8, { phase: Math.PI / 8 }), D);
  put(base, latheY([[0, 0.13], [0.56, 0.13], [0.58, 0.145], [0.0, 0.145]], 8, { phase: Math.PI / 8 }), S);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    lit(base, rbox(0.1, 0.03, 0.05, 0.01), glow, Math.cos(a) * 0.74, 0.11, Math.sin(a) * 0.74, 0, -a, 0);
  }
  mergeStatic(base);
  base.traverse((o) => ((o as THREE.Mesh).receiveShadow = true));
  g.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.022, 6, 40), glowMat(col, 1.8));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.15;
  ring.name = 'ring';
  ring.layers.set(LAYER_NO_OUTLINE);
  g.add(ring);
  // floating item
  const item = new THREE.Group();
  if (kind === 'o2') {
    // oxygen bottle: white tank, blue lit band, steel valve + hand wheel
    put(item, latheY([[0, -0.3], [0.1, -0.3], [0.15, -0.26], [0.16, -0.2], [0.16, 0.16], [0.14, 0.23], [0.08, 0.28], [0.04, 0.29], [0, 0.29]], 18), white());
    lit(item, latheY([[0.162, -0.06], [0.168, -0.055], [0.168, 0.055], [0.162, 0.06]], 18), glow);
    for (const y of [-0.2, 0.14]) put(item, latheY([[0.16, y - 0.015], [0.166, y - 0.01], [0.166, y + 0.01], [0.16, y + 0.015]], 18), D);
    put(item, latheY([[0, 0.28], [0.035, 0.28], [0.035, 0.34], [0.025, 0.36], [0, 0.36]], 10), S);
    put(item, new THREE.TorusGeometry(0.045, 0.01, 6, 14), D, 0, 0.36, 0, Math.PI / 2);
  } else if (kind === 'armor') {
    // armour plate: chevron shield, lit cross emblem, side clamps
    const shieldPts: P2[] = [[-0.22, 0.24, 0.03], [0.22, 0.24, 0.03], [0.24, -0.02, 0.04], [0.0, -0.3, 0.02], [-0.24, -0.02, 0.04]];
    put(item, sect(shieldPts, -0.05, 0.05, { bevel: 0.02 }), toonMat(0xc9971d, { spec: 0.8, rim: 0.4 }));
    put(item, sect(shieldPts.map((p) => [p[0] * 0.8, p[1] * 0.8 - 0.01, 0.02] as P2), -0.06, 0.06, { bevel: 0.012 }), D);
    lit(item, sect([[-0.14, -0.03], [0.14, -0.03], [0.14, 0.03], [-0.14, 0.03]].map((p) => [p[0], p[1], 0.01] as P2), -0.07, 0.07, { bevel: 0.006 }), glowMat(0xfff4d0, 1.8), 0, 0.02, 0);
    lit(item, sect([[-0.03, -0.14], [0.03, -0.14], [0.03, 0.14], [-0.03, 0.14]].map((p) => [p[0], p[1], 0.01] as P2), -0.071, 0.071, { bevel: 0.006 }), glowMat(0xfff4d0, 1.8), 0, 0.02, 0);
    for (const sx of [1, -1]) put(item, rbox(0.05, 0.14, 0.12, 0.015), S, sx * 0.24, 0.1, 0);
  } else if (kind === 'ammo') {
    // ammo crate: chamfered box, lit stripe, lid, carry handles, rounds peeking out
    put(item, sect([[-0.26, -0.16, 0.03], [0.26, -0.16, 0.03], [0.26, 0.12, 0.03], [-0.26, 0.12, 0.03]], -0.16, 0.16, { bevel: 0.02 }), toonMat(0x4a5360, { spec: 0.6, rim: 0.4 }));
    put(item, sect([[-0.27, 0.1, 0.02], [0.27, 0.1, 0.02], [0.27, 0.16, 0.02], [-0.27, 0.16, 0.02]], -0.17, 0.17, { bevel: 0.012 }), D);
    lit(item, sect([[-0.265, -0.04], [0.265, -0.04], [0.265, 0.0], [-0.265, 0.0]], -0.165, 0.165, { bevel: 0.004 }), glow);
    for (const sx of [1, -1]) put(item, new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), S, sx * 0.27, 0.02, 0, 0, Math.PI / 2, -Math.PI / 2 * sx);
    const round = latheY([[0, 0], [0.024, 0], [0.024, 0.08], [0.014, 0.11], [0, 0.12]], 10);
    for (let i = 0; i < 4; i++) put(item, round, toonMat(0xb08a3a, { spec: 0.85, rim: 0.4 }), -0.12 + i * 0.08, 0.15, 0.04);
  } else {
    // grenade: segmented shell, lit core band, spoon + pin ring
    put(item, new THREE.SphereGeometry(0.16, 18, 14), toonMat(0x39424f, { spec: 0.8, rim: 0.4 }));
    for (let i = 0; i < 3; i++) put(item, new THREE.TorusGeometry(0.158, 0.012, 6, 24), D, 0, 0, 0, 0, (i * Math.PI) / 3, 0);
    lit(item, latheY([[0.15, -0.025], [0.168, -0.02], [0.168, 0.02], [0.15, 0.025]], 20), glow);
    put(item, latheY([[0, 0.14], [0.05, 0.14], [0.055, 0.2], [0.03, 0.22], [0, 0.22]], 12), S);
    put(item, side([[0.02, 0.2, 0.01], [-0.02, 0.2, 0.01], [-0.14, 0.02, 0.02], [-0.11, 0.02, 0.01], [0.0, 0.17, 0.01]], 0.04, { bevel: 0.006 }), S);
    put(item, new THREE.TorusGeometry(0.035, 0.007, 6, 14), S, 0.06, 0.2, 0, 0, Math.PI / 2, 0);
  }
  mergeStatic(item);
  item.position.y = 0.8;
  item.name = 'item';
  item.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o.layers.mask & (1 << LAYER_NO_OUTLINE))) (o as THREE.Mesh).castShadow = true;
  });
  g.add(item);
  return g;
}

/** supply drop-pod: armoured capsule with a nose cone, hazard band, fins, landing legs, lit windows; beacon beam */
export function buildPodMesh(): { mesh: THREE.Group; beacon: THREE.Mesh } {
  const mesh = new THREE.Group();
  const W = white();
  const D = dark();
  const S = steel();
  const orange = toonMat(0xc4581a, { spec: 0.6, rim: 0.4 });
  const glow = glowMat(0xffd24a, 1.8);
  // hull
  put(mesh, latheY([[0, 0.12], [0.62, 0.12], [0.78, 0.26], [0.84, 0.5], [0.84, 1.5], [0.8, 1.72], [0.72, 1.8], [0, 1.8]], 12, { phase: Math.PI / 12 }), W);
  put(mesh, latheY([[0.4, 0.0], [0.58, 0.0], [0.66, 0.12], [0.4, 0.14]], 12, { phase: Math.PI / 12 }), D);
  put(mesh, latheY([[0.18, 0.13], [0.3, 0.02], [0.34, 0.0], [0.3, 0.0], [0.12, 0.1]], 12), S);
  // nose cone + tip light
  put(mesh, latheY([[0, 1.78], [0.74, 1.78], [0.66, 1.94], [0.44, 2.2], [0.22, 2.38], [0.1, 2.45], [0, 2.47]], 12, { phase: Math.PI / 12 }), orange);
  lit(mesh, new THREE.SphereGeometry(0.08, 10, 8), glowMat(0xff5030, 3), 0, 2.46, 0);
  // armour ribs + hazard band + lit band
  for (const y of [0.55, 1.45]) put(mesh, latheY([[0.84, y - 0.07], [0.89, y - 0.05], [0.89, y + 0.05], [0.84, y + 0.07]], 12, { phase: Math.PI / 12 }), D);
  const hz = new THREE.Mesh(bandGeo(0.846, 0.18, 12), toonMat(0xffffff, { map: hazardTex(), spec: 0.4 }));
  hz.position.y = 0.8;
  hz.rotation.y = Math.PI / 12;
  mesh.add(hz);
  lit(mesh, latheY([[0.845, 1.14], [0.855, 1.15], [0.855, 1.25], [0.845, 1.26]], 12, { phase: Math.PI / 12 }), glow);
  // hatch windows (lit) on three sides + frames
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const r = 0.83;
    put(mesh, sect([[-0.2, -0.16, 0.05], [0.2, -0.16, 0.05], [0.2, 0.16, 0.05], [-0.2, 0.16, 0.05]], -0.04, 0.04, { holes: [[[-0.14, -0.1, 0.03], [0.14, -0.1, 0.03], [0.14, 0.1, 0.03], [-0.14, 0.1, 0.03]]], bevel: 0.012 }), D, Math.sin(a) * r, 1.02, Math.cos(a) * r, 0, a, 0);
    lit(mesh, new THREE.PlaneGeometry(0.28, 0.2), glowMat(0xffd24a, 1.4), Math.sin(a) * (r - 0.01), 1.02, Math.cos(a) * (r - 0.01), 0, a, 0);
  }
  // fins (between the windows) + landing legs with pads
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
    const fin = side([[0.0, 0.3, 0.02], [0.3, 0.1, 0.03], [0.34, 0.9, 0.05], [0.0, 1.3, 0.02]], 0.06, { bevel: 0.015 });
    put(mesh, fin, orange, Math.sin(a) * 0.8, 0, Math.cos(a) * 0.8, 0, a + Math.PI, 0);
    const leg = side([[0.0, 0.5, 0.02], [0.1, 0.5, 0.02], [0.45, 0.04, 0.02], [0.3, 0.04, 0.02]], 0.08, { bevel: 0.012 });
    put(mesh, leg, D, Math.sin(a + 0.35) * 0.72, 0, Math.cos(a + 0.35) * 0.72, 0, a + 0.35 + Math.PI, 0);
    put(mesh, rbox(0.22, 0.05, 0.22, 0.02), S, Math.sin(a + 0.35) * 1.12, 0.025, Math.cos(a + 0.35) * 1.12, 0, a + 0.35, 0);
  }
  mergeStatic(mesh);
  mesh.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o.layers.mask & (1 << LAYER_NO_OUTLINE))) (o as THREE.Mesh).castShadow = true;
  });
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 120, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd24a).multiplyScalar(2), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  beacon.position.y = 60;
  beacon.layers.set(LAYER_NO_OUTLINE);
  beacon.visible = false;
  mesh.add(beacon);
  return { mesh, beacon };
}

