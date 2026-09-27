import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PhysicsWorld, Collider } from '../core/Physics';
import { Heightfield } from './Heightfield';
import { glowMat } from '../render/Toon';
import { pbr, addPatch } from '../render/Materials';
import { panelSet, treadSet, corrugatedSet, foilSet, solarSet, hazardSet, brushedSet, concreteSet, fabricSet, regolithSet } from '../render/TextureGen';
import { printedSet, tileSet, woodSet, meshBasketSet, sandbagSet } from './KitTextures';
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
  | 'concrete'
  // ---- architectural kit ----
  | 'cream'
  | 'trim'
  | 'teal'
  | 'orange'
  | 'brass'
  | 'regolith'
  | 'regolithCell'
  | 'sandbag'
  | 'hesco'
  | 'fabric'
  | 'tile'
  | 'wood'
  | 'plant'
  | 'plantDark'
  | 'soil'
  | 'padDark'
  | 'paintWhite'
  | 'screen'
  | 'screenAmber'
  | 'neonTeal'
  | 'neonWarm'
  | 'glassDome'
  | 'glassTint'
  | 'labelPort'
  | 'labelLab'
  | 'labelHab'
  | 'labelDepot'
  | 'dirt'
  | 'growPink'
  | 'screenMap'
  | 'fabricTeal'
  | 'fabricOrange';

/** A static light baked into structure vertices (warm interior pools, doorway spills). */
export interface BakeLight {
  pos: THREE.Vector3;
  color: THREE.Color;
  /** radiance scale at ~1 m */
  intensity: number;
  radius: number;
  /** optional region the light may affect (rooms: no leaking through walls) */
  bounds?: THREE.Box3;
  /** occlusion rays through the physics world (costly: key lights only) */
  shadow?: boolean;
  /** spot: unit direction + cosine of the half-angle (soft edge) */
  dir?: THREE.Vector3;
  cone?: number;
}

