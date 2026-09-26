import * as THREE from 'three';
import type { Game } from './Game';
import type { Fighter } from './Fighter';
import type { Summon } from './Summons';
import { NavGrid } from './Nav';
import { MOON_G } from '../core/Physics';
import type { BotDifficulty, HeroId } from './Types';

interface Skill {
  reaction: number; // s before engaging a newly seen target
  aimError: number; // rad
  track: number; // aim tracking speed (rad/s)
  abilityChance: number; // per-decision probability
  strafe: number; // 0..1
  /** 0..1: how much the bot uses cover, stances, focus fire and regrouping */
  tactics: number;
  /** chance to fall for a holo-decoy */
  gullible: number;
}

const SKILL: Record<BotDifficulty, Skill> = {
  easy: { reaction: 0.6, aimError: 0.085, track: 3.5, abilityChance: 0.25, strafe: 0.3, tactics: 0.15, gullible: 0.9 },
  normal: { reaction: 0.38, aimError: 0.05, track: 6, abilityChance: 0.5, strafe: 0.6, tactics: 0.45, gullible: 0.65 },
  hard: { reaction: 0.24, aimError: 0.028, track: 9, abilityChance: 0.75, strafe: 0.85, tactics: 0.75, gullible: 0.4 },
  veteran: { reaction: 0.15, aimError: 0.016, track: 13, abilityChance: 0.95, strafe: 1, tactics: 1, gullible: 0.2 },
};

/** preferred engagement ranges per hero [min, max] */
const RANGE: Record<HeroId, [number, number]> = {
  condor: [10, 35],
  needle: [28, 90],
  lunatic: [9, 28],
  phantom: [3, 14],
  blade: [0, 2.6],
  reactor: [3, 12],
  helios: [8, 24],
  forge: [7, 24],
  hive: [10, 34],
};
const SERVITOR_RANGE: [number, number] = [6, 22];

interface BotBrain {
  target: number;
  seenT: number; // time target has been continuously visible
  lastSeen: THREE.Vector3 | null;
  lastSeenT: number;
  /** a holo-decoy or enemy device the bot is shooting at instead of a fighter */
  device: number;
  path: number[];
  pathIdx: number;
  goal: THREE.Vector3 | null;
  goalKind: string;
  replanT: number;
  thinkT: number;
  strafeDir: number;
  strafeT: number;
  stuckT: number;
  lastPos: THREE.Vector3;
  aimNoise: THREE.Vector2;
  aimNoiseT: number;
  jumpT: number;
  abilityT: number;
  holdFireT: number;
  coverT: number; // time left holding a cover position
  stanceT: number; // stance decision throttle
  proneT: number;
  grappleAim: THREE.Vector3 | null;
  grappleAimT: number;
  lastHealth: number;
  hurtT: number; // time since last damage taken
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Vector3();
const _t = new THREE.Vector3();
const _c = new THREE.Vector3();
const _f = new THREE.Vector3();

/**
 * Bot AI: perception with line of sight, nav-grid pathing, team tactics (objective spread,
 * focus fire, regrouping, retreat to healers and cover), hero-specific ability logic,
 * movement tech (strafe dance, hops, rolls, slides, crouch/prone sniping, grapple) and
 * human-like aim with reaction delay and noise scaled by difficulty.
 */
export class Bots {
  game: Game;
  nav: NavGrid;
  brains = new Map<number, BotBrain>();
  skill: Skill;

  constructor(game: Game, difficulty: BotDifficulty) {
    this.game = game;
    this.skill = SKILL[difficulty] ?? SKILL.normal;
    const b = game.world.physics.bounds;
    const cell = (b.maxX - b.minX) * (b.maxZ - b.minZ) > 40000 ? 1.4 : 1.1;
    this.nav = new NavGrid(game.world.physics, b, cell);
    console.info(`[nav] ${this.nav.nodes.length} nodes in ${Math.round(this.nav.buildMs)} ms`);
  }

  setDifficulty(d: BotDifficulty): void {
    this.skill = SKILL[d] ?? SKILL.normal;
  }

  brain(f: Fighter): BotBrain {
    let b = this.brains.get(f.id);
    if (!b) {
      b = {
        target: -1,
        seenT: 0,
        lastSeen: null,
        lastSeenT: 99,
        device: -1,
        path: [],
        pathIdx: 0,
        goal: null,
        goalKind: '',
        replanT: 0,
        thinkT: Math.random() * 0.2,
        strafeDir: Math.random() < 0.5 ? -1 : 1,
        strafeT: 0,
        stuckT: 0,
        lastPos: new THREE.Vector3(),
        aimNoise: new THREE.Vector2(),
        aimNoiseT: 0,
        jumpT: 2 + Math.random() * 4,
        abilityT: 1,
        holdFireT: 0,
        coverT: 0,
        stanceT: 0,
        proneT: 0,
        grappleAim: null,
        grappleAimT: 0,
        lastHealth: f.health,
        hurtT: 99,
      };
      this.brains.set(f.id, b);
    }
    return b;
  }

