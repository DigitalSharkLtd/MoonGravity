import * as THREE from 'three';
import { pbr, addPatch } from '../render/Materials';
import { fabricSet, brushedSet, paintSet } from '../render/TextureGen';
import { buildWeaponModel, WeaponModel } from '../weapons/WeaponModels';
import type { HeroId, WeaponId } from '../game/Types';
import { HEROES } from '../game/Types';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';
import { buildSuit, torsoWeights } from './SuitMesh';
import { buildKit, BoneName, Mat, Palette, KitCtx } from './HeroKits';
import { tint } from './ArmorKit';

/** meshes on this layer cast sun shadows but are not drawn by the main camera */
export const LAYER_SHADOW_ONLY = 5;

export interface AnimState {
  speed: number;
  grounded: boolean;
  crouch: number;
  pitch: number;
  jetting: boolean;
  mag: boolean;
  attached: boolean;
  alive: boolean;
  suit: number; // 0..1 of max
  firing: boolean;
  reloading: boolean;
  localVel: THREE.Vector3; // body space: x right, z back
  ability: number; // 0..1 pose blend for ability casts
  stance?: 'stand' | 'crouch' | 'prone' | 'slide' | 'roll';
  grapple?: boolean;
  deflect?: boolean;
  shield?: number; // 0..1 force-field strength
}

export type ModelVariant = HeroId | 'servitor';


const BONES: { name: BoneName; parent: BoneName | null; pos: [number, number, number] }[] = [
  { name: 'root', parent: null, pos: [0, 0, 0] },
  { name: 'hips', parent: 'root', pos: [0, 0.98, 0] },
  { name: 'spine', parent: 'hips', pos: [0, 0.12, 0] },
  { name: 'chest', parent: 'spine', pos: [0, 0.22, 0] },
  { name: 'neck', parent: 'chest', pos: [0, 0.32, 0] },
  { name: 'head', parent: 'neck', pos: [0, 0.08, 0] },
  { name: 'pack', parent: 'chest', pos: [0, 0.06, 0.3] },
  { name: 'armL', parent: 'chest', pos: [-0.38, 0.22, 0] },
  { name: 'foreL', parent: 'armL', pos: [0, -0.33, 0] },
  { name: 'handL', parent: 'foreL', pos: [0, -0.3, 0] },
  { name: 'armR', parent: 'chest', pos: [0.38, 0.22, 0] },
  { name: 'foreR', parent: 'armR', pos: [0, -0.33, 0] },
  { name: 'handR', parent: 'foreR', pos: [0, -0.3, 0] },
  { name: 'legL', parent: 'hips', pos: [-0.15, -0.06, 0] },
  { name: 'shinL', parent: 'legL', pos: [0, -0.44, 0] },
  { name: 'footL', parent: 'shinL', pos: [0, -0.42, 0] },
  { name: 'legR', parent: 'hips', pos: [0.15, -0.06, 0] },
  { name: 'shinR', parent: 'legR', pos: [0, -0.44, 0] },
  { name: 'footR', parent: 'shinR', pos: [0, -0.42, 0] },
];

interface Part {
  bone: BoneName;
  geo: THREE.BufferGeometry;
  mat: Mat;
  /** geometry already in bind-pose model space with its own skin weights */
  pre?: boolean;
  /** rigid geometry in `bone` space skinned with these blended weights */
  w?: Partial<Record<BoneName, number>>;
}

/**
 * Per-variant look: undersuit fabric, secondary (neutral) plate colour, dark trim, suit bulk and
 * overall scale. Main plates take the team / hero colour, accents the hero colour.
 */
const LOOK: Record<ModelVariant, { suit: number; sec: number; trim: number; bulk: number; scale: number }> = {
  condor: { suit: 0x4a505b, sec: 0xe8e4dc, trim: 0x353a44, bulk: 1, scale: 1 },
  lunatic: { suit: 0x5d5a4a, sec: 0x8e8f86, trim: 0x3b3a35, bulk: 1, scale: 1 },
  needle: { suit: 0x46505e, sec: 0xe6e8ec, trim: 0x2f3542, bulk: 0.92, scale: 1.03 },
  phantom: { suit: 0x2a2d35, sec: 0x3b3f4b, trim: 0x1f2229, bulk: 0.92, scale: 0.98 },
  blade: { suit: 0x262c2f, sec: 0x1f2426, trim: 0x2b2f33, bulk: 0.92, scale: 1 },
  reactor: { suit: 0x3c3f45, sec: 0x4a4e57, trim: 0x2b2e34, bulk: 1.22, scale: 1.12 },
  helios: { suit: 0xdedbd3, sec: 0xf1efe9, trim: 0x3a3f48, bulk: 1, scale: 1 },
  forge: { suit: 0xb3a68c, sec: 0x9c8a6a, trim: 0x3a3833, bulk: 1.1, scale: 1.04 },
  hive: { suit: 0x34363b, sec: 0x26282c, trim: 0x2a2c31, bulk: 1, scale: 1 },
  servitor: { suit: 0x4a505c, sec: 0x6b7280, trim: 0x2a2e36, bulk: 0.85, scale: 0.93 },
};

/** foregrip distance (m, along the barrel from the grip) for the support hand */
const FOREGRIP: Partial<Record<WeaponId, number>> = { pulse: 0.3, rail: 0.36, plasma: 0.25, glauncher: 0.27, sealer: 0.24, twinarc: 0, nuke: 0.12, singularity: 0.3, helios: 0.3, riveter: 0.27, burst: 0.3 };

const _ikS = new THREE.Vector3();
const _ikE = new THREE.Vector3();
const _ikT = new THREE.Vector3();
const _ikD = new THREE.Vector3();
const _ikP = new THREE.Vector3();
const _ikX = new THREE.Vector3();
const _ikY = new THREE.Vector3();
const _ikZ = new THREE.Vector3();
const _ikM = new THREE.Matrix4();
const _ikQ = new THREE.Quaternion();
const _ikQ2 = new THREE.Quaternion();
const _ikV = new THREE.Vector3();