/** Named start/end pairs recorded by the kit (doorways, stairs) for automated walkability tests. */
export interface TestPath {
  name: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

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
  /** legacy lamp positions (baked as default warm lights) */
  lamps: THREE.Vector3[] = [];
  /** baked static lights (see finish) */
  lights: BakeLight[] = [];
  testPaths: TestPath[] = [];
  /** world AABBs kept clear of props (door approaches, stair runs) */
  reserved: THREE.Box3[] = [];
  /** props skipped because they overlapped a reserved zone (diagnostics) */
  skipped = 0;
  private beacons: { pos: THREE.Vector3; color: THREE.Color; period: number; phase: number }[] = [];

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
      hull: paint('hull', 0xcbc7bf),
      hullGray: paint('hullGray', 0xa5acb8),
      dark: pbr('b-dark', { color: 0x3a404c, set: brushed, roughness: 1.15, metalness: 0.75, style: { rim: 0.2 } }),
      darkPanel: paint('darkPanel', 0x5a6272, hull2),
      steel: pbr('b-steel', { color: 0xa9afba, set: brushed, roughness: 1.25, metalness: 0.9, physical: { anisotropy: 0.5 }, style: { rim: 0.2 } }),
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
      grid: pbr('b-grid', { color: 0xb8bec9, set: plate, roughness: 1.35, metalness: 0.75, style: { rim: 0.15 } }),
      rubber: pbr('b-rubber', { color: 0x1f2228, roughness: 0.9, metalness: 0 }),
      containerRed: pbr('b-cRed', { color: 0xc4432f, set: corr, roughness: 1, metalness: 1 }),
      containerBlue: pbr('b-cBlue', { color: 0x2f6fb5, set: corr, roughness: 1, metalness: 1 }),
      containerGreen: pbr('b-cGreen', { color: 0x4f8f4a, set: corr, roughness: 1, metalness: 1 }),
      containerWhite: pbr('b-cWhite', { color: 0xc4c4be, set: corr, roughness: 1, metalness: 1 }),
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
      // ---- architectural kit (OW-like palette: creamy whites, warm trims, teal/orange/brass accents) ----
      cream: paint('cream', 0xcfbb9a, hull),
      trim: pbr('b-trim', { color: 0x4d4843, set: brushed, roughness: 1.1, metalness: 0.7, style: { rim: 0.25 } }),
      teal: paint('teal', 0x1c9c92, hull2, { coat: 0.5 }),
      orange: paint('orange', 0xf2782a, hull2, { coat: 0.5 }),
      brass: pbr('b-brass', { color: 0xe0a94e, set: brushed, roughness: 0.8, metalness: 1, physical: { clearcoat: 0.6, clearcoatRoughness: 0.3 }, style: { rim: 0.35, rimColor: 0xffe0a0 } }),
      regolith: pbr('b-regolith', { color: 0xaaa398, set: printedSet(1), roughness: 1, metalness: 1, style: { rim: 0.12, rimColor: 0xe8dcc8 } }),
      regolithCell: pbr('b-regolithCell', { color: 0xb7ad9f, set: printedSet(2, true), roughness: 1, metalness: 1, style: { rim: 0.14, rimColor: 0xe8dcc8 } }),
      sandbag: pbr('b-sandbag', { color: 0xb09f82, set: sandbagSet(5), roughness: 1, metalness: 1, style: { rim: 0.1 } }),
      hesco: pbr('b-hesco', { color: 0xb8ab93, set: meshBasketSet(4), roughness: 1, metalness: 1, style: { rim: 0.12 } }),
      fabric: pbr('b-fabric', { color: 0xdcd6c8, set: fabricSet(), roughness: 1, metalness: 0, physical: { sheen: 0.6, sheenColor: 0xfff4dc, sheenRoughness: 0.5 }, style: { rim: 0.3, rimColor: 0xfff0d8 } }),
      tile: pbr('b-tile', { color: 0xe0d2bb, set: tileSet(2), roughness: 1, metalness: 1, style: { rim: 0.1 } }),
      wood: pbr('b-wood', { color: 0xc98f55, set: woodSet(3), roughness: 1, metalness: 1, style: { rim: 0.15, rimColor: 0xffd9a8 } }),
      plant: pbr('b-plant', { color: 0x63b447, roughness: 0.62, metalness: 0, flat: true, emissive: 0x16330c, emissiveIntensity: 0.6, style: { rim: 0.45, rimColor: 0xc8ff9a } }),
      plantDark: pbr('b-plantDark', { color: 0x2f8240, roughness: 0.7, metalness: 0, flat: true, emissive: 0x0b240f, emissiveIntensity: 0.6, style: { rim: 0.35, rimColor: 0xb0ff90 } }),
      soil: pbr('b-soil', { color: 0x4f3a2a, set: concrete, roughness: 1.1, metalness: 0, style: { rim: 0.05 } }),
      padDark: pbr('b-padDark', { color: 0x9a958d, set: concrete, roughness: 1, metalness: 1, style: { rim: 0.1 } }),
      paintWhite: pbr('b-paintWhite', { color: 0xd6d2c9, roughness: 0.7, metalness: 0, style: { rim: 0.1 } }),
      fabricTeal: pbr('b-fabricTeal', { color: 0x2c9e94, set: fabricSet(), roughness: 1, metalness: 0, physical: { sheen: 0.8, sheenColor: 0x9ff6e8, sheenRoughness: 0.5 }, style: { rim: 0.3 } }),
      fabricOrange: pbr('b-fabricOrange', { color: 0xe8772e, set: fabricSet(), roughness: 1, metalness: 0, physical: { sheen: 0.8, sheenColor: 0xffc890, sheenRoughness: 0.5 }, style: { rim: 0.3 } }),
      screen: glowMat(0x62f2e4, 1.9),
      screenMap: new THREE.MeshBasicMaterial({ map: tacticalTex(), color: new THREE.Color(1.25, 1.25, 1.25), toneMapped: false }),
      screenAmber: glowMat(0xffb24a, 2.1),
      neonTeal: glowMat(0x3ff2d6, 3.2),
      neonWarm: glowMat(0xffc47a, 3.4),
      glassDome: pbr('b-glassDome', { color: 0xd4efff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.13, side: THREE.DoubleSide, envMapIntensity: 2.5, style: { rim: 0.9, rimColor: 0xb8e4ff } }),
      glassTint: pbr('b-glassTint', { color: 0x9fd8ff, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.3, side: THREE.DoubleSide, envMapIntensity: 2, style: { rim: 0.8, rimColor: 0xc8ecff } }),
      labelPort: pbr('b-labelPort', { map: labelTex('TYCHO PORT', 'LUNAR SPACEPORT · GATE 2', '#1c7f86', '#f6f0e0'), roughness: 0.45, metalness: 0.1 }),
      labelLab: pbr('b-labelLab', { map: labelTex('SELENE LAB', 'SELENOLOGY INSTITUTE', '#f6efe0', '#c2571c'), roughness: 0.45, metalness: 0.1 }),
      labelHab: pbr('b-labelHab', { map: labelTex('HAB-3', 'CIVIL HABITAT · ЖИЛОЙ КВАРТАЛ', '#e98a2c', '#fff7ea'), roughness: 0.45, metalness: 0.1 }),
      dirt: pbr('b-dirt', { color: 0xa8a399, set: regolithSet(12), roughness: 1.05, metalness: 0, style: { rim: 0.08 } }),
      growPink: glowMat(0xff5ad2, 2.4),
      labelDepot: pbr('b-labelDepot', { map: labelTex('DEPOT 12', 'SUPPLY · O₂ · FUEL', '#3a3f4a', '#ffc21a'), roughness: 0.45, metalness: 0.1 }),
    };
    for (const k of ['glassDome', 'glassTint'] as Mat[]) (this.mats[k] as THREE.Material).depthWrite = false;
  }

  /** Register a baked static light. */
  light(pos: THREE.Vector3, color: THREE.ColorRepresentation = 0xffc98a, intensity = 5, radius = 9, opts: { bounds?: THREE.Box3; shadow?: boolean; dir?: THREE.Vector3; cone?: number } = {}): BakeLight {
    const l: BakeLight = { pos: pos.clone(), color: new THREE.Color(color), intensity, radius, ...opts };
    this.lights.push(l);
    return l;
  }

  /** Blinking beacon (all beacons share two instanced draw calls). */
  beacon(pos: THREE.Vector3, color: THREE.ColorRepresentation = 0xff3a2a, period = 1.6, phase = 0): void {
    this.beacons.push({ pos: pos.clone(), color: new THREE.Color(color), period, phase });
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

  /** Build merged meshes (one per material), bake static lights into vertices, instance beacons. */
  finish(): THREE.Group {
    const lights = this.collectLights();
    const grid = lightGrid(lights);
    let bakeMs = 0;
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
      const glow = (material as THREE.MeshBasicMaterial).isMeshBasicMaterial;
      if (!glow) {
        const tb = performance.now();
        merged.setAttribute('bake', bakeVertices(merged, lights, grid, this.world));
        bakeMs += performance.now() - tb;
        ensureBakePatch(material);
      }
      const mesh = new THREE.Mesh(merged, material);
      const clear = material.transparent;
      mesh.castShadow = !glow && !clear;
      mesh.receiveShadow = !glow;
      if (glow || clear) mesh.layers.set(LAYER_NO_OUTLINE);
      if (clear) mesh.renderOrder = 2;
      mesh.matrixAutoUpdate = false;
      mesh.name = 'static-' + mat;
      this.group.add(mesh);
      for (const g of list) g.dispose();
    }
    this.parts.clear();
    this.buildBeacons();
    this.group.userData.bakeMs = bakeMs;
    this.group.userData.lights = lights.length;
    this.group.userData.testPaths = this.testPaths;
    this.group.userData.skipped = this.skipped;
    return this.group;
  }

  private collectLights(): BakeLight[] {
    const out = this.lights.slice();
    const warm = new THREE.Color(0xffd8a0);
    for (const p of this.lamps) out.push({ pos: p, color: warm, intensity: 5, radius: 11 });
    return out;
  }

  private buildBeacons(): void {
    const n = this.beacons.length;
    if (!n) return;
    const core = new THREE.InstancedMesh(new THREE.SphereGeometry(0.18, 10, 8), glowMat(0xffffff, 6), n);
    const halo = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.55, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.5), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      n,
    );
    const on = new Uint8Array(n);
    const m = new THREE.Matrix4();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.beacons.forEach((bc, i) => {
      core.setColorAt(i, bc.color);
      halo.setColorAt(i, bc.color);
      core.setMatrixAt(i, zero);
      halo.setMatrixAt(i, zero);
    });
    for (const im of [core, halo]) {
      im.frustumCulled = false;
      im.layers.set(LAYER_NO_OUTLINE);
      im.name = 'beacons';
      this.group.add(im);
    }
    const beacons = this.beacons;
    this.animated.push({
      update(t) {
        let dirty = false;
        for (let i = 0; i < n; i++) {
          const bc = beacons[i];
          const s = ((t / bc.period + bc.phase) % 1) < 0.18 ? 1 : 0;
          if (s === on[i]) continue;
          on[i] = s;
          dirty = true;
          if (s) m.makeTranslation(bc.pos.x, bc.pos.y, bc.pos.z);
          core.setMatrixAt(i, s ? m : zero);
          halo.setMatrixAt(i, s ? m : zero);
        }
        if (dirty) {
          core.instanceMatrix.needsUpdate = true;
          halo.instanceMatrix.needsUpdate = true;
        }
      },
    });
  }
}

