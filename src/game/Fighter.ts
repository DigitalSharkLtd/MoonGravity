import * as THREE from 'three';
import { Body, MoveInput, emptyInput } from '../entities/Body';
import { HeroModel } from '../entities/HeroModel';
import { PhysicsWorld } from '../core/Physics';
import { HEROES, HeroDef, HeroId, WeaponId, AbilityId, BuildMods, PassiveId, RolePassiveId, ROLE_PASSIVE } from './Types';
import { WEAPONS, WeaponDef } from '../weapons/WeaponDefs';

export interface Intent extends MoveInput {
  fire: boolean;
  firePressed: boolean;
  aim: boolean;
  reload: boolean;
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
  slot: number; // -1 none, 0 hero weapon, 1 super weapon
  sealant: boolean;
  toggleMag: boolean;
  grapple: boolean; // pressed
  melee: boolean; // pressed
  /** aim button pressed this tick (alt-fire trigger: detonate / slug / glob) */
  altPressed: boolean;
}

export function emptyIntent(): Intent {
  return { ...emptyInput(), fire: false, firePressed: false, aim: false, reload: false, ability1: false, ability2: false, ultimate: false, slot: -1, sealant: false, toggleMag: false, grapple: false, melee: false, altPressed: false };
}

export interface WeaponState {
  id: WeaponId;
  def: WeaponDef;
  ammo: number;
  reserve: number;
  cooldown: number;
  reloadT: number; // > 0 while reloading (seconds left)
  charge: number; // 0..1 railgun charge
  spread: number; // current bloom (rad)
  burst: number; // alternating barrel for twin weapons
  burstLeft: number; // burst rifle: rounds left in the current burst
  burstT: number;
  /** seconds since the last shot */
  sinceShot: number;
  /** shots in the current string (recoil weave index) */
  string: number;
  /** unrecovered recoil (rad) the view drifts back from */
  recoilPitch: number;
  recoilYaw: number;
  /** riveter heat 0..1 and overheat / vent lockout */
  heat: number;
  ventT: number;
  /** alt-fire cooldown */
  altCd: number;
  /** burst rifle "Trill": enemy hit by the rounds of the current burst */
  burstHitId: number;
  burstHits: number;
  burstIdx: number;
  /** katana combo */
  combo: number;
  comboT: number;
  /** twin arcs static build-up */
  staticId: number;
  staticN: number;
  staticT: number;
}

export function makeWeapon(id: WeaponId): WeaponState {
  const def = WEAPONS[id];
  return {
    id, def, ammo: def.mag, reserve: def.reserve, cooldown: 0, reloadT: 0, charge: 0, spread: 0, burst: 0, burstLeft: 0, burstT: 0,
    sinceShot: 9, string: 0, recoilPitch: 0, recoilYaw: 0, heat: 0, ventT: 0, altCd: 0, burstHitId: -1, burstHits: 0, burstIdx: 0, combo: 0, comboT: 0, staticId: -1, staticN: 0, staticT: 0,
  };
}

export interface AbilityState {
  id: AbilityId;
  cooldown: number; // seconds left
  maxCooldown: number;
  charges: number;
  maxCharges: number;
  active: number; // seconds left of active effect
  duration: number;
}

export interface FighterStats {
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  damage: number;
  healing: number;
  streak: number;
  bestStreak: number;
  headshots: number;
  shots: number;
  hits: number;
  captures: number;
  wallKills: number;
  suffocations: number;
  nukes: number;
  longestKill: number;
  ultKills: number;
  /** 3 kills within 4 s (ribbon) */
  multikills: number;
  weapons: Partial<Record<WeaponId, { kills: number; headshots: number; shots: number; hits: number }>>;
}

export function emptyStats(): FighterStats {
  return { kills: 0, deaths: 0, assists: 0, score: 0, damage: 0, healing: 0, streak: 0, bestStreak: 0, headshots: 0, shots: 0, hits: 0, captures: 0, wallKills: 0, suffocations: 0, nukes: 0, longestKill: 0, ultKills: 0, multikills: 0, weapons: {} };
}

/** Hitbox spheres relative to feet along the body's up axis. */
export const HITBOXES: { part: 'head' | 'body' | 'legs'; h: number; r: number }[] = [
  { part: 'head', h: 1.63, r: 0.3 },
  { part: 'body', h: 1.18, r: 0.42 },
  { part: 'legs', h: 0.55, r: 0.36 },
];

export type Control = 'local' | 'bot' | 'remote';

/**
 * A combatant (human or bot). Holds simulation state; rendering lives in `model`.
 */
