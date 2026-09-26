import {
  DEFAULT_KEYS,
  DEFAULT_SETTINGS,
  HEROES,
  heroLevelFromXp,
  type Action,
  type HeroId,
  type Lang,
  type MatchResult,
  type MatchSummary,
  type Profile,
  type ProfileStats,
  type RibbonId,
  type Settings,
  type WeaponId,
  type WeaponStats,
} from '../game/Types';

const SETTINGS_KEY = 'mg.settings';
const PROFILE_KEY = 'mg.profile';

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full / blocked (private mode) — ignore */
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, def: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], def: T): T => (typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : def);
const str = (v: unknown, def: string, max = 64): string => (typeof v === 'string' ? v.slice(0, max) : def);

// ---------------------------------------------------------------------------
// settings

/** defaults from older builds that moved to make room for new actions (e.g. ping G → grapple, view V → melee) */
const LEGACY_DEFAULT_KEYS: Partial<Record<Action, string>> = { ping: 'KeyG', view: 'KeyV' };

/**
 * Resolves key conflicts introduced by new default bindings: an action still on its old default
 * that now collides with another action's current default is moved to its own new default.
 */
function migrateKeys(keys: Record<Action, string>): void {
  const all = Object.keys(DEFAULT_KEYS) as Action[];
  for (const a of all) {
    const legacy = LEGACY_DEFAULT_KEYS[a];
    if (!legacy || keys[a] !== legacy || DEFAULT_KEYS[a] === legacy) continue;
    const clash = all.some((b) => b !== a && keys[b] === legacy);
    if (clash && !all.some((b) => b !== a && keys[b] === DEFAULT_KEYS[a])) keys[a] = DEFAULT_KEYS[a];
  }
}

