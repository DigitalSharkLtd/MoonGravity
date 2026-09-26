/**
 * Shared contracts between the game simulation, the UI shell (menus / HUD) and persistence.
 * Keep this file dependency-free (types + small constant tables only).
 */

export type ModeId = 'duel2v2' | 'ffa' | 'war4v4';
export type MapId = 'duel' | 'quarry' | 'front';
export type WeaponId = 'pulse' | 'rail' | 'plasma' | 'glauncher' | 'sealer' | 'twinarc' | 'blade' | 'riveter' | 'burst' | 'nuke' | 'singularity' | 'helios';
export type HeroId = 'condor' | 'needle' | 'reactor' | 'helios' | 'lunatic' | 'phantom' | 'blade' | 'forge' | 'hive';
/** classic hero-shooter roles: ranged/melee DPS, scouts-rogues, tanks, supports and engineers ("tech-priests") */
export type Role = 'ranged' | 'melee' | 'scout' | 'tank' | 'support' | 'engineer';
export type AbilityId =
  | 'dash' // Condor: jet dash
  | 'frag' // Condor: frag grenade
  | 'swarm' // Condor ult: micro-missile swarm
  | 'decoy' // Needle: holographic decoy that draws fire and fakes a radar blip
  | 'sensor' // Needle: motion sensor (reveals enemies)
  | 'overcharge' // Needle ult: instant charge, shots pierce walls
  | 'dome' // Reactor: deployable shield dome
  | 'slam' // Reactor: magnetic ground slam
  | 'blackhole' // Reactor ult: singularity orb
  | 'o2burst' // Helios: AoE heal + oxygen refill + suit patch
  | 'medstation' // Helios: deployable healing/oxygen station
  | 'lifebubble' // Helios ult: team invulnerability air bubble
  | 'rocketjump' // Lunatic: concussion self-boost
  | 'mine' // Lunatic: proximity mine
  | 'tacnuke' // Lunatic ult: tactical nuclear rocket
  | 'blink' // Phantom: short teleport
  | 'cloak' // Phantom: invisibility
  | 'empnova' // Phantom ult: EMP nova (kills mag-boots/jetpacks/abilities)
  | 'lunge' // Blade: dash strike
  | 'deflect' // Blade: reflect projectiles / block hitscan
  | 'moonblade' // Blade ult: energy blade waves
  | 'servitor' // Forge: summon a humanoid combat bot
  | 'turret' // Forge: deploy an auto-turret
  | 'forcefield' // Forge ult: force-field modules on nearby allies (absorb a rocket)
  | 'barricade' // deployable cover wall (build option)
  | 'huntdrone' // Hive: armed hunter drone
  | 'spotdrone' // Hive: spotter drone that marks enemies
  | 'kamikaze' // Hive ult: swarm of kamikaze drones
  | 'grapple'; // universal gadget: grappling hook with air brakes
export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type BotDifficulty = 'easy' | 'normal' | 'hard' | 'veteran';
export type Lang = 'ru' | 'en';

// ---------------------------------------------------------------------------
// modes & maps (display data)

export interface ModeInfo {
  id: ModeId;
  map: MapId;
  /** max humans in one listen-server room */
  capacity: number;
  /** total fighters (humans + bots) */
  slots: number;
  teams: boolean;
  scoreLimit: number;
  timeLimit: number; // seconds
}

export const MODES: Record<ModeId, ModeInfo> = {
  duel2v2: { id: 'duel2v2', map: 'duel', capacity: 4, slots: 4, teams: true, scoreLimit: 15, timeLimit: 8 * 60 },
  ffa: { id: 'ffa', map: 'quarry', capacity: 8, slots: 8, teams: false, scoreLimit: 25, timeLimit: 10 * 60 },
  war4v4: { id: 'war4v4', map: 'front', capacity: 8, slots: 8, teams: true, scoreLimit: 600, timeLimit: 15 * 60 },
};

