import * as THREE from 'three';
import type { Game } from './Game';
import type { Fighter, AbilityState } from './Fighter';
import { makeWeapon } from './Fighter';
import type { AbilityId } from './Types';
import { Collider } from '../core/Physics';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Zone {
  kind: 'dome' | 'bubble' | 'station' | 'strike';
  owner: number;
  team: number;
  pos: THREE.Vector3;
  radius: number;
  t: number;
  life: number;
  collider: Collider | null;
  mesh: THREE.Object3D | null;
  hp: number;
  target?: THREE.Vector3;
}

/**
 * Hero abilities (Shift / E) and ultimates (Q), plus lingering zones (shield domes,
 * life bubbles, med stations, orbital strikes). Owner-side activation; effects replicated via net events.
 */
export class Abilities {
  game: Game;
  zones: Zone[] = [];

  constructor(game: Game) {
    this.game = game;
  }

  /** Per-tick cooldowns and input handling for a locally controlled fighter. */
  tick(f: Fighter, dt: number): void {
    for (const a of f.abilities) this.tickState(a, dt);
    this.tickState(f.ult, dt);
    f.castT = Math.max(0, f.castT - dt * 3);
    // passive ult charge
    if (f.alive && f.ult.active <= 0) f.ultCharge = Math.min(f.def.ultCost, f.ultCharge + dt * 6);
    if (!f.alive) return;
    const it = f.intent;
    const blocked = f.empT > 0;
    if (it.ability1 && !blocked) this.tryUse(f, f.abilities[0], false);
    if (it.ability2 && !blocked) this.tryUse(f, f.abilities[1], false);
    if (it.ultimate && !blocked && f.ultReady && f.ult.active <= 0) this.tryUse(f, f.ult, true);
    this.tickActive(f, dt);
  }

  private tickState(a: AbilityState, dt: number): void {
    if (a.active > 0) a.active = Math.max(0, a.active - dt);
    if (a.charges < a.maxCharges) {
      a.cooldown -= dt;
      if (a.cooldown <= 0) {
        a.charges++;
        a.cooldown = a.charges < a.maxCharges ? a.maxCooldown : 0;
      }
    }
  }

  private tryUse(f: Fighter, a: AbilityState, ult: boolean): void {
    if (!ult && a.charges <= 0) return;
    if (!ult && a.active > 0 && a.duration > 0 && a.id !== 'sensor' && a.id !== 'medstation' && a.id !== 'dome') return;
    const ok = this.activate(f, a.id);
    if (!ok) return;
    if (ult) {
      f.ultCharge = 0;
      a.active = a.duration;
    } else {
      a.charges--;
      if (a.cooldown <= 0) a.cooldown = a.maxCooldown;
      a.active = a.duration;
    }
    f.castT = 1;
    f.cloakT = a.id === 'cloak' ? f.cloakT : 0;
    this.game.net.ability(f, a.id);
  }

