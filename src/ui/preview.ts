/**
 * DEV-ONLY visual test harness for the UI layer: mounts menus / HUD with fake data.
 * Open /ui-preview.html?screen=main|play|heroes|profile|settings|credits|loading|matchmaking|heroselect|pause|end|hud|scoreboard
 * Extra params: lang=en, offline=1, clean=1 (hide the switcher), hud=combat|breach|suffocate|dead|env|rail|nuke|designator|ffa|cloak|invuln|oob,
 * result=victory|defeat|draw|ffa, tab=<tab id>.
 */
import { DEFAULT_SETTINGS, HERO_ORDER, HEROES, MODES, xpForLevel, type Blip, type HeroId, type HudState, type MatchResult, type ModeId, type Profile, type RibbonId, type ScoreRow, type Settings } from '../game/Types';
import { mapArtSvg, menuBackdropSvg } from './art';
import { Hud } from './Hud';
import { MenuSystem, type MenuCallbacks, type RoomInfo } from './Menu';
import { applyMatch, sanitizeSettings } from './Storage';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'main';
const lang = (q.get('lang') ?? 'ru') as 'ru' | 'en';
const offline = q.has('offline');
const clean = q.has('clean');
const hudVariant = q.get('hud') ?? 'combat';

const bg = document.getElementById('bg')!;
const uiRoot = document.getElementById('ui')!;
const hudRoot = document.getElementById('hud')!;

// ---------------------------------------------------------------------------
// fake data

function xpForLevelTotal(level: number, extra: number): number {
  let s = 0;
  for (let i = 1; i < level; i++) s += xpForLevel(i);
  return s + extra;
}

function fakeProfile(): Profile {
  const hs: Profile['heroes'] = {
    condor: { kills: 820, deaths: 610, time: 3600 * 19, matches: 71, wins: 40, damage: 520000, healing: 0 },
    needle: { kills: 540, deaths: 330, time: 3600 * 12.5, matches: 44, wins: 26, damage: 380000, healing: 0 },
    lunatic: { kills: 390, deaths: 350, time: 3600 * 8, matches: 29, wins: 15, damage: 310000, healing: 0 },
    reactor: { kills: 160, deaths: 140, time: 3600 * 5.2, matches: 18, wins: 11, damage: 140000, healing: 0 },
    helios: { kills: 90, deaths: 120, time: 3600 * 6.1, matches: 22, wins: 13, damage: 42000, healing: 188000 },
    blade: { kills: 210, deaths: 190, time: 3600 * 4.4, matches: 16, wins: 9, damage: 150000, healing: 0 },
    forge: { kills: 120, deaths: 80, time: 3600 * 3.2, matches: 11, wins: 7, damage: 96000, healing: 0 },
  };
  const modes: ModeId[] = ['war4v4', 'duel2v2', 'ffa'];
  const history = Array.from({ length: 14 }, (_, i) => {
    const mode = modes[i % 3];
    const won = mode === 'ffa' ? null : i % 4 === 1 ? false : i % 7 === 3 ? null : true;
    return {
      t: Date.now() - i * 3600 * 1000 * 5.3,
      mode,
      map: MODES[mode].map,
      won: mode === 'ffa' ? (i % 2 === 0) : won,
      placement: mode === 'ffa' ? 1 + (i % 6) : won === false ? 2 : 1,
      kills: 8 + ((i * 7) % 17),
      deaths: 4 + ((i * 5) % 9),
      assists: 2 + ((i * 3) % 8),
      score: 1400 + ((i * 377) % 2200),
      xp: 900 + ((i * 211) % 1400),
    };
  });
  return {
    version: 1,
    name: 'Regolith-47',
    xp: xpForLevelTotal(23, 3120),
    stats: {
      matches: 184,
      wins: 101,
      losses: 76,
      kills: 2140,
      deaths: 1602,
      assists: 780,
      headshots: 512,
      shotsFired: 64000,
      shotsHit: 21300,
      timePlayed: 3600 * 52.4,
      captures: 143,
      bestStreak: 17,
      longestKill: 412,
      wallKills: 88,
      suffocations: 61,
      nukes: 9,
      damageDealt: 1480000,
    },
    weapons: {},
    heroes: hs,
    ribbons: { ace: 12, multikill: 31, killstreak5: 44, killstreak10: 6, headhunter: 19, ult: 8, nuclear: 3, ceiling: 27, breach: 15, capture: 22 },
    selectedHero: 'condor',
    heroXp: { condor: 12000, needle: 7200, lunatic: 4100, reactor: 2600, helios: 3000, blade: 2300, forge: 900, phantom: 400 },
    builds: { condor: 'grenadier', needle: 'recon' },
    history,
    createdAt: Date.now() - 86400000 * 64,
  };
}