// ---------------------------------------------------------------------------
// input actions & key bindings (KeyboardEvent.code; mouse buttons as 'Mouse0'/'Mouse1'/'Mouse2')

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'fire'
  | 'aim'
  | 'reload'
  | 'ability1'
  | 'ability2'
  | 'ultimate'
  | 'weapon1'
  | 'weapon2'
  | 'sealant'
  | 'mag'
  | 'ping'
  | 'interact'
  | 'grapple'
  | 'melee'
  | 'prone'
  | 'roll'
  | 'view'
  | 'scoreboard'
  | 'map'
  | 'chat';

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  crouch: 'ControlLeft',
  fire: 'Mouse0',
  aim: 'Mouse2',
  reload: 'KeyR',
  ability1: 'ShiftLeft',
  ability2: 'KeyE',
  ultimate: 'KeyQ',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  sealant: 'KeyH',
  mag: 'KeyF',
  ping: 'Mouse1',
  interact: 'KeyX',
  grapple: 'KeyG',
  melee: 'KeyV',
  prone: 'KeyZ',
  roll: 'KeyC',
  view: 'KeyB',
  scoreboard: 'Tab',
  map: 'KeyM',
  chat: 'KeyT',
};

// ---------------------------------------------------------------------------
// settings (persisted in localStorage by the UI layer)

export interface CrosshairSettings {
  style: 'cross' | 'dot' | 'circle' | 'chevron';
  color: string; // css color
  size: number; // 0.5..2
  opacity: number; // 0..1
}

export interface Settings {
  version: 1;
  playerName: string;
  language: Lang;
  // graphics
  quality: Quality;
  renderScale: number; // 0.5..1.5
  fov: number; // 60..110 (horizontal-ish, applied as vertical by the game)
  outlines: boolean; // stylised ink outlines
  ambientOcclusion: boolean;
  bloom: boolean;
  shadows: 'off' | 'low' | 'high';
  filmGrain: boolean;
  motionBlur: boolean;
  showFps: boolean;
  /** heavy: SMAA post anti-aliasing */
  antialias: boolean;
  /** medium: sun lens flare & glare */
  lensFlare: boolean;
  /** medium: particle density */
  particles: 'low' | 'medium' | 'high';
  /** heavy: procedural texture resolution */
  textureQuality: 'low' | 'medium' | 'high';
  /** medium: close-range terrain micro detail (micro craters, pebbles) */
  terrainDetail: boolean;
  /** heavy: image-based reflections on metals/visors */
  reflections: boolean;
  // audio
  masterVolume: number; // 0..1
  sfxVolume: number;
  musicVolume: number;
  uiVolume: number;
  // controls
  sensitivity: number; // 0.1..5 (1 = default)
  adsSensitivity: number; // multiplier 0.2..1.5
  invertY: boolean;
  toggleAim: boolean;
  toggleCrouch: boolean;
  keys: Record<Action, string>;
  // gameplay / HUD
  botDifficulty: BotDifficulty;
  crosshair: CrosshairSettings;
  hudScale: number; // 0.75..1.25
  hitMarkers: boolean;
  damageNumbers: boolean;
  minimapRotate: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  playerName: '',
  language: 'ru',
  quality: 'high',
  renderScale: 1,
  fov: 80,
  outlines: true,
  ambientOcclusion: true,
  bloom: true,
  shadows: 'high',
  filmGrain: true,
  motionBlur: false,
  showFps: false,
  antialias: true,
  lensFlare: true,
  particles: 'high',
  textureQuality: 'medium',
  terrainDetail: true,
  reflections: true,
  masterVolume: 0.8,
  sfxVolume: 1,
  musicVolume: 0.5,
  uiVolume: 0.7,
  sensitivity: 1,
  adsSensitivity: 0.7,
  invertY: false,
  toggleAim: false,
  toggleCrouch: false,
  keys: { ...DEFAULT_KEYS },
  botDifficulty: 'normal',
  crosshair: { style: 'cross', color: '#7ff0ff', size: 1, opacity: 0.9 },
  hudScale: 1,
  hitMarkers: true,
  damageNumbers: true,
  minimapRotate: true,
};

// ---------------------------------------------------------------------------
// heroes

export interface AbilityDef {
  id: AbilityId;
  cooldown: number; // seconds (ults: 0)
  charges: number; // 1 for most
  duration: number; // active duration (0 = instant)
}

