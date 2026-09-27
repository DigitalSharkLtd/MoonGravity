import * as THREE from 'three';
import type { Game } from './Game';
import { Fighter, HITBOXES, WeaponState } from './Fighter';
import { WEAPONS, WeaponDef, adsCapable, coneOf, recoilMulOf, recoilWeave, falloffAt, railChargeMul, AimState } from '../weapons/WeaponDefs';
import type { WeaponId, AbilityId } from './Types';
import { MOON_G } from '../core/Physics';
import { audio } from '../audio/Audio';
import { toonMat, glowMat } from '../render/Toon';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';
import { gs } from './Strings';

export type ProjKind = 'plasma' | 'grenade' | 'frag' | 'foam' | 'missile' | 'nuke' | 'blackhole' | 'mine' | 'sensor' | 'slug' | 'glob';
export type DamageSource = WeaponId | AbilityId | 'suffocation' | 'fall' | 'self' | 'radiation' | 'melee';

export interface Projectile {
  id: number;
  kind: ProjKind;
  owner: number; // fighter id
  team: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  bounce: number;
  fuse: number; // seconds (0 = none)
  age: number;
  maxAge: number;
  radius: number;
  damage: number;
  splash: number;
  splashDamage: number;
  source: DamageSource;
  /** simulated only for visuals (another peer owns the detonation) */
  ghost: boolean;
  stuck: boolean;
  stuckNormal: THREE.Vector3;
  target: number; // homing target fighter id (-1 none)
  mesh: THREE.Object3D | null;
  color: number;
  trail: number; // trail particle accumulator
  dead: boolean;
  armed: number; // mines: arm delay
  life2: number; // secondary timer (blackhole active time)
  heal: number;
  /** build flags: frag splits into bomblets / mine also EMPs */
  cluster?: boolean;
  empMine?: boolean;
  reflected?: boolean;
  /** foam glob patch: pulse timer for its heal / slow effect, and its puddle mesh */
  pulse?: number;
  patch?: THREE.Object3D | null;
}

export interface ExplosionSpec {
  pos: THREE.Vector3;
  radius: number;
  damage: number;
  owner: number;
  team: number;
  source: DamageSource;
  kind: 'small' | 'frag' | 'grenade' | 'missile' | 'nuke' | 'blackhole' | 'mine' | 'rocketjump' | 'slam' | 'emp' | 'foam';
  knock: number;
  emp: number; // seconds of EMP applied
  selfDamage: number; // multiplier on owner (0 = none)
  suitMul: number;
  heal?: number; // heal allies in radius (foam)
  /** fighter id that takes no splash (it already took the direct hit) */
  spare?: number;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hc = new THREE.Vector3();
const _step = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
/** foam glob patch */
const GLOB_R = 3.2;
const GLOB_LIFE = 5;

export interface FighterHit {
  fighter: Fighter;
  t: number;
  part: 'head' | 'body' | 'legs';
  point: THREE.Vector3;
}

export class Combat {
  game: Game;
  projectiles: Projectile[] = [];
  private nextId = 1;
  private projGeo = new THREE.SphereGeometry(1, 12, 8);

  constructor(game: Game) {
    this.game = game;
  }

  // ------------------------------------------------------------------ hit tests

