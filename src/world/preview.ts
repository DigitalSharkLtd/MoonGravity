import * as THREE from 'three';
import { Pipeline } from '../render/Pipeline';
import { MapId } from './MapDefs';
import { World } from './World';
import { Body, emptyInput, MoveInput } from '../entities/Body';
import type { Quality } from '../game/Types';
import type { ShadowMode } from './Lighting';

/**
 * Dev-only world preview (world-preview.html): builds a map, renders it with the real pipeline
 * from a free camera and exposes hooks for automated screenshots / walkability tests.
 *   ?map=duel|quarry|front &x=&y=&z=&yaw=&pitch= (y is absolute; use gy= for height above ground)
 *   &q=low|medium|high|ultra &shadows=off|low|high &noao &nohud
 */
const params = new URLSearchParams(location.search);
const mapId = (params.get('map') as MapId) || 'duel';
const quality = (params.get('q') as Quality) || 'high';
const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const camera = new THREE.PerspectiveCamera(Number(params.get('fov') ?? 70), innerWidth / innerHeight, 0.1, 6000);
camera.rotation.order = 'YXZ';
const overlay = new THREE.Scene();
const pipe = new Pipeline(canvas, new THREE.Scene(), camera, overlay, camera, {
  quality,
  renderScale: 1,
  ao: !params.has('noao'),
  bloom: true,
  outlines: params.has('ink'),
  filmGrain: false,
});
if (params.has('kit')) {
  const { devLayout } = await import('./Layouts');
  const { kitTest } = await import('./Complexes');
  devLayout.fn = kitTest;
}
const t0 = performance.now();
const world = new World(mapId, { quality, shadows: (params.get('shadows') as ShadowMode) || 'high', renderer: pipe.renderer, camera });
const buildMs = performance.now() - t0;
pipe.setScene(world.scene, camera);

// ---- stats ----
let tris = 0;
let meshes = 0;
const perMat: Record<string, number> = {};
world.structures.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  meshes++;
  const g = m.geometry;
  const n = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
  tris += n * inst;
  perMat[m.name || m.type] = (perMat[m.name || m.type] ?? 0) + n * inst;
});
const stats = {
  map: mapId,
  buildMs: Math.round(buildMs),
  bakeMs: Math.round((world.structures.userData.bakeMs as number | undefined) ?? 0),
  colliders: world.physics.colliders.length,
  staticMeshes: meshes,
  staticTris: Math.round(tris),
  spawns: world.layout.spawns.length,
  pickups: world.layout.pickups.length,
  perches: world.layout.perches.length,
  perMat,
  timings: world.timings,
  lights: world.structures.userData.lights as number,
};
console.log('[preview]', JSON.stringify(stats));

// ---- camera ----
const hf = world.terrainData.hf;
function placeCam(x: number, y: number, z: number, yaw: number, pitch: number): void {
  camera.position.set(x, y, z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}
{
  const sp = world.layout.spawns[0];
  const x = Number(params.get('x') ?? sp?.pos.x ?? 0);
  const z = Number(params.get('z') ?? sp?.pos.z ?? 0);
  const y = params.has('y') ? Number(params.get('y')) : hf.heightAt(x, z) + Number(params.get('gy') ?? 1.7);
  placeCam(x, y, z, Number(params.get('yaw') ?? sp?.yaw ?? 0), Number(params.get('pitch') ?? 0));
}

// free-fly controls for humans (WASD / QE / drag to look / shift = fast)
const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
let drag = false;
canvas.addEventListener('mousedown', () => (drag = true));
addEventListener('mouseup', () => (drag = false));
addEventListener('mousemove', (e) => {
  if (!drag) return;
  camera.rotation.y -= e.movementX * 0.003;
  camera.rotation.x = Math.max(-1.55, Math.min(1.55, camera.rotation.x - e.movementY * 0.003));
});

let frames = 0;
let last = performance.now();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const sp = (keys.has('ShiftLeft') ? 30 : 8) * dt;
  camera.getWorldDirection(_f);
  _r.crossVectors(_f, camera.up).normalize();
  if (keys.has('KeyW')) camera.position.addScaledVector(_f, sp);
  if (keys.has('KeyS')) camera.position.addScaledVector(_f, -sp);
  if (keys.has('KeyD')) camera.position.addScaledVector(_r, sp);
  if (keys.has('KeyA')) camera.position.addScaledVector(_r, -sp);
  if (keys.has('KeyE')) camera.position.y += sp;
  if (keys.has('KeyQ')) camera.position.y -= sp;
  camera.updateMatrixWorld();
  world.update(params.has('still') ? 0 : dt, camera.position, camera.position, 1);
  pipe.render(dt);
  frames++;
  if (!params.has('nohud')) {
    const p = camera.position;
    hud.textContent = `${mapId}  build ${stats.buildMs} ms  colliders ${stats.colliders}  meshes ${stats.staticMeshes}  tris ${(stats.staticTris / 1000).toFixed(0)}k  calls ${pipe.renderer.info.render.calls}\n` +
      `cam ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)} yaw ${camera.rotation.y.toFixed(2)} pitch ${camera.rotation.x.toFixed(2)}`;
  }
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  pipe.resize();
});
frame();

