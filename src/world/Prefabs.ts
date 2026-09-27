import * as THREE from 'three';
import { StructureBuilder, Frame, Mat } from './Builder';
import { glowMat, toonMat } from '../render/Toon';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';
import { Rng } from '../core/Rng';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const Y = new THREE.Vector3(0, 1, 0);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const qY = (a: number) => new THREE.Quaternion().setFromAxisAngle(Y, a);
const qAxis = (axis: THREE.Vector3, a: number) => new THREE.Quaternion().setFromAxisAngle(axis, a);

export function teamMat(team: number | null): Mat {
  return team === 0 ? 'team0' : team === 1 ? 'team1' : 'yellow';
}
export function teamGlow(team: number | null): Mat {
  return team === 0 ? 'team0Glow' : team === 1 ? 'team1Glow' : 'ore';
}

/** Local-frame helper: transforms local positions/directions into world. */
class L {
  constructor(public b: StructureBuilder, public f: Frame) {}
  p(x: number, y: number, z: number): THREE.Vector3 {
    return this.b.tf(this.f, x, y, z);
  }
  d(x: number, y: number, z: number): THREE.Vector3 {
    const c = Math.cos(this.f.rot);
    const s = Math.sin(this.f.rot);
    return V(x * c + z * s, y, -x * s + z * c);
  }
  q(extra?: THREE.Quaternion): THREE.Quaternion {
    const q = qY(this.f.rot);
    return extra ? q.multiply(extra) : q;
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, mat: Mat, opts: { collide?: boolean; metal?: boolean; rot?: number; tilt?: THREE.Quaternion } = {}) {
    const q = this.q(opts.tilt ? qY(opts.rot ?? 0).multiply(opts.tilt) : qY(opts.rot ?? 0));
    return this.b.box(this.p(x, y, z), w, h, d, 0, mat, { collide: opts.collide, metal: opts.metal, quat: q });
  }
  cylY(x: number, y: number, z: number, r: number, h: number, mat: Mat, opts: { collide?: boolean; seg?: number; rTop?: number } = {}) {
    return this.b.cyl(this.p(x, y, z), r, h, mat, { ...opts, quat: this.q() });
  }
  /** horizontal cylinder along local X */
  cylX(x: number, y: number, z: number, r: number, len: number, mat: Mat, opts: { collide?: boolean; seg?: number } = {}) {
    return this.b.cyl(this.p(x, y, z), r, len, mat, { ...opts, quat: this.q(qAxis(V(0, 0, 1), Math.PI / 2)) });
  }
  /** horizontal cylinder along local Z */
  cylZ(x: number, y: number, z: number, r: number, len: number, mat: Mat, opts: { collide?: boolean; seg?: number } = {}) {
    return this.b.cyl(this.p(x, y, z), r, len, mat, { ...opts, quat: this.q(qAxis(V(1, 0, 0), Math.PI / 2)) });
  }
  beam(a: [number, number, number], bb: [number, number, number], t: number, mat: Mat, opts: { collide?: boolean; round?: boolean } = {}) {
    this.b.beam(this.p(...a), this.p(...bb), t, mat, opts);
  }
  panel(x: number, y: number, z: number, w: number, h: number, nx: number, ny: number, nz: number, mat: Mat) {
    this.b.panel(this.p(x, y, z), w, h, this.d(nx, ny, nz), mat);
  }
}

// ---------------------------------------------------------------------------
// animated helpers

export function beacon(b: StructureBuilder, pos: THREE.Vector3, color = 0xff3a2a, period = 1.6, phase = 0): void {
  b.beacon(pos, color, period, phase);
}

function spinner(b: StructureBuilder, obj: THREE.Object3D, axis: THREE.Vector3, speed: number): void {
  b.group.add(obj);
  b.animated.push({
    update(_t, dt) {
      obj.rotateOnAxis(axis, speed * dt);
    },
  });
}

// ---------------------------------------------------------------------------
// prefabs

/** Horizontal pressurised habitat module on legs. */
export function habModule(b: StructureBuilder, f: Frame, len: number, team: number | null): void {
  const l = new L(b, f);
  const r = 2.1;
  const cy = r + 0.8;
  l.cylX(0, cy, 0, r, len, 'hull', { seg: 28 });
  // end caps (squashed spheres)
  for (const s of [-1, 1]) {
    const g = new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    b.add('hullGray', g, l.p((s * len) / 2, cy, 0), l.q(qAxis(V(0, 0, 1), -s * Math.PI / 2)), V(1, 0.42, 1));
    l.cylX((s * (len + 0.7)) / 2, cy, 0, r * 0.8, 0.7, 'hullGray', { seg: 20 });
  }
  // ribs + team bands
  const ribQ = l.q(qY(Math.PI / 2));
  for (let x = -len / 2 + 0.6; x <= len / 2 - 0.5; x += 2.4) b.torus(l.p(x, cy, 0), r + 0.02, 0.09, ribQ, 'darkPanel');
  const tm = teamMat(team);
  for (const s of [-1, 1]) l.cylX((s * len) / 2 - s * 1.1, cy, 0, r + 0.05, 0.5, tm, { collide: false, seg: 28 });
  // windows
  for (let x = -len / 2 + 1.8; x <= len / 2 - 1.8; x += 1.6) {
    for (const s of [-1, 1]) {
      const n = l.d(0, 0.28, s).normalize();
      b.panel(l.p(x, cy + 0.55, s * (r - 0.05)), 0.75, 0.42, n, 'glassWarm');
    }
  }
  // legs + pads
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (len / 2 - 1.2);
      const z = sz * 1.3;
      l.beam([x, 0.1, z * 1.35], [x, cy - r * 0.7, z * 0.8], 0.22, 'dark');
      l.cylY(x, 0.08, z * 1.35, 0.45, 0.16, 'dark', { collide: false, seg: 10 });
    }
  }
  // roof gear: radiator fins + antenna
  l.box(len * 0.18, cy + r + 0.25, 0, 2.4, 0.5, 1.2, 'darkPanel');
  l.box(-len * 0.2, cy + r + 0.3, 0, 1.2, 0.6, 1.2, 'vent');
  l.beam([-len * 0.2, cy + r + 0.6, 0], [-len * 0.2, cy + r + 2.6, 0], 0.08, 'steel', { round: true });
  beacon(b, l.p(-len * 0.2, cy + r + 2.7, 0), team === 1 ? 0xffa033 : team === 0 ? 0x4dd8ff : 0xff3a2a, 2.2, f.x * 0.013);
}