/** world quaternion of an object (ignores scale) */
function worldQuat(o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  o.matrixWorld.decompose(_ikV, out, _ikP);
  return out;
}

/**
 * Analytic two-bone IK (shoulder → elbow → wrist). Bones hang along their local -Y and the
 * lower bone bends about its local +X (toward -Z), like the FK rig. `pole` pulls the elbow.
 * Result is slerped over the current (FK) pose by `w`.
 */
function solveTwoBone(upper: THREE.Bone, lower: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, l1: number, l2: number, w: number): void {
  if (w <= 0.001) return;
  upper.getWorldPosition(_ikS);
  _ikD.copy(target).sub(_ikS);
  const dist = THREE.MathUtils.clamp(_ikD.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.999);
  _ikD.normalize();
  // bend direction: pole projected on the plane perpendicular to the reach
  _ikP.copy(pole).sub(_ikS);
  _ikP.addScaledVector(_ikD, -_ikP.dot(_ikD));
  if (_ikP.lengthSq() < 1e-8) _ikP.set(0, -1, 0).addScaledVector(_ikD, _ikD.y);
  _ikP.normalize();
  const a = (l1 * l1 + dist * dist - l2 * l2) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _ikE.copy(_ikS).addScaledVector(_ikD, a).addScaledVector(_ikP, h);
  _ikT.copy(_ikS).addScaledVector(_ikD, dist);
  // upper frame: +Y from elbow back to shoulder, +Z toward the bend side, X = Y × Z
  _ikY.copy(_ikS).sub(_ikE).normalize();
  _ikZ.copy(_ikP).addScaledVector(_ikY, -_ikP.dot(_ikY)).normalize();
  _ikX.crossVectors(_ikY, _ikZ).normalize();
  _ikZ.crossVectors(_ikX, _ikY);
  _ikM.makeBasis(_ikX, _ikY, _ikZ);
  _ikQ.setFromRotationMatrix(_ikM);
  worldQuat(upper.parent!, _ikQ2).invert();
  _ikQ.premultiply(_ikQ2);
  upper.quaternion.slerp(_ikQ, w);
  upper.updateMatrixWorld(true);
  // lower: pure hinge about local X
  const bend = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1));
  const ang = Math.PI - bend;
  _ikQ.setFromAxisAngle(_ikV.set(1, 0, 0), ang);
  lower.quaternion.slerp(_ikQ, w);
  lower.updateMatrixWorld(true);
}

/** set a bone's world orientation (slerped by w) */
function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion, w: number): void {
  if (w <= 0.001) return;
  worldQuat(bone.parent!, _ikQ2).invert();
  _ikQ.copy(q).premultiply(_ikQ2);
  bone.quaternion.slerp(_ikQ, w);
  bone.updateMatrixWorld(true);
}

let glowVC: THREE.MeshBasicMaterial | null = null;

function mats(v: ModelVariant, suitCol: number, visor: number): Record<Mat, THREE.Material> {
  const fabric = fabricSet();
  glowVC ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 2.3, 2.3), vertexColors: true, toneMapped: false });
  return {
    suit:
      v === 'servitor'
        ? pbr('h-suit-bot', { color: suitCol, set: brushedSet(26), repeat: 2, roughness: 1.1, metalness: 0.85, vertexColors: true, style: { rim: 0.3 } })
        : pbr('h-suit|' + suitCol.toString(16), { color: suitCol, set: fabric, repeat: 3, roughness: 1, metalness: 0, vertexColors: true, physical: { sheen: 0.35, sheenColor: 0xdfe8ff, sheenRoughness: 0.6 }, style: { rim: 0.3 } }),
    paint: pbr('h-paint', { color: 0xffffff, set: paintSet(), repeat: 1, roughness: 1, metalness: 1, vertexColors: true, physical: { clearcoat: 0.6, clearcoatRoughness: 0.26 }, style: { rim: 0.4 } }),
    dark: pbr('h-dark', { color: 0x2c3039, set: brushedSet(24), repeat: 2, roughness: 1.3, metalness: 0.6, vertexColors: true, style: { rim: 0.3 } }),
    metal: pbr('h-metal', { color: 0xb8bec8, set: brushedSet(25), repeat: 2, roughness: 1, metalness: 1, vertexColors: true, style: { rim: 0.3 } }),
    visor: visorMat(visor),
    glow: glowVC,
  };
}

/**
 * Tinted glossy visor glass with an inner glow; the vertex colour (a top-dark → bottom-bright
 * gradient baked by the kits) scales both the reflectance and the glow, so it reads as curved glass.
 */
function visorMat(visor: number): THREE.Material {
  const m = pbr('h-visor|' + visor.toString(16), { color: new THREE.Color(visor).multiplyScalar(0.3), roughness: 0.14, metalness: 0.4, envMapIntensity: 0.8, emissive: visor, emissiveIntensity: 0.62, vertexColors: true, style: { rim: 0.35, rimColor: 0xffffff } });
  if (!m.userData.visorGlow) {
    m.userData.visorGlow = true;
    addPatch(m, 'visorglow', (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb * vColor.rgb;\n#endif');
    });
  }
  return m;
}

/**
 * Stylised hero astronaut built from procedural parts rigidly skinned to a bone rig.
 * One SkinnedMesh per material keeps draw calls low; bones are animated procedurally.
 */