  /** Nearest fighter hit along a ray (sphere hitboxes). */
  rayFighters(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, ignore: Fighter | null, skip?: Set<number>): FighterHit | null {
    let best: FighterHit | null = null;
    let bestT = maxDist;
    for (const f of this.game.fighters) {
      if (!f.alive || f === ignore || (skip && skip.has(f.id))) continue;
      // quick reject by distance to the body center
      f.hitbox(1, _hc);
      _v.copy(_hc).sub(origin);
      const along = _v.dot(dir);
      if (along < -1.5 || along > bestT + 1.5) continue;
      if (_v.lengthSq() - along * along > 4) continue;
      for (let i = 0; i < HITBOXES.length; i++) {
        f.hitbox(i, _hc);
        const r = f.hitRadius(i);
        _v.copy(origin).sub(_hc);
        const b = _v.dot(dir);
        const c = _v.lengthSq() - r * r;
        const disc = b * b - c;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t < 0 || t >= bestT) continue;
        bestT = t;
        best = { fighter: f, t, part: HITBOXES[i].part, point: origin.clone().addScaledVector(dir, t) };
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ weapons

  /** Aim state for the shared cone / recoil model (WeaponDefs). */
  aimState(f: Fighter, w: WeaponState): AimState {
    const b = f.body;
    const def = w.def;
    return {
      ads: f.intent.aim && adsCapable(def),
      crouch: b.crouching || b.stance === 'slide',
      prone: b.stance === 'prone',
      airborne: !b.grounded,
      moving: b.grounded ? b.moveSpeed : Math.hypot(b.vel.x, b.vel.z),
      bloom: w.spread,
      rest: w.sinceShot > Math.max(0.28, def.interval * 1.5) && w.spread <= def.bloom * 1.01 + 1e-6,
      steady: f.rolePassive === 'steady',
    };
  }

  /** riveter: the rounds left before overheating, shown as ammo */
  private syncHeatAmmo(w: WeaponState): void {
    if (w.def.heatPerShot <= 0) return;
    w.ammo = w.ventT > 0 ? 0 : Math.max(0, Math.floor((1 - w.heat) / w.def.heatPerShot + 1e-6));
  }

  /** view drifts back from recoil once the trigger is released; pulling against it eats the pending recoil */
  private recoverRecoil(f: Fighter, w: WeaponState, dt: number): void {
    const b = f.body;
    const it = f.intent;
    if (w.recoilPitch > 0 && it.pitch < 0) w.recoilPitch = Math.max(0, w.recoilPitch + it.pitch);
    if (w.recoilYaw !== 0 && it.yaw !== 0 && Math.sign(it.yaw) !== Math.sign(w.recoilYaw)) {
      const left = Math.max(0, Math.abs(w.recoilYaw) - Math.abs(it.yaw));
      w.recoilYaw = Math.sign(w.recoilYaw) * left;
    }
    if (w.sinceShot < w.def.interval + 0.05 || w.burstLeft > 0) return;
    const rate = w.def.recoilRecover * dt;
    if (w.recoilPitch > 0) {
      const d = Math.min(w.recoilPitch, rate);
      w.recoilPitch -= d;
      b.pitch = Math.max(-1.53, b.pitch - d);
    }
    if (w.recoilYaw !== 0) {
      const d = Math.min(Math.abs(w.recoilYaw), rate * 0.6) * Math.sign(w.recoilYaw);
      w.recoilYaw -= d;
      this.yawBody(f, -d);
    }
  }

  private yawBody(f: Fighter, a: number): void {
    if (a === 0) return;
    f.body.quat.multiply(_q.setFromAxisAngle(Y_AXIS, a)).normalize();
  }

  /** aim punch + bloom after a shot left the barrel */
  private kick(f: Fighter, w: WeaponState): void {
    const def = w.def;
    const st = this.aimState(f, w);
    const mul = recoilMulOf(def, st);
    const up = def.recoilUp * mul * (0.9 + Math.random() * 0.2);
    const side = def.recoilSide * mul * (recoilWeave(def, w.string) + (Math.random() - 0.5) * 0.6);
    const b = f.body;
    const before = b.pitch;
    b.pitch = Math.min(1.53, b.pitch + up);
    w.recoilPitch += b.pitch - before;
    this.yawBody(f, side);
    w.recoilYaw += side;
    w.string++;
    w.spread = Math.min(def.bloomMax, w.spread + def.bloom);
    w.sinceShot = 0;
  }

  /** Per-tick weapon handling for a locally simulated fighter. */
  tickWeapon(f: Fighter, dt: number): void {
    const g = this.game;
    const w = f.activeWeapon;
    const def = w.def;
    const it = f.intent;
    w.cooldown = Math.max(0, w.cooldown - dt);
    w.altCd = Math.max(0, w.altCd - dt);
    w.sinceShot += dt;
    if (w.comboT > 0) w.comboT -= dt;
    if (w.staticT > 0) w.staticT -= dt;
    // the hero weapon keeps cooling while a super weapon is out (its shot timer must keep
    // running too, or passive cooling never starts after a quick switch)
    if (f.weapon !== w) {
      f.weapon.sinceShot += dt;
      this.tickHeat(f.weapon, dt);
    }
    this.tickHeat(w, dt);
    // bloom recovers once the trigger is released
    if (w.sinceShot > def.interval + 0.06 && w.burstLeft <= 0) w.spread = Math.max(0, w.spread - def.bloomDecay * dt);
    if (w.sinceShot > Math.max(def.interval * 1.6, 0.2)) w.string = 0;
    this.recoverRecoil(f, w, dt);
    if (f.switchT > 0) {
      f.switchT -= dt;
      return;
    }
    // weapon slot switching
    if (it.slot === 1 && f.superWeapon && f.slot !== 1) {
      f.slot = 1;
      f.switchT = 0.45;
      g.onWeaponSwitch(f);
      return;
    }
    if (it.slot === 0 && f.slot !== 0) {
      f.slot = 0;
      f.switchT = 0.35;
      g.onWeaponSwitch(f);
      return;
    }
    // remote detonation works any time (also mid-reload): it is a radio trigger, not the launcher
    if (it.altPressed && def.alt === 'detonate') this.altFire(f, w);
    // heat weapons: overheat / vent lockout
    if (w.ventT > 0) return;
    // reload
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) {
        const need = (w === f.weapon ? f.magSize : def.mag) - w.ammo;
        const take = def.reserve > 0 ? Math.min(need, w.reserve) : need;
        w.ammo += take;
        if (def.reserve > 0) w.reserve -= take;
        w.reloadT = 0;
      }
      return;
    }
    if (f.sealT > 0) return; // hands busy patching the suit
    const reloadMul = f.rolePassive === 'steady' ? 0.85 : f.rolePassive === 'salvage' ? 0.9 : 1;
    if (def.heatPerShot > 0) {
      // manual vent: dump the heat early (shorter than an overheat lockout)
      if (it.reload && w.heat > 0.12) {
        w.ventT = def.reload * reloadMul;
        w.charge = 0;
        this.syncHeatAmmo(w);
        g.sound('airbrake', f, 0.6);
        return;
      }
    } else {
      const mag = w === f.weapon ? f.magSize : def.mag;
      if ((it.reload && w.ammo < mag && (w.reserve > 0 || def.reserve === 0) && def.reload > 0) || (w.ammo <= 0 && w.reserve > 0 && def.reload > 0)) {
        w.reloadT = def.reload * reloadMul;
        w.charge = 0;
        g.sound('reload', f, 0.8);
        return;
      }
    }
    // railgun: charge while scoped (build / overcharge speed it up)
    if (def.charge > 0) {
      if (f.overchargeT > 0) w.charge = 1;
      else if (it.aim) w.charge = Math.min(1, w.charge + (dt / def.charge) * (f.mods.fireRate ?? 1));
      else w.charge = Math.max(0, w.charge - dt * 2);
    }
    // alt fire (RMB press): detonate / slug / glob
    if (it.altPressed && (def.alt === 'slug' || def.alt === 'glob')) this.altFire(f, w);
    // burst rifle: remaining rounds of the current burst
    if (w.burstLeft > 0) {
      w.burstT -= dt;
      if (w.burstT <= 0 && w.ammo > 0) {
        w.burstLeft--;
        w.burstT = def.burstGap;
        w.burstIdx++;
        w.ammo--;
        f.stats.shots++;
        this.fire(f, w);
      }
      if (w.ammo <= 0) w.burstLeft = 0;
      return;
    }
    const trigger = def.auto ? it.fire : it.firePressed;
    if (!trigger || w.cooldown > 0) return;
    if (def.kind === 'melee') {
      w.cooldown = def.interval / (f.mods.fireRate ?? 1) * (f.moonbladeT > 0 ? 0.8 : 1);
      f.cloakT = 0;
      f.firingVisual = 0.15;
      f.stats.shots++;
      // katana combo: every third swing within a second of the previous one is a heavy finisher
      const chained = w.comboT > 0;
      const finisher = chained && w.combo >= 2;
      w.combo = finisher ? 0 : chained ? w.combo + 1 : 1;
      w.comboT = 1.0;
      w.sinceShot = 0;
      const dmg = def.damage * (f.mods.damage ?? 1) * (f.moonbladeT > 0 ? 1.3 : 1) * (finisher ? 1.5 : 1);
      // attack step: each cut carries you a little forward (helps staying on a strafing target)
      if (f.body.grounded && f.body.up.y > 0.8) {
        const lk = f.body.viewDir(_w).setY(0);
        if (lk.lengthSq() > 1e-4) f.body.vel.addScaledVector(lk.normalize(), finisher ? 3 : 2);
      }
      this.meleeSwing(f, dmg, def.meleeRange + (finisher ? 0.6 : 0), def.meleeArc * (finisher ? 1.25 : 1), 'blade', finisher ? 7 : 3);
      if (finisher) g.sound('arc', f, 0.8);
      if (f.moonbladeT > 0) this.moonWave(f);
      return;
    }
    if (w.ammo <= 0) {
      if (it.firePressed) g.sound('dryfire', f, 0.6);
      return;
    }
    w.cooldown = def.interval / (f.mods.fireRate ?? 1);
    if (def.heatPerShot <= 0) w.ammo--;
    if (def.burstCount > 1) {
      w.burstLeft = def.burstCount - 1;
      w.burstT = def.burstGap;
      w.burstIdx = 0;
    }
    f.cloakT = 0; // firing breaks cloak
    f.firingVisual = 0.15;
    f.stats.shots++;
    const ws = (f.stats.weapons[w.id] ??= { kills: 0, headshots: 0, shots: 0, hits: 0 });
    ws.shots++;
    this.fire(f, w);
    if (def.heatPerShot > 0) {
      w.heat = Math.min(1, w.heat + def.heatPerShot);
      if (w.heat >= 1 - 1e-6) {
        w.ventT = def.overheat;
        g.sound('airbrake', f, 0.9);
        if (f === g.local) g.event({ type: 'toast', text: gs('overheat'), kind: 'warn' });
      }
      this.syncHeatAmmo(w);
    }
    // super weapons are single-use: drop back to the hero weapon when empty
    if (f.slot === 1 && w.ammo <= 0 && def.reserve === 0 && def.heatPerShot <= 0) {
      f.superWeapon = null;
      f.slot = 0;
      f.switchT = 0.4;
      g.onWeaponSwitch(f);
    }
  }

  /** heat bookkeeping (riveter): vent lockout and passive cooling */
  private tickHeat(w: WeaponState, dt: number): void {
    const def = w.def;
    if (def.heatPerShot <= 0) return;
    if (w.ventT > 0) {
      w.ventT -= dt;
      w.heat = Math.max(0, w.heat - dt / Math.max(0.2, def.overheat) * 1.2);
      if (w.ventT <= 0) {
        w.ventT = 0;
        w.heat = 0;
      }
    } else if (w.sinceShot > 0.25) w.heat = Math.max(0, w.heat - def.heatCool * dt);
    this.syncHeatAmmo(w);
  }

  /** RMB weapon skills that are not aim-down-sights. */
  private altFire(f: Fighter, w: WeaponState): void {
    const g = this.game;
    const def = w.def;
    if (def.alt === 'detonate') {
      let n = 0;
      for (const p of this.projectiles) {
        if (p.dead || p.ghost || p.owner !== f.id || p.kind !== 'grenade' || p.age < 0.12) continue;
        this.detonate(p, UP);
        n++;
      }
      g.sound(n ? 'switch' : 'dryfire', f, 0.5);
      return;
    }
    if (w.altCd > 0 || w.cooldown > 0.25 || w.reloadT > 0) return;
    if (w.ammo < def.altAmmo) {
      g.sound('dryfire', f, 0.6);
      return;
    }
    w.ammo -= def.altAmmo;
    w.altCd = def.altCooldown;
    w.cooldown = Math.max(w.cooldown, def.alt === 'slug' ? 0.55 : 0.3);
    f.cloakT = 0;
    f.firingVisual = 0.15;
    f.stats.shots++;
    const eye = f.eye(new THREE.Vector3());
    const muzzle = g.muzzleOf(f);
    const dir = f.body.viewDir(new THREE.Vector3());
    const dmgMul = f.mods.damage ?? 1;
    g.onFired(f, w);
    if (def.alt === 'slug') {
      // focused plasma slug: fast, no drop, small splash
      const vel = dir.clone().multiplyScalar(165).addScaledVector(f.body.vel, 0.5);
      const p = this.spawn('slug', f, eye.clone().addScaledVector(dir, 0.6), vel, def.id, muzzle);
      p.damage = 55 * dmgMul;
      p.splashDamage = 18 * dmgMul;
      this.kick(f, w);
    } else {
      // sticky foam glob on a lunar arc
      const vel = dir.clone().multiplyScalar(24).addScaledVector(f.body.up, 1.5).addScaledVector(f.body.vel, 0.5);
      const p = this.spawn('glob', f, eye.clone().addScaledVector(dir, 0.6), vel, def.id, muzzle);
      p.heal = 30 * dmgMul;
      p.damage = 25 * dmgMul;
    }
  }