/** Pressurised dome with entrance tunnel. Entrance faces local +X. */
export function domeHab(b: StructureBuilder, f: Frame, r: number, team: number | null): void {
  const l = new L(b, f);
  b.dome(l.p(0, 0.4, 0), r, 'hull', { seg: 40 });
  l.cylY(0, 0.4, 0, r + 0.35, 1.3, 'darkPanel', { seg: 40 });
  // meridian ribs
  for (let i = 0; i < 8; i++) {
    const q = l.q(qY((i * Math.PI) / 8));
    b.torus(l.p(0, 0.4, 0), r + 0.03, 0.08, q, 'darkPanel', Math.PI);
  }
  const tm = teamMat(team);
  b.torus(l.p(0, 0.4 + r * 0.32, 0), Math.sqrt(r * r - (r * 0.32) ** 2) + 0.03, 0.16, qAxis(V(1, 0, 0), Math.PI / 2), tm);
  // window band
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const h = r * 0.55;
    const rr = Math.sqrt(r * r - h * h);
    const n = V(Math.cos(a) * rr, h, Math.sin(a) * rr).normalize();
    b.panel(l.p(0, 0.4, 0).addScaledVector(n, r), r * 0.22, r * 0.1, n, 'glassBlue');
  }
  // entrance tunnel along +X
  const tl = 3.6;
  l.cylX(r - 0.4 + tl / 2, 1.55, 0, 1.45, tl, 'hullGray', { seg: 20 });
  l.box(r - 0.4 + tl + 0.1, 1.45, 0, 0.4, 2.8, 2.8, 'darkPanel');
  l.panel(r - 0.4 + tl + 0.32, 1.35, 0, 1.3, 2.0, 1, 0, 0, teamGlow(team));
  l.panel(r - 0.4 + tl + 0.32, 2.75, 0, 2.6, 0.35, 1, 0, 0, 'hazard');
  // top: antenna + beacon
  l.cylY(0, r + 0.4, 0, 0.8, 0.6, 'darkPanel', { collide: false, seg: 12 });
  l.beam([0, r + 0.6, 0], [0, r + 3.4, 0], 0.1, 'steel', { round: true });
  beacon(b, l.p(0, r + 3.5, 0), 0xff3a2a, 1.8, f.z * 0.01);
}

/** Lattice comm tower with a sniper platform. Legs are metal → climbable with mag-boots. */
export function commTower(b: StructureBuilder, f: Frame, h: number, team: number | null): void {
  const l = new L(b, f);
  const base = 1.8;
  const top = 1.1;
  const legs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [sx, sz] of legs) {
    l.beam([sx * base, -0.5, sz * base], [sx * top, h, sz * top], 0.32, 'steel', { collide: true });
    l.box(sx * base, 0.2, sz * base, 0.9, 0.4, 0.9, 'dark', { collide: false });
  }
  const levels = Math.floor(h / 3.2);
  for (let i = 0; i < levels; i++) {
    const y0 = (i * h) / levels;
    const y1 = ((i + 1) * h) / levels;
    const w0 = base + (top - base) * (y0 / h);
    const w1 = base + (top - base) * (y1 / h);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = legs[k];
      const [bx, bz] = legs[(k + 1) % 4];
      l.beam([ax * w0, y0, az * w0], [bx * w1, y1, bz * w1], 0.1, 'dark');
      l.beam([ax * w1, y1, az * w1], [bx * w1, y1, bz * w1], 0.12, 'dark');
    }
  }
  // platform
  l.box(0, h + 0.2, 0, 4.6, 0.4, 4.6, 'grid');
  l.box(0, h - 0.1, 0, 4.8, 0.2, 4.8, teamMat(team), { collide: false });
  for (const [sx, sz] of legs) l.beam([sx * 2.2, h + 0.4, sz * 2.2], [sx * 2.2, h + 1.5, sz * 2.2], 0.1, 'steel');
  for (let k = 0; k < 4; k++) {
    const [ax, az] = legs[k];
    const [bx, bz] = legs[(k + 1) % 4];
    l.beam([ax * 2.2, h + 1.5, az * 2.2], [bx * 2.2, h + 1.5, bz * 2.2], 0.1, 'yellow');
  }
  // cabin half-cover
  l.box(-1.2, h + 1.1, 0, 0.3, 1.4, 4.2, 'hullGray');
  // dish
  const dish = new THREE.Group();
  const dg = new THREE.SphereGeometry(1.6, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.32);
  const dm = new THREE.Mesh(dg, toonMat(0xe8e6e0, { side: THREE.DoubleSide, spec: 0.5 }));
  dm.rotation.x = Math.PI / 2;
  dm.castShadow = true;
  dish.add(dm);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), toonMat(0x3b4150));
  feed.rotation.x = Math.PI / 2;
  feed.position.z = 0.9;
  dish.add(feed);
  dish.position.copy(l.p(0.6, h + 3.4, 0.6));
  const pole = l.p(0.6, h + 0.4, 0.6);
  b.beam(pole, l.p(0.6, h + 3.2, 0.6), 0.16, 'steel');
  spinner(b, dish, Y, 0.35);
  beacon(b, l.p(0, h + 5.3, 0), 0xff3a2a, 1.4, f.x * 0.02);
  l.beam([-0.6, h + 0.4, -0.6], [-0.6, h + 5.2, -0.6], 0.07, 'steel', { round: true });
}

