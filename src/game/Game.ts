import * as THREE from 'three';
import type { World } from '../world/World';
import type { Pipeline } from '../render/Pipeline';
import type { Input } from '../core/Input';
import { Effects } from '../fx/Effects';
import { Combat, DamageSource } from './Combat';
import { Abilities } from './Abilities';
import { Summons } from './Summons';
import { Match } from './Match';
import { Bots } from './Bots';
import { Fighter, WeaponState, HITBOXES } from './Fighter';
import { HeroModel } from '../entities/HeroModel';
import { Viewmodel } from './Viewmodel';
import { updateVitals, leakRate } from './Vitals';
import { NetBridge } from './NetBridge';
import { gs, setGameLang } from './Strings';
import { MODES, HEROES, ModeId, HeroId, HeroDef, Settings, HudState, HudEvent, ModeInfo, ScreenMarker, Blip, Action, WeaponId, AbilityId, MatchResult } from './Types';
import { WEAPONS, adsCapable, coneOf } from '../weapons/WeaponDefs';
import { audio, Sfx, Loop } from '../audio/Audio';
import { TEAM_COLORS } from '../world/Builder';

export interface DamageSpec {
  target: Fighter;
  attacker: Fighter | null;
  amount: number;
  source: DamageSource;
  part: 'head' | 'body' | 'legs';
  dir: THREE.Vector3 | null;
  point: THREE.Vector3 | null;
  suitMul: number;
  silent?: boolean;
  noCredit?: boolean;
  /** seconds of slow applied with the hit (foam) — rides on client claims so the host applies it */
  slow?: number;
}

export interface GameHooks {
  hudUpdate(state: HudState, dt: number): void;
  hudEvent(e: HudEvent): void;
  scoreboard(show: boolean): void;
  onLocalDeath(): void;
  onMatchEnd(result: MatchResult): void;
  onPause(): void;
}

const FIXED = 1 / 60;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
/** Forge's humanoid combat servitor: a light bot fighter bound to its owner */
const SERVITOR_DEF: HeroDef = {
  ...HEROES.forge,
  health: 130,
  suit: 60,
  speed: 4.9,
  weapon: 'pulse',
  sealants: 0,
  // two servitors used to out-damage a DPS hero (2 × 69 dps): toned down to ~50 dps each
  builds: [{ id: 'servitor', name: { ru: 'Сервитор', en: 'Servitor' }, desc: { ru: '', en: '' }, unlock: 1, mods: { damage: 0.42, fireRate: 0.8 } }],
};
const SERVITOR_TOUGH_DEF: HeroDef = { ...SERVITOR_DEF, health: 190, suit: 90 };
const GRAPPLE_RANGE = 42;
const GRAPPLE_CD = 7;
const BOT_NAMES = ['Орбита', 'Кратер', 'Селен', 'Апогей', 'Перигей', 'Реголит', 'Тихо', 'Коперник', 'Кеплер', 'Аристарх', 'Гриммальди', 'Лангрен', 'Шеклтон', 'Армстронг', 'Гагарин', 'Терешкова'];

/**
 * One match: owns the fighters and all simulation systems for a world.
 */
const minimapCache = new Map<string, HTMLCanvasElement>();