// ---------------------------------------------------------------------------
// baked lighting

const LCELL = 8;
function lkey(ix: number, iz: number): number {
  return (ix + 4096) * 8192 + (iz + 4096);
}
function lightGrid(lights: BakeLight[]): Map<number, number[]> {
  const g = new Map<number, number[]>();
  lights.forEach((l, i) => {
    const x0 = Math.floor((l.pos.x - l.radius) / LCELL);
    const x1 = Math.floor((l.pos.x + l.radius) / LCELL);
    const z0 = Math.floor((l.pos.z - l.radius) / LCELL);
    const z1 = Math.floor((l.pos.z + l.radius) / LCELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = lkey(ix, iz);
        let a = g.get(k);
        if (!a) g.set(k, (a = []));
        a.push(i);
      }
  });
  return g;
}

const _ro = new THREE.Vector3();
const _rd = new THREE.Vector3();
/**
 * Per-vertex static light: smooth windowed inverse-square falloff, wrapped N·L, optional spot cone,
 * room bounds (no leaks) and physics-raycast occlusion for lights flagged `shadow`.
 */
function bakeVertices(g: THREE.BufferGeometry, lights: BakeLight[], grid: Map<number, number[]>, world: PhysicsWorld): THREE.BufferAttribute {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const n = pos.count;
  const out = new Float32Array(n * 3);
  const P = pos.array as Float32Array;
  const N = nrm.array as Float32Array;
  if (!lights.length) return new THREE.BufferAttribute(out, 3);
  for (let i = 0; i < n; i++) {
    const px = P[i * 3];
    const py = P[i * 3 + 1];
    const pz = P[i * 3 + 2];
    const list = grid.get(lkey(Math.floor(px / LCELL), Math.floor(pz / LCELL)));
    if (!list) continue;
    const nx = N[i * 3];
    const ny = N[i * 3 + 1];
    const nz = N[i * 3 + 2];
    let r = 0;
    let gg = 0;
    let b = 0;
    for (let k = 0; k < list.length; k++) {
      const L = lights[list[k]];
      const dx = L.pos.x - px;
      const dy = L.pos.y - py;
      const dz = L.pos.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r2 = L.radius * L.radius;
      if (d2 >= r2) continue;
      if (L.bounds) {
        const bb = L.bounds;
        if (px < bb.min.x || px > bb.max.x || py < bb.min.y || py > bb.max.y || pz < bb.min.z || pz > bb.max.z) continue;
      }
      const d = Math.sqrt(d2) || 1e-3;
      const ndl = (nx * dx + ny * dy + nz * dz) / d;
      const wrap = (ndl + 0.3) / 1.3;
      if (wrap <= 0) continue;
      const q = d2 / r2;
      let win = 1 - q * q;
      win *= win;
      let att = (L.intensity * win) / (d2 + 1);
      if (L.dir) {
        const c = -(dx * L.dir.x + dy * L.dir.y + dz * L.dir.z) / d;
        const cone = L.cone ?? 0.5;
        const t = Math.min(1, Math.max(0, (c - cone) / Math.max(0.05, (1 - cone) * 0.6)));
        att *= t * t * (3 - 2 * t);
        if (att <= 0) continue;
      }
      if (L.shadow && d > 0.9 && att * wrap > 0.03) {
        _ro.set(px + nx * 0.06, py + ny * 0.06, pz + nz * 0.06);
        _rd.set(dx / d, dy / d, dz / d);
        const hit = world.raycast(_ro, _rd, d - 0.4, { forMove: true });
        if (hit) att *= 0.12;
      }
      const e = att * Math.min(1, wrap);
      r += L.color.r * e;
      gg += L.color.g * e;
      b += L.color.b * e;
    }
    // soft clamp keeps hot spots from blowing out
    out[i * 3] = r / (1 + r * 0.25);
    out[i * 3 + 1] = gg / (1 + gg * 0.25);
    out[i * 3 + 2] = b / (1 + b * 0.25);
  }
  return new THREE.BufferAttribute(out, 3);
}