  private spreadDir(f: Fighter, w: WeaponState, out: THREE.Vector3, cone?: number): THREE.Vector3 {
    const s = cone ?? coneOf(w.def, this.aimState(f, w));
    f.body.viewDir(out);
    if (s > 0) {
      const r = Math.sqrt(Math.random()) * s;
      const a = Math.random() * Math.PI * 2;
      const right = f.body.right(_w);
      const up = _o.copy(out).cross(right).normalize();
      out.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    }
    return out;
  }

  private fire(f: Fighter, w: WeaponState): void {
    const g = this.game;
    const def = w.def;
    const eye = f.eye(new THREE.Vector3());
    const muzzle = g.muzzleOf(f);
    g.onFired(f, w);
    const st = this.aimState(f, w);
    const cone = coneOf(def, st);
    let dmgMul = f.mods.damage ?? 1;
    if (f.ambushReady) {
      dmgMul *= 1.5;
      f.ambushReady = false;
    }
    // ADS tap-fire: a first shot from rest while aiming hits harder
    if (def.tapBonus > 0 && st.ads && st.rest) dmgMul *= 1 + def.tapBonus;
    if (def.kind === 'hitscan') {
      const dir = this.spreadDir(f, w, new THREE.Vector3(), cone);
      let dmg = def.damage * dmgMul;
      let pierce = def.pierce;
      let wallPierce = false;
      if (def.id === 'rail') {
        const c = f.overchargeT > 0 ? 1 : w.charge;
        dmg = def.damage * dmgMul * railChargeMul(c) * (f.overchargeT > 0 ? 1.25 : 1);
        wallPierce = f.overchargeT > 0;
        if (wallPierce) pierce = 3;
        w.charge = 0;
      }
      // burst rifle "Trill": third round of a burst whose first two rounds hit the same enemy
      const trill = def.burstCount > 1 && w.burstIdx === def.burstCount - 1 && w.burstHits >= def.burstCount - 1;
      if (trill) dmg *= 1.6;
      const hit = this.hitscan(f, w.id, eye, dir, muzzle, dmg, pierce, wallPierce, def.range);
      if (def.burstCount > 1) {
        if (w.burstIdx === 0) {
          w.burstHitId = hit ? hit.id : -1;
          w.burstHits = hit ? 1 : 0;
        } else if (hit && hit.id === w.burstHitId) w.burstHits++;
        if (trill && hit && f === g.local) g.sound('shield_hit', null, 0.35);
      }
      if (def.id === 'twinarc') this.staticCharge(f, w, hit);
    } else if (def.kind === 'projectile') {
      const n = def.pellets;
      const kind: ProjKind = def.id === 'plasma' || def.id === 'riveter' ? 'plasma' : def.id === 'glauncher' ? 'grenade' : def.id === 'sealer' ? 'foam' : def.id === 'nuke' ? 'nuke' : 'blackhole';
      for (let i = 0; i < n; i++) {
        const dir = this.spreadDir(f, w, new THREE.Vector3(), cone);
        // spawn from the eye (so shots go where you aim), visuals start at the muzzle
        const vel = dir.clone().multiplyScalar(def.speed).addScaledVector(f.body.vel, 0.5);
        const p = this.spawn(kind, f, eye.clone().addScaledVector(dir, 0.6), vel, def.id, muzzle);
        p.damage *= dmgMul;
        p.splashDamage *= dmgMul;
        if (def.id === 'sealer') p.heal *= dmgMul;
        if (def.id === 'riveter') p.maxAge = 1.6;
      }
      if (def.id === 'nuke') f.stats.nukes++;
    } else if (def.kind === 'designator') {
      const dir = f.body.viewDir(new THREE.Vector3());
      const hit = g.world.physics.raycast(eye, dir, def.range);
      const p = hit ? hit.point : eye.clone().addScaledVector(dir, def.range);
      g.effects.beam(muzzle, p, 0xff3030, 0.03, 0.6);
      g.abilities.orbitalStrike(f, p);
    }
    this.kick(f, w);
  }

  /** twin arcs: consecutive hits on one target build static; every 10th discharges an arc that chains */
  private staticCharge(f: Fighter, w: WeaponState, hit: Fighter | null): void {
    if (!hit) {
      if (w.staticT <= 0) w.staticN = 0;
      return;
    }
    if (hit.id === w.staticId && w.staticT > 0) w.staticN++;
    else {
      w.staticId = hit.id;
      w.staticN = 1;
    }
    w.staticT = 0.4;
    if (w.staticN < 10 || !hit.alive) return;
    w.staticN = 0;
    const g = this.game;
    const c = hit.hitbox(1, new THREE.Vector3());
    g.damage({ target: hit, attacker: f, amount: 20 * (f.mods.damage ?? 1), source: 'twinarc', part: 'body', dir: null, point: c.clone(), suitMul: 1, silent: true });
    g.effects.add.spawn({ pos: c, life: 0.3, size0: 1.4, size1: 0.2, color0: 0xc58cff, alpha0: 0.9, sprite: 4 });
    g.sound('arc', null, 0.9, c);
    // chain to the nearest other enemy within 6 m
    let best: Fighter | null = null;
    let bd = 6;
    for (const o of g.fighters) {
      if (!o.alive || o === hit || !g.areEnemies(f, o)) continue;
      const d = o.hitbox(1, _v).distanceTo(c);
      if (d < bd && g.world.physics.visible(c, _v)) {
        bd = d;
        best = o;
      }
    }
    if (best) {
      const c2 = best.hitbox(1, new THREE.Vector3());
      g.damage({ target: best, attacker: f, amount: 15 * (f.mods.damage ?? 1), source: 'twinarc', part: 'body', dir: c2.clone().sub(c).normalize(), point: c2.clone(), suitMul: 1, silent: true });
      g.effects.beam(c, c2, 0xd9a8ff, 0.05, 0.25);
    }
  }

  /** Instant hit ray (pulse rifle, railgun, twin arcs). Authority applies damage, clients send claims. */
  hitscan(f: Fighter, weapon: WeaponId, origin: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3, damage: number, pierce: number, wallPierce: boolean, range: number): Fighter | null {
    const g = this.game;
    const def = WEAPONS[weapon];
    let first: Fighter | null = null;
    const worldHit = wallPierce ? null : g.world.physics.raycast(origin, dir, range, { team: f.team });
    let maxT = worldHit ? worldHit.t : range;
    const skip = new Set<number>();
    let end = origin.clone().addScaledVector(dir, maxT);
    let hits = 0;
    // deployables (turrets, drones, decoys) in front of the world hit
    const sh = g.summons.rayHit(origin, dir, maxT, f.team, !g.modeInfo.teams, g.ownerId(f));
    if (sh) {
      maxT = sh.t;
      end = sh.point;
    }
    for (let k = 0; k <= pierce; k++) {
      const h = this.rayFighters(origin, dir, maxT, f, skip);
      if (!h) break;
      skip.add(h.fighter.id);
      if (!g.areEnemies(f, h.fighter)) {
        // friendly: shots pass through teammates
        continue;
      }
      if (this.deflects(h.fighter, dir)) {
        this.deflectFx(h.fighter, h.point, dir);
        end = h.point;
        hits++;
        break;
      }
      let dmg = damage * falloffAt(def, h.t);
      const head = h.part === 'head';
      if (!first) first = h.fighter;
      if (head) dmg *= def.headMul;
      else if (h.part === 'legs') dmg *= 0.85;
      g.damage({ target: h.fighter, attacker: f, amount: dmg, source: weapon, part: h.part, dir: dir.clone(), point: h.point, suitMul: def.suitMul });
      g.effects.impact(h.point, dir.clone().negate(), 'flesh', def.color);
      hits++;
      end = h.point;
      if (k >= pierce) break;
    }
    if (hits === 0 && sh) {
      g.summons.damage(sh.s, damage * (sh.s.kind === 'decoy' ? 1 : 0.9), f);
      g.effects.impact(sh.point, dir.clone().negate(), 'metal', def.color);
      g.sound('impact_metal', null, 0.5, sh.point);
    } else if (hits === 0 && worldHit) {
      const summon = (worldHit.collider as { tag?: string } | undefined)?.tag === 'summon' ? g.summons.byCollider(worldHit.collider) : null;
      if (summon) g.summons.damage(summon, damage, f);
      const surf = worldHit.colliderId >= 100000 && !summon ? 'shield' : worldHit.metal ? 'metal' : 'dirt';
      g.effects.impact(worldHit.point, worldHit.normal, surf, def.color);
      if (surf === 'shield') g.sound('shield_hit', null, 0.7, worldHit.point);
      else g.sound(surf === 'metal' ? 'impact_metal' : 'impact_dirt', null, 0.5, worldHit.point);
    }
    if (hits > 0 && pierce > 0 && worldHit) end = worldHit.point;
    else if (hits === 0 && !sh) end = worldHit ? worldHit.point : end;
    // tracer visuals
    if (weapon === 'rail') {
      g.effects.beam(muzzle, end, def.color, 0.12, 0.5);
      g.effects.beam(muzzle, end, 0xffffff, 0.035, 0.25);
    } else g.effects.tracer(muzzle, end, def.color, weapon === 'twinarc' ? 0.05 : 0.07);
    g.net.fireFx(f, weapon, muzzle, end);
    return first;
  }