/** Hangar with walkable interior ceiling. Opening faces local +Z. */
export function hangar(b: StructureBuilder, f: Frame, w: number, d: number, h: number, team: number | null): void {
  const l = new L(b, f);
  const t = 0.7;
  l.box(-w / 2, h / 2, 0, t, h, d, 'hull');
  l.box(w / 2, h / 2, 0, t, h, d, 'hull');
  l.box(0, h / 2, -d / 2, w, h, t, 'hull');
  l.box(0, h + 0.45, 0, w + 1.2, 0.9, d + 1.2, 'hullGray');
  // floor slab
  l.box(0, 0.1, 0, w - t, 0.3, d - t, 'grid');
  // header over the opening
  l.box(0, h - 0.6, d / 2 + 0.1, w + 1.2, 1.2, 0.6, teamMat(team), { collide: false });
  l.panel(0, h - 0.6, d / 2 + 0.42, Math.min(8, w * 0.55), 1.0, 0, 0, 1, team === 0 ? 'label0' : team === 1 ? 'label1' : 'labelMine');
  // hazard door frame
  for (const s of [-1, 1]) {
    l.box(s * (w / 2 - 0.1), h / 2, d / 2 + 0.05, 1.0, h, 0.6, 'dark', { collide: false });
    l.panel(s * (w / 2 - 0.1), 1.4, d / 2 + 0.36, 0.8, 2.6, 0, 0, 1, 'hazard');
  }
  // buttresses along sides
  for (let z = -d / 2 + 2; z < d / 2 - 1; z += 4) {
    for (const s of [-1, 1]) l.box(s * (w / 2 + 0.5), h * 0.4, z, 0.8, h * 0.8, 0.8, 'darkPanel');
  }
  // ceiling light strips (visible when walking upside down)
  for (let x = -w / 2 + 2.5; x <= w / 2 - 2.5; x += 4) {
    l.box(x, h - 0.05, 0, 0.35, 0.1, d - 3, 'lamp', { collide: false });
  }
  // interior wall stripes
  l.panel(0, 2.2, -d / 2 + 0.36, w - 2, 0.4, 0, 0, 1, teamGlow(team));
  // roof gear
  l.box(w * 0.25, h + 1.3, -d * 0.2, 3, 0.8, 2, 'vent');
  l.box(-w * 0.25, h + 1.2, d * 0.15, 2, 0.6, 3, 'darkPanel');
  beacon(b, l.p(-w / 2, h + 1.2, d / 2), 0xff3a2a, 1.3, 0.2);
  beacon(b, l.p(w / 2, h + 1.2, d / 2), 0xff3a2a, 1.3, 0.7);
}

/** Armored defensive wall segment between two local points. */
export function armorWall(b: StructureBuilder, x1: number, z1: number, x2: number, z2: number, h: number, team: number | null): void {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const rot = Math.atan2(-dz, dx);
  const mx = (x1 + x2) / 2;
  const mz = (z1 + z2) / 2;
  const gy = Math.min(b.ground(x1, z1), b.ground(x2, z2), b.ground(mx, mz));
  const f: Frame = { x: mx, y: gy, z: mz, rot };
  const l = new L(b, f);
  l.box(0, (h + 1) / 2 - 1, 0, len, h + 1, 1.2, 'hullGray');
  l.box(0, h + 0.15, 0, len + 0.2, 0.3, 1.5, 'dark');
  for (const s of [-1, 1]) l.panel(0, h - 0.6, s * 0.61, len - 0.4, 0.22, 0, 0, s, teamGlow(team));
  for (let x = -len / 2 + 1; x <= len / 2 - 0.5; x += 3.5) {
    for (const s of [-1, 1]) l.box(x, h / 2 - 0.4, s * 0.8, 0.8, h - 0.6, 0.5, 'darkPanel', { collide: false });
  }
}

/** Low cover block / barricade. */
export function barricade(b: StructureBuilder, f: Frame, len: number, team: number | null): void {
  const l = new L(b, f);
  l.box(0, 0.55, 0, len, 1.5, 0.9, 'darkPanel');
  l.box(0, 1.35, 0, len + 0.1, 0.15, 1.0, teamMat(team), { collide: false });
  l.panel(0, 0.7, 0.46, len - 0.3, 0.5, 0, 0, 1, 'hazard');
  l.panel(0, 0.7, -0.46, len - 0.3, 0.5, 0, 0, -1, 'hazard');
}

const CONTAINERS: Mat[] = ['containerRed', 'containerBlue', 'containerGreen', 'containerWhite'];

/** Cargo container stack for cover. */
export function containers(b: StructureBuilder, f: Frame, layout: [number, number, number, number][], seed: number): void {
  const l = new L(b, f);
  const rng = new Rng(seed);
  for (const [x, z, level, rot] of layout) {
    const mat = rng.pick(CONTAINERS);
    l.box(x, 1.25 + level * 2.5, z, 2.4, 2.5, 5.8, mat, { rot });
  }
}

export function crate(b: StructureBuilder, f: Frame, s = 1.2): void {
  const l = new L(b, f);
  l.box(0, s / 2, 0, s, s, s, 'darkPanel');
  l.box(0, s / 2, 0, s + 0.05, s * 0.2, s + 0.05, 'yellow', { collide: false });
}