/** Build (talent path) modifiers, applied at spawn. Multipliers default to 1. */
export interface BuildMods {
  damage?: number;
  fireRate?: number;
  mag?: number;
  health?: number;
  suit?: number;
  speed?: number;
  jet?: number;
  cd1?: number; // ability1 cooldown multiplier
  cd2?: number;
  ultCost?: number;
  charges1?: number; // extra ability1 charges
  charges2?: number;
  /** special behaviour flags interpreted by the ability code */
  flags?: string[];
  /** replace an ability with another */
  swap1?: AbilityId;
  swap2?: AbilityId;
}

export interface BuildDef {
  id: string;
  name: { ru: string; en: string };
  desc: { ru: string; en: string };
  unlock: number; // hero level required
  mods: BuildMods;
}

export interface HeroDef {
  id: HeroId;
  role: Role;
  health: number;
  suit: number; // suit integrity pool (armor); < 50% → depressurization
  speed: number; // walk speed m/s (no sprint — OW style)
  weapon: WeaponId;
  ability1: AbilityDef; // Shift
  ability2: AbilityDef; // E
  ultimate: AbilityDef; // Q
  ultCost: number; // ult points (1 point per damage/heal dealt, + passive)
  sealants: number; // suit patch kits (H)
  color: string; // accent colour (css)
  visor: string; // visor tint (css)
  difficulty: 1 | 2 | 3;
  builds: BuildDef[]; // 2–3 talent paths
}

const ab = (id: AbilityId, cooldown: number, duration = 0, charges = 1): AbilityDef => ({ id, cooldown, duration, charges });
const B = (id: string, ru: string, en: string, dru: string, den: string, unlock: number, mods: BuildMods): BuildDef => ({ id, name: { ru, en }, desc: { ru: dru, en: den }, unlock, mods });

