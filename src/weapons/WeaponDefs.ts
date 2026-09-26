import type { WeaponId } from '../game/Types';
export type { WeaponId };
export type WeaponSlotKind = 'primary' | 'secondary' | 'super';

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
  spreadHip: number; // radians
  spreadAds: number;
  recoil: number; // camera kick (radians)
  pellets: number;
  range: number;
  speed: number; // projectile speed m/s
  gravity: number; // projectile gravity multiplier (moon g)
  splash: number; // splash radius
  splashDamage: number;
  fuse: number; // grenade fuse seconds (0 = impact)
  bounce: number; // restitution
  charge: number; // seconds to charge before firing (rail)
  zoom: number; // ADS FOV multiplier
  pierce: number;
  sfx: string; // audio Sfx id
  falloffStart: number; // hitscan damage falloff (m)
  falloffEnd: number;
  falloffMin: number; // multiplier at falloffEnd
  heal: number; // healing on allies (sealer)
  burstCount: number; // shots per trigger pull (burst rifle)
  meleeRange: number; // melee reach (m)
  meleeArc: number; // melee cone half-angle (rad)
  color: number; // tracer / glow colour
  moveMul: number; // movement speed multiplier while held
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
  meleeRange: 0,
  meleeArc: 0,
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // Pulse rifle "Condor": reliable automatic hitscan
  pulse: {
    ...base,
    id: 'pulse',
    slot: 'primary',
    kind: 'hitscan',
    damage: 15,
    headMul: 1.9,
    suitMul: 0.75,
    interval: 0.095,
    auto: true,
    mag: 36,
    reserve: 216,
    reload: 1.7,
    spreadHip: 0.022,
    spreadAds: 0.005,
    recoil: 0.011,
    falloffStart: 30,
    falloffEnd: 60,
    falloffMin: 0.6,
    sfx: 'pulse',
    color: 0x5ff0ff,
  },
  // Railgun "Needle": charged, pierces, sniper zoom
  rail: {
    ...base,
    id: 'rail',
    slot: 'primary',
    kind: 'hitscan',
    damage: 92,
    headMul: 2.2,
    suitMul: 1.1,
    interval: 1.15,
    mag: 5,
    reserve: 25,
    reload: 2.4,
    spreadHip: 0.03,
    spreadAds: 0.0,
    recoil: 0.06,
    charge: 0.45,
    zoom: 0.3,
    pierce: 1,
    range: 700,
    sfx: 'rail',
    color: 0xb58cff,
    moveMul: 0.92,
  },
  // Plasma shotgun "Supernova": slow plasma pellets
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
    reload: 2.1,
    spreadHip: 0.09,
    spreadAds: 0.065,
    recoil: 0.07,
    pellets: 9,
    speed: 95,
    range: 60,
    sfx: 'plasma',
    color: 0x9dff5a,
  },
  // Grenade launcher "Lunatic": lunar-arc bouncing grenades
  glauncher: {
    ...base,
    id: 'glauncher',
    slot: 'primary',
    kind: 'projectile',
    damage: 30,
    suitMul: 1.3,
    interval: 0.75,
    mag: 6,
    reserve: 24,
    reload: 2.6,
    spreadHip: 0.01,
    spreadAds: 0.004,
    recoil: 0.05,
    speed: 26,
    gravity: 1,
    splash: 5.5,
    splashDamage: 95,
    fuse: 2.2,
    bounce: 0.45,
    sfx: 'glauncher',
    color: 0xffc21a,
  },
  // Twin arc SMGs "Sparks" (Phantom): fast alternating hitscan with falloff
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
    spreadHip: 0.03,
    spreadAds: 0.022,
    recoil: 0.006,
    range: 120,
    falloffStart: 14,
    falloffEnd: 32,
    falloffMin: 0.45,
    sfx: 'arc',
    color: 0xc58cff,
    moveMul: 1.05,
  },
  // Sealant foam emitter (Helios): arcing foam globs heal allies + patch suits, sting enemies
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
    spreadAds: 0.008,
    recoil: 0.012,
    speed: 48,
    gravity: 0.6,
    splash: 2.4,
    splashDamage: 10,
    heal: 26,
    sfx: 'plasma',
    color: 0x7dff9a,
  },
  // Plasma katana (Blade): fast arcs of melee damage, cleaves several enemies
  blade: {
    ...base,
    id: 'blade',
    slot: 'primary',
    kind: 'melee',
    damage: 58,
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
  },
  // Rivet gun (Forge): heavy fast bolts with a slight lunar drop
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
    mag: 30,
    reserve: 180,
    reload: 1.9,
    spreadHip: 0.014,
    spreadAds: 0.006,
    recoil: 0.018,
    speed: 115,
    gravity: 0.25,
    sfx: 'glauncher',
    color: 0xff9f43,
  },
  // Burst rifle (Hive): 3-round bursts, precise at range
  burst: {
    ...base,
    id: 'burst',
    slot: 'primary',
    kind: 'hitscan',
    damage: 17,
    headMul: 2,
    suitMul: 0.75,
    interval: 0.45,
    burstCount: 3,
    mag: 30,
    reserve: 180,
    reload: 1.8,
    spreadHip: 0.016,
    spreadAds: 0.004,
    recoil: 0.014,
    falloffStart: 40,
    falloffEnd: 80,
    falloffMin: 0.6,
    sfx: 'pulse',
    color: 0xe6e14d,
  },
  // Tactical nuclear rocket launcher "Pocket Sun"
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
  },
};

export const SUPERS: WeaponId[] = ['nuke', 'singularity', 'helios'];
