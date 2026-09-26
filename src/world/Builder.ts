import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PhysicsWorld, Collider } from '../core/Physics';
import { Heightfield } from './Heightfield';
import { glowMat } from '../render/Toon';
import { pbr } from '../render/Materials';
import { panelSet, treadSet, corrugatedSet, foilSet, solarSet, hazardSet, brushedSet, concreteSet } from '../render/TextureGen';
import { palladiumTex, labelTex } from '../render/Textures';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';

export const TEAM_COLORS = [
  { main: 0x2f7cf6, light: 0x7cc4ff, glow: 0x4dd8ff, name: 'ARTEMIS' },
  { main: 0xff6a1f, light: 0xffb36b, glow: 0xffa033, name: 'SELENE' },
];

const TILE = 2; // meters per texture tile
const SIZE_SMALL = 48;

export type Mat =
  | 'hull'
  | 'hullGray'
  | 'dark'
  | 'darkPanel'
  | 'team0'
  | 'team1'
  | 'team0Glow'
  | 'team1Glow'
  | 'yellow'
  | 'hazard'
  | 'glassBlue'
  | 'glassWarm'
  | 'solar'
  | 'gold'
  | 'grid'
  | 'rubber'
  | 'containerRed'
  | 'containerBlue'
  | 'containerGreen'
  | 'containerWhite'
  | 'ore'
  | 'oreRock'
  | 'beaconRed'
  | 'lamp'
  | 'pd'
  | 'vent'
  | 'label0'
  | 'label1'
  | 'labelMine'
  | 'steel'
  | 'concrete';

export interface Animated {
  update(t: number, dt: number): void;
}

export interface Frame {
  x: number;
  y: number;
  z: number;
  rot: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

export function scaleBoxUV(g: THREE.BufferGeometry, w: number, h: number, d: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const faces = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  const per = uv.count / 6;
  for (let i = 0; i < uv.count; i++) {
    const f = faces[Math.min(5, Math.floor(i / per))];
    uv.setXY(i, (uv.getX(i) * f[0]) / TILE, (uv.getY(i) * f[1]) / TILE);
  }
}

export function scaleCylUV(g: THREE.BufferGeometry, r: number, h: number, radial: number, hseg: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const side = (radial + 1) * (hseg + 1);
  const cu = (2 * Math.PI * r) / TILE;
  const cv = h / TILE;
  for (let i = 0; i < Math.min(side, uv.count); i++) uv.setXY(i, uv.getX(i) * cu, uv.getY(i) * cv);
  for (let i = side; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * r) / TILE, (uv.getY(i) * 2 * r) / TILE);
}

/**
 * Accumulates static structure geometry (merged per material → few draw calls) and physics colliders.
 */
export class StructureBuilder {
  world: PhysicsWorld;
  hf: Heightfield;
  private parts = new Map<Mat, THREE.BufferGeometry[]>();
  mats: Record<Mat, THREE.Material>;

  group = new THREE.Group();
  animated: Animated[] = [];
  /** point lights are expensive; we only keep a few flagged "key lights" */
  lamps: THREE.Vector3[] = [];

