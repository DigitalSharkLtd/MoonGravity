import * as THREE from 'three';
import type { Game } from '../game/Game';
import { HeroModel } from '../entities/HeroModel';
import { HERO_ORDER } from '../game/Types';
import { buildWeaponModel } from '../weapons/WeaponModels';
import { WEAPONS, type WeaponId } from '../weapons/WeaponDefs';
import { buildSummonMesh, type DeviceKind } from '../game/SummonMeshes';

const DEVICES: DeviceKind[] = ['turret', 'huntdrone', 'spotdrone', 'kamikaze', 'barricade'];

/**
 * Compile every shader a match can need while the loading screen is still up: all heroes (and the
 * servitor variant), every weapon, every device, the first-person scene and one of each effect.
 * Otherwise each first use compiles on the spot (hundreds of ms per program on ANGLE / D3D) and the
 * first seconds of a match stutter and freeze.
 */
export async function warmMatchShaders(g: Game, renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, render: () => void): Promise<void> {
  const t0 = performance.now();
  const tmp = new THREE.Scene();
  for (const [i, h] of HERO_ORDER.entries()) tmp.add(new HeroModel(h, i % 2 ? 0xff5a4a : 0x4aa8ff).root);
  tmp.add(new HeroModel('forge', 0x4aa8ff, 'servitor').root);
  for (const id of Object.keys(WEAPONS) as WeaponId[]) tmp.add(buildWeaponModel(id, 0x4aa8ff).group);
  for (const k of DEVICES) tmp.add(buildSummonMesh(k, 0xff5a4a).mesh);
  try {
    await renderer.compileAsync(tmp, camera, scene);
    await renderer.compileAsync(scene, camera);
    await renderer.compileAsync(g.viewmodel.scene, g.viewmodel.camera);
  } catch (e) {
    console.warn('[warmup] compile failed', e);
  }
  // effects: one of each a few metres ahead, drawn once through the whole pipeline (this also builds
  // the shadow-depth variants and the post-processing passes), then cleared
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  const p = camera.position.clone().addScaledVector(fwd, 7);
  const up = new THREE.Vector3(0, 1, 0);
  const fx = g.effects;
  try {
    fx.muzzle(p, fwd, 0xffc060);
    fx.tracer(camera.position.clone().addScaledVector(fwd, 2), p, 0x9fe0ff);
    fx.beam(camera.position.clone().addScaledVector(fwd, 2), p, 0xff5040, 0.1, 0.2);
    fx.impact(p, up, 'metal');
    fx.impact(p, up, 'dirt');
    fx.impact(p, up, 'flesh');
    fx.impact(p, up, 'energy');
    fx.dust(p, 6);
    fx.shockwave(p, up, 3, 0xffa040, 0.3);
    fx.fireball(p, 1.5, 0xffa040, 0.3);
    fx.explosion(p, 2);
    fx.emp(p, 3);
    fx.lightning(camera.position.clone().addScaledVector(fwd, 2), p, 0x9fd8ff, 0.2);
    fx.jet(p, up);
    fx.update(1 / 60);
    render();
  } catch (e) {
    console.warn('[warmup] fx failed', e);
  }
  fx.clear();
  console.info(`[warmup] ${renderer.info.programs?.length ?? 0} programs ready in ${Math.round(performance.now() - t0)} ms`);
}