// ---- test hooks ----
interface WalkStep {
  n: number;
  input?: Partial<MoveInput>;
  mag?: boolean;
}
const w = window as unknown as Record<string, unknown>;
w.__world = world;
w.__pipe = pipe;
w.__camera = camera;
/** build another map in the same session (material/shader re-setup check); returns stats + render errors */
w.__switchMap = async (id: MapId) => {
  const t = performance.now();
  const w2 = new World(id, { quality, shadows: 'high', renderer: pipe.renderer, camera });
  const ms = performance.now() - t;
  pipe.setScene(w2.scene, camera);
  camera.position.set(0, 60, 40);
  camera.lookAt(0, 0, 0);
  w2.update(0.016, camera.position, camera.position, 1);
  pipe.render(0.016);
  const gl = pipe.renderer.getContext();
  return { ms: Math.round(ms), glError: gl.getError(), programs: (pipe.renderer.info.programs ?? []).length };
};
w.__stats = stats;
w.__frames = () => frames;
w.__cam = (x: number, y: number, z: number, yaw: number, pitch: number) => placeCam(x, y, z, yaw, pitch);
w.__ground = (x: number, z: number) => hf.heightAt(x, z);
/** Simulate a player body: start pose + a list of input segments. Returns a sampled trace. */
w.__walk = (start: { x: number; y?: number; z: number; yaw: number }, steps: WalkStep[], every = 30) => {
  const body = new Body(world.physics);
  const y = start.y ?? hf.heightAt(start.x, start.z) + 0.3;
  body.reset(new THREE.Vector3(start.x, y, start.z), start.yaw);
  const trace: (string | number)[][] = [];
  let k = 0;
  for (const s of steps) {
    const mi: MoveInput = { ...emptyInput(), ...(s.input ?? {}) };
    if (s.mag !== undefined) body.magOn = s.mag;
    for (let i = 0; i < s.n; i++) {
      body.step(1 / 120, mi);
      mi.jumpPressed = false;
      mi.yaw = 0;
      mi.pitch = 0;
      if (k++ % every === 0) trace.push([+body.pos.x.toFixed(2), +body.pos.y.toFixed(2), +body.pos.z.toFixed(2), +body.up.y.toFixed(2), body.grounded ? 'G' : '-', body.attached ? 'A' : '-']);
    }
  }
  trace.push(['end', +body.pos.x.toFixed(2), +body.pos.y.toFixed(2), +body.pos.z.toFixed(2), +body.up.x.toFixed(2), +body.up.y.toFixed(2), +body.up.z.toFixed(2), body.grounded ? 'G' : '-', body.attached ? 'A' : '-']);
  return trace;
};
/** Steer a body from a to b (upright walking, optional jump taps); returns arrival info. */
w.__goto = (a: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, maxSteps = 2400, o: { mag?: boolean; sprint?: boolean } = {}) => {
  const body = new Body(world.physics);
  body.magOn = o.mag ?? true;
  // test endpoints can land inside a wall next to a stair foot: slide them toward the other end
  const free = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => {
    const v = new THREE.Vector3(p.x, p.y, p.z);
    const d = new THREE.Vector3(q.x - p.x, 0, q.z - p.z).normalize();
    for (let i = 0; i < 6; i++) {
      if (!world.physics.pointBlocked(v.clone().add(new THREE.Vector3(0, 0.9, 0)), 0.45)) break;
      v.addScaledVector(d, 0.25);
    }
    return { x: v.x, y: v.y, z: v.z };
  };
  a = free(a, to);
  to = free(to, a);
  const yaw0 = Math.atan2(-(to.x - a.x), -(to.z - a.z));
  body.reset(new THREE.Vector3(a.x, a.y, a.z), yaw0);
  const mi: MoveInput = { ...emptyInput(), forward: 1, sprint: !!o.sprint };
  let best = Infinity;
  let minY = Infinity;
  let maxTilt = 0;
  for (let i = 0; i < maxSteps; i++) {
    const dx = to.x - body.pos.x;
    const dz = to.z - body.pos.z;
    const dist = Math.hypot(dx, dz, (to.y - body.pos.y) * 0.5);
    best = Math.min(best, dist);
    if (dist < 0.6) return { ok: true, steps: i, pos: body.pos.toArray().map((v) => +v.toFixed(2)), minY: +minY.toFixed(2), maxTilt: +maxTilt.toFixed(2) };
    // steer like a player: yaw delta around the body's own up axis
    const d = new THREE.Vector3(dx, (to.y - body.pos.y) * 0.2, dz).normalize();
    mi.yaw = Math.max(-0.08, Math.min(0.08, body.aimDeltas(d).yaw));
    body.step(1 / 120, mi);
    minY = Math.min(minY, body.pos.y);
    maxTilt = Math.max(maxTilt, 1 - body.up.y);
  }
  return { ok: false, best: +best.toFixed(2), pos: body.pos.toArray().map((v) => +v.toFixed(2)), up: body.up.toArray().map((v) => +v.toFixed(2)), minY: +minY.toFixed(2), maxTilt: +maxTilt.toFixed(2) };
};
w.__paths = () => ((world.structures.userData.testPaths ?? []) as { name: string; from: THREE.Vector3; to: THREE.Vector3 }[]).map((p) => ({ name: p.name, from: p.from, to: p.to }));
w.__near = (x: number, y: number, z: number, r = 1) => {
  const out: unknown[] = [];
  world.physics.query(x - r, z - r, x + r, z + r, y - r, y + r, []).forEach((c) => {
    out.push({ id: c.id, kind: c.kind, metal: c.metal, c: c.center.toArray().map((v) => +v.toFixed(2)), h: c.half.toArray().map((v) => +v.toFixed(2)), ns: !!c.noShoot });
  });
  return out;
};
/** pairs of FFA / same-team spawns that can see each other (eye to eye) */
w.__spawnLOS = () => {
  const sp = world.layout.spawns;
  const vis: [number, number][] = [];
  const up = new THREE.Vector3(0, 1.6, 0);
  for (let i = 0; i < sp.length; i++)
    for (let j = i + 1; j < sp.length; j++) {
      if (sp[i].team !== sp[j].team || sp[i].team !== -1) continue;
      if (world.physics.visible(sp[i].pos.clone().add(up), sp[j].pos.clone().add(up))) vis.push([i, j]);
    }
  return { n: sp.length, visiblePairs: vis.length, pairs: vis.slice(0, 30), pos: sp.map((s) => [+s.pos.x.toFixed(1), +s.pos.y.toFixed(1), +s.pos.z.toFixed(1)]) };
};
w.__skipped = () => (world.structures.userData.skipped as number) ?? 0;
w.__ready = true;