/** Adds the `bake` vertex attribute to a lit material as extra diffuse irradiance (before AO). */
function ensureBakePatch(m: THREE.Material): void {
  const ud = m.userData as { bake?: boolean; baseOBC?: THREE.Material['onBeforeCompile'] };
  if (ud.bake) return;
  ud.bake = true;
  const patch = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bake;\nvarying vec3 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBake;')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse += vBake * diffuseColor.rgb;\n#include <aomap_fragment>');
  };
  addPatch(m, 'bake', patch);
  // Lighting (CSM) rebuilds the chain from userData.baseOBC when a new map is loaded: keep the patch there too
  if (ud.baseOBC) {
    const base = ud.baseOBC;
    ud.baseOBC = (shader, renderer) => {
      base.call(m, shader, renderer);
      patch(shader);
    };
  }
  m.needsUpdate = true;
}

/** Tactical display (war room / control rooms): lunar map contours, grid, blips — canvas texture. */
let tactical: THREE.CanvasTexture | null = null;
function tacticalTex(): THREE.CanvasTexture {
  if (tactical) return tactical;
  const w = 512;
  const h = 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#062226';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(80,220,230,0.25)';
  c.lineWidth = 1;
  for (let x = 0; x < w; x += 32) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, h);
    c.stroke();
  }
  for (let y = 0; y < h; y += 32) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
  c.strokeStyle = 'rgba(120,240,255,0.7)';
  c.lineWidth = 2;
  for (let r = 20; r < 140; r += 22) {
    c.beginPath();
    c.ellipse(w * 0.5, h * 0.52, r * 1.5, r * 0.8, 0.2, 0, Math.PI * 2);
    c.stroke();
  }
  c.strokeStyle = 'rgba(255,190,90,0.9)';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(40, 200);
  c.lineTo(160, 150);
  c.lineTo(250, 130);
  c.lineTo(360, 90);
  c.lineTo(470, 60);
  c.stroke();
  const blip = (x: number, y: number, col: string, label: string) => {
    c.fillStyle = col;
    c.beginPath();
    c.arc(x, y, 7, 0, Math.PI * 2);
    c.fill();
    c.font = 'bold 18px "Russo One", sans-serif';
    c.fillText(label, x + 11, y - 8);
  };
  blip(96, 176, '#4dd8ff', 'A');
  blip(256, 130, '#7ff0ff', 'B');
  blip(420, 72, '#ffa033', 'C');
  c.fillStyle = 'rgba(120,240,255,0.9)';
  c.font = 'bold 16px "Russo One", sans-serif';
  c.fillText('TYCHO SECTOR · PD-46', 14, 22);
  c.fillText('Δv 1.62', w - 90, h - 14);
  tactical = new THREE.CanvasTexture(cv);
  tactical.colorSpace = THREE.SRGBColorSpace;
  return tactical;
}

function indexify(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