  /** Owner-side activation. Returns false if it could not be used (e.g. no anchor target). */
  activate(f: Fighter, id: AbilityId): boolean {
    const g = this.game;
    const b = f.body;
    const eye = f.eye(new THREE.Vector3());
    const look = b.viewDir(new THREE.Vector3());
    switch (id) {
      case 'dash': {
        // jet dash in the move direction (or forward)
        const wish = new THREE.Vector3();
        const fwd = b.forward(new THREE.Vector3());
        const right = b.right(new THREE.Vector3());
        wish.addScaledVector(fwd, f.intent.forward).addScaledVector(right, f.intent.strafe);
        if (wish.lengthSq() < 0.01) wish.copy(fwd);
        wish.normalize();
        b.impulse(wish.multiplyScalar(14).addScaledVector(b.up, 1.5));
        g.sound('jet_start', f, 1);
        this.fxJetBurst(f);
        return true;
      }
      case 'frag': {
        const vel = look.clone().multiplyScalar(17).addScaledVector(b.up, 3.5).addScaledVector(b.vel, 0.6);
        g.combat.spawn('frag', f, eye.clone().addScaledVector(look, 0.5), vel, 'frag');
        g.sound('grenade_throw', f, 1);
        return true;
      }
      case 'swarm': {
        f.swarmT = 2.2;
        f.swarmFired = 0;
        g.sound('streak', f, 1);
        return true;
      }
      case 'anchor': {
        const hit = g.world.physics.raycast(eye, look, 45, { team: f.team });
        if (!hit || hit.t < 2) return false;
        f.anchor = { target: hit.point.clone(), normal: hit.metal ? hit.normal.clone() : null, t: 1.2 };
        g.effects.beam(g.muzzleOf(f), hit.point, 0x4db8ff, 0.05, 0.5);
        g.sound('mag_on', f, 1);
        return true;
      }
      case 'sensor': {
        const vel = look.clone().multiplyScalar(16).addScaledVector(b.up, 2);
        g.combat.spawn('sensor', f, eye.clone().addScaledVector(look, 0.5), vel, 'sensor');
        g.sound('grenade_throw', f, 0.8);
        return true;
      }
      case 'overcharge': {
        f.overchargeT = 7;
        g.sound('rail_charge', f, 1);
        return true;
      }
      case 'dome': {
        const pos = b.pos.clone();
        this.addZone({ kind: 'dome', owner: f.id, team: f.team, pos, radius: 5, t: 0, life: 8, collider: null, mesh: null, hp: 900 });
        g.sound('shield_up', null, 1, pos);
        return true;
      }
      case 'slam': {
        if (b.grounded) b.impulse(_v.copy(b.up).multiplyScalar(7));
        f.slam = 1.5;
        g.sound('jump', f, 1);
        return true;
      }
      case 'blackhole': {
        const vel = look.clone().multiplyScalar(18);
        g.combat.spawn('blackhole', f, eye.clone().addScaledVector(look, 0.8), vel, 'blackhole');
        g.sound('singularity_fire', f, 1);
        return true;
      }
      case 'o2burst': {
        const pos = b.center(new THREE.Vector3());
        g.effects.shockwave(pos, UP, 10, 0x7dff9a, 0.7, 0.8);
        g.effects.add.spawn({ pos, life: 0.6, size0: 1, size1: 12, color0: 0x9dffb0, alpha0: 0.5, sprite: 3 });
        g.sound('o2_refill', null, 1, pos);
        if (g.isAuthority) {
          for (const o of g.fighters) {
            if (!o.alive || g.areEnemies(f, o)) continue;
            if (o.body.pos.distanceTo(pos) > 10) continue;
            g.heal(o, f, 55, 40);
            o.oxygen = Math.min(100, o.oxygen + 50);
          }
        }
        return true;
      }
      case 'medstation': {
        const hit = g.world.physics.raycast(eye, look, 6, { team: f.team });
        const pos = hit && hit.normal.y > 0.5 ? hit.point.clone() : b.pos.clone();
        this.addZone({ kind: 'station', owner: f.id, team: f.team, pos, radius: 6, t: 0, life: 10, collider: null, mesh: null, hp: 200 });
        g.sound('shield_up', null, 0.7, pos);
        return true;
      }
      case 'lifebubble': {
        const pos = b.pos.clone();
        this.addZone({ kind: 'bubble', owner: f.id, team: f.team, pos, radius: 9, t: 0, life: 5, collider: null, mesh: null, hp: 1e9 });
        g.sound('shield_up', null, 1, pos);
        return true;
      }
      case 'rocketjump': {
        const pos = b.pos.clone();
        const wish = new THREE.Vector3();
        wish.addScaledVector(b.forward(_v), f.intent.forward).addScaledVector(b.right(_w), f.intent.strafe);
        if (wish.lengthSq() > 0.01) wish.normalize().multiplyScalar(7);
        b.impulse(wish.addScaledVector(b.up, 11));
        g.combat.explode({ pos, radius: 3.5, damage: 30, owner: f.id, team: f.team, source: 'rocketjump', kind: 'rocketjump', knock: 7, emp: 0, selfDamage: 0, suitMul: 1 });
        return true;
      }
      case 'mine': {
        const vel = look.clone().multiplyScalar(14).addScaledVector(b.up, 2.5);
        g.combat.spawn('mine', f, eye.clone().addScaledVector(look, 0.5), vel, 'mine');
        g.sound('grenade_throw', f, 0.8);
        return true;
      }
      case 'tacnuke': {
        f.superWeapon = makeWeapon('nuke');
        f.slot = 1;
        f.switchT = 0.5;
        g.onWeaponSwitch(f);
        g.announce('nukeReady', f);
        return true;
      }
      case 'blink': {
        const wish = new THREE.Vector3();
        wish.addScaledVector(b.forward(_v), f.intent.forward).addScaledVector(b.right(_w), f.intent.strafe);
        if (wish.lengthSq() < 0.01) b.forward(wish);
        wish.normalize();
        const from = b.center(new THREE.Vector3());
        const hit = g.world.physics.raycast(from, wish, 8, { forMove: true });
        const dist = hit ? Math.max(0, hit.t - 0.7) : 8;
        if (dist < 1) return false;
        g.effects.add.spawn({ pos: from, life: 0.35, size0: 1.6, size1: 0.2, color0: 0xb06cff, alpha0: 0.9, sprite: 4 });
        for (let i = 0; i < 12; i++) g.effects.add.spawn({ pos: from.clone().addScaledVector(wish, (i / 12) * dist), life: 0.3, size0: 0.5, size1: 0.05, color0: 0xc58cff, alpha0: 0.6, sprite: 0 });
        b.pos.addScaledVector(wish, dist);
        b.vel.multiplyScalar(0.5);
        g.sound('respawn', f, 0.7);
        return true;
      }
      case 'cloak': {
        f.cloakT = 5;
        g.sound('shield_down', f, 0.7);
        return true;
      }
      case 'empnova': {
        const pos = b.center(new THREE.Vector3());
        g.effects.emp(pos, 22);
        g.sound('emp', null, 1, pos);
        if (g.isAuthority || f.control === 'local') {
          for (const o of g.fighters) {
            if (!o.alive || !g.areEnemies(f, o)) continue;
            const d = o.body.pos.distanceTo(pos);
            if (d > 22) continue;
            g.applyEmp(o, 5);
            g.damage({ target: o, attacker: f, amount: 60, source: 'empnova', part: 'body', dir: o.body.pos.clone().sub(pos).normalize(), point: o.body.pos.clone(), suitMul: 1.2 });
          }
        }
        return true;
      }
    }
    return false;
  }

