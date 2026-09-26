import * as THREE from 'three';
import { Body, MoveInput, emptyInput } from '../entities/Body';
import { HeroModel } from '../entities/HeroModel';
import { PhysicsWorld } from '../core/Physics';
import { HEROES, HeroDef, HeroId, WeaponId, AbilityId } from './Types';
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
}

export function emptyIntent(): Intent {
  return { ...emptyInput(), fire: false, firePressed: false, aim: false, reload: false, ability1: false, ability2: false, ultimate: false, slot: -1, sealant: false, toggleMag: false };
}

export interface WeaponState {
  id: WeaponId;
  def: WeaponDef;
  ammo: number;
  reserve: number;
  cooldown: number;
  reloadT: number; // > 0 while reloading (seconds left)
  charge: number; // 0..1 railgun charge
  spread: number; // current bloom
  burst: number; // alternating barrel for twin weapons
}

export function makeWeapon(id: WeaponId): WeaponState {
  const def = WEAPONS[id];
  return { id, def, ammo: def.mag, reserve: def.reserve, cooldown: 0, reloadT: 0, charge: 0, spread: 0, burst: 0 };
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
  weapons: Partial<Record<WeaponId, { kills: number; headshots: number; shots: number; hits: number }>>;
}

export function emptyStats(): FighterStats {
  return { kills: 0, deaths: 0, assists: 0, score: 0, damage: 0, healing: 0, streak: 0, bestStreak: 0, headshots: 0, shots: 0, hits: 0, captures: 0, wallKills: 0, suffocations: 0, nukes: 0, longestKill: 0, ultKills: 0, weapons: {} };
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
  /** net interpolation buffer (remote fighters) */
  snaps: { t: number; pos: THREE.Vector3; quat: THREE.Quaternion; pitch: number; vel: THREE.Vector3; flags: number }[] = [];
  ping = 0;
  firingVisual = 0;
  anchor: { target: THREE.Vector3; normal: THREE.Vector3 | null; t: number } | null = null;
  slam = 0; // >0 while slamming down
  lastWallTime = -99;
  lastStepFoot = 0;

  constructor(id: number, name: string, team: number, hero: HeroId, control: Control, world: PhysicsWorld) {
    this.id = id;
    this.name = name;
    this.team = team;
    this.control = control;
    this.isBot = control === 'bot';
    this.body = new Body(world);
    this.setHero(hero);
  }

  setHero(hero: HeroId): void {
    this.hero = hero;
    this.def = HEROES[hero];
    this.maxHealth = this.def.health;
    this.maxSuit = this.def.suit;
    this.weapon = makeWeapon(this.def.weapon);
    const mk = (a: HeroDef['ability1']): AbilityState => ({ id: a.id, cooldown: 0, maxCooldown: a.cooldown, charges: a.charges, maxCharges: a.charges, active: 0, duration: a.duration });
    this.abilities = [mk(this.def.ability1), mk(this.def.ability2)];
    this.ult = mk(this.def.ultimate);
    this.body.standHeight = this.hero === 'reactor' ? 2.02 : 1.85;
    this.body.height = this.body.standHeight;
    this.body.radius = this.hero === 'reactor' ? 0.5 : 0.42;
  }

  /** Reset vitals & gear at spawn. */
  spawn(pos: THREE.Vector3, yaw: number): void {
    this.alive = true;
    this.health = this.maxHealth;
    this.suit = this.maxSuit;
    this.oxygen = 100;
    this.breached = false;
    this.suffocating = false;
    this.weapon = makeWeapon(this.def.weapon);
    this.superWeapon = null;
    this.slot = 0;
    this.sealants = this.def.sealants;
    this.sealT = -1;
    this.empT = this.cloakT = this.invulnT = this.overchargeT = this.swarmT = this.revealedT = this.slowT = 0;
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
    this.body.magOn = true;
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
    return this.ultCharge >= this.def.ultCost;
  }

  eye(out: THREE.Vector3): THREE.Vector3 {
    return this.body.eye(out);
  }

  /** world-space hitbox center */
  hitbox(i: number, out: THREE.Vector3): THREE.Vector3 {
    const s = this.body.height / this.body.standHeight;
    return out.copy(this.body.pos).addScaledVector(this.body.up, HITBOXES[i].h * s * (this.hero === 'reactor' ? 1.1 : 1));
  }
  hitRadius(i: number): number {
    return HITBOXES[i].r * (this.hero === 'reactor' ? 1.15 : 1);
  }
}