/** Normalises any (possibly old / partial / corrupted) settings object into a valid Settings. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const s = isObj(raw) ? raw : {};
  const keysIn = isObj(s.keys) ? s.keys : {};
  const keys = { ...DEFAULT_KEYS } as Record<Action, string>;
  for (const a of Object.keys(DEFAULT_KEYS) as Action[]) {
    const v = keysIn[a];
    if (typeof v === 'string' && v.length > 0 && v.length < 32) keys[a] = v;
  }
  migrateKeys(keys);
  const ch = isObj(s.crosshair) ? s.crosshair : {};
  return {
    version: 1,
    playerName: str(s.playerName, d.playerName, 24),
    language: oneOf(s.language, ['ru', 'en'] as const, d.language),
    quality: oneOf(s.quality, ['low', 'medium', 'high', 'ultra'] as const, d.quality),
    renderScale: num(s.renderScale, d.renderScale, 0.5, 1.5),
    fov: num(s.fov, d.fov, 60, 110),
    outlines: bool(s.outlines, d.outlines),
    ambientOcclusion: bool(s.ambientOcclusion, d.ambientOcclusion),
    bloom: bool(s.bloom, d.bloom),
    shadows: oneOf(s.shadows, ['off', 'low', 'high'] as const, d.shadows),
    filmGrain: bool(s.filmGrain, d.filmGrain),
    motionBlur: bool(s.motionBlur, d.motionBlur),
    showFps: bool(s.showFps, d.showFps),
    antialias: bool(s.antialias, d.antialias),
    lensFlare: bool(s.lensFlare, d.lensFlare),
    particles: oneOf(s.particles, ['low', 'medium', 'high'] as const, d.particles),
    textureQuality: oneOf(s.textureQuality, ['low', 'medium', 'high'] as const, d.textureQuality),
    terrainDetail: bool(s.terrainDetail, d.terrainDetail),
    reflections: bool(s.reflections, d.reflections),
    masterVolume: num(s.masterVolume, d.masterVolume, 0, 1),
    sfxVolume: num(s.sfxVolume, d.sfxVolume, 0, 1),
    musicVolume: num(s.musicVolume, d.musicVolume, 0, 1),
    uiVolume: num(s.uiVolume, d.uiVolume, 0, 1),
    sensitivity: num(s.sensitivity, d.sensitivity, 0.1, 5),
    adsSensitivity: num(s.adsSensitivity, d.adsSensitivity, 0.2, 1.5),
    invertY: bool(s.invertY, d.invertY),
    toggleAim: bool(s.toggleAim, d.toggleAim),
    toggleCrouch: bool(s.toggleCrouch, d.toggleCrouch),
    keys,
    botDifficulty: oneOf(s.botDifficulty, ['easy', 'normal', 'hard', 'veteran'] as const, d.botDifficulty),
    crosshair: {
      style: oneOf(ch.style, ['cross', 'dot', 'circle', 'chevron'] as const, d.crosshair.style),
      color: typeof ch.color === 'string' && /^#[0-9a-fA-F]{3,8}$|^rgba?\(/.test(ch.color) ? ch.color : d.crosshair.color,
      size: num(ch.size, d.crosshair.size, 0.5, 2),
      opacity: num(ch.opacity, d.crosshair.opacity, 0, 1),
    },
    hudScale: num(s.hudScale, d.hudScale, 0.75, 1.25),
    hitMarkers: bool(s.hitMarkers, d.hitMarkers),
    damageNumbers: bool(s.damageNumbers, d.damageNumbers),
    minimapRotate: bool(s.minimapRotate, d.minimapRotate),
  };
}

export function loadSettings(): Settings {
  return sanitizeSettings(readJson(SETTINGS_KEY));
}

export function saveSettings(s: Settings): void {
  writeJson(SETTINGS_KEY, s);
}

export type PresetKeys =
  | 'renderScale'
  | 'ambientOcclusion'
  | 'bloom'
  | 'shadows'
  | 'outlines'
  | 'antialias'
  | 'lensFlare'
  | 'particles'
  | 'textureQuality'
  | 'terrainDetail'
  | 'reflections'
  | 'motionBlur'
  | 'filmGrain';

/** graphics sub-options implied by a quality preset (heavy / medium / light technologies) */
export function qualityPreset(q: Settings['quality']): Pick<Settings, PresetKeys> {
  switch (q) {
    case 'low':
      return { renderScale: 0.75, ambientOcclusion: false, shadows: 'off', antialias: false, textureQuality: 'low', reflections: false, bloom: false, lensFlare: false, particles: 'low', terrainDetail: false, motionBlur: false, outlines: true, filmGrain: false };
    case 'medium':
      return { renderScale: 0.9, ambientOcclusion: false, shadows: 'low', antialias: false, textureQuality: 'medium', reflections: false, bloom: true, lensFlare: false, particles: 'medium', terrainDetail: true, motionBlur: false, outlines: true, filmGrain: true };
    case 'high':
      return { renderScale: 1, ambientOcclusion: true, shadows: 'high', antialias: true, textureQuality: 'medium', reflections: true, bloom: true, lensFlare: true, particles: 'high', terrainDetail: true, motionBlur: false, outlines: true, filmGrain: true };
    case 'ultra':
    default:
      return { renderScale: 1.25, ambientOcclusion: true, shadows: 'high', antialias: true, textureQuality: 'high', reflections: true, bloom: true, lensFlare: true, particles: 'high', terrainDetail: true, motionBlur: true, outlines: true, filmGrain: true };
  }
}

// ---------------------------------------------------------------------------
// profile

const NAME_A = ['Regolith', 'Tycho', 'Kepler', 'Selene', 'Crater', 'Apollo', 'Orbit', 'Nova', 'Comet', 'Vector', 'Basalt', 'Titan', 'Halo', 'Mare', 'Eclipse', 'Apogee', 'Zenith', 'Quasar', 'Rover', 'Lander'];
const NAME_B = ['Fox', 'Wolf', 'Hawk', 'Viper', 'Ghost', 'Lynx', 'Raven', 'Moth', 'Jackal', 'Kite', 'Bison', 'Mantis', 'Otter', 'Falcon', 'Cobra'];

