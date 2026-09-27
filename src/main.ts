import './style.css';
import * as THREE from 'three';
import { Pipeline, PipelineOptions } from './render/Pipeline';
import { setTextureQuality } from './render/TextureGen';
import { clearMaterialCache } from './render/Materials';
import { World } from './world/World';
import { Input } from './core/Input';
import { Game } from './game/Game';
import { offlineBridge } from './game/NetBridge';
import { HeroModel } from './entities/HeroModel';
import { MODES, ModeId, HeroId, Settings, Profile, MatchResult, HERO_ORDER, MapId } from './game/Types';
import { MenuSystem, MenuCallbacks } from './ui/Menu';
import { Hud } from './ui/Hud';
import { loadSettings, saveSettings, loadProfile, saveProfile, applyMatch, selectedBuild } from './ui/Storage';
import { registerPwa, canInstall, promptInstall } from './pwa/register';
import { audio } from './audio/Audio';
import { setGameLang } from './game/Strings';
import { NetGame } from './net/NetGame';
import { parseJoinLink, listRooms, lobbyAvailable } from './net/Lobby';

// ---------------------------------------------------------------------------
// bootstrap

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;
const hudRoot = document.getElementById('hud') as HTMLElement;

let settings: Settings = loadSettings();
let profile: Profile = loadProfile();
if (!settings.playerName) settings.playerName = profile.name;
setGameLang(settings.language);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 6000);
const input = new Input(canvas);
const pipeOpts = (s: Settings): PipelineOptions => ({ quality: s.quality, renderScale: s.renderScale, ao: s.ambientOcclusion, bloom: s.bloom, outlines: s.outlines, filmGrain: s.filmGrain, antialias: s.antialias, lensFlare: s.lensFlare });

/** heavy setting: procedural texture resolution (takes effect for newly built worlds / heroes) */
function applyTextureQuality(s: Settings): void {
  const q = s.textureQuality ?? 'medium';
  if (setTextureQuality(q === 'low' ? 256 : q === 'high' ? 1024 : 512, q === 'low' ? 2 : q === 'high' ? 16 : 8)) clearMaterialCache();
}
applyTextureQuality(settings);
const pipe = new Pipeline(canvas, new THREE.Scene(), camera, new THREE.Scene(), camera, pipeOpts(settings));
const hud = new Hud(hudRoot, settings);
hud.show(false);

type State = 'boot' | 'menu' | 'loading' | 'match';
let state: State = 'boot';
let world: World | null = null;
let worldMap: MapId | null = null;
let worldDirty = false;
let game: Game | null = null;
let net: NetGame | null = null;
let backdropHero: HeroModel | null = null;
let backdropT = 0;
let ended = false;

function applyAudioSettings(s: Settings): void {
  audio.setMasterVolume(s.masterVolume);
  audio.setSfxVolume(s.sfxVolume);
  audio.setMusicVolume(s.musicVolume);
}
applyAudioSettings(settings);
let audioStarted = false;
const unlockAudio = () => {
  audio.init();
  if (!audioStarted && state === 'menu') {
    audioStarted = true;
    audio.music('menu');
  }
};
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function disposeWorld(): void {
  if (!world) return;
  world.lighting.dispose();
  world.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  world = null;
  worldMap = null;
}

async function ensureWorld(map: MapId, title: string): Promise<World> {
  if (world && worldMap === map && !worldDirty) return world;
  menu.showLoading(title, 0.15);
  await nextFrame();
  if (backdropHero) {
    world?.scene.remove(backdropHero.root);
    backdropHero = null;
  }
  disposeWorld();
  menu.showLoading(title, 0.35);
  await nextFrame();
  const t0 = performance.now();
  applyTextureQuality(settings);
  world = new World(map, { quality: settings.quality, shadows: settings.shadows, renderer: pipe.renderer, camera, terrainDetail: settings.terrainDetail });
  world.lighting.setReflections(settings.reflections);
  worldMap = map;
  worldDirty = false;
  console.info(`[world] ${map} built in ${Math.round(performance.now() - t0)} ms`);
  pipe.setScene(world.scene, camera);
  menu.showLoading(title, 0.8);
  await nextFrame();
  pipe.renderer.compile(world.scene, camera); // warm up shaders
  return world;
}