export class HeroModel {
  root = new THREE.Group();
  hero: HeroId;
  bones = new Map<BoneName, THREE.Bone>();
  skeleton: THREE.Skeleton;
  meshes: THREE.SkinnedMesh[] = [];
  outlines: THREE.SkinnedMesh[] = [];
  private jetFlames: THREE.Mesh[] = [];
  private soleGlow: THREE.Mesh[] = [];
  private weaponHolder = new THREE.Group();
  weapon: WeaponModel | null = null;
  weaponId: WeaponId | null = null;
  muzzleWorld = new THREE.Vector3();
  packWorld = new THREE.Vector3();
  headWorld = new THREE.Vector3();
  private phase = 0;
  private deathT = 0;
  private flinch = 0;
  private fireKick = 0;
  private cloakMat: THREE.Material;
  private baseMats: THREE.Material[] = [];
  private cloak = 0;
  private scale: number;
  private highlight: 'none' | 'enemy' | 'ally' = 'none';
  private outlineMat: THREE.ShaderMaterial;
  private visorCrack: THREE.Mesh | null = null;
  handLWorld = new THREE.Vector3();
  readonly variant: ModelVariant;
  private swingT = 0;
  private swingSide = 1;
  private rollP = 0;
  private lastStance = 'stand';
  private slideK = 0;
  private proneK = 0;
  private grappleK = 0;
  private deflectK = 0;
  private shieldMesh: THREE.Mesh | null = null;
  private armLen: [number, number] = [0.33, 0.3];
  private reloadK = 0;
  private castK = 0;
  private gunQ = new THREE.Quaternion();

  constructor(hero: HeroId, teamColor: number | null, variant?: 'servitor') {
    this.hero = hero;
    this.variant = variant ?? hero;
    const def = HEROES[hero];
    const heroCol = variant === 'servitor' ? 0xff9f43 : new THREE.Color(def.color).getHex();
    const main = teamColor ?? heroCol;
    const accent = teamColor !== null ? heroCol : new THREE.Color(heroCol).offsetHSL(0.03, 0, 0.12).getHex();
    const visor = variant === 'servitor' ? 0xff6a2a : new THREE.Color(def.visor).getHex();
    const look = LOOK[this.variant];
    const M = mats(this.variant, look.suit, visor);
    this.scale = look.scale;

    // --- skeleton ---
    const boneList: THREE.Bone[] = [];
    for (const b of BONES) {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.set(...b.pos);
      if (b.parent) this.bones.get(b.parent)!.add(bone);
      this.bones.set(b.name, bone);
      boneList.push(bone);
    }
    const rootBone = this.bones.get('root')!;
    rootBone.scale.setScalar(this.scale);
    rootBone.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(boneList);

    // --- parts ---
    const parts: Part[] = [];
    const pal: Palette = { main: new THREE.Color(main), acc: new THREE.Color(accent), sec: new THREE.Color(look.sec), trim: new THREE.Color(look.trim), glow: new THREE.Color(accent) };
    const colorize = (geo: THREE.BufferGeometry, mat: Mat, col?: THREE.ColorRepresentation) => {
      if (col !== undefined) tint(geo, col, true);
      else if (!geo.getAttribute('color')) tint(geo, mat === 'paint' ? pal.main : mat === 'glow' ? pal.glow : 0xffffff);
      return geo;
    };
    const visorGeos: THREE.BufferGeometry[] = [];
    const idxOf = (n: BoneName) => boneList.indexOf(this.bones.get(n)!);
    const skin = (g: THREE.BufferGeometry, wOf: (y: number) => Partial<Record<BoneName, number>>) => {
      const n = g.getAttribute('position').count;
      const pos = g.getAttribute('position');
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const list = Object.entries(wOf(pos.getY(i))).filter((e) => (e[1] ?? 0) > 1e-4).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 4);
        const sum = list.reduce((a, e) => a + (e[1] ?? 0), 0) || 1;
        list.forEach(([b, w], j) => {
          si[i * 4 + j] = idxOf(b as BoneName);
          sw[i * 4 + j] = (w ?? 0) / sum;
        });
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    };
    const sc = this.scale;
    const ctx: KitCtx = {
      pal,
      bulk: look.bulk,
      nozzles: [],
      add: (bone, mat, geo, col) => {
        colorize(geo, mat, col);
        if (bone === 'head' && mat === 'visor') visorGeos.push(geo.clone());
        parts.push({ bone, mat, geo });
      },
      blend: (space, w, mat, geo, col) => parts.push({ bone: space, mat, geo: colorize(geo, mat, col), w }),
      torso: (mat, geo, col) => {
        colorize(geo, mat, col);
        const g = geo.index ? geo.toNonIndexed() : geo;
        g.scale(sc, sc, sc);
        skin(g, (y) => torsoWeights(y / sc, false) as Partial<Record<BoneName, number>>);
        parts.push({ bone: 'root', mat, geo: g, pre: true });
      },
    };
    buildKit(this.variant, ctx);
    if (this.variant !== 'servitor') {
      const suit = buildSuit(
        { pos: (n) => this.bones.get(n as BoneName)!.getWorldPosition(new THREE.Vector3()), index: (n) => boneList.indexOf(this.bones.get(n as BoneName)!) },
        { bulk: look.bulk, scale: this.scale, folds: hero === 'phantom' || hero === 'blade' ? 0.3 : 1 },
      );
      parts.push({ bone: 'root', mat: 'suit', geo: tint(suit, 0xffffff), pre: true });
    }
    this.armLen = [0.33 * this.scale, 0.3 * this.scale];

    // group by material, bake into bind pose, create skinned meshes
    const keep = new Set(['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight']);
    const byMat = new Map<Mat, THREE.BufferGeometry[]>();
    for (const p of parts) {
      let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      if (!p.pre) {
        const bone = this.bones.get(p.bone)!;
        // bake into the skeleton's bind space (root bone has no parent here, so matrixWorld = model space)
        g.applyMatrix4(bone.matrixWorld);
        const n = g.getAttribute('position').count;
        const w = p.w ?? { [p.bone]: 1 };
        skin(g, () => w);
        void n;
      }
      for (const k of Object.keys(g.attributes)) if (!keep.has(k)) g.deleteAttribute(k);
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      if (!g.getAttribute('color')) tint(g, 0xffffff);
      let list = byMat.get(p.mat);
      if (!list) byMat.set(p.mat, (list = []));
      list.push(g);
    }
    this.outlineMat = makeOutlineMat();
    for (const [kind, list] of byMat) {
      const merged = mergeNonIndexed(list);
      const mesh = new THREE.SkinnedMesh(merged, M[kind]);
      mesh.bind(this.skeleton, new THREE.Matrix4());
      mesh.castShadow = kind !== 'glow';
      mesh.receiveShadow = kind !== 'glow';
      mesh.frustumCulled = false;
      if (kind === 'glow') mesh.layers.set(LAYER_NO_OUTLINE);
      this.meshes.push(mesh);
      this.baseMats.push(M[kind]);
      if (kind !== 'glow') {
        const ol = new THREE.SkinnedMesh(merged, this.outlineMat);
        ol.bind(this.skeleton, new THREE.Matrix4());
        ol.frustumCulled = false;
        ol.visible = false;
        ol.castShadow = false;
        ol.layers.set(LAYER_NO_OUTLINE);
        this.outlines.push(ol);
      }
    }
    this.root.add(rootBone, ...this.meshes, ...this.outlines);