export const HEROES: Record<HeroId, HeroDef> = {
  condor: {
    id: 'condor', role: 'ranged', health: 200, suit: 100, speed: 5.4, weapon: 'pulse', ability1: ab('dash', 6), ability2: ab('frag', 9), ultimate: ab('swarm', 0, 2.2), ultCost: 1800, sealants: 2, color: '#ff5a4d', visor: '#ffb347', difficulty: 1,
    builds: [
      B('assault', 'Штурмовик', 'Assault', 'Стандартная выучка: сбалансированный урон и мобильность.', 'Standard training: balanced damage and mobility.', 1, {}),
      B('grenadier', 'Гренадёр', 'Grenadier', 'Осколочная граната распадается на кассетные заряды, перезарядка E −20%.', 'Frag splits into cluster bomblets, E cooldown −20%.', 3, { cd2: 0.8, flags: ['cluster'] }),
      B('skirmisher', 'Налётчик', 'Skirmisher', 'Два заряда рывка, +10% скорости, −15% здоровья.', 'Two dash charges, +10% speed, −15% health.', 6, { charges1: 1, speed: 1.1, health: 0.85 }),
    ],
  },
  lunatic: {
    id: 'lunatic', role: 'ranged', health: 200, suit: 100, speed: 5.3, weapon: 'glauncher', ability1: ab('rocketjump', 7), ability2: ab('mine', 10), ultimate: ab('tacnuke', 0, 0), ultCost: 2300, sealants: 2, color: '#ff8a1f', visor: '#ffe066', difficulty: 2,
    builds: [
      B('demolition', 'Подрывник', 'Demolition', 'Больше гранат в барабане, быстрее перезарядка.', 'Bigger drum, faster reload.', 1, { mag: 1.34 }),
      B('minelayer', 'Минёр', 'Minelayer', 'Две мины одновременно, мины оглушают ЭМИ.', 'Two mines at once, mines also EMP.', 3, { charges2: 1, flags: ['empMine'] }),
      B('bouncer', 'Попрыгун', 'Bouncer', 'Ракетный прыжок: 2 заряда и урон по приземлению.', 'Rocket jump: 2 charges and a landing blast.', 6, { charges1: 1, flags: ['landBlast'] }),
    ],
  },
  needle: {
    id: 'needle', role: 'scout', health: 175, suit: 75, speed: 5.3, weapon: 'rail', ability1: ab('decoy', 12, 8), ability2: ab('sensor', 14, 12), ultimate: ab('overcharge', 0, 7), ultCost: 1700, sealants: 2, color: '#4db8ff', visor: '#7ff0ff', difficulty: 3,
    builds: [
      B('marksman', 'Стрелок', 'Marksman', 'Быстрее заряд рельсотрона при прицеливании.', 'Faster railgun charge while scoped.', 1, { fireRate: 1.15 }),
      B('recon', 'Разведчик', 'Recon', 'Сенсор дольше и шире, подсвечивает врагов всей команде.', 'Sensor lasts longer and wider, reveals for the team.', 3, { cd2: 0.75, flags: ['wideSensor'] }),
      B('ghost', 'Призрак', 'Ghost', 'Приманка становится вашей копией, вы невидимы 2 с.', 'Decoy mimics you and you go invisible for 2 s.', 6, { flags: ['decoyCloak'] }),
    ],
  },
  phantom: {
    id: 'phantom', role: 'scout', health: 175, suit: 75, speed: 5.8, weapon: 'twinarc', ability1: ab('blink', 5, 0, 2), ability2: ab('cloak', 12, 5), ultimate: ab('empnova', 0, 0), ultCost: 1900, sealants: 2, color: '#b06cff', visor: '#d9a8ff', difficulty: 3,
    builds: [
      B('infiltrator', 'Лазутчик', 'Infiltrator', 'Невидимость дольше, первый выстрел из инвиза +50% урона.', 'Longer cloak, first shot from cloak +50% damage.', 1, { flags: ['ambush'] }),
      B('stormer', 'Шторм', 'Storm', '3 заряда блинка, −10% урона.', '3 blink charges, −10% damage.', 3, { charges1: 1, damage: 0.9 }),
      B('saboteur', 'Диверсант', 'Saboteur', 'ЭМИ-волна дешевле и шире.', 'EMP nova cheaper and wider.', 6, { ultCost: 0.8, flags: ['wideEmp'] }),
    ],
  },
  blade: {
    id: 'blade', role: 'melee', health: 225, suit: 100, speed: 5.9, weapon: 'blade', ability1: ab('lunge', 6), ability2: ab('deflect', 9, 1.8), ultimate: ab('moonblade', 0, 6), ultCost: 1900, sealants: 2, color: '#39e3a8', visor: '#b8ffe6', difficulty: 2,
    builds: [
      B('duelist', 'Дуэлянт', 'Duelist', 'Удары быстрее, выпад сбрасывается при убийстве.', 'Faster swings, lunge resets on kill.', 1, { fireRate: 1.1, flags: ['lungeReset'] }),
      B('guardian', 'Страж', 'Guardian', 'Отражение дольше и лечит вас.', 'Longer deflect that heals you.', 3, { cd2: 0.85, flags: ['deflectHeal'] }),
      B('berserker', 'Берсерк', 'Berserker', '+20% урона, −20% здоровья, вампиризм.', '+20% damage, −20% health, lifesteal.', 6, { damage: 1.2, health: 0.8, flags: ['lifesteal'] }),
    ],
  },
  reactor: {
    id: 'reactor', role: 'tank', health: 300, suit: 200, speed: 5.0, weapon: 'plasma', ability1: ab('dome', 12, 8), ability2: ab('slam', 8), ultimate: ab('blackhole', 0, 4), ultCost: 2100, sealants: 2, color: '#ffc21a', visor: '#ffd36b', difficulty: 2,
    builds: [
      B('bulwark', 'Бастион', 'Bulwark', 'Купол прочнее и больше.', 'Tougher, larger dome.', 1, { flags: ['bigDome'] }),
      B('juggernaut', 'Джаггернаут', 'Juggernaut', '+15% здоровья, удар отбрасывает сильнее.', '+15% health, stronger slam knockback.', 3, { health: 1.15, flags: ['heavySlam'] }),
      B('breacher', 'Штурмовик щитов', 'Breacher', 'Вместо купола — переносная баррикада, быстрее перезарядка.', 'Deployable barricade instead of dome, faster cooldown.', 6, { swap1: 'barricade', cd1: 0.6 }),
    ],
  },
  helios: {
    id: 'helios', role: 'support', health: 200, suit: 75, speed: 5.4, weapon: 'sealer', ability1: ab('o2burst', 10), ability2: ab('medstation', 16, 10), ultimate: ab('lifebubble', 0, 5), ultCost: 2000, sealants: 4, color: '#5fe36a', visor: '#9dffb0', difficulty: 1,
    builds: [
      B('medic', 'Медик', 'Medic', 'Сильнее лечение пеной.', 'Stronger foam healing.', 1, { damage: 1.2 }),
      B('lifeline', 'Спасатель', 'Lifeline', 'Кислородный выброс восстанавливает скафандр полностью.', 'O2 burst fully repairs suits.', 3, { cd1: 0.85, flags: ['fullSeal'] }),
      B('warden', 'Хранитель', 'Warden', 'Мед-станция ставит силовое поле союзникам.', 'Med station grants allies a force field.', 6, { flags: ['stationField'] }),
    ],
  },
  forge: {
    id: 'forge', role: 'engineer', health: 225, suit: 125, speed: 5.1, weapon: 'riveter', ability1: ab('servitor', 14, 25, 2), ability2: ab('turret', 16, 30), ultimate: ab('forcefield', 0, 7), ultCost: 2100, sealants: 3, color: '#ff9f43', visor: '#ffd08a', difficulty: 2,
    builds: [
      B('mechanic', 'Механик', 'Mechanic', 'Турель стреляет быстрее, сервиторы прочнее.', 'Faster turret, tougher servitors.', 1, { flags: ['toughServitors'] }),
      B('fortifier', 'Фортификатор', 'Fortifier', 'Вместо сервиторов — заграждения-укрытия (2 заряда).', 'Barricades instead of servitors (2 charges).', 3, { swap1: 'barricade', cd1: 0.6 }),
      B('legion', 'Легион', 'Legion', '3 сервитора, но без турели: вместо неё дрон-охотник.', '3 servitors, hunter drone instead of turret.', 6, { charges1: 1, swap2: 'huntdrone' }),
    ],
  },
  hive: {
    id: 'hive', role: 'engineer', health: 200, suit: 100, speed: 5.3, weapon: 'burst', ability1: ab('huntdrone', 12, 12), ability2: ab('spotdrone', 14, 10), ultimate: ab('kamikaze', 0, 0), ultCost: 2000, sealants: 2, color: '#e6e14d', visor: '#fff59a', difficulty: 2,
    builds: [
      B('hunter', 'Охотник', 'Hunter', 'Дрон-охотник живёт дольше и наносит больше урона.', 'Hunter drone lasts longer and hits harder.', 1, { flags: ['strongHunter'] }),
      B('overseer', 'Надзиратель', 'Overseer', 'Дрон-наводчик подсвечивает сквозь стены и замедляет.', 'Spotter drone reveals through walls and slows.', 3, { flags: ['slowSpot'] }),
      B('swarm', 'Рой', 'Swarm', 'Ульта выпускает 8 камикадзе вместо 5.', 'Ultimate releases 8 kamikaze drones instead of 5.', 6, { flags: ['bigSwarm'], ultCost: 1.1 }),
    ],
  },
};

