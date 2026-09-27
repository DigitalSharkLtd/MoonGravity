/**
 * Dev-only prop review harness: every weapon model + deployable in the real render pipeline & lighting.
 * URL: weapon-preview.html?view=grid|one|fp|dev|far&w=pulse&map=duel&x=-34&z=-30&q=high&bg=wall&sa=0.6
 *   grid : all weapons side-on (right side), labelled with triangle counts
 *   one  : single weapon (w=…) close-up — orbit with __p.orbit(yawDeg, pitchDeg, dist)
 *   fp   : first-person viewmodel (real Viewmodel class) — __p.fp('rail', ads?)
 *   dev  : deployables (turret, drones, barricade) in both team colours
 *   far  : the grid seen from ~20 m
 * window.__p exposes camera / controls for scripted shots.
 */
import * as THREE from 'three';
import { Pipeline } from './render/Pipeline';
import { World } from './world/World';
import { MapId } from './world/MapDefs';
import { buildWeaponModel, WeaponModel } from './weapons/WeaponModels';
import { Viewmodel } from './game/Viewmodel';
import { HEROES, HeroId, WeaponId } from './game/Types';
import { buildSummonMesh, DeviceKind } from './game/SummonMeshes';
import { triCount } from './render/HardSurface';
import { buildPickupMesh, buildPodMesh } from './game/PropMeshes';

const params = new URLSearchParams(location.search);
const IDS: WeaponId[] = ['pulse', 'rail', 'plasma', 'glauncher', 'sealer', 'twinarc', 'blade', 'riveter', 'burst', 'nuke', 'singularity', 'helios'];
const OWNER: Record<WeaponId, HeroId> = { pulse: 'condor', rail: 'needle', plasma: 'reactor', glauncher: 'lunatic', sealer: 'helios', twinarc: 'phantom', blade: 'blade', riveter: 'forge', burst: 'hive', nuke: 'condor', singularity: 'phantom', helios: 'helios' };
const heroCol = (id: WeaponId) => new THREE.Color(HEROES[OWNER[id]].color).getHex();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const labels = document.getElementById('labels')!;
const dbg = document.getElementById('dbg')!;
const q = (params.get('q') as 'low' | 'medium' | 'high' | 'ultra') || 'high';
const camera = new THREE.PerspectiveCamera(Number(params.get('fov') ?? 40), innerWidth / innerHeight, 0.05, 6000);
const vm = new Viewmodel();
const pipe = new Pipeline(canvas, new THREE.Scene(), camera, vm.scene, vm.camera, { quality: q, renderScale: 1, ao: !params.has('noao'), bloom: !params.has('nobloom'), outlines: params.has('ink'), filmGrain: false });
const world = new World((params.get('map') as MapId) || 'duel', { quality: q, shadows: 'high', renderer: pipe.renderer, camera });
pipe.setScene(world.scene, camera);
pipe.overlayPass.scene = vm.scene;
pipe.overlayPass.camera = vm.camera;
const sunDir = world.sunDir.clone();
vm.setEnvironment(world.lighting.envMap, sunDir);

const cx = Number(params.get('x') ?? -34);
const cz = Number(params.get('z') ?? -30);
const hf = world.terrainData.hf;
const y0 = hf.heightAt(cx, cz);
// display frame: local +Z faces the camera; camera sits on the sun side, rotated by `sa` for 3/4 light
const sa = Number(params.get('sa') ?? 0.6);
const sunH = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
const camAng = Math.atan2(sunH.x, sunH.y) + sa;
const display = new THREE.Group();
display.position.set(cx, y0, cz);
display.rotation.y = camAng;
world.scene.add(display);
if (params.get('bg') === 'wall') {
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({ color: 0x6d717a, roughness: 0.9 }));
  wall.position.set(0, 2.2, -1.2);
  display.add(wall);
}

type Item = { obj: THREE.Object3D; label: string; model?: WeaponModel; spinObj?: THREE.Object3D; head?: THREE.Object3D };
let items: Item[] = [];
const tris: Record<string, number> = {};

function clearItems(): void {
  for (const it of items) it.obj.parent?.remove(it.obj);
  items = [];
  labels.innerHTML = '';
}

function addLabel(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'lbl';
  d.textContent = text;
  labels.appendChild(d);
  return d;
}

function weapon(id: WeaponId): WeaponModel {
  const m = buildWeaponModel(id, heroCol(id));
  tris[id] = triCount(m.group);
  return m;
}