    // --- non-skinned attachments: jet flames, sole glows, weapon ---
    const pack = this.bones.get('pack')!;
    const nozzles = ctx.nozzles.length ? ctx.nozzles : ([[0.15, -0.72, 0.06], [-0.15, -0.72, 0.06]] as [number, number, number][]);
    for (const nz of nozzles) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.075, 0.7, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fd8ff).multiplyScalar(3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      flame.rotation.x = Math.PI;
      flame.position.set(...nz);
      flame.visible = false;
      flame.layers.set(LAYER_NO_OUTLINE);
      pack.add(flame);
      this.jetFlames.push(flame);
    }
    for (const f of ['footL', 'footR'] as BoneName[]) {
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.32), soleGlowMat());
      sole.position.set(0, -0.085, -0.04);
      sole.layers.set(LAYER_NO_OUTLINE);
      this.bones.get(f)!.add(sole);
      this.soleGlow.push(sole);
    }
    // cracked visor overlay (shown when the suit is breached): the visor panes pushed out a hair
    if (visorGeos.length) {
      const cg = mergeNonIndexed(
        visorGeos.map((v) => {
          const g = v.index ? v.toNonIndexed() : v.clone();
          for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
          const p = g.getAttribute('position');
          const nm = g.getAttribute('normal');
          const uv = new Float32Array(p.count * 2);
          for (let i = 0; i < p.count; i++) {
            p.setXYZ(i, p.getX(i) + nm.getX(i) * 0.0015, p.getY(i) + nm.getY(i) * 0.0015, p.getZ(i) + nm.getZ(i) * 0.0015);
            uv[i * 2] = 0.55 + (p.getX(i) + 0.03) / 0.26;
            uv[i * 2 + 1] = 0.57 + (p.getY(i) - 0.12) / 0.26;
          }
          g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
          return g;
        }),
        ['position', 'normal', 'uv'],
      );
      const crack = new THREE.Mesh(cg, crackMaterial());
      crack.visible = false;
      this.bones.get('head')!.add(crack);
      this.visorCrack = crack;
    }
    this.bones.get('handR')!.add(this.weaponHolder);
    this.weaponHolder.position.set(0, -0.06, -0.02);

    this.cloakMat = new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending });
    this.setWeapon(variant === 'servitor' ? 'pulse' : def.weapon);
  }

  /** melee swing (katana slash / rifle bash), side alternates */
  swing(side: number): void {
    this.swingT = 1;
    this.swingSide = side;
  }

  private ensureShield(): THREE.Mesh {
    if (this.shieldMesh) return this.shieldMesh;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x6fd0ff) }, uAmt: { value: 1 }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAmt; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
          float hex = abs(sin(vP.y*18.0 + uTime*3.0) * sin(atan(vP.z, vP.x)*9.0));
          float a = (f*0.55 + smoothstep(0.94,1.0,hex)*0.12) * uAmt;
          gl_FragColor = vec4(uColor*1.4, a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    m.scale.set(0.8, 1.15, 0.8);
    m.position.y = 1.0;
    m.layers.set(LAYER_NO_OUTLINE);
    m.visible = false;
    this.root.add(m);
    this.shieldMesh = m;
    return m;
  }

  setHighlight(kind: 'none' | 'enemy' | 'ally'): void {
    this.highlight = kind;
    const col = kind === 'enemy' ? 0xff3b3b : kind === 'ally' ? 0x4dd8ff : 0x000000;
    (this.outlineMat.uniforms.uColor.value as THREE.Color).setHex(col);
    for (const o of this.outlines) o.visible = kind !== 'none';
  }

  setWeapon(id: WeaponId | null): void {
    if (id === this.weaponId) return;
    if (this.weapon) this.weaponHolder.remove(this.weapon.group);
    this.weaponId = id;
    this.weapon = id ? buildWeaponModel(id, new THREE.Color(HEROES[this.hero].color).getHex()) : null;
    if (this.weapon) {
      this.weapon.group.rotation.x = -Math.PI / 2;
      this.weaponHolder.add(this.weapon.group);
    }
  }

  hit(): void {
    this.flinch = 1;
  }
  fired(): void {
    this.fireKick = 1;
  }
  resetPose(): void {
    this.deathT = 0;
    this.bones.get('root')!.rotation.set(0, 0, 0);
  }

  /**
   * First-person: the body is moved to LAYER_SHADOW_ONLY (rendered by the sun's shadow cameras,
   * not by the main camera) so the player still casts a shadow; attachments are hidden.
   */
  setFirstPerson(fp: boolean): void {
    this.fp = fp;
    for (const m of this.meshes) {
      if (fp) {
        m.userData.fpLayers ??= m.layers.mask;
        m.layers.set(LAYER_SHADOW_ONLY);
      } else if (m.userData.fpLayers !== undefined) m.layers.mask = m.userData.fpLayers;
    }
    for (const o of this.outlines) o.visible = !fp && this.highlight !== 'none';
    this.weaponHolder.visible = !fp;
    for (const g of this.soleGlow) g.layers.set(fp ? 31 : LAYER_NO_OUTLINE);
    if (this.visorCrack) this.visorCrack.layers.set(fp ? 31 : 0);
  }
  private fp = false;

  /** 0 = visible, 1 = fully cloaked (Phantom). Local owner sees a faint self. */
  setCloak(amount: number): void {
    if (Math.abs(amount - this.cloak) < 0.01) return;
    this.cloak = amount;
    const cloaked = amount > 0.5;
    this.meshes.forEach((m, i) => (m.material = cloaked ? this.cloakMat : this.baseMats[i]));
    for (const o of this.outlines) o.visible = !cloaked && this.highlight !== 'none';
    this.weaponHolder.visible = !cloaked;
  }

  update(dt: number, s: AnimState, time: number): void {
    const B = (n: BoneName) => this.bones.get(n)!;
    const moving = s.speed > 0.4 && s.grounded;
    const run = s.speed > 4.8;
    this.phase += dt * (moving ? Math.min(1.7, s.speed / 3.2) * 3.1 : 0);
    const ph = this.phase * Math.PI;
    this.flinch = Math.max(0, this.flinch - dt * 5);
    this.fireKick = Math.max(0, this.fireKick - dt * 12);
    this.swingT = Math.max(0, this.swingT - dt * 3.1);
    const stance = s.stance ?? 'stand';
    if (stance === 'roll' && this.lastStance !== 'roll') this.rollP = 0;
    this.lastStance = stance;
    if (stance === 'roll') this.rollP = Math.min(1, this.rollP + dt / 0.55);
    const ease = (k: number, target: number, rate: number) => k + (target - k) * Math.min(1, dt * rate);
    this.slideK = ease(this.slideK, stance === 'slide' ? 1 : 0, 14);
    this.proneK = ease(this.proneK, stance === 'prone' ? 1 : 0, 7);
    this.grappleK = ease(this.grappleK, s.grapple ? 1 : 0, 10);
    this.deflectK = ease(this.deflectK, s.deflect ? 1 : 0, 16);
    if (s.shield && s.shield > 0.01 && s.alive) {
      const sh = this.ensureShield();
      sh.visible = !this.fp && this.cloak < 0.5;
      const u = (sh.material as THREE.ShaderMaterial).uniforms;
      u.uAmt.value = 0.25 + s.shield * 0.45;
      u.uTime.value = time;
    } else if (this.shieldMesh) this.shieldMesh.visible = false;

    for (const f of this.jetFlames) {
      f.visible = s.jetting && s.alive && !this.fp && this.cloak < 0.5;
      if (f.visible) f.scale.set(1, 0.75 + Math.random() * 0.55, 1);
    }
    for (const g of this.soleGlow) {
      g.visible = s.mag && this.cloak < 0.5;
      g.scale.set(1, s.attached ? 1.6 : 1, 1);
    }
    if (this.visorCrack) this.visorCrack.visible = s.suit < 0.5 && this.cloak < 0.5;

    const root = B('root');
    root.position.set(0, 0, 0);
    if (!s.alive) {
      this.deathT = Math.min(1, this.deathT + dt * 0.65);
      const e = 1 - Math.pow(1 - this.deathT, 3);
      root.rotation.x = e * 1.45;
      B('hips').position.y = 0.98 - e * 0.5;
      B('armL').rotation.set(-e * 2.2, 0, -e * 0.7);
      B('armR').rotation.set(-e * 2.0, 0, e * 0.7);
      B('foreL').rotation.set(-e * 0.4, 0, 0);
      B('foreR').rotation.set(-e * 0.4, 0, 0);
      B('legL').rotation.set(-e * 0.45, 0, -e * 0.1);
      B('legR').rotation.set(e * 0.25, 0, e * 0.1);
      B('shinL').rotation.x = e * 0.5;
      B('shinR').rotation.x = e * 0.2;
      B('head').rotation.x = e * 0.35;
      this.updateWorld();
      return;
    }
    root.rotation.x = 0;

    let bob = 0;
    const legL = B('legL');
    const legR = B('legR');
    const shinL = B('shinL');
    const shinR = B('shinR');
    const side = THREE.MathUtils.clamp(s.localVel.x / 5, -1, 1);
    const back = THREE.MathUtils.clamp(s.localVel.z / 5, -1, 1);
    const dirSign = back > 0.3 ? -1 : 1;
    if (moving) {
      if (run) {
        // lunar bound: both legs swing together, body floats
        const h = Math.abs(Math.sin(ph));
        bob = h * 0.13;
        const sw = Math.sin(ph * 2) * 0.3 * dirSign;
        legL.rotation.set(sw - 0.25, 0, -side * 0.15);
        legR.rotation.set(sw - 0.12, 0, -side * 0.15);
        shinL.rotation.x = 0.45 + Math.cos(ph * 2) * 0.3;
        shinR.rotation.x = 0.35 + Math.cos(ph * 2) * 0.3;
      } else {
        const amp = 0.6 * Math.min(1, s.speed / 3);
        const sw = Math.sin(ph) * amp * dirSign;
        bob = Math.abs(Math.cos(ph)) * 0.05;
        legL.rotation.set(sw, 0, -side * 0.25);
        legR.rotation.set(-sw, 0, -side * 0.25);
        shinL.rotation.x = 0.15 + Math.max(0, -Math.sin(ph) * dirSign) * 0.65;
        shinR.rotation.x = 0.15 + Math.max(0, Math.sin(ph) * dirSign) * 0.65;
      }
    } else if (!s.grounded) {
      const t = time * 1.3;
      legL.rotation.set(-0.4 + Math.sin(t) * 0.08, 0, -0.06);
      legR.rotation.set(0.15 + Math.sin(t + 1) * 0.08, 0, 0.06);
      shinL.rotation.x = 0.7;
      shinR.rotation.x = 0.4;
    } else {
      const br = Math.sin(time * 1.8) * 0.02;
      legL.rotation.set(br, 0, -0.04);
      legR.rotation.set(-br, 0, 0.04);
      shinL.rotation.x = 0.06;
      shinR.rotation.x = 0.06;
      bob = br * 0.2;
    }
    B('footL').rotation.x = -shinL.rotation.x * 0.5 - legL.rotation.x * 0.3;
    B('footR').rotation.x = -shinR.rotation.x * 0.5 - legR.rotation.x * 0.3;
    const cr = s.crouch;
    legL.rotation.x -= cr * 0.95;
    legR.rotation.x -= cr * 0.95;
    shinL.rotation.x += cr * 1.6;
    shinR.rotation.x += cr * 1.6;
    B('footL').rotation.x -= cr * 0.6;
    B('footR').rotation.x -= cr * 0.6;
    B('hips').position.y = 0.98 + bob - cr * 0.4;

    const p = s.pitch;
    const spine = B('spine');
    const chest = B('chest');
    spine.rotation.set(p * 0.2 + cr * 0.2, 0, -side * 0.08);
    chest.rotation.set(p * 0.2 + this.flinch * 0.25, 0, Math.sin(ph) * 0.03 * (moving ? 1 : 0));
    B('head').rotation.x = p * 0.3;
    const armPitch = p * 0.6 - this.fireKick * 0.12;
    const aimBase = Math.PI / 2 - 0.15;
    const katana = this.weaponId === 'blade';
    if (katana) {
      // katana guard: two-handed mid stance, blade angled up-forward
      B('armR').rotation.set(0.75 + armPitch * 0.5 - cr * 0.1, 0.1, 0.25);
      B('foreR').rotation.set(0.9, 0, 0);
      B('armL').rotation.set(0.85 + armPitch * 0.5, 0, -0.45);
      B('foreL').rotation.set(1.0, 0, 0.35);
      if (moving) {
        B('armL').rotation.x += Math.sin(ph) * 0.15;
        B('armR').rotation.x -= Math.sin(ph) * 0.08;
      }
    } else {
      B('armR').rotation.set(aimBase + armPitch - cr * 0.15, 0.05, 0.1);
      B('foreR').rotation.set(0.15, 0, 0);
      B('armL').rotation.set(aimBase + 0.08 + armPitch - cr * 0.15, 0, -0.62);
      B('foreL').rotation.set(0.45, 0, 0.2);
    }
    if (s.reloading) {
      B('armL').rotation.x -= 0.6 + Math.sin(time * 12) * 0.2;
      B('foreL').rotation.x += 0.7;
    }
    if (s.ability > 0) {
      // arm raised for casting
      B('armL').rotation.x = THREE.MathUtils.lerp(B('armL').rotation.x, Math.PI * 0.85, s.ability);
      B('armL').rotation.z = THREE.MathUtils.lerp(B('armL').rotation.z, -0.2, s.ability);
    }
    // ---- melee swing: anticipation → strike → follow-through, torso leads the arm ----
    if (this.swingT > 0) {
      const t = 1 - this.swingT;
      const wind = t < 0.2 ? t / 0.2 : 1;
      const strike = t < 0.2 ? 0 : Math.min(1, (t - 0.2) / 0.3);
      const k = Math.sin(strike * Math.PI * 0.5);
      const sd = this.swingSide;
      const env = Math.sin(Math.min(1, t * 1.25) * Math.PI);
      if (katana) {
        B('armR').rotation.set(THREE.MathUtils.lerp(2.6 * wind, 0.7, k), sd * 0.3, THREE.MathUtils.lerp(sd * 0.9, -sd * 0.5, k));
        B('foreR').rotation.set(THREE.MathUtils.lerp(0.9, 0.2, k), 0, 0);
        B('armL').rotation.set(THREE.MathUtils.lerp(2.3 * wind, 0.8, k), 0, -0.3);
      } else {
        // rifle-butt bash: push the gun forward and across
        B('armR').rotation.x += env * 0.4;
        B('armR').rotation.z -= env * 0.5;
        B('armL').rotation.x += env * 0.5;
      }
      chest.rotation.y = THREE.MathUtils.lerp(-sd * 0.35 * wind, sd * 0.45, k) * env;
      spine.rotation.y = chest.rotation.y * 0.5;
      spine.rotation.x += env * 0.12;
    } else {
      chest.rotation.y = 0;
      spine.rotation.y = 0;
    }
    // ---- deflect guard: blade vertical in front of the chest ----
    if (this.deflectK > 0.01) {
      const k = this.deflectK;
      B('armR').rotation.x = THREE.MathUtils.lerp(B('armR').rotation.x, 1.35, k);
      B('armR').rotation.z = THREE.MathUtils.lerp(B('armR').rotation.z, 0.7, k);
      B('foreR').rotation.x = THREE.MathUtils.lerp(B('foreR').rotation.x, 1.3, k);
      B('armL').rotation.x = THREE.MathUtils.lerp(B('armL').rotation.x, 1.2, k);
      B('armL').rotation.z = THREE.MathUtils.lerp(B('armL').rotation.z, -0.3, k);
      B('foreL').rotation.x = THREE.MathUtils.lerp(B('foreL').rotation.x, 1.4, k);
    }
    // ---- grapple: launcher arm stretched toward the anchor, legs trailing ----
    if (this.grappleK > 0.01) {
      const k = this.grappleK;
      B('armL').rotation.set(THREE.MathUtils.lerp(B('armL').rotation.x, Math.PI * 0.72, k), 0, THREE.MathUtils.lerp(B('armL').rotation.z, -0.15, k));
      B('foreL').rotation.x *= 1 - k;
      legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, 0.35, k);
      legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, 0.1, k);
      shinL.rotation.x = THREE.MathUtils.lerp(shinL.rotation.x, 0.6, k);
      shinR.rotation.x = THREE.MathUtils.lerp(shinR.rotation.x, 0.9, k);
      spine.rotation.x -= 0.25 * k;
    }
    // ---- slide: lean back, lead leg extended, trailing leg tucked, hand skims the floor ----
    if (this.slideK > 0.01) {
      const k = this.slideK;
      B('hips').position.y = THREE.MathUtils.lerp(B('hips').position.y, 0.5, k);
      root.rotation.x = -0.0;
      spine.rotation.x = THREE.MathUtils.lerp(spine.rotation.x, -0.55, k);
      legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x, -1.45, k);
      shinL.rotation.x = THREE.MathUtils.lerp(shinL.rotation.x, 0.15, k);
      legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, -0.55, k);
      shinR.rotation.x = THREE.MathUtils.lerp(shinR.rotation.x, 1.9, k);
      legR.rotation.z = THREE.MathUtils.lerp(legR.rotation.z, 0.35, k);
      B('armL').rotation.set(THREE.MathUtils.lerp(B('armL').rotation.x, -0.5, k), 0, THREE.MathUtils.lerp(B('armL').rotation.z, -0.5, k));
      B('head').rotation.x += 0.35 * k;
    }
    // ---- prone: lying on the belly, weapon forward, crawl cycle ----
    if (this.proneK > 0.01) {
      const k = this.proneK;
      root.rotation.x = -Math.PI / 2 * k;
      root.position.set(0, 0.26 * k, 0.92 * k);
      const crawl = s.speed > 0.2 ? Math.sin(time * 5) : 0;
      B('hips').position.y = THREE.MathUtils.lerp(B('hips').position.y, 0.98, k);
      spine.rotation.x = THREE.MathUtils.lerp(spine.rotation.x, -0.12, k);
      chest.rotation.x = THREE.MathUtils.lerp(chest.rotation.x, -0.15, k);
      B('head').rotation.x = THREE.MathUtils.lerp(B('head').rotation.x, -1.15 + p * 0.3, k);
      legL.rotation.set(THREE.MathUtils.lerp(legL.rotation.x, 0.05 + crawl * 0.25, k), 0, -0.14 * k - crawl * 0.1);
      legR.rotation.set(THREE.MathUtils.lerp(legR.rotation.x, 0.05 - crawl * 0.25, k), 0, 0.14 * k - crawl * 0.1);
      shinL.rotation.x = THREE.MathUtils.lerp(shinL.rotation.x, 0.1 + Math.max(0, crawl) * 0.8, k);
      shinR.rotation.x = THREE.MathUtils.lerp(shinR.rotation.x, 0.1 + Math.max(0, -crawl) * 0.8, k);
      B('footL').rotation.x = THREE.MathUtils.lerp(B('footL').rotation.x, 1.1, k);
      B('footR').rotation.x = THREE.MathUtils.lerp(B('footR').rotation.x, 1.1, k);
      const ap = Math.PI - 0.12 + p * 0.5;
      B('armR').rotation.set(THREE.MathUtils.lerp(B('armR').rotation.x, ap, k), 0.05, THREE.MathUtils.lerp(B('armR').rotation.z, 0.12, k));
      B('armL').rotation.set(THREE.MathUtils.lerp(B('armL').rotation.x, ap + 0.1 + crawl * 0.12, k), 0, THREE.MathUtils.lerp(B('armL').rotation.z, -0.55, k));
    }
    // ---- combat roll: tucked forward somersault around the body center ----
    if (stance === 'roll') {
      const t = this.rollP;
      const e = t * t * (3 - 2 * t);
      const ang = -e * Math.PI * 2;
      const tuck = Math.sin(t * Math.PI);
      root.rotation.x = ang;
      const pivot = new THREE.Vector3(0, 0.55, 0);
      root.position.copy(pivot).sub(pivot.clone().applyEuler(root.rotation));
      B('hips').position.y = 0.98 - tuck * 0.35;
      legL.rotation.x = -1.6 * tuck;
      legR.rotation.x = -1.5 * tuck;
      shinL.rotation.x = 2.2 * tuck;
      shinR.rotation.x = 2.1 * tuck;
      spine.rotation.x = 0.5 * tuck;
      chest.rotation.x = 0.4 * tuck;
      B('head').rotation.x = 0.6 * tuck;
      B('armL').rotation.x = THREE.MathUtils.lerp(B('armL').rotation.x, 0.6, tuck);
      B('armR').rotation.x = THREE.MathUtils.lerp(B('armR').rotation.x, 0.9, tuck);
    }
    // The leg poses above were authored with thigh-forward = negative X, but a bone that hangs
    // along -Y swings forward with POSITIVE X (and the knee must fold the shin backward).
    // Mirror the whole leg chain once so knees bend the anatomical way in every pose.
    for (const n of ['legL', 'legR', 'shinL', 'shinR', 'footL', 'footR'] as BoneName[]) B(n).rotation.x = -B(n).rotation.x;
    this.armIK(dt, s, stance);
    if (this.weapon?.spin) this.weapon.spin.rotation.z += dt * (s.firing ? 14 : 1);
    this.updateWorld();
  }

  /**
   * Weapon handling layer: both hands on the gun via two-bone IK (grip + foregrip), gun held
   * along the view pitch at the shoulder. Overridden (weighted out) by melee swings, rolls,
   * casts (left hand), grapple (left hand) and the katana (FK stance).
   */
  private armIK(dt: number, s: AnimState, stance: string): void {
    const id = this.weaponId;
    if (!id || id === 'blade' || !s.alive) return;
    const B = (n: BoneName) => this.bones.get(n)!;
    this.reloadK += ((s.reloading ? 1 : 0) - this.reloadK) * Math.min(1, dt * 10);
    this.castK += ((s.ability > 0.05 || this.grappleK > 0.05 ? 1 : 0) - this.castK) * Math.min(1, dt * 12);
    const swing = this.swingT > 0 ? Math.sin(Math.min(1, (1 - this.swingT) * 1.25) * Math.PI) : 0;
    const wR = (stance === 'roll' ? 0 : 1) * (1 - swing);
    if (wR <= 0.001) return;
    const wL = wR * (1 - this.castK) * (1 - this.deflectK);
    this.root.updateMatrixWorld(true);
    const sc = this.scale;
    // aim frame in the model group's space → world
    const p = s.pitch;
    const aim = new THREE.Vector3(0, Math.sin(p), -Math.cos(p));
    const right = new THREE.Vector3(1, 0, 0);
    const upv = new THREE.Vector3().crossVectors(right, aim).normalize();
    const chest = B('chest').getWorldPosition(new THREE.Vector3());
    this.root.worldToLocal(chest);
    const heavy = id === 'nuke';
    const twin = id === 'twinarc';
    const kick = this.fireKick;
    const grip = chest
      .clone()
      .addScaledVector(right, (heavy ? 0.2 : twin ? 0.22 : 0.15) * sc)
      .addScaledVector(upv, (heavy ? 0.16 : -0.05 + (stance === 'prone' ? 0.04 : 0)) * sc)
      .addScaledVector(aim, (heavy ? 0.06 : twin ? 0.42 : 0.3) * sc - kick * 0.05);
    // gun orientation: forward = aim, up = upv (+ recoil pitch)
    const gunFwd = aim.clone().applyAxisAngle(right, kick * 0.12);
    const gunUp = new THREE.Vector3().crossVectors(right, gunFwd).normalize();
    // hand frame: x = right, y = -forward, z = -up
    _ikM.makeBasis(right, gunFwd.clone().negate(), gunUp.clone().negate());
    const handQ = new THREE.Quaternion().setFromRotationMatrix(_ikM);
    const groupQ = worldQuat(this.root, new THREE.Quaternion());
    handQ.premultiply(groupQ);
    this.gunQ.copy(handQ);
    const toWorld = (v: THREE.Vector3) => v.applyMatrix4(this.root.matrixWorld);
    // wrist sits behind the grip (weapon holder offset on the hand bone)
    const wristR = grip.clone().addScaledVector(gunFwd, -0.06 * sc).addScaledVector(gunUp, 0.02 * sc);
    const poleR = chest.clone().addScaledVector(right, 0.9).addScaledVector(upv, -1).addScaledVector(aim, -0.3);
    const [l1, l2] = this.armLen;
    solveTwoBone(B('armR'), B('foreR'), toWorld(wristR), toWorld(poleR), l1, l2, wR);
    setWorldQuat(B('handR'), handQ, wR);
    if (wL <= 0.001) return;
    let wristL: THREE.Vector3;
    let qL: THREE.Quaternion;
    if (twin) {
      const gripL = grip.clone().addScaledVector(right, -0.44 * sc);
      wristL = gripL.addScaledVector(gunFwd, -0.06 * sc).addScaledVector(gunUp, 0.02 * sc);
      qL = handQ;
    } else {
      const fg = FOREGRIP[id] ?? 0.28;
      wristL = grip.clone().addScaledVector(gunFwd, fg * sc - 0.05 * sc).addScaledVector(gunUp, -0.035 * sc).addScaledVector(right, -0.04 * sc);
      // reload: support hand drops to the magazine and works it
      if (this.reloadK > 0.01) {
        const mag = grip.clone().addScaledVector(gunFwd, 0.08 * sc).addScaledVector(gunUp, (-0.16 + Math.sin(performance.now() * 0.012) * 0.03) * sc);
        wristL.lerp(mag, this.reloadK);
      }
      // palm under the handguard: hand frame rolled inward around the barrel
      qL = handQ.clone().multiply(_ikQ2.setFromAxisAngle(_ikV.set(0, 1, 0), 0.9));
    }
    const poleL = chest.clone().addScaledVector(right, -0.9).addScaledVector(upv, -1).addScaledVector(aim, -0.2);
    solveTwoBone(B('armL'), B('foreL'), toWorld(wristL), toWorld(poleL), l1, l2, wL);
    setWorldQuat(B('handL'), qL, wL);
  }

  private updateWorld(): void {
    this.root.updateMatrixWorld(true);
    if (this.weapon) this.weapon.muzzle.getWorldPosition(this.muzzleWorld);
    else this.bones.get('handR')!.getWorldPosition(this.muzzleWorld);
    this.bones.get('pack')!.getWorldPosition(this.packWorld);
    this.bones.get('head')!.getWorldPosition(this.headWorld);
    this.bones.get('handL')!.getWorldPosition(this.handLWorld);
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    if (this.shieldMesh) {
      this.shieldMesh.geometry.dispose();
      (this.shieldMesh.material as THREE.Material).dispose();
    }
    this.outlineMat.dispose();
    this.cloakMat.dispose();
  }
}