  constructor(world: PhysicsWorld, hf: Heightfield) {
    this.world = world;
    this.hf = hf;
    const hull = panelSet(1, { depth: 4 });
    const hull2 = panelSet(2, { depth: 5, minSize: SIZE_SMALL });
    const plate = treadSet(3);
    const corr = corrugatedSet(4);
    const brushed = brushedSet(18);
    const concrete = concreteSet(15);
    const paint = (key: string, color: number, set = hull, extra: { rough?: number; coat?: number; metal?: number } = {}) =>
      pbr('b-' + key, {
        color,
        set,
        roughness: extra.rough ?? 1,
        metalness: extra.metal ?? 1,
        normalScale: 1,
        physical: extra.coat ? { clearcoat: extra.coat, clearcoatRoughness: 0.35 } : undefined,
        style: { rim: 0.22 },
      });
    this.mats = {
      hull: paint('hull', 0xf1eee8),
      hullGray: paint('hullGray', 0xa5acb8),
      dark: pbr('b-dark', { color: 0x3a404c, set: brushed, roughness: 1.15, metalness: 0.75, style: { rim: 0.2 } }),
      darkPanel: paint('darkPanel', 0x5a6272, hull2),
      steel: pbr('b-steel', { color: 0xc9ced8, set: brushed, roughness: 1, metalness: 1, physical: { anisotropy: 0.5 }, style: { rim: 0.2 } }),
      team0: paint('team0', TEAM_COLORS[0].main, hull2, { coat: 0.6 }),
      team1: paint('team1', TEAM_COLORS[1].main, hull2, { coat: 0.6 }),
      team0Glow: glowMat(TEAM_COLORS[0].glow, 2.6),
      team1Glow: glowMat(TEAM_COLORS[1].glow, 2.6),
      yellow: paint('yellow', 0xffbf1f, hull2, { coat: 0.4 }),
      hazard: pbr('b-hazard', { set: hazardSet(), roughness: 1, metalness: 1, style: { rim: 0.2 } }),
      glassBlue: glowMat(0xa8e8ff, 1.4),
      glassWarm: glowMat(0xffd89a, 1.6),
      solar: pbr('b-solar', { set: solarSet(), roughness: 1, metalness: 1, physical: { clearcoat: 1, clearcoatRoughness: 0.05 }, style: { rim: 0.15 } }),
      gold: pbr('b-gold', { set: foilSet(6), roughness: 1, metalness: 1, style: { rim: 0.35, rimColor: 0xffe7a0 } }),
      grid: pbr('b-grid', { color: 0xb8bec9, set: plate, roughness: 1, metalness: 1, style: { rim: 0.15 } }),
      rubber: pbr('b-rubber', { color: 0x1f2228, roughness: 0.9, metalness: 0 }),
      containerRed: pbr('b-cRed', { color: 0xc4432f, set: corr, roughness: 1, metalness: 1 }),
      containerBlue: pbr('b-cBlue', { color: 0x2f6fb5, set: corr, roughness: 1, metalness: 1 }),
      containerGreen: pbr('b-cGreen', { color: 0x4f8f4a, set: corr, roughness: 1, metalness: 1 }),
      containerWhite: pbr('b-cWhite', { color: 0xd8d8d2, set: corr, roughness: 1, metalness: 1 }),
      ore: glowMat(0x7ff0ff, 2.4),
      oreRock: pbr('b-oreRock', { color: 0xd6e6f0, roughness: 0.14, metalness: 0.85, flat: true, emissive: 0x1d7c8c, emissiveIntensity: 0.9, physical: { iridescence: 1, clearcoat: 0.8 }, style: { rim: 0.6, rimColor: 0x9ff6ff } }),
      beaconRed: glowMat(0xff3a2a, 5),
      lamp: glowMat(0xfff2d0, 4),
      pd: pbr('b-pd', { map: palladiumTex(), color: 0xffffff, roughness: 0.4, metalness: 0.1, emissive: 0x0b3b44, emissiveIntensity: 1 }),
      vent: paint('vent', 0x8d94a2, panelSet(7, { depth: 3 })),
      label0: pbr('b-label0', { map: labelTex('ARTEMIS', 'LUNAR DEFENSE CORPS', '#1f5fd0', '#e9f4ff'), roughness: 0.45, metalness: 0.1 }),
      label1: pbr('b-label1', { map: labelTex('SELENE', 'ORBITAL LEGION', '#d8521a', '#fff2e6'), roughness: 0.45, metalness: 0.1 }),
      labelMine: pbr('b-labelMine', { map: labelTex('PD-46', 'PALLADIUM EXTRACTION SITE', '#ffc21a', '#1a1c24'), roughness: 0.45, metalness: 0.1 }),
      concrete: pbr('b-concrete', { color: 0xb9b3a8, set: concrete, roughness: 1, metalness: 1, style: { rim: 0.12 } }),
    };
  }

  add(mat: Mat, geo: THREE.BufferGeometry, pos: THREE.Vector3, quat: THREE.Quaternion, scale?: THREE.Vector3): void {
    _m.compose(pos, quat, scale ?? _s.set(1, 1, 1));
    const g = geo.index ? geo : geo;
    g.applyMatrix4(_m);
    let list = this.parts.get(mat);
    if (!list) {
      list = [];
      this.parts.set(mat, list);
    }
    list.push(g);
  }

  ground(x: number, z: number): number {
    return this.hf.heightAt(x, z);
  }

  /** local→world for a frame */
  tf(f: Frame, lx: number, ly: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    return out.set(f.x + lx * c + lz * s, f.y + ly, f.z - lx * s + lz * c);
  }

  // ---------------- primitives (world space) ----------------

  box(
    center: THREE.Vector3,
    w: number,
    h: number,
    d: number,
    rotY: number,
    mat: Mat,
    opts: { collide?: boolean; metal?: boolean; quat?: THREE.Quaternion; extra?: Partial<Collider> } = {},
  ): Collider | null {
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(g, w, h, d);
    const q = opts.quat ? opts.quat.clone() : _q.setFromAxisAngle(Y, rotY).clone();
    this.add(mat, g, center, q);
    if (opts.collide === false) return null;
    return this.world.addBox(center, new THREE.Vector3(w / 2, h / 2, d / 2), q, opts.metal ?? true, opts.extra);
  }