  /** Choose a hero for a bot given its team's current composition (OW-style role balance). */
  pickHero(team: number): HeroId {
    const g = this.game;
    const mates = g.players.filter((f) => f.team === team && team >= 0);
    const has = (h: HeroId) => mates.some((m) => m.hero === h);
    const hasRole = (r: string) => mates.some((m) => m.def.role === r);
    if (g.modeInfo.teams && mates.length >= 1) {
      if (!hasRole('support') && Math.random() < 0.75) return 'helios';
      if (!hasRole('tank') && mates.length >= 2 && Math.random() < 0.65) return 'reactor';
      if (!hasRole('engineer') && mates.length >= 2 && Math.random() < 0.5) return Math.random() < 0.5 ? 'forge' : 'hive';
    }
    const pool: HeroId[] = ['condor', 'needle', 'lunatic', 'phantom', 'blade', 'reactor', 'helios', 'forge', 'hive'];
    const fresh = pool.filter((h) => !has(h));
    const list = fresh.length ? fresh : pool;
    return list[Math.floor(Math.random() * list.length)];
  }

  update(f: Fighter, dt: number): void {
    const g = this.game;
    const it = f.intent;
    const b = this.brain(f);
    const body = f.body;
    // defaults
    it.forward = 0;
    it.strafe = 0;
    it.jump = false;
    it.jumpPressed = false;
    it.crouch = false;
    it.fire = false;
    it.firePressed = false;
    it.aim = false;
    it.reload = false;
    it.ability1 = false;
    it.ability2 = false;
    it.ultimate = false;
    it.sealant = false;
    it.grapple = false;
    it.melee = false;
    it.prone = false;
    it.roll = false;
    it.slot = -1;
    it.yaw = 0;
    it.pitch = 0;
    if (!f.alive) return;
    body.magOn = false; // bots navigate on the ground / floors (mag walking would derail paths)
    const servitor = f.summonOf >= 0;
    const tookDamage = f.health < b.lastHealth - 1;
    b.lastHealth = f.health;
    b.hurtT = tookDamage ? 0 : b.hurtT + dt;

    const eye = f.eye(_e);
    // ---- perception (throttled) ----
    b.thinkT -= dt;
    if (b.thinkT <= 0) {
      b.thinkT = 0.18 + Math.random() * 0.08;
      this.perceive(f, b, eye);
      if (servitor) this.servitorGoal(f, b);
      else this.chooseGoal(f, b);
    }
    const target = b.target >= 0 ? g.fighterById(b.target) : null;
    const visible = !!target && target.alive && b.lastSeenT < 0.25;
    if (visible) b.seenT += dt;
    else b.seenT = 0;
    const device = b.device >= 0 ? g.summons.list.find((s) => s.id === b.device && !s.dead) ?? null : null;
    if (b.device >= 0 && !device) b.device = -1;
    const dist = target ? target.body.pos.distanceTo(body.pos) : 999;
    const range = servitor ? SERVITOR_RANGE : RANGE[f.hero];

    // ---- survival ----
    if (f.breached && f.sealants > 0 && f.sealT < 0 && (!visible || f.oxygen < 25)) it.sealant = true;
    if (f.activeWeapon.ammo === 0 || (!visible && f.activeWeapon.ammo < f.activeWeapon.def.mag * 0.35 && f.activeWeapon.def.mag < 900)) it.reload = true;
    if (f.superWeapon && f.slot === 0 && visible) it.slot = 1;

    // ---- aiming ----
    let aimDir: THREE.Vector3 | null = null;
    let aimingDevice = false;
    if (device && (!visible || b.seenT < this.skill.reaction)) {
      g.summons.center(device, _c);
      aimDir = _c.clone().sub(eye).normalize();
      aimingDevice = true;
    } else if (target && (visible || (b.lastSeen && b.lastSeenT < 1.5))) {
      aimDir = this.aimAt(f, target, visible ? null : b.lastSeen, eye);
    }
    const moveDir = this.followPath(f, b, dt);
    if (b.grappleAim && !aimDir) {
      // lining up a grapple shot toward a higher floor
      b.grappleAimT -= dt;
      const d = body.aimDeltas(_w.copy(b.grappleAim).sub(eye).normalize());
      const maxTurn = 7 * dt;
      it.yaw = THREE.MathUtils.clamp(d.yaw, -maxTurn, maxTurn);
      it.pitch = THREE.MathUtils.clamp(d.pitch, -maxTurn, maxTurn);
      if (Math.abs(d.yaw) < 0.05 && Math.abs(d.pitch) < 0.05) {
        it.grapple = true;
        b.grappleAim = null;
      } else if (b.grappleAimT <= 0) b.grappleAim = null;
    } else if (aimDir) {
      // noisy human-like aim
      b.aimNoiseT -= dt;
      if (b.aimNoiseT <= 0) {
        b.aimNoiseT = 0.25 + Math.random() * 0.35;
        const e = this.skill.aimError * (0.5 + Math.min(1.5, body.moveSpeed / 4)) * (target && target.body.moveSpeed > 3 ? 1.3 : 1) * (body.stance === 'prone' || body.crouching ? 0.7 : 1);
        b.aimNoise.set((Math.random() * 2 - 1) * e, (Math.random() * 2 - 1) * e);
      }
      const d = body.aimDeltas(aimDir);
      const maxTurn = this.skill.track * dt;
      it.yaw = THREE.MathUtils.clamp(d.yaw + b.aimNoise.x * 0.2, -maxTurn, maxTurn);
      it.pitch = THREE.MathUtils.clamp(d.pitch + b.aimNoise.y * 0.2, -maxTurn, maxTurn);
      const onTarget = Math.abs(d.yaw) < 0.06 + this.skill.aimError && Math.abs(d.pitch) < 0.08 + this.skill.aimError;
      if (aimingDevice && onTarget && device) this.shootDevice(f, device, eye);
      else if (visible && b.seenT > this.skill.reaction && onTarget && target) this.combat(f, b, target, dist);
    } else if (moveDir) {
      // look where we walk
      _w.copy(moveDir);
      _w.y = 0;
      if (_w.lengthSq() > 0.001) {
        const d = body.aimDeltas(_w.normalize());
        const maxTurn = 4 * dt;
        it.yaw = THREE.MathUtils.clamp(d.yaw, -maxTurn, maxTurn);
        it.pitch = THREE.MathUtils.clamp(-body.pitch * 0.2, -maxTurn, maxTurn);
      }
    }

    // ---- movement ----
    const wish = _w.set(0, 0, 0);
    if (moveDir) wish.copy(moveDir);
    const holdingCover = b.coverT > 0 && b.goalKind === 'cover';
    if (b.coverT > 0) b.coverT -= dt;
    if (visible && target && !holdingCover) {
      const [rmin, rmax] = range;
      _v.copy(target.body.pos).sub(body.pos).setY(0).normalize();
      if (dist < rmin) wish.addScaledVector(_v, -0.9);
      else if (dist > rmax && !moveDir) wish.addScaledVector(_v, 0.8);
      else if (f.hero === 'blade' && !servitor) wish.addScaledVector(_v, 1.2); // melee: always close in
      // strafe dance
      b.strafeT -= dt;
      if (b.strafeT <= 0) {
        b.strafeT = 0.4 + Math.random() * 0.9;
        b.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const sniping = body.stance === 'prone' || (f.hero === 'needle' && f.intent.aim);
      const melee = f.hero === 'blade' && !servitor;
      _t.set(-_v.z, 0, _v.x).multiplyScalar(b.strafeDir * this.skill.strafe * (sniping ? 0.15 : melee ? 0.3 : 1));
      if (melee) {
        // close the gap in a zig-zag; path only matters when there's no straight line
        const clear = g.world.physics.visible(_c.copy(body.pos).setY(body.pos.y + 0.8), _f.copy(target.body.pos).setY(target.body.pos.y + 0.8));
        wish.multiplyScalar(clear ? 0.2 : 1).addScaledVector(_v, clear ? 1.4 : 0.4).add(_t);
      } else wish.multiplyScalar(dist > rmax ? 0.7 : 0.35).add(_t);
    }
    if (body.stance === 'prone' && b.proneT > 0) wish.multiplyScalar(0.2);
    if (wish.lengthSq() > 0.0001) {
      wish.normalize();
      const fwd = body.forward(_v);
      const right = body.right(_t);
      it.forward = THREE.MathUtils.clamp(wish.dot(fwd) * 1.4, -1, 1);
      it.strafe = THREE.MathUtils.clamp(wish.dot(right) * 1.4, -1, 1);
    }
    // stances & movement tech
    this.stances(f, b, visible ? target : null, dist, dt, b.hurtT < 0.6);
    // occasional lunar hops (and when stuck)
    b.jumpT -= dt;
    if (b.jumpT <= 0 && body.grounded && body.stance !== 'prone') {
      b.jumpT = visible ? 1.5 + Math.random() * 3 : 4 + Math.random() * 6;
      if (visible || Math.random() < 0.3) it.jumpPressed = it.jump = true;
    }
    // stuck detection
    if (moveDir && body.grounded) {
      if (body.pos.distanceTo(b.lastPos) < 0.6 * dt * 4) b.stuckT += dt;
      else b.stuckT = Math.max(0, b.stuckT - dt);
      if (b.stuckT > 0.9) {
        if (body.stance === 'prone') it.prone = true;
        it.jumpPressed = it.jump = true;
        b.stuckT = 0;
        b.replanT = 0;
        b.path.length = 0;
      }
    }
    if (!body.grounded && body.vel.y < -1 && b.path.length && b.pathIdx < b.path.length) {
      // use the jetpack to reach a higher waypoint
      const nd = this.nav.nodes[b.path[b.pathIdx]];
      if (nd.y > body.pos.y + 0.5) it.jump = true;
    }
    b.lastPos.copy(body.pos);
    // grapple toward far-higher goals (roof tops, catwalks) when not fighting
    if (!visible && !servitor && f.grappleCd <= 0 && !body.grapple && !b.grappleAim && b.goal && Math.random() < dt * 0.8 * (0.3 + this.skill.tactics)) {
      const dy = b.goal.y - body.pos.y;
      const dh = Math.hypot(b.goal.x - body.pos.x, b.goal.z - body.pos.z);
      if (dy > 3.5 && dh < 36) {
        _c.copy(b.goal).add(new THREE.Vector3(0, 0.4, 0));
        const dir = _c.clone().sub(eye);
        const len = dir.length();
        const hit = g.world.physics.raycast(eye, dir.divideScalar(len), len + 1, { forMove: true });
        if (hit && hit.t > len - 2.5) {
          b.grappleAim = hit.point.clone();
          b.grappleAimT = 0.8;
        }
      }
    }

    // ---- abilities ----
    b.abilityT -= dt;
    if (b.abilityT <= 0 && !servitor) {
      b.abilityT = 0.5 + Math.random() * 0.7;
      if (Math.random() < this.skill.abilityChance) this.useAbilities(f, b, visible ? target : null, tookDamage);
    }
    // quick melee at point blank
    if (visible && target && dist < 2.2 && f.hero !== 'blade' && f.meleeCd <= 0 && Math.random() < 0.3 + this.skill.tactics * 0.4) it.melee = true;
  }

  /** crouch / prone / slide / roll decisions */
  private stances(f: Fighter, b: BotBrain, t: Fighter | null, dist: number, dt: number, hurtNow: boolean): void {
    const it = f.intent;
    const body = f.body;
    const tac = this.skill.tactics;
    if (b.proneT > 0) b.proneT -= dt;
    // leave prone when moving on or target gone
    if (body.stance === 'prone' && (b.proneT <= 0 || !t)) {
      it.prone = true;
      b.proneT = 0;
      return;
    }
    b.stanceT -= dt;
    if (b.stanceT > 0) {
      if (t && body.crouching === false && b.goalKind === 'crouchfire') it.crouch = true;
      return;
    }
    b.stanceT = 0.35 + Math.random() * 0.4;
    if (b.goalKind === 'crouchfire') b.goalKind = '';
    if (!t) return;
    // sniper goes prone on long sightlines
    if (f.hero === 'needle' && dist > 35 && body.grounded && Math.random() < tac * 0.6 && body.stance !== 'prone') {
      it.prone = true;
      b.proneT = 4 + Math.random() * 5;
      return;
    }
    // evasive combat roll when hit up close
    if (hurtNow && dist < 18 && body.grounded && Math.random() < tac * 0.55) {
      it.roll = true;
      it.strafe = b.strafeDir;
      return;
    }
    // slide into melee range / out of danger
    if (body.grounded && body.moveSpeed > 4.4 && ((f.hero === 'blade' && dist < 9 && dist > 3) || (f.health < f.maxHealth * 0.35 && dist < 12)) && Math.random() < tac) {
      it.crouch = true;
      return;
    }
    // crouch-fire at mid/long range for accuracy (still strafes a little)
    if (dist > 18 && f.hero !== 'blade' && body.grounded && Math.random() < tac * 0.5) {
      it.crouch = true;
      b.goalKind = b.goalKind || 'crouchfire';
    }
  }

  private perceive(f: Fighter, b: BotBrain, eye: THREE.Vector3): void {
    const g = this.game;
    let best: Fighter | null = null;
    let bestScore = -Infinity;
    const look = f.body.viewDir(_v);
    const tac = this.skill.tactics;
    for (const o of g.fighters) {
      if (!o.alive || !g.areEnemies(f, o)) continue;
      if (o.cloakT > 0 && o.revealedT <= 0 && o.firingVisual <= 0) continue;
      o.hitbox(1, _t);
      const d = _t.distanceTo(eye);
      if (d > 140) continue;
      const toward = _w.copy(_t).sub(eye).divideScalar(d).dot(look);
      const aware = toward > 0.1 || d < 12 || (f.lastAttacker === o.id && f.lastAttackerT < 3) || o.firingVisual > 0 || o.revealedT > 0;
      if (!aware) continue;
      if (!g.world.physics.visible(eye, _t)) {
        o.hitbox(0, _t);
        if (!g.world.physics.visible(eye, _t)) continue;
      }
      let score = -d;
      if (o.id === b.target) score += 15;
      if (f.lastAttacker === o.id && f.lastAttackerT < 3) score += 20;
      score += (1 - o.health / o.maxHealth) * 15 * (0.5 + tac);
      if (o.summonOf >= 0) score -= 25; // prefer players over servitors
      // focus fire: pile onto what teammates are shooting
      if (g.modeInfo.teams && tac > 0.3) {
        let focus = 0;
        for (const [id, br] of this.brains) if (id !== f.id && br.target === o.id && br.lastSeenT < 0.5) focus++;
        score += focus * 8 * tac;
      }
      // healers and snipers are priority targets for smart bots
      if (o.def.role === 'support' || o.hero === 'needle') score += 6 * tac;
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (best) {
      if (b.target !== best.id) b.seenT = 0;
      b.target = best.id;
      b.lastSeen = (b.lastSeen ?? new THREE.Vector3()).copy(best.body.pos);
      b.lastSeenT = 0;
    } else {
      b.lastSeenT += 0.2;
      if (b.lastSeenT > 5) b.target = -1;
    }
    // devices: decoys (may fool the bot) and hostile turrets / drones in view
    b.device = -1;
    let bestD = best ? best.body.pos.distanceTo(f.body.pos) : 45;
    for (const s of g.summons.list) {
      if (s.dead || s.kind === 'barricade' || !g.summons.hostileTo(s, f)) continue;
      const c = g.summons.center(s, _t);
      const d = c.distanceTo(eye);
      if (d > bestD) continue;
      if (s.kind === 'decoy' && Math.random() > this.skill.gullible) continue;
      if (s.kind !== 'decoy' && best && d > 8) continue; // fighters first unless the device is right there
      if (!g.world.physics.visible(eye, c)) continue;
      bestD = d;
      b.device = s.id;
    }
  }

  private shootDevice(f: Fighter, s: Summon, eye: THREE.Vector3): void {
    const it = f.intent;
    const d = s.pos.distanceTo(eye);
    const w = f.activeWeapon.def;
    if (w.kind === 'melee') {
      if (d < 3) it.fire = it.firePressed = true;
      return;
    }
    if (w.id === 'nuke') return;
    if (w.id === 'rail') it.aim = true;
    it.fire = it.firePressed = true;
  }

  /** servitors guard their engineer: follow, then engage anything that comes close */
  private servitorGoal(f: Fighter, b: BotBrain): void {
    const g = this.game;
    const boss = g.fighterById(f.summonOf);
    if (!boss || !boss.alive) {
      // hold position near the last spot
      b.path.length = 0;
      return;
    }
    const target = b.target >= 0 ? g.fighterById(b.target) : null;
    let goal: THREE.Vector3;
    if (target && target.alive && b.lastSeenT < 1 && target.body.pos.distanceTo(boss.body.pos) < 26) {
      goal = target.body.pos.clone();
      b.goalKind = 'engage';
    } else {
      // formation slot around the owner
      const slot = f.id % 3;
      const fwd = boss.body.forward(new THREE.Vector3());
      fwd.y = 0;
      fwd.normalize();
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
      goal = boss.body.pos.clone().addScaledVector(side, (slot - 1) * 2.2).addScaledVector(fwd, -1.2);
      b.goalKind = 'follow';
      if (goal.distanceTo(f.body.pos) < 2.5) {
        b.path.length = 0;
        return;
      }
    }
    b.replanT -= 0.2;
    if (!b.goal || b.goal.distanceTo(goal) > 2.5 || b.replanT <= 0 || b.pathIdx >= b.path.length) {
      b.goal = goal.clone();
      b.replanT = 1.2;
      const path = this.nav.path(this.nav.nearest(f.body.pos), this.nav.nearest(goal));
      b.path = path ?? [];
      b.pathIdx = Math.min(1, b.path.length);
    }
  }

  private chooseGoal(f: Fighter, b: BotBrain): void {
    const g = this.game;
    b.replanT -= 0.2;
    const tac = this.skill.tactics;
    const hurt = f.health < f.maxHealth * 0.35 || (f.breached && f.sealants === 0 && f.oxygen < 45);
    const target = b.target >= 0 ? g.fighterById(b.target) : null;
    const visible = !!target && b.lastSeenT < 0.3;
    let goal: THREE.Vector3 | null = null;
    let kind = 'roam';
    // cover: break line of sight while reloading / badly hurt (smart bots)
    if (visible && target && (hurt || f.activeWeapon.reloadT > 0) && f.hero !== 'blade' && Math.random() < tac) {
      if (b.goalKind === 'cover' && b.coverT > 0 && b.goal) return;
      const c = this.findCover(f, target);
      if (c) {
        goal = c;
        kind = 'cover';
        b.coverT = 2 + Math.random() * 1.5;
      }
    }
    // healing: allied support or o2/armor pickup
    if (!goal && hurt) {
      if (g.modeInfo.teams && tac > 0.2) {
        const medic = g.players.filter((o) => o.alive && o !== f && !g.areEnemies(f, o) && o.def.role === 'support').sort((a, c) => a.body.pos.distanceTo(f.body.pos) - c.body.pos.distanceTo(f.body.pos))[0];
        if (medic && medic.body.pos.distanceTo(f.body.pos) < 60) {
          goal = medic.body.pos.clone();
          kind = 'medic';
        }
      }
      if (!goal) {
        const p = g.match.nearestPickup(f.body.pos, ['o2', 'armor']);
        if (p) {
          goal = p;
          kind = 'heal';
        }
      }
    }
    // supports stay with the most hurt / nearest teammate
    if (!goal && f.def.role === 'support' && g.modeInfo.teams) {
      const mates = g.players.filter((o) => o.alive && o !== f && !g.areEnemies(f, o));
      const pick = mates.sort((a, c) => a.health / a.maxHealth - c.health / c.maxHealth + (a.body.pos.distanceTo(f.body.pos) - c.body.pos.distanceTo(f.body.pos)) * 0.01)[0];
      if (pick && (pick.health < pick.maxHealth * 0.8 || pick.body.pos.distanceTo(f.body.pos) > 14)) {
        goal = pick.body.pos.clone();
        kind = 'escort';
      }
    }
    // supply pod
    if (!goal && g.match.pod && g.match.pod.landed) {
      const nearestBot = g.players.filter((o) => o.alive && o.isBot).sort((a, c) => a.body.pos.distanceTo(g.match.pod!.pos) - c.body.pos.distanceTo(g.match.pod!.pos))[0];
      if (nearestBot === f) {
        goal = g.match.pod.pos;
        kind = 'pod';
      }
    }
    // objective
    if (!goal && g.match.controlPoints.length && g.modeInfo.teams) {
      const cps = g.match.controlPoints;
      const bots = g.players.filter((o) => o.team === f.team && o.isBot);
      const idx = bots.indexOf(f);
      // prioritise points not owned by us; smart teams stack on one point, others spread
      const wanted = cps.filter((c) => c.owner !== f.team || c.contested);
      const list = wanted.length ? wanted : cps;
      const stack = tac > 0.6 && list.length > 1;
      const cp = stack ? list.reduce((best, c) => (c.contested ? c : best), list[0]) : list[(idx + (f.id % 2)) % list.length];
      goal = cp.pos.clone().add(new THREE.Vector3(Math.sin(f.id * 2.3) * cp.radius * 0.5, 0, Math.cos(f.id * 1.7) * cp.radius * 0.5));
      kind = 'cp' + cp.id;
    }
    if (!goal && b.target >= 0 && b.lastSeen) {
      goal = b.lastSeen;
      kind = 'hunt';
    }
    // melee / flankers chase what they see instead of walking the objective path
    if (visible && target && (f.hero === 'blade' || f.hero === 'phantom') && !hurt && target.body.pos.distanceTo(f.body.pos) < 32 && kind !== 'cover') {
      goal = target.body.pos.clone();
      kind = 'chase';
    }
    // regroup with the team instead of wandering alone
    if (!goal && g.modeInfo.teams && Math.random() < tac * 0.7) {
      const mates = g.players.filter((o) => o.alive && o !== f && o.team === f.team);
      if (mates.length) {
        const c = new THREE.Vector3();
        for (const m of mates) c.add(m.body.pos);
        c.divideScalar(mates.length);
        if (c.distanceTo(f.body.pos) > 10) {
          goal = c;
          kind = 'regroup';
        }
      }
    }
    if (!goal) {
      if (b.goal && b.goalKind === 'roam' && b.goal.distanceTo(f.body.pos) > 4 && b.replanT > -8) return;
      // roam toward the middle / random point
      const center = g.match.controlPoints[0]?.pos ?? new THREE.Vector3();
      const nd = this.nav.randomNear(Math.random() < 0.5 ? center : f.body.pos, 45);
      if (nd >= 0) {
        const n = this.nav.nodes[nd];
        goal = new THREE.Vector3(n.x, n.y, n.z);
      }
      kind = 'roam';
      b.replanT = 0;
    }
    if (!goal) return;
    const changed = !b.goal || b.goal.distanceTo(goal) > 4 || b.goalKind !== kind;
    if (changed || b.replanT <= 0 || b.pathIdx >= b.path.length) {
      b.goal = goal.clone();
      b.goalKind = kind;
      b.replanT = 2.5 + Math.random();
      const a = this.nav.nearest(f.body.pos);
      const z = this.nav.nearest(goal);
      const path = this.nav.path(a, z);
      b.path = path ?? [];
      b.pathIdx = Math.min(1, b.path.length);
    }
  }

  /** a nearby walkable spot hidden from the threat */
  private findCover(f: Fighter, threat: Fighter): THREE.Vector3 | null {
    const g = this.game;
    const teye = threat.eye(new THREE.Vector3());
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (let i = 0; i < 10; i++) {
      const nd = this.nav.randomNear(f.body.pos, 11);
      if (nd < 0) continue;
      const n = this.nav.nodes[nd];
      _c.set(n.x, n.y + 1.2, n.z);
      if (g.world.physics.visible(teye, _c)) continue;
      const d = Math.hypot(n.x - f.body.pos.x, n.z - f.body.pos.z);
      if (d < bestD) {
        bestD = d;
        best = new THREE.Vector3(n.x, n.y, n.z);
      }
    }
    return best;
  }

  private followPath(f: Fighter, b: BotBrain, dt: number): THREE.Vector3 | null {
    void dt;
    if (!b.path.length || b.pathIdx >= b.path.length) return null;
    const body = f.body;
    const nodes = this.nav.nodes;
    // advance past reached nodes; look ahead for smoothing
    while (b.pathIdx < b.path.length) {
      const nd = nodes[b.path[b.pathIdx]];
      const dx = nd.x - body.pos.x;
      const dz = nd.z - body.pos.z;
      if (dx * dx + dz * dz < 1.1 && Math.abs(nd.y - body.pos.y) < 1.6) b.pathIdx++;
      else break;
    }
    if (b.pathIdx >= b.path.length) return null;
    let k = b.pathIdx;
    // skip ahead while the straight line stays clear (cheap: check up to 4 nodes)
    for (let s = 1; s <= 4 && b.pathIdx + s < b.path.length; s++) {
      const nd = nodes[b.path[b.pathIdx + s]];
      if (Math.abs(nd.y - body.pos.y) > 0.8) break;
      _v.set(body.pos.x, body.pos.y + 0.6, body.pos.z);
      _t.set(nd.x, nd.y + 0.6, nd.z);
      if (!this.game.world.physics.visible(_v, _t)) break;
      k = b.pathIdx + s;
    }
    const nd = nodes[b.path[k]];
    // jump edges
    if (k > 0 && this.nav.edgeNeedsJump(b.path[k - 1], b.path[k]) && body.grounded && Math.hypot(nd.x - body.pos.x, nd.z - body.pos.z) < 2.2) {
      f.intent.jumpPressed = f.intent.jump = true;
    }
    return _t.set(nd.x - body.pos.x, 0, nd.z - body.pos.z).normalize().clone();
  }

  /** Direction to aim at, with target leading and ballistic arcs for lobbed projectiles. */
  private aimAt(f: Fighter, t: Fighter, lastSeen: THREE.Vector3 | null, eye: THREE.Vector3): THREE.Vector3 {
    const w = f.activeWeapon.def;
    const aimPoint = new THREE.Vector3();
    if (lastSeen) aimPoint.copy(lastSeen).addScaledVector(t.body.up, 1.2);
    else {
      // headshots from good snipers, chest otherwise
      const headBias = f.hero === 'needle' ? 0.8 : this.skill.aimError < 0.03 ? 0.35 : 0.1;
      t.hitbox(Math.random() < headBias ? 0 : 1, aimPoint);
    }
    const dir = aimPoint.clone().sub(eye);
    if (w.kind === 'projectile' && w.speed > 0) {
      const dist = dir.length();
      const tFly = dist / w.speed;
      aimPoint.addScaledVector(t.body.vel, tFly * 0.9);
      dir.copy(aimPoint).sub(eye);
      if (w.gravity > 0) {
        // ballistic solution (lower arc)
        const gEff = MOON_G * w.gravity;
        const h = dir.y;
        const dxz = Math.hypot(dir.x, dir.z);
        const v = w.speed;
        const disc = v ** 4 - gEff * (gEff * dxz * dxz + 2 * h * v * v);
        if (disc >= 0 && dxz > 0.5) {
          const ang = Math.atan((v * v - Math.sqrt(disc)) / (gEff * dxz));
          const hd = new THREE.Vector3(dir.x, 0, dir.z).normalize();
          dir.copy(hd.multiplyScalar(Math.cos(ang))).setY(Math.sin(ang));
          return dir.normalize();
        }
      }
    }
    return dir.normalize();
  }

  private combat(f: Fighter, b: BotBrain, t: Fighter, dist: number): void {
    const it = f.intent;
    const w = f.activeWeapon;
    if (w.def.kind === 'melee') {
      if (dist < w.def.meleeRange + 0.4) it.fire = it.firePressed = true;
      return;
    }
    if (w.def.id === 'rail') {
      it.aim = true;
      if (w.charge > 0.8 || dist < 15) it.fire = it.firePressed = true;
      return;
    }
    if (w.def.id === 'nuke') {
      // don't nuke yourself
      if (dist > 30) it.fire = it.firePressed = true;
      return;
    }
    if (w.def.range < dist && w.def.kind === 'hitscan') return;
    if ((w.def.id === 'plasma' || w.def.id === 'riveter') && dist > 30) return;
    // burst rifle: tap bursts
    if (w.def.burstCount > 1) {
      b.holdFireT -= 0.016;
      if (b.holdFireT > 0) return;
      b.holdFireT = 0.1 + Math.random() * 0.15;
    }
    it.aim = dist > 25 && w.def.id !== 'plasma';
    it.fire = true;
    it.firePressed = true;
  }

  private useAbilities(f: Fighter, b: BotBrain, t: Fighter | null, tookDamage: boolean): void {
    const it = f.intent;
    const g = this.game;
    const dist = t ? t.body.pos.distanceTo(f.body.pos) : 999;
    const hurt = f.health / f.maxHealth;
    const a1 = f.abilities[0].charges > 0;
    const a2 = f.abilities[1].charges > 0;
    const id1 = f.abilities[0].id;
    const id2 = f.abilities[1].id;
    const enemiesNear = g.fighters.filter((o) => o.alive && g.areEnemies(f, o) && o.body.pos.distanceTo(f.body.pos) < 20).length;
    const alliesNear = g.fighters.filter((o) => o.alive && o !== f && !g.areEnemies(f, o) && o.body.pos.distanceTo(f.body.pos) < 12).length;
    const alliesHurt = g.fighters.filter((o) => o.alive && !g.areEnemies(f, o) && o.body.pos.distanceTo(f.body.pos) < 10 && (o.health < o.maxHealth * 0.6 || o.breached)).length;
    const onObjective = b.goalKind.startsWith('cp') && b.goal && b.goal.distanceTo(f.body.pos) < 10;
    if (f.ultReady) {
      const aoe = f.hero === 'reactor' || f.hero === 'phantom' || f.hero === 'lunatic';
      let use = (aoe && enemiesNear >= (g.modeInfo.teams ? 2 : 1)) || (!aoe && !!t && dist < 40);
      if (f.hero === 'helios') use = alliesHurt >= 1 && enemiesNear >= 1;
      if (f.hero === 'forge') use = enemiesNear >= 1 && (alliesNear >= 1 || hurt < 0.5);
      if (f.hero === 'blade') use = !!t && dist < 10;
      if (f.hero === 'hive') use = !!t && dist < 35;
      if (use) it.ultimate = true;
    }
    // swapped build abilities are handled by id first
    const useBarricade = (slot: 1 | 2) => {
      if (tookDamage || (onObjective && enemiesNear > 0)) {
        if (slot === 1) it.ability1 = true;
        else it.ability2 = true;
        return true;
      }
      return false;
    };
    if (id1 === 'barricade' && a1 && useBarricade(1)) return;
    if (id2 === 'huntdrone' && a2 && t) {
      it.ability2 = true;
      return;
    }
    switch (f.hero) {
      case 'condor':
        if (a2 && t && dist > 7 && dist < 25) it.ability2 = true;
        else if (a1 && (hurt < 0.4 || (t && dist > 30))) it.ability1 = true;
        break;
      case 'needle':
        if (a2 && t) it.ability2 = true;
        else if (a1 && (tookDamage || hurt < 0.5) && t) it.ability1 = true; // decoy to shake pursuers
        break;
      case 'reactor':
        if (a1 && id1 === 'dome' && t && (f.lastDamageT < 1 || enemiesNear >= 2)) it.ability1 = true;
        else if (a2 && t && dist < 12) it.ability2 = true;
        break;
      case 'helios':
        if (a1 && (alliesHurt >= 1 || hurt < 0.6)) it.ability1 = true;
        else if (a2 && (hurt < 0.7 || alliesHurt >= 2)) it.ability2 = true;
        break;
      case 'lunatic':
        if (a2 && t && dist < 20 && Math.random() < 0.5) it.ability2 = true;
        else if (a1 && f.body.grounded && (hurt < 0.35 || Math.random() < 0.2)) it.ability1 = true;
        break;
      case 'phantom':
        if (a2 && t && dist > 15 && f.cloakT <= 0) it.ability2 = true;
        else if (a1 && t && (dist > 10 || hurt < 0.4)) it.ability1 = true;
        break;
      case 'blade':
        if (a2 && tookDamage && t && dist > 3) it.ability2 = true; // deflect incoming fire
        else if (a1 && t && dist > 4 && dist < 13) it.ability1 = true; // lunge in
        else if (a1 && hurt < 0.3 && t) it.ability1 = true; // or lunge out
        break;
      case 'forge':
        if (a1 && id1 === 'servitor' && (t || onObjective)) it.ability1 = true;
        else if (a2 && id2 === 'turret' && (onObjective || (t && dist < 25))) it.ability2 = true;
        break;
      case 'hive':
        if (a1 && t) it.ability1 = true;
        else if (a2 && (!t || b.lastSeenT > 1)) it.ability2 = true; // scout with the spotter
        break;
    }
  }

  forget(id: number): void {
    this.brains.delete(id);
  }
}
