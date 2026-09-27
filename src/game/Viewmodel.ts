import * as THREE from 'three';
import { buildWeaponModel, WeaponModel } from '../weapons/WeaponModels';
import type { HeroId, WeaponId } from './Types';
import { HEROES } from './Types';
import { stylize } from '../render/Materials';
import { HeroModel } from '../entities/HeroModel';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _g = new THREE.Vector3();
const _h = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
/** foregrip distance along the barrel for the first-person support hand */
const FOREGRIP_VM: Partial<Record<WeaponId, number>> = { pulse: 0.26, rail: 0.34, plasma: 0.22, glauncher: 0.24, sealer: 0.2, nuke: 0.1, singularity: 0.26, helios: 0.26, riveter: 0.24, burst: 0.26 };

let reticleCache: THREE.CanvasTexture | null = null;
/** holo reticle: centre dot + broken ring (white, tinted by the material colour) */
function reticleTex(): THREE.CanvasTexture {
  if (reticleCache) return reticleCache;
  const n = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const c = cv.getContext('2d')!;
  c.strokeStyle = c.fillStyle = '#fff';
  c.shadowColor = '#fff';
  c.shadowBlur = 6;
  c.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    c.beginPath();
    c.arc(n / 2, n / 2, n * 0.36, (i * Math.PI) / 2 + 0.28, ((i + 1) * Math.PI) / 2 - 0.28);
    c.stroke();
  }
  c.beginPath();
  c.arc(n / 2, n / 2, 5, 0, Math.PI * 2);
  c.fill();
  reticleCache = new THREE.CanvasTexture(cv);
  reticleCache.colorSpace = THREE.SRGBColorSpace;
  return reticleCache;
}

/**
 * First-person hands + weapon, drawn in an overlay scene (own FOV & depth) so it never clips.
 * Materials are private (not in the CSM registry): the overlay scene has a single simple sun light.
 */