  cyl(
    center: THREE.Vector3,
    r: number,
    h: number,
    mat: Mat,
    opts: { collide?: boolean; metal?: boolean; quat?: THREE.Quaternion; seg?: number; rTop?: number; open?: boolean; extra?: Partial<Collider> } = {},
  ): Collider | null {
    const seg = opts.seg ?? 24;
    const g = new THREE.CylinderGeometry(opts.rTop ?? r, r, h, seg, 1, !!opts.open);
    scaleCylUV(g, r, h, seg, 1);
    const q = opts.quat ? opts.quat.clone() : new THREE.Quaternion();
    this.add(mat, g, center, q);
    if (opts.collide === false) return null;
    return this.world.addCylinder(center, Math.max(r, opts.rTop ?? r), h / 2, q, opts.metal ?? true, opts.extra);
  }

  /** hemisphere dome sitting on center.y */
  dome(center: THREE.Vector3, r: number, mat: Mat, opts: { collide?: boolean; seg?: number } = {}): void {
    const seg = opts.seg ?? 32;
    const g = new THREE.SphereGeometry(r, seg, Math.floor(seg / 2), 0, Math.PI * 2, 0, Math.PI / 2);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 2 * Math.PI * r) / TILE, (uv.getY(i) * Math.PI * r) / TILE / 2);
    this.add(mat, g, center, new THREE.Quaternion());
    if (opts.collide !== false) this.world.addSphere(center, r, true);
  }

  torus(center: THREE.Vector3, r: number, tube: number, quat: THREE.Quaternion, mat: Mat, arc = Math.PI * 2): void {
    const g = new THREE.TorusGeometry(r, tube, 8, 32, arc);
    this.add(mat, g, center, quat);
  }

  sphere(center: THREE.Vector3, r: number, mat: Mat, opts: { collide?: boolean; seg?: number } = {}): void {
    const s = opts.seg ?? 16;
    const g = new THREE.SphereGeometry(r, s, Math.max(6, s / 2));
    this.add(mat, g, center, new THREE.Quaternion());
    if (opts.collide) this.world.addSphere(center, r, true);
  }

  /** Thin beam between two points (braces, rails, pipes) */
  beam(a: THREE.Vector3, b: THREE.Vector3, thick: number, mat: Mat, opts: { collide?: boolean; round?: boolean; metal?: boolean } = {}): void {
    const dir = _v.copy(b).sub(a);
    const len = dir.length();
    if (len < 1e-4) return;
    dir.divideScalar(len);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    if (opts.round) {
      const g = new THREE.CylinderGeometry(thick / 2, thick / 2, len, 10, 1);
      scaleCylUV(g, thick / 2, len, 10, 1);
      this.add(mat, g, mid, q);
      if (opts.collide) this.world.addCylinder(mid, thick / 2, len / 2, q, opts.metal ?? true);
    } else {
      const g = new THREE.BoxGeometry(thick, len, thick);
      scaleBoxUV(g, thick, len, thick);
      this.add(mat, g, mid, q);
      if (opts.collide) this.world.addBox(mid, new THREE.Vector3(thick / 2, len / 2, thick / 2), q, opts.metal ?? true);
    }
  }

  /** Emissive decal quad facing along a normal (windows, signs, stripes) */
  panel(center: THREE.Vector3, w: number, h: number, normal: THREE.Vector3, mat: Mat, up = Y): void {
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), normal.clone().negate(), up);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const p = center.clone().addScaledVector(normal, 0.02);
    this.add(mat, g, p, q);
  }

  /** Build merged meshes. */
  finish(): THREE.Group {
    for (const [mat, list] of this.parts) {
      if (!list.length) continue;
      // normalize attributes: all need position/normal/uv, indexed
      const norm = list.map((g) => {
        let gg = g;
        if (!gg.index) gg = indexify(gg);
        for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') gg.deleteAttribute(k);
        if (!gg.getAttribute('uv')) gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gg.getAttribute('position').count * 2), 2));
        return gg;
      });
      const merged = mergeGeometries(norm, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const material = this.mats[mat];
      const mesh = new THREE.Mesh(merged, material);
      const glow = (material as THREE.MeshBasicMaterial).isMeshBasicMaterial;
      mesh.castShadow = !glow;
      mesh.receiveShadow = !glow;
      if (glow) mesh.layers.set(LAYER_NO_OUTLINE);
      mesh.matrixAutoUpdate = false;
      mesh.name = 'static-' + mat;
      this.group.add(mesh);
      for (const g of list) g.dispose();
    }
    this.parts.clear();
    return this.group;
  }
}

function indexify(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