function layoutGrid(cols = 4, dx = 1.55, dy = 0.62, ids = IDS): void {
  clearItems();
  ids.forEach((id, i) => {
    const m = weapon(id);
    const holder = new THREE.Group();
    const c = i % cols;
    const r = Math.floor(i / cols);
    holder.position.set((c - (cols - 1) / 2) * dx, 1.75 - r * dy, 0);
    m.group.rotation.y = -Math.PI / 2; // barrel → +X, right side faces the camera
    m.group.position.x = -0.12;
    holder.add(m.group);
    display.add(holder);
    items.push({ obj: holder, label: `${id}  ${tris[id]}▲`, model: m, spinObj: m.spin });
  });
}

let orbitState = { yaw: 0, pitch: 8, dist: 6.2, ty: 1.12 };
function orbit(yawDeg: number, pitchDeg: number, dist: number, ty?: number, tx = 0): void {
  orbitState = { yaw: yawDeg, pitch: pitchDeg, dist, ty: ty ?? orbitState.ty };
  const t = new THREE.Vector3(tx, orbitState.ty, 0);
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
  display.updateMatrixWorld(true);
  const p = display.localToWorld(t.clone().add(off));
  const tw = display.localToWorld(t.clone());
  camera.position.copy(p);
  camera.lookAt(tw);
}

function layoutOne(id: WeaponId): void {
  clearItems();
  const m = weapon(id);
  const holder = new THREE.Group();
  holder.position.set(0, 1.2, 0);
  m.group.rotation.y = -Math.PI / 2;
  const box = new THREE.Box3().setFromObject(m.group);
  m.group.position.x = -(box.min.x + box.max.x) / 2;
  holder.add(m.group);
  display.add(holder);
  items.push({ obj: holder, label: `${id}  ${tris[id]}▲`, model: m, spinObj: m.spin });
}

const DEVICES: DeviceKind[] = ['turret', 'huntdrone', 'spotdrone', 'kamikaze', 'barricade'];
function layoutDevices(team: 0 | 1 | 2 = 2): void {
  clearItems();
  const teams = team === 2 ? [0x4dd8ff, 0xffa033] : [team === 0 ? 0x4dd8ff : 0xffa033];
  teams.forEach((tc, ti) => {
    DEVICES.forEach((k, i) => {
      const b = buildSummonMesh(k, tc);
      const x = k === 'barricade' ? 3.4 : -3.2 + i * 1.5;
      const z = -ti * 3.2 - (k === 'barricade' ? 0.6 : 0);
      const lx = display.localToWorld(new THREE.Vector3(x, 0, z));
      const gy = hf.heightAt(lx.x, lx.z) - y0;
      b.mesh.position.set(x, gy + (k === 'turret' || k === 'barricade' ? 0 : 1.3), z);
      b.mesh.rotation.y = k === 'barricade' ? 0 : Math.PI - 0.5;
      display.add(b.mesh);
      tris[k] = triCount(b.mesh);
      items.push({ obj: b.mesh, label: ti === 0 ? `${k}  ${tris[k]}▲` : '', head: b.head });
    });
  });
}

/** one device, centred (orbit to inspect) */
function layoutDevice(k: DeviceKind, team: 0 | 1 = 0): void {
  clearItems();
  const b = buildSummonMesh(k, team === 0 ? 0x4dd8ff : 0xffa033);
  const lx = display.localToWorld(new THREE.Vector3(0, 0, 0));
  const gy = hf.heightAt(lx.x, lx.z) - y0;
  b.mesh.position.set(0, gy + (k === 'turret' || k === 'barricade' ? 0 : 1.1), 0);
  b.mesh.rotation.y = k === 'barricade' ? 0 : Math.PI - 0.5;
  display.add(b.mesh);
  tris[k] = triCount(b.mesh);
  items.push({ obj: b.mesh, label: `${k}  ${tris[k]}▲`, head: b.head });
  const big = k === 'barricade' ? 5.2 : k === 'turret' ? 2.6 : 1.7;
  orbit(-25, 14, big, k === 'barricade' ? 0.8 : k === 'turret' ? 0.6 : gy + 1.1);
  view = 'devone';
}

/** match props: the four pickup pads + the supply pod */
function layoutProps(): void {
  clearItems();
  (['o2', 'armor', 'ammo', 'grenade'] as const).forEach((k, i) => {
    const m = buildPickupMesh(k);
    const x = -3 + i * 1.9;
    const lx = display.localToWorld(new THREE.Vector3(x, 0, 0));
    m.position.set(x, hf.heightAt(lx.x, lx.z) - y0, 0);
    display.add(m);
    tris['pickup-' + k] = triCount(m);
    items.push({ obj: m, label: `${k}  ${tris['pickup-' + k]}▲` });
  });
  const pod = buildPodMesh();
  const lx = display.localToWorld(new THREE.Vector3(4.6, 0, -0.5));
  pod.mesh.position.set(4.6, hf.heightAt(lx.x, lx.z) - y0, -0.5);
  display.add(pod.mesh);
  tris.pod = triCount(pod.mesh) - 32;
  items.push({ obj: pod.mesh, label: `pod  ${tris.pod}▲` });
  orbit(-10, 14, 10, 0.9, 0.8);
  view = 'dev';
}