/** Landing pad with a gold-foil lander. */
export function landingPad(b: StructureBuilder, f: Frame, r: number, team: number | null, withLander = true): void {
  const l = new L(b, f);
  l.cylY(0, 0.2, 0, r, 0.5, 'darkPanel', { seg: 40 });
  b.torus(l.p(0, 0.47, 0), r * 0.75, 0.12, qAxis(V(1, 0, 0), Math.PI / 2), teamGlow(team));
  l.box(0, 0.47, 0, r * 0.9, 0.04, 0.5, 'yellow', { collide: false });
  l.box(0, 0.47, 0, 0.5, 0.04, r * 0.9, 'yellow', { collide: false });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    beacon(b, l.p(Math.cos(a) * (r - 0.3), 0.6, Math.sin(a) * (r - 0.3)), 0x40ff80, 1.2, i / 8);
  }
  if (!withLander) return;
  // lander: octagonal descent stage in gold foil, ascent cabin on top
  l.cylY(0, 2.3, 0, 2.2, 1.9, 'gold', { seg: 8 });
  l.cylY(0, 4.1, 0, 1.6, 1.8, 'hullGray', { seg: 8, rTop: 1.2 });
  l.panel(0, 4.2, 1.45, 0.9, 0.6, 0, 0.2, 1, 'glassBlue');
  l.cylY(0, 5.2, 0, 0.5, 0.4, teamMat(team), { collide: false, seg: 8 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    l.beam([cx * 1.9, 2.0, cz * 1.9], [cx * 3.2, 0.5, cz * 3.2], 0.16, 'steel', { round: true, collide: true });
    l.cylY(cx * 3.3, 0.55, cz * 3.3, 0.45, 0.12, 'dark', { collide: false });
  }
  l.cylY(0, 1.1, 0, 0.8, 0.8, 'dark', { collide: false, seg: 12, rTop: 0.4 });
}

export function solarArray(b: StructureBuilder, f: Frame, n: number): void {
  const l = new L(b, f);
  const tilt = qAxis(V(1, 0, 0), -0.55);
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 3.6;
    l.beam([x, 0, 0], [x, 1.7, 0], 0.14, 'steel', { round: true, collide: true });
    l.box(x, 2.0, 0, 3.3, 0.08, 2.2, 'solar', { tilt });
    l.box(x, 1.95, 0, 3.4, 0.05, 2.3, 'dark', { tilt, collide: false });
  }
}

export function lightPole(b: StructureBuilder, f: Frame, h = 6): void {
  const l = new L(b, f);
  l.beam([0, -0.3, 0], [0, h, 0], 0.18, 'steel', { round: true, collide: true });
  l.beam([0, h, 0], [0.9, h + 0.2, 0], 0.12, 'steel', { round: true });
  l.box(1.0, h + 0.05, 0, 0.9, 0.25, 0.5, 'dark', { collide: false });
  l.box(1.0, h - 0.1, 0, 0.75, 0.06, 0.38, 'lamp', { collide: false });
  b.lamps.push(l.p(1.0, h - 0.4, 0));
}