export class Fighter {
  id: number;
  name: string;
  team: number;
  hero!: HeroId;
  def!: HeroDef;
  control: Control;
  /** net: peer that owns this fighter ('host' or a peer id) */
  owner = 'host';
  body: Body;
  model: HeroModel | null = null;
  alive = false;
  respawnT = 0;
  spawnProtect = 0;
  /** false until the first spawn: the HUD shows a deploy screen, not a death screen */
  spawnedOnce = false;
  health = 100;
  maxHealth = 100;
  suit = 100;
  maxSuit = 100;
  oxygen = 100;
  breached = false;
  suffocating = false;
  lastDamageT = 99;
  lastAttacker = -1;
  lastAttackerT = 99;
  assistMap = new Map<number, number>(); // attacker id → time of last damage
  weapon!: WeaponState; // hero weapon
  superWeapon: WeaponState | null = null;
  slot = 0; // 0 hero weapon, 1 super weapon
  switchT = 0;
  abilities: AbilityState[] = [];
  ult!: AbilityState;
  ultCharge = 0;
  sealants = 2;
  sealT = -1; // channel progress (seconds left)
  // status effects
  empT = 0;
  cloakT = 0;
  invulnT = 0;
  overchargeT = 0;
  swarmT = 0;
  swarmFired = 0;
  revealedT = 0;
  slowT = 0;
  castT = 0; // pose blend for abilities
  intent: Intent = emptyIntent();
  stats: FighterStats = emptyStats();
  isBot: boolean;
  /** smoothed values for rendering */
  renderPos = new THREE.Vector3();
  renderQuat = new THREE.Quaternion();
  renderPitch = 0;
  /** match times of recent kills (multikill ribbon) */
  recentKills: number[] = [];
  /** body state at the start of the last fixed step: rendering interpolates prev → current */
  prevPos = new THREE.Vector3();
  prevQuat = new THREE.Quaternion();
  /** net interpolation buffer (remote fighters) */
  snaps: { t: number; pos: THREE.Vector3; quat: THREE.Quaternion; pitch: number; vel: THREE.Vector3; flags: number }[] = [];
  ping = 0;
  firingVisual = 0;
  anchor: { target: THREE.Vector3; normal: THREE.Vector3 | null; t: number } | null = null;
  slam = 0; // >0 while slamming down
  /** short window after a slam landing (no fall damage from the dive) */
  slamGrace = 0;
  lastWallTime = -99;
  lastStepFoot = 0;
  // expanded kit
  shieldHp = 0; // force-field HP on top of health
  shieldT = 0;
  deflectT = 0;
  lungeT = 0;
  moonbladeT = 0;
  grappleCd = 0;
  meleeCd = 0;
  meleeT = 0; // swing animation
  swingSide = 1;
  ambushReady = false;
  /** servitor summons: owning fighter id (-1 = not a summon) */
  summonOf = -1;
  summonLife = 0;
  buildId = '';
  mods: BuildMods = {};
  flags = new Set<string>();
  /** Hive's drone link: marked by fighter id until markT runs out */
  markedBy = -1;
  markT = 0;
  /** Helios' life-support link / Forge's field repairs reach this fighter (set by Vitals each tick) */
  linkT = 0;
  /** grapple rope anchor for rendering (local sim uses body.grapple; remotes get it via net) */
  rope: THREE.Vector3 | null = null;
  ropeT = 0;

