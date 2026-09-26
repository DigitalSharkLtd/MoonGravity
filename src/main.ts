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
const world = new World(mapId, 'high');
console.log('world build ms', Math.round(performance.now() - t0), 'colliders', world.physics.colliders.length, 'meshes', world.structures.children.length);
const pipe = new Pipeline(canvas, world.scene, camera, overlay, camera, 'high');
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
