import type { WeaponId } from '../game/Types';
export type { WeaponId };
export type WeaponSlotKind = 'primary' | 'secondary' | 'super';

/**
 * What the right mouse button does with this weapon.
 * - ads: aim down sights (zoom, tighter cone, less recoil)
 * - scope: sniper scope that also charges the shot
 * - detonate: remote-detonate your grenades in flight / on the ground
 * - slug: fire a single focused projectile (costs `altAmmo`, `altCooldown`)
 * - glob: lob a sticky foam glob that turns into a foam patch
 * - none: nothing
 */
export type AltFire = 'ads' | 'scope' | 'detonate' | 'slug' | 'glob' | 'none';

export interface WeaponDef {
  id: WeaponId;
  slot: WeaponSlotKind;
  /** hitscan: instant ray with tracer; projectile: simulated shot; designator: marks a target for an orbital strike */
  kind: 'hitscan' | 'projectile' | 'designator' | 'melee';
  damage: number;
  headMul: number;
  /** multiplier for damage dealt to suit integrity (explosives & rails tear suits apart) */
  suitMul: number;
  interval: number; // seconds between shots
  auto: boolean;
  mag: number;
  reserve: number;
  reload: number;
  spreadHip: number; // radians (cone radius)
  spreadAds: number;
  /** visual camera / viewmodel kick (the real aim punch is recoilUp / recoilSide) */
  recoil: number;
  pellets: number;
  range: number;
  speed: number; // projectile speed m/s
  /** projectile gravity multiplier. Everything with mass falls at exactly 1 × lunar g in vacuum;
   *  0 is reserved for self-propelled or energy shots (plasma, rockets, singularity). */
  gravity: number;
  splash: number; // splash radius
  splashDamage: number;
  fuse: number; // grenade fuse seconds (0 = impact)
  bounce: number; // restitution
  charge: number; // seconds of scoped charge for a full-power shot (rail)
  zoom: number; // ADS FOV multiplier
  pierce: number;
  sfx: string; // audio Sfx id
  falloffStart: number; // hitscan damage falloff (m)
  falloffEnd: number;
  falloffMin: number; // multiplier at falloffEnd
  heal: number; // healing on allies (sealer)
  burstCount: number; // shots per trigger pull (burst rifle)
  burstGap: number; // seconds between rounds of a burst
  meleeRange: number; // melee reach (m)
  meleeArc: number; // melee cone half-angle (rad)
  color: number; // tracer / glow colour
  moveMul: number; // movement speed multiplier while held
  // ---- weapon skill ----
  alt: AltFire;
  altCooldown: number;
  altAmmo: number;
  /** real aim punch: pitch climb per shot (rad); the view drifts back by itself once you stop firing */
  recoilUp: number;
  /** horizontal drift amplitude per shot (rad), follows a learnable weave */
  recoilSide: number;
  recoilPhase: number;
  /** rad/s the view recovers after the trigger is released */
  recoilRecover: number;
  /** cone growth per shot while the trigger is held (rad), its cap, and recovery speed (rad/s) */
  bloom: number;
  bloomMax: number;
  bloomDecay: number;
  /** cone multiplier for the first shot from rest (first-shot accuracy) */
  firstShot: number;
  /** ADS tap-fire: first shot from rest while aiming deals this much extra damage (0 = none) */
  tapBonus: number;
  /** heat instead of reloads (riveter): heat per shot (1 = overheated) */
  heatPerShot: number;
  heatCool: number; // per second after the trigger is released
  overheat: number; // lockout seconds when the heat maxes out
}