let settings: Settings = sanitizeSettings({ ...DEFAULT_SETTINGS, language: lang });
let profile = fakeProfile();

const NAMES = ['Regolith-47', 'TychoFox', 'Selene-12', 'KeplerRaven', 'ApogeeLynx', 'Basalt-88', 'NovaKite', 'MareCobra'];

function fakeRows(mode: ModeId): ScoreRow[] {
  const teams = MODES[mode].teams;
  const n = MODES[mode].slots;
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: NAMES[i % NAMES.length],
    team: teams ? i % 2 : -1,
    hero: HERO_ORDER[(i * 5) % HERO_ORDER.length],
    kills: 22 - i * 2 + (i % 3),
    deaths: 5 + (i % 4) * 2,
    assists: 3 + ((i * 7) % 9),
    score: 3400 - i * 260,
    damage: 9800 - i * 700,
    healing: HERO_ORDER[(i * 5) % HERO_ORDER.length] === 'helios' ? 7200 : 0,
    ping: i === 0 ? 0 : 20 + ((i * 17) % 90),
    isBot: i >= 5,
    isLocal: i === 0,
    alive: i !== 3 && i !== 6,
  }));
}

function fakeResult(kind: string): { result: MatchResult; before: Profile; after: Profile } {
  const mode: ModeId = kind === 'ffa' ? 'ffa' : 'war4v4';
  const rows = fakeRows(mode);
  const won = kind === 'victory' ? true : kind === 'defeat' ? false : kind === 'draw' ? null : null;
  const xp = [
    { label: lang === 'ru' ? 'Устранения ×22' : 'Eliminations ×22', amount: 2200 },
    { label: lang === 'ru' ? 'Помощь ×9' : 'Assists ×9', amount: 450 },
    { label: lang === 'ru' ? 'Захваты точек ×4' : 'Point captures ×4', amount: 800 },
    { label: lang === 'ru' ? (won ? 'Победа' : 'Участие в матче') : won ? 'Victory' : 'Match completed', amount: won ? 1500 : 500 },
    { label: lang === 'ru' ? 'Первый матч дня' : 'First match of the day', amount: 1000 },
  ];
  const before = profile;
  const ribbons: RibbonId[] = ['ace', 'multikill', 'ceiling', 'breach'];
  const result: MatchResult = {
    mode,
    map: MODES[mode].map,
    duration: 12 * 60 + 37,
    teamScores: mode === 'ffa' ? [25, 22] : won === true ? [600, 412] : won === false ? [388, 600] : [540, 540],
    winnerTeam: won === true ? 0 : won === false ? 1 : -1,
    localTeam: 0,
    won,
    placement: mode === 'ffa' ? 2 : won === false ? 2 : 1,
    rows,
    xp,
    ribbons,
    levelBefore: 23,
    xpBefore: before.xp,
    xpAfter: before.xp + xp.reduce((a, x) => a + x.amount, 0),
    mvpId: 1,
  };
  const after = applyMatch(before, result, {
    hero: 'condor',
    damage: 9800,
    healing: 0,
    headshots: 7,
    shotsFired: 640,
    shotsHit: 230,
    captures: 4,
    longestKill: 188,
    wallKills: 3,
    suffocations: 2,
    nukes: 0,
    bestStreak: 9,
    weapons: { pulse: { kills: 22, headshots: 7, shots: 640, hits: 230 } },
    timePlayed: 757,
  });
  return { result, before, after };
}

const fakeRooms: RoomInfo[] = [
  { roomId: 'Ab3dE9xQ', mode: 'war4v4', name: 'Tycho Defenders', players: 6, capacity: 8 },
  { roomId: 'K2mP8zLw', mode: 'ffa', name: 'Палладиевый рай', players: 3, capacity: 8 },
  { roomId: 'Qe7Rt1Yu', mode: 'duel2v2', name: 'Mine-7 duels', players: 4, capacity: 4 },
  { roomId: 'Zx9Cv3Bn', mode: 'war4v4', name: 'ARTEMIS HQ', players: 2, capacity: 8 },
  { roomId: 'Pl0Ok9Ij', mode: 'duel2v2', name: 'Вверх ногами', players: 1, capacity: 4 },
];