  // ------------------------------------------------------------------ projectiles

  spawn(kind: ProjKind, f: Fighter, pos: THREE.Vector3, vel: THREE.Vector3, source: DamageSource, visualFrom?: THREE.Vector3, ghost = false, id?: number): Projectile {
    const def = typeof source === 'string' && source in WEAPONS ? WEAPONS[source as WeaponId] : null;
    const p: Projectile = {
      id: id ?? f.id * 100000 + this.nextId++,
      kind,
      owner: f.id,
      team: f.team,
      pos: pos.clone(),
      vel: vel.clone(),
      gravity: 0,
      bounce: 0,
      fuse: 0,
      age: 0,
      maxAge: 6,
      radius: 0.12,
      damage: def?.damage ?? 0,
      splash: def?.splash ?? 0,
      splashDamage: def?.splashDamage ?? 0,
      source,
      ghost,
      stuck: false,
      stuckNormal: new THREE.Vector3(0, 1, 0),
      target: -1,
      mesh: null,
      color: def?.color ?? 0xffffff,
      trail: 0,
      dead: false,
      armed: 0,
      life2: 0,
      heal: def?.heal ?? 0,
    };
    let mesh: THREE.Object3D;
    switch (kind) {
      case 'plasma':
        p.maxAge = 0.8;
        p.radius = 0.1;
        p.gravity = def?.gravity ?? 0; // plasma: none; rivets: true lunar drop
        mesh = this.glowBall(0.1, p.color, 3);
        break;
      case 'slug':
        p.maxAge = 1.1;
        p.radius = 0.14;
        p.damage = 55;
        p.splash = 1.6;
        p.splashDamage = 18;
        mesh = this.glowBall(0.17, p.color, 3.5);
        break;
      case 'foam':
        p.gravity = def?.gravity ?? 1;
        p.maxAge = 3;
        p.radius = 0.12;
        mesh = this.glowBall(0.13, 0x9dffb0, 1.8);
        break;
      case 'glob':
        p.gravity = 1;
        p.maxAge = 4 + GLOB_LIFE;
        p.radius = 0.18;
        p.damage = 25;
        p.heal = 30;
        p.color = 0x9dffb0;
        p.life2 = GLOB_LIFE;
        p.pulse = 0;
        mesh = this.glowBall(0.22, 0x9dffb0, 2.2);
        break;
      case 'grenade':
        p.gravity = def?.gravity ?? 1;
        p.bounce = def?.bounce ?? 0.45;
        p.fuse = def?.fuse || 1.8;
        p.radius = 0.1;
        mesh = this.grenadeMesh(0xffc21a);
        break;
      case 'frag':
        p.gravity = 1;
        p.bounce = 0.4;
        p.fuse = 1.8;
        p.radius = 0.1;
        p.damage = 0;
        p.splash = 4.8;
        p.splashDamage = 110;
        p.color = 0xff8a30;
        mesh = this.grenadeMesh(0x39424f);
        break;
      case 'missile':
        p.maxAge = 4;
        p.radius = 0.12;
        p.damage = 0;
        p.splash = 2.4;
        p.splashDamage = 32;
        p.color = 0xff7040;
        mesh = this.missileMesh(0xe8e8e8, 0.5);
        break;
      case 'nuke':
        p.maxAge = 12;
        p.radius = 0.25;
        p.damage = 250;
        p.color = 0xfff066;
        mesh = this.missileMesh(0xffc21a, 1.4);
        break;
      case 'blackhole':
        p.maxAge = 1.3;
        p.radius = 0.3;
        p.splash = 11;
        p.splashDamage = 150;
        p.color = 0xb06cff;
        mesh = this.glowBall(0.35, 0xb06cff, 3);
        break;
      case 'mine':
        p.gravity = 1;
        p.maxAge = 60;
        p.radius = 0.15;
        p.splash = 4.2;
        p.splashDamage = 115;
        p.color = 0xff8a1f;
        p.armed = 0.8;
        mesh = this.mineMesh();
        break;
      case 'sensor':
        p.gravity = 1;
        p.maxAge = 14;
        p.radius = 0.12;
        p.color = 0x4db8ff;
        mesh = this.mineMesh(0x4db8ff);
        break;
    }
    p.mesh = mesh;
    mesh.position.copy(visualFrom ?? pos);
    this.game.effects.group.add(mesh);
    this.projectiles.push(p);
    if (!ghost) this.game.net.projectile(p, visualFrom ?? pos);
    return p;
  }

  private glowBall(r: number, color: number, intensity: number): THREE.Object3D {
    const g = new THREE.Group();
    const core = new THREE.Mesh(this.projGeo, glowMat(color, intensity));
    core.scale.setScalar(r);
    const halo = new THREE.Mesh(this.projGeo, glowMat(color, intensity * 0.6, { additive: true, opacity: 0.4 }));
    halo.scale.setScalar(r * 2.2);
    g.add(core, halo);
    g.traverse((o) => o.layers.set(LAYER_NO_OUTLINE));
    return g;
  }