const base: Omit<WeaponDef, 'id' | 'slot' | 'kind' | 'sfx' | 'color'> = {
  damage: 10,
  headMul: 1.8,
  suitMul: 0.7,
  interval: 0.1,
  auto: false,
  mag: 10,
  reserve: 60,
  reload: 1.8,
  spreadHip: 0.02,
  spreadAds: 0.006,
  recoil: 0.01,
  pellets: 1,
  range: 400,
  speed: 0,
  gravity: 0,
  splash: 0,
  splashDamage: 0,
  fuse: 0,
  bounce: 0,
  charge: 0,
  zoom: 0.75,
  pierce: 0,
  moveMul: 1,
  falloffStart: 1000,
  falloffEnd: 1000,
  falloffMin: 1,
  heal: 0,
  burstCount: 1,
  burstGap: 0.075,
  meleeRange: 0,
  meleeArc: 0,
  alt: 'ads',
  altCooldown: 0,
  altAmmo: 0,
  recoilUp: 0.002,
  recoilSide: 0.0008,
  recoilPhase: 0,
  recoilRecover: 0.25,
  bloom: 0.001,
  bloomMax: 0.012,
  bloomDecay: 0.1,
  firstShot: 1,
  tapBonus: 0,
  heatPerShot: 0,
  heatCool: 0,
  overheat: 0,
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // Pulse rifle "Condor": reliable automatic hitscan. Skill: spray up close, controlled taps at range
  // (ADS first shot from rest is pin-point and hits 15 % harder); vertical climb to pull down.
  pulse: {
    ...base,
    id: 'pulse',
    slot: 'primary',
    kind: 'hitscan',
    damage: 15,
    headMul: 2,
    suitMul: 0.75,
    interval: 0.095,
    auto: true,
    mag: 36,
    reserve: 216,
    reload: 1.6,
    spreadHip: 0.02,
    spreadAds: 0.004,
    recoil: 0.011,
    falloffStart: 30,
    falloffEnd: 60,
    falloffMin: 0.6,
    sfx: 'pulse',
    color: 0x5ff0ff,
    recoilUp: 0.0034,
    recoilSide: 0.0011,
    recoilPhase: 0.4,
    recoilRecover: 0.22,
    bloom: 0.001,
    bloomMax: 0.011,
    bloomDecay: 0.08,
    firstShot: 0.25,
    tapBonus: 0.15,
  },
  // Railgun "Needle": scope to charge (0.9 s) → full power 100 body / 230 head (one-shots every
  // non-tank). Unscoped quick shots only deal 42 %. Big aim punch that recovers quickly.
  rail: {
    ...base,
    id: 'rail',
    slot: 'primary',
    kind: 'hitscan',
    damage: 100,
    headMul: 2.3,
    suitMul: 1.1,
    interval: 1.15,
    mag: 5,
    reserve: 25,
    reload: 2.4,
    spreadHip: 0.025,
    spreadAds: 0.0,
    recoil: 0.06,
    charge: 0.9,
    zoom: 0.3,
    pierce: 1,
    range: 700,
    sfx: 'rail',
    color: 0xb58cff,
    moveMul: 0.92,
    alt: 'scope',
    recoilUp: 0.03,
    recoilSide: 0.004,
    recoilPhase: 1.3,
    recoilRecover: 0.5,
    bloom: 0,
    bloomMax: 0,
    firstShot: 1,
  },
  // Plasma shotgun "Supernova": slow plasma pellets up close; RMB fires a focused plasma slug
  // (2 cells) for mid-range pokes.
  plasma: {
    ...base,
    id: 'plasma',
    slot: 'primary',
    kind: 'projectile',
    damage: 13,
    headMul: 1.4,
    suitMul: 0.9,
    interval: 0.8,
    mag: 8,
    reserve: 40,
    reload: 2.0,
    spreadHip: 0.058,
    spreadAds: 0.058,
    recoil: 0.07,
    pellets: 10,
    speed: 95,
    range: 60,
    sfx: 'plasma',
    color: 0x9dff5a,
    alt: 'slug',
    altCooldown: 1.0,
    altAmmo: 2,
    recoilUp: 0.022,
    recoilSide: 0.005,
    recoilPhase: 2.1,
    recoilRecover: 0.3,
    bloom: 0,
    bloomMax: 0,
  },
  // Grenade launcher "Lunatic": bouncing grenades on a true lunar arc; RMB detonates them remotely.
  glauncher: {
    ...base,
    id: 'glauncher',
    slot: 'primary',
    kind: 'projectile',
    damage: 35,
    headMul: 1.3,
    suitMul: 1.3,
    interval: 0.7,
    mag: 6,
    reserve: 30,
    reload: 2.4,
    spreadHip: 0.008,
    spreadAds: 0.008,
    recoil: 0.05,
    speed: 28,
    gravity: 1,
    splash: 4.5,
    splashDamage: 90,
    fuse: 1.8,
    bounce: 0.45,
    sfx: 'glauncher',
    color: 0xffc21a,
    alt: 'detonate',
    recoilUp: 0.016,
    recoilSide: 0.004,
    recoilPhase: 0.9,
    recoilRecover: 0.35,
    bloom: 0,
    bloomMax: 0,
  },
  // Twin arc SMGs "Sparks" (Phantom): fast alternating hitscan with falloff. Skill: static build-up —
  // every 10th consecutive hit on the same target discharges an arc (+20) that chains to a nearby enemy.
  twinarc: {
    ...base,
    id: 'twinarc',
    slot: 'primary',
    kind: 'hitscan',
    damage: 10,
    headMul: 1.8,
    suitMul: 0.8,
    interval: 0.065,
    auto: true,
    mag: 50,
    reserve: 300,
    reload: 1.4,
    spreadHip: 0.026,
    spreadAds: 0.016,
    recoil: 0.006,
    range: 120,
    falloffStart: 14,
    falloffEnd: 32,
    falloffMin: 0.45,
    sfx: 'arc',
    color: 0xc58cff,
    moveMul: 1.05,
    recoilUp: 0.0011,
    recoilSide: 0.0024,
    recoilPhase: 0,
    recoilRecover: 0.3,
    bloom: 0.0006,
    bloomMax: 0.012,
    bloomDecay: 0.12,
    firstShot: 0.5,
  },
  // Sealant foam emitter (Helios): arcing foam globs heal allies + patch suits, sting and slow enemies.
  // RMB lobs a sticky foam glob (5 cells) that becomes a foam patch: allies regenerate, enemies are slowed.
  sealer: {
    ...base,
    id: 'sealer',
    slot: 'primary',
    kind: 'projectile',
    damage: 18,
    headMul: 1,
    suitMul: 0.5,
    interval: 0.22,
    auto: true,
    mag: 30,
    reserve: 180,
    reload: 1.6,
    spreadHip: 0.012,
    spreadAds: 0.012,
    recoil: 0.012,
    speed: 50,
    gravity: 1,
    splash: 2.4,
    splashDamage: 10,
    heal: 26,
    sfx: 'plasma',
    color: 0x7dff9a,
    alt: 'glob',
    altCooldown: 6,
    altAmmo: 5,
    recoilUp: 0.0018,
    recoilSide: 0.0006,
    recoilRecover: 0.3,
    bloom: 0.0004,
    bloomMax: 0.006,
  },
  // Plasma katana (Blade): fast arcs of melee damage, cleaves several enemies. Every third swing of a
  // combo (swings < 1 s apart) is a heavy finisher: ×1.5 damage, wider and longer arc, big knockback.
  blade: {
    ...base,
    id: 'blade',
    slot: 'primary',
    kind: 'melee',
    damage: 64, // (balance: was 58)
    headMul: 1.2,
    suitMul: 1.2,
    interval: 0.42,
    auto: true,
    mag: 999,
    reserve: 0,
    reload: 0,
    spreadHip: 0,
    spreadAds: 0,
    recoil: 0.02,
    range: 3.2,
    meleeRange: 3.2,
    meleeArc: 0.9,
    sfx: 'arc',
    color: 0x39e3a8,
    moveMul: 1.05,
    alt: 'none',
    recoilUp: 0,
    recoilSide: 0,
    bloom: 0,
    bloomMax: 0,
  },
  // Rivet gun (Forge): heavy fast bolts with a true lunar drop. Heat instead of reloads: 32 rivets to
  // overheat (2 s lockout); feather the trigger or vent early with reload.
  riveter: {
    ...base,
    id: 'riveter',
    slot: 'primary',
    kind: 'projectile',
    damage: 24,
    headMul: 2,
    suitMul: 0.9,
    interval: 0.15,
    auto: true,
    mag: 32,
    reserve: 0,
    reload: 1.1,
    spreadHip: 0.014,
    spreadAds: 0.005,
    recoil: 0.018,
    speed: 120,
    gravity: 1,
    sfx: 'glauncher',
    color: 0xff9f43,
    recoilUp: 0.0045,
    recoilSide: 0.0016,
    recoilPhase: 2.6,
    recoilRecover: 0.22,
    bloom: 0.0012,
    bloomMax: 0.01,
    bloomDecay: 0.1,
    firstShot: 0.4,
    heatPerShot: 1 / 32,
    heatCool: 0.5,
    overheat: 2.0,
  },
  // Burst rifle (Hive): 3-round bursts, precise at range. "Trill": if the first two rounds of a burst
  // hit the same enemy, the third deals +60 %.
  burst: {
    ...base,
    id: 'burst',
    slot: 'primary',
    kind: 'hitscan',
    damage: 19,
    headMul: 2,
    suitMul: 0.75,
    interval: 0.45,
    burstCount: 3,
    burstGap: 0.075,
    mag: 30,
    reserve: 180,
    reload: 1.8,
    spreadHip: 0.018,
    spreadAds: 0.003,
    recoil: 0.014,
    falloffStart: 40,
    falloffEnd: 80,
    falloffMin: 0.6,
    sfx: 'pulse',
    color: 0xe6e14d,
    recoilUp: 0.0042,
    recoilSide: 0.001,
    recoilPhase: 1.7,
    recoilRecover: 0.3,
    bloom: 0.0015,
    bloomMax: 0.006,
    bloomDecay: 0.1,
    firstShot: 0.3,
  },
  // Tactical nuclear rocket launcher "Pocket Sun" (guided rocket motor: no ballistic drop)
  nuke: {
    ...base,
    id: 'nuke',
    slot: 'super',
    kind: 'projectile',
    damage: 250,
    suitMul: 2,
    interval: 1.5,
    mag: 1,
    reserve: 0,
    reload: 0,
    spreadHip: 0.004,
    spreadAds: 0.0,
    recoil: 0.12,
    speed: 38,
    gravity: 0,
    splash: 26,
    splashDamage: 420,
    zoom: 0.6,
    sfx: 'nuke_launch',
    color: 0xfff066,
    moveMul: 0.85,
    recoilUp: 0.05,
    recoilRecover: 0.3,
    bloom: 0,
    bloomMax: 0,
  },
  // Singularity cannon: slow black-hole orb that drags everyone in and collapses
  singularity: {
    ...base,
    id: 'singularity',
    slot: 'super',
    kind: 'projectile',
    damage: 60,
    suitMul: 1.5,
    interval: 1.0,
    mag: 2,
    reserve: 0,
    reload: 0,
    spreadHip: 0,
    spreadAds: 0,
    recoil: 0.08,
    speed: 16,
    splash: 11,
    splashDamage: 170,
    fuse: 3.2,
    sfx: 'singularity_fire',
    color: 0xb06cff,
    moveMul: 0.9,
    recoilUp: 0.03,
    bloom: 0,
    bloomMax: 0,
  },
  // Helios orbital laser designator
  helios: {
    ...base,
    id: 'helios',
    slot: 'super',
    kind: 'designator',
    damage: 0,
    interval: 1,
    mag: 1,
    reserve: 0,
    reload: 0,
    spreadHip: 0,
    spreadAds: 0,
    recoil: 0,
    range: 350,
    splash: 7,
    splashDamage: 70, // per second while inside the beam
    sfx: 'helios_mark',
    color: 0xff4040,
    recoilUp: 0,
    recoilSide: 0,
    bloom: 0,
    bloomMax: 0,
  },
};