// ---------------------------------------------------------------------------
// callbacks

let menu: MenuSystem;
const cb: MenuCallbacks = {
  onPlay: (r) => {
    console.log('onPlay', JSON.stringify(r));
    if (r.online) menu.showMatchmaking(lang === 'ru' ? 'Ищем комнату…' : 'Looking for a room…', () => menu.showMain());
    else startLoading();
  },
  onJoinRoom: (id, hero) => {
    console.log('join', id, hero);
    menu.toast((lang === 'ru' ? 'Подключение к ' : 'Joining ') + id, 'info');
  },
  onCreateRoom: (mode, hero) => {
    console.log('create', mode, hero);
    menu.showPause({ mode, roomLink: location.origin + '/#join=Ab3dE9xQ', isHost: true, players: 1, capacity: MODES[mode].capacity });
  },
  onSettingsChanged: (s) => {
    settings = s;
    hud?.setSettings(s);
  },
  onProfileChanged: (p) => {
    profile = p;
  },
  onHeroPicked: (h, b) => console.log('hero picked', h, b),
  onResume: () => {
    console.log('resume');
    window.setTimeout(() => menu.showPause({ mode: 'war4v4', roomLink: location.origin + '/#join=Ab3dE9xQ', isHost: true, players: 5, capacity: 8 }), 1200);
  },
  onLeaveMatch: () => menu.showMain(),
  onUiSound: () => {},
  listRooms: (mode) =>
    new Promise((res, rej) =>
      window.setTimeout(() => {
        if (offline) rej(new Error('lobby_unavailable'));
        else res(fakeRooms.filter((r) => !mode || r.mode === mode));
      }, 500),
    ),
};

function startLoading(): void {
  let p = 0;
  menu.showLoading(lang === 'ru' ? 'Фронт Тихо' : 'Tycho Front', 0);
  const iv = window.setInterval(() => {
    p += 0.07;
    menu.showLoading(lang === 'ru' ? 'Фронт Тихо' : 'Tycho Front', Math.min(1, p));
    if (p >= 1) {
      window.clearInterval(iv);
      if (screen !== 'loading') menu.hide();
    }
  }, 300);
}

// ---------------------------------------------------------------------------
// HUD fake state

let hud: Hud | null = null;