/** Truss bridge between two points at a given deck height (world). Underside is ceiling-walkable. */
export function bridge(b: StructureBuilder, x1: number, z1: number, x2: number, z2: number, deckY: number, width = 3.6, o: { cover?: boolean; keep?: [number, number][] } = {}): void {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const rot = Math.atan2(-dz, dx);
  const f: Frame = { x: (x1 + x2) / 2, y: deckY, z: (z1 + z2) / 2, rot };
  const l = new L(b, f);
  l.box(0, -0.25, 0, len, 0.5, width, 'grid');
  l.box(0, -0.75, 0, len, 0.5, width - 0.8, 'darkPanel');
  // side trusses (hand rail opens onto the mid-span bay of long bridges)
  const seg = Math.max(2, Math.round(len / 3));
  const bayGap = o.cover !== false && len >= 36 && !(o.keep ?? []).some(([kx, kz]) => Math.hypot((x1 + x2) / 2 - kx, (z1 + z2) / 2 - kz) < 5.5) ? 3.5 : 0;
  for (const s of [-1, 1]) {
    const z = (s * width) / 2;
    if (bayGap) {
      l.beam([-len / 2, 1.3, z], [-bayGap, 1.3, z], 0.12, 'yellow');
      l.beam([bayGap, 1.3, z], [len / 2, 1.3, z], 0.12, 'yellow');
    } else l.beam([-len / 2, 1.3, z], [len / 2, 1.3, z], 0.12, 'yellow');
    for (let i = 0; i <= seg; i++) {
      const x = -len / 2 + (i * len) / seg;
      if (Math.abs(x) >= bayGap) l.beam([x, 0, z], [x, 1.3, z], 0.1, 'steel');
      if (i < seg) l.beam([x, -0.9, z * 0.85], [x + len / seg, -0.9, z * 0.85], 0.16, 'dark');
      if (i < seg) l.beam([x, -0.9, z * 0.85], [x + len / seg / 2, -2.2, 0], 0.12, 'steel');
      if (i > 0) l.beam([x, -0.9, z * 0.85], [x - len / seg / 2, -2.2, 0], 0.12, 'steel');
    }
  }
  l.beam([-len / 2, -2.2, 0], [len / 2, -2.2, 0], 0.24, 'dark', { collide: true });
  // lights along the deck edge
  for (let i = 0; i <= seg; i += 2) {
    const x = -len / 2 + (i * len) / seg;
    l.box(x, 0.05, width / 2 - 0.2, 0.3, 0.08, 0.15, 'lamp', { collide: false });
    l.box(x, 0.05, -width / 2 + 0.2, 0.3, 0.08, 0.15, 'lamp', { collide: false });
  }
  if (o.cover === false) return;
  // --- cover: a crossing is never a 40 m shooting gallery ---
  const near = (x: number) => {
    const p = l.p(x, 0, 0);
    return (o.keep ?? []).some(([kx, kz]) => Math.hypot(p.x - kx, p.z - kz) < 5.5);
  };
  // mid-span bay: the deck widens, a stand-height cable-junction block splits the axial sightline
  const bay = len >= 36;
  if (bay && !near(0)) {
    const bw = width / 2 + 1.8;
    for (const s of [-1, 1]) {
      l.box(0, -0.25, s * (width / 2 + 0.9), 7, 0.5, 1.8, 'grid');
      l.box(0, -0.75, s * (width / 2 + 0.9), 7, 0.5, 1.4, 'darkPanel', { collide: false });
      // bay parapet shields (crouch cover) with a hazard band
      l.box(0, 0.6, s * (bw - 0.15), 6.6, 1.2, 0.26, 'hullGray');
      l.box(0, 1.14, s * (bw - 0.14), 6.62, 0.12, 0.3, 'yellow', { collide: false });
      l.panel(0, 0.6, s * (bw - 0.29), 5.8, 0.25, 0, 0, -s, 'hazard');
      l.beam([-3.4, 0, s * bw], [-3.4, -2.0, s * (width / 2)], 0.14, 'steel');
      l.beam([3.4, 0, s * bw], [3.4, -2.0, s * (width / 2)], 0.14, 'steel');
    }
    l.box(0, 0.95, 0, 1.3, 1.9, 1.3, 'darkPanel');
    l.box(0, 1.95, 0, 1.45, 0.12, 1.45, 'yellow', { collide: false });
    l.panel(0.66, 1.2, 0, 0.9, 0.6, 1, 0, 0, 'screenAmber');
    l.panel(-0.66, 1.2, 0, 0.9, 0.6, -1, 0, 0, 'screenAmber');
    b.light(l.p(0, 2.6, 0), 0xffc98a, 4, 7);
  }
  // alternating armoured side shields every ~10 m (crouch height 1.15 m, lane stays 3 m clear)
  const step = 9.5;
  const n = Math.floor((len - 10) / step);
  for (let i = 0; i <= n; i++) {
    const x = -((n * step) / 2) + i * step;
    if (bay && Math.abs(x) < 5.5) continue;
    if (Math.abs(x) > len / 2 - 4.5 || near(x)) continue;
    const s = i % 2 ? 1 : -1;
    const z = s * (width / 2 - 0.2);
    l.box(x, 0.575, z, 1.9, 1.15, 0.22, 'hullGray');
    l.box(x, 1.12, z, 1.94, 0.1, 0.26, 'yellow', { collide: false });
    l.box(x - 0.8, 0.3, z - s * 0.28, 0.12, 0.6, 0.45, 'dark', { collide: false, tilt: qAxis(V(1, 0, 0), s * 0.5) });
    l.box(x + 0.8, 0.3, z - s * 0.28, 0.12, 0.6, 0.45, 'dark', { collide: false, tilt: qAxis(V(1, 0, 0), s * 0.5) });
  }
}

/** Support pylon from terrain up to a height (for bridges / conveyors). */
export function pylon(b: StructureBuilder, x: number, z: number, topY: number, w = 1.2): void {
  const gy = b.ground(x, z) - 1;
  const h = topY - gy;
  if (h <= 0.5) return;
  b.box(V(x, gy + h / 2, z), w, h, w, 0, 'darkPanel');
  b.box(V(x, gy + 1.2, z), w + 0.6, 1.4, w + 0.6, 0, 'dark');
}

/**
 * Giant drill rig at the heart of the mine — the central objective. Point-symmetric (fair for both
 * teams under the maps' 180° symmetry): a low metal deck you step onto (0.3 m), four derrick legs,
 * the drill string raised clear of heads (the capture centre stays standable), two operator cabins
 * (stand cover) and two pipe racks (crouch cover) on opposite sides, glowing ore well in the middle.
 */
