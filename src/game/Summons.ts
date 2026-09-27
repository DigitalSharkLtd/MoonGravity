import * as THREE from 'three';
import type { Game } from './Game';
import type { Fighter } from './Fighter';
import { Collider } from '../core/Physics';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';
import { HeroModel } from '../entities/HeroModel';
import { buildSummonMesh } from './SummonMeshes';

export type SummonKind = 'turret' | 'huntdrone' | 'spotdrone' | 'kamikaze' | 'barricade' | 'decoy';
export const SUMMON_KINDS: SummonKind[] = ['turret', 'huntdrone', 'spotdrone', 'kamikaze', 'barricade', 'decoy'];

export interface Summon {
  id: number;
  kind: SummonKind;
  owner: number;
  team: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  hp: number;
  maxHp: number;
  life: number;
  age: number;
  target: number; // fighter id
  fireT: number;
  mesh: THREE.Object3D;
  head?: THREE.Object3D;
  collider: Collider | null;
  radius: number;
  dead: boolean;
  flags: string[];
  model?: HeroModel;
  /** clients: remote-driven (host authority) */
  ghost: boolean;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Deployables & AI devices: auto-turrets, hunter / spotter / kamikaze drones, barricades and holo-decoys.
 * The authority simulates them; clients mirror state from snapshots.
 */
export class Summons {
  game: Game;
  list: Summon[] = [];
  private nextId = 1;

  constructor(game: Game) {
    this.game = game;
  }

  byOwner(owner: number, kind?: SummonKind): Summon[] {
    return this.list.filter((s) => !s.dead && s.owner === owner && (!kind || s.kind === kind));
  }

