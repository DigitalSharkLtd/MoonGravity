import * as THREE from 'three';
import type { Game } from './Game';
import { Fighter, HITBOXES, WeaponState } from './Fighter';
import { WEAPONS } from '../weapons/WeaponDefs';
import type { WeaponId, AbilityId } from './Types';
import { MOON_G } from '../core/Physics';
import { audio } from '../audio/Audio';
import { toonMat, glowMat } from '../render/Toon';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';

export type ProjKind = 'plasma' | 'grenade' | 'frag' | 'foam' | 'missile' | 'nuke' | 'blackhole' | 'mine' | 'sensor';
export type DamageSource = WeaponId | AbilityId | 'suffocation' | 'fall' | 'self' | 'radiation';

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
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hc = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

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

  /** Per-tick weapon handling for a locally simulated fighter. */
  tickWeapon(f: Fighter, dt: number): void {
    const g = this.game;
    const w = f.activeWeapon;
    const def = w.def;
    const it = f.intent;
    w.cooldown = Math.max(0, w.cooldown - dt);
    w.spread = Math.max(0, w.spread - dt * 0.25);
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
    // reload
    if (w.reloadT > 0) {
      w.reloadT -= dt;
      if (w.reloadT <= 0) {
        const need = def.mag - w.ammo;
        const take = def.reserve > 0 ? Math.min(need, w.reserve) : need;
        w.ammo += take;
        if (def.reserve > 0) w.reserve -= take;
        w.reloadT = 0;
      }
      return;
    }
    if (f.sealT > 0) return; // hands busy patching the suit
    if ((it.reload && w.ammo < def.mag && (w.reserve > 0 || def.reserve === 0) && def.reload > 0) || (w.ammo <= 0 && w.reserve > 0 && def.reload > 0)) {
      w.reloadT = def.reload;
      w.charge = 0;
      g.sound('reload', f, 0.8);
      return;
    }
    // railgun charge while aiming
    if (def.charge > 0) {
      if (f.overchargeT > 0) w.charge = 1;
      else if (it.aim) w.charge = Math.min(1, w.charge + dt / 0.9);
      else w.charge = Math.max(0, w.charge - dt * 2);
    }
    const trigger = def.auto ? it.fire : it.firePressed;
    if (!trigger || w.cooldown > 0) return;
    if (w.ammo <= 0) {
      if (it.firePressed) g.sound('dryfire', f, 0.6);
      return;
    }
    w.cooldown = def.interval;
    w.ammo--;
    f.cloakT = 0; // firing breaks cloak
    f.firingVisual = 0.15;
    f.stats.shots++;
    const ws = (f.stats.weapons[w.id] ??= { kills: 0, headshots: 0, shots: 0, hits: 0 });
    ws.shots++;
    this.fire(f, w);
    // super weapons are single-use: drop back to the hero weapon when empty
    if (f.slot === 1 && w.ammo <= 0 && def.reserve === 0) {
      f.superWeapon = null;
      f.slot = 0;
      f.switchT = 0.4;
      g.onWeaponSwitch(f);
    }
  }

  private spreadDir(f: Fighter, w: WeaponState, out: THREE.Vector3): THREE.Vector3 {
    const def = w.def;
    const ads = f.intent.aim && def.id !== 'rail' ? 1 : f.intent.aim ? 1 : 0;
    let s = ads ? def.spreadAds : def.spreadHip;
    s += w.spread;
    if (!f.body.grounded) s += 0.01;
    if (f.body.moveSpeed > 2) s += 0.008 * (1 - ads * 0.7);
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
    w.spread = Math.min(0.06, w.spread + def.recoil * 0.25);
    if (def.kind === 'hitscan') {
      const dir = this.spreadDir(f, w, new THREE.Vector3());
      let dmg = def.damage;
      let pierce = def.pierce;
      let wallPierce = false;
      if (def.id === 'rail') {
        const c = f.overchargeT > 0 ? 1 : w.charge;
        dmg = def.damage * (0.42 + 0.58 * c) * (f.overchargeT > 0 ? 1.25 : 1);
        wallPierce = f.overchargeT > 0;
        if (wallPierce) pierce = 3;
        w.charge = 0;
      }
      this.hitscan(f, w.id, eye, dir, muzzle, dmg, pierce, wallPierce, def.range);
    } else if (def.kind === 'projectile') {
      const n = def.pellets;
      for (let i = 0; i < n; i++) {
        const dir = this.spreadDir(f, w, new THREE.Vector3());
        // spawn from the eye (so shots go where you aim), visuals start at the muzzle
        const kind: ProjKind = def.id === 'plasma' ? 'plasma' : def.id === 'glauncher' ? 'grenade' : def.id === 'sealer' ? 'foam' : def.id === 'nuke' ? 'nuke' : 'blackhole';
        const vel = dir.clone().multiplyScalar(def.speed).addScaledVector(f.body.vel, 0.5);
        this.spawn(kind, f, eye.clone().addScaledVector(dir, 0.6), vel, def.id, muzzle);
      }
      if (def.id === 'nuke') f.stats.nukes++;
    } else if (def.kind === 'designator') {
      const dir = f.body.viewDir(new THREE.Vector3());
      const hit = g.world.physics.raycast(eye, dir, def.range);
      const p = hit ? hit.point : eye.clone().addScaledVector(dir, def.range);
      g.effects.beam(muzzle, p, 0xff3030, 0.03, 0.6);
      g.abilities.orbitalStrike(f, p);
    }
  }

  /** Instant hit ray (pulse rifle, railgun, twin arcs). Authority applies damage, clients send claims. */
  hitscan(f: Fighter, weapon: WeaponId, origin: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3, damage: number, pierce: number, wallPierce: boolean, range: number): void {
    const g = this.game;
    const def = WEAPONS[weapon];
    const worldHit = wallPierce ? null : g.world.physics.raycast(origin, dir, range, { team: f.team });
    let maxT = worldHit ? worldHit.t : range;
    const skip = new Set<number>();
    let end = origin.clone().addScaledVector(dir, maxT);
    let hits = 0;
    for (let k = 0; k <= pierce; k++) {
      const h = this.rayFighters(origin, dir, maxT, f, skip);
      if (!h) break;
      skip.add(h.fighter.id);
      if (!g.areEnemies(f, h.fighter)) {
        // friendly: shots pass through teammates
        continue;
      }
      let dmg = damage;
      if (h.t > def.falloffStart) {
        const k2 = Math.min(1, (h.t - def.falloffStart) / Math.max(1, def.falloffEnd - def.falloffStart));
        dmg *= 1 - k2 * (1 - def.falloffMin);
      }
      const head = h.part === 'head';
      if (head) dmg *= def.headMul;
      else if (h.part === 'legs') dmg *= 0.85;
      g.damage({ target: h.fighter, attacker: f, amount: dmg, source: weapon, part: h.part, dir: dir.clone(), point: h.point, suitMul: def.suitMul });
      g.effects.impact(h.point, dir.clone().negate(), 'flesh', def.color);
      hits++;
      end = h.point;
      if (k >= pierce) break;
    }
    if (hits === 0 && worldHit) {
      const surf = worldHit.colliderId >= 100000 ? 'shield' : worldHit.metal ? 'metal' : 'dirt';
      g.effects.impact(worldHit.point, worldHit.normal, surf, def.color);
      if (surf === 'shield') g.sound('shield_hit', null, 0.7, worldHit.point);
      else g.sound(surf === 'metal' ? 'impact_metal' : 'impact_dirt', null, 0.5, worldHit.point);
    }
    if (hits > 0 && pierce > 0 && worldHit) end = worldHit.point;
    else if (hits === 0) end = worldHit ? worldHit.point : end;
    // tracer visuals
    if (weapon === 'rail') {
      g.effects.beam(muzzle, end, def.color, 0.12, 0.5);
      g.effects.beam(muzzle, end, 0xffffff, 0.035, 0.25);
    } else g.effects.tracer(muzzle, end, def.color, weapon === 'twinarc' ? 0.05 : 0.07);
    g.net.fireFx(f, weapon, muzzle, end);
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
        mesh = this.glowBall(0.1, p.color, 3);
        break;
      case 'foam':
        p.gravity = 0.6;
        p.maxAge = 3;
        p.radius = 0.12;
        mesh = this.glowBall(0.13, 0x9dffb0, 1.8);
        break;
      case 'grenade':
        p.gravity = 1;
        p.bounce = 0.45;
        p.fuse = 2.2;
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
      p.vel.y -= MOON_G * p.gravity * dt;
      const step = _v.copy(p.vel).multiplyScalar(dt);
      const len = step.length();
      if (len > 1e-6) {
        _d.copy(step).divideScalar(len);
        // world collision (shields of the owner's team let own shots through)
        const hit = g.world.physics.raycast(p.pos, _d, len + p.radius, { team: p.team });
        // fighter collision
        const fh = p.kind === 'mine' || p.kind === 'sensor' ? null : this.rayFighters(p.pos, _d, hit ? hit.t : len + p.radius, owner, undefined);
        if (fh && (p.kind !== 'foam' || true)) {
          if (!p.ghost) this.projectileHitFighter(p, fh, owner);
          else this.retire(p);
          continue;
        }
        if (hit) {
          p.pos.copy(hit.point).addScaledVector(hit.normal, p.radius);
          if (p.kind === 'mine' || p.kind === 'sensor') {
            p.stuck = true;
            p.stuckNormal.copy(hit.normal);
            p.vel.set(0, 0, 0);
            if (p.mesh) p.mesh.quaternion.setFromUnitVectors(UP, hit.normal);
            g.sound('mag_clamp', null, 0.6, p.pos);
          } else if (p.bounce > 0 && p.fuse > 0) {
            const vn = p.vel.dot(hit.normal);
            p.vel.addScaledVector(hit.normal, -(1 + p.bounce) * vn).multiplyScalar(0.8);
            if (Math.abs(vn) > 2) g.sound('grenade_bounce', null, Math.min(1, Math.abs(vn) / 10), p.pos);
            if (p.kind === 'grenade' && p.age > 0.05 && Math.abs(vn) > 3) {
              // grenade launcher shells burst on hard first impacts into metal
              if (hit.metal && !p.ghost && p.age < 0.6) {
                this.detonate(p, hit.normal);
                continue;
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
      } else if (p.kind === 'plasma' || p.kind === 'blackhole' || p.kind === 'foam') {
        while (p.trail > 0.02) {
          p.trail -= 0.02;
          g.effects.add.spawn({ pos: p.pos, life: 0.18, size0: p.kind === 'blackhole' ? 0.6 : 0.16, size1: 0.02, color0: p.kind === 'foam' ? 0x9dffb0 : p.color, alpha0: 0.8, sprite: 0 });
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
        if (p.kind === 'plasma' || p.kind === 'foam') this.retire(p);
        else this.detonate(p, UP);
      }
    }
    // sync meshes, cull dead
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.dead) {
        if (p.mesh) g.effects.group.remove(p.mesh);
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

  private tickStuck(p: Projectile, dt: number, owner: Fighter | null): void {
    const g = this.game;
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
      if (Math.random() < dt * 2) g.effects.add.spawn({ pos: p.pos, life: 1.2, size0: 0.3, size1: 18, color0: 0x4db8ff, alpha0: 0.25, sprite: 3 });
      if (!owner) return;
      for (const f of g.fighters) {
        if (!f.alive || !g.areEnemies(owner, f)) continue;
        if (f.body.pos.distanceTo(p.pos) < 20) f.revealedT = Math.max(f.revealedT, 0.5);
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
    if (p.kind === 'foam') {
      if (!enemy) {
        g.heal(h.fighter, owner, p.heal, p.heal * 0.6);
        g.effects.impact(h.point, _v.copy(p.vel).normalize().negate(), 'energy', 0x9dffb0);
      } else {
        g.damage({ target: h.fighter, attacker: owner, amount: p.damage, source: p.source, part: h.part, dir: p.vel.clone().normalize(), point: h.point, suitMul: 0.5 });
        h.fighter.slowT = Math.max(h.fighter.slowT, 1.2);
        g.effects.impact(h.point, _v.copy(p.vel).normalize().negate(), 'energy', 0x9dffb0);
      }
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
  detonateAt(p: Projectile, pos: THREE.Vector3, normal: THREE.Vector3, shield: boolean): void {
    const g = this.game;
    p.pos.copy(pos);
    if (p.kind === 'plasma' || p.kind === 'foam') {
      g.effects.impact(pos, normal, shield ? 'shield' : 'energy', p.kind === 'foam' ? 0x9dffb0 : p.color);
      if (p.kind === 'foam') this.explode({ pos, radius: 2.4, damage: 10, owner: p.owner, team: p.team, source: p.source, kind: 'foam', knock: 0, emp: 0, selfDamage: 0, suitMul: 0.4, heal: p.heal * 0.6 });
      this.retire(p);
      g.net.boom(p, 'hit');
      return;
    }
    const kindMap: Record<ProjKind, ExplosionSpec['kind']> = { plasma: 'small', foam: 'foam', grenade: 'grenade', frag: 'frag', missile: 'missile', nuke: 'nuke', blackhole: 'blackhole', mine: 'mine', sensor: 'small' };
    this.explode({
      pos: pos.clone(),
      radius: p.splash,
      damage: p.splashDamage,
      owner: p.owner,
      team: p.team,
      source: p.source,
      kind: kindMap[p.kind],
      knock: p.kind === 'nuke' ? 30 : p.kind === 'blackhole' ? 8 : 9,
      emp: p.kind === 'nuke' ? 4 : 0,
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
      const kindMap: Record<ProjKind, ExplosionSpec['kind']> = { plasma: 'small', foam: 'foam', grenade: 'grenade', frag: 'frag', missile: 'missile', nuke: 'nuke', blackhole: 'blackhole', mine: 'mine', sensor: 'small' };
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

  /** Visuals + (authoritative) radial damage, knockback and EMP. */
  explode(e: ExplosionSpec): void {
    const g = this.game;
    this.explosionFx(e.pos, e.radius, e.kind);
    const owner = g.fighterById(e.owner);
    for (const f of g.fighters) {
      if (!f.alive) continue;
      f.hitbox(1, _v);
      const d = _v.distanceTo(e.pos);
      if (d > e.radius) continue;
      const isSelf = owner === f;
      const enemy = owner ? g.areEnemies(owner, f) : true;
      // line of sight: explosions don't go through walls (big ones partially)
      _d.copy(_v).sub(e.pos);
      const dl = _d.length();
      let cover = 1;
      if (dl > 0.3) {
        _d.divideScalar(dl);
        const blocked = g.world.physics.raycast(e.pos, _d, dl - 0.3, { ignoreTerrain: false });
        if (blocked) cover = e.kind === 'nuke' ? 0.55 : 0.15;
      }
      const k = (1 - (d / e.radius) * 0.7) * cover;
      if (e.heal && !enemy && owner) {
        g.heal(f, owner, e.heal * k, e.heal * 0.5 * k);
        continue;
      }
      if (enemy || (isSelf && e.selfDamage > 0)) {
        const amt = e.damage * k * (isSelf ? e.selfDamage : 1);
        if (amt > 0.5 && owner) g.damage({ target: f, attacker: owner, amount: amt, source: e.source, part: 'body', dir: _d.clone(), point: _v.clone(), suitMul: e.suitMul });
        else if (amt > 0.5 && !owner) g.damage({ target: f, attacker: null, amount: amt, source: e.source, part: 'body', dir: _d.clone(), point: _v.clone(), suitMul: e.suitMul });
      }
      if ((enemy || isSelf) && e.knock > 0 && f.control !== 'remote') {
        const push = _d.clone().multiplyScalar(e.knock * k);
        push.y += e.knock * 0.35 * k;
        f.body.impulse(push);
      }
      if (enemy && e.emp > 0) {
        f.empT = Math.max(f.empT, e.emp * k);
        if (f.control !== 'remote') f.body.emp(e.emp * k);
      }
    }
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