  /** Continuous effects of active abilities for a locally simulated fighter. */
  private tickActive(f: Fighter, dt: number): void {
    const g = this.game;
    const b = f.body;
    if (f.overchargeT > 0) f.overchargeT -= dt;
    if (f.cloakT > 0) f.cloakT -= dt;
    // swarm: fire micro-missiles at enemies near the crosshair
    if (f.swarmT > 0) {
      f.swarmT -= dt;
      const total = 16;
      const should = Math.floor((1 - Math.max(0, f.swarmT) / 2.2) * total);
      while (f.swarmFired < should) {
        f.swarmFired++;
        const eye = f.eye(new THREE.Vector3());
        const look = b.viewDir(new THREE.Vector3());
        const target = this.pickTarget(f, eye, look, 0.45, 60);
        const side = f.swarmFired % 2 ? 1 : -1;
        const pack = g.packOf(f);
        const vel = look.clone().multiplyScalar(18).addScaledVector(b.up, 5).addScaledVector(b.right(_v), side * 4);
        const p = g.combat.spawn('missile', f, pack.clone(), vel, 'swarm');
        p.target = target ? target.id : -1;
        g.sound('nuke_launch', f, 0.25);
      }
    }
    // magnetic anchor pull
    if (f.anchor) {
      const a = f.anchor;
      a.t -= dt;
      const c = b.center(_v);
      _w.copy(a.target).sub(c);
      const d = _w.length();
      if (d < 1.4 || a.t <= 0) {
        if (a.normal && d < 2.5) {
          b.vel.multiplyScalar(0.2);
          b.magOn = true;
        }
        f.anchor = null;
      } else {
        b.vel.copy(_w.divideScalar(d).multiplyScalar(24));
        g.effects.beam(g.muzzleOf(f), a.target, 0x4db8ff, 0.04, 0.05);
      }
    }
    // magnetic slam: dive, then shockwave on landing
    if (f.slam > 0) {
      f.slam -= dt;
      if (f.slam < 1.25 && !b.grounded) b.vel.addScaledVector(b.up, -40 * dt);
      if (b.grounded && f.slam < 1.3) {
        f.slam = 0;
        const pos = b.pos.clone();
        g.combat.explode({ pos, radius: 6.5, damage: 55, owner: f.id, team: f.team, source: 'slam', kind: 'slam', knock: 10, emp: 2, selfDamage: 0, suitMul: 1.2 });
      }
    }
  }