  spawn(kind: SummonKind, owner: Fighter, pos: THREE.Vector3, opts: { yaw?: number; flags?: string[]; target?: number; vel?: THREE.Vector3; id?: number; ghost?: boolean } = {}): Summon {
    const g = this.game;
    const flags = opts.flags ?? [];
    const teamCol = owner.team === 1 ? 0xffa033 : owner.team === 0 ? 0x4dd8ff : new THREE.Color(owner.def.color).getHex();
    const built = kind === 'decoy' ? null : buildSummonMesh(kind, teamCol);
    let mesh: THREE.Object3D = built ? built.mesh : new THREE.Group();
    const head: THREE.Object3D | undefined = built?.head;
    let hp = 100;
    let life = 20;
    let radius = 0.5;
    let collider: Collider | null = null;
    let model: HeroModel | undefined;
    switch (kind) {
      case 'turret': {
        hp = 260;
        life = flags.includes('longTurret') ? 45 : 30;
        radius = 0.55;
        collider = g.world.physics.addCylinder(pos.clone().add(new THREE.Vector3(0, 0.55, 0)), 0.45, 0.55, new THREE.Quaternion(), true, { dynamic: true, tag: 'summon' });
        break;
      }
      case 'huntdrone':
      case 'spotdrone':
      case 'kamikaze': {
        hp = kind === 'huntdrone' ? (flags.includes('strongHunter') ? 120 : 85) : kind === 'spotdrone' ? 70 : 40;
        life = kind === 'huntdrone' ? (flags.includes('strongHunter') ? 16 : 12) : kind === 'spotdrone' ? 10 : 8;
        radius = 0.4;
        break;
      }
      case 'barricade': {
        hp = 700;
        life = 25;
        radius = 1.6;
        const q = new THREE.Quaternion().setFromAxisAngle(UP, opts.yaw ?? 0);
        collider = g.world.physics.addBox(pos.clone().add(new THREE.Vector3(0, 0.8, 0)), new THREE.Vector3(1.6, 0.8, 0.18), q, true, { dynamic: true, tag: 'summon' });
        break;
      }
      case 'decoy': {
        model = new HeroModel(owner.hero, g.modeInfo.teams ? (owner.team === 1 ? 0xff6a1f : 0x2f7cf6) : null);
        mesh = model.root;
        hp = 1;
        life = 8;
        radius = 0.6;
        break;
      }
    }
    mesh.position.copy(pos);
    mesh.rotation.y = opts.yaw ?? 0;
    mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !(o.layers.mask & (1 << LAYER_NO_OUTLINE))) (o as THREE.Mesh).castShadow = true;
    });
    g.world.scene.add(mesh);
    const s: Summon = {
      id: opts.id ?? owner.id * 1000 + this.nextId++,
      kind,
      owner: owner.id,
      team: owner.team,
      pos: pos.clone(),
      vel: opts.vel?.clone() ?? new THREE.Vector3(),
      yaw: opts.yaw ?? 0,
      hp,
      maxHp: hp,
      life,
      age: 0,
      target: opts.target ?? -1,
      fireT: 0.6,
      mesh,
      head,
      collider,
      radius,
      dead: false,
      flags,
      model,
      ghost: !!opts.ghost,
    };
    this.list.push(s);
    if (kind === 'turret' || kind === 'barricade') g.effects.dust(pos, 20, 2);
    g.sound(kind === 'barricade' || kind === 'turret' ? 'deploy' : 'jet_start', null, 0.9, pos);
    return s;
  }

  /** ray vs summons (for hitscan / projectiles) */
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number, shooterTeam: number, ffa: boolean, shooterId: number): { s: Summon; t: number; point: THREE.Vector3 } | null {
    let best: { s: Summon; t: number; point: THREE.Vector3 } | null = null;
    let bestT = maxT;
    for (const s of this.list) {
      if (s.dead || s.kind === 'barricade') continue; // barricades are world colliders
      if (!ffa && s.team === shooterTeam) continue;
      if (ffa && s.owner === shooterId) continue;
      const c = this.center(s, _w);
      _v.copy(origin).sub(c);
      const b = _v.dot(dir);
      const cc = _v.lengthSq() - s.radius * s.radius;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t >= bestT) continue;
      bestT = t;
      best = { s, t, point: origin.clone().addScaledVector(dir, t) };
    }
    return best;
  }

  center(s: Summon, out: THREE.Vector3): THREE.Vector3 {
    out.copy(s.pos);
    if (s.kind === 'turret') out.y += 0.7;
    else if (s.kind === 'decoy') out.y += 1.1;
    return out;
  }

  /** can fighter f damage summon s? */
  hostileTo(s: Summon, f: Fighter): boolean {
    const g = this.game;
    if (g.modeInfo.teams) return s.team !== f.team;
    return s.owner !== g.ownerId(f);
  }

  byCollider(c: unknown): Summon | null {
    for (const s of this.list) if (!s.dead && s.collider && s.collider === c) return s;
    return null;
  }

  damage(s: Summon, amount: number, attacker: Fighter | null): void {
    if (s.dead) return;
    const g = this.game;
    if (!g.isAuthority) {
      // clients claim damage on the host's devices
      if (attacker === g.local) {
        g.localSummonHit();
        g.onClientSummonClaim?.(s, amount);
      }
      return;
    }
    s.hp -= amount;
    if (attacker === g.local) g.localSummonHit();
    if (s.hp <= 0) this.destroy(s, true);
  }

  destroy(s: Summon, violent: boolean): void {
    if (s.dead) return;
    s.dead = true;
    const g = this.game;
    if (g.isAuthority && !s.ghost) g.netHook?.('sdestroy', { id: s.id, v: violent ? 1 : 0 });
    const c = this.center(s, new THREE.Vector3());
    if (violent) {
      if (s.kind === 'decoy') g.effects.add.spawn({ pos: c, life: 0.4, size0: 2, size1: 0.1, color0: 0x7fd8ff, alpha0: 0.9, sprite: 4 });
      else g.effects.explosion(c, s.kind === 'barricade' ? 2 : 1.2, 0xffa050, false);
      g.sound('explosion', null, 0.6, c);
    }
    if (s.collider) g.world.physics.removeDynamic(s.collider);
    g.world.scene.remove(s.mesh);
    s.model?.dispose();
  }

  update(dt: number): void {
    const g = this.game;
    for (const s of this.list) {
      if (s.dead) continue;
      s.age += dt;
      if (!s.ghost && s.age >= s.life) {
        if (s.kind === 'kamikaze') this.explodeKamikaze(s);
        else this.destroy(s, s.kind !== 'decoy');
        continue;
      }
      const owner = g.fighterById(s.owner);
      if (!s.ghost && g.isAuthority) {
        switch (s.kind) {
          case 'turret':
            this.tickTurret(s, dt, owner);
            break;
          case 'huntdrone':
            this.tickHunter(s, dt, owner);
            break;
          case 'spotdrone':
            this.tickSpotter(s, dt, owner);
            break;
          case 'kamikaze':
            this.tickKamikaze(s, dt, owner);
            break;
          case 'decoy':
            this.tickDecoy(s, dt);
            break;
        }
      }
      // visuals
      s.mesh.position.lerp(s.pos, s.ghost ? Math.min(1, dt * 12) : 1);
      if (s.kind === 'huntdrone' || s.kind === 'spotdrone' || s.kind === 'kamikaze') {
        s.mesh.rotation.set(Math.sin(s.age * 3) * 0.08 + Math.min(0.4, s.vel.length() * 0.03), s.yaw, Math.cos(s.age * 2.7) * 0.08);
        if (Math.random() < 0.3) g.effects.add.spawn({ pos: s.mesh.position, vel: _v.set(0, -2, 0), life: 0.15, size0: 0.15, size1: 0.02, color0: s.kind === 'kamikaze' ? 0xff6030 : 0x9fd8ff, alpha0: 0.6 });
      } else if (s.kind === 'turret' && s.head) s.head.rotation.y = s.yaw - (s.mesh.rotation.y || 0);
      else if (s.kind === 'decoy' && s.model) {
        s.mesh.rotation.y = s.yaw;
        s.model.setCloak(0);
        s.model.update(dt, { speed: s.vel.length(), grounded: true, crouch: 0, pitch: 0, jetting: false, mag: true, attached: false, alive: true, suit: 1, firing: false, reloading: false, localVel: new THREE.Vector3(0, 0, -s.vel.length()), ability: 0 }, s.age);
      }
    }
    this.list = this.list.filter((s) => !s.dead);
  }

  private enemiesOf(owner: Fighter | null, team: number): Fighter[] {
    const g = this.game;
    return g.fighters.filter((f) => f.alive && (owner ? g.areEnemies(owner, f) : f.team !== team) && (f.cloakT <= 0 || f.revealedT > 0));
  }

  private nearestVisible(s: Summon, owner: Fighter | null, range: number, from: THREE.Vector3): Fighter | null {
    let best: Fighter | null = null;
    let bd = range;
    for (const f of this.enemiesOf(owner, s.team)) {
      f.hitbox(1, _w);
      const d = _w.distanceTo(from);
      if (d > bd) continue;
      if (!this.game.world.physics.visible(from, _w)) continue;
      bd = d;
      best = f;
    }
    return best;
  }

  private shoot(s: Summon, from: THREE.Vector3, t: Fighter, dmg: number, spread: number, color: number, owner: Fighter | null): void {
    const g = this.game;
    t.hitbox(Math.random() < 0.15 ? 0 : 1, _w);
    _d.copy(_w).sub(from).normalize();
    _d.x += (Math.random() - 0.5) * spread;
    _d.y += (Math.random() - 0.5) * spread;
    _d.z += (Math.random() - 0.5) * spread;
    _d.normalize();
    const wh = g.world.physics.raycast(from, _d, 60, { team: s.team });
    const fh = g.combat.rayFighters(from, _d, wh ? wh.t : 60, owner, undefined);
    const end = fh ? fh.point : wh ? wh.point : from.clone().addScaledVector(_d, 60);
    if (fh && owner && g.areEnemies(owner, fh.fighter)) {
      g.damage({ target: fh.fighter, attacker: owner, amount: dmg * (fh.part === 'head' ? 1.5 : 1), source: s.kind === 'turret' ? 'turret' : 'huntdrone', part: fh.part, dir: _d.clone(), point: fh.point, suitMul: 0.6 });
      g.effects.impact(fh.point, _d.clone().negate(), 'flesh', color);
    } else if (wh) g.effects.impact(wh.point, wh.normal, wh.metal ? 'metal' : 'dirt', color);
    g.effects.tracer(from, end, color, 0.05, 260);
    g.effects.muzzle(from, _d, color, 0.5);
    g.sound('drone_fire', null, 0.8, from);
    g.netHook?.('sfx', { a: [from.x, from.y, from.z], b: [end.x, end.y, end.z], c: color });
  }

  private tickTurret(s: Summon, dt: number, owner: Fighter | null): void {
    const muzzle = _v.copy(s.pos).add(new THREE.Vector3(0, 0.85, 0));
    s.fireT -= dt;
    const t = this.nearestVisible(s, owner, 38, muzzle);
    if (t) {
      const desired = Math.atan2(-(t.body.pos.x - s.pos.x), -(t.body.pos.z - s.pos.z));
      let dy = desired - s.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      s.yaw += THREE.MathUtils.clamp(dy, -4 * dt, 4 * dt);
      if (Math.abs(dy) < 0.2 && s.fireT <= 0) {
        s.fireT = 0.14;
        this.shoot(s, muzzle.clone(), t, 11, 0.04, 0xff9f43, owner);
      }
    } else s.yaw += dt * 0.6;
  }

  private tickHunter(s: Summon, dt: number, owner: Fighter | null): void {
    const g = this.game;
    let t = s.target >= 0 ? g.fighterById(s.target) : null;
    if (!t || !t.alive || (owner && !g.areEnemies(owner, t))) {
      t = this.nearestVisible(s, owner, 45, s.pos) ?? this.enemiesOf(owner, s.team).sort((a, b) => a.body.pos.distanceTo(s.pos) - b.body.pos.distanceTo(s.pos))[0] ?? null;
      s.target = t ? t.id : -1;
    }
    // hover ~3.5 m above & 6 m from the target (or near the owner)
    const goal = _w.copy(t ? t.body.pos : owner ? owner.body.pos : s.pos);
    if (t) {
      _d.copy(s.pos).sub(t.body.pos).setY(0);
      if (_d.lengthSq() < 1e-3) _d.set(1, 0, 0);
      _d.normalize().multiplyScalar(6);
      goal.add(_d);
    }
    goal.y = Math.max(goal.y, this.game.world.terrainData.hf.heightAt(goal.x, goal.z)) + 3.5;
    this.fly(s, goal, 9, dt);
    s.fireT -= dt;
    if (t) {
      s.yaw = Math.atan2(-(t.body.pos.x - s.pos.x), -(t.body.pos.z - s.pos.z));
      if (s.fireT <= 0 && t.body.pos.distanceTo(s.pos) < 28 && g.world.physics.visible(s.pos, t.hitbox(1, _v))) {
        s.fireT = 0.16;
        this.shoot(s, s.pos.clone(), t, s.flags.includes('strongHunter') ? 10 : 8, 0.05, 0xe6e14d, owner);
      }
    }
  }

  private tickSpotter(s: Summon, dt: number, owner: Fighter | null): void {
    const g = this.game;
    const goal = s.vel.lengthSq() > 0 && s.age < 1.5 ? _w.copy(s.pos).addScaledVector(s.vel, 0.5) : _w.copy(s.pos);
    if (s.age >= 1.5) s.vel.multiplyScalar(0.9);
    this.fly(s, goal, 12, dt);
    const range = s.flags.includes('slowSpot') ? 22 : 18;
    for (const f of this.enemiesOf(owner, s.team)) {
      if (f.body.pos.distanceTo(s.pos) > range) continue;
      f.revealedT = Math.max(f.revealedT, 0.6);
      if (s.flags.includes('slowSpot')) f.slowT = Math.max(f.slowT, 0.3);
    }
    if (Math.random() < dt * 1.5) g.effects.add.spawn({ pos: s.pos, life: 1.2, size0: 0.4, size1: range * 1.8, color0: 0x4db8ff, alpha0: 0.2, sprite: 3 });
  }

  private tickKamikaze(s: Summon, dt: number, owner: Fighter | null): void {
    const g = this.game;
    let t = s.target >= 0 ? g.fighterById(s.target) : null;
    if (!t || !t.alive) {
      t = this.enemiesOf(owner, s.team).sort((a, b) => a.body.pos.distanceTo(s.pos) - b.body.pos.distanceTo(s.pos))[0] ?? null;
      s.target = t ? t.id : -1;
    }
    if (!t) {
      this.fly(s, _w.copy(s.pos).add(new THREE.Vector3(0, 0.5, 0)), 6, dt);
      return;
    }
    const goal = t.hitbox(1, _w);
    this.fly(s, goal, 22, dt, 30);
    s.yaw = Math.atan2(-s.vel.x, -s.vel.z);
    if (s.pos.distanceTo(goal) < 1.4) this.explodeKamikaze(s);
  }

  private explodeKamikaze(s: Summon): void {
    const g = this.game;
    if (s.dead) return;
    const pos = s.pos.clone();
    this.destroy(s, false);
    g.netHook?.('sboom', { p: [pos.x, pos.y, pos.z] });
    g.combat.explode({ pos, radius: 3.6, damage: 95, owner: s.owner, team: s.team, source: 'kamikaze', kind: 'missile', knock: 7, emp: 0, selfDamage: 0, suitMul: 1.3 });
  }

  private tickDecoy(s: Summon, dt: number): void {
    // walks forward slowly, then idles
    const hf = this.game.world.terrainData.hf;
    if (s.age < 3) {
      s.pos.addScaledVector(s.vel, dt);
    } else s.vel.set(0, 0, 0);
    s.pos.y = hf.heightAt(s.pos.x, s.pos.z);
  }

  /** simple steering flight with obstacle avoidance */
  private fly(s: Summon, goal: THREE.Vector3, speed: number, dt: number, accel = 14): void {
    const g = this.game;
    _d.copy(goal).sub(s.pos);
    const d = _d.length();
    if (d > 0.01) _d.divideScalar(d);
    const desired = _d.multiplyScalar(Math.min(speed, d * 2));
    // avoid terrain & walls ahead
    const ahead = s.vel.lengthSq() > 0.01 ? _v.copy(s.vel).normalize() : null;
    if (ahead) {
      const hit = g.world.physics.raycast(s.pos, ahead, 3 + s.vel.length() * 0.4, { forMove: true });
      if (hit) desired.addScaledVector(hit.normal, 8).add(new THREE.Vector3(0, 3, 0));
    }
    const hy = g.world.terrainData.hf.heightAt(s.pos.x, s.pos.z);
    if (s.pos.y < hy + 1.2) desired.y += 6;
    _w.copy(desired).sub(s.vel);
    const l = _w.length();
    if (l > accel * dt) _w.multiplyScalar((accel * dt) / l);
    s.vel.add(_w);
    s.pos.addScaledVector(s.vel, dt);
  }

  /** damage summons caught in an explosion (authority) */
  explosion(pos: THREE.Vector3, radius: number, damage: number, owner: Fighter | null, team: number): void {
    const g = this.game;
    for (const s of this.list) {
      if (s.dead) continue;
      if (owner && g.modeInfo.teams && s.team === team) continue;
      if (owner && !g.modeInfo.teams && s.owner === owner.id) continue;
      const d = this.center(s, _v).distanceTo(pos);
      if (d > radius + s.radius) continue;
      this.damage(s, damage * (1 - Math.min(1, d / (radius + s.radius)) * 0.6), owner);
    }
  }

  // ------------------------------------------------------------------ replication

  /** host → clients: compact state of every live device */
  pack(): number[][] {
    const r = (v: number) => Math.round(v * 100) / 100;
    return this.list.filter((s) => !s.dead).map((s) => [s.id, SUMMON_KINDS.indexOf(s.kind), s.owner, r(s.pos.x), r(s.pos.y), r(s.pos.z), r(s.yaw), Math.round((s.hp / s.maxHp) * 100)]);
  }

  /** client: mirror the host's devices (spawn ghosts, move them, drop missing ones) */
  unpack(rows: number[][]): void {
    const g = this.game;
    const seen = new Set<number>();
    for (const d of rows) {
      const [id, ki, owner, x, y, z, yaw, hp] = d;
      seen.add(id);
      let s = this.list.find((q) => q.id === id);
      if (!s) {
        const o = g.fighterById(owner);
        const kind = SUMMON_KINDS[ki];
        if (!o || !kind) continue;
        s = this.spawn(kind, o, new THREE.Vector3(x, y, z), { id, ghost: true, yaw });
      }
      s.pos.set(x, y, z);
      s.yaw = yaw;
      s.hp = (hp / 100) * s.maxHp;
    }
    for (const s of this.list) if (s.ghost && !s.dead && !seen.has(s.id) && s.age > 0.5) this.destroy(s, false);
  }

  /** client: host reported a destroyed device */
  remoteDestroy(id: number, violent: boolean): void {
    const s = this.list.find((q) => q.id === id);
    if (s) this.destroy(s, violent);
  }

  /** decoys the bots may target */
  decoysFor(team: number, ffaOwner: number): Summon[] {
    return this.list.filter((s) => !s.dead && s.kind === 'decoy' && (this.game.modeInfo.teams ? s.team !== team : s.owner !== ffaOwner));
  }

  clear(): void {
    for (const s of this.list) this.destroy(s, false);
    this.list.length = 0;
  }
}