// ---------------------------------------------------------------------------
// menu backdrop: slow cinematic camera + the selected hero standing on the right (OW style)

function placeBackdropHero(hero: HeroId): void {
  if (!world) return;
  if (backdropHero) world.scene.remove(backdropHero.root);
  backdropHero = new HeroModel(hero, null);
  world.scene.add(backdropHero.root);
}

function backdropCamera(dt: number): void {
  if (!world) return;
  backdropT += dt;
  const base = world.layout.baseCenters[0] ?? new THREE.Vector3(-60, 0, 0);
  const ang = 0.35 + Math.sin(backdropT * 0.05) * 0.12;
  const cx = base.x + 18 + Math.cos(ang) * 6;
  const cz = base.z + 22 + Math.sin(ang) * 4;
  const hf = world.terrainData.hf;
  camera.position.set(cx, hf.heightAt(cx, cz) + 1.7, cz);
  camera.lookAt(0, hf.heightAt(0, 0) + 4, 0);
  camera.fov = 55;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (backdropHero) {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
    const p = camera.position.clone().addScaledVector(fwd, 4.2).addScaledVector(right, 1.35);
    p.y = hf.heightAt(p.x, p.z);
    backdropHero.root.position.copy(p);
    backdropHero.root.lookAt(camera.position.x, p.y, camera.position.z);
    backdropHero.root.rotateY(Math.PI - 0.35 + Math.sin(backdropT * 0.4) * 0.08);
    backdropHero.update(dt, { speed: 0, grounded: true, crouch: 0, pitch: -0.1, jetting: false, mag: true, attached: false, alive: true, suit: 1, firing: false, reloading: false, localVel: new THREE.Vector3(), ability: 0 }, backdropT);
  }
}

// ---------------------------------------------------------------------------
// match lifecycle

/** unlocked build per hero for the local player */
function buildsOf(p: Profile): Partial<Record<HeroId, string>> {
  const out: Partial<Record<HeroId, string>> = {};
  for (const h of HERO_ORDER) out[h] = selectedBuild(p, h);
  return out;
}

async function startMatch(mode: ModeId, hero: HeroId, role: 'offline' | 'host' | 'client', netGame: NetGame | null): Promise<void> {
  const info = MODES[mode];
  state = 'loading';
  ended = false;
  audio.music('none');
  await ensureWorld(info.map, info.map);
  if (!world) return;
  if (backdropHero) {
    world.scene.remove(backdropHero.root);
    backdropHero = null;
  }
  worldDirty = true; // matches deform terrain & leave decals: rebuild next time
  menu.showLoading(info.map, 0.9);
  await nextFrame();
  game = new Game({
    world,
    pipe,
    input,
    camera,
    settings,
    mode,
    hero,
    name: settings.playerName || profile.name,
    builds: buildsOf(profile),
    net: netGame ? netGame.bridge : offlineBridge,
    bots: role !== 'client',
    hooks: {
      hudUpdate: (s, dt) => hud.update(s, dt),
      hudEvent: (e) => hud.event(e),
      scoreboard: (show) => {
        if (!game) return;
        hud.setScoreboard(show ? game.scoreRows() : null, { mode, teamScores: game.match.teamScores, timeLeft: game.match.timeLeft, localTeam: game.local?.team ?? 0, mapId: info.map });
      },
      onLocalDeath: () => {},
      onMatchEnd: (res) => void endMatch(res),
      onPause: () => pause(),
    },
  });
  netGame?.attach(game);
  if (role !== 'client') game.fillBots();
  hud.setMinimap(info.map, game.renderMinimap(), world.physics.bounds);
  hud.setSettings(settings);
  hud.show(true);
  menu.hide();
  state = 'match';
  audio.music('match');
  audio.play('match_start');
  input.lock();
}

