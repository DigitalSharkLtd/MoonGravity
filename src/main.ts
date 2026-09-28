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
import { warmMatchShaders } from './render/Warmup';
import { t } from './ui/i18n';
import { enterFullscreen, exitFullscreen, isFullscreen, toggleFullscreen } from './ui/fullscreen';
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

type State = 'boot' | 'menu' | 'loading' | 'match' | 'quit';
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
  backdropSpot = null;
  console.info(`[world] ${map} built in ${Math.round(performance.now() - t0)} ms`);
  pipe.setScene(world.scene, camera);
  menu.showLoading(title, 0.8);
  await nextFrame();
  await pipe.renderer.compileAsync(world.scene, camera).catch(() => undefined); // warm up shaders (parallel, keeps the page responsive)
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

/** open ground for the menu hero (no props on it, clear line to the camera), looking toward base A */
let backdropSpot: { p: THREE.Vector3; dir: THREE.Vector3 } | null = null;
function findBackdropSpot(w: World): { p: THREE.Vector3; dir: THREE.Vector3 } {
  const hf = w.terrainData.hf;
  const phys = w.physics;
  const base = w.layout.baseCenters[0] ?? new THREE.Vector3(-60, 0, 0);
  const down = new THREE.Vector3(0, -1, 0);
  const o = new THREE.Vector3();
  const blockedAt = (x: number, z: number) => {
    const g = hf.heightAt(x, z);
    const hit = phys.raycast(o.set(x, g + 6, z), down, 6.2);
    return !!hit && hit.colliderId >= 0;
  };
  let fallback: { p: THREE.Vector3; dir: THREE.Vector3 } | null = null;
  for (let r = 16; r <= 64; r += 4) {
    for (let k = 0; k < 24; k++) {
      const a = 0.35 + (k / 24) * Math.PI * 2;
      const x = base.x + Math.cos(a) * r;
      const z = base.z + Math.sin(a) * r;
      const p = new THREE.Vector3(x, hf.heightAt(x, z), z);
      const dir = new THREE.Vector3(base.x - x, 0, base.z - z).normalize();
      fallback ??= { p, dir };
      // the hero's footprint and the ground between hero and camera must be free of props
      let ok = true;
      for (let i = -2; i <= 7 && ok; i++) for (const sd of [-1.4, 0, 1.4]) if (blockedAt(x - dir.x * i + dir.z * sd, z - dir.z * i - dir.x * sd)) ok = false;
      if (!ok) continue;
      // clear sight from the camera area to the hero's chest and feet
      const cam = p.clone().addScaledVector(dir, -6).setY(hf.heightAt(p.x - dir.x * 6, p.z - dir.z * 6) + 1.8);
      if (!phys.visible(cam, o.copy(p).setY(p.y + 1.2)) || !phys.visible(cam, o.copy(p).setY(p.y + 0.3))) continue;
      return { p, dir };
    }
  }
  return fallback!;
}