export const HERO_ORDER: HeroId[] = ['condor', 'lunatic', 'needle', 'phantom', 'blade', 'reactor', 'helios', 'forge', 'hive'];

/** hero mastery: XP needed per hero level (builds unlock at levels 1 / 3 / 6) */
export function heroLevelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = xp;
  const need = (n: number) => 1500 + n * 500;
  while (level < 20 && rest >= need(level)) {
    rest -= need(level);
    level++;
  }
  return { level, into: rest, need: need(level) };
}

// ---------------------------------------------------------------------------
// progression / profile (persisted in localStorage)

export type RibbonId =
  | 'ace' // most points in the match
  | 'killstreak5'
  | 'killstreak10'
  | 'headhunter' // 5 headshots
  | 'nuclear' // kill with the tactical nuke
  | 'ceiling' // kill while walking on a wall/ceiling
  | 'breach' // enemy died of suffocation after your damage
  | 'capture' // 3 captures
  | 'medic' // healed 1000 hp / patched 5 suits
  | 'ult' // 3 kills with one ultimate
  | 'survivor' // won with no deaths
  | 'multikill'; // 3 kills within 4 s

export interface WeaponStats {
  kills: number;
  headshots: number;
  shots: number;
  hits: number;
}

export interface MatchSummary {
  t: number; // Date.now()
  mode: ModeId;
  map: MapId;
  won: boolean | null; // null = draw
  placement: number; // 1-based (team modes: 1 = winner)
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  xp: number;
}