  private pickTarget(f: Fighter, eye: THREE.Vector3, look: THREE.Vector3, cone: number, range: number): Fighter | null {
    let best: Fighter | null = null;
    let bestScore = -1;
    for (const o of this.game.fighters) {
      if (!o.alive || !this.game.areEnemies(f, o) || o.cloakT > 0) continue;
      o.hitbox(1, _v).sub(eye);
      const d = _v.length();
      if (d > range) continue;
      const c = _v.dot(look) / d;
      if (c < Math.cos(cone)) continue;
      const score = c - d / range * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  private fxJetBurst(f: Fighter): void {
    const g = this.game;
    const p = g.packOf(f);
    for (let i = 0; i < 10; i++) g.effects.jet(p, _v.copy(f.body.vel).normalize().negate());
  }

  // ------------------------------------------------------------------ zones

  addZone(z: Zone): void {
    const g = this.game;
    if (z.kind === 'dome' || z.kind === 'bubble') {
      z.mesh = g.effects.bubble(z.pos, z.radius, z.kind === 'dome' ? (z.team === 1 ? 0xffa033 : 0x4dd8ff) : 0x7dff9a, z.life);
      if (z.kind === 'dome') {
        // blocks enemy fire (own team shoots through: team filter on raycasts), doesn't block movement
        z.collider = g.world.physics.addSphere(z.pos, z.radius, false, { dynamic: true, team: z.team, noMove: true });
      }
    } else if (z.kind === 'station') {
      const m = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.3 }));
      base.position.y = 0.25;
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dff9a).multiplyScalar(3), toneMapped: false }));
      core.position.y = 0.7;
      m.add(base, core);
      m.position.copy(z.pos);
      g.effects.group.add(m);
      z.mesh = m;
    }
    this.zones.push(z);
  }

  orbitalStrike(f: Fighter, pos: THREE.Vector3): void {
    const g = this.game;
    g.announce('orbital', f);
    this.zones.push({ kind: 'strike', owner: f.id, team: f.team, pos: pos.clone(), radius: 7, t: -2, life: 5, collider: null, mesh: null, hp: 1e9, target: pos.clone() });
    g.net.ability(f, 'orbital', pos);
  }

  update(dt: number): void {
    const g = this.game;
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t += dt;
      const owner = g.fighterById(z.owner);
      if (z.kind === 'strike') {
        if (z.t >= 0 && !z.mesh) {
          z.mesh = g.effects.orbitalBeam(z.pos, z.radius, z.life);
          g.sound('helios_beam', null, 1, z.pos);
        }
        if (z.t >= 0 && z.mesh) {
          // beam slowly tracks the nearest enemy inside a wide radius
          let near: Fighter | null = null;
          let nd = 20;
          for (const o of g.fighters) {
            if (!o.alive || !owner || !g.areEnemies(owner, o)) continue;
            const d = Math.hypot(o.body.pos.x - z.pos.x, o.body.pos.z - z.pos.z);
            if (d < nd) {
              nd = d;
              near = o;
            }
          }
          if (near) {
            _v.set(near.body.pos.x - z.pos.x, 0, near.body.pos.z - z.pos.z);
            const l = _v.length();
            if (l > 0.1) z.pos.addScaledVector(_v.normalize(), Math.min(l, 4.5 * dt));
          }
          z.pos.y = g.world.terrainData.hf.heightAt(z.pos.x, z.pos.z);
          z.mesh.position.copy(z.pos);
          if (g.isAuthority && owner) {
            for (const o of g.fighters) {
              if (!o.alive || !g.areEnemies(owner, o)) continue;
              const d = Math.hypot(o.body.pos.x - z.pos.x, o.body.pos.z - z.pos.z);
              if (d < z.radius) g.damage({ target: o, attacker: owner, amount: 90 * dt * (1 - (d / z.radius) * 0.5), source: 'helios', part: 'body', dir: UP.clone(), point: o.body.pos.clone(), suitMul: 1.5, silent: true });
            }
          }
          if (Math.random() < dt * 3) {
            const box = g.world.terrain.scorch(z.pos.x, z.pos.z, z.radius * 0.8, 0.15);
            g.world.terrain.refresh(box);
          }
          g.effects.shake = Math.max(g.effects.shake, 0.15);
        }
      } else if (z.kind === 'station') {
        if (z.mesh) z.mesh.children[1].position.y = 0.7 + Math.sin(z.t * 3) * 0.08;
        if (Math.random() < dt * 4) g.effects.add.spawn({ pos: z.pos.clone().add(new THREE.Vector3(0, 0.7, 0)), vel: new THREE.Vector3(0, 0.8, 0), life: 1, size0: 0.2, size1: 0.05, color0: 0x9dffb0, alpha0: 0.8 });
        if (g.isAuthority) {
          for (const o of g.fighters) {
            if (!o.alive || (owner && g.areEnemies(owner, o))) continue;
            if (o.body.pos.distanceTo(z.pos) > z.radius) continue;
            g.heal(o, owner, 28 * dt, 18 * dt, true);
            o.oxygen = Math.min(100, o.oxygen + 20 * dt);
          }
        }
      } else if (z.kind === 'bubble') {
        for (const o of g.fighters) {
          if (!o.alive || (owner && g.areEnemies(owner, o))) continue;
          if (o.body.pos.distanceTo(z.pos) < z.radius) {
            o.invulnT = Math.max(o.invulnT, 0.25);
            o.oxygen = 100;
          }
        }
      }
      if (z.t >= z.life || z.hp <= 0) {
        if (z.collider) g.world.physics.removeDynamic(z.collider);
        if (z.mesh && z.kind === 'station') g.effects.group.remove(z.mesh);
        if (z.kind === 'dome') g.sound('shield_down', null, 0.8, z.pos);
        this.zones.splice(i, 1);
      }
    }
  }

  /** Remote peers: replicate an ability's visuals / zones. */
  remote(f: Fighter, id: string, pos?: THREE.Vector3): void {
    const g = this.game;
    switch (id) {
      case 'dome':
        this.addZone({ kind: 'dome', owner: f.id, team: f.team, pos: f.body.pos.clone(), radius: 5, t: 0, life: 8, collider: null, mesh: null, hp: 900 });
        g.sound('shield_up', null, 1, f.body.pos);
        break;
      case 'lifebubble':
        this.addZone({ kind: 'bubble', owner: f.id, team: f.team, pos: f.body.pos.clone(), radius: 9, t: 0, life: 5, collider: null, mesh: null, hp: 1e9 });
        break;
      case 'medstation':
        this.addZone({ kind: 'station', owner: f.id, team: f.team, pos: f.body.pos.clone(), radius: 6, t: 0, life: 10, collider: null, mesh: null, hp: 200 });
        break;
      case 'orbital':
        if (pos) this.zones.push({ kind: 'strike', owner: f.id, team: f.team, pos: pos.clone(), radius: 7, t: -2, life: 5, collider: null, mesh: null, hp: 1e9, target: pos.clone() });
        break;
      case 'empnova':
        g.effects.emp(f.body.center(new THREE.Vector3()), 22);
        g.sound('emp', null, 1, f.body.pos);
        break;
      case 'o2burst':
        g.effects.shockwave(f.body.center(new THREE.Vector3()), UP, 10, 0x7dff9a, 0.7, 0.8);
        g.sound('o2_refill', null, 1, f.body.pos);
        break;
      case 'blink':
        g.effects.add.spawn({ pos: f.body.center(new THREE.Vector3()), life: 0.35, size0: 1.6, size1: 0.2, color0: 0xb06cff, alpha0: 0.9, sprite: 4 });
        break;
      case 'cloak':
        f.cloakT = 5;
        break;
      case 'overcharge':
        f.overchargeT = 7;
        break;
      case 'dash':
        this.fxJetBurst(f);
        g.sound('jet_start', null, 1, f.body.pos);
        break;
    }
  }

  clear(): void {
    for (const z of this.zones) {
      if (z.collider) this.game.world.physics.removeDynamic(z.collider);
      if (z.mesh && z.kind === 'station') this.game.effects.group.remove(z.mesh);
    }
    this.zones.length = 0;
  }
}