  private grenadeMesh(color: number): THREE.Object3D {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), toonMat(color, { spec: 0.6 }));
    b.scale.set(1, 1.25, 1);
    b.castShadow = true;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), glowMat(0xff3030, 5));
    l.position.y = 0.11;
    l.layers.set(LAYER_NO_OUTLINE);
    g.add(b, l);
    return g;
  }

  private missileMesh(color: number, scale: number): THREE.Object3D {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 10), toonMat(color, { spec: 0.6 }));
    body.rotation.x = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 10), toonMat(0xd8d8d8, { spec: 1 }));
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -0.33;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glowMat(0xffa040, 5));
    glow.position.z = 0.28;
    glow.layers.set(LAYER_NO_OUTLINE);
    g.add(body, tip, glow);
    g.scale.setScalar(scale);
    return g;
  }

  private mineMesh(color = 0xff8a1f): THREE.Object3D {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 14), toonMat(0x39424f, { spec: 0.8 }));
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10), glowMat(color, 4));
    l.layers.set(LAYER_NO_OUTLINE);
    g.add(b, l);
    return g;
  }

  update(dt: number): void {
    const g = this.game;
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.age += dt;
      const owner = g.fighterById(p.owner);
      // homing missiles
      if (p.kind === 'missile' && p.target >= 0) {
        const t = g.fighterById(p.target);
        if (t && t.alive) {
          t.hitbox(1, _v).sub(p.pos).normalize();
          const sp = p.vel.length();
          _d.copy(p.vel).normalize().lerp(_v, Math.min(1, dt * 3.5)).normalize();
          p.vel.copy(_d).multiplyScalar(Math.min(42, sp + dt * 30));
        }
      }
      if (p.kind === 'nuke') p.vel.addScaledVector(_v.copy(p.vel).normalize(), dt * 6); // rocket motor
      if (p.stuck) {
        this.tickStuck(p, dt, owner);
        continue;
      }
      if (p.kind === 'blackhole' && p.life2 > 0) {
        this.tickBlackhole(p, dt, owner);
        continue;
      }
      // ballistic step: exact for constant gravity (no energy drift at low tick rates)
      const gdt = MOON_G * p.gravity * dt;
      // (own temp vector: rayFighters / summons.rayHit reuse _v — sharing it teleported shots onto fighters)
      const step = _step.copy(p.vel).multiplyScalar(dt);
      step.y -= 0.5 * gdt * dt;
      p.vel.y -= gdt;
      const len = step.length();
      if (len > 1e-6) {
        _d.copy(step).divideScalar(len);
        // world collision (shields of the owner's team let own shots through)
        const hit = g.world.physics.raycast(p.pos, _d, len + p.radius, { team: p.team });
        // fighter collision (swept along the whole step: no tunnelling at 165 m/s)
        const fh = p.kind === 'mine' || p.kind === 'sensor' ? null : this.rayFighters(p.pos, _d, hit ? hit.t : len + p.radius, owner, undefined);
        if (fh && owner && p.kind !== 'foam' && p.kind !== 'glob' && g.areEnemies(owner, fh.fighter) && this.deflects(fh.fighter, _d)) {
          // Blade's deflect: send the projectile back at its owner
          this.deflectFx(fh.fighter, fh.point, _d);
          if (!p.ghost) {
            const f2 = fh.fighter;
            const back = f2.body.viewDir(new THREE.Vector3());
            p.vel.copy(back).multiplyScalar(Math.max(20, p.vel.length()));
            p.pos.copy(fh.point).addScaledVector(back, 0.8);
            p.owner = f2.id;
            p.team = f2.team;
            p.reflected = true;
            p.target = -1;
          }
          continue;
        }
        if (fh) {
          if (p.kind === 'glob') {
            // globs splat on whoever they hit and turn into a patch at their feet (owner and ghosts alike)
            if (!p.ghost) this.projectileHitFighter(p, fh, owner);
            this.stickGlob(p, fh.fighter.body.pos, fh.fighter.body.up, false);
            continue;
          }
          if (!p.ghost) this.projectileHitFighter(p, fh, owner);
          else this.retire(p);
          continue;
        }
        // deployables
        if (p.kind !== 'mine' && p.kind !== 'sensor' && p.kind !== 'foam' && p.kind !== 'glob') {
          const sh = g.summons.rayHit(p.pos, _d, hit ? hit.t : len + p.radius, p.team, !g.modeInfo.teams, owner ? g.ownerId(owner) : p.owner);
          if (sh) {
            if (!p.ghost) {
              if (p.damage > 0) g.summons.damage(sh.s, p.damage, owner);
              this.detonateAt(p, sh.point, _d.clone().negate(), false);
            } else this.retire(p);
            continue;
          }
        }
        if (hit && !p.ghost && (hit.collider as { tag?: string } | undefined)?.tag === 'summon' && p.damage > 0 && p.kind !== 'glob') {
          const s2 = g.summons.byCollider(hit.collider);
          if (s2) g.summons.damage(s2, p.damage, owner);
        }
        if (hit) {
          p.pos.copy(hit.point).addScaledVector(hit.normal, p.radius);
          // shields / domes are energy fields: nothing sticks to them
          const field = hit.colliderId >= 100000;
          if ((p.kind === 'mine' || p.kind === 'sensor' || p.kind === 'glob') && !field) {
            if (p.kind === 'glob') {
              this.stickGlob(p, hit.point, hit.normal, true);
              continue;
            }
            p.stuck = true;
            p.stuckNormal.copy(hit.normal);
            p.vel.set(0, 0, 0);
            if (p.mesh) p.mesh.quaternion.setFromUnitVectors(UP, hit.normal);
            g.sound('mag_clamp', null, 0.6, p.pos);
          } else if ((p.bounce > 0 && p.fuse > 0) || ((p.kind === 'mine' || p.kind === 'sensor' || p.kind === 'glob') && field)) {
            const vn = p.vel.dot(hit.normal);
            if (vn < 0) {
              // surface response: metal rings (bouncy, slick), regolith soaks up energy and grips
              const metal = hit.metal && !field;
              const e = (p.bounce || 0.3) * (metal ? 1.2 : 0.65);
              const mu = metal ? 0.12 : 0.38;
              _w.copy(hit.normal).multiplyScalar(vn); // normal part
              p.vel.sub(_w).multiplyScalar(1 - mu); // tangential part with friction
              if (-vn > 0.9) p.vel.addScaledVector(hit.normal, -vn * e);
              else {
                // resting / rolling contact: rolling friction instead of micro-bounces
                p.vel.multiplyScalar(Math.max(0, 1 - (metal ? 1.5 : 4) * dt));
              }
              if (-vn > 2) g.sound('grenade_bounce', null, Math.min(1, -vn / 10), p.pos);
              if (p.kind === 'grenade' && p.age > 0.05 && -vn > 3) {
                // grenade launcher shells burst on hard first impacts into metal
                if (metal && !p.ghost && p.age < 0.6) {
                  this.detonate(p, hit.normal);
                  continue;
                }
              }
            }
          } else {
            if (!p.ghost) this.detonateAt(p, hit.point, hit.normal, hit.colliderId >= 100000);
            else this.retire(p);
            continue;
          }
        } else p.pos.add(step);
      }
      // trails
      p.trail += dt;
      if (p.kind === 'missile' || p.kind === 'nuke') {
        while (p.trail > 0.012) {
          p.trail -= 0.012;
          g.effects.add.spawn({ pos: p.pos, vel: _w.copy(p.vel).multiplyScalar(-0.1), life: 0.25, size0: p.kind === 'nuke' ? 0.5 : 0.22, size1: 0.05, color0: 0xffc070, color1: 0xff4010, sprite: 0 });
          g.effects.alpha.spawn({ pos: p.pos, vel: _w.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4), life: p.kind === 'nuke' ? 3 : 1.2, size0: 0.15, size1: p.kind === 'nuke' ? 1.4 : 0.6, color0: 0xd8d8d8, alpha0: 0.4, sprite: 1 });
        }
      } else if (p.kind === 'plasma' || p.kind === 'blackhole' || p.kind === 'foam' || p.kind === 'slug' || p.kind === 'glob') {
        const every = p.kind === 'slug' ? 0.01 : 0.02;
        while (p.trail > every) {
          p.trail -= every;
          g.effects.add.spawn({ pos: p.pos, life: p.kind === 'slug' ? 0.25 : 0.18, size0: p.kind === 'blackhole' ? 0.6 : p.kind === 'slug' ? 0.3 : 0.16, size1: 0.02, color0: p.kind === 'foam' || p.kind === 'glob' ? 0x9dffb0 : p.color, alpha0: 0.8, sprite: 0 });
        }
      } else if (p.kind === 'grenade' || p.kind === 'frag') {
        while (p.trail > 0.03) {
          p.trail -= 0.03;
          g.effects.add.spawn({ pos: p.pos, life: 0.3, size0: 0.08, size1: 0.01, color0: 0xff5030, alpha0: 0.7, sprite: 0 });
        }
      }
      // fuse / lifetime
      if ((p.fuse > 0 && p.age >= p.fuse) || p.age >= p.maxAge) {
        if (p.ghost) {
          if (p.age >= p.maxAge + 1.5) this.retire(p); // wait for owner's detonation event
          continue;
        }
        if (p.kind === 'blackhole') {
          this.startBlackhole(p, owner);
          continue;
        }
        if (p.kind === 'plasma' || p.kind === 'foam' || p.kind === 'slug' || p.kind === 'glob') this.retire(p);
        else this.detonate(p, UP);
      }
    }
    // sync meshes, cull dead
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.dead) {
        if (p.mesh) g.effects.group.remove(p.mesh);
        if (p.patch) g.effects.group.remove(p.patch);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (p.mesh) {
        // visuals catch up from the muzzle to the true position quickly
        p.mesh.position.lerp(p.pos, Math.min(1, dt * 18));
        if (p.kind === 'missile' || p.kind === 'nuke') {
          _v.copy(p.pos).add(p.vel);
          p.mesh.lookAt(_v);
          p.mesh.rotateY(Math.PI);
        } else if (!p.stuck) p.mesh.rotation.x += dt * 8;
      }
    }
  }

  /** foam glob lands: becomes a foam patch for GLOB_LIFE seconds */
  private stickGlob(p: Projectile, at: THREE.Vector3, normal: THREE.Vector3, sound: boolean): void {
    const g = this.game;
    p.stuck = true;
    p.pos.copy(at).addScaledVector(normal, 0.05);
    p.stuckNormal.copy(normal);
    p.vel.set(0, 0, 0);
    p.life2 = GLOB_LIFE;
    p.age = Math.min(p.age, p.maxAge - GLOB_LIFE - 0.1);
    if (p.mesh) {
      p.mesh.position.copy(p.pos);
      p.mesh.scale.setScalar(0.6);
    }
    const disc = new THREE.Mesh(this.discGeo, glowMat(0x9dffb0, 0.9, { additive: true, opacity: 0.32, side: THREE.DoubleSide }));
    disc.position.copy(p.pos);
    disc.quaternion.setFromUnitVectors(UP, normal);
    disc.scale.setScalar(GLOB_R);
    disc.layers.set(LAYER_NO_OUTLINE);
    g.effects.group.add(disc);
    p.patch = disc;
    g.effects.add.spawn({ pos: p.pos, life: 0.45, size0: 0.4, size1: GLOB_R * 1.6, color0: 0x9dffb0, alpha0: 0.6, sprite: 3 });
    if (sound) g.sound('sealant', null, 0.7, p.pos);
  }
  private discGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);

  private tickStuck(p: Projectile, dt: number, owner: Fighter | null): void {
    const g = this.game;
    if (p.kind === 'glob') {
      this.tickGlob(p, dt, owner);
      return;
    }
    if (p.age >= p.maxAge) {
      if (p.kind === 'mine' && !p.ghost) this.detonate(p, p.stuckNormal);
      else this.retire(p);
      return;
    }
    if (p.kind === 'mine') {
      p.armed -= dt;
      if (p.armed > 0 || p.ghost) return;
      for (const f of g.fighters) {
        if (!f.alive || !owner || !g.areEnemies(owner, f)) continue;
        if (f.hitbox(1, _v).distanceTo(p.pos) < 3) {
          this.detonate(p, p.stuckNormal);
          return;
        }
      }
      // blink light
      if (p.mesh) (p.mesh.children[1] as THREE.Mesh).visible = Math.sin(p.age * 10) > 0;
    } else if (p.kind === 'sensor') {
      // Recon build ('wideSensor'): 28 m instead of 20 m
      const R = owner?.flags.has('wideSensor') ? 28 : 20;
      if (Math.random() < dt * 2) g.effects.add.spawn({ pos: p.pos, life: 1.2, size0: 0.3, size1: R * 0.9, color0: 0x4db8ff, alpha0: 0.25, sprite: 3 });
      if (!owner) return;
      for (const f of g.fighters) {
        if (!f.alive || !g.areEnemies(owner, f)) continue;
        if (f.body.pos.distanceTo(p.pos) < R) f.revealedT = Math.max(f.revealedT, 0.5);
      }
    }
  }

  /**
   * Foam patch: enemies wading through it are slowed (every peer slows the fighters it simulates, so it
   * works for remote players too); allies regenerate (the owner's machine applies it, 4 pulses / s).
   */
  private tickGlob(p: Projectile, dt: number, owner: Fighter | null): void {
    const g = this.game;
    p.life2 -= dt;
    if (p.patch) {
      const k = Math.min(1, p.life2 / 0.6);
      p.patch.scale.setScalar(GLOB_R * (0.5 + 0.5 * Math.min(1, (GLOB_LIFE - p.life2) / 0.25)) * (0.3 + 0.7 * Math.max(0, k)));
    }
    if (p.life2 <= 0 || !owner) {
      this.retire(p);
      return;
    }
    if (Math.random() < dt * 6) g.effects.add.spawn({ pos: _v.copy(p.pos).add(_w.set((Math.random() - 0.5) * GLOB_R, 0.1, (Math.random() - 0.5) * GLOB_R)), vel: _o.set(0, 0.4, 0), life: 0.8, size0: 0.25, size1: 0.05, color0: 0x9dffb0, alpha0: 0.6, sprite: 0 });
    p.pulse = (p.pulse ?? 0) - dt;
    const pulse = p.pulse <= 0;
    if (pulse) p.pulse = 0.25;
    for (const f of g.fighters) {
      if (!f.alive) continue;
      const dx = f.body.pos.x - p.pos.x;
      const dz = f.body.pos.z - p.pos.z;
      if (dx * dx + dz * dz > GLOB_R * GLOB_R || Math.abs(f.body.pos.y - p.pos.y) > 2) continue;
      if (g.areEnemies(owner, f)) {
        if (f.control !== 'remote') f.slowT = Math.max(f.slowT, 0.3);
      } else if (pulse && !p.ghost) {
        g.heal(f, owner, 4, 2, true);
        f.oxygen = Math.min(100, f.oxygen + 2);
      }
    }
  }

  private startBlackhole(p: Projectile, owner: Fighter | null): void {
    p.life2 = 4;
    p.vel.set(0, 0, 0);
    if (p.mesh) {
      this.game.effects.group.remove(p.mesh);
      p.mesh = null;
    }
    const fx = this.game.effects.singularity(p.pos, p.splash, 4);
    p.mesh = null;
    (p as Projectile & { fx?: THREE.Object3D }).fx = fx;
    this.game.sound('singularity_fire', null, 1, p.pos);
    this.game.net.boom(p, 'bh-start');
  }

  private tickBlackhole(p: Projectile, dt: number, owner: Fighter | null): void {
    const g = this.game;
    p.life2 -= dt;
    // pull enemies toward the core, tick damage
    for (const f of g.fighters) {
      if (!f.alive || !owner || !g.areEnemies(owner, f)) continue;
      f.hitbox(1, _v);
      _d.copy(p.pos).sub(_v);
      const d = _d.length();
      if (d > p.splash) continue;
      const pull = (1 - d / p.splash) * 22 + 4;
      if (f.control !== 'remote') {
        f.body.vel.addScaledVector(_d.normalize(), pull * dt);
        if (f.body.attached && d < p.splash * 0.7) f.body.impulse(_d.clone().multiplyScalar(2));
      }
      if (!p.ghost) g.damage({ target: f, attacker: owner, amount: 28 * dt, source: 'blackhole', part: 'body', dir: _d.clone(), point: _v.clone(), suitMul: 1.2, silent: true });
    }
    if (p.life2 <= 0) {
      const fx = (p as Projectile & { fx?: THREE.Object3D }).fx;
      if (fx) g.effects.group.remove(fx);
      if (!p.ghost) this.detonate(p, UP);
      else this.retire(p);
    }
  }

  private projectileHitFighter(p: Projectile, h: FighterHit, owner: Fighter | null): void {
    const g = this.game;
    if (!owner) {
      this.retire(p);
      return;
    }
    const enemy = g.areEnemies(owner, h.fighter);
    if (p.kind === 'foam' || p.kind === 'glob') {
      if (!enemy) {
        g.heal(h.fighter, owner, p.heal, p.heal * 0.6);
        g.effects.impact(h.point, _v.copy(p.vel).normalize().negate(), 'energy', 0x9dffb0);
      } else {
        // foam gums up servos: the slow rides on the damage claim so the host applies it to anyone
        g.damage({ target: h.fighter, attacker: owner, amount: p.damage, source: p.source, part: h.part, dir: p.vel.clone().normalize(), point: h.point, suitMul: 0.5, slow: p.kind === 'glob' ? 2 : 1.2 });
        g.effects.impact(h.point, _v.copy(p.vel).normalize().negate(), 'energy', 0x9dffb0);
      }
      if (p.kind === 'glob') return; // becomes a patch (stickGlob)
      this.retire(p);
      g.net.boom(p, 'hit');
      return;
    }
    if (!enemy) {
      // friendly projectiles pass through allies
      p.pos.copy(h.point).addScaledVector(_v.copy(p.vel).normalize(), 0.6);
      return;
    }
    if (p.damage > 0) {
      let dmg = p.damage;
      if (h.part === 'head') dmg *= WEAPONS[p.source as WeaponId]?.headMul ?? 1.5;
      g.damage({ target: h.fighter, attacker: owner, amount: dmg, source: p.source, part: h.part, dir: p.vel.clone().normalize(), point: h.point, suitMul: WEAPONS[p.source as WeaponId]?.suitMul ?? 1 });
    }
    if (p.kind === 'plasma') {
      g.effects.impact(h.point, _v.copy(p.vel).normalize().negate(), 'energy', p.color);
      this.retire(p);
      g.net.boom(p, 'hit');
      return;
    }
    if (p.kind === 'slug') {
      // direct hit already dealt: the small splash only hits bystanders
      p.damage = 0;
      this.detonateAt(p, h.point, _v.copy(p.vel).normalize().negate(), false, h.fighter);
      return;
    }
    if (p.kind === 'blackhole') {
      p.pos.copy(h.point);
      this.startBlackhole(p, owner);
      return;
    }
    this.detonateAt(p, h.point, _v.copy(p.vel).normalize().negate(), false);
  }

  private detonate(p: Projectile, normal: THREE.Vector3): void {
    this.detonateAt(p, p.pos, normal, false);
  }

  /** Owner-side detonation: explosion + damage, broadcast so others show it. */
  detonateAt(p: Projectile, pos: THREE.Vector3, normal: THREE.Vector3, shield: boolean, spare: Fighter | null = null): void {
    const g = this.game;
    p.pos.copy(pos);
    if (p.kind === 'slug') {
      g.effects.impact(pos, normal, shield ? 'shield' : 'energy', p.color);
      this.explode({ pos: pos.clone(), radius: p.splash, damage: p.splashDamage, owner: p.owner, team: p.team, source: p.source, kind: 'small', knock: 3.5, emp: 0, selfDamage: 0, suitMul: 0.9, spare: spare?.id });
      this.retire(p);
      g.net.boom(p, 'hit');
      return;
    }
    if (p.kind === 'glob') {
      this.retire(p);
      return;
    }
    if (p.kind === 'plasma' || p.kind === 'foam') {
      g.effects.impact(pos, normal, shield ? 'shield' : 'energy', p.kind === 'foam' ? 0x9dffb0 : p.color);
      if (p.kind === 'foam') this.explode({ pos, radius: 2.4, damage: 10, owner: p.owner, team: p.team, source: p.source, kind: 'foam', knock: 0, emp: 0, selfDamage: 0, suitMul: 0.4, heal: p.heal * 0.6 });
      this.retire(p);
      g.net.boom(p, 'hit');
      return;
    }
    const kindMap: Record<ProjKind, ExplosionSpec['kind']> = { plasma: 'small', foam: 'foam', grenade: 'grenade', frag: 'frag', missile: 'missile', nuke: 'nuke', blackhole: 'blackhole', mine: 'mine', sensor: 'small', slug: 'small', glob: 'foam' };
    if (p.cluster) {
      const owner = g.fighterById(p.owner);
      if (owner) {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.random();
          const v = new THREE.Vector3(Math.cos(a) * 4.5, 5 + Math.random() * 2, Math.sin(a) * 4.5);
          const b = this.spawn('frag', owner, pos.clone().addScaledVector(normal, 0.3), v, p.source);
          b.fuse = 0.7 + Math.random() * 0.3;
          b.splash = 3;
          b.splashDamage = 38;
          b.mesh?.scale.setScalar(0.7);
        }
      }
    }
    this.explode({
      pos: pos.clone(),
      radius: p.splash,
      damage: p.splashDamage,
      owner: p.owner,
      team: p.team,
      source: p.source,
      kind: kindMap[p.kind],
      knock: p.kind === 'nuke' ? 30 : p.kind === 'blackhole' ? 8 : 9,
      emp: p.kind === 'nuke' ? 4 : p.empMine ? 2.5 : 0,
      selfDamage: p.kind === 'nuke' ? 1 : 0.35,
      suitMul: p.kind === 'nuke' ? 2 : 1.3,
    });
    this.retire(p);
    g.net.boom(p, 'boom');
  }

  retire(p: Projectile): void {
    p.dead = true;
  }

  /** Remote detonation event: show visuals at the owner's position. */
  remoteBoom(id: number, pos: THREE.Vector3, what: string): void {
    const p = this.projectiles.find((q) => q.id === id);
    if (!p) return;
    p.pos.copy(pos);
    if (what === 'bh-start') {
      this.startBlackhole(p, this.game.fighterById(p.owner));
      return;
    }
    if (what === 'boom') {
      const kindMap: Record<ProjKind, ExplosionSpec['kind']> = { plasma: 'small', foam: 'foam', grenade: 'grenade', frag: 'frag', missile: 'missile', nuke: 'nuke', blackhole: 'blackhole', mine: 'mine', sensor: 'small', slug: 'small', glob: 'foam' };
      this.explosionFx(pos, p.splash, kindMap[p.kind]);
    } else this.game.effects.impact(pos, UP, 'energy', p.color);
    this.retire(p);
  }

  // ------------------------------------------------------------------ explosions

  explosionFx(pos: THREE.Vector3, radius: number, kind: ExplosionSpec['kind']): void {
    const g = this.game;
    switch (kind) {
      case 'nuke':
        g.effects.nuke(pos, radius);
        g.sound('nuke', null, 1, pos);
        g.onNuke(pos, radius);
        break;
      case 'emp':
        g.effects.emp(pos, radius);
        g.sound('emp', null, 1, pos);
        break;
      case 'blackhole':
        g.effects.explosion(pos, radius * 0.6, 0xb06cff, false);
        g.sound('singularity_collapse', null, 1, pos);
        break;
      case 'foam':
        g.effects.add.spawn({ pos, life: 0.3, size0: 0.3, size1: 3, color0: 0x9dffb0, alpha0: 0.6, sprite: 3 });
        break;
      case 'slam':
        g.effects.shockwave(pos, UP, radius, 0xffd060, 0.5, 0.9);
        g.effects.dust(pos, 40, 3);
        g.sound('explosion', null, 0.8, pos);
        break;
      case 'rocketjump':
        g.effects.explosion(pos, radius * 0.7, 0xff9030, true);
        g.sound('explosion', null, 0.7, pos);
        break;
      default:
        g.effects.explosion(pos, Math.max(1.5, radius * 0.8), kind === 'mine' ? 0xff7020 : kind === 'missile' ? 0xff8040 : 0xffa040, pos.y - g.world.terrainData.hf.heightAt(pos.x, pos.z) < 1.5);
        g.sound(radius > 5 ? 'explosion_big' : 'explosion', null, 1, pos);
    }
  }

  /**
   * Visuals + (authoritative) radial damage, knockback and EMP.
   * Falloff uses the distance to the nearest hitbox surface (a direct hit is a full-power hit),
   * cover is the fraction of the target's head / chest / legs the blast can see, and knockback is
   * divided by the target's suit mass.
   */
  explode(e: ExplosionSpec): void {
    const g = this.game;
    this.explosionFx(e.pos, e.radius, e.kind);
    const owner = g.fighterById(e.owner);
    if (g.isAuthority && e.damage > 0 && !e.heal) g.summons.explosion(e.pos, e.radius, e.damage * (e.kind === 'nuke' ? 2 : 1), owner, e.team);
    for (const f of g.fighters) {
      if (!f.alive || f.id === e.spare) continue;
      let d = Infinity;
      for (let i = 0; i < HITBOXES.length; i++) d = Math.min(d, f.hitbox(i, _v).distanceTo(e.pos) - f.hitRadius(i));
      d = Math.max(0, d);
      if (d > e.radius) continue;
      const isSelf = owner === f;
      const enemy = owner ? g.areEnemies(owner, f) : true;
      // line of sight: how much of the body the blast reaches (walls shield, big blasts leak through)
      let seen = 0;
      for (let i = 0; i < HITBOXES.length; i++) {
        f.hitbox(i, _v);
        _d.copy(_v).sub(e.pos);
        const dl = _d.length();
        if (dl < 0.35 || !g.world.physics.raycast(e.pos, _d.divideScalar(dl), dl - 0.3, { ignoreTerrain: false })) seen++;
      }
      const frac = seen / HITBOXES.length;
      const cover = e.kind === 'nuke' ? 0.55 + 0.45 * frac : frac; // fully behind a wall: no damage
      f.hitbox(1, _v);
      _d.copy(_v).sub(e.pos);
      const dl = _d.length();
      if (dl > 1e-3) _d.divideScalar(dl);
      else _d.set(0, 1, 0);
      const k = (1 - (d / e.radius) * 0.7) * cover;
      if (e.heal && !enemy && owner) {
        g.heal(f, owner, e.heal * k, e.heal * 0.5 * k);
        continue;
      }
      // Lunatic's blastproof suit shrugs off his own blasts
      const selfMul = isSelf ? (f.passive === 'blastproof' ? 0 : e.selfDamage) : 1;
      if (enemy || (isSelf && selfMul > 0)) {
        const amt = e.damage * k * selfMul;
        if (amt > 0.5) g.damage({ target: f, attacker: owner ?? null, amount: amt, source: e.source, part: 'body', dir: _d.clone(), point: _v.clone(), suitMul: e.suitMul });
      }
      if ((enemy || (isSelf && e.kind !== 'rocketjump')) && e.knock > 0) {
        const own = isSelf && f.passive === 'blastproof' ? 1.3 : 1;
        const push = _d.clone().multiplyScalar((e.knock * k * own) / f.mass);
        push.y += (e.knock * 0.35 * k * own) / f.mass;
        // in 1/6 g a vertical kick of v m/s lifts you v²/3.2 m: cap the launch (blast-jumps get a bit more)
        const hz = Math.hypot(push.x, push.z);
        const maxH = e.kind === 'nuke' ? 16 : 11;
        if (hz > maxH) {
          push.x *= maxH / hz;
          push.z *= maxH / hz;
        }
        push.y = Math.min(push.y, isSelf ? 6.5 : e.kind === 'nuke' ? 7 : 4.5);
        g.push(f, push);
      }
      if (enemy && e.emp > 0) {
        f.empT = Math.max(f.empT, e.emp * k);
        if (f.control !== 'remote') f.body.emp(e.emp * k);
      }
    }
  }

  // ------------------------------------------------------------------ melee

  /** true if the target's deflect is up and the shot comes from its front */
  deflects(t: Fighter, dir: THREE.Vector3): boolean {
    if (t.deflectT <= 0) return false;
    const fwd = t.body.viewDir(_o);
    return fwd.dot(dir) < -0.2;
  }

  private deflectFx(t: Fighter, point: THREE.Vector3, dir: THREE.Vector3): void {
    const g = this.game;
    g.effects.impact(point, dir.clone().negate(), 'shield', 0x39e3a8);
    g.sound('shield_hit', null, 0.8, point);
    if (t.flags.has('deflectHeal') && g.isAuthority) g.heal(t, t, 6, 3, true);
  }

  /**
   * Cone cleave (Blade's katana and everyone's quick melee). Hits every enemy fighter and
   * deployable inside the arc; knocks them back a little.
   */
  meleeSwing(f: Fighter, damage: number, range: number, arc: number, source: DamageSource, knock = 3): number {
    const g = this.game;
    const eye = f.eye(new THREE.Vector3());
    const look = f.body.viewDir(new THREE.Vector3());
    f.meleeT = 0.32;
    f.swingSide = -f.swingSide;
    f.model?.swing(f.swingSide);
    if (f === g.local) g.viewmodelSwing(f.swingSide);
    g.sound('melee', f, source === 'blade' ? 1 : 0.8);
    if (source === 'blade') g.sound('arc', f, 0.25);
    const cosArc = Math.cos(arc);
    let n = 0;
    for (const o of g.fighters) {
      if (!o.alive || !g.areEnemies(f, o)) continue;
      let best = -1;
      let part: 'head' | 'body' | 'legs' = 'body';
      for (let i = 0; i < HITBOXES.length; i++) {
        o.hitbox(i, _v);
        _d.copy(_v).sub(eye);
        const d = _d.length() - o.hitRadius(i);
        if (d > range) continue;
        const c = _d.normalize().dot(look);
        if (c < cosArc && d > 0.6) continue;
        if (c > best) {
          best = c;
          part = HITBOXES[i].part;
        }
      }
      if (best < -0.5) continue;
      o.hitbox(1, _v);
      // walls block swings
      _d.copy(_v).sub(eye);
      const dl = _d.length();
      if (dl > 0.4 && g.world.physics.raycast(eye, _d.divideScalar(dl), dl - 0.3, { team: f.team })) continue;
      if (this.deflects(o, _d) && source !== 'melee') {
        this.deflectFx(o, _v, _d);
        continue;
      }
      const dmg = damage * (part === 'head' ? 1.2 : 1);
      g.damage({ target: o, attacker: f, amount: dmg, source, part, dir: _d.clone(), point: _v.clone(), suitMul: 1.2 });
      if (f.flags.has('lifesteal')) g.heal(f, f, dmg * 0.25, 0, true);
      g.effects.impact(_v, _d.clone().negate(), 'energy', source === 'blade' ? 0x39e3a8 : 0xffffff);
      // shove mostly sideways: a swing at someone above you must not launch them into lunar orbit
      _w.set(_d.x, 0, _d.z);
      if (_w.lengthSq() < 1e-4) _w.copy(look).setY(0);
      _w.normalize();
      g.push(o, _w.multiplyScalar((source === 'melee' ? 5 : knock) / o.mass).addScaledVector(o.body.up, 1.2 / o.mass));
      n++;
    }
    // deployables
    for (const s of g.summons.list) {
      if (s.dead || !g.summons.hostileTo(s, f)) continue;
      g.summons.center(s, _v);
      _d.copy(_v).sub(eye);
      const d = _d.length() - s.radius;
      if (d > range || _d.normalize().dot(look) < cosArc) continue;
      g.summons.damage(s, damage, f);
      g.effects.impact(_v, _d.clone().negate(), 'metal', 0xffffff);
      n++;
    }
    if (n > 0) {
      f.stats.hits++;
      g.sound('impact_metal', null, 0.6, eye);
    } else {
      // swing trail in the air
      g.effects.add.spawn({ pos: eye.clone().addScaledVector(look, 1.4), life: 0.18, size0: 1.2, size1: 0.4, color0: source === 'blade' ? 0x39e3a8 : 0xffffff, alpha0: 0.35, sprite: 4 });
    }
    return n;
  }

  /** Quick melee (V) — universal, short cooldown. */
  quickMelee(f: Fighter): void {
    if (f.meleeCd > 0 || f.sealT > 0) return;
    f.meleeCd = 0.9;
    f.cloakT = 0;
    if (f.hero === 'blade') {
      this.meleeSwing(f, 58 * (f.mods.damage ?? 1), 3.2, 0.9, 'blade');
      return;
    }
    this.meleeSwing(f, 40 * (f.mods.damage ?? 1), 2.4, 0.7, 'melee');
  }

  /** Moonblade ult: each swing also launches an energy crescent. */
  private moonWave(f: Fighter): void {
    const g = this.game;
    const eye = f.eye(new THREE.Vector3());
    const look = f.body.viewDir(new THREE.Vector3());
    const range = 16;
    const hit = g.world.physics.raycast(eye, look, range, { team: f.team });
    const maxT = hit ? hit.t : range;
    const skip = new Set<number>();
    for (let k = 0; k < 4; k++) {
      const h = this.rayFighters(eye, look, maxT, f, skip);
      if (!h) break;
      skip.add(h.fighter.id);
      if (!g.areEnemies(f, h.fighter)) continue;
      g.damage({ target: h.fighter, attacker: f, amount: 55 * (f.mods.damage ?? 1), source: 'moonblade', part: 'body', dir: look.clone(), point: h.point, suitMul: 1.3 });
    }
    const end = eye.clone().addScaledVector(look, maxT);
    const from = g.muzzleOf(f);
    g.effects.beam(from, end, 0x39e3a8, 0.35, 0.25);
    g.effects.beam(from, end, 0xd8fff0, 0.08, 0.2);
    for (let i = 0; i < 10; i++) g.effects.add.spawn({ pos: from.clone().lerp(end, i / 10), life: 0.3, size0: 0.9, size1: 0.1, color0: 0x39e3a8, alpha0: 0.6, sprite: 4 });
  }

  clear(): void {
    for (const p of this.projectiles) if (p.mesh) this.game.effects.group.remove(p.mesh);
    this.projectiles.length = 0;
  }

  static soundFor(w: WeaponId): string {
    return WEAPONS[w].sfx;
  }
}

export { audio };