export function randomCallsign(): string {
  const r = (n: number) => Math.floor(Math.random() * n);
  return r(2) === 0 ? `${NAME_A[r(NAME_A.length)]}-${10 + r(90)}` : `${NAME_A[r(NAME_A.length)]}${NAME_B[r(NAME_B.length)]}`;
}

export function emptyStats(): ProfileStats {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
    timePlayed: 0,
    captures: 0,
    bestStreak: 0,
    longestKill: 0,
    wallKills: 0,
    suffocations: 0,
    nukes: 0,
    damageDealt: 0,
  };
}

export function defaultProfile(): Profile {
  return {
    version: 1,
    name: randomCallsign(),
    xp: 0,
    stats: emptyStats(),
    weapons: {},
    heroes: {},
    ribbons: {},
    selectedHero: 'condor',
    history: [],
    createdAt: Date.now(),
  };
}

const HERO_IDS = Object.keys(HEROES) as HeroId[];

export function sanitizeProfile(raw: unknown): Profile {
  const d = defaultProfile();
  if (!isObj(raw)) return d;
  const statsIn = isObj(raw.stats) ? raw.stats : {};
  const stats = emptyStats();
  for (const k of Object.keys(stats) as (keyof ProfileStats)[]) stats[k] = num(statsIn[k], 0, 0, 1e12);
  const heroes: Profile['heroes'] = {};
  if (isObj(raw.heroes)) {
    for (const id of HERO_IDS) {
      const hs = raw.heroes[id];
      if (!isObj(hs)) continue;
      heroes[id] = {
        kills: num(hs.kills, 0, 0, 1e9),
        deaths: num(hs.deaths, 0, 0, 1e9),
        time: num(hs.time, 0, 0, 1e10),
        matches: num(hs.matches, 0, 0, 1e9),
        wins: num(hs.wins, 0, 0, 1e9),
        damage: num(hs.damage, 0, 0, 1e12),
        healing: num(hs.healing, 0, 0, 1e12),
      };
    }
  }
  const weapons: Profile['weapons'] = {};
  if (isObj(raw.weapons)) {
    for (const k of Object.keys(raw.weapons)) {
      const w = raw.weapons[k];
      if (!isObj(w)) continue;
      weapons[k as WeaponId] = { kills: num(w.kills, 0, 0, 1e9), headshots: num(w.headshots, 0, 0, 1e9), shots: num(w.shots, 0, 0, 1e12), hits: num(w.hits, 0, 0, 1e12) };
    }
  }
  const ribbons: Profile['ribbons'] = {};
  if (isObj(raw.ribbons)) for (const k of Object.keys(raw.ribbons)) ribbons[k as RibbonId] = num(raw.ribbons[k], 0, 0, 1e9);
  const heroXp: Partial<Record<HeroId, number>> = {};
  if (isObj(raw.heroXp)) for (const id of HERO_IDS) if (typeof raw.heroXp[id] === 'number') heroXp[id] = num(raw.heroXp[id], 0, 0, 1e10);
  const builds: Partial<Record<HeroId, string>> = {};
  if (isObj(raw.builds)) {
    for (const id of HERO_IDS) {
      const b = raw.builds[id];
      if (typeof b === 'string' && HEROES[id].builds.some((x) => x.id === b)) builds[id] = b;
    }
  }
  const history: MatchSummary[] = Array.isArray(raw.history)
    ? (raw.history.filter((m) => isObj(m) && typeof m.t === 'number' && typeof m.mode === 'string') as unknown as MatchSummary[]).slice(0, 20)
    : [];
  const name = str(raw.name, '', 24).trim();
  return {
    version: 1,
    name: name.length >= 2 ? name : d.name,
    xp: num(raw.xp, 0, 0, 1e12),
    stats,
    weapons,
    heroes,
    ribbons,
    selectedHero: oneOf(raw.selectedHero, HERO_IDS, 'condor'),
    heroXp,
    builds,
    history,
    createdAt: num(raw.createdAt, d.createdAt, 0, 1e15),
  };
}