async function endMatch(res: MatchResult): Promise<void> {
  if (!game || ended) return;
  ended = true;
  const me = game.local!;
  const before = profile;
  const s = me.stats;
  const after = applyMatch(profile, res, {
    hero: me.hero,
    damage: s.damage,
    healing: s.healing,
    headshots: s.headshots,
    shotsFired: s.shots,
    shotsHit: s.hits,
    captures: s.captures,
    longestKill: s.longestKill,
    wallKills: s.wallKills,
    suffocations: s.suffocations,
    nukes: s.nukes,
    bestStreak: s.bestStreak,
    weapons: s.weapons,
    timePlayed: game.match.time,
  });
  profile = after;
  saveProfile(profile);
  menu.setProfile(profile);
  input.unlock();
  hud.show(false);
  menu.showEndOfMatch(res, before, after, () => void leaveMatch());
}

async function leaveMatch(): Promise<void> {
  if (game) {
    game.dispose();
    game = null;
  }
  net?.close();
  net = null;
  hud.show(false);
  input.unlock();
  state = 'loading';
  await ensureWorld('front', 'MOON GRAVITY');
  placeBackdropHero(profile.selectedHero);
  state = 'menu';
  audio.music('menu');
  menu.showMain();
}

function pause(): void {
  if (!game || state !== 'match' || ended) return;
  game.paused = true;
  menu.showPause({ mode: game.modeInfo.id, roomLink: net?.joinLink, isHost: net ? net.role === 'host' : true, players: game.fighters.filter((f) => !f.isBot).length, capacity: game.modeInfo.capacity });
}

function resume(): void {
  if (!game) return;
  game.paused = false;
  menu.hide();
  input.lock();
}

input.onLockChange = (locked) => {
  if (!locked && state === 'match' && !ended && game && !game.heroSelectOpen) pause();
};
canvas.addEventListener('click', () => {
  if (state === 'match' && !input.locked && !menu.visible) input.lock();
});

function openHeroSelect(): void {
  if (!game || !game.local) return;
  const me = game.local;
  game.heroSelectOpen = true;
  input.unlock();
  menu.showHeroSelect({
    mode: game.modeInfo.id,
    team: me.team,
    allies: game.fighters.filter((f) => f !== me && !game!.areEnemies(me, f)).map((f) => ({ name: f.name, hero: f.hero, isBot: f.isBot })),
    current: me.hero,
    canClose: true,
  });
}

// ---------------------------------------------------------------------------
// online play (listen server)

async function playOnline(mode: ModeId, hero: HeroId, join?: string): Promise<void> {
  const cancel = { v: false };
  const onCancel = () => {
    cancel.v = true;
    net?.close();
    net = null;
    menu.showMain();
  };
  menu.showMatchmaking('searching', onCancel);
  try {
    const conn = await NetGame.connect({ mode, name: settings.playerName || profile.name, hero, build: selectedBuild(profile, hero), join, onStatus: (s) => !cancel.v && menu.showMatchmaking(s, onCancel) });
    if (cancel.v) {
      conn.close();
      return;
    }
    net = conn;
    await startMatch((conn.mode as ModeId) || mode, hero, conn.role, conn);
    if (conn.role === 'host' && conn.joinLink) menu.toast(conn.joinLink, 'good');
  } catch (e) {
    console.warn('online play failed', e);
    if (cancel.v) return;
    const msg = (e as Error).message;
    const ru = settings.language === 'ru';
    menu.toast(msg === 'lobby_unavailable' ? (ru ? 'Сервер лобби недоступен — игра с ботами' : 'Lobby unavailable — playing with bots') : (ru ? 'Не удалось подключиться: ' : 'Connection failed: ') + msg, 'bad');
    net = null;
    await startMatch(mode, hero, 'offline', null);
  }
}

// ---------------------------------------------------------------------------
// menu callbacks