let view = params.get('view') ?? 'grid';
let fpWeapon: WeaponId = (params.get('w') as WeaponId) || 'pulse';
let fpAds = params.has('ads');
let fpCharge = Number(params.get('charge') ?? 0);
function setView(v: string, w?: WeaponId): void {
  view = v;
  if (w) fpWeapon = w;
  vm.scene.visible = false;
  if (v === 'grid' || v === 'far') {
    layoutGrid();
    if (v === 'far') orbit(0, 6, 20, 1.2);
    else orbit(0, 6, 6.4, 1.12);
  } else if (v === 'one') {
    layoutOne(fpWeapon);
    orbit(0, 6, 1.9, 1.2);
  } else if (v === 'dev') {
    layoutDevices();
    orbit(-8, 14, 9.5, 0.9, 0.2);
  } else if (v === 'fp') {
    clearItems();
    fp(fpWeapon, fpAds);
  }
}

/** first person: world camera at eye height looking over the terrain, viewmodel overlay on top */
const fpYaw = Number(params.get('yaw') ?? 2.3);
function fp(id: WeaponId, ads = false, charge = fpCharge): void {
  view = 'fp';
  fpWeapon = id;
  fpAds = ads;
  fpCharge = charge;
  clearItems();
  vm.setHero(OWNER[id], null);
  vm.setWeapon(id, heroCol(id));
  const ex = cx;
  const ez = cz;
  camera.position.set(ex, hf.heightAt(ex, ez) + 1.62, ez);
  camera.rotation.set(0, 0, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = fpYaw;
  camera.rotation.x = -0.05;
  camera.fov = 75;
  camera.updateProjectionMatrix();
  tris[id] = tris[id] ?? triCount(buildWeaponModel(id, heroCol(id)).group);
}

setView(view, fpWeapon);

let last = performance.now();
let t = 0;
let frames = 0;
const spinOn = !params.has('nospin');
const turn = params.has('turn');
let headSweep = params.has('sweep');
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  t += dt;
  if (camera.aspect !== innerWidth / innerHeight) {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  for (const it of items) {
    if (spinOn && it.spinObj) it.spinObj.rotation.z += dt;
    if (turn && it.model) it.obj.rotation.y += dt * 0.5;
    if (it.head) it.head.rotation.y = headSweep ? Math.sin(t * 0.7) * 0.6 : 0;
  }
  world.update(dt, camera.position, camera.position, 1);
  if (view === 'fp') {
    vm.update(dt, { speed: 0, grounded: true, lookDX: 0, lookDY: 0, reload: -1, charge: fpCharge, aspect: innerWidth / innerHeight, fov: 58, ads: fpAds, sprint: false, crouch: 0, switching: false, time: t, visible: true, grapple: false });
    vm.sun.position.copy(sunDir).applyQuaternion(camera.quaternion.clone().invert());
  }
  pipe.render(dt);
  // labels
  const kids = labels.children;
  items.forEach((it, i) => {
    const el = kids[i] as HTMLDivElement | undefined;
    if (!el && it.label) addLabel(it.label);
    const e = labels.children[i] as HTMLDivElement | undefined;
    if (!e) return;
    const p = it.obj.getWorldPosition(new THREE.Vector3());
    p.y -= view === 'dev' ? 0.25 : 0.2;
    p.project(camera);
    e.style.left = ((p.x + 1) / 2) * innerWidth + 'px';
    e.style.top = ((1 - p.y) / 2) * innerHeight + 'px';
    e.style.display = view === 'grid' || view === 'dev' ? 'block' : 'none';
  });
  if (++frames % 10 === 0) dbg.textContent = `${view} ${view === 'fp' || view === 'one' ? fpWeapon + ' ' + (tris[fpWeapon] ?? '') + '▲' : ''}  draw ${pipe.stats.calls}  tris ${pipe.stats.triangles}`;
}
frame();

(window as unknown as Record<string, unknown>).__p = {
  camera,
  world,
  pipe,
  vm,
  display,
  orbit,
  setView,
  fp,
  dev: layoutDevice,
  props: layoutProps,
  tris: () => {
    for (const id of IDS) tris[id] = tris[id] ?? triCount(buildWeaponModel(id, heroCol(id)).group);
    for (const k of DEVICES) tris[k] = tris[k] ?? triCount(buildSummonMesh(k, 0x4dd8ff).mesh);
    return tris;
  },
  drawCalls: (id: WeaponId) => {
    let n = 0;
    buildWeaponModel(id, heroCol(id)).group.traverse((o) => ((o as THREE.Mesh).isMesh ? n++ : 0));
    return n;
  },
};
