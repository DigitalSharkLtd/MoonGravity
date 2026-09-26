import * as THREE from 'three';
import { pbr } from '../render/Materials';
import { fabricSet, panelSet, brushedSet } from '../render/TextureGen';
import { glowMat } from '../render/Toon';
import { buildWeaponModel, WeaponModel } from '../weapons/WeaponModels';
import type { HeroId, WeaponId } from '../game/Types';
import { HEROES } from '../game/Types';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';

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
}

type BoneName = 'root' | 'hips' | 'spine' | 'chest' | 'neck' | 'head' | 'pack' | 'armL' | 'foreL' | 'handL' | 'armR' | 'foreR' | 'handR' | 'legL' | 'shinL' | 'footL' | 'legR' | 'shinR' | 'footR';

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

type MatKind = 'suit' | 'armor' | 'dark' | 'visor' | 'glow' | 'accent' | 'metal';

interface Part {
  bone: BoneName;
  geo: THREE.BufferGeometry;
  mat: MatKind;
}

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function mats(hero: HeroId, main: number, accent: number, visor: number): Record<MatKind, THREE.Material> {
  const key = hero + '|' + main.toString(16) + '|' + accent.toString(16);
  const fabric = fabricSet();
  return {
    suit: pbr('h-suit|' + key, { color: hero === 'phantom' ? 0x3a3f4c : 0xf0eee9, set: fabric, repeat: 3, roughness: 1, metalness: 0, physical: { sheen: 0.6, sheenColor: 0xdfe8ff, sheenRoughness: 0.5 }, style: { rim: 0.35 } }),
    armor: pbr('h-armor|' + key, { color: main, set: panelSet(21, { depth: 3, wear: 0.6, stencil: false }), repeat: 2, roughness: 0.9, metalness: 1, physical: { clearcoat: 0.9, clearcoatRoughness: 0.18 }, style: { rim: 0.4 } }),
    accent: pbr('h-accent|' + key, { color: accent, set: panelSet(22, { depth: 2, wear: 0.4, stencil: false }), repeat: 2, roughness: 0.8, metalness: 1, physical: { clearcoat: 1, clearcoatRoughness: 0.12 }, style: { rim: 0.4 } }),
    dark: pbr('h-dark|' + key, { color: 0x2a2e38, set: brushedSet(24), repeat: 2, roughness: 1.3, metalness: 0.6, style: { rim: 0.3 } }),
    metal: pbr('h-metal|' + key, { color: 0xb8bec8, set: brushedSet(25), repeat: 2, roughness: 1, metalness: 1, style: { rim: 0.3 } }),
    visor: pbr('h-visor|' + key, { color: visor, roughness: 0.04, metalness: 1, envMapIntensity: 1.6, physical: { clearcoat: 1, clearcoatRoughness: 0.02 }, style: { rim: 0.9, rimColor: 0xffffff } }),
    glow: glowMat(accent, 3.2),
  };
}

/** Lathe helper: profile [r, y] pairs → smooth revolved shape. */
function lathe(profile: [number, number][], seg = 20): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
}