export function drillRig(b: StructureBuilder, f: Frame, o: { deckR?: number; ramps?: number[] } = {}): void {
  const l = new L(b, f);
  const R = o.deckR ?? 6;
  // deck: octagonal metal plate (walkable, mag-consistent), hazard rim, skirt down to the floor
  l.cylY(0, 0.1, 0, R, 0.4, 'grid', { seg: 8 });
  l.cylY(0, 0.31, 0, R + 0.02, 0.03, 'hazard', { seg: 8, collide: false, rTop: R - 0.35 });
  l.cylY(0, -0.2, 0, R + 0.4, 0.4, 'darkPanel', { seg: 8, collide: false });
  // derrick: 4 legs from the deck corners to the crown
  const H = 20;
  const leg = Math.min(3.3, R - 1.6);
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    l.beam([sx * leg, 0.3, sz * leg], [sx * 1.2, H, sz * 1.2], 0.5, 'yellow', { collide: true });
    l.box(sx * leg, 0.55, sz * leg, 0.9, 0.5, 0.9, 'dark', { collide: false });
  }
  // cross bracing starts above head height (the drill floor under the derrick stays open)
  for (let y = 4.2; y < H; y += 3.5) {
    const w = leg + (1.2 - leg) * ((y - 0.3) / (H - 0.3));
    l.beam([-w, y, -w], [w, y, -w], 0.18, 'dark');
    l.beam([w, y, -w], [w, y, w], 0.18, 'dark');
    l.beam([w, y, w], [-w, y, w], 0.18, 'dark');
    l.beam([-w, y, w], [-w, y, -w], 0.18, 'dark');
  }
  // crown block + travelling block
  l.box(0, H + 0.8, 0, 3.6, 1.6, 3.6, 'yellow');
  l.box(0, H + 2.0, 0, 2.0, 0.8, 2.0, 'dark');
  beacon(b, l.p(0, H + 2.8, 0), 0xff3a2a, 1.0, 0);
  // floodlights on the derrick shine down onto the deck (objective always readable)
  for (const [sx, sz] of [
    [1, 0],
    [-1, 0],
  ]) {
    l.box(sx * 1.9, 7.6, sz, 0.5, 0.35, 0.7, 'dark', { collide: false });
    l.box(sx * 1.9, 7.4, sz, 0.42, 0.04, 0.6, 'lamp', { collide: false });
    b.light(l.p(sx * 1.9, 7.2, sz), 0xfff0d8, 9, 14, { dir: V(0, -1, 0), cone: 0.2 });
  }
  // two operator cabins (point-symmetric) = stand cover on the point
  for (const s of [-1, 1]) {
    const cx = s * (R - 1.45);
    l.box(cx, 1.8, 0, 2.3, 3.0, 3.0, 'hull');
    l.box(cx, 3.42, 0, 2.6, 0.25, 3.3, 'yellow', { collide: false });
    l.panel(cx + s * 1.16, 2.35, 0, 1.2, 0.9, s, 0, 0, 'glassBlue');
    l.panel(cx - s * 1.16, 2.1, 0, 1.4, 0.7, -s, 0, 0, 'labelMine');
    l.box(cx, 0.45, 1.8, 2.3, 0.3, 0.6, 'dark', { collide: false });
  }
  // two pipe racks (crouch cover, ~1.3 m) on the other axis
  for (const s of [-1, 1]) {
    const z = s * (R - 1.4);
    l.box(0, 0.4, z, 2.8, 0.2, 1.4, 'dark');
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 3 - row; i++) l.cylX(0, 0.66 + row * 0.26, z - 0.3 + i * 0.3 + row * 0.15, 0.14, 3.0, i % 2 ? 'steel' : 'hullGray', { seg: 10, collide: false });
    for (const e of [-1.45, 1.45]) l.box(e, 0.8, z, 0.12, 1.0, 1.3, 'yellow', { collide: false });
    b.world.addBox(l.p(0, 0.9, z), V(1.5, 0.42, 0.62), l.q(), true);
  }
  // ore well under the drill: glowing palladium core seen through a grate ring
  l.cylY(0, 0.33, 0, 1.25, 0.06, 'ore', { seg: 16, collide: false });
  b.torus(l.p(0, 0.36, 0), 1.3, 0.1, qAxis(V(1, 0, 0), Math.PI / 2), 'trim');
  for (const a of [0, Math.PI / 2]) l.box(0, 0.37, 0, 2.5, 0.05, 0.12, 'trim', { collide: false, rot: a });
  b.light(l.p(0, 1.2, 0), 0x7ff0ff, 6, 7);
  // rotating drill string, raised: the head hangs 2.7 m over the well
  const drill = new THREE.Group();
  const top = H - 1;
  const bot = 3.3;
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, top - bot, 12), toonMat(0x7d8594, { spec: 0.8 }));
  pipe.position.y = (top + bot) / 2;
  pipe.castShadow = true;
  drill.add(pipe);
  const collars: THREE.BufferGeometry[] = [];
  for (let y = bot + 1; y < top; y += 2.5) collars.push(new THREE.CylinderGeometry(0.7, 0.7, 0.35, 12).translate(0, y, 0));
  const cm = new THREE.Mesh(mergeGeometries(collars, false)!, toonMat(0xffc21a));
  cm.castShadow = true;
  drill.add(cm);
  const head = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.4, 8), toonMat(0x3b4150, { spec: 1 }));
  head.rotation.x = Math.PI;
  head.position.y = bot - 0.6;
  head.castShadow = true;
  drill.add(head);
  drill.position.copy(l.p(0, 0.3, 0));
  spinner(b, drill, Y, 1.4);
  const hb = 2.6;
  b.world.addCylinder(l.p(0, 0.3 + (hb + top) / 2, 0), 0.75, (top - hb) / 2, new THREE.Quaternion(), true);
  // palladium ore heaps just off the deck on the cabin / rack axes (point-symmetric pairs),
  // swung aside where a haul ramp comes down (world azimuths in `ramps`)
  const cands: [number, number, number, number][] = [
    [R + 1.4, 0, 1.2, 11],
    [-R - 1.4, 0, 1.2, 12],
    [0, R + 1.4, 1.0, 13],
    [0, -R - 1.4, 1.0, 14],
  ];
  for (const [lx, lz, size, seed] of cands) {
    const w = l.p(lx, 0, lz);
    let a = Math.atan2(w.z - f.z, w.x - f.x);
    const r = Math.hypot(w.x - f.x, w.z - f.z);
    for (let k = 0; k < 4; k++) {
      const clash = (o.ramps ?? []).find((ra) => Math.abs(Math.atan2(Math.sin(a - ra), Math.cos(a - ra))) < 0.5);
      if (clash === undefined) break;
      a += Math.atan2(Math.sin(a - clash), Math.cos(a - clash)) >= 0 ? 0.35 : -0.35;
    }
    oreCluster(b, V(f.x + Math.cos(a) * r, 0, f.z + Math.sin(a) * r), size, seed);
  }
}