function fakeMinimap(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3c4252';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 60; i++) {
    const x = (i * 97) % 512;
    const y = (i * 181) % 512;
    g.fillStyle = `rgba(20,24,34,${0.15 + (i % 5) * 0.05})`;
    g.beginPath();
    g.arc(x, y, 8 + (i % 7) * 5, 0, Math.PI * 2);
    g.fill();
  }
  // pit
  for (let r = 110; r > 10; r -= 18) {
    g.fillStyle = `rgb(${40 + r * 0.2},${44 + r * 0.2},${56 + r * 0.2})`;
    g.beginPath();
    g.ellipse(256, 256, r, r * 0.8, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#7ff0ff';
  for (let i = 0; i < 14; i++) g.fillRect(210 + ((i * 37) % 90), 220 + ((i * 53) % 70), 4, 4);
  // bases
  g.fillStyle = '#2f5fae';
  g.fillRect(24, 200, 70, 112);
  g.fillStyle = '#b8541d';
  g.fillRect(418, 200, 70, 112);
  g.strokeStyle = '#9aa3b5';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(94, 256);
  g.lineTo(418, 256);
  g.stroke();
  g.fillStyle = '#6b7385';
  g.fillRect(140, 120, 40, 30);
  g.fillRect(330, 360, 50, 40);
  return c;
}

function fakeHudState(t: number): HudState {
  const v = hudVariant;
  const ffa = v === 'ffa';
  const mode: ModeId = ffa ? 'ffa' : 'war4v4';
  const hero: HeroId = v === 'rail' ? 'needle' : v === 'nuke' ? 'lunatic' : v === 'designator' ? 'reactor' : v === 'cloak' ? 'phantom' : v === 'invuln' ? 'helios' : v === 'forge' ? 'forge' : v === 'blade' ? 'blade' : v === 'hive' ? 'hive' : 'condor';
  const hd = HEROES[hero];
  const breach = v === 'breach' || v === 'suffocate';
  const suff = v === 'suffocate';
  const heading = 0.6 + Math.sin(t * 0.3) * 0.8;
  const blips: Blip[] = [
    { x: -30, z: -12, kind: 'ally', rot: 0.4, team: 0 },
    { x: -18, z: 22, kind: 'ally', rot: 2.2, team: 0 },
    { x: 34, z: -20, kind: 'enemy', rot: 3.5, team: 1 },
    { x: 20, z: 40, kind: 'spotted', team: 1, height: 8 },
    { x: -80, z: 0, kind: 'cp', label: 'A', team: 0 },
    { x: 0, z: 10, kind: 'cp', label: 'B', team: -1 },
    { x: 85, z: -5, kind: 'cp', label: 'C', team: 1 },
    { x: 26, z: -46, kind: 'pod' },
    { x: -10, z: -30, kind: 'pickup' },
    { x: 40, z: 60, kind: 'sensor' },
  ];
  if (v === 'nuke') blips.push({ x: 12, z: -30, kind: 'nuke' });
  const W = innerWidth;
  const H = innerHeight;
  const s: HudState = {
    visible: true,
    alive: v !== 'dead' && v !== 'env',
    health: suff ? 34 : breach ? 58 : 76 + Math.sin(t) * 4,
    suit: suff ? 8 : breach ? 31 : 88,
    oxygen: suff ? 3 : breach ? 38 + Math.sin(t * 0.5) * 6 : 100,
    breached: breach,
    leakRate: breach ? (suff ? 4.8 : 2.4) : 0,
    suffocating: suff,
    jetFuel: 0.5 + Math.sin(t * 0.8) * 0.45,
    jetting: Math.sin(t * 0.8) < -0.2,
    mag: v === 'cloak' ? 'attached' : 'on',
    magDisabled: v === 'invuln' ? 3.4 : 0,
    onWall: v === 'cloak',
    hero,
    abilities: [
      { key: 'ability1', id: hd.ability1.id, cooldown: Math.max(0, hd.ability1.cooldown * ((Math.sin(t * 0.6) + 1) / 2)), charges: hd.ability1.charges > 1 ? 1 : 1, maxCharges: hd.ability1.charges, active: false },
      { key: 'ability2', id: hd.ability2.id, cooldown: 0, charges: 1, maxCharges: 1, active: v === 'cloak' },
    ],
    ult: { id: hd.ultimate.id, charge: v === 'combat' ? 0.64 : 1, ready: v !== 'combat', active: v === 'invuln' },
    weaponId: v === 'nuke' ? 'nuke' : v === 'designator' ? 'helios' : hd.weapon,
    ammo: v === 'nuke' ? 1 : v === 'rail' ? 4 : 24 - Math.floor((t * 4) % 20),
    magSize: v === 'nuke' ? 1 : v === 'rail' ? 5 : 36,
    reserve: v === 'nuke' ? 0 : 216,
    reload: v === 'breach' ? (t * 0.5) % 1 : -1,
    charge: v === 'rail' ? (t * 0.45) % 1.2 > 1 ? 1 : (t * 0.45) % 1.2 : 0,
    slots: [
      { key: '1', id: hd.weapon, ammo: 24, active: v !== 'nuke' && v !== 'designator' },
      { key: '2', id: v === 'nuke' ? 'nuke' : v === 'designator' ? 'helios' : 'singularity', ammo: 1, active: v === 'nuke' || v === 'designator' },
    ],
    superWeapon: v === 'nuke' ? { id: 'nuke', ammo: 1 } : v === 'designator' ? { id: 'helios', ammo: 2 } : v === 'combat' ? { id: 'singularity', ammo: 2 } : null,
    sealants: breach ? 1 : 2,
    sealing: v === 'breach' ? (t * 0.4) % 1 : -1,
    ads: v === 'rail' || v === 'nuke' || v === 'designator' ? 1 : 0,
    scope: v === 'rail' ? 'rail' : v === 'nuke' ? 'nuke' : v === 'designator' ? 'designator' : 'none',
    cloaked: v === 'cloak',
    invulnerable: v === 'invuln',
    grapple: { cooldown: v === 'combat' ? Math.max(0, 5 - (t % 8)) : 0, ready: v === 'combat' ? 5 - (t % 8) <= 0 : true, active: false },
    stance: v === 'combat' ? (Math.floor(t / 3) % 3 === 1 ? 'slide' : 'stand') : v === 'rail' ? 'prone' : 'stand',
    summons: v === 'forge' ? [{ kind: 'servitor', hp: 0.9 }, { kind: 'servitor', hp: 0.25 }, { kind: 'turret', hp: 0.7 }] : v === 'hive' ? [{ kind: 'drone', hp: 0.8 }] : [],
    forceField: v === 'forge' || v === 'invuln' ? 0.7 : 0,
    spread: 6 + Math.max(0, Math.sin(t * 3)) * 10,
    hitmarker: Math.max(0, 1 - ((t * 1.3) % 1.6)),
    hitHead: Math.floor(t * 1.3 / 1.6) % 3 === 1,
    hitKill: Math.floor(t * 1.3 / 1.6) % 3 === 2,
    heading,
    pitch: 0,
    pos: { x: 0, y: 0, z: 0 },
    mapId: ffa ? 'quarry' : 'front',
    blips,
    markers: [
      { x: W * 0.36, y: H * 0.47, kind: 'ally', label: 'TychoFox', health: 0.8, onScreen: true, dist: 18 },
      { x: W * 0.62, y: H * 0.44, kind: 'enemy', label: 'KeplerRaven', dist: 42, health: 0.45, onScreen: true },
      { x: W * 0.72, y: H * 0.36, kind: 'pod', label: lang === 'ru' ? 'Снабжение' : 'Supply', dist: 64, onScreen: true },
      { x: W - 40, y: H * 0.55, kind: 'enemy', dist: 30, onScreen: false, angle: Math.PI / 2 },
      { x: 60, y: H * 0.3, kind: 'ally', label: 'Selene-12', dist: 70, onScreen: false, angle: -Math.PI / 2 },
      { x: W * 0.43, y: H * 0.62, kind: 'turret', team: 0, health: 0.7, onScreen: true, dist: 9 },
      { x: W * 0.57, y: H * 0.33, kind: 'drone', team: 1, health: 0.5, onScreen: true, dist: 33 },
      { x: W * 0.3, y: H * 0.56, kind: 'servitor', team: 0, health: 0.9, onScreen: true, dist: 14 },
      { x: W * 0.66, y: H * 0.56, kind: 'mine', team: 1, onScreen: true, dist: 21 },
      ...(v === 'nuke' ? [{ x: W * 0.55, y: H * 0.62, kind: 'nuke' as const, label: lang === 'ru' ? 'ЯДЕРНЫЙ УДАР' : 'NUKE', dist: 38, onScreen: true }] : []),
    ],
    damageDirs: v === 'combat' || v === 'breach' ? [{ angle: 2.4, alpha: 0.5 + Math.sin(t * 4) * 0.4 }, { angle: -1.1, alpha: 0.6 }] : [],
    outOfBounds: v === 'oob' ? 7.3 - (t % 7) : 0,
    interact: v === 'combat' ? 'interact.pod' : null,
    mode,
    teams: !ffa,
    localTeam: 0,
    timeLeft: 431 - t,
    scoreLimit: ffa ? 25 : 600,
    teamScores: ffa ? [18, 21] : [412 + Math.floor(t * 2), 377],
    ffaRank: 2,
    controlPoints: ffa
      ? []
      : [
          { id: 'A', owner: 0, progress: 0, contested: false, inside: false, screen: { x: W * 0.22, y: H * 0.4, visible: true, dist: 85 } },
          { id: 'B', owner: -1, progress: -((t * 0.15) % 1), contested: false, inside: true, screen: { x: W * 0.5, y: H * 0.58, visible: true, dist: 12 } },
          { id: 'C', owner: 1, progress: 0.35, contested: true, inside: false, screen: { x: W * 0.8, y: H * 0.42, visible: true, dist: 96 } },
        ],
    respawnIn: v === 'dead' || v === 'env' ? Math.max(0, 6 - (t % 7)) : 0,
    killer:
      v === 'dead'
        ? { name: 'KeplerRaven', hero: 'needle', weapon: 'rail', distance: 187, health: 0.42, team: 1 }
        : v === 'env'
          ? { name: 'KeplerRaven', hero: 'needle', weapon: 'suffocation', distance: 0, health: 1, team: 1 }
          : null,
    heroSelect: v === 'dead',
    ping: 38,
    fps: 144,
    spectating: null,
  };
  return s;
}

function startHud(withScoreboard: boolean): void {
  bg.innerHTML = mapArtSvg(hudVariant === 'ffa' ? 'quarry' : 'front');
  bg.style.filter = 'saturate(0.9) brightness(0.95)';
  settings = { ...settings, showFps: true };
  hud = new Hud(hudRoot, settings);
  hud.setMinimap(hudVariant === 'ffa' ? 'quarry' : 'front', fakeMinimap(), { minX: -128, maxX: 128, minZ: -128, maxZ: 128 });
  let t = 0;
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    hud!.update(fakeHudState(t), dt);
    if (withScoreboard) hud!.setScoreboard(fakeRows(hudVariant === 'ffa' ? 'ffa' : 'war4v4'), { mode: hudVariant === 'ffa' ? 'ffa' : 'war4v4', teamScores: [412, 377], timeLeft: 431 - t, localTeam: 0, mapId: 'front' });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const ru = lang === 'ru';
  const delay = Number(q.get('evdelay') ?? 2600);
  const kills = () => {
    hud!.event({ type: 'kill', killer: 'Regolith-47', killerHero: 'condor', killerTeam: 0, victim: 'KeplerRaven', victimHero: 'needle', victimTeam: 1, weapon: 'pulse', headshot: true, wall: false, local: 'killer' });
    hud!.event({ type: 'kill', killer: 'MareCobra', killerHero: 'lunatic', killerTeam: 1, victim: 'TychoFox', victimHero: 'reactor', victimTeam: 0, weapon: 'tacnuke', headshot: false, wall: false, local: 'none' });
    hud!.event({ type: 'kill', killer: 'Selene-12', killerHero: 'phantom', killerTeam: 0, victim: 'Basalt-88', victimHero: 'helios', victimTeam: 1, weapon: 'twinarc', headshot: false, wall: true, local: 'assist' });
    hud!.event({ type: 'kill', killer: 'NovaKite', killerHero: 'reactor', killerTeam: 1, victim: 'NovaKite', victimHero: 'reactor', victimTeam: 1, weapon: 'suffocation', headshot: false, wall: false, local: 'none' });
    hud!.event({ type: 'xp', amount: 100, label: ru ? 'Устранение' : 'Elimination' });
    hud!.event({ type: 'xp', amount: 50, label: ru ? 'В голову' : 'Headshot' });
    hud!.event({ type: 'xp', amount: 25, label: ru ? 'Со стены' : 'Wall-walker' });
  };
  window.setTimeout(kills, delay - 800);
  window.setTimeout(() => hud!.event({ type: 'big', title: hudVariant === 'nuke' ? (ru ? 'Ядерный удар!' : 'Nuclear strike!') : ru ? 'Сброс снабжения' : 'Supply drop', sub: hudVariant === 'nuke' ? (ru ? 'Немедленно в укрытие' : 'Take cover now') : ru ? 'Капсула падает у точки C' : 'Pod incoming near point C', kind: hudVariant === 'nuke' ? 'bad' : 'warn' }), delay);
  window.setTimeout(() => hud!.event({ type: 'ribbon', id: 'multikill' }), delay + 200);
  window.setTimeout(() => hud!.event({ type: 'toast', text: ru ? 'Союзник отметил врага' : 'Ally pinged an enemy', kind: 'info' }), 350);
  window.setTimeout(() => hud!.event({ type: 'chat', from: 'TychoFox', team: 0, text: ru ? 'Держу точку B, нужна поддержка!' : 'Holding B, need support!' }), 250);
  window.setTimeout(() => hud!.event({ type: 'chat', from: 'MareCobra', team: 1, text: 'gg' }), 260);
  const dmg = () => {
    hud!.event({ type: 'damage', amount: 18 + Math.round(Math.random() * 20), x: innerWidth * 0.62, y: innerHeight * 0.42, head: Math.random() < 0.3 });
  };
  window.setInterval(dmg, 380);
  window.setInterval(kills, 7000);
  window.setTimeout(() => hud!.event({ type: 'ultReady' }), delay);
  (window as unknown as Record<string, unknown>).__hud = hud;
  (window as unknown as Record<string, unknown>).__fakeHud = fakeHudState;
}

// ---------------------------------------------------------------------------
// boot

function boot(): void {
  const menuScreens = ['main', 'play', 'heroes', 'profile', 'settings', 'credits', 'matchmaking'];
  if (menuScreens.includes(screen)) bg.innerHTML = menuBackdropSvg();
  else if (screen === 'heroselect' || screen === 'pause' || screen === 'end') {
    bg.innerHTML = mapArtSvg('front');
  }

  menu = new MenuSystem(uiRoot, cb, settings, profile);
  (window as unknown as Record<string, unknown>).__menu = menu;
  menu.setNetStatus({ lobby: !offline });
  const st = (menu as unknown as { state: Record<string, unknown> }).state;
  const tab = q.get('tab');

  switch (screen) {
    case 'main':
      menu.showMain();
      break;
    case 'play':
    case 'heroes':
    case 'profile':
    case 'settings':
    case 'credits': {
      if (tab) {
        if (screen === 'play') st.playTab = tab;
        if (screen === 'profile') st.profileTab = tab;
        if (screen === 'settings') st.settingsTab = tab;
      }
      if (screen === 'heroes' && q.get('hero')) st.heroesSel = q.get('hero');
      menu.showMain();
      (menu as unknown as { go(id: string): void }).go(screen);
      break;
    }
    case 'loading':
      startLoading();
      break;
    case 'matchmaking':
      menu.showMatchmaking(lang === 'ru' ? 'Ищем комнату · 3 игрока в очереди' : 'Looking for a room · 3 players queued', () => menu.showMain());
      break;
    case 'heroselect': {
      let tl = 18;
      const opts = () => ({
        mode: 'war4v4' as ModeId,
        team: 0,
        allies: [
          { name: 'Regolith-47', hero: 'condor' as HeroId, isBot: false },
          { name: 'TychoFox', hero: 'reactor' as HeroId, isBot: false },
          { name: 'Selene-12', hero: 'phantom' as HeroId, isBot: false },
          { name: 'Bot Kepler', hero: 'forge' as HeroId, isBot: true },
        ],
        current: 'condor' as HeroId,
        timeLeft: tl,
        canClose: true,
      });
      menu.showHeroSelect(opts());
      window.setInterval(() => {
        tl = Math.max(0, tl - 1);
        if (menu.screen === 'heroselect') menu.showHeroSelect(opts());
      }, 1000);
      break;
    }
    case 'pause':
      menu.showPause({ mode: 'war4v4', roomLink: location.origin + '/#join=Ab3dE9xQ', isHost: true, players: 5, capacity: 8 });
      break;
    case 'end': {
      const r = fakeResult(q.get('result') ?? 'victory');
      menu.showEndOfMatch(r.result, r.before, r.after, () => menu.showMain());
      break;
    }
    case 'hud':
      startHud(false);
      break;
    case 'scoreboard':
      startHud(true);
      break;
  }

  if (!clean) {
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:1000;display:flex;gap:6px;padding:6px 8px;background:rgba(0,0,0,.6);border-radius:6px;font:12px sans-serif;color:#fff;align-items:center';
    const mk = (name: string, opts: string[], cur: string) => {
      const s = document.createElement('select');
      for (const o of opts) {
        const op = document.createElement('option');
        op.value = o;
        op.textContent = o;
        if (o === cur) op.selected = true;
        s.appendChild(op);
      }
      s.onchange = () => {
        q.set(name, s.value);
        location.search = q.toString();
      };
      bar.append(name + ':', s);
    };
    mk('screen', ['main', 'play', 'heroes', 'profile', 'settings', 'credits', 'loading', 'matchmaking', 'heroselect', 'pause', 'end', 'hud', 'scoreboard'], screen);
    mk('lang', ['ru', 'en'], lang);
    if (screen === 'hud' || screen === 'scoreboard') mk('hud', ['combat', 'breach', 'suffocate', 'dead', 'env', 'rail', 'nuke', 'designator', 'ffa', 'cloak', 'invuln', 'oob', 'forge', 'blade', 'hive'], hudVariant);
    if (screen === 'end') mk('result', ['victory', 'defeat', 'draw', 'ffa'], q.get('result') ?? 'victory');
    document.body.appendChild(bar);
  }
}

boot();
