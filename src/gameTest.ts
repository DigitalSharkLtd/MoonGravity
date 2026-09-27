/**
 * Dev-only harness: runs a match with bots and no UI layer (for automated tests & profiling).
 * URL: game-test.html?mode=duel2v2|ffa|war4v4&hero=condor&q=high&bots=normal&spectate
 */
import * as THREE from 'three';
import { Pipeline } from './render/Pipeline';
import { World } from './world/World';
import { Input } from './core/Input';
import { Game } from './game/Game';
import { offlineBridge } from './game/NetBridge';
import { DEFAULT_SETTINGS, MODES, ModeId, HeroId, Settings, HERO_ORDER, HEROES } from './game/Types';
import { HeroModel, AnimState } from './entities/HeroModel';

const params = new URLSearchParams(location.search);
const mode = (params.get('mode') as ModeId) || 'duel2v2';
const hero = (params.get('hero') as HeroId) || 'condor';
const settings: Settings = { ...DEFAULT_SETTINGS, quality: (params.get('q') as Settings['quality']) || 'high', botDifficulty: (params.get('bots') as Settings['botDifficulty']) || 'normal' };
const canvas = document.getElementById('game') as HTMLCanvasElement;
const dbg = document.getElementById('dbg')!;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 6000);
const input = new Input(canvas);
const pipe = new Pipeline(canvas, new THREE.Scene(), camera, new THREE.Scene(), camera, { quality: settings.quality, renderScale: 1, ao: settings.ambientOcclusion, bloom: true, outlines: params.has('ink'), filmGrain: true });
const t0 = performance.now();
const world = new World(MODES[mode].map, { quality: settings.quality, shadows: settings.shadows, renderer: pipe.renderer, camera });
pipe.setScene(world.scene, camera);
const buildMs = performance.now() - t0;
const events: unknown[] = [];
const game = new Game({
  world, pipe, input, camera, settings, mode, hero, name: 'Tester', net: offlineBridge, bots: true,
  hooks: { hudUpdate: () => {}, hudEvent: (e) => events.push(e), scoreboard: () => {}, onLocalDeath: () => {}, onMatchEnd: (r) => events.push({ type: 'END', r }), onPause: () => {} },
});
game.fillBots();
canvas.addEventListener('click', () => input.lock());

/**
 * ?lineup[&pose=idle|run|crouch|prone|slide|roll|swing|grapple|jump|dead][&cam=front|side|back|close]
 * Renders every hero (+ servitor) side by side for model / animation review.
 */
const lineup = params.has('lineup');
const lineupModels: HeroModel[] = [];
if (lineup) {
  for (const f of game.fighters) if (f.model) f.model.root.visible = false;
  const sp = ((world as unknown as { layout?: { spawns?: { pos: THREE.Vector3 }[] } }).layout?.spawns?.[0]?.pos ?? new THREE.Vector3()).clone();
  const cx = Number(params.get('x') ?? sp.x);
  const cz = Number(params.get('z') ?? sp.z);
  const hf = world.terrainData.hf;
  const list: [HeroId, 'servitor' | undefined][] = [...HERO_ORDER.map((h) => [h, undefined] as [HeroId, undefined]), ['forge', 'servitor']];
  list.forEach(([h, v], i) => {
    const m = new HeroModel(h, null, v);
    m.setWeapon(v ? 'pulse' : HEROES[h].weapon);
    const x = cx + (i - (list.length - 1) / 2) * 1.55;
    m.root.position.set(x, hf.heightAt(x, cz), cz);
    world.scene.add(m.root);
    lineupModels.push(m);
  });
  const view = params.get('cam') ?? 'front';
  const y0 = hf.heightAt(cx, cz);
  if (view === 'close') camera.position.set(cx - 2.4, y0 + 1.5, cz - 3.2);
  else if (view === 'side') camera.position.set(cx + 11, y0 + 2, cz - 3);
  else if (view === 'back') camera.position.set(cx, y0 + 2.2, cz + 9);
  else camera.position.set(cx, y0 + 2.4, cz - 9.5);
  camera.lookAt(view === 'close' ? cx - 3.8 : cx, y0 + 1.0, cz);
}
let poseName = params.get('pose') ?? 'idle';
const poseState = (t: number): AnimState => {
  void t;
  const pose = poseName;
  const run = pose === 'run';
  return {
    speed: run ? 5.4 : pose === 'prone' ? 0.8 : 0,
    grounded: pose !== 'jump' && pose !== 'grapple',
    crouch: pose === 'crouch' ? 1 : 0,
    pitch: 0,
    jetting: pose === 'jump',
    mag: true,
    attached: false,
    alive: pose !== 'dead',
    suit: 1,
    firing: false,
    reloading: false,
    localVel: new THREE.Vector3(0, 0, run ? -5.4 : 0),
    ability: 0,
    stance: pose === 'prone' ? 'prone' : pose === 'slide' ? 'slide' : pose === 'roll' ? 'roll' : pose === 'crouch' ? 'crouch' : 'stand',
    grapple: pose === 'grapple',
    deflect: pose === 'deflect',
    shield: pose === 'shield' ? 1 : 0,
  } as AnimState & { t?: number } & { _t?: number } & Record<string, unknown> as AnimState;
};
let lineT = 0;
let last = performance.now();
let frames = 0;
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (lineup) {
    lineT += dt;
    const st = poseState(lineT);
    const pose = poseName;
    // swings / rolls loop so a screenshot catches them mid-motion
    if (pose === 'swing' && Math.floor(lineT / 0.9) !== Math.floor((lineT - dt) / 0.9)) lineupModels.forEach((m, i) => m.swing(i % 2 ? 1 : -1));
    if (pose === 'roll' && Math.floor(lineT / 0.8) !== Math.floor((lineT - dt) / 0.8)) lineupModels.forEach((m) => m.update(0, { ...st, stance: 'stand' }, lineT));
    for (const m of lineupModels) m.update(dt, st, lineT);
    world.update(dt, camera.position, camera.position, 1);
    pipe.render(dt);
    return;
  }
  game.update(dt);
  pipe.render(dt);
  if (++frames % 10 === 0) {
    const me = game.local!;
    dbg.textContent = `build ${Math.round(buildMs)}ms  fps ${game['fps']}  draw ${pipe.renderer.info.render.calls}  tris ${pipe.renderer.info.render.triangles}\n` +
      `hp ${Math.round(me.health)} suit ${Math.round(me.suit)} o2 ${Math.round(me.oxygen)} alive ${me.alive} ammo ${me.activeWeapon.ammo}\n` +
      game.fighters.map((f) => `${f.name.padEnd(16)} ${f.hero.padEnd(8)} t${f.team} ${f.alive ? 'A' : 'd'} hp${Math.round(f.health)} k${f.stats.kills}/d${f.stats.deaths}`).join('\n');
  }
}
frame();
(window as unknown as Record<string, unknown>).__t = { game, world, pipe, input, events, buildMs, lineupModels, camera, setPose: (p: string) => (poseName = p) };
