import * as THREE from 'three';
import type { Game } from './Game';
import type { Fighter } from './Fighter';
import { makeWeapon } from './Fighter';
import { ModeInfo, WeaponId, MatchResult, ScoreRow, RibbonId } from './Types';
import type { PickupKind } from '../world/Layouts';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';
import { buildPickupMesh, buildPodMesh } from './PropMeshes';

export interface CPState {
  id: 'A' | 'B' | 'C';
  pos: THREE.Vector3;
  radius: number;
  owner: number; // -1 neutral
  progress: number; // -1..1 (neg = team0 capturing)
  contested: boolean;
  ring: THREE.Mesh;
  beam: THREE.Mesh;
}

interface Pickup {
  kind: PickupKind;
  pos: THREE.Vector3;
  respawn: number;
  t: number; // time until available (0 = available)
  mesh: THREE.Group;
}

/**
 * Pickup kinds (layout spot kinds, placed by the level designer):
 * - o2      → life-support canister: O₂ to 100 %, suit +50 %, +25 HP (15 s)
 * - armor   → armour pack: suit fully restored, +100 HP (25 s)
 * - ammo    → power cell: full magazine + reserve, heat vented, jetpack refuelled, +6 % ultimate (20 s)
 * - grenade → gadget kit: ability charges + grapple refilled, +1 sealant kit (24 s)
 */
export const PICKUP_RESPAWN: Record<PickupKind, number> = { o2: 15, armor: 25, ammo: 20, grenade: 24 };
export interface PickupGain {
  hp: number;
  suit: number;
  o2: number;
  ult: number;
}

export interface Pod {
  pos: THREE.Vector3;
  t: number; // time since spawn
  landed: boolean;
  weapon: WeaponId;
  mesh: THREE.Group;
  beacon: THREE.Mesh;
}

const SUPERS: WeaponId[] = ['nuke', 'singularity', 'helios'];

/**
 * Mode rules: scoring, control points, spawns, pickups, supply pods, timer and end of match.
 * Authority-only logic is guarded by `game.isAuthority`; visuals run everywhere.
 */
export class Match {
  game: Game;
  info: ModeInfo;
  time = 0;
  timeLeft: number;
  teamScores = [0, 0];
  controlPoints: CPState[] = [];
  pickups: Pickup[] = [];
  pod: Pod | null = null;
  podTimer = 50;
  over = false;
  winner = -1;
  startT = 0;
  private cpScoreAcc = 0;