/** Palladium crystal cluster. */
export function oreCluster(b: StructureBuilder, pos: THREE.Vector3, size: number, seed: number): void {
  const rng = new Rng(seed);
  const gy = b.ground(pos.x, pos.z);
  const n = 5 + Math.floor(rng.next() * 5);
  for (let i = 0; i < n; i++) {
    const a = rng.next() * Math.PI * 2;
    const rr = rng.next() * size * 0.8;
    const h = size * (0.8 + rng.next() * 1.4) * (i === 0 ? 1.5 : 1);
    const w = h * (0.22 + rng.next() * 0.12);
    const g = new THREE.OctahedronGeometry(1, 0);
    const p = V(pos.x + Math.cos(a) * rr, gy + h * 0.25, pos.z + Math.sin(a) * rr);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.5, 0.5), rng.range(0, 6), rng.range(-0.5, 0.5)));
    b.add('oreRock', g, p, tilt, V(w, h, w));
    const core = new THREE.OctahedronGeometry(1, 0);
    b.add('ore', core, p.clone(), tilt.clone(), V(w * 0.55, h * 0.8, w * 0.55));
  }
  b.world.addSphere(V(pos.x, gy, pos.z), size * 0.9, false);
  b.lamps.push(V(pos.x, gy + size, pos.z));
}

/** Refinery: tanks, process building, stack. Control-point candidate. */
export function refinery(b: StructureBuilder, f: Frame, team: number | null): void {
  const l = new L(b, f);
  // main process hall
  l.box(0, 3.5, 0, 10, 7, 7, 'hull');
  l.box(0, 7.2, 0, 10.6, 0.4, 7.6, 'darkPanel');
  l.panel(0, 5.2, 3.52, 7, 1.6, 0, 0, 1, 'labelMine');
  for (let x = -4; x <= 4; x += 2) l.panel(x, 2.6, 3.52, 1.2, 0.8, 0, 0, 1, 'glassWarm');
  // tanks
  for (const [x, z, r, h] of [
    [-8, -1.5, 2.2, 8],
    [-8, 3.5, 1.6, 6],
    [8, 0, 2.4, 9],
  ] as const) {
    l.cylY(x, h / 2, z, r, h, 'hullGray', { seg: 20 });
    b.dome(l.p(x, h, z), r, 'hullGray', { collide: true, seg: 20 });
    b.torus(l.p(x, h * 0.6, z), r + 0.02, 0.1, qAxis(V(1, 0, 0), Math.PI / 2), teamMat(team));
    b.torus(l.p(x, h * 0.2, z), r + 0.02, 0.1, qAxis(V(1, 0, 0), Math.PI / 2), 'dark');
  }
  // pipes (walkable with mag-boots)
  l.cylX(-5.5, 5.5, -1.5, 0.45, 3, 'steel', { seg: 12 });
  l.cylX(5.5, 6, 0, 0.5, 3, 'steel', { seg: 12 });
  l.cylZ(0, 7.9, -2, 0.4, 5, 'steel', { seg: 12 });
  // exhaust stack
  l.cylY(2.8, 10, -2.2, 0.8, 6, 'darkPanel', { seg: 14 });
  l.cylY(2.8, 13.2, -2.2, 1.0, 0.5, 'hazard', { seg: 14, collide: false });
  beacon(b, l.p(2.8, 13.8, -2.2), 0xff3a2a, 1.5, 0.3);
  // steam puffs handled by FX (vent positions)
  b.lamps.push(l.p(0, 8, 4));
}

/** Tall ore silos with loading gantry. */
export function silos(b: StructureBuilder, f: Frame, team: number | null): void {
  const l = new L(b, f);
  for (const [x, z] of [
    [-3.2, 0],
    [3.2, 0],
  ]) {
    l.cylY(x, 7, z, 2.8, 14, 'hull', { seg: 24 });
    l.cylY(x, 14.4, z, 2.9, 0.8, teamMat(team), { seg: 24 });
    b.dome(l.p(x, 14.8, z), 2.8, 'hullGray', { seg: 24 });
    for (let y = 2; y < 14; y += 3) b.torus(l.p(x, y, z), 2.83, 0.08, qAxis(V(1, 0, 0), Math.PI / 2), 'dark');
    b.panel(l.p(x, 9, z + 2.82), 2.2, 2.2, l.d(0, 0, 1), 'pd');
  }
  // gantry between the silos (roof walkway)
  l.box(0, 12, 0, 3.8, 0.4, 2.4, 'grid');
  l.box(0, 5, 0, 0.8, 10, 0.8, 'dark');
  // loading chute
  l.box(0, 2.2, 3.5, 2.2, 0.4, 3, 'yellow');
  beacon(b, l.p(0, 16.5, 0), 0xff3a2a, 1.7, 0.5);
}

/** Inclined conveyor belt on pylons (walkable). */
export function conveyor(b: StructureBuilder, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): void {
  const a = V(x1, y1, z1);
  const c = V(x2, y2, z2);
  const dir = c.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const yaw = Math.atan2(-dir.z, dir.x);
  const pitch = Math.asin(dir.y);
  const q = qY(yaw).multiply(qAxis(V(0, 0, 1), pitch));
  const mid = a.clone().add(c).multiplyScalar(0.5);
  b.box(mid, len, 0.5, 2.2, 0, 'darkPanel', { quat: q });
  const top = mid.clone().add(V(0, 0.3, 0));
  b.box(top, len, 0.12, 1.6, 0, 'rubber', { quat: q, collide: false });
  // side rails
  for (const s of [-1, 1]) {
    const off = V(-Math.sin(yaw) * 0, 0, 0);
    const side = V(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(s * 1.05);
    b.box(mid.clone().add(side).add(V(0, 0.45, 0)).add(off), len, 0.35, 0.12, 0, 'yellow', { quat: q, collide: false });
  }
  const n = Math.max(2, Math.floor(len / 9));
  for (let i = 1; i < n; i++) {
    const p = a.clone().lerp(c, i / n);
    pylon(b, p.x, p.z, p.y - 0.3, 0.7);
  }
  // ore chunks riding the belt (one instanced draw call, no per-frame allocation)
  const mat = toonMat(0xc8d6e0, { flat: true, emissive: 0x2a8fa0, emissiveIntensity: 0.7 });
  const cn = Math.floor(len / 2.5);
  const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.3, 0), mat, cn);
  im.castShadow = true;
  im.frustumCulled = false;
  b.group.add(im);
  const up = V(0, 1, 0).applyQuaternion(q);
  const m4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const rq = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  b.animated.push({
    update(t) {
      for (let i = 0; i < cn; i++) {
        const u = (i / cn + t * 0.03) % 1;
        pos.copy(a).lerp(c, u).addScaledVector(up, 0.55);
        rq.setFromEuler(e.set(i, i * 2, 0));
        im.setMatrixAt(i, m4.compose(pos, rq, one));
      }
      im.instanceMatrix.needsUpdate = true;
    },
  });
}