function tx(g: THREE.BufferGeometry, pos: THREE.Vector3, rot?: THREE.Euler, scale?: THREE.Vector3): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), scale ?? V3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
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

  constructor(hero: HeroId, teamColor: number | null) {
    this.hero = hero;
    const def = HEROES[hero];
    const heroCol = new THREE.Color(def.color).getHex();
    const main = teamColor ?? heroCol;
    const accent = teamColor !== null ? heroCol : new THREE.Color(def.color).offsetHSL(0.03, 0, 0.12).getHex();
    const visor = new THREE.Color(def.visor).getHex();
    const M = mats(hero, main, accent, visor);
    this.scale = hero === 'reactor' ? 1.12 : hero === 'needle' ? 1.03 : hero === 'phantom' ? 0.98 : 1;

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
    const add = (bone: BoneName, mat: MatKind, geo: THREE.BufferGeometry) => parts.push({ bone, mat, geo });
    buildBody(hero, add);

    // group by material, bake into bind pose, create skinned meshes
    const byMat = new Map<MatKind, THREE.BufferGeometry[]>();
    for (const p of parts) {
      const bone = this.bones.get(p.bone)!;
      const bi = boneList.indexOf(bone);
      // bake into the skeleton's bind space (root bone has no parent here, so matrixWorld = model space)
      const m = bone.matrixWorld.clone();
      let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      g.applyMatrix4(m);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      const n = g.getAttribute('position').count;
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        si[i * 4] = bi;
        sw[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
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
    for (const s of [-1, 1]) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.075, 0.7, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fd8ff).multiplyScalar(3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      flame.rotation.x = Math.PI;
      flame.position.set(s * 0.15, -0.72, 0.06);
      flame.visible = false;
      flame.layers.set(LAYER_NO_OUTLINE);
      pack.add(flame);
      this.jetFlames.push(flame);
    }
    for (const f of ['footL', 'footR'] as BoneName[]) {
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.32), glowMat(0x4dd8ff, 3.5));
      sole.position.set(0, -0.085, -0.04);
      sole.layers.set(LAYER_NO_OUTLINE);
      this.bones.get(f)!.add(sole);
      this.soleGlow.push(sole);
    }
    // cracked visor overlay (shown when the suit is breached)
    const crack = new THREE.Mesh(new THREE.SphereGeometry(0.278, 20, 12, Math.PI * 1.13, Math.PI * 0.74, Math.PI * 0.3, Math.PI * 0.42), crackMaterial());
    crack.position.set(0, 0.2, -0.02);
    crack.visible = false;
    this.bones.get('head')!.add(crack);
    this.visorCrack = crack;
    this.bones.get('handR')!.add(this.weaponHolder);
    this.weaponHolder.position.set(0, -0.06, -0.02);

    this.cloakMat = new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending });
    this.setWeapon(def.weapon);
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
    B('armR').rotation.set(aimBase + armPitch - cr * 0.15, 0.05, 0.1);
    B('foreR').rotation.set(0.15, 0, 0);
    B('armL').rotation.set(aimBase + 0.08 + armPitch - cr * 0.15, 0, -0.62);
    B('foreL').rotation.set(0.45, 0, 0.2);
    if (s.reloading) {
      B('armL').rotation.x -= 0.6 + Math.sin(time * 12) * 0.2;
      B('foreL').rotation.x += 0.7;
    }
    if (s.ability > 0) {
      // arm raised for casting
      B('armL').rotation.x = THREE.MathUtils.lerp(B('armL').rotation.x, Math.PI * 0.85, s.ability);
      B('armL').rotation.z = THREE.MathUtils.lerp(B('armL').rotation.z, -0.2, s.ability);
    }
    if (this.weapon?.spin) this.weapon.spin.rotation.z += dt * (s.firing ? 14 : 1);
    this.updateWorld();
  }

  private updateWorld(): void {
    this.root.updateMatrixWorld(true);
    if (this.weapon) this.weapon.muzzle.getWorldPosition(this.muzzleWorld);
    else this.bones.get('handR')!.getWorldPosition(this.muzzleWorld);
    this.bones.get('pack')!.getWorldPosition(this.packWorld);
    this.bones.get('head')!.getWorldPosition(this.headWorld);
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
    this.outlineMat.dispose();
    this.cloakMat.dispose();
  }
}

// ---------------------------------------------------------------------------

function mergeNonIndexed(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of list) n += g.getAttribute('position').count;
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];
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

// ---------------------------------------------------------------------------
// Hero-specific geometry kits

type Add = (bone: BoneName, mat: MatKind, geo: THREE.BufferGeometry) => void;