  constructor(game: Game, info: ModeInfo) {
    this.game = game;
    this.info = info;
    this.timeLeft = info.timeLimit;
    const layout = game.world.layout;
    const useCps = info.id === 'war4v4' ? layout.controlPoints : [];
    for (const cp of useCps) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(cp.radius - 0.35, cp.radius, 64),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(cp.pos).add(new THREE.Vector3(0, 0.25, 0));
      ring.layers.set(LAYER_NO_OUTLINE);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 60, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
      );
      beam.position.copy(cp.pos).add(new THREE.Vector3(0, 30, 0));
      beam.layers.set(LAYER_NO_OUTLINE);
      game.world.scene.add(ring, beam);
      this.controlPoints.push({ id: cp.id, pos: cp.pos.clone(), radius: cp.radius, owner: -1, progress: 0, contested: false, ring, beam });
    }
    for (const p of layout.pickups) {
      const mesh = this.pickupMesh(p.kind);
      mesh.position.copy(p.pos);
      game.world.scene.add(mesh);
      this.pickups.push({ kind: p.kind, pos: p.pos.clone(), respawn: PICKUP_RESPAWN[p.kind] ?? 18, t: 0, mesh });
    }
  }

  /** pad + floating item (children 'ring' and 'item' are animated in updatePickups) */
  private pickupMesh(kind: PickupKind): THREE.Group {
    return buildPickupMesh(kind);
  }

  // ------------------------------------------------------------------ spawns

  /** Spawn point with the largest distance to living enemies. */
  pickSpawn(f: Fighter): { pos: THREE.Vector3; yaw: number } {
    const g = this.game;
    const all = g.world.layout.spawns.filter((s) => (this.info.teams ? s.team === f.team : s.team === -1));
    const list = all.length ? all : g.world.layout.spawns;
    let best = list[0];
    let bestScore = -Infinity;
    for (const s of list) {
      let minD = 999;
      for (const o of g.players) {
        if (!o.alive || o === f || !g.areEnemies(f, o)) continue;
        minD = Math.min(minD, o.body.pos.distanceTo(s.pos));
      }
      // don't stack on friends either
      let friendsClose = 0;
      for (const o of g.players) if (o.alive && o !== f && !g.areEnemies(f, o) && o.body.pos.distanceTo(s.pos) < 2) friendsClose++;
      const score = Math.min(minD, 60) + Math.random() * (this.info.teams ? 20 : 8) - friendsClose * 30;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return { pos: best.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.2, (Math.random() - 0.5) * 1.5)), yaw: best.yaw };
  }

  respawnDelay(): number {
    return this.info.id === 'ffa' ? 3 : this.info.id === 'duel2v2' ? 5 : 7;
  }

  // ------------------------------------------------------------------ scoring

  onKill(killer: Fighter | null, victim: Fighter): void {
    if (this.over) return;
    if (!killer || killer === victim) {
      if (this.info.id === 'ffa') victim.stats.score = Math.max(0, victim.stats.score - 1);
      return;
    }
    if (this.info.id === 'ffa') {
      // score = kills
    } else if (this.info.id === 'duel2v2') this.teamScores[killer.team]++;
    else this.teamScores[killer.team] += 5;
    this.checkEnd();
  }

  ffaScores(): { mine: number; leader: number; rank: number } {
    const g = this.game;
    const sorted = [...g.players].sort((a, b) => b.stats.kills - a.stats.kills);
    const me = g.local;
    return { mine: me?.stats.kills ?? 0, leader: sorted[0]?.stats.kills ?? 0, rank: me ? sorted.indexOf(me) + 1 : 0 };
  }

  private checkEnd(): void {
    const lim = this.info.scoreLimit;
    if (this.info.id === 'ffa') {
      const top = [...this.game.players].sort((a, b) => b.stats.kills - a.stats.kills)[0];
      if (top && top.stats.kills >= lim) this.end(-1);
      return;
    }
    if (this.teamScores[0] >= lim) this.end(0);
    else if (this.teamScores[1] >= lim) this.end(1);
  }

  end(winner: number): void {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.game.onMatchEnd();
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    const g = this.game;
    this.time += dt;
    if (!this.over && g.isAuthority) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) {
        if (this.info.id === 'ffa') this.end(-1);
        else this.end(this.teamScores[0] === this.teamScores[1] ? -1 : this.teamScores[0] > this.teamScores[1] ? 0 : 1);
      }
    }
    this.updateControlPoints(dt);
    this.updatePickups(dt);
    this.updatePod(dt);
  }

  private updateControlPoints(dt: number): void {
    const g = this.game;
    let owned = [0, 0];
    for (const cp of this.controlPoints) {
      const count = [0, 0];
      for (const f of g.players) {
        if (!f.alive || f.team < 0) continue;
        const dx = f.body.pos.x - cp.pos.x;
        const dz = f.body.pos.z - cp.pos.z;
        if (dx * dx + dz * dz < cp.radius * cp.radius && Math.abs(f.body.pos.y - cp.pos.y) < 8) count[f.team]++;
      }
      cp.contested = count[0] > 0 && count[1] > 0;
      if (g.isAuthority && !this.over && !cp.contested && (count[0] || count[1])) {
        const team = count[0] ? 0 : 1;
        const n = Math.min(3, count[team]);
        const dir = team === 0 ? -1 : 1;
        const rate = (0.1 + 0.05 * n) * dt;
        const before = cp.owner;
        if (cp.owner === team) cp.progress = dir; // hold
        else {
          cp.progress += dir * rate;
          // neutralise first, then capture
          if ((dir < 0 && cp.progress <= -1) || (dir > 0 && cp.progress >= 1)) {
            cp.progress = dir;
            cp.owner = team;
          } else if (cp.owner >= 0 && Math.sign(cp.progress) === dir && Math.abs(cp.progress) < 0.02) {
            cp.owner = -1;
          }
        }
        if (cp.owner !== before && cp.owner >= 0) {
          g.onCapture(cp.id, cp.owner);
          for (const f of g.players) {
            const dx = f.body.pos.x - cp.pos.x;
            const dz = f.body.pos.z - cp.pos.z;
            if (f.alive && f.team === team && dx * dx + dz * dz < cp.radius * cp.radius) {
              f.stats.captures++;
              f.stats.score += 100;
              g.xp(f, 100, 'xpCapture');
            }
          }
        }
      } else if (g.isAuthority && !cp.contested && !count[0] && !count[1] && cp.owner < 0) {
        cp.progress *= Math.max(0, 1 - dt * 0.2);
      }
      if (cp.owner >= 0) owned[cp.owner]++;
      // visuals
      const col = cp.owner === 0 ? 0x4dd8ff : cp.owner === 1 ? 0xffa033 : 0xffffff;
      const ringMat = cp.ring.material as THREE.MeshBasicMaterial;
      ringMat.color.setHex(col).multiplyScalar(cp.contested ? 1.5 + Math.sin(this.time * 10) : 2);
      (cp.beam.material as THREE.MeshBasicMaterial).color.setHex(col).multiplyScalar(1.5);
    }
    if (g.isAuthority && !this.over && this.controlPoints.length) {
      this.cpScoreAcc += dt;
      while (this.cpScoreAcc >= 1) {
        this.cpScoreAcc -= 1;
        this.teamScores[0] += owned[0] * 2;
        this.teamScores[1] += owned[1] * 2;
      }
      this.checkEnd();
    }
  }

  private updatePickups(dt: number): void {
    const g = this.game;
    for (let pi = 0; pi < this.pickups.length; pi++) {
      const p = this.pickups[pi];
      const item = p.mesh.getObjectByName('item')!;
      const ring = p.mesh.getObjectByName('ring');
      if (p.t > 0) {
        p.t -= dt;
        item.visible = false;
        // the pad ring closes in as the item comes back, and blinks for the last 3 s
        if (ring) {
          ring.scale.setScalar(0.3 + 0.7 * (1 - Math.max(0, p.t) / p.respawn));
          ring.visible = p.t > 3 || Math.sin(this.time * 12) > -0.2;
        }
        continue;
      }
      item.visible = true;
      if (ring) {
        ring.visible = true;
        ring.scale.setScalar(1 + Math.sin(this.time * 3 + p.pos.z) * 0.04);
      }
      item.rotation.y += dt * 1.5;
      item.position.y = 0.8 + Math.sin(this.time * 2 + p.pos.x) * 0.08;
      if (!g.isAuthority) continue;
      for (const f of g.players) {
        if (!f.alive) continue;
        // pick-up volume: a short cylinder over the pad (lunar hops over it still count)
        const dx = f.body.pos.x - p.pos.x;
        const dz = f.body.pos.z - p.pos.z;
        const dy = f.body.pos.y - p.pos.y;
        if (dx * dx + dz * dz > 1.35 * 1.35 || dy < -0.9 || dy > 2.2) continue;
        if (this.applyPickup(f, p.kind)) {
          p.t = p.respawn;
          g.onPickup(f, p.kind, p.pos, pi);
          break;
        }
      }
    }
  }

  /** what the last applyPickup gave (for the HUD feedback) */
  lastGain: PickupGain = { hp: 0, suit: 0, o2: 0, ult: 0 };

  applyPickup(f: Fighter, kind: PickupKind): boolean {
    const hp0 = f.health;
    const su0 = f.suit;
    const o20 = f.oxygen;
    const ul0 = f.ultCharge;
    let ok = false;
    switch (kind) {
      case 'o2':
        if (f.oxygen > 95 && f.suit >= f.maxSuit * 0.99 && f.health >= f.maxHealth) return false;
        f.oxygen = 100;
        f.suit = Math.max(f.suit, Math.min(f.maxSuit, f.suit + f.maxSuit * 0.5));
        f.health = Math.min(f.maxHealth, f.health + 25);
        ok = true;
        break;
      case 'armor':
        if (f.suit >= f.maxSuit && f.health >= f.maxHealth) return false;
        f.suit = f.maxSuit;
        f.health = Math.min(f.maxHealth, f.health + 100);
        ok = true;
        break;
      case 'ammo': {
        const w = f.weapon;
        const mag = f.magSize;
        const needsAmmo = w.def.heatPerShot > 0 ? w.heat > 0.15 || w.ventT > 0 : w.reserve < w.def.reserve || (w.ammo < mag && w.def.mag < 900);
        if (!needsAmmo && f.body.jetFuel > 0.95 && f.ultReady) return false;
        if (w.def.heatPerShot > 0) {
          w.heat = 0;
          w.ventT = 0;
        } else if (w.def.mag < 900) {
          w.reserve = w.def.reserve;
          w.ammo = Math.max(w.ammo, mag);
          w.reloadT = 0;
        }
        f.body.jetFuel = 1;
        f.ultCharge = Math.min(f.ultCostEff, f.ultCharge + f.ultCostEff * 0.06);
        ok = true;
        break;
      }
      case 'grenade':
        if (f.sealants >= f.def.sealants + 1 && f.abilities.every((a) => a.charges >= a.maxCharges) && f.grappleCd <= 0) return false;
        f.sealants = Math.min(f.def.sealants + 1, f.sealants + 1);
        for (const a of f.abilities) {
          a.charges = a.maxCharges;
          a.cooldown = 0;
        }
        f.grappleCd = 0;
        ok = true;
        break;
    }
    this.lastGain = { hp: Math.round(f.health - hp0), suit: Math.round(f.maxSuit > 0 ? ((f.suit - su0) / f.maxSuit) * 100 : 0), o2: Math.round(f.oxygen - o20), ult: Math.round(f.ultCostEff > 0 ? ((f.ultCharge - ul0) / f.ultCostEff) * 100 : 0) };
    return ok;
  }

  nearestPickup(pos: THREE.Vector3, kinds: PickupKind[]): THREE.Vector3 | null {
    let best: Pickup | null = null;
    let bd = Infinity;
    for (const p of this.pickups) {
      if (p.t > 0 || !kinds.includes(p.kind)) continue;
      const d = p.pos.distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best ? best.pos : null;
  }

  // ------------------------------------------------------------------ supply pods

  private updatePod(dt: number): void {
    const g = this.game;
    if (this.over) return;
    if (!this.pod) {
      if (!g.isAuthority) return;
      this.podTimer -= dt;
      if (this.podTimer <= 0) {
        this.podTimer = 75 + Math.random() * 20;
        const zones = g.world.layout.podZones;
        const z = zones[Math.floor(Math.random() * zones.length)];
        const pos = z.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6));
        pos.y = g.world.terrainData.hf.heightAt(pos.x, pos.z);
        this.spawnPod(pos, SUPERS[Math.floor(Math.random() * SUPERS.length)]);
      }
      return;
    }
    const p = this.pod;
    p.t += dt;
    const fall = 6; // seconds of descent
    const gy = g.world.terrainData.hf.heightAt(p.pos.x, p.pos.z);
    if (!p.landed) {
      const k = Math.min(1, p.t / fall);
      const h = (1 - k) * (1 - k) * 260;
      p.mesh.position.set(p.pos.x, gy + h, p.pos.z);
      // retro-rocket flame
      g.effects.add.spawn({ pos: p.mesh.position.clone().add(new THREE.Vector3(0, -0.8, 0)), vel: new THREE.Vector3((Math.random() - 0.5) * 2, -12, (Math.random() - 0.5) * 2), life: 0.3, size0: 0.8, size1: 0.2, color0: 0xffc070, color1: 0xff4010, sprite: 0 });
      if (k >= 1) {
        p.landed = true;
        g.effects.explosion(p.mesh.position.clone(), 3, 0xffc070, true);
        g.effects.dust(p.mesh.position.clone(), 60, 4);
        g.sound('pod_land', null, 1, p.mesh.position);
      }
    } else {
      p.beacon.visible = Math.sin(p.t * 6) > 0;
      if (g.isAuthority) {
        for (const f of g.players) {
          if (!f.alive || f.body.pos.distanceTo(p.mesh.position) > 2.2) continue;
          f.superWeapon = makeWeapon(p.weapon);
          g.onPodTaken(f, p.weapon);
          this.removePod();
          return;
        }
        if (p.t > fall + 60) this.removePod();
      }
    }
  }

  spawnPod(pos: THREE.Vector3, weapon: WeaponId): void {
    const g = this.game;
    const { mesh, beacon } = buildPodMesh();
    g.world.scene.add(mesh);
    this.pod = { pos: pos.clone(), t: 0, landed: false, weapon, mesh, beacon };
    g.onPodIncoming(pos, g.isAuthority ? weapon : undefined);
  }

  removePod(): void {
    if (!this.pod) return;
    this.game.world.scene.remove(this.pod.mesh);
    this.pod = null;
  }

  // ------------------------------------------------------------------ results

  result(localId: number): MatchResult {
    const g = this.game;
    const rows: ScoreRow[] = g.players.map((f) => ({
      id: f.id,
      name: f.name,
      team: this.info.teams ? f.team : -1,
      hero: f.hero,
      kills: f.stats.kills,
      deaths: f.stats.deaths,
      assists: f.stats.assists,
      score: f.stats.score,
      damage: Math.round(f.stats.damage),
      healing: Math.round(f.stats.healing),
      ping: f.ping,
      isBot: f.isBot,
      isLocal: f.id === localId,
      alive: f.alive,
    }));
    const me = g.fighterById(localId)!;
    let won: boolean | null;
    let placement: number;
    if (this.info.teams) {
      won = this.winner < 0 ? null : this.winner === me.team;
      placement = won === null ? 1 : won ? 1 : 2;
    } else {
      const sorted = [...g.players].sort((a, b) => b.stats.kills - a.stats.kills);
      placement = sorted.indexOf(me) + 1;
      won = placement === 1;
    }
    const mvp = [...g.players].sort((a, b) => b.stats.score - a.stats.score)[0];
    const xp: { label: string; amount: number }[] = [];
    const s = me.stats;
    if (s.kills) xp.push({ label: 'xpKills', amount: s.kills * 100 });
    if (s.assists) xp.push({ label: 'xpAssists', amount: s.assists * 50 });
    if (s.captures) xp.push({ label: 'xpCaptures', amount: s.captures * 150 });
    if (s.healing > 0) xp.push({ label: 'xpHealing', amount: Math.round(s.healing * 0.5) });
    xp.push({ label: 'xpMatch', amount: 500 });
    if (won) xp.push({ label: 'xpWin', amount: 1000 });
    const ribbons: RibbonId[] = [];
    if (mvp === me) ribbons.push('ace');
    if (s.multikills > 0) ribbons.push('multikill');
    if (s.bestStreak >= 5) ribbons.push('killstreak5');
    if (s.bestStreak >= 10) ribbons.push('killstreak10');
    if (s.headshots >= 5) ribbons.push('headhunter');
    if (s.nukes > 0 && s.weapons.nuke && s.weapons.nuke.kills > 0) ribbons.push('nuclear');
    if (s.wallKills > 0) ribbons.push('ceiling');
    if (s.suffocations > 0) ribbons.push('breach');
    if (s.captures >= 3) ribbons.push('capture');
    if (s.healing >= 1000) ribbons.push('medic');
    if (won && s.deaths === 0) ribbons.push('survivor');
    if (s.ultKills >= 3) ribbons.push('ult');
    for (const r of ribbons) xp.push({ label: 'ribbon_' + r, amount: 250 });
    return {
      mode: this.info.id,
      map: this.info.map,
      duration: Math.round(this.time),
      teamScores: this.info.teams ? [...this.teamScores] : [...g.players].map((f) => f.stats.kills).sort((a, b) => b - a),
      winnerTeam: this.info.teams ? this.winner : -1,
      localTeam: me.team,
      won,
      placement,
      rows,
      xp,
      ribbons,
      levelBefore: 1,
      xpBefore: 0,
      xpAfter: 0,
      mvpId: mvp?.id ?? -1,
    };
  }

  dispose(): void {
    for (const cp of this.controlPoints) this.game.world.scene.remove(cp.ring, cp.beam);
    for (const p of this.pickups) this.game.world.scene.remove(p.mesh);
    this.removePod();
  }
}