export class Game {
  world: World;
  pipe: Pipeline;
  input: Input;
  settings: Settings;
  hooks: GameHooks;
  camera: THREE.PerspectiveCamera;
  effects: Effects;
  combat: Combat;
  abilities: Abilities;
  summons: Summons;
  /** chosen build per hero for the local player (from the profile) */
  builds: Partial<Record<HeroId, string>> = {};
  private ropes = new Map<number, THREE.Mesh>();
  private ropeGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  private ropeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfefff).multiplyScalar(2.2), toneMapped: false });
  match: Match;
  bots: Bots | null = null;
  viewmodel: Viewmodel;
  fighters: Fighter[] = [];
  local: Fighter | null = null;
  modeInfo: ModeInfo;
  net: NetBridge;
  thirdPerson = false;
  paused = false;
  private acc = 0;
  private nextId = 1;
  time = 0;
  private hudEvents: HudEvent[] = [];
  private hitmarker = 0;
  private hitHead = false;
  private hitKill = false;
  private damageDirs: { angle: number; alpha: number; world: THREE.Vector3 }[] = [];
  private camShake = 0;
  private camKick = 0;
  private camDip = 0;
  private recoilPitch = 0;
  private lookDX = 0;
  private lookDY = 0;
  private crouchToggle = false;
  private aimToggle = false;
  private lastKillT = -99;
  private multi = 0;
  private outOfBoundsT = 0;
  private sunDir: THREE.Vector3;
  private fps = 60;
  private fpsAcc = 0;
  private fpsN = 0;
  private hudState: HudState;
  private smoothEye = new THREE.Vector3();
  private stepAcc = 0;
  private breathing = 0;
  ended = false;

  constructor(opts: { world: World; pipe: Pipeline; input: Input; camera: THREE.PerspectiveCamera; settings: Settings; mode: ModeId; hero: HeroId; name: string; net: NetBridge; hooks: GameHooks; bots: boolean; builds?: Partial<Record<HeroId, string>> }) {
    this.world = opts.world;
    this.pipe = opts.pipe;
    this.input = opts.input;
    this.camera = opts.camera;
    this.settings = opts.settings;
    this.hooks = opts.hooks;
    this.net = opts.net;
    this.modeInfo = MODES[opts.mode];
    setGameLang(opts.settings.language);
    this.sunDir = this.world.sunDir.clone();
    this.effects = new Effects(this.world, this.camera, this.settings.quality);
    this.world.scene.add(this.effects.group);
    this.effects.setParticles(this.settings.particles ?? 'high');
    this.combat = new Combat(this);
    this.abilities = new Abilities(this);
    this.summons = new Summons(this);
    this.builds = { ...(opts.builds ?? {}) };
    this.match = new Match(this, this.modeInfo);
    this.viewmodel = new Viewmodel();
    this.pipe.overlayPass.scene = this.viewmodel.scene;
    this.pipe.overlayPass.camera = this.viewmodel.camera;
    this.viewmodel.setEnvironment(this.world.lighting.envMap, this.sunDir);
    if (this.isAuthority && opts.bots) this.bots = new Bots(this, this.settings.botDifficulty);
    this.hudState = this.blankHud();
    // local player
    const team = this.modeInfo.teams ? 0 : -1;
    this.local = this.addFighter(opts.name, team, opts.hero, 'local', 'local');
    this.local.applyBuild(this.builds[opts.hero] ?? '');
    // attachModel ran before `local` was set: apply the first-person body mode now
    this.local.model?.setFirstPerson(!this.thirdPerson);
    this.refreshHighlights();
    // engineers' salvage passive: destroying an enemy device patches you up (authority side)
    const sumDamage = this.summons.damage.bind(this.summons);
    this.summons.damage = (sm, amount, attacker) => {
      const was = !sm.dead;
      sumDamage(sm, amount, attacker);
      if (was && sm.dead && attacker && this.isAuthority) this.onSalvage(attacker);
    };
  }

  /** engineer role passive: +40 HP and a sliver of ult for every enemy device / servitor destroyed */
  private onSalvage(f: Fighter): void {
    const boss = f.summonOf >= 0 ? this.fighterById(f.summonOf) : f;
    if (!boss || !boss.alive || boss.rolePassive !== 'salvage') return;
    this.heal(boss, boss, 40, 15, true);
    boss.ultCharge = Math.min(boss.ultCostEff, boss.ultCharge + boss.ultCostEff * 0.04);
    if (boss === this.local) this.event({ type: 'toast', text: gs('salvage'), kind: 'good' });
  }

  /** knockback that also reaches fighters simulated on another peer (net relays it) */
  push(f: Fighter, v: THREE.Vector3): void {
    if (f.control !== 'remote') f.body.impulse(v);
    else this.onRemotePush?.(f, v);
  }
  onRemotePush: ((f: Fighter, v: THREE.Vector3) => void) | null = null;

  /** fighters that are real players or bots (not summoned servitors) */
  get players(): Fighter[] {
    return this.fighters.filter((f) => f.summonOf < 0);
  }

  /** the player a fighter belongs to (servitors → their engineer) */
  ownerId(f: Fighter): number {
    return f.summonOf >= 0 ? f.summonOf : f.id;
  }

  /** choose a build for a hero (local player: persisted by the profile) */
  setBuild(f: Fighter, id: string): void {
    if (f === this.local) this.builds[f.hero] = id;
    f.applyBuild(id);
  }

  get isAuthority(): boolean {
    return this.net.role !== 'client';
  }

  // ------------------------------------------------------------------ fighters

  addFighter(name: string, team: number, hero: HeroId, control: 'local' | 'bot' | 'remote', owner: string, id?: number): Fighter {
    const f = new Fighter(id ?? this.nextId++, name, team, hero, control, this.world.physics);
    if (id !== undefined) this.nextId = Math.max(this.nextId, id + 1);
    f.owner = owner;
    this.attachModel(f);
    this.fighters.push(f);
    f.respawnT = control === 'remote' ? 999 : control === 'local' ? 0 : 0.2 + Math.random() * 0.4;
    return f;
  }

  private attachModel(f: Fighter): void {
    if (f.model) {
      this.world.scene.remove(f.model.root);
      f.model.dispose();
    }
    const teamColor = this.modeInfo.teams ? TEAM_COLORS[f.team]?.main ?? null : null;
    f.model = new HeroModel(f.hero, teamColor);
    f.model.root.visible = false;
    this.world.scene.add(f.model.root);
    if (f === this.local) {
      f.model.setFirstPerson(!this.thirdPerson);
      this.viewmodel.setHero(f.hero, teamColor);
    }
    this.refreshHighlights();
  }

  refreshHighlights(): void {
    const me = this.local;
    for (const f of this.fighters) {
      if (!f.model || f === me) continue;
      f.model.setHighlight(me && this.areEnemies(me, f) ? 'enemy' : 'none');
    }
  }

  /** Fill empty slots with bots (authority only). */
  fillBots(): void {
    if (!this.isAuthority || !this.bots) return;
    const slots = this.modeInfo.slots;
    let n = 0;
    while (this.players.length < slots && n++ < 16) {
      let team = -1;
      if (this.modeInfo.teams) {
        const c0 = this.players.filter((f) => f.team === 0).length;
        const c1 = this.players.filter((f) => f.team === 1).length;
        team = c0 <= c1 ? 0 : 1;
      }
      const used = new Set(this.players.map((f) => f.name));
      const pool = BOT_NAMES.filter((x) => !used.has('[BOT] ' + x));
      const name = '[BOT] ' + (pool[Math.floor(Math.random() * pool.length)] ?? 'Луноход');
      const hero = this.bots.pickHero(team);
      const bot = this.addFighter(name, team, hero, 'bot', 'host');
      const builds = bot.def.builds;
      bot.applyBuild(builds[Math.floor(Math.random() * builds.length)]?.id ?? '');
    }
  }

  /** Remove a bot to make room for a joining human (same team if possible). */
  removeBotFor(team: number): boolean {
    const list = this.players;
    const bot = [...list].reverse().find((f) => f.isBot && (team < 0 || f.team === team)) ?? [...list].reverse().find((f) => f.isBot);
    if (!bot) return false;
    this.removeFighter(bot);
    return true;
  }

  removeFighter(f: Fighter): void {
    const i = this.fighters.indexOf(f);
    if (i >= 0) this.fighters.splice(i, 1);
    if (f.model) {
      this.world.scene.remove(f.model.root);
      f.model.dispose();
    }
    this.bots?.forget(f.id);
    const rope = this.ropes.get(f.id);
    if (rope) {
      this.world.scene.remove(rope);
      this.ropes.delete(f.id);
    }
    // an engineer leaving takes their servitors and devices along
    if (f.summonOf < 0) {
      for (const s of [...this.fighters]) if (s.summonOf === f.id) this.removeFighter(s);
      for (const d of this.summons.byOwner(f.id)) this.summons.destroy(d, false);
    }
  }

  // ------------------------------------------------------------------ servitors

  /** Forge: build a humanoid combat servitor next to the owner (authority). */
  spawnServitor(owner: Fighter): Fighter | null {
    const mine = this.fighters.filter((f) => f.summonOf === owner.id && f.alive);
    const max = Math.max(2, owner.abilities[0]?.maxCharges ?? 2);
    if (mine.length >= max) this.retireServitor(mine[0], true);
    const b = owner.body;
    const fwd = b.forward(new THREE.Vector3());
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(mine.length % 2 ? -1 : 1);
    let pos = b.pos.clone().addScaledVector(fwd, 1.6).addScaledVector(side, 0.9);
    const probe = pos.clone().add(new THREE.Vector3(0, 1, 0));
    if (this.world.physics.pointBlocked(probe, 0.45)) pos = b.pos.clone();
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    const f = this.makeServitor(owner, this.nextId++, pos, yaw, 'bot');
    this.netHook?.('servitor', { id: f.id, owner: owner.id, p: [pos.x, pos.y, pos.z], yaw, tough: owner.flags.has('toughServitors') ? 1 : 0 });
    return f;
  }

  private makeServitor(owner: Fighter, id: number, pos: THREE.Vector3, yaw: number, control: 'bot' | 'remote', tough = owner.flags.has('toughServitors')): Fighter {
    this.nextId = Math.max(this.nextId, id + 1);
    const f = new Fighter(id, gs('servitor'), owner.team, 'forge', control, this.world.physics);
    f.setHero('forge', tough ? SERVITOR_TOUGH_DEF : SERVITOR_DEF);
    f.body.standHeight = f.body.height = 1.7;
    f.body.radius = 0.38;
    f.summonOf = owner.id;
    f.summonLife = 25;
    f.owner = owner.owner;
    f.sealants = 0;
    const teamColor = this.modeInfo.teams ? TEAM_COLORS[f.team]?.main ?? null : null;
    f.model = new HeroModel('forge', teamColor, 'servitor');
    this.world.scene.add(f.model.root);
    this.fighters.push(f);
    f.spawn(pos, yaw);
    f.spawnProtect = 0;
    f.model.setWeapon(f.weapon.id);
    f.model.root.visible = true;
    this.refreshHighlights();
    this.effects.shockwave(pos.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, 1, 0), 2.5, 0xff9f43, 0.4, 0.5);
    this.effects.dust(pos, 16, 1.5);
    this.sound('deploy', null, 1, pos);
    return f;
  }

  /** client: mirror a servitor the host built */
  addServitorGhost(id: number, ownerId: number, pos: THREE.Vector3, yaw: number, tough: boolean): void {
    const owner = this.fighterById(ownerId);
    if (!owner || this.fighterById(id)) return;
    const f = this.makeServitor(owner, id, pos, yaw, 'remote', tough);
    f.summonLife = 999; // the host decides when it goes away
  }

  /** remove a servitor (timed out / replaced / owner gone) */
  retireServitor(f: Fighter, violent: boolean): void {
    if (violent || f.alive) {
      const c = f.body.center(new THREE.Vector3());
      this.effects.explosion(c, 1.2, 0xffa050, false);
      this.sound('explosion', null, 0.5, c);
    }
    f.alive = false;
    this.removeFighter(f);
    this.netHook?.('servitorGone', { id: f.id });
  }

  /** hitmarker feedback for hitting a deployable */
  localSummonHit(): void {
    this.hitmarker = Math.max(this.hitmarker, 0.7);
    this.hitHead = false;
    this.sound('hit_marker', null, 0.45);
  }

  viewmodelSwing(side: number): void {
    this.viewmodel.swing(side);
  }

  fighterById(id: number): Fighter | null {
    for (const f of this.fighters) if (f.id === id) return f;
    return null;
  }

  areEnemies(a: Fighter, b: Fighter): boolean {
    if (a === b) return false;
    if (!this.modeInfo.teams) return this.ownerId(a) !== this.ownerId(b);
    return a.team !== b.team;
  }

  setHero(f: Fighter, hero: HeroId): void {
    if (f.hero === hero) return;
    f.buildId = f === this.local ? this.builds[hero] ?? '' : '';
    if (f.isBot && f.summonOf < 0) {
      const list = HEROES[hero].builds;
      f.buildId = list[Math.floor(Math.random() * list.length)]?.id ?? '';
    }
    f.setHero(hero);
    // switching hero scraps the old kit's servitors and devices
    for (const s of [...this.fighters]) if (s.summonOf === f.id) this.retireServitor(s, true);
    if (this.isAuthority) for (const d of this.summons.byOwner(f.id)) this.summons.destroy(d, true);
    this.attachModel(f);
    f.ultCharge = 0;
  }

  // ------------------------------------------------------------------ damage & healing (authority)

  damage(d: DamageSpec): void {
    const t = d.target;
    if (!t.alive) return;
    if (!this.isAuthority) {
      // client: forward the claim to the host, show local feedback immediately
      if (d.attacker === this.local && !d.silent) this.localHitFeedback(d, false);
      this.onClientClaim?.(d);
      return;
    }
    if (t.invulnT > 0 || t.spawnProtect > 0) return;
    // servitor damage is credited to its engineer
    if (d.attacker && d.attacker.summonOf >= 0) {
      const boss = this.fighterById(d.attacker.summonOf);
      if (boss && boss !== t) d = { ...d, attacker: boss, source: 'servitor', silent: true };
    }
    let amt = d.amount;
    if (amt <= 0) return;
    const a = d.attacker;
    amt *= this.passiveDamageMul(d, t, a);
    if (d.slow && d.slow > 0 && a && this.areEnemies(a, t)) t.slowT = Math.max(t.slowT, d.slow * (t.rolePassive === 'heavy' ? 0.5 : 1));
    // force field absorbs first
    if (t.shieldHp > 0 && d.source !== 'suffocation' && d.source !== 'radiation') {
      const ab = Math.min(t.shieldHp, amt);
      t.shieldHp -= ab;
      amt -= ab;
      if (d.point && Math.random() < 0.5) this.effects.impact(d.point, d.dir ? d.dir.clone().negate() : new THREE.Vector3(0, 1, 0), 'shield', 0x6fd0ff);
      if (t.shieldHp <= 0) {
        t.shieldT = 0;
        this.sound('shield_down', t, 0.7);
      } else if (!d.silent) this.sound('shield_hit', t, 0.5);
      if (a && a !== t) {
        a.stats.damage += ab * 0.5;
        a.ultCharge = Math.min(a.ultCostEff, a.ultCharge + ab * 0.5);
      }
      if (amt <= 0) {
        if (a === this.local && a !== t && !d.silent) this.localHitFeedback({ ...d, amount: ab }, false);
        return;
      }
    }
    // damage model: health takes the hit, suit integrity tears proportionally
    t.health -= amt;
    t.suit = Math.max(0, t.suit - amt * d.suitMul * 0.6);
    if (!d.noCredit) {
      t.lastDamageT = 0;
      if (a && a !== t) {
        t.lastAttacker = a.id;
        t.lastAttackerT = 0;
        t.assistMap.set(a.id, this.time);
      }
    }
    // signature passives that react to hits
    if (a && a !== t && this.areEnemies(a, t)) {
      if (a.passive === 'spotter' && d.part === 'head' && !d.silent) t.revealedT = Math.max(t.revealedT, 3);
      if (a.passive === 'dronelink' && d.source === 'burst') {
        t.markedBy = a.id;
        t.markT = 2.5;
        t.revealedT = Math.max(t.revealedT, 1.5);
      }
    }
    if (a && a !== t) {
      a.stats.damage += amt;
      a.ultCharge = Math.min(a.ultCostEff, a.ultCharge + amt * (t.summonOf >= 0 ? 0.5 : 1));
      if (!d.silent) {
        a.stats.hits++;
        const ws = a.stats.weapons[d.source as WeaponId];
        if (ws) ws.hits++;
      }
    }
    if (!d.silent) t.model?.hit();
    const killed = t.health <= 0;
    if (a === this.local && a !== t && !d.silent) this.localHitFeedback(d, killed);
    else if (a === this.local && a !== t && d.silent && Math.random() < 0.1) this.localHitFeedback(d, killed);
    if (t === this.local && d.dir) this.addDamageDir(d);
    if (t === this.local) {
      this.camShake = Math.max(this.camShake, Math.min(0.5, amt / 80));
      if (!d.silent) this.sound('hurt', t, Math.min(1, amt / 40));
    }
    this.onDamageApplied?.(d, killed);
    if (killed) this.kill(t, a, d);
  }

  /**
   * Damage multipliers from signature passives (authority): Reactor's fusion plating while the suit
   * holds, Phantom's backstab, Hive's drones against marked targets.
   */
  passiveDamageMul(d: DamageSpec, t: Fighter, a: Fighter | null): number {
    let m = 1;
    const env = d.source === 'suffocation' || d.source === 'radiation' || d.source === 'fall';
    if (t.passive === 'fusion' && !env && t.suitFrac >= 0.5) m *= 0.8;
    if (a && a !== t && this.areEnemies(a, t)) {
      if (a.passive === 'backstab' && d.dir && !env) {
        // shot travels the way the target faces → it came from behind
        const fwd = t.body.forward(_w);
        const hd = _v.set(d.dir.x, 0, d.dir.z);
        if (hd.lengthSq() > 1e-4 && hd.normalize().dot(_w.setY(0).normalize()) > 0.4) m *= 1.25;
      }
      if (a.passive === 'dronelink' && t.markedBy === a.id && t.markT > 0 && (d.source === 'huntdrone' || d.source === 'turret' || d.source === 'kamikaze' || d.source === 'servitor')) m *= 1.25;
    }
    return m;
  }

  /** extra hooks used by the network layer */
  onClientClaim: ((d: DamageSpec) => void) | null = null;
  onClientHeal: ((t: Fighter, hp: number, suit: number) => void) | null = null;
  onClientSeal: (() => void) | null = null;
  onClientSummonClaim: ((s: import('./Summons').Summon, amount: number) => void) | null = null;
  /** host: replicated match events (pickups, pods, captures, end) */
  netHook: ((ev: string, data: unknown) => void) | null = null;
  onDamageApplied: ((d: DamageSpec, killed: boolean) => void) | null = null;
  onKillEvent: ((victim: Fighter, killer: Fighter | null, source: DamageSource, head: boolean, wall: boolean) => void) | null = null;

  heal(t: Fighter, healer: Fighter | null, hp: number, suit: number, silent = false): void {
    if (!t.alive) return;
    if (!this.isAuthority) {
      if (healer === this.local) this.onClientHeal?.(t, hp, suit);
      return;
    }
    const before = t.health + t.suit;
    t.health = Math.min(t.maxHealth, t.health + hp);
    t.suit = Math.min(t.maxSuit, t.suit + suit);
    const gained = t.health + t.suit - before;
    if (healer && gained > 0) {
      healer.stats.healing += gained;
      if (healer !== t) healer.ultCharge = Math.min(healer.ultCostEff, healer.ultCharge + gained * 0.8);
    }
    if (!silent && gained > 1 && t.model) this.effects.add.spawn({ pos: t.body.center(new THREE.Vector3()), vel: new THREE.Vector3(0, 1, 0), life: 0.8, size0: 0.35, size1: 0.05, color0: 0x7dff9a, alpha0: 0.8, sprite: 4 });
  }

  applyEmp(f: Fighter, seconds: number): void {
    f.empT = Math.max(f.empT, seconds);
    if (f.control !== 'remote') {
      f.body.emp(seconds);
      if (f.body.onWall) f.body.impulse(f.body.up.clone().multiplyScalar(1));
    }
  }

  private kill(t: Fighter, a: Fighter | null, d: DamageSpec): void {
    if (t.summonOf >= 0) {
      // servitor destroyed: small score, no death / kill feed
      t.alive = false;
      t.health = 0;
      t.respawnT = 2.5;
      if (a && a !== t) {
        a.stats.score += 25;
        if (a === this.local) this.xp(a, 25, 'servitorKill');
        this.onSalvage(a);
      }
      const c = t.body.center(new THREE.Vector3());
      this.effects.explosion(c, 1.4, 0xffa050, false);
      this.sound('explosion', null, 0.6, c);
      this.onKillEvent?.(t, a, d.source, false, false);
      return;
    }
    t.alive = false;
    t.health = 0;
    t.respawnT = this.match.respawnDelay();
    t.stats.deaths++;
    t.stats.streak = 0;
    t.sealT = -1;
    const killer = a && a !== t ? a : t.lastAttackerT < 30 ? this.fighterById(t.lastAttacker) : null;
    const source = d.source;
    const head = d.part === 'head' && !d.silent;
    const wall = !!killer && killer.body.onWall;
    if (killer && killer !== t) {
      killer.stats.kills++;
      killer.stats.streak++;
      killer.stats.bestStreak = Math.max(killer.stats.bestStreak, killer.stats.streak);
      killer.stats.score += 100 + (head ? 25 : 0);
      if (head) killer.stats.headshots++;
      if (wall) killer.stats.wallKills++;
      if (source === 'suffocation') killer.stats.suffocations++;
      if (killer.ult.active > 0 || source === 'swarm' || source === 'blackhole' || source === 'nuke' || source === 'empnova') killer.stats.ultKills++;
      const ws = killer.stats.weapons[source as WeaponId];
      if (ws) ws.kills++;
      const dist = killer.body.pos.distanceTo(t.body.pos);
      killer.stats.longestKill = Math.max(killer.stats.longestKill, dist);
      killer.ultCharge = Math.min(killer.ultCostEff, killer.ultCharge + 150);
      // melee role passive: eliminations restore health
      if (killer.rolePassive === 'bloodrush' && killer.alive) this.heal(killer, killer, 50, 0, true);
      if (killer.flags.has('lungeReset')) {
        const l = killer.abilities.find((x) => x.id === 'lunge');
        if (l) {
          l.charges = l.maxCharges;
          l.cooldown = 0;
        }
      }
    }
    // assists
    for (const [id, when] of t.assistMap) {
      if (killer && id === killer.id) continue;
      if (this.time - when > 8) continue;
      const as = this.fighterById(id);
      if (!as) continue;
      as.stats.assists++;
      as.stats.score += 50;
      if (as === this.local) this.xp(as, 50, 'assist');
    }
    this.match.onKill(killer, t);
    this.onKillEvent?.(t, killer, source, head, wall);
    this.announceKill(t, killer, source, head, wall);
  }

  announceKill(t: Fighter, killer: Fighter | null, source: DamageSource, head: boolean, wall: boolean): void {
    const me = this.local;
    this.event({
      type: 'kill',
      killer: killer ? killer.name : t.name,
      killerHero: killer ? killer.hero : t.hero,
      killerTeam: killer ? killer.team : t.team,
      victim: t.name,
      victimHero: t.hero,
      victimTeam: t.team,
      weapon: (source === 'radiation' ? 'nuke' : source) as HudEvent extends { type: 'kill'; weapon: infer W } ? W : never,
      headshot: head,
      wall,
      local: killer === me && me ? 'killer' : t === me ? 'victim' : me && t.assistMap.has(me.id) ? 'assist' : 'none',
    });
    if (killer === me && me && t !== me) {
      this.xp(me, 100, 'elimination');
      if (head) this.xp(me, 25, 'headshot');
      if (wall) this.xp(me, 50, 'wallkill');
      this.hitKill = true;
      this.sound(head ? 'headshot' : 'kill_confirm', null, 1);
      if (this.time - this.lastKillT < 4) this.multi++;
      else this.multi = 1;
      this.lastKillT = this.time;
      if (this.multi >= 2) this.event({ type: 'toast', text: gs('multikill', { n: this.multi }), kind: 'good' });
      if (me.stats.streak === 5 || me.stats.streak === 10) {
        this.event({ type: 'big', title: gs('streak', { n: me.stats.streak }), kind: 'good' });
        this.sound('streak', null, 1);
      }
    }
    this.sound('death', t, 0.8);
    if (t === me) {
      this.hooks.onLocalDeath();
    }
  }

  xp(f: Fighter, amount: number, key: string): void {
    if (f !== this.local) return;
    this.event({ type: 'xp', amount, label: gs(key) });
  }

  private localHitFeedback(d: DamageSpec, killed: boolean): void {
    this.hitmarker = 1;
    this.hitHead = d.part === 'head';
    if (killed) this.hitKill = true;
    this.sound(this.hitHead ? 'headshot' : 'hit_marker', null, 0.7);
    if (this.settings.damageNumbers && d.point) {
      const p = d.point.clone().project(this.camera);
      if (p.z < 1) this.event({ type: 'damage', amount: Math.round(d.amount), x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, head: this.hitHead });
    }
  }

  private addDamageDir(d: DamageSpec): void {
    const src = d.attacker ? d.attacker.body.pos.clone() : d.point ? d.point.clone().sub(d.dir!.clone().multiplyScalar(5)) : null;
    if (!src) return;
    this.damageDirs.push({ angle: 0, alpha: 1, world: src });
    if (this.damageDirs.length > 6) this.damageDirs.shift();
  }

  // ------------------------------------------------------------------ hooks used by systems

  sound(name: string, f: Fighter | null, vol = 1, pos?: THREE.Vector3): void {
    if (f && f === this.local) audio.play(name as Sfx, { volume: vol });
    else audio.play(name as Sfx, { pos: pos ?? (f ? f.body.center(new THREE.Vector3()) : undefined), volume: vol });
  }

  event(e: HudEvent): void {
    this.hooks.hudEvent(e);
  }

  announce(key: string, f: Fighter | null): void {
    if (key === 'nukeReady' && f !== this.local) {
      this.event({ type: 'big', title: gs('nukeIncoming'), kind: 'bad' });
      this.sound('pod_incoming', null, 1);
      return;
    }
    this.event({ type: 'big', title: gs(key), kind: f === this.local ? 'good' : 'warn' });
  }

  onFired(f: Fighter, w: WeaponState): void {
    const def = w.def;
    this.sound(def.sfx, f, def.id === 'twinarc' ? 0.6 : 1);
    f.model?.fired();
    const muzzle = this.muzzleOf(f);
    this.effects.muzzle(muzzle, f.body.viewDir(_v), def.color, def.id === 'rail' || def.id === 'nuke' ? 1.6 : def.id === 'twinarc' ? 0.6 : 1);
    if (f === this.local) {
      this.viewmodel.fired(def.recoil);
      // the real aim punch is applied by Combat.kick; this is only a short visual camera snap
      this.recoilPitch += def.recoil * (f.intent.aim ? 0.3 : 0.5);
      this.camKick = Math.min(1, this.camKick + def.recoil * 4);
    }
    if (def.id === 'nuke') this.announce('nukeReady', f);
  }

  onWeaponSwitch(f: Fighter): void {
    this.sound('switch', f, 0.8);
    if (f.model) f.model.setWeapon(f.activeWeapon.id);
  }

  muzzleOf(f: Fighter): THREE.Vector3 {
    if (f === this.local && !this.thirdPerson && this.viewmodel.muzzle) {
      // project the viewmodel muzzle into the world camera frustum
      const m = this.viewmodel.muzzle.getWorldPosition(new THREE.Vector3());
      const ndc = m.clone().applyMatrix4(this.viewmodel.camera.matrixWorldInverse).applyMatrix4(this.viewmodel.camera.projectionMatrix);
      const p = new THREE.Vector3(ndc.x, ndc.y, 0.2).unproject(this.camera);
      const eye = this.camera.position;
      return eye.clone().add(p.sub(eye).normalize().multiplyScalar(0.8));
    }
    return f.model ? f.model.muzzleWorld.clone() : f.eye(new THREE.Vector3());
  }

  packOf(f: Fighter): THREE.Vector3 {
    return f.model ? f.model.packWorld.clone() : f.body.center(new THREE.Vector3());
  }

  onBreach(f: Fighter): void {
    if (f === this.local) {
      this.event({ type: 'big', title: gs('breach'), sub: gs('breachSub', { key: this.keyLabel('sealant') }), kind: 'bad' });
      this.sound('breach', f, 1);
    } else this.sound('breach', f, 0.6);
  }

  onNuke(pos: THREE.Vector3, radius: number): void {
    // lingering radiation: suit damage over time (authority)
    if (!this.isAuthority) return;
    const until = this.time + 18;
    const tick = () => {
      if (this.ended || this.time > until) return;
      for (const f of this.fighters) {
        if (!f.alive) continue;
        if (f.body.pos.distanceTo(pos) < radius * 0.9) {
          f.suit = Math.max(0, f.suit - 6);
          f.oxygen = Math.max(0, f.oxygen - 1);
        }
      }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1500);
  }

  onCapture(id: 'A' | 'B' | 'C', team: number): void {
    this.netHook?.('cap', { id, team });
    const me = this.local;
    const mine = me && me.team === team;
    this.event({ type: 'capture', id, team, local: !!mine });
    this.event({ type: 'big', title: gs(mine ? 'captured' : 'lost', { id }), kind: mine ? 'good' : 'bad' });
    this.sound(mine ? 'capture' : 'point_lost', null, 1);
  }

  onPickup(f: Fighter, kind: string, pos: THREE.Vector3, index = -1): void {
    this.netHook?.('pick', { i: index, f: f.id });
    this.sound(kind === 'o2' ? 'o2_refill' : 'pickup', f, 0.9);
    const col = kind === 'o2' ? 0x7dd8ff : kind === 'armor' ? 0xffd24a : kind === 'ammo' ? 0xff8a3a : 0x9dff7a;
    this.effects.add.spawn({ pos: pos.clone().add(new THREE.Vector3(0, 0.8, 0)), life: 0.4, size0: 0.5, size1: 2.5, color0: col, alpha0: 0.7, sprite: 3 });
    if (f === this.local) this.pickupFeedback(f, kind);
  }

  /** HUD line for the local player's pickup: what it actually gave */
  pickupFeedback(f: Fighter, kind: string): void {
    if (f !== this.local) return;
    const g = this.match.lastGain;
    const parts: string[] = [];
    if (g.hp > 0) parts.push(`+${g.hp} ${gs('hpShort')}`);
    if (g.suit > 0) parts.push(`+${g.suit}% ${gs('suitShort')}`);
    if (g.o2 > 0) parts.push(`+${g.o2}% O₂`);
    if (g.ult > 0) parts.push(`+${g.ult}% ${gs('ultShort')}`);
    const title = gs('pk_' + kind);
    this.event({ type: 'toast', text: parts.length ? `${title} · ${parts.join(' · ')}` : title, kind: 'good' });
  }

  onPodIncoming(pos: THREE.Vector3, weapon?: WeaponId): void {
    if (weapon) this.netHook?.('pod', { p: [pos.x, pos.y, pos.z], w: weapon });
    this.event({ type: 'big', title: gs('podIncoming'), sub: gs('podIncomingSub'), kind: 'info' });
    this.sound('pod_incoming', null, 1);
  }

  onPodTaken(f: Fighter, w: WeaponId): void {
    this.netHook?.('podt', { f: f.id, w });
    this.event({ type: 'toast', text: gs('podTaken', { name: f.name, weapon: w }), kind: f === this.local ? 'good' : 'info' });
    this.sound('pickup', f, 1);
    if (f === this.local) this.xp(f, 50, 'xpPod');
  }

  onMatchEnd(): void {
    if (this.ended) return;
    this.ended = true;
    this.netHook?.('end', { winner: this.match.winner, scores: this.match.teamScores });
    const me = this.local;
    if (!me) return;
    const res = this.match.result(me.id);
    const title = res.won === null ? gs('draw') : res.won ? gs('victory') : gs('defeat');
    this.sound(res.won ? 'victory' : 'defeat', null, 1);
    this.event({ type: 'big', title, kind: res.won ? 'good' : 'bad' });
    setTimeout(() => this.hooks.onMatchEnd(res), 3500);
  }

  // ------------------------------------------------------------------ input

  private isAction(a: Action): boolean {
    const code = this.settings.keys[a];
    if (!code) return false;
    if (code.startsWith('Mouse')) return this.input.mouse[Number(code.slice(5))] ?? false;
    return this.input.isDown(code);
  }
  private pressedAction(a: Action): boolean {
    const code = this.settings.keys[a];
    if (!code) return false;
    if (code.startsWith('Mouse')) return this.input.mousePressed[Number(code.slice(5))] ?? false;
    return this.input.wasPressed(code);
  }
  keyLabel(a: Action): string {
    const c = this.settings.keys[a] ?? '';
    return c.replace('Key', '').replace('Digit', '').replace('Mouse0', 'ЛКМ').replace('Mouse2', 'ПКМ').replace('ShiftLeft', 'Shift').replace('ControlLeft', 'Ctrl');
  }

  private readLocalIntent(): void {
    const f = this.local;
    if (!f) return;
    const it = f.intent;
    const locked = this.input.locked && !this.paused;
    it.forward = locked ? (this.isAction('forward') ? 1 : 0) - (this.isAction('back') ? 1 : 0) : 0;
    it.strafe = locked ? (this.isAction('right') ? 1 : 0) - (this.isAction('left') ? 1 : 0) : 0;
    it.jump = locked && this.isAction('jump');
    it.jumpPressed = locked && this.pressedAction('jump');
    if (this.settings.toggleCrouch) {
      if (locked && this.pressedAction('crouch')) this.crouchToggle = !this.crouchToggle;
      it.crouch = this.crouchToggle;
    } else it.crouch = locked && this.isAction('crouch');
    it.fire = locked && this.isAction('fire');
    it.firePressed = locked && this.pressedAction('fire');
    if (this.settings.toggleAim) {
      if (locked && this.pressedAction('aim')) this.aimToggle = !this.aimToggle;
      it.aim = this.aimToggle;
    } else it.aim = locked && this.isAction('aim');
    it.altPressed = locked && this.pressedAction('aim');
    // sprint (Shift): forward only; firing or aiming drops back to a walk
    it.sprint = locked && this.isAction('sprint') && !it.fire && !it.aim;
    it.reload = locked && this.pressedAction('reload');
    it.ability1 = locked && this.pressedAction('ability1');
    it.ability2 = locked && this.pressedAction('ability2');
    it.ultimate = locked && this.pressedAction('ultimate');
    it.slot = locked && this.pressedAction('weapon1') ? 0 : locked && this.pressedAction('weapon2') ? 1 : -1;
    if (locked && this.input.wheel !== 0 && f.superWeapon) it.slot = f.slot === 0 ? 1 : 0;
    it.sealant = locked && this.pressedAction('sealant');
    it.toggleMag = locked && this.pressedAction('mag');
    it.grapple = locked && this.pressedAction('grapple');
    it.melee = locked && this.pressedAction('melee');
    it.prone = locked && this.pressedAction('prone');
    it.roll = locked && this.pressedAction('roll');
    if (locked && this.pressedAction('view')) this.setThirdPerson(!this.thirdPerson);
    this.hooks.scoreboard(this.isAction('scoreboard'));
    // mouse look
    const wd = f.activeWeapon.def;
    const ads = it.aim && adsCapable(wd) ? this.settings.adsSensitivity * (wd.zoom < 0.5 ? wd.zoom * 1.6 : 1) : 1;
    const sens = 0.0021 * this.settings.sensitivity * ads;
    this.lookDX = locked ? this.input.mouseDX : 0;
    this.lookDY = locked ? this.input.mouseDY : 0;
    this.pendingYaw += -this.lookDX * sens;
    this.pendingPitch += -this.lookDY * sens * (this.settings.invertY ? -1 : 1);
  }
  private pendingYaw = 0;
  private pendingPitch = 0;

  setThirdPerson(v: boolean): void {
    this.thirdPerson = v;
    this.local?.model?.setFirstPerson(!v);
  }

  // ------------------------------------------------------------------ main update

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    this.readLocalIntent();
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED && steps < 6) {
      this.acc -= FIXED;
      steps++;
      this.fixedStep(FIXED, steps === 1);
    }
    this.render(dt);
    this.input.endFrame();
  }

  private fixedStep(dt: number, first: boolean): void {
    this.time += dt;
    const me = this.local;
    // look input is applied once per frame (first step)
    if (me) {
      me.intent.yaw = first ? this.pendingYaw : 0;
      me.intent.pitch = first ? this.pendingPitch : 0;
      if (first) {
        this.pendingYaw = 0;
        this.pendingPitch = 0;
      }
      if (!first) {
        me.intent.jumpPressed = false;
        me.intent.firePressed = false;
        me.intent.ability1 = me.intent.ability2 = me.intent.ultimate = false;
        me.intent.reload = me.intent.sealant = me.intent.toggleMag = false;
        me.intent.grapple = me.intent.melee = me.intent.prone = me.intent.roll = false;
        me.intent.altPressed = false;
        me.intent.slot = -1;
      }
    }
    for (const f of [...this.fighters]) {
      if (f.control === 'remote') {
        if (this.isAuthority) updateVitals(this, f, dt);
        if (f.ropeT > 0) {
          f.ropeT -= dt;
          if (f.ropeT <= 0) f.rope = null;
        }
        continue;
      }
      // servitors: limited lifetime, removed shortly after destruction
      if (f.summonOf >= 0) {
        if (!f.alive) {
          f.respawnT -= dt;
          if (f.respawnT <= 0 && this.isAuthority) this.removeFighter(f);
          continue;
        }
        f.summonLife -= dt;
        if (f.summonLife <= 0 && this.isAuthority) {
          this.retireServitor(f, true);
          continue;
        }
      }
      // respawn
      if (!f.alive) {
        if (this.isAuthority || f === me) {
          f.respawnT -= dt;
          if (f.respawnT <= 0 && this.isAuthority && !this.match.over && !(f === me && this.heroSelectOpen)) this.respawn(f);
        }
        continue;
      }
      if (f.control === 'bot' && this.bots) this.bots.update(f, dt);
      this.stepFighter(f, dt);
    }
    this.combat.update(dt);
    this.abilities.update(dt);
    this.summons.update(dt);
    this.match.update(dt);
  }

  heroSelectOpen = false;

  respawn(f: Fighter): void {
    const s = this.match.pickSpawn(f);
    f.spawn(s.pos, s.yaw);
    if (f.model) {
      f.model.setWeapon(f.weapon.id);
      f.model.root.visible = true;
    }
    if (f === this.local) {
      this.viewmodel.setHero(f.hero, this.modeInfo.teams ? TEAM_COLORS[f.team].main : null);
      this.recoilPitch = 0;
      this.smoothEye.copy(f.eye(new THREE.Vector3()));
      this.sound('respawn', f, 1);
    }
    this.onRespawn?.(f);
  }
  onRespawn: ((f: Fighter) => void) | null = null;

  /** Simulate one locally-controlled fighter (player or bot). */
  private stepFighter(f: Fighter, dt: number): void {
    const it = f.intent;
    const b = f.body;
    if (it.toggleMag) {
      b.magOn = !b.magOn;
      this.sound(b.magOn ? 'mag_on' : 'mag_off', f, 0.9);
    }
    if (it.sealant && f.sealants > 0 && f.sealT < 0 && f.suit < f.maxSuit * 0.98) {
      f.sealants--;
      f.sealT = 1.2;
      this.sound('sealant', f, 0.8);
      if (!this.isAuthority && f === this.local) this.onClientSeal?.();
    }
    if (!this.isAuthority && f.sealT > 0) {
      f.sealT -= 1 / 60;
      if (f.sealT <= 0) f.sealT = -1;
    }
    // movement speed modifiers
    const w = f.activeWeapon;
    const slowK = f.rolePassive === 'heavy' ? 0.8 : 0.6; // tanks shrug off half of a slow
    const scoped = it.aim && w.def.alt === 'scope';
    b.speedMul = (f.def.speed / 4.4) * w.def.moveMul * (f.mods.speed ?? 1) * (f.slowT > 0 ? slowK : 1) * (f.cloakT > 0 ? 1.2 : 1) * (scoped ? 0.55 : it.aim && adsCapable(w.def) ? 0.85 : 1) * (f.sealT > 0 ? 0.6 : 1) * (f.moonbladeT > 0 ? 1.15 : 1) * (f.deflectT > 0 ? 0.85 : 1);
    this.tuneBody(f);
    if (f.empT > 0) b.jetFuel = Math.min(b.jetFuel, 0);
    if (it.grapple) this.useGrapple(f);
    if (it.melee && f.alive) this.combat.quickMelee(f);
    if (b.grapple && f.empT > 0) b.stopGrapple(true);
    // two physics substeps for stable contacts; events accumulate over the whole tick
    const half = dt / 2;
    const yaw = it.yaw;
    const pitch = it.pitch;
    b.clearEvents();
    b.step(half, it, true);
    it.yaw = 0;
    it.pitch = 0;
    // "pressed" inputs fire once per tick, not once per substep
    const jp = it.jumpPressed;
    const pr = it.prone;
    const ro = it.roll;
    it.jumpPressed = it.prone = it.roll = false;
    b.step(half, it, true);
    it.jumpPressed = jp;
    it.prone = pr;
    it.roll = ro;
    // keep this tick's look deltas readable (recoil compensation in Combat)
    it.yaw = yaw;
    it.pitch = pitch;
    // bounds: gentle push back into the arena
    const bd = this.world.physics.bounds;
    if (b.pos.x < bd.minX) b.vel.x += (bd.minX - b.pos.x) * 4 * dt;
    if (b.pos.x > bd.maxX) b.vel.x -= (b.pos.x - bd.maxX) * 4 * dt;
    if (b.pos.z < bd.minZ) b.vel.z += (bd.minZ - b.pos.z) * 4 * dt;
    if (b.pos.z > bd.maxZ) b.vel.z -= (b.pos.z - bd.maxZ) * 4 * dt;
    // altitude ceiling: knockback stacking can't launch anyone into orbit
    const ground = this.world.terrainData.hf.heightAt(b.pos.x, b.pos.z);
    if (b.pos.y > ground + 70 && b.vel.y > 0) b.vel.y *= Math.max(0, 1 - dt * 6);
    if (b.vel.y > 26) b.vel.y = 26;
    // fell through the world (safety)
    if (b.pos.y < this.world.terrainData.hf.heightAt(b.pos.x, b.pos.z) - 8) {
      b.pos.y = this.world.terrainData.hf.heightAt(b.pos.x, b.pos.z) + 1;
      b.vel.set(0, 0, 0);
    }
    this.combat.tickWeapon(f, dt);
    this.abilities.tick(f, dt);
    if (this.isAuthority) updateVitals(this, f, dt);
    else if (f === this.local) {
      // clients run their own status timers (the host only sends fresh values); without this an EMP
      // or slow received from the host never wore off on the client
      f.empT = Math.max(0, f.empT - dt);
      f.slowT = Math.max(0, f.slowT - dt);
      f.revealedT = Math.max(0, f.revealedT - dt);
      f.firingVisual = Math.max(0, f.firingVisual - dt);
      f.spawnProtect = Math.max(0, f.spawnProtect - dt);
      f.markT = Math.max(0, f.markT - dt);
      f.lastDamageT += dt;
    }
    this.fighterEvents(f);
  }

  /** Per-hero movement tuning (signature / role passives) applied to the body every tick. */
  private tuneBody(f: Fighter): void {
    const b = f.body;
    const pas = f.passive;
    const role = f.rolePassive;
    // Condor's afterburner: 60 % faster refuel, and the pack refuels slowly while coasting in the air
    b.jetRegen = pas === 'afterburner' ? 0.8 : 0.5;
    b.jetRegenAir = pas === 'afterburner' ? 0.35 : 0;
    // Blade's moon step: one extra mid-air jump
    b.airJumps = pas === 'moonstep' ? 1 : 0;
    // melee role: better air control; scouts: faster mag-boot walking
    b.airControl = role === 'bloodrush' ? 3.1 : 2.4;
    b.magSpeedMul = role === 'lightstep' ? 1.25 : 1;
  }

  /** Grappling hook (universal gadget): fire / release. */
  useGrapple(f: Fighter): void {
    const b = f.body;
    if (b.grapple) {
      b.stopGrapple(true);
      return;
    }
    if (f.grappleCd > 0 || f.empT > 0 || f.sealT > 0 || !f.alive) {
      if (f === this.local && f.grappleCd > 0) this.sound('dryfire', f, 0.4);
      return;
    }
    const eye = f.eye(new THREE.Vector3());
    const dir = b.viewDir(new THREE.Vector3());
    const hit = this.world.physics.raycast(eye, dir, GRAPPLE_RANGE, { forMove: true });
    const from = f === this.local && !this.thirdPerson ? eye.clone().addScaledVector(dir, 0.5).addScaledVector(b.right(_v), -0.2).addScaledVector(b.up, -0.25) : this.handOf(f);
    if (!hit || hit.t < 2.5) {
      // miss: the hook flies out and reels back
      const end = eye.clone().addScaledVector(dir, hit ? hit.t : GRAPPLE_RANGE);
      this.effects.beam(from, end, 0xbfefff, 0.02, 0.25);
      this.sound('grapple_fire', f, 0.7);
      f.grappleCd = 1;
      return;
    }
    b.startGrapple(hit.point, hit.normal, hit.metal);
    f.grappleCd = GRAPPLE_CD;
    f.rope = hit.point.clone();
    this.sound('grapple_fire', f, 1);
    this.sound('grapple_hit', null, 0.9, hit.point);
    this.effects.impact(hit.point, hit.normal, hit.metal ? 'metal' : 'dirt', 0xbfefff);
    this.net.ability(f, 'grapple', hit.point);
  }

  handOf(f: Fighter): THREE.Vector3 {
    return f.model ? f.model.handLWorld.clone() : f.body.center(new THREE.Vector3());
  }

  /** Sounds & effects from body events. */
  private fighterEvents(f: Fighter): void {
    const ev = f.body.events;
    const b = f.body;
    if (ev.rolled) {
      this.sound('roll', f, 0.8);
      this.effects.dust(b.pos, 8, 1);
    }
    if (ev.slid) {
      this.sound('slide', f, 0.8);
      if (!b.onMetal) this.effects.dust(b.pos, 14, 1.4);
    }
    if (ev.mantled) this.sound('mantle', f, 0.8);
    if (ev.airbrake) {
      this.sound('airbrake', f, 0.9);
      const p = this.packOf(f);
      for (let i = 0; i < 12; i++) this.effects.jet(p, _v.copy(b.vel).normalize());
    }
    if (ev.grappleEnd) {
      f.rope = null;
      if (f === this.local || f.control === 'bot') this.net.ability(f, 'grappleEnd');
    }
    if (b.grapple && Math.random() < 0.5) this.effects.jet(this.packOf(f), _v.copy(b.vel).normalize().negate());
    if (ev.footstep) {
      // scouts (light step) are much harder to hear
      this.sound(b.onMetal ? 'footstep_metal' : 'footstep', f, f === this.local ? 0.5 : f.rolePassive === 'lightstep' ? 0.3 : 0.8);
      if (!b.onMetal && b.grounded) {
        this.effects.dust(b.pos, 3, 0.6);
        f.lastStepFoot ^= 1;
        const side = b.right(_v).multiplyScalar(f.lastStepFoot ? 0.12 : -0.12);
        const yaw = Math.atan2(-b.forward(_w).x, -b.forward(_w).z);
        this.effects.footprint(b.pos.clone().add(side), yaw, b.groundNormal);
      }
    }
    if (ev.landed > 0) {
      if (ev.landed > 1.5) {
        this.sound('land', f, Math.min(1, ev.landed / 5));
        if (!b.onMetal) this.effects.dust(b.pos, Math.min(24, 4 + ev.landed * 4), Math.min(2.5, 0.6 + ev.landed * 0.3));
        if (f === this.local) {
          this.camDip = Math.min(0.25, ev.landed * 0.04);
          this.viewmodel.land(ev.landed);
        }
      }
      // hard landings hurt a little: in 1/6 g you need a ~25 m drop to land at 9 m/s (scouts: ~37 m).
      // Reactor's slam dive is a deliberate landing and never hurts.
      const safe = 9 + (f.rolePassive === 'lightstep' ? 2 : 0);
      if (ev.landed > safe && this.isAuthority && f.slam <= 0 && f.slamGrace <= 0) this.damage({ target: f, attacker: null, amount: (ev.landed - safe) * 8, source: 'fall', part: 'legs', dir: null, point: null, suitMul: 0.5, silent: true });
    }
    if (ev.jumped) this.sound('jump', f, f === this.local ? 0.6 : 0.8);
    if (ev.jetStart) this.sound('jet_start', f, 0.7);
    if (ev.attached && b.up.y < 0.8) this.sound('mag_clamp', f, 0.8);
  }

  // ------------------------------------------------------------------ rendering

  private render(dt: number): void {
    const me = this.local;
    const cam = this.camera;
    // fighter models
    for (const f of this.fighters) {
      if (!f.model) continue;
      const m = f.model;
      m.root.visible = f.alive || f.respawnT > 0.3;
      if (f.control !== 'remote') {
        f.renderPos.copy(f.body.pos);
        f.renderQuat.copy(f.body.quat);
        f.renderPitch = f.body.pitch;
      }
      m.root.position.copy(f.renderPos);
      m.root.quaternion.copy(f.renderQuat);
      const lv = _v.copy(f.body.vel).applyQuaternion(_q.copy(f.renderQuat).invert());
      m.setCloak(f.cloakT > 0 ? (me && this.areEnemies(me, f) && f.revealedT <= 0 ? 1 : 0.6) : 0);
      m.update(
        dt,
        {
          speed: f.body.moveSpeed,
          grounded: f.body.grounded,
          crouch: f.body.crouching ? 1 : 0,
          pitch: f.renderPitch,
          jetting: f.body.jetting,
          mag: f.body.magActive,
          attached: f.body.attached,
          alive: f.alive,
          suit: f.suitFrac,
          firing: f.firingVisual > 0,
          reloading: f.activeWeapon.reloadT > 0,
          localVel: lv,
          ability: f.castT,
          stance: f.body.stance,
          grapple: !!f.body.grapple || !!f.rope,
          deflect: f.deflectT > 0,
          shield: f.shieldHp > 0 ? Math.min(1, f.shieldHp / 260) : 0,
        },
        this.time,
      );
      if (m.weaponId !== f.activeWeapon.id) m.setWeapon(f.activeWeapon.id);
      this.updateRope(f);
      // continuous FX
      if (f.alive) {
        if (f.body.jetting) this.effects.jet(m.packWorld.clone().addScaledVector(f.body.up, -0.4), _w.copy(f.body.up).negate());
        if (f.breached) this.effects.vent(m.packWorld, _w.copy(f.body.up).applyAxisAngle(f.body.right(_v), 0.8), Math.min(1, leakRate(f) / 8));
      }
    }
    // camera
    if (me) {
      const b = me.body;
      const eye = b.eye(new THREE.Vector3());
      // smooth only the snapping of mag-boot transitions
      if (this.smoothEye.distanceToSquared(eye) > 4) this.smoothEye.copy(eye);
      this.smoothEye.lerp(eye, 1 - Math.exp(-dt * 30));
      const pitch = b.pitch + this.recoilPitch * 0.35;
      this.recoilPitch *= Math.max(0, 1 - dt * 6);
      _q.copy(b.quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
      // slide lean / wall-grapple tilt
      const rollT = b.stance === 'slide' ? 0.09 : b.grapple ? THREE.MathUtils.clamp(-me.intent.strafe * 0.06, -0.06, 0.06) : 0;
      this.camRoll += (rollT - this.camRoll) * Math.min(1, dt * 8);
      if (Math.abs(this.camRoll) > 1e-4) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.camRoll));
      cam.quaternion.copy(_q);
      cam.position.copy(this.smoothEye);
      this.camDip = Math.max(0, this.camDip - dt * 0.8);
      cam.position.addScaledVector(b.up, -this.camDip);
      const shake = this.camShake + this.effects.shake * 0.4;
      this.camShake = Math.max(0, this.camShake - dt * 2.5);
      if (shake > 0.001) {
        _e.set((Math.random() - 0.5) * shake * 0.04, (Math.random() - 0.5) * shake * 0.04, (Math.random() - 0.5) * shake * 0.03);
        cam.quaternion.multiply(_q.setFromEuler(_e));
      }
      if (this.thirdPerson || !me.alive) {
        const back = b.viewDir(_v).negate();
        const right = b.right(_w);
        const dist = me.alive ? 3.2 : 6;
        const desired = eye.clone().addScaledVector(back, dist).addScaledVector(right, me.alive ? 0.7 : 0).addScaledVector(b.up, 0.35);
        const dir = desired.clone().sub(eye);
        const len = dir.length();
        dir.divideScalar(len);
        const hit = this.world.physics.raycast(eye, dir, len);
        cam.position.copy(hit ? eye.clone().addScaledVector(dir, Math.max(0.3, hit.t - 0.3)) : desired);
      }
      // fov (settings value = horizontal degrees at 16:9)
      const aspect = innerWidth / innerHeight;
      const hfov = THREE.MathUtils.degToRad(this.settings.fov);
      let vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / (16 / 9)));
      const w = me.activeWeapon;
      const adsK = me.intent.aim && me.alive && adsCapable(w.def) ? 1 : 0;
      this.adsBlend += (adsK - this.adsBlend) * Math.min(1, dt * 12);
      vfov *= 1 - this.adsBlend * (1 - w.def.zoom);
      if (Math.abs(cam.fov - vfov) > 0.01 || cam.aspect !== aspect) {
        cam.fov = vfov;
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
      }
      // viewmodel
      this.viewmodel.setWeapon(w.id, new THREE.Color(me.def.color).getHex());
      if (me.castT >= 0.99) this.viewmodel.cast();
      const scoped = this.adsBlend > 0.8 && w.def.zoom < 0.5;
      this.viewmodel.update(dt, {
        speed: b.moveSpeed,
        grounded: b.grounded,
        lookDX: this.lookDX,
        lookDY: this.lookDY,
        reload: w.reloadT > 0 ? 1 - w.reloadT / w.def.reload : -1,
        charge: w.charge,
        aspect,
        fov: 58,
        ads: me.intent.aim && adsCapable(w.def),
        sprint: me.intent.sprint && b.grounded && b.moveSpeed > 5,
        crouch: b.crouching ? 1 : 0,
        switching: me.switchT > 0,
        time: this.time,
        visible: me.alive && !this.thirdPerson && !scoped && b.stance !== 'roll',
        grapple: !!b.grapple,
      });
      // sun direction for the viewmodel light in view space
      this.viewmodel.sun.position.copy(this.sunDir).applyQuaternion(_q.copy(cam.quaternion).invert());
      // audio listener
      audio.setListener(cam.position, _v.set(0, 0, -1).applyQuaternion(cam.quaternion), _w.set(0, 1, 0).applyQuaternion(cam.quaternion));
      this.updateLoops(me);
      this.updateGrade(me, dt);
      this.updateMotionBlur(dt);
    }
    this.effects.update(dt);
    this.world.update(dt, cam.position, me ? me.body.pos : cam.position, 1);
    this.hudState = this.buildHud(dt);
    this.hooks.hudUpdate(this.hudState, dt);
  }
  private adsBlend = 0;
  private camRoll = 0;
  private prevCamQ = new THREE.Quaternion();
  private motion = new THREE.Vector2();

  /** grapple cable from the wrist launcher to the anchor */
  private updateRope(f: Fighter): void {
    // simulated fighters draw the cable only while the hook is attached (a stale f.rope survived
    // respawns and resets and left a cable hanging across the map); remote ones use the replicated anchor
    if (f.control !== 'remote' && !f.body.grapple) f.rope = null;
    const anchor = f.body.grapple ? f.body.grapple.anchor : f.rope;
    let rope = this.ropes.get(f.id);
    if (!anchor || !f.alive) {
      if (rope) rope.visible = false;
      return;
    }
    if (!rope) {
      rope = new THREE.Mesh(this.ropeGeo, this.ropeMat);
      rope.frustumCulled = false;
      rope.layers.set(1);
      this.world.scene.add(rope);
      this.ropes.set(f.id, rope);
    }
    const from = f === this.local && !this.thirdPerson ? this.camera.position.clone().addScaledVector(f.body.right(_v), -0.25).addScaledVector(f.body.up, -0.3) : this.handOf(f);
    rope.visible = true;
    rope.position.copy(from);
    rope.lookAt(anchor);
    rope.scale.set(1, 1, from.distanceTo(anchor));
  }

  private updateLoops(me: Fighter): void {
    const alive = me.alive;
    audio.setLoop('jet', alive && me.body.jetting, 0.8);
    audio.setLoop('hiss', alive && me.breached, Math.min(1, leakRate(me) / 8));
    const low = 1 - me.oxygen / 100;
    this.breathing += ((alive ? Math.max(0.15, low, me.suffocating ? 1 : 0, 1 - me.health / me.maxHealth) : 0) - this.breathing) * 0.05;
    audio.setLoop('breathing', alive, this.breathing);
    audio.setLoop('heartbeat', alive && me.health < me.maxHealth * 0.35, 1 - me.health / me.maxHealth);
    audio.setLoop('alarm', alive && me.oxygen < 30, 1 - me.oxygen / 30);
    audio.setLoop('ambient', true, 0.5);
    const inCp = this.match.controlPoints.some((cp) => cp.pos.distanceTo(me.body.pos) < cp.radius && cp.owner !== me.team);
    audio.setLoop('capture_tick', alive && inCp, 0.6);
    audio.setMuffle(alive ? Math.max(me.suffocating ? 0.7 : 0, (1 - me.oxygen / 100) * 0.4, this.effects.flash * 0.8) : 0.6);
  }

  /** camera-rotation motion blur: screen-space velocity of the view over ~half a frame */
  private updateMotionBlur(dt: number): void {
    const u = this.pipe.gradeUniforms.uMotion.value as THREE.Vector2;
    const cam = this.camera;
    if (!this.settings.motionBlur || dt <= 0) {
      u.set(0, 0);
      this.prevCamQ.copy(cam.quaternion);
      return;
    }
    // previous forward vector expressed in the current camera frame → uv delta
    const f = _v.set(0, 0, -1).applyQuaternion(this.prevCamQ).applyQuaternion(_q.copy(cam.quaternion).invert());
    this.prevCamQ.copy(cam.quaternion);
    if (f.z > -0.2) {
      u.set(0, 0);
      return;
    }
    const th = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const dx = f.x / -f.z / (th * cam.aspect) * 0.5;
    const dy = f.y / -f.z / th * 0.5;
    // shutter ~ 1/2 frame at 60 fps, independent of the real frame time
    const k = Math.min(1, (1 / 120) / dt);
    this.motion.set(THREE.MathUtils.clamp(dx * k, -0.035, 0.035), THREE.MathUtils.clamp(dy * k, -0.035, 0.035));
    u.copy(this.motion.lengthSq() < 1e-6 ? this.motion.set(0, 0) : this.motion);
  }

  private updateGrade(me: Fighter, dt: number): void {
    const u = this.pipe.gradeUniforms;
    const hp = me.health / me.maxHealth;
    const o2 = me.oxygen / 100;
    const hurt = me.alive ? Math.max(0, 0.45 - hp) * 1.8 : 0.5;
    const suff = me.alive ? Math.max(0, 0.35 - o2) * 2.5 : 0;
    u.uTint.value.setRGB(0.5, 0.02, 0.02).lerp(new THREE.Color(0.04, 0.05, 0.12), Math.min(1, suff * 1.5));
    u.uTintAmt.value = Math.min(0.85, hurt + suff);
    u.uDesat.value = Math.min(0.8, suff * 0.8 + (me.alive ? 0 : 0.6));
    u.uBlur.value = Math.min(1, suff * 1.2 + this.effects.flash * 0.5);
    u.uAberr.value = Math.min(1, this.camShake * 1.5 + hurt * 0.5 + (me.empT > 0 ? 0.6 : 0));
    u.uFlash.value = this.effects.flash * this.effects.flash;
    u.uVignette.value = 0.32 + suff * 0.5 + this.adsBlend * 0.1;
    // sun lens flare: screen position + occlusion (one ray per frame)
    const sp = this.camera.position.clone().addScaledVector(this.sunDir, 1000).project(this.camera);
    const onScreen = sp.z < 1 && Math.abs(sp.x) < 1.3 && Math.abs(sp.y) < 1.3;
    let vis = 0;
    if (onScreen) {
      const hit = this.world.physics.raycast(this.camera.position, this.sunDir, 600);
      vis = hit ? 0 : 1;
    }
    u.uSunVis.value += (vis * 0.8 * this.pipe.flareScale - u.uSunVis.value) * Math.min(1, dt * 8);
    (u.uSunPos.value as THREE.Vector2).set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
  }

  // ------------------------------------------------------------------ HUD

  private blankHud(): HudState {
    return {
      visible: true,
      alive: false,
      health: 0,
      suit: 0,
      oxygen: 100,
      breached: false,
      leakRate: 0,
      suffocating: false,
      jetFuel: 1,
      jetting: false,
      mag: 'on',
      magDisabled: 0,
      onWall: false,
      hero: 'condor',
      abilities: [],
      ult: { id: 'swarm', charge: 0, ready: false, active: false },
      weaponId: 'pulse',
      ammo: 0,
      magSize: 0,
      reserve: 0,
      reload: -1,
      charge: 0,
      slots: [],
      superWeapon: null,
      sealants: 0,
      sealing: -1,
      ads: 0,
      scope: 'none',
      sight: false,
      cloaked: false,
      invulnerable: false,
      spread: 10,
      hitmarker: 0,
      hitHead: false,
      hitKill: false,
      heading: 0,
      pitch: 0,
      pos: { x: 0, y: 0, z: 0 },
      mapId: this.modeInfo.map,
      blips: [],
      markers: [],
      damageDirs: [],
      outOfBounds: 0,
      interact: null,
      mode: this.modeInfo.id,
      teams: this.modeInfo.teams,
      localTeam: 0,
      timeLeft: 0,
      scoreLimit: this.modeInfo.scoreLimit,
      teamScores: [0, 0],
      ffaRank: 0,
      controlPoints: [],
      respawnIn: 0,
      killer: null,
      heroSelect: false,
      ping: 0,
      fps: 60,
      spectating: null,
    };
  }

  private buildHud(dt: number): HudState {
    const s = this.hudState;
    const me = this.local;
    this.hitmarker = Math.max(0, this.hitmarker - dt * 3.5);
    if (this.hitmarker <= 0) {
      this.hitHead = false;
      this.hitKill = false;
    }
    if (!me) return s;
    const b = me.body;
    s.alive = me.alive || !me.spawnedOnce; // not deployed yet ≠ dead (no death screen at match start)
    s.health = me.health;
    s.suit = me.maxSuit > 0 ? (me.suit / me.maxSuit) * 100 : 100;
    s.oxygen = me.oxygen;
    s.breached = me.breached;
    s.leakRate = leakRate(me);
    s.suffocating = me.suffocating;
    s.jetFuel = b.jetFuel;
    s.jetting = b.jetting;
    s.mag = !b.magOn ? 'off' : b.attached ? 'attached' : 'on';
    s.magDisabled = Math.max(0, b.magDisabled, me.empT);
    s.onWall = b.onWall;
    s.hero = me.hero;
    const keys: ('ability1' | 'ability2')[] = ['ability1', 'ability2'];
    s.abilities = me.abilities.map((a, i) => ({ key: keys[i], id: a.id, cooldown: a.charges >= a.maxCharges ? 0 : a.cooldown / a.maxCooldown, charges: a.charges, maxCharges: a.maxCharges, active: a.active > 0 }));
    s.ult = { id: me.ult.id, charge: me.ultCharge / me.ultCostEff, ready: me.ultReady, active: me.ult.active > 0 || me.swarmT > 0 || me.overchargeT > 0 || me.moonbladeT > 0 };
    s.grapple = { cooldown: me.grappleCd > 0 ? me.grappleCd / GRAPPLE_CD : 0, ready: me.grappleCd <= 0, active: !!b.grapple };
    s.stance = b.stance;
    s.forceField = me.shieldHp > 0 ? Math.min(1, me.shieldHp / 260) : 0;
    s.passive = this.passiveHud(me);
    const sums: NonNullable<HudState['summons']> = [];
    for (const o of this.fighters) if (o.summonOf === me.id && o.alive) sums.push({ kind: 'servitor', hp: o.health / o.maxHealth });
    for (const d of this.summons.byOwner(me.id)) {
      if (d.kind === 'kamikaze' || d.kind === 'decoy') continue;
      sums.push({ kind: d.kind === 'turret' ? 'turret' : d.kind === 'barricade' ? 'barricade' : 'drone', hp: d.hp / d.maxHp });
    }
    s.summons = sums;
    const w = me.activeWeapon;
    s.weaponId = w.id;
    s.ammo = w.ammo;
    s.magSize = w === me.weapon ? me.magSize : w.def.mag;
    s.reserve = w.reserve;
    s.reload = w.reloadT > 0 ? 1 - w.reloadT / Math.max(0.01, w.def.reload) : -1;
    s.charge = w.charge;
    s.chargeKind = 'charge';
    if (w.def.heatPerShot > 0) {
      // riveter: heat gauge instead of reserve ammo; the vent / overheat shows as the reload bar
      s.charge = w.ventT > 0 ? Math.max(0.02, w.heat) : w.heat;
      s.chargeKind = 'heat';
      s.reload = w.ventT > 0 ? 1 - Math.min(1, w.ventT / Math.max(0.01, w.def.overheat)) : -1;
    } else if (w.def.alt === 'slug' || w.def.alt === 'glob') {
      s.charge = w.altCd > 0 ? 1 - w.altCd / Math.max(0.01, w.def.altCooldown) : 1;
      s.chargeKind = 'alt';
    }
    s.slots = [
      { key: this.keyLabel('weapon1'), id: me.weapon.id, ammo: me.weapon.ammo, active: me.slot === 0 },
      { key: this.keyLabel('weapon2'), id: me.superWeapon ? me.superWeapon.id : null, ammo: me.superWeapon?.ammo ?? 0, active: me.slot === 1 },
    ];
    s.superWeapon = me.superWeapon ? { id: me.superWeapon.id, ammo: me.superWeapon.ammo } : null;
    s.sealants = me.sealants;
    s.sealing = me.sealT > 0 ? 1 - me.sealT / 1.2 : -1;
    s.ads = this.adsBlend;
    s.scope = this.adsBlend > 0.5 ? (w.id === 'rail' ? 'rail' : w.id === 'nuke' ? 'nuke' : w.id === 'helios' ? 'designator' : 'none') : 'none';
    s.sight = w.def.alt === 'ads' && w.id !== 'nuke' && w.id !== 'helios' && !this.thirdPerson;
    s.cloaked = me.cloakT > 0;
    s.invulnerable = me.invulnT > 0;
    const spreadRad = coneOf(w.def, this.combat.aimState(me, w));
    s.spread = 6 + (spreadRad / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) * 540;
    s.hitmarker = this.settings.hitMarkers ? this.hitmarker : 0;
    s.hitHead = this.hitHead;
    s.hitKill = this.hitKill;
    const fwd = b.viewDir(_v);
    s.heading = Math.atan2(fwd.x, -fwd.z);
    s.pitch = b.pitch;
    s.pos = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
    s.teams = this.modeInfo.teams;
    s.localTeam = me.team;
    s.timeLeft = this.match.timeLeft;
    if (this.modeInfo.teams) s.teamScores = [...this.match.teamScores];
    else {
      const f = this.match.ffaScores();
      s.teamScores = [f.mine, f.leader];
      s.ffaRank = f.rank;
    }
    s.controlPoints = this.match.controlPoints.map((cp) => {
      const scr = this.project(cp.pos.clone().add(new THREE.Vector3(0, 3, 0)));
      return { id: cp.id, owner: cp.owner, progress: cp.progress, contested: cp.contested, inside: Math.hypot(b.pos.x - cp.pos.x, b.pos.z - cp.pos.z) < cp.radius, screen: { x: scr.x, y: scr.y, visible: scr.on, dist: cp.pos.distanceTo(b.pos) } };
    });
    // damage directions relative to the view
    for (const d of this.damageDirs) {
      d.alpha -= dt * 0.8;
      _w.copy(d.world).sub(b.pos);
      const ang = Math.atan2(_w.x, -_w.z);
      d.angle = ang - s.heading;
    }
    this.damageDirs = this.damageDirs.filter((d) => d.alpha > 0);
    s.damageDirs = this.damageDirs.map((d) => ({ angle: d.angle, alpha: d.alpha }));
    // blips & markers
    const blips: Blip[] = [{ x: b.pos.x, z: b.pos.z, kind: 'self', rot: s.heading }];
    const markers: ScreenMarker[] = [];
    for (const f of this.fighters) {
      if (f === me || !f.alive) continue;
      const enemy = this.areEnemies(me, f);
      if (f.summonOf >= 0 && !enemy) {
        blips.push({ x: f.body.pos.x, z: f.body.pos.z, kind: 'ally', team: f.team });
        continue;
      }
      const spotted = f.revealedT > 0 || (f.firingVisual > 0 && f.body.pos.distanceTo(b.pos) < 60);
      if (!enemy || spotted) {
        const fwd2 = f.body.forward(_w);
        blips.push({ x: f.body.pos.x, z: f.body.pos.z, kind: enemy ? 'spotted' : 'ally', rot: Math.atan2(fwd2.x, -fwd2.z), team: f.team, height: f.body.pos.y - b.pos.y });
      }
      if (!enemy || f.revealedT > 0) {
        const p = this.project(f.body.pos.clone().addScaledVector(f.body.up, f.body.height + 0.45));
        markers.push({ x: p.x, y: p.y, kind: enemy ? 'enemy' : 'ally', label: f.name, dist: Math.round(f.body.pos.distanceTo(b.pos)), health: f.health / f.maxHealth, onScreen: p.on, angle: p.angle });
      }
    }
    for (const cp of this.match.controlPoints) blips.push({ x: cp.pos.x, z: cp.pos.z, kind: 'cp', label: cp.id, team: cp.owner });
    // ready pickups nearby (so players learn where the o2 / armour / power cells are)
    for (const pk of this.match.pickups) {
      if (pk.t > 0 || Math.abs(pk.pos.x - b.pos.x) > 60 || Math.abs(pk.pos.z - b.pos.z) > 60) continue;
      blips.push({ x: pk.pos.x, z: pk.pos.z, kind: 'pickup', label: pk.kind, height: pk.pos.y - b.pos.y });
    }
    if (this.match.pod) {
      const pp = this.match.pod.landed ? this.match.pod.mesh.position : this.match.pod.pos;
      blips.push({ x: pp.x, z: pp.z, kind: 'pod' });
      const p = this.project(pp.clone().add(new THREE.Vector3(0, 3, 0)));
      markers.push({ x: p.x, y: p.y, kind: 'pod', label: 'SUPPLY', dist: Math.round(pp.distanceTo(b.pos)), onScreen: p.on, angle: p.angle });
    }
    for (const z of this.abilities.zones) {
      if (z.kind === 'strike') {
        blips.push({ x: z.pos.x, z: z.pos.z, kind: 'nuke' });
        const p = this.project(z.pos.clone().add(new THREE.Vector3(0, 2, 0)));
        markers.push({ x: p.x, y: p.y, kind: 'nuke', label: 'HELIOS', dist: Math.round(z.pos.distanceTo(b.pos)), onScreen: p.on, angle: p.angle });
      }
    }
    for (const pr of this.combat.projectiles) {
      if (pr.kind === 'nuke') {
        blips.push({ x: pr.pos.x, z: pr.pos.z, kind: 'nuke' });
        const p = this.project(pr.pos);
        markers.push({ x: p.x, y: p.y, kind: 'nuke', label: '☢', dist: Math.round(pr.pos.distanceTo(b.pos)), onScreen: p.on, angle: p.angle });
      }
      if (pr.kind === 'sensor' && pr.team === me.team) blips.push({ x: pr.pos.x, z: pr.pos.z, kind: 'sensor' });
    }
    // deployables: own/allied devices always, enemy devices when close
    for (const d of this.summons.list) {
      if (d.dead || d.kind === 'kamikaze') continue;
      const hostile = this.summons.hostileTo(d, me);
      const dist = d.pos.distanceTo(b.pos);
      if (hostile && dist > 22) continue;
      if (d.kind === 'decoy' && hostile) continue; // decoys must look like players
      const kind: ScreenMarker['kind'] = d.kind === 'turret' ? 'turret' : d.kind === 'barricade' ? 'barricade' : d.kind === 'decoy' ? 'decoy' : 'drone';
      const p = this.project(this.summons.center(d, _w).add(new THREE.Vector3(0, 0.7, 0)));
      if (!p.on && hostile) continue;
      markers.push({ x: p.x, y: p.y, kind, team: d.team, dist: Math.round(dist), health: d.hp / d.maxHp, onScreen: p.on, angle: p.angle, label: hostile ? '!' : undefined });
    }
    for (const o of this.fighters) {
      if (o.summonOf < 0 || !o.alive || this.areEnemies(me, o)) continue;
      const p = this.project(o.body.pos.clone().addScaledVector(o.body.up, o.body.height + 0.3));
      markers.push({ x: p.x, y: p.y, kind: 'servitor', team: o.team, dist: Math.round(o.body.pos.distanceTo(b.pos)), health: o.health / o.maxHealth, onScreen: p.on, angle: p.angle });
    }
    for (const z of this.abilities.zones) {
      const owner = this.fighterById(z.owner);
      if (!owner || this.areEnemies(me, owner)) continue;
      if (z.kind !== 'dome' && z.kind !== 'station' && z.kind !== 'bubble') continue;
      const p = this.project(z.pos.clone().add(new THREE.Vector3(0, z.kind === 'station' ? 1.4 : z.radius * 0.6, 0)));
      markers.push({ x: p.x, y: p.y, kind: z.kind === 'station' ? 'station' : 'shield', team: z.team, dist: Math.round(z.pos.distanceTo(b.pos)), health: z.kind === 'station' ? 1 - z.t / z.life : undefined, onScreen: p.on, angle: p.angle });
    }
    for (const pr of this.combat.projectiles) {
      if ((pr.kind === 'mine' || pr.kind === 'sensor') && pr.owner === me.id && pr.stuck) {
        const p = this.project(pr.pos.clone().add(new THREE.Vector3(0, 0.4, 0)));
        if (p.on) markers.push({ x: p.x, y: p.y, kind: pr.kind, dist: Math.round(pr.pos.distanceTo(b.pos)), onScreen: true });
      }
    }
    s.blips = blips;
    s.markers = markers;
    // bounds
    const bd = this.world.physics.bounds;
    const out = b.pos.x < bd.minX || b.pos.x > bd.maxX || b.pos.z < bd.minZ || b.pos.z > bd.maxZ;
    this.outOfBoundsT = out ? this.outOfBoundsT + dt : 0;
    s.outOfBounds = out ? Math.max(0.1, 10 - this.outOfBoundsT) : 0;
    s.respawnIn = me.alive ? 0 : Math.max(0, me.respawnT);
    if (!me.alive) {
      const k = me.lastAttackerT < 30 ? this.fighterById(me.lastAttacker) : null;
      s.killer = k ? { name: k.name, hero: k.hero, weapon: k.activeWeapon.id as WeaponId | AbilityId, distance: Math.round(k.body.pos.distanceTo(b.pos)), health: k.health / k.maxHealth, team: k.team } : { name: me.name, hero: me.hero, weapon: me.suffocating ? 'suffocation' : 'self', distance: 0, health: 0, team: me.team };
    } else s.killer = null;
    s.heroSelect = !me.alive;
    s.ping = me.ping;
    s.fps = this.fps;
    s.spectating = null;
    return s;
  }

  /** HUD chip for the signature passive: is it doing its thing right now? */
  private passiveHud(me: Fighter): NonNullable<HudState['passive']> {
    const b = me.body;
    let active = true;
    let value = 1;
    switch (me.passive) {
      case 'afterburner':
        active = b.jetFuel < 0.999 && !b.jetting;
        value = b.jetFuel;
        break;
      case 'moonstep':
        // lit while the second jump is available
        active = b.grounded || b.airJumpsLeft > 0;
        value = active ? 1 : 0;
        break;
      case 'fusion':
        active = me.suitFrac >= 0.5;
        value = me.suitFrac;
        break;
      case 'backstab':
      case 'spotter':
      case 'blastproof':
        active = true;
        break;
      case 'lifelink':
      case 'fieldrepair':
        value = this.fighters.filter((o) => o !== me && o.alive && !this.areEnemies(me, o) && o.body.pos.distanceTo(b.pos) < (me.passive === 'lifelink' ? 12 : 10)).length;
        active = value > 0;
        break;
      case 'dronelink':
        value = this.fighters.filter((o) => o.alive && o.markedBy === me.id && o.markT > 0).length;
        active = value > 0;
        break;
    }
    return { id: me.passive, active, value };
  }

  private project(p: THREE.Vector3): { x: number; y: number; on: boolean; angle: number } {
    const v = p.clone().project(this.camera);
    const behind = v.z > 1;
    let x = v.x;
    let y = v.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const on = !behind && Math.abs(x) <= 1 && Math.abs(y) <= 1;
    const angle = Math.atan2(x, y);
    if (!on) {
      const m = Math.max(Math.abs(x), Math.abs(y), 1e-4);
      x = (x / m) * 0.92;
      y = (y / m) * 0.88;
    }
    return { x: (x * 0.5 + 0.5) * innerWidth, y: (-y * 0.5 + 0.5) * innerHeight, on, angle };
  }

  scoreRows() {
    return this.match.result(this.local?.id ?? -1).rows;
  }

  // ------------------------------------------------------------------ minimap

  renderMinimap(size = 512): HTMLCanvasElement {
    // the top-down map only depends on the map layout: render it once per map and session
    const cached = minimapCache.get(this.world.def.id + ':' + size);
    if (cached) return cached;
    const bd = this.world.physics.bounds;
    const w = bd.maxX - bd.minX;
    const h = bd.maxZ - bd.minZ;
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, 2000);
    cam.position.set((bd.minX + bd.maxX) / 2, 800, (bd.minZ + bd.maxZ) / 2);
    cam.up.set(0, 0, -1);
    cam.lookAt(cam.position.x, 0, cam.position.z);
    const rw = size;
    const rh = Math.round((size * h) / w);
    const rt = new THREE.WebGLRenderTarget(rw, rh);
    const r = this.pipe.renderer;
    const sky = this.world.sky.group.visible;
    this.world.sky.group.visible = false;
    const autoShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false; // no need to redraw the shadow cascades for a flat map
    r.setRenderTarget(rt);
    r.render(this.world.scene, cam);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = autoShadow;
    this.world.sky.group.visible = sky;
    const px = new Uint8Array(rw * rh * 4);
    r.readRenderTargetPixels(rt, 0, 0, rw, rh, px);
    rt.dispose();
    const cv = document.createElement('canvas');
    cv.width = rw;
    cv.height = rh;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(rw, rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const si = ((rh - 1 - y) * rw + x) * 4;
        const di = (y * rw + x) * 4;
        // stylise: boost contrast, slight blue tint
        img.data[di] = Math.min(255, px[si] * 1.1);
        img.data[di + 1] = Math.min(255, px[si + 1] * 1.12);
        img.data[di + 2] = Math.min(255, px[si + 2] * 1.25 + 8);
        img.data[di + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    minimapCache.set(this.world.def.id + ':' + size, cv);
    return cv;
  }

  dispose(): void {
    this.ended = true;
    this.combat.clear();
    this.abilities.clear();
    this.summons.clear();
    for (const r of this.ropes.values()) this.world.scene.remove(r);
    this.ropes.clear();
    this.ropeGeo.dispose();
    this.ropeMat.dispose();
    this.match.dispose();
    this.effects.clear();
    this.world.scene.remove(this.effects.group);
    for (const f of this.fighters) if (f.model) this.world.scene.remove(f.model.root);
    this.viewmodel.dispose();
    audio.stopAllLoops();
  }
}

export { HITBOXES, WEAPONS };
export type { Loop };