export const SUPERS: WeaponId[] = ['nuke', 'singularity', 'helios'];

// ---------------------------------------------------------------------------
// shared aim model (used by Combat, the HUD crosshair and the offline balance probes)

/** RMB zooms / tightens the cone for this weapon */
export function adsCapable(def: WeaponDef): boolean {
  return def.alt === 'ads' || def.alt === 'scope';
}

export interface AimState {
  ads: boolean;
  crouch: boolean;
  prone: boolean;
  airborne: boolean;
  /** horizontal speed m/s */
  moving: number;
  /** current bloom (rad) */
  bloom: number;
  /** first shot from rest */
  rest: boolean;
  /** ranged role passive: steadier weapons */
  steady?: boolean;
}

/** Cone radius (rad) of the next shot. */
export function coneOf(def: WeaponDef, st: AimState): number {
  const ads = st.ads && adsCapable(def);
  let s = ads ? def.spreadAds : def.spreadHip;
  if (st.rest) s *= def.firstShot;
  s += st.bloom * (st.steady ? 0.8 : 1);
  s *= st.prone ? 0.55 : st.crouch ? 0.8 : 1;
  if (st.airborne) s += ads ? 0.006 : 0.012;
  if (st.moving > 2) s += (ads ? 0.002 : 0.006) * Math.min(1, (st.moving - 2) / 3);
  return s;
}

/** Recoil multiplier from stance / ADS / passives. */
export function recoilMulOf(def: WeaponDef, st: AimState): number {
  return (st.ads && adsCapable(def) ? 0.7 : 1) * (st.prone ? 0.5 : st.crouch ? 0.75 : 1) * (st.steady ? 0.8 : 1) * (st.airborne ? 1.2 : 1);
}

/** Learnable horizontal weave (-1..1) of the n-th shot in a string: straight up first, then a slow S. */
export function recoilWeave(def: WeaponDef, n: number): number {
  if (n < 2) return 0;
  return Math.sin((n - 2) * 0.42 + def.recoilPhase) * Math.min(1, (n - 1) / 5);
}

/** Hitscan damage multiplier at distance d (m). */
export function falloffAt(def: WeaponDef, d: number): number {
  if (d <= def.falloffStart) return 1;
  const k = Math.min(1, (d - def.falloffStart) / Math.max(1, def.falloffEnd - def.falloffStart));
  return 1 - k * (1 - def.falloffMin);
}

/** Railgun damage fraction for a charge level 0..1 (quick shots deal 42 %). */
export function railChargeMul(c: number): number {
  return 0.42 + 0.58 * Math.max(0, Math.min(1, c));
}