const cb: MenuCallbacks = {
  onPlay: ({ mode, online, hero, build }) => {
    profile = { ...profile, selectedHero: hero, builds: build ? { ...(profile.builds ?? {}), [hero]: build } : profile.builds };
    saveProfile(profile);
    if (online) void playOnline(mode, hero);
    else void startMatch(mode, hero, 'offline', null);
  },
  onJoinRoom: (roomId, hero) => void playOnline('war4v4', hero, roomId),
  onCreateRoom: (mode, hero) => void playOnline(mode, hero, 'create'),
  onSettingsChanged: (s) => {
    const prev = settings;
    settings = s;
    saveSettings(s);
    setGameLang(s.language);
    pipe.setOptions(pipeOpts(s));
    applyAudioSettings(s);
    hud.setSettings(s);
    world?.lighting.setReflections(s.reflections);
    if (prev.textureQuality !== s.textureQuality || prev.terrainDetail !== s.terrainDetail || prev.shadows !== s.shadows) worldDirty = true; // rebuilt for the next match
    if (game) {
      game.settings = s;
      game.effects.setParticles(s.particles);
    }
  },
  onProfileChanged: (p) => {
    profile = p;
    saveProfile(p);
    if (state === 'menu' && (!backdropHero || backdropHero.hero !== p.selectedHero)) placeBackdropHero(p.selectedHero);
  },
  onHeroPicked: (hero, build) => {
    if (game && game.local) {
      game.heroSelectOpen = false;
      profile = { ...profile, selectedHero: hero, builds: build ? { ...(profile.builds ?? {}), [hero]: build } : profile.builds };
      saveProfile(profile);
      const b = selectedBuild(profile, hero);
      game.builds[hero] = b;
      if (!game.local.alive) {
        if (game.local.hero !== hero) game.setHero(game.local, hero);
        else game.setBuild(game.local, b);
      }
      net?.heroChanged(hero, b);
    }
    menu.hide();
    input.lock();
  },
  onResume: () => resume(),
  onLeaveMatch: () => void leaveMatch(),
  onUiSound: (k) => audio.play(k === 'hover' ? 'ui_hover' : 'ui_click', { volume: settings.uiVolume * (k === 'hover' ? 0.5 : 1) }),
  listRooms: (mode) => listRooms(mode),
  canInstall: () => canInstall(),
  installApp: () => {
    void promptInstall().then(() => {
      if (state === 'menu') menu.showMain();
    });
  },
  requestHeroPreview: (_canvas, hero) => {
    if (hero && state === 'menu' && (!backdropHero || backdropHero.hero !== hero)) placeBackdropHero(hero);
  },
};
const menu = new MenuSystem(uiRoot, cb, settings, profile);
void lobbyAvailable().then((ok) => menu.setNetStatus({ lobby: ok }));

// ---------------------------------------------------------------------------
// main loop

let last = performance.now();
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state === 'match' && game) {
    const me = game.local;
    // while dead: press the sealant key (or Enter) to switch hero
    if (me && !me.alive && !game.heroSelectOpen && !ended && (input.wasPressed(settings.keys.sealant) || input.wasPressed('Enter'))) openHeroSelect();
    game.update(dt);
    net?.update(dt);
    pipe.render(dt);
  } else if (world && (state === 'menu' || state === 'boot')) {
    backdropCamera(dt);
    world.update(dt, camera.position, camera.position, 1);
    pipe.render(dt);
    input.endFrame();
  } else input.endFrame();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  pipe.resize();
});

registerPwa(() => {
  // the install offer arrived: refresh the main menu so the entry shows up
  if (state === 'menu' && menu.screen === 'main') menu.showMain();
});

void (async () => {
  requestAnimationFrame(frame);
  await ensureWorld('front', 'MOON GRAVITY');
  placeBackdropHero(profile.selectedHero);
  state = 'menu';
  menu.showMain();
  const join = parseJoinLink();
  if (join) void playOnline('war4v4', profile.selectedHero, join);
  // debug / automated test handle
  (window as unknown as Record<string, unknown>).__mg = {
    get game() {
      return game;
    },
    get world() {
      return world;
    },
    input,
    pipe,
    menu,
    hud,
    HERO_ORDER,
    start: (mode: ModeId, hero: HeroId) => startMatch(mode, hero, 'offline', null),
    online: (mode: ModeId, hero: HeroId, join?: string) => playOnline(mode, hero, join),
    get net() {
      return net;
    },
  };
})();