export function loadProfile(): Profile {
  const raw = readJson(PROFILE_KEY);
  const p = sanitizeProfile(raw);
  if (!raw) saveProfile(p);
  return p;
}

export function saveProfile(p: Profile): void {
  writeJson(PROFILE_KEY, p);
}

export interface MatchExtra {
  hero: HeroId;
  damage: number;
  healing: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  captures: number;
  longestKill: number;
  wallKills: number;
  suffocations: number;
  nukes: number;
  bestStreak: number;
  weapons: Partial<Record<WeaponId, WeaponStats>>;
  timePlayed: number;
}

/** Applies a finished match to the profile (stats, hero stats, weapon stats, ribbons, history, xp from result.xp sum). Returns a NEW profile object. */
export function applyMatch(p: Profile, r: MatchResult, extra: MatchExtra): Profile {
  const me = r.rows.find((x) => x.isLocal);
  const kills = me?.kills ?? 0;
  const deaths = me?.deaths ?? 0;
  const assists = me?.assists ?? 0;
  const score = me?.score ?? 0;
  const xpGain = Math.max(0, Math.round(r.xp.reduce((a, x) => a + (Number.isFinite(x.amount) ? x.amount : 0), 0)));
  const won = r.won;
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

  const s = { ...p.stats };
  s.matches += 1;
  if (won === true) s.wins += 1;
  else if (won === false) s.losses += 1;
  s.kills += kills;
  s.deaths += deaths;
  s.assists += assists;
  s.headshots += n(extra.headshots);
  s.shotsFired += n(extra.shotsFired);
  s.shotsHit += n(extra.shotsHit);
  s.timePlayed += n(extra.timePlayed);
  s.captures += n(extra.captures);
  s.bestStreak = Math.max(s.bestStreak, n(extra.bestStreak));
  s.longestKill = Math.max(s.longestKill, n(extra.longestKill));
  s.wallKills += n(extra.wallKills);
  s.suffocations += n(extra.suffocations);
  s.nukes += n(extra.nukes);
  s.damageDealt += n(extra.damage);

  const heroes = { ...p.heroes };
  const hPrev = heroes[extra.hero] ?? { kills: 0, deaths: 0, time: 0, matches: 0, wins: 0, damage: 0, healing: 0 };
  heroes[extra.hero] = {
    kills: hPrev.kills + kills,
    deaths: hPrev.deaths + deaths,
    time: hPrev.time + n(extra.timePlayed),
    matches: hPrev.matches + 1,
    wins: hPrev.wins + (won === true ? 1 : 0),
    damage: hPrev.damage + n(extra.damage),
    healing: hPrev.healing + n(extra.healing),
  };

  const weapons = { ...p.weapons };
  for (const k of Object.keys(extra.weapons) as WeaponId[]) {
    const w = extra.weapons[k];
    if (!w) continue;
    const prev = weapons[k] ?? { kills: 0, headshots: 0, shots: 0, hits: 0 };
    weapons[k] = { kills: prev.kills + n(w.kills), headshots: prev.headshots + n(w.headshots), shots: prev.shots + n(w.shots), hits: prev.hits + n(w.hits) };
  }

  const ribbons = { ...p.ribbons };
  for (const id of r.ribbons) ribbons[id] = (ribbons[id] ?? 0) + 1;

  const summary: MatchSummary = {
    t: Date.now(),
    mode: r.mode,
    map: r.map,
    won,
    placement: r.placement,
    kills,
    deaths,
    assists,
    score,
    xp: xpGain,
  };

  const heroXp = { ...(p.heroXp ?? {}) };
  heroXp[extra.hero] = (heroXp[extra.hero] ?? 0) + Math.round(xpGain * HERO_XP_SHARE);

  return {
    ...p,
    xp: p.xp + xpGain,
    stats: s,
    heroes,
    heroXp,
    weapons,
    ribbons,
    history: [summary, ...p.history].slice(0, 20),
  };
}