function backdropCamera(dt: number): void {
  if (!world) return;
  backdropT += dt;
  const s = (backdropSpot ??= findBackdropSpot(world));
  camera.fov = 55;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  // look toward the base, slightly down, with a slow drift
  const yaw = Math.atan2(-s.dir.x, -s.dir.z) + Math.sin(backdropT * 0.05) * 0.06;
  camera.quaternion.setFromEuler(new THREE.Euler(-0.06 + Math.sin(backdropT * 0.037) * 0.015, yaw, 0, 'YXZ'));
  camera.updateMatrixWorld();
  // put the hero's feet exactly on the menu's holo ring (or on the right third without one)
  let nx = 0.42;
  let ny = -0.62;
  let stageH = innerHeight * 0.62;
  let feetY = innerHeight * 0.81;
  const ring = document.querySelector('.mg-stage-ring');
  const stage = ring?.closest('.mg-stage');
  if (ring && stage) {
    const r = ring.getBoundingClientRect();
    if (r.width > 0) {
      nx = ((r.left + r.width / 2) / innerWidth) * 2 - 1;
      ny = -(((r.top + r.height / 2) / innerHeight) * 2 - 1);
      feetY = r.top + r.height / 2;
      stageH = stage.getBoundingClientRect().height;
    }
  }
  const ray = new THREE.Vector3(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
  // distance so the hero (≈1.9 m) fills most of the stage height
  const ppm = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  // …but the helmet must stay clear of the top bar (wide screens made the hero touch the top edge)
  const room = Math.max(120, feetY - Math.max(96, innerHeight * 0.14));
  const dist = THREE.MathUtils.clamp(Math.max((2.0 * ppm) / Math.max(120, stageH * 0.7), (2.0 * ppm) / room), 3.2, 14);
  camera.position.copy(s.p).addScaledVector(ray, -dist);
  const hf = world.terrainData.hf;
  camera.position.y = Math.max(camera.position.y, hf.heightAt(camera.position.x, camera.position.z) + 0.6);
  if (backdropHero) {
    const p = s.p;
    backdropHero.root.position.copy(p);
    backdropHero.root.lookAt(camera.position.x, p.y, camera.position.z);
    backdropHero.root.rotateY(Math.PI - 0.35 + Math.sin(backdropT * 0.4) * 0.08);
    backdropHero.update(dt, { speed: 0, grounded: true, crouch: 0, pitch: -0.5, /* weapon lowered: relaxed "ready" stance, not aiming at the camera */ jetting: false, mag: true, attached: false, alive: true, suit: 1, firing: false, reloading: false, localVel: new THREE.Vector3(), ability: 0 }, backdropT);
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
  // compile every hero / weapon / device / effect shader now, under the loading screen
  menu.showLoading(info.map, 0.96);
  await nextFrame();
  await warmMatchShaders(game, pipe.renderer, world.scene, camera, () => pipe.render(0));
  if (!game) return;
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

/**
 * "Exit game": stop the match and networking, drop full screen and try to close the window (allowed
 * for an installed app or a script-opened tab). A normal tab can't be closed by the page, so a
 * farewell screen stops the game (rendering paused) and offers the way back.
 */
let quitEl: HTMLElement | null = null;
function quitGame(): void {
  if (game) {
    game.dispose();
    game = null;
  }
  net?.close();
  net = null;
  hud.show(false);
  input.unlock();
  menu.hide();
  exitFullscreen();
  audio.music('none');
  state = 'quit';
  window.close();
  if (quitEl) return;
  const el = document.createElement('div');
  el.className = 'mg-quit';
  const title = document.createElement('h1');
  title.textContent = t('quit.title');
  const hint = document.createElement('p');
  hint.textContent = t('quit.hint');
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'mg-btn mg-btn--primary mg-btn--big';
  back.textContent = t('quit.back');
  back.addEventListener('click', () => {
    el.remove();
    quitEl = null;
    if (settings.fullscreen) enterFullscreen();
    void leaveMatch();
  });
  el.append(title, hint, back);
  document.body.appendChild(el);
  quitEl = el;
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
  if (settings.fullscreen) enterFullscreen();
  input.lock();
}

input.onLockChange = (locked) => {
  if (!locked && state === 'match' && !ended && game && !game.heroSelectOpen && !game.paused) pause();
};
canvas.addEventListener('click', () => {
  if (state === 'match' && !input.locked && !menu.visible) {
    if (settings.fullscreen) enterFullscreen(); // same click gesture: full screen + mouse lock
    input.lock();
  }
});
// Full screen by default, as early as the browser allows: try right away (works where no gesture is
// needed, e.g. an installed app), otherwise on the player's first click / key press — browsers only
// allow it from a user gesture. Esc / F10 / F11 as the first key are left alone. Off in settings.
if (settings.fullscreen) enterFullscreen();
const firstGesture = (e: Event): void => {
  if (e instanceof KeyboardEvent && (e.key === 'Escape' || e.key === 'F10' || e.key === 'F11')) return;
  removeEventListener('pointerdown', firstGesture, true);
  removeEventListener('keydown', firstGesture, true);
  if (settings.fullscreen && !isFullscreen() && state !== 'quit') enterFullscreen();
};
// the browser's own banner talks about holding Esc (Esc is the pause key here): say how to leave with F10
document.addEventListener('fullscreenchange', () => {
  if (isFullscreen()) menu.toast(settings.language === 'ru' ? 'Полный экран · F10 — выйти' : 'Full screen · F10 to exit', 'good');
});
addEventListener('pointerdown', firstGesture, true);
addEventListener('keydown', firstGesture, true);
addEventListener('keydown', (e) => {
  // F10: toggle full screen anywhere (menu or match)
  if (e.code === 'F10' && state !== 'quit') {
    e.preventDefault();
    toggleFullscreen();
    return;
  }
  // Esc in a match opens the pause menu. With Keyboard Lock (full screen) the browser no longer drops
  // the mouse lock on Esc, so the game does it itself; the menu handles Esc while it is open.
  if (e.code === 'Escape' && state === 'match' && game && !game.paused && !menu.visible && !ended) {
    input.unlock();
    pause();
  }
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

async function playOnline(mode: ModeId, hero: HeroId, join?: string, anyMode = false): Promise<void> {
  const cancel = { v: false };
  const onCancel = () => {
    cancel.v = true;
    net?.close();
    net = null;
    menu.showMain();
  };
  menu.showMatchmaking('searching', onCancel);
  try {
    const conn = await NetGame.connect({ mode, name: settings.playerName || profile.name, hero, build: selectedBuild(profile, hero), join, anyMode, onStatus: (s) => !cancel.v && menu.showMatchmaking(s, onCancel) });
    if (cancel.v) {
      conn.close();
      return;
    }
    net = conn;
    await startMatch((conn.mode as ModeId) || mode, hero, conn.role, conn);
    if (conn.role === 'host' && conn.joinLink) menu.toast(conn.joinLink, 'good');
    // auto-start on site entry has no user gesture, so the browser refuses the mouse lock until a click
    if (anyMode)
      setTimeout(() => {
        if (state === 'match' && !input.locked && !menu.visible) menu.toast(settings.language === 'ru' ? 'Кликните по экрану, чтобы начать' : 'Click to play', 'good');
      }, 600);
  } catch (e) {
    console.warn('online play failed', e);
    if (cancel.v) return;
    const msg = (e as Error).message;
    const ru = settings.language === 'ru';
    // human-readable reason instead of the raw error code; the match continues offline with bots
    const why: Record<string, [string, string]> = {
      lobby_unavailable: ['сервер лобби недоступен', 'the lobby server is unavailable'],
      timeout: ['хост не ответил', 'the host did not respond'],
      rtc_failed: ['нет прямого соединения с хостом (сеть или NAT)', 'no direct connection to the host (network or NAT)'],
      rtc_unsupported: ['браузер не поддерживает WebRTC', 'this browser does not support WebRTC'],
      full: ['комната заполнена', 'the room is full'],
      not_found: ['комната больше не существует', 'the room no longer exists'],
      closed: ['хост закрыл комнату', 'the host closed the room'],
      host_left: ['хост вышел из игры', 'the host left the game'],
      version_mismatch: ['у хоста другая версия игры', 'the host runs a different game version'],
    };
    const reason = why[msg]?.[ru ? 0 : 1] ?? msg;
    menu.toast(ru ? `Не удалось подключиться: ${reason}. Играем с ботами.` : `Couldn't connect: ${reason}. Playing with bots.`, 'bad');
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
    if (prev.language !== s.language) game?.relocalize(); // bot names follow the language at once
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
  onQuitGame: () => quitGame(),
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
const lobbyOk = lobbyAvailable();
void lobbyOk.then((ok) => menu.setNetStatus({ lobby: ok }));

// ---------------------------------------------------------------------------
// main loop

let last = performance.now();
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state === 'quit') return; // exited: nothing simulated or drawn behind the farewell screen
  if (state === 'match' && game) {
    const me = game.local;
    // while dead: press the interact key (or Enter) to switch hero, as the death screen says
    if (me && !me.alive && !game.heroSelectOpen && !ended && (input.wasPressed(settings.keys.interact) || input.wasPressed('Enter'))) openHeroSelect();
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

// A hidden tab gets no animation frames. A hosted match must keep simulating (the clients depend on
// it), so while the host's tab is in the background the game is stepped from a timer, without rendering.
setInterval(() => {
  if (!document.hidden || state !== 'match' || !game || !net || net.role !== 'host') return;
  const now = performance.now();
  let t = Math.min(1, (now - last) / 1000);
  last = now;
  while (t > 0.001) {
    const d = Math.min(0.1, t);
    game.update(d);
    net.update(d);
    t -= d;
  }
}, 50);

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
  else if (!new URLSearchParams(location.search).has('menu')) {
    // entering the site = entering the server: join the fullest open room (any mode) or become its
    // host; later visitors land in this room until it is full. `?menu` opens the menu instead.
    void lobbyOk.then((ok) => {
      if (ok && state === 'menu' && menu.screen === 'main') void playOnline('war4v4', profile.selectedHero, undefined, true);
    });
  }
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
    THREE, // (debug: automated geometry / collision audits)
    start: (mode: ModeId, hero: HeroId) => startMatch(mode, hero, 'offline', null),
    online: (mode: ModeId, hero: HeroId, join?: string) => playOnline(mode, hero, join),
    audio,
    get net() {
      return net;
    },
  };
})();