/** Rotating radar dish on a pedestal. */
export function radar(b: StructureBuilder, f: Frame, team: number | null): void {
  const l = new L(b, f);
  l.cylY(0, 0.8, 0, 1.4, 1.6, 'darkPanel', { seg: 12 });
  l.cylY(0, 2.0, 0, 0.4, 1.0, 'steel', { seg: 10 });
  const g = new THREE.Group();
  const dish = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 8, 0, Math.PI * 2, 0, 0.9), toonMat(0xeae7e0, { side: THREE.DoubleSide, spec: 0.5 }));
  dish.rotation.x = Math.PI / 2 - 0.5;
  dish.castShadow = true;
  g.add(dish);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 2.4), toonMat(team === 1 ? 0xff6a1f : 0x2f7cf6));
  arm.position.set(0, 0.6, 1.0);
  g.add(arm);
  g.position.copy(l.p(0, 2.6, 0));
  spinner(b, g, Y, 0.6);
}

/** Team spawn gate: glowing arch + ring on the floor. */
export function spawnGate(b: StructureBuilder, f: Frame, team: number): void {
  const l = new L(b, f);
  for (const s of [-1, 1]) {
    l.box(s * 1.8, 1.8, 0, 0.5, 3.6, 0.8, 'darkPanel');
    l.panel(s * 1.8, 1.8, 0.41, 0.2, 3.0, 0, 0, 1, teamGlow(team));
  }
  l.box(0, 3.8, 0, 4.1, 0.5, 0.8, teamMat(team));
  b.torus(l.p(0, 0.08, 2), 1.5, 0.08, qAxis(V(1, 0, 0), Math.PI / 2), teamGlow(team));
}

/** Oxygen / repair station (glowing canister rack) — gameplay pickups are placed on these. */
export function o2Station(b: StructureBuilder, f: Frame, team: number | null): void {
  const l = new L(b, f);
  l.box(0, 0.9, 0, 1.6, 1.8, 0.8, 'hull');
  l.box(0, 1.95, 0, 1.7, 0.25, 0.9, teamMat(team), { collide: false });
  l.panel(0, 1.2, 0.41, 1.0, 0.7, 0, 0, 1, 'glassBlue');
  for (const s of [-1, 1]) l.cylY(s * 0.55, 0.6, 0.55, 0.22, 1.2, 'containerWhite', { collide: false, seg: 10 });
}

/** Wrecked lander / crashed debris for flavour and cover. */
export function wreck(b: StructureBuilder, f: Frame): void {
  const l = new L(b, f);
  l.cylY(0, 1.0, 0, 2.0, 1.8, 'gold', { seg: 8 });
  l.box(1.5, 0.6, 1.2, 2.5, 1.2, 1.8, 'hullGray', { rot: 0.5, tilt: qAxis(V(1, 0, 0), 0.3) });
  l.beam([-1.5, 1.4, 0], [-3.5, 0.1, 0.8], 0.16, 'steel', { round: true, collide: true });
  l.beam([0, 1.8, 1.8], [0.5, 0.1, 3.8], 0.16, 'steel', { round: true, collide: true });
  l.box(-1.2, 0.35, -2.2, 2.2, 0.7, 1.5, 'solar', { rot: 1.1 });
}

/** Bunker with firing slits (half-buried). */
export function bunker(b: StructureBuilder, f: Frame, team: number | null): void {
  const l = new L(b, f);
  l.box(0, 0.9, 0, 6, 2.4, 4, 'darkPanel');
  l.box(0, 2.25, 0, 6.6, 0.5, 4.6, 'hullGray');
  l.panel(0, 1.4, 2.01, 4, 0.25, 0, 0, 1, teamGlow(team));
  l.panel(0, 1.4, -2.01, 4, 0.25, 0, 0, -1, teamGlow(team));
}

/** Fuel tank farm (horizontal tanks on cradles) */
export function tankFarm(b: StructureBuilder, f: Frame, team: number | null): void {
  const l = new L(b, f);
  for (const z of [-2.2, 2.2]) {
    l.cylX(0, 1.8, z, 1.4, 7, 'hull', { seg: 20 });
    for (const s of [-1, 1]) {
      const g = new THREE.SphereGeometry(1.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      b.add('hull', g, l.p(s * 3.5, 1.8, z), l.q(qAxis(V(0, 0, 1), -s * Math.PI / 2)), V(1, 0.5, 1));
      l.box(s * 2.4, 0.5, z, 0.5, 1.0, 2.6, 'dark', { collide: false });
    }
    l.cylX(0, 1.8, z, 1.44, 0.6, teamMat(team), { collide: false, seg: 20 });
  }
  l.panel(0, 1.8, 3.62, 2.2, 0.5, 0, 0, 1, 'hazard');
}