export interface ProfileStats {
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  timePlayed: number; // seconds
  captures: number;
  bestStreak: number;
  longestKill: number; // meters
  wallKills: number;
  suffocations: number;
  nukes: number;
  damageDealt: number;
}

export interface Profile {
  version: 1;
  name: string;
  xp: number; // total accumulated XP (level derived)
  stats: ProfileStats;
  weapons: Partial<Record<WeaponId, WeaponStats>>;
  heroes: Partial<Record<HeroId, { kills: number; deaths: number; time: number; matches: number; wins: number; damage: number; healing: number }>>;
  ribbons: Partial<Record<RibbonId, number>>;
  selectedHero: HeroId;
  /** hero mastery XP (optional for old saves) */
  heroXp?: Partial<Record<HeroId, number>>;
  /** chosen build id per hero */
  builds?: Partial<Record<HeroId, string>>;
  history: MatchSummary[]; // newest first, max 20
  createdAt: number;
}

/** XP needed to go from level n to n+1 */
export function xpForLevel(n: number): number {
  return Math.round(900 + n * 260 + n * n * 6);
}

export function levelFromXp(total: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = total;
  while (level < 150 && rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return { level, into: rest, need: xpForLevel(level) };
}

// ---------------------------------------------------------------------------
// end of round

export interface ScoreRow {
  id: number;
  name: string;
  team: number; // -1 in FFA
  hero: HeroId;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  damage: number;
  healing: number;
  ping: number; // ms, 0 for bots/local host
  isBot: boolean;
  isLocal: boolean;
  alive: boolean;
}

export interface MatchResult {
  mode: ModeId;
  map: MapId;
  duration: number; // seconds
  /** team modes: [team0, team1]; FFA: top score first */
  teamScores: number[];
  winnerTeam: number; // -1 draw / FFA
  localTeam: number;
  won: boolean | null;
  placement: number;
  rows: ScoreRow[];
  xp: { label: string; amount: number }[];
  ribbons: RibbonId[];
  levelBefore: number;
  xpBefore: number; // total xp before
  xpAfter: number;
  mvpId: number;
}

// ---------------------------------------------------------------------------
// HUD state (written by the game every frame, rendered by the UI layer)

export interface HudControlPoint {
  id: 'A' | 'B' | 'C';
  owner: number; // -1 neutral, 0/1 team
  progress: number; // -1..1 (negative = team 0 capturing, positive = team 1)
  contested: boolean;
  inside: boolean; // local player inside the zone
  screen?: { x: number; y: number; visible: boolean; dist: number }; // projected marker
}

export type BlipKind = 'self' | 'ally' | 'enemy' | 'spotted' | 'cp' | 'pod' | 'pickup' | 'nuke' | 'sensor' | 'beacon' | 'objective';

export interface Blip {
  x: number;
  z: number;
  kind: BlipKind;
  rot?: number; // yaw (radians) for arrows
  label?: string;
  team?: number;
  height?: number; // relative height (above/below) for arrows
}

export interface ScreenMarker {
  x: number; // px
  y: number;
  kind: 'ally' | 'enemy' | 'pod' | 'cp' | 'objective' | 'nuke' | 'squad' | 'turret' | 'shield' | 'station' | 'mine' | 'sensor' | 'drone' | 'servitor' | 'barricade' | 'strike' | 'decoy';
  team?: number;
  label?: string;
  dist?: number;
  health?: number; // 0..1 for players
  onScreen: boolean;
  angle?: number; // edge-arrow angle when off screen
}

export interface HudState {
  visible: boolean;
  alive: boolean;
  // vitals
  health: number; // 0..100
  suit: number; // 0..100 suit integrity (< 50 = breached)
  oxygen: number; // 0..100
  breached: boolean;
  leakRate: number; // % per second
  suffocating: boolean;
  jetFuel: number; // 0..1
  jetting: boolean;
  mag: 'off' | 'on' | 'attached';
  magDisabled: number; // seconds of EMP left (0 = fine)
  onWall: boolean; // walking on wall/ceiling
  // hero & abilities
  hero: HeroId;
  abilities: { key: 'ability1' | 'ability2'; id: AbilityId; cooldown: number; charges: number; maxCharges: number; active: boolean }[];
  ult: { id: AbilityId; charge: number; ready: boolean; active: boolean };
  // weapons
  weaponId: WeaponId;
  ammo: number;
  magSize: number;
  reserve: number;
  reload: number; // -1 not reloading, else 0..1 progress
  charge: number; // 0..1 (railgun)
  slots: { key: string; id: WeaponId | null; ammo: number; active: boolean }[];
  superWeapon: { id: WeaponId; ammo: number } | null; // picked up from a supply pod (slot 2)
  sealants: number;
  sealing: number; // -1 or 0..1 progress
  // aiming
  ads: number; // 0..1
  scope: 'none' | 'rail' | 'nuke' | 'designator';
  cloaked: boolean;
  invulnerable: boolean;
  /** universal gadgets / stance (optional for older HUDs) */
  grapple?: { cooldown: number; ready: boolean; active: boolean };
  stance?: 'stand' | 'crouch' | 'prone' | 'slide' | 'roll';
  summons?: { kind: 'servitor' | 'turret' | 'drone' | 'barricade'; hp: number }[];
  forceField?: number; // 0..1 extra shield on top of health
  spread: number; // crosshair gap in px at 1080p
  hitmarker: number; // 0..1 fade
  hitHead: boolean;
  hitKill: boolean;
  // world
  heading: number; // radians, 0 = north (-z), clockwise
  pitch: number;
  pos: { x: number; y: number; z: number };
  mapId: MapId;
  blips: Blip[];
  markers: ScreenMarker[];
  damageDirs: { angle: number; alpha: number }[]; // angle relative to view (0 = front)
  outOfBounds: number; // seconds left (0 = inside)
  interact: string | null; // prompt text key
  // match
  mode: ModeId;
  teams: boolean;
  localTeam: number;
  timeLeft: number;
  scoreLimit: number;
  teamScores: number[]; // team modes: [t0, t1]; FFA: [myScore, leaderScore]
  ffaRank: number;
  controlPoints: HudControlPoint[];
  // death / respawn
  respawnIn: number; // seconds until respawn available (when dead)
  killer: { name: string; hero: HeroId; weapon: WeaponId | AbilityId | 'suffocation' | 'fall' | 'self'; distance: number; health: number; team: number } | null;
  heroSelect: boolean; // dead & can switch hero before respawn
  // network
  ping: number;
  fps: number;
  spectating: string | null;
}

export type HudEvent =
  | { type: 'kill'; killer: string; killerHero: HeroId; killerTeam: number; victim: string; victimHero: HeroId; victimTeam: number; weapon: WeaponId | AbilityId | 'suffocation' | 'fall' | 'self'; headshot: boolean; wall: boolean; local: 'killer' | 'victim' | 'assist' | 'none' }
  | { type: 'ultReady' }
  | { type: 'xp'; amount: number; label: string } // "+100 ELIMINATION"
  | { type: 'ribbon'; id: RibbonId }
  | { type: 'toast'; text: string; kind: 'info' | 'warn' | 'good' | 'bad' }
  | { type: 'big'; title: string; sub?: string; kind?: 'info' | 'warn' | 'good' | 'bad' }
  | { type: 'damage'; amount: number; x: number; y: number; head: boolean } // floating damage number (screen px)
  | { type: 'capture'; id: 'A' | 'B' | 'C'; team: number; local: boolean }
  | { type: 'chat'; from: string; team: number; text: string };
