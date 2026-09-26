import './style.css';
import * as THREE from 'three';
import { Pipeline } from './render/Pipeline';
import { MapId } from './world/MapDefs';
import { World } from './world/World';
import { Input } from './core/Input';
import { Body, emptyInput } from './entities/Body';

// Temporary preview bootstrap (replaced by the full game shell).
const params = new URLSearchParams(location.search);
const mapId = (params.get('map') as MapId) || 'front';
const canvas = document.getElementById('game') as HTMLCanvasElement;
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 6000);
const overlay = new THREE.Scene();
const t0 = performance.now();
const q = (params.get('q') as any) || 'high';
const pipe = new Pipeline(canvas, new THREE.Scene(), camera, overlay, camera, { quality: q, renderScale: 1, ao: !params.has('noao'), bloom: true, outlines: params.has('ink'), filmGrain: true });
const world = new World(mapId, { quality: q, shadows: (params.get('shadows') as any) || 'high', renderer: pipe.renderer, camera });
pipe.setScene(world.scene, camera);
console.log('world build ms', Math.round(performance.now() - t0), 'colliders', world.physics.colliders.length, 'meshes', world.structures.children.length);
const input = new Input(canvas);
const body = new Body(world.physics);
const sp = world.layout.spawns[0];
const cx = params.get('x');
if (cx !== null) {
  const x = Number(cx), z = Number(params.get('z'));
  body.reset(new THREE.Vector3(x, world.terrainData.hf.heightAt(x, z) + Number(params.get('y') ?? 0.5), z), Number(params.get('yaw') ?? 0));
} else body.reset(sp.pos, sp.yaw);
body.pitch = Number(params.get('pitch') ?? 0);
const fly = params.has('fly');
canvas.addEventListener('click', () => input.lock());

let last = performance.now();
let acc = 0;
function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  const mi = emptyInput();
  mi.forward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
  mi.strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
  mi.jump = input.isDown('Space');
  mi.jumpPressed = input.wasPressed('Space');
  mi.sprint = input.isDown('ShiftLeft');
  mi.crouch = input.isDown('KeyC') || input.isDown('ControlLeft');
  if (input.wasPressed('KeyF')) body.magOn = !body.magOn;
  let first = true;
  while (acc >= 1 / 120) {
    acc -= 1 / 120;
    if (!first) { mi.jumpPressed = false; }
    mi.yaw = first ? -input.mouseDX * 0.0022 : 0;
    mi.pitch = first ? -input.mouseDY * 0.0022 : 0;
    if (!fly) body.step(1 / 120, mi);
    first = false;
  }
  input.endFrame();
  body.eye(camera.position);
  const look = body.viewDir(new THREE.Vector3());
  camera.up.copy(body.up);
  camera.lookAt(camera.position.clone().add(look));
  world.update(dt, camera.position, body.pos, 1);
  pipe.render(dt);
  (window as any).__body = body;
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  pipe.resize();
});
(window as any).__input = input;
(window as any).__world = world;
frame();
(window as any).__sim = (steps: number, inp: any) => {
  const mi = { ...emptyInput(), ...inp };
  if (inp.mag !== undefined) body.magOn = inp.mag;
  const log: any[] = [];
  for (let i = 0; i < steps; i++) {
    body.step(1 / 120, mi);
    mi.jumpPressed = false;
    if (i % 30 === 0) log.push([+body.pos.x.toFixed(2), +body.pos.y.toFixed(2), +body.pos.z.toFixed(2), 'up', +body.up.x.toFixed(2), +body.up.y.toFixed(2), +body.up.z.toFixed(2), body.attached ? 'A' : '-', body.grounded ? 'G' : '-']);
  }
  return log;
};

// --- hero lineup preview (?heroes) ---
import { HeroModel } from './entities/HeroModel';
import { HERO_ORDER } from './game/Types';
if (params.has('heroes')) {
  const base = new THREE.Vector3(Number(params.get('hx') ?? -128), 0, Number(params.get('hz') ?? 20));
  const models: HeroModel[] = [];
  HERO_ORDER.forEach((h, i) => {
    const team = params.get('team');
    const m = new HeroModel(h, team === null ? null : team === '0' ? 0x2f7cf6 : 0xff6a1f);
    const x = base.x + (i - 2.5) * 1.6;
    const z = base.z;
    m.root.position.set(x, world.terrainData.hf.heightAt(x, z), z);
    m.root.rotation.y = params.has('side') ? 0.9 : params.has('back') ? Math.PI : 0.25;
    if (params.get('hl') === 'enemy') m.setHighlight('enemy');
    world.scene.add(m.root);
    models.push(m);
  });
  const tt0 = performance.now();
  setInterval(() => {
    const t = (performance.now() - tt0) / 1000;
    models.forEach((m, i) =>
      m.update(1 / 30, { speed: params.has('walk') ? 3 : 0, grounded: true, crouch: 0, pitch: 0, jetting: i === 0, mag: true, attached: false, alive: true, suit: i === 5 ? 0.3 : 1, firing: false, reloading: false, localVel: new THREE.Vector3(), ability: 0 }, t),
    );
  }, 33);
  body.reset(new THREE.Vector3(base.x, world.terrainData.hf.heightAt(base.x, base.z - 5.5), base.z - 5.5), Math.PI);
  body.pitch = -0.08;
}