/** share of match XP that also goes to the played hero's mastery */
export const HERO_XP_SHARE = 0.6;

/** hero mastery level info from the profile */
export function heroMastery(p: Profile, hero: HeroId): { level: number; into: number; need: number; xp: number } {
  const xp = p.heroXp?.[hero] ?? 0;
  return { ...heroLevelFromXp(xp), xp };
}

/** the build the player will use for this hero: the selected one if unlocked, else the first unlocked */
export function selectedBuild(p: Profile, hero: HeroId): string {
  const def = HEROES[hero];
  const lvl = heroMastery(p, hero).level;
  const want = p.builds?.[hero];
  const b = def.builds.find((x) => x.id === want);
  if (b && b.unlock <= lvl) return b.id;
  return (def.builds.find((x) => x.unlock <= lvl) ?? def.builds[0])?.id ?? '';
}

// ---------------------------------------------------------------------------
// ranks

export type RankTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master';

interface RankDef {
  from: number;
  tier: RankTier;
  ru: string;
  en: string;
}

const RANKS: RankDef[] = [
  { from: 1, tier: 'bronze', ru: 'Кадет', en: 'Cadet' },
  { from: 5, tier: 'bronze', ru: 'Рядовой', en: 'Private' },
  { from: 10, tier: 'bronze', ru: 'Ефрейтор', en: 'Lance Corporal' },
  { from: 15, tier: 'silver', ru: 'Сержант', en: 'Sergeant' },
  { from: 22, tier: 'silver', ru: 'Старшина', en: 'Master Sergeant' },
  { from: 30, tier: 'silver', ru: 'Прапорщик', en: 'Warrant Officer' },
  { from: 40, tier: 'gold', ru: 'Лейтенант', en: 'Lieutenant' },
  { from: 50, tier: 'gold', ru: 'Капитан', en: 'Captain' },
  { from: 62, tier: 'platinum', ru: 'Майор', en: 'Major' },
  { from: 75, tier: 'platinum', ru: 'Подполковник', en: 'Lieutenant Colonel' },
  { from: 90, tier: 'diamond', ru: 'Полковник', en: 'Colonel' },
  { from: 110, tier: 'diamond', ru: 'Генерал', en: 'General' },
  { from: 130, tier: 'master', ru: 'Лунный маршал', en: 'Lunar Marshal' },
];

function rankDef(level: number): RankDef {
  let r = RANKS[0];
  for (const x of RANKS) if (level >= x.from) r = x;
  return r;
}

/** Rank title for a level, e.g. Кадет → … → Лунный маршал. See rankTier() for the badge tier. */
export function rankTitle(level: number, lang: Lang): string {
  const r = rankDef(level);
  return lang === 'en' ? r.en : r.ru;
}

export function rankTier(level: number): RankTier {
  return rankDef(level).tier;
}

/** full rank info: title, tier and the 1-based index of the rank (for badge pips) */
export function rankInfo(level: number, lang: Lang): { title: string; tier: RankTier; index: number; nextAt: number | null } {
  const r = rankDef(level);
  const i = RANKS.indexOf(r);
  return { title: lang === 'en' ? r.en : r.ru, tier: r.tier, index: i + 1, nextAt: i + 1 < RANKS.length ? RANKS[i + 1].from : null };
}

export const TIER_COLORS: Record<RankTier, [string, string]> = {
  bronze: ['#e2a36b', '#8a4f2a'],
  silver: ['#eef3fa', '#7d8a9c'],
  gold: ['#ffe07a', '#c7881a'],
  platinum: ['#b9fff2', '#3aa59a'],
  diamond: ['#b8d4ff', '#4a6cf0'],
  master: ['#ffc2ff', '#9b3cf0'],
};