// ---------------------------------------------------------------------------

function mergeNonIndexed(list: THREE.BufferGeometry[], names = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight']): THREE.BufferGeometry {
  let n = 0;
  for (const g of list) n += g.getAttribute('position').count;
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const first = list[0].getAttribute(name) as THREE.BufferAttribute;
    const size = first.itemSize;
    const arr = name === 'skinIndex' ? new Uint16Array(n * size) : new Float32Array(n * size);
    let o = 0;
    for (const g of list) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      arr.set(a.array as ArrayLike<number>, o);
      o += a.array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

let soleMat: THREE.Material | null = null;
function soleGlowMat(): THREE.Material {
  soleMat ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4dd8ff).multiplyScalar(3.5), toneMapped: false });
  return soleMat;
}

let crackMat: THREE.Material | null = null;
function crackMaterial(): THREE.Material {
  if (crackMat) return crackMat;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(235,245,255,0.95)';
  ctx.lineWidth = 2.2;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 12; i++) {
    let x = 140;
    let y = 110;
    const a = (i / 12) * Math.PI * 2 + rnd() * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += Math.cos(a + (rnd() - 0.5) * 0.9) * 20;
      y += Math.sin(a + (rnd() - 0.5) * 0.9) * 20;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  crackMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
  return crackMat;
}

function makeOutlineMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uThickness: { value: 0.022 }, uColor: { value: new THREE.Color(0xff3b3b) } },
    vertexShader: /* glsl */ `
      uniform float uThickness;
      #include <common>
      #include <skinning_pars_vertex>
      void main() {
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <beginnormal_vertex>
        #include <skinnormal_vertex>
        #include <skinning_vertex>
        transformed += normalize(objectNormal) * uThickness;
        #include <project_vertex>
      }`,
    fragmentShader: `uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor * 2.0, 1.0); }`,
    side: THREE.BackSide,
    toneMapped: false,
  });
}