function buildBody(hero: HeroId, add: Add): void {
  const E = (x = 0, y = 0, z = 0) => new THREE.Euler(x, y, z);
  const bulk = hero === 'reactor' ? 1.25 : hero === 'phantom' || hero === 'needle' ? 0.9 : 1;

  // --- pelvis & torso (fabric suit) ---
  add('hips', 'suit', tx(new THREE.SphereGeometry(0.22, 18, 12), V3(0, 0.02, 0), E(), V3(1.3 * bulk, 0.85, 1.0 * bulk)));
  add('hips', 'dark', tx(new THREE.TorusGeometry(0.25 * bulk, 0.045, 8, 24), V3(0, 0.1, 0), E(Math.PI / 2)));
  add('spine', 'suit', tx(new THREE.CapsuleGeometry(0.21 * bulk, 0.1, 6, 14), V3(0, 0.05, 0), E(), V3(1.2, 1, 0.9)));
  add('chest', 'suit', tx(lathe([[0.001, -0.12], [0.26, -0.1], [0.31, 0.05], [0.3, 0.2], [0.22, 0.3], [0.16, 0.34], [0.001, 0.35]], 22), V3(0, 0, 0), E(), V3(1.12 * bulk, 1, 0.84 * bulk)));
  add('neck', 'dark', tx(new THREE.TorusGeometry(0.17, 0.05, 8, 22), V3(0, 0.0, 0), E(Math.PI / 2)));
  add('neck', 'metal', tx(new THREE.CylinderGeometry(0.19, 0.2, 0.06, 22), V3(0, -0.03, 0)));

  // --- arms ---
  for (const s of ['L', 'R'] as const) {
    const arm = ('arm' + s) as BoneName;
    const fore = ('fore' + s) as BoneName;
    const hand = ('hand' + s) as BoneName;
    add(arm, 'suit', tx(new THREE.CapsuleGeometry(0.1 * bulk, 0.2, 5, 12), V3(0, -0.17, 0)));
    add(arm, 'dark', tx(new THREE.TorusGeometry(0.105 * bulk, 0.02, 6, 16), V3(0, -0.3, 0), E(Math.PI / 2)));
    add(fore, 'suit', tx(new THREE.CapsuleGeometry(0.092 * bulk, 0.17, 5, 12), V3(0, -0.14, 0)));
    add(fore, 'dark', tx(new THREE.CylinderGeometry(0.105 * bulk, 0.1 * bulk, 0.08, 14), V3(0, -0.26, 0)));
    add(hand, 'dark', tx(new THREE.SphereGeometry(0.085, 12, 10), V3(0, -0.03, -0.01), E(), V3(1, 1.1, 1.25)));
    add(hand, 'dark', tx(new THREE.BoxGeometry(0.1, 0.07, 0.08), V3(0, -0.08, -0.03)));
  }
  // --- legs ---
  for (const s of ['L', 'R'] as const) {
    const leg = ('leg' + s) as BoneName;
    const shin = ('shin' + s) as BoneName;
    const foot = ('foot' + s) as BoneName;
    add(leg, 'suit', tx(new THREE.CapsuleGeometry(0.125 * bulk, 0.24, 5, 12), V3(0, -0.21, 0)));
    add(shin, 'suit', tx(new THREE.CapsuleGeometry(0.11 * bulk, 0.2, 5, 12), V3(0, -0.19, 0)));
    add(shin, 'dark', tx(new THREE.CylinderGeometry(0.125 * bulk, 0.12 * bulk, 0.1, 14), V3(0, -0.34, 0)));
    // boot
    add(foot, 'dark', tx(new THREE.BoxGeometry(0.2 * bulk, 0.14, 0.34), V3(0, -0.02, -0.05)));
    add(foot, 'metal', tx(new THREE.BoxGeometry(0.21 * bulk, 0.04, 0.35), V3(0, -0.075, -0.05)));
    add(foot, 'dark', tx(new THREE.CylinderGeometry(0.1 * bulk, 0.1 * bulk, 0.16, 12, 1, false, 0, Math.PI), V3(0, -0.02, -0.21), E(Math.PI / 2, 0, Math.PI / 2), V3(1, 1, 0.7)));
  }

  // --- helmet base (shared) ---
  const helmet = (r: number) => add('head', 'suit', tx(new THREE.SphereGeometry(r, 26, 18), V3(0, 0.2, 0)));
  const visorShell = (r: number, w = 0.78, h = 0.46, tilt = 0) =>
    add('head', 'visor', tx(new THREE.SphereGeometry(r, 26, 16, Math.PI * (1.5 - w / 2) - Math.PI, Math.PI * w, Math.PI * (0.5 - h / 2), Math.PI * h), V3(0, 0.2, -0.02), E(tilt, Math.PI, 0)));

  switch (hero) {
    case 'condor': {
      helmet(0.29);
      visorShell(0.272, 0.72, 0.42, -0.05);
      add('head', 'armor', tx(new THREE.TorusGeometry(0.285, 0.04, 6, 26, Math.PI), V3(0, 0.2, 0), E(0, Math.PI / 2, 0)));
      add('head', 'accent', tx(new THREE.BoxGeometry(0.06, 0.1, 0.22), V3(0, 0.49, 0.02)));
      add('head', 'metal', tx(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 5), V3(0.2, 0.46, 0.1)));
      add('head', 'glow', tx(new THREE.BoxGeometry(0.07, 0.04, 0.04), V3(-0.2, 0.34, -0.17)));
      // chest armor + shoulder pads
      add('chest', 'armor', tx(new THREE.BoxGeometry(0.46, 0.26, 0.12), V3(0, 0.1, -0.22), E(0.12)));
      add('chest', 'accent', tx(new THREE.BoxGeometry(0.18, 0.06, 0.04), V3(0.06, 0.05, -0.29)));
      add('chest', 'glow', tx(new THREE.BoxGeometry(0.08, 0.03, 0.02), V3(-0.12, 0.14, -0.29)));
      for (const s of [-1, 1]) add(s < 0 ? 'armL' : 'armR', 'armor', tx(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), V3(0, 0.02, 0), E(0, 0, -s * 0.25), V3(1.1, 0.9, 1.1)));
      // jet pack with wing fins
      add('pack', 'armor', tx(new THREE.BoxGeometry(0.5, 0.56, 0.24), V3(0, 0, 0)));
      for (const s of [-1, 1]) {
        add('pack', 'dark', tx(new THREE.CylinderGeometry(0.075, 0.06, 0.56, 12), V3(s * 0.2, -0.05, 0.12)));
        add('pack', 'metal', tx(new THREE.CylinderGeometry(0.06, 0.085, 0.12, 12), V3(s * 0.15, -0.36, 0.06)));
        add('pack', 'accent', tx(new THREE.BoxGeometry(0.04, 0.3, 0.28), V3(s * 0.3, 0.08, 0.05), E(0, 0, s * 0.35)));
      }
      add('pack', 'glow', tx(new THREE.BoxGeometry(0.32, 0.04, 0.02), V3(0, 0.14, 0.125)));
      // knee pads
      for (const s of ['L', 'R'] as const) add(('shin' + s) as BoneName, 'armor', tx(new THREE.SphereGeometry(0.1, 10, 8), V3(0, 0, -0.07), E(), V3(1, 1.1, 0.7)));
      break;
    }
    case 'needle': {
      helmet(0.275);
      // horizontal slit visor + scope monocle
      add('head', 'armor', tx(new THREE.SphereGeometry(0.285, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.42), V3(0, 0.2, 0)));
      add('head', 'visor', tx(new THREE.BoxGeometry(0.4, 0.07, 0.1), V3(0, 0.22, -0.23)));
      add('head', 'metal', tx(new THREE.CylinderGeometry(0.055, 0.05, 0.14, 14), V3(0.13, 0.23, -0.26), E(Math.PI / 2)));
      add('head', 'glow', tx(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 14), V3(0.13, 0.23, -0.335), E(Math.PI / 2)));
      add('head', 'metal', tx(new THREE.CylinderGeometry(0.006, 0.006, 0.62, 5), V3(-0.18, 0.62, 0.12), E(-0.2)));
      add('head', 'glow', tx(new THREE.SphereGeometry(0.02, 6, 6), V3(-0.18, 0.93, 0.18)));
      // long coat-like plates and slim armor
      add('chest', 'armor', tx(new THREE.BoxGeometry(0.4, 0.34, 0.08), V3(0, 0.08, -0.23), E(0.08)));
      add('chest', 'accent', tx(new THREE.BoxGeometry(0.06, 0.34, 0.04), V3(0.09, 0.08, -0.27)));
      add('hips', 'armor', tx(new THREE.BoxGeometry(0.46, 0.34, 0.06), V3(0, -0.14, 0.2), E(-0.12)));
      for (const s of [-1, 1]) add(s < 0 ? 'armL' : 'armR', 'accent', tx(new THREE.BoxGeometry(0.16, 0.06, 0.22), V3(s * 0.02, 0.1, 0), E(0, 0, -s * 0.3)));
      add('pack', 'armor', tx(new THREE.BoxGeometry(0.38, 0.5, 0.18), V3(0, 0, -0.03)));
      add('pack', 'dark', tx(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 8), V3(0.14, 0.2, 0.08), E(0, 0, 0.2)));
      add('pack', 'glow', tx(new THREE.BoxGeometry(0.03, 0.3, 0.02), V3(-0.1, 0.02, 0.07)));
      for (const s of [-1, 1]) add('pack', 'metal', tx(new THREE.CylinderGeometry(0.05, 0.07, 0.1, 10), V3(s * 0.12, -0.3, 0.02)));
      break;
    }
    case 'reactor': {
      // armored helmet with small visor slot
      add('head', 'armor', tx(lathe([[0.001, -0.02], [0.3, 0.0], [0.33, 0.14], [0.31, 0.3], [0.22, 0.42], [0.001, 0.45]], 24), V3(0, 0.02, 0)));
      add('head', 'visor', tx(new THREE.BoxGeometry(0.34, 0.1, 0.12), V3(0, 0.22, -0.27)));
      add('head', 'dark', tx(new THREE.BoxGeometry(0.4, 0.05, 0.16), V3(0, 0.3, -0.25)));
      add('head', 'accent', tx(new THREE.BoxGeometry(0.1, 0.12, 0.34), V3(0, 0.44, 0.02)));
      // massive chest plate with reactor core
      add('chest', 'armor', tx(lathe([[0.001, -0.14], [0.34, -0.12], [0.4, 0.06], [0.38, 0.26], [0.28, 0.36], [0.001, 0.37]], 22), V3(0, 0, -0.02), E(), V3(1.2, 1, 0.9)));
      add('chest', 'dark', tx(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 18), V3(0, 0.1, -0.33), E(Math.PI / 2)));
      add('chest', 'glow', tx(new THREE.CylinderGeometry(0.085, 0.085, 0.09, 18), V3(0, 0.1, -0.34), E(Math.PI / 2)));
      for (const s of [-1, 1]) {
        const arm = s < 0 ? 'armL' : 'armR';
        add(arm, 'armor', tx(new THREE.SphereGeometry(0.22, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), V3(s * 0.02, 0.04, 0), E(0, 0, -s * 0.3), V3(1.15, 0.95, 1.1)));
        add(arm, 'accent', tx(new THREE.BoxGeometry(0.3, 0.05, 0.3), V3(s * 0.04, 0.16, 0), E(0, 0, -s * 0.3)));
        add(s < 0 ? 'foreL' : 'foreR', 'armor', tx(new THREE.CylinderGeometry(0.14, 0.12, 0.24, 12), V3(0, -0.15, 0)));
      }
      add('pack', 'armor', tx(new THREE.BoxGeometry(0.62, 0.66, 0.3), V3(0, 0.02, 0.02)));
      for (const x of [-0.18, 0, 0.18]) add('pack', 'glow', tx(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), V3(x, 0.05, 0.19)));
      for (const s of [-1, 1]) add('pack', 'metal', tx(new THREE.CylinderGeometry(0.07, 0.1, 0.14, 12), V3(s * 0.18, -0.4, 0.05)));
      for (const s of ['L', 'R'] as const) {
        add(('shin' + s) as BoneName, 'armor', tx(new THREE.BoxGeometry(0.24, 0.3, 0.14), V3(0, -0.12, -0.08)));
        add(('foot' + s) as BoneName, 'armor', tx(new THREE.BoxGeometry(0.25, 0.1, 0.38), V3(0, 0.05, -0.05)));
      }
      break;
    }
    case 'helios': {
      helmet(0.29);
      visorShell(0.273, 0.8, 0.5);
      add('head', 'accent', tx(new THREE.TorusGeometry(0.29, 0.03, 6, 28, Math.PI), V3(0, 0.2, 0), E(0, Math.PI / 2, 0)));
      // floating halo ring
      add('head', 'glow', tx(new THREE.TorusGeometry(0.2, 0.018, 6, 32), V3(0, 0.62, 0.02), E(Math.PI / 2 - 0.2)));
      // medical cross on chest and shoulders
      add('chest', 'armor', tx(new THREE.SphereGeometry(0.3, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), V3(0, 0.02, -0.08), E(-Math.PI / 2 + 0.1), V3(1.2, 0.5, 1)));
      add('chest', 'glow', tx(new THREE.BoxGeometry(0.12, 0.035, 0.02), V3(0, 0.13, -0.3)));
      add('chest', 'glow', tx(new THREE.BoxGeometry(0.035, 0.12, 0.02), V3(0, 0.13, -0.3)));
      for (const s of [-1, 1]) add(s < 0 ? 'armL' : 'armR', 'armor', tx(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), V3(0, 0.02, 0), E(0, 0, -s * 0.2)));
      // O2 tank backpack with glowing canisters
      add('pack', 'armor', tx(new THREE.CapsuleGeometry(0.2, 0.3, 6, 16), V3(0, 0, 0), E(), V3(1.25, 1, 0.7)));
      for (const s of [-1, 1]) {
        add('pack', 'metal', tx(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 14), V3(s * 0.22, -0.02, 0.1)));
        add('pack', 'glow', tx(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10), V3(s * 0.22, -0.02, 0.19)));
      }
      break;
    }
    case 'lunatic': {
      helmet(0.29);
      visorShell(0.273, 0.74, 0.44);
      // welding goggles over the visor
      for (const s of [-1, 1]) {
        add('head', 'dark', tx(new THREE.CylinderGeometry(0.085, 0.085, 0.07, 16), V3(s * 0.1, 0.3, -0.25), E(Math.PI / 2 - 0.25)));
        add('head', 'glow', tx(new THREE.CylinderGeometry(0.065, 0.065, 0.01, 16), V3(s * 0.1, 0.305, -0.29), E(Math.PI / 2 - 0.25)));
      }
      add('head', 'dark', tx(new THREE.TorusGeometry(0.28, 0.022, 6, 28), V3(0, 0.3, 0), E(Math.PI / 2 - 0.15)));
      add('head', 'accent', tx(new THREE.ConeGeometry(0.05, 0.14, 4), V3(0.12, 0.49, 0.05), E(0, 0, -0.4)));
      add('head', 'accent', tx(new THREE.ConeGeometry(0.05, 0.12, 4), V3(-0.05, 0.5, 0.06), E(0, 0, 0.3)));
      // bandolier with grenades
      add('chest', 'dark', tx(new THREE.TorusGeometry(0.32, 0.03, 6, 24), V3(0, 0.08, -0.02), E(Math.PI / 2, 0.75, 0), V3(1.05, 0.72, 1)));
      for (let i = 0; i < 5; i++) {
        const a = -0.9 + i * 0.4;
        add('chest', 'accent', tx(new THREE.SphereGeometry(0.05, 10, 8), V3(Math.sin(a) * 0.3, 0.08 + a * 0.18, -Math.cos(a) * 0.23 - 0.03)));
      }
      add('chest', 'armor', tx(new THREE.BoxGeometry(0.28, 0.14, 0.1), V3(-0.08, 0.2, -0.22), E(0.1, 0, 0.12)));
      for (const s of [-1, 1]) add(s < 0 ? 'armL' : 'armR', 'armor', tx(new THREE.BoxGeometry(0.2, 0.12, 0.24), V3(s * 0.03, 0.08, 0), E(0, 0, -s * 0.35)));
      // mini-nuke canister on the back
      add('pack', 'dark', tx(new THREE.BoxGeometry(0.46, 0.5, 0.2), V3(0, 0, -0.02)));
      add('pack', 'accent', tx(new THREE.CylinderGeometry(0.14, 0.14, 0.52, 16), V3(0, 0.05, 0.14)));
      add('pack', 'glow', tx(new THREE.TorusGeometry(0.145, 0.015, 6, 20), V3(0, 0.16, 0.14), E(Math.PI / 2)));
      add('pack', 'metal', tx(new THREE.ConeGeometry(0.14, 0.18, 16), V3(0, 0.4, 0.14)));
      break;
    }
    case 'phantom': {
      // smooth featureless helmet with V visor
      add('head', 'armor', tx(lathe([[0.001, -0.04], [0.24, -0.02], [0.28, 0.14], [0.26, 0.3], [0.16, 0.42], [0.001, 0.44]], 26), V3(0, 0.02, 0)));
      for (const s of [-1, 1]) add('head', 'glow', tx(new THREE.BoxGeometry(0.18, 0.035, 0.03), V3(s * 0.08, 0.24 + 0.03, -0.265), E(0, s * 0.3, s * 0.35)));
      add('head', 'accent', tx(new THREE.BoxGeometry(0.03, 0.2, 0.3), V3(0, 0.42, 0.04), E(-0.3)));
      add('chest', 'armor', tx(new THREE.BoxGeometry(0.36, 0.24, 0.08), V3(0, 0.1, -0.21), E(0.1)));
      add('chest', 'glow', tx(new THREE.BoxGeometry(0.02, 0.26, 0.02), V3(-0.1, 0.08, -0.26)));
      add('chest', 'glow', tx(new THREE.BoxGeometry(0.02, 0.26, 0.02), V3(0.1, 0.08, -0.26)));
      for (const s of ['L', 'R'] as const) {
        add(('fore' + s) as BoneName, 'glow', tx(new THREE.BoxGeometry(0.02, 0.2, 0.02), V3(0, -0.14, -0.095)));
        add(('shin' + s) as BoneName, 'glow', tx(new THREE.BoxGeometry(0.02, 0.24, 0.02), V3(0, -0.18, -0.11)));
        add(('arm' + s) as BoneName, 'armor', tx(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), V3(0, 0.02, 0)));
      }
      add('pack', 'armor', tx(new THREE.BoxGeometry(0.34, 0.42, 0.14), V3(0, 0.02, -0.05)));
      add('pack', 'glow', tx(new THREE.TorusGeometry(0.09, 0.015, 6, 20), V3(0, 0.05, 0.03)));
      for (const s of [-1, 1]) add('pack', 'metal', tx(new THREE.CylinderGeometry(0.045, 0.06, 0.09, 10), V3(s * 0.1, -0.25, 0)));
      break;
    }
  }
}
