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
import { DEFAULT_SETTINGS, MODES, ModeId, HeroId, Settings } from './game/Types';

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
let last = performance.now();
let frames = 0;
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
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
(window as unknown as Record<string, unknown>).__t = { game, world, pipe, input, events, buildMs };