  constructor(id: number, name: string, team: number, hero: HeroId, control: Control, world: PhysicsWorld) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.control = control;
    this.isBot = control === 'bot';
    this.body = new Body(world);
    this.setHero(hero);
  }

  setHero(hero: HeroId, def?: HeroDef): void {
    this.hero = hero;
    this.def = def ?? HEROES[hero];
    this.maxHealth = this.def.health;
    this.maxSuit = this.def.suit;
    this.weapon = makeWeapon(this.def.weapon);
    const mk = (a: HeroDef['ability1']): AbilityState => ({ id: a.id, cooldown: 0, maxCooldown: a.cooldown, charges: a.charges, maxCharges: a.charges, active: 0, duration: a.duration });
    this.abilities = [mk(this.def.ability1), mk(this.def.ability2)];
    this.ult = mk(this.def.ultimate);
    this.applyBuild(this.buildId);
    this.body.standHeight = this.hero === 'reactor' ? 2.02 : 1.85;
    this.body.height = this.body.standHeight;
    // tank is visually bigger but keeps a doorway-friendly capsule (hitboxes are scaled instead)
    this.body.radius = this.hero === 'reactor' ? 0.45 : 0.42;
  }

  /** Apply a build (talent path) — multipliers & swaps. */
  applyBuild(id: string): void {
    const b = this.def.builds?.find((x) => x.id === id) ?? this.def.builds?.[0];
    this.buildId = b?.id ?? '';
    const m = (this.mods = b?.mods ?? {});
    this.flags = new Set(m.flags ?? []);
    this.maxHealth = Math.round(this.def.health * (m.health ?? 1));
    this.maxSuit = Math.round(this.def.suit * (m.suit ?? 1));
    const a1 = this.abilities[0];
    const a2 = this.abilities[1];
    if (a1) {
      a1.id = m.swap1 ?? this.def.ability1.id;
      a1.maxCooldown = this.def.ability1.cooldown * (m.cd1 ?? 1);
      a1.maxCharges = this.def.ability1.charges + (m.swap1 === 'barricade' ? 1 : 0) + (m.charges1 ?? 0);
      a1.duration = m.swap1 === 'barricade' ? 0 : this.def.ability1.duration;
      a1.charges = Math.min(a1.charges, a1.maxCharges);
    }
    if (a2) {
      a2.id = m.swap2 ?? this.def.ability2.id;
      a2.maxCooldown = this.def.ability2.cooldown * (m.cd2 ?? 1);
      a2.maxCharges = this.def.ability2.charges + (m.charges2 ?? 0);
      a2.duration = m.swap2 === 'huntdrone' ? 0 : this.def.ability2.duration;
      a2.charges = Math.min(a2.charges, a2.maxCharges);
    }
  }

  get passive(): PassiveId {
    return this.def.passive;
  }

  get rolePassive(): RolePassiveId {
    return ROLE_PASSIVE[this.def.role];
  }

  /** knockback mass: heavier suits get pushed less (tanks also have the heavy-frame role passive) */
  get mass(): number {
    return (this.def.mass ?? 1) * (this.rolePassive === 'heavy' ? 1.35 : 1) * (this.summonOf >= 0 ? 1.1 : 1);
  }

  get ultCostEff(): number {
    return this.def.ultCost * (this.mods.ultCost ?? 1);
  }

  /** Reset vitals & gear at spawn. */
  spawn(pos: THREE.Vector3, yaw: number): void {
    this.spawnedOnce = true;
    this.rope = null;
    this.alive = true;
    this.health = this.maxHealth;
    this.suit = this.maxSuit;
    this.oxygen = 100;
    this.breached = false;
    this.suffocating = false;
    this.weapon = makeWeapon(this.def.weapon);
    if (this.mods.mag && this.weapon.def.mag < 900) {
      this.weapon.ammo = Math.round(this.weapon.def.mag * this.mods.mag);
    }
    this.superWeapon = null;
    this.slot = 0;
    this.shieldHp = this.shieldT = this.deflectT = this.lungeT = this.moonbladeT = 0;
    this.grappleCd = this.meleeCd = this.meleeT = 0;
    this.ambushReady = false;
    this.sealants = this.def.sealants;
    this.sealT = -1;
    this.empT = this.cloakT = this.invulnT = this.overchargeT = this.swarmT = this.revealedT = this.slowT = 0;
    this.markedBy = -1;
    this.markT = this.linkT = 0;
    for (const a of this.abilities) {
      a.cooldown = 0;
      a.charges = a.maxCharges;
      a.active = 0;
    }
    this.ult.active = 0;
    this.spawnProtect = 1.5;
    this.lastDamageT = 99;
    this.assistMap.clear();
    this.anchor = null;
    this.slam = 0;
    this.body.reset(pos, yaw);
    this.prevPos.copy(this.body.pos); // no interpolation streak across the respawn teleport
    this.prevQuat.copy(this.body.quat);
    // mag-boots start switched off: walking up walls / ceilings needs them switched on (F) first
    this.body.magOn = false;
    this.renderPos.copy(pos);
    this.renderQuat.copy(this.body.quat);
    this.model?.resetPose();
    this.snaps.length = 0;
  }

  get activeWeapon(): WeaponState {
    return this.slot === 1 && this.superWeapon ? this.superWeapon : this.weapon;
  }

  get suitFrac(): number {
    return this.maxSuit > 0 ? this.suit / this.maxSuit : 1;
  }

  get ultReady(): boolean {
    return this.ultCharge >= this.ultCostEff;
  }

  get magSize(): number {
    return this.weapon.def.mag < 900 ? Math.round(this.weapon.def.mag * (this.mods.mag ?? 1)) : this.weapon.def.mag;
  }

  eye(out: THREE.Vector3): THREE.Vector3 {
    return this.body.eye(out);
  }

  /** world-space hitbox center */
  hitbox(i: number, out: THREE.Vector3): THREE.Vector3 {
    const b = this.body;
    if (b.stance === 'prone') {
      // lying along the facing direction: head forward, legs back, all near the ground
      const f = b.forward(out).multiplyScalar(i === 0 ? 0.75 : i === 1 ? 0 : -0.75);
      return f.add(b.pos).addScaledVector(b.up, 0.32);
    }
    const s = b.height / b.standHeight;
    return out.copy(b.pos).addScaledVector(b.up, HITBOXES[i].h * s * (this.hero === 'reactor' ? 1.1 : 1));
  }
  hitRadius(i: number): number {
    return HITBOXES[i].r * (this.hero === 'reactor' ? 1.15 : 1);
  }
}