export class Viewmodel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
  private root = new THREE.Group();
  private gun = new THREE.Group();
  private weapon: WeaponModel | null = null;
  private weaponId: WeaponId | null = null;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private bobT = 0;
  private kick = 0;
  private kickRot = 0;
  private switchT = 0;
  private sway = new THREE.Vector2();
  private swayVel = new THREE.Vector2();
  private landDip = 0;
  private hero: HeroId | null = null;
  ads = 0;
  private castT = 0;

  constructor() {
    this.scene.add(this.camera);
    this.camera.add(this.root);
    this.root.add(this.gun, this.armL, this.armR);
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.3);
    this.sun.position.set(1, 1, 0.5);
    this.hemi = new THREE.HemisphereLight(0x8090d0, 0x7b6a58, 0.6);
    this.scene.add(this.sun, this.hemi);
  }

  setEnvironment(env: THREE.Texture | null, sunDirView: THREE.Vector3): void {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.5;
    this.sun.position.copy(sunDirView);
  }

  /** private copy of a lit material without CSM defines */
  private own(m: THREE.Material): THREE.Material {
    const src = m as THREE.MeshStandardMaterial;
    if (!src.isMeshStandardMaterial) return m;
    const c = new THREE.MeshStandardMaterial({
      color: src.color,
      map: src.map,
      normalMap: src.normalMap,
      roughnessMap: src.roughnessMap,
      metalnessMap: src.metalnessMap,
      roughness: src.roughness,
      metalness: src.metalness,
      emissive: src.emissive,
      emissiveIntensity: src.emissiveIntensity,
      flatShading: src.flatShading,
    });
    stylize(c, { rim: 0.3 });
    return c;
  }

  setHero(hero: HeroId, teamColor: number | null): void {
    if (this.hero === hero) return;
    this.hero = hero;
    for (const a of [this.armL, this.armR]) a.clear();
    // cut the forearm + gauntlet out of the hero's real third-person model, so first person shows
    // exactly the same armour, suit sleeve and paint as everyone else sees
    const hm = new HeroModel(hero, teamColor);
    try {
      this.armR.add(this.cutArm(hm, 'R'));
      this.armL.add(this.cutArm(hm, 'L'));
    } finally {
      hm.dispose();
    }
    this.armL.userData.side = -1;
    this.armR.userData.side = 1;
    this.weaponId = null;
  }

  /**
   * Triangles whose dominant bone is the forearm or the hand, moved into forearm space and laid
   * along the viewmodel arm axis (hand toward -Z, elbow toward +Z, wrist at the origin).
   */
  private cutArm(hm: HeroModel, side: 'L' | 'R'): THREE.Object3D {
    const bones = hm.bones as unknown as Map<string, THREE.Bone>;
    const fore = bones.get('fore' + side)!;
    const hand = bones.get('hand' + side)!;
    const keep = new Set([hm.skeleton.bones.indexOf(fore), hm.skeleton.bones.indexOf(hand)]);
    const toArm = new THREE.Matrix4()
      .makeTranslation(0, 0, 0.3)
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
      .multiply(fore.matrixWorld.clone().invert());
    const group = new THREE.Group();
    group.scale.setScalar(0.85);
    for (const mesh of hm.meshes) {
      const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const si = src.getAttribute('skinIndex');
      const sw = src.getAttribute('skinWeight');
      if (!si || !sw) continue;
      const dominant = (v: number): number => {
        let bi = si.getX(v);
        let bw = sw.getX(v);
        for (let c = 1; c < 4; c++) {
          const w = sw.getComponent(v, c);
          if (w > bw) {
            bw = w;
            bi = si.getComponent(v, c);
          }
        }
        return bi;
      };
      const tris: number[] = [];
      const n = src.getAttribute('position').count;
      for (let v = 0; v + 2 < n; v += 3) if (keep.has(dominant(v)) && keep.has(dominant(v + 1)) && keep.has(dominant(v + 2))) tris.push(v, v + 1, v + 2);
      if (!tris.length) continue;
      const out = new THREE.BufferGeometry();
      for (const name of Object.keys(src.attributes)) {
        if (name === 'skinIndex' || name === 'skinWeight') continue;
        const a = src.getAttribute(name) as THREE.BufferAttribute;
        const arr = new Float32Array(tris.length * a.itemSize);
        tris.forEach((v, i) => {
          for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(v, c);
        });
        out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
      }
      out.applyMatrix4(toArm);
      const m = new THREE.Mesh(out, this.ownLit(mesh.material as THREE.Material));
      m.castShadow = false;
      group.add(m);
    }
    return group;
  }

  /** private copy of a hero material without the shadow-cascade setup (overlay scene has one light) */
  private ownLit(m: THREE.Material): THREE.Material {
    const c = m.clone();
    const d = (c as THREE.Material & { defines?: Record<string, unknown> }).defines;
    if (d) {
      delete d.USE_CSM;
      delete d.CSM_CASCADES;
      delete d.CSM_FADE;
    }
    c.userData = {};
    c.onBeforeCompile = () => {};
    if ((c as THREE.MeshStandardMaterial).isMeshStandardMaterial) stylize(c as THREE.MeshStandardMaterial, { rim: 0.3 });
    c.needsUpdate = true;
    return c;
  }

  setWeapon(id: WeaponId, tint: number): void {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.weapon) this.gun.remove(this.weapon.group);
    this.weapon = buildWeaponModel(id, tint);
    this.weapon.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = this.own(m.material as THREE.Material);
        m.castShadow = false;
      }
    });
    this.gun.add(this.weapon.group);
    this.reticle = null;
    const sg = this.weapon.sight;
    if (sg) {
      // holographic sight: tinted glass pane + a glowing ring-and-dot reticle in the front window
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(sg.hw * 2, sg.hw * 2),
        new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      );
      glass.position.set(0, sg.y, -sg.far - 0.004);
      const ret = new THREE.Mesh(
        new THREE.PlaneGeometry(0.03, 0.03),
        new THREE.MeshBasicMaterial({ map: reticleTex(), color: 0xff4a3a, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      );
      ret.position.set(0, sg.y, -sg.far);
      ret.renderOrder = 10;
      this.weapon.group.add(glass, ret);
      this.reticle = ret;
    }
    this.switchT = 1;
  }
  private reticle: THREE.Mesh | null = null;

  get muzzle(): THREE.Object3D | null {
    return this.weapon?.muzzle ?? null;
  }

  fired(recoil: number): void {
    this.kick = Math.min(1.5, this.kick + 0.35 + recoil * 5);
    this.kickRot = Math.min(0.25, this.kickRot + recoil * 1.6 + 0.02);
  }
  land(v: number): void {
    this.landDip = Math.min(0.12, this.landDip + v * 0.02);
  }
  cast(): void {
    this.castT = 1;
  }
  /** melee swing (katana slash or quick-melee bash); side = ±1 alternates the arc */
  swing(side: number): void {
    this.swingT = 1;
    this.swingSide = side;
  }
  private swingT = 0;
  private swingSide = 1;
  private grappleK = 0;
  private sprintK = 0;

  update(dt: number, s: { speed: number; grounded: boolean; lookDX: number; lookDY: number; reload: number; charge: number; aspect: number; fov: number; ads: boolean; sprint: boolean; crouch: number; switching: boolean; time: number; visible: boolean; grapple?: boolean }): void {
    this.scene.visible = s.visible && !!this.weapon;
    this.camera.aspect = s.aspect;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.ads += ((s.ads ? 1 : 0) - this.ads) * Math.min(1, dt * 14);
    const moving = s.grounded && s.speed > 0.5;
    this.bobT += dt * (moving ? Math.min(2, s.speed / 3) * 7 : 1.2);
    const bobAmp = (moving ? 0.012 : 0.003) * (1 - this.ads * 0.85);
    // sway follows mouse movement (spring)
    this.swayVel.x += (-s.lookDX * 0.0006 - this.sway.x) * 60 * dt;
    this.swayVel.y += (s.lookDY * 0.0006 - this.sway.y) * 60 * dt;
    this.swayVel.multiplyScalar(Math.max(0, 1 - dt * 12));
    this.sway.addScaledVector(this.swayVel, dt * 10);
    this.sway.clampScalar(-0.05, 0.05);
    this.kick = Math.max(0, this.kick - dt * 9);
    this.kickRot = Math.max(0, this.kickRot - dt * 5);
    this.landDip = Math.max(0, this.landDip - dt * 0.6);
    this.switchT = Math.max(0, this.switchT - dt * 2.8);
    this.castT = Math.max(0, this.castT - dt * 3);
    this.swingT = Math.max(0, this.swingT - dt * 3.2);
    this.grappleK += ((s.grapple ? 1 : 0) - this.grappleK) * Math.min(1, dt * 12);
    const blade = this.weaponId === 'blade';

    const big = this.weaponId === 'nuke' || this.weaponId === 'rail';
    const hip = new THREE.Vector3(big ? 0.22 : 0.2, big ? -0.24 : -0.21, -0.42);
    const sg = this.weapon?.sight;
    // with an optic the eye sits exactly on the sight line, ~19 cm behind the rear window
    const aim = sg ? new THREE.Vector3(0, -sg.y, sg.near - 0.19) : new THREE.Vector3(0, big ? -0.13 : -0.105, -0.3);
    const p = hip.clone().lerp(aim, this.ads);
    p.x += Math.sin(this.bobT) * bobAmp + this.sway.x;
    p.y += Math.abs(Math.cos(this.bobT)) * bobAmp * 1.2 - this.landDip + this.sway.y - s.crouch * 0.01;
    p.z += this.kick * 0.05;
    const reloadDip = s.reload >= 0 ? Math.sin(Math.min(1, s.reload) * Math.PI) : 0;
    p.y -= reloadDip * 0.12 + this.switchT * 0.35 + this.castT * 0.08;
    this.gun.position.copy(p);
    // sprint: gun canted down and across the chest
    this.sprintK += ((s.sprint ? 1 : 0) - this.sprintK) * Math.min(1, dt * 8);
    this.gun.position.x -= this.sprintK * 0.05;
    this.gun.position.y -= this.sprintK * 0.04;
    this.gun.rotation.set(this.kickRot + reloadDip * 0.5 + this.switchT * 0.6 - this.sprintK * 0.35, this.sway.x * 2 + this.sprintK * 0.55, reloadDip * 0.4 + this.sway.x * 1.5 + this.sprintK * 0.25);
    // melee: katana slash arc / rifle-butt bash
    const sw = this.swingT;
    if (blade) {
      // idle: blade held high across the view; slash sweeps diagonally with anticipation + follow-through
      this.gun.position.x -= 0.02;
      this.gun.position.y += 0.03;
      this.gun.rotation.x += 0.55;
      this.gun.rotation.z += -0.35;
      if (sw > 0) {
        const t = 1 - sw; // 0 → 1
        const e = t < 0.18 ? -t / 0.18 * 0.25 : Math.min(1, (t - 0.18) / 0.35);
        const k = Math.sin(Math.min(1, e) * Math.PI * 0.5);
        const sd = this.swingSide;
        this.gun.position.x += sd * (0.12 - k * 0.3);
        this.gun.position.y += 0.08 - k * 0.2;
        this.gun.position.z -= Math.sin(k * Math.PI) * 0.12;
        this.gun.rotation.z += sd * (0.9 - k * 2.0);
        this.gun.rotation.x += -0.4 + k * 0.9;
        this.gun.rotation.y += sd * (0.4 - k * 0.8);
      }
    } else if (sw > 0) {
      const k = Math.sin((1 - sw) * Math.PI);
      this.gun.position.x -= k * 0.12;
      this.gun.position.z -= k * 0.14;
      this.gun.rotation.z += k * 0.9;
      this.gun.rotation.y -= k * 0.5;
    }
    // grapple launcher arm lifts the gun out of the way
    if (this.grappleK > 0.01) {
      this.gun.position.y -= this.grappleK * 0.07;
      this.gun.position.x += this.grappleK * 0.04;
      this.gun.rotation.z -= this.grappleK * 0.25;
    }
    if (this.reticle) {
      const m = this.reticle.material as THREE.MeshBasicMaterial;
      m.opacity = Math.min(1, Math.max(0, (this.ads - 0.55) / 0.35)) * (1 - this.switchT);
      this.reticle.visible = m.opacity > 0.01;
    }
    if (this.weapon?.spin) this.weapon.spin.rotation.z += dt * (s.charge > 0 ? 20 * s.charge : 1);
    for (const g of this.weapon?.glows ?? []) g.scale.setScalar(1 + s.charge * 0.25);
    // hands on the gun: grip (right) and foregrip (left); forearms angle down toward the screen
    // corners so the sleeves never sweep in front of the eye
    const gq = this.gun.quaternion;
    const gp = this.gun.position;
    const fwd = _a.set(0, 0, -1).applyQuaternion(gq);
    const gup = _b.set(0, 1, 0).applyQuaternion(gq);
    const twin = this.weaponId === 'twinarc';
    const fg = blade ? -0.07 : twin ? 0 : FOREGRIP_VM[this.weaponId ?? 'pulse'] ?? 0.26;
    const gripR = _c.copy(gp).addScaledVector(gup, -0.06).addScaledVector(fwd, 0.02);
    this.aimArm(this.armR, gripR, _d.set(0.32, -0.62, 0.72), gq);
    let gripL: THREE.Vector3;
    if (twin) gripL = _e.copy(gripR).add(_f.set(-0.36, 0, 0));
    else gripL = _e.copy(gp).addScaledVector(fwd, fg).addScaledVector(gup, blade ? -0.08 : -0.045).add(_f.set(-0.01, 0, 0));
    if (this.castT > 0) gripL.add(_f.set(-0.08 * this.castT, 0.1 * this.castT, 0.05 * this.castT));
    if (reloadDip > 0) gripL.addScaledVector(gup, -0.12 * reloadDip).addScaledVector(fwd, -0.12 * reloadDip);
    if (!blade && sw > 0) gripL.z -= Math.sin((1 - sw) * Math.PI) * 0.18;
    if (this.grappleK > 0.01) gripL.lerp(_f.set(-0.17, -0.1, -0.36), this.grappleK);
    this.aimArm(this.armL, gripL, _d.set(twin ? -0.32 : -0.42, -0.6, 0.68), gq);
  }

  /** place a forearm: hand at `at`, sleeve running along `back` (camera space), glove rolled like the gun */
  private aimArm(arm: THREE.Group, at: THREE.Vector3, back: THREE.Vector3, gunQ: THREE.Quaternion): void {
    arm.position.copy(at);
    back.normalize();
    // +Z of the arm group = toward the elbow
    const q = _q.setFromUnitVectors(_g.set(0, 0, 1), back);
    // keep the glove's roll close to the gun's
    const roll = _q2.setFromUnitVectors(_g.set(0, 1, 0).applyQuaternion(q), _h.set(0, 1, 0).applyQuaternion(gunQ));
    arm.quaternion.copy(q).premultiply(roll.slerp(_q3.identity(), 0.5));
  }

  dispose(): void {
    this.scene.clear();
  }
}
