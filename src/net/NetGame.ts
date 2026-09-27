import * as THREE from 'three';
import type { Game, DamageSpec } from '../game/Game';
import type { Fighter } from '../game/Fighter';
import { makeWeapon } from '../game/Fighter';
import type { NetBridge } from '../game/NetBridge';
import type { Projectile, ProjKind, DamageSource } from '../game/Combat';
import { MODES, ModeId, HeroId, WeaponId } from '../game/Types';
import { WEAPONS } from '../weapons/WeaponDefs';
import { quickMatch, joinRoom, hostRoom, type HostSession, type ClientSession, type PeerLink } from './Lobby';

/**
 * Game protocol over the WebRTC transport (listen server).
 *
 * Host = authority: bots, damage, vitals, respawns, scores, control points, pickups, pods.
 * Clients simulate their own fighter (movement, aiming, projectiles they fire) and send
 * damage/heal claims; they receive 20 Hz snapshots and reliable events.
 */

const WIDS: WeaponId[] = ['pulse', 'rail', 'plasma', 'glauncher', 'sealer', 'twinarc', 'nuke', 'singularity', 'helios', 'blade', 'riveter', 'burst'];
/** abilities whose gameplay part (devices, summons, team buffs) runs on the host */
const HOST_ABILITIES = new Set(['decoy', 'servitor', 'turret', 'barricade', 'forcefield', 'huntdrone', 'spotdrone', 'kamikaze']);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

type Msg = { t: string; [k: string]: unknown };

const F_ALIVE = 1,
  F_CROUCH = 2,
  F_JET = 4,
  F_MAG = 8,
  F_ATTACH = 16,
  F_GROUND = 32,
  F_CLOAK = 64,
  F_FIRE = 128,
  F_RELOAD = 256,
  F_BREACH = 512,
  F_INVULN = 1024,
  F_SLOT1 = 2048,
  F_PRONE = 4096,
  F_SLIDE = 8192,
  F_ROLL = 16384,
  F_DEFLECT = 32768,
  F_SHIELD = 65536;

interface PeerInfo {
  link: PeerLink;
  fighterId: number;
  name: string;
}

export class NetGame {
  role: 'host' | 'client';
  mode: ModeId;
  joinLink?: string;
  game: Game | null = null;
  private host: HostSession | null = null;
  private client: ClientSession | null = null;
  private peers = new Map<string, PeerInfo>();
  private snapT = 0;
  private sbT = 0;
  private sendT = 0;
  private clock = 0;
  private welcome: Msg | null = null;
  private pending: Msg[] = [];
  private hero: HeroId;
  private build = '';
  private name: string;
  private devT = 0;
  bridge: NetBridge;
  private closed = false;
  /** debug counters (messages received per type) */
  rx: Record<string, number> = {};

  private constructor(role: 'host' | 'client', mode: ModeId, name: string, hero: HeroId, build = '') {
    this.role = role;
    this.build = build;
    this.mode = mode;
    this.name = name;
    this.hero = hero;
    const self = this;
    this.bridge = {
      role,
      fireFx(f, weapon, from, to) {
        self.emit({ t: 'fx', f: f.id, w: WIDS.indexOf(weapon), a: v3(from), b: v3(to) }, false, f);
      },
      projectile(p: Projectile, from: THREE.Vector3) {
        self.emit({ t: 'pj', id: p.id, k: p.kind, f: p.owner, p: v3(p.pos), v: v3(p.vel), s: p.source, vf: v3(from), tg: p.target }, true, self.game?.fighterById(p.owner) ?? null);
      },
      boom(p: Projectile, what: string) {
        self.emit({ t: 'bm', id: p.id, p: v3(p.pos), w: what }, true, self.game?.fighterById(p.owner) ?? null);
      },
      ability(f: Fighter, id: string, pos?: THREE.Vector3) {
        self.emit({ t: 'ab', f: f.id, id, p: pos ? v3(pos) : undefined }, true, f);
      },
    };
  }

  /** Quick match / join / create. Clients resolve once the host's welcome arrives. */
  static async connect(opts: { mode: ModeId; name: string; hero: HeroId; build?: string; join?: string; onStatus?: (s: string) => void }): Promise<NetGame> {
    const cap = MODES[opts.mode].capacity;
    if (opts.join === 'create') {
      const session = await hostRoom({ mode: opts.mode, name: opts.name, capacity: cap });
      const ng = new NetGame('host', opts.mode, opts.name, opts.hero, opts.build);
      ng.bindHost(session);
      return ng;
    }
    if (opts.join) {
      opts.onStatus?.('joining');
      const session = await joinRoom(opts.join, { name: opts.name });
      const ng = new NetGame('client', opts.mode, opts.name, opts.hero, opts.build);
      await ng.bindClient(session);
      return ng;
    }
    const res = await quickMatch({ mode: opts.mode, name: opts.name, capacity: cap, onStatus: opts.onStatus });
    if (res.role === 'host') {
      const ng = new NetGame('host', opts.mode, opts.name, opts.hero, opts.build);
      ng.bindHost(res.session);
      return ng;
    }
    const ng = new NetGame('client', opts.mode, opts.name, opts.hero, opts.build);
    await ng.bindClient(res.session);
    return ng;
  }

  // ------------------------------------------------------------------ host

  private bindHost(session: HostSession): void {
    this.host = session;
    this.joinLink = session.joinLink;
    session.onPeerJoin = (link) => {
      link.onMessage = (m) => this.onHostMessage(link, m as Msg);
      link.onClose = () => this.onPeerLeft(link);
    };
    session.onPeerLeave = (link) => this.onPeerLeft(link);
  }

  private onPeerLeft(link: PeerLink): void {
    const p = this.peers.get(link.peerId);
    if (!p) return;
    this.peers.delete(link.peerId);
    const g = this.game;
    if (g) {
      const f = g.fighterById(p.fighterId);
      if (f) {
        g.event({ type: 'toast', text: `${f.name} ×`, kind: 'info' });
        g.removeFighter(f);
        this.broadcast({ t: 'leave', id: f.id });
        g.fillBots();
        for (const nf of g.fighters) if (nf.isBot && !this.known.has(nf.id)) this.announceFighter(nf);
      }
    }
    this.host?.setPlayers(1 + this.peers.size);
  }

  private known = new Set<number>();

  private announceFighter(f: Fighter): void {
    this.known.add(f.id);
    this.broadcast({ t: 'join', ...this.fighterInfo(f) });
  }

  private fighterInfo(f: Fighter): Record<string, unknown> {
    return { id: f.id, name: f.name, team: f.team, hero: f.hero, b: f.buildId, bot: f.isBot, owner: f.owner, alive: f.alive, p: v3(f.body.pos), yaw: 0, so: f.summonOf };
  }

  private onHostMessage(link: PeerLink, m: Msg): void {
    this.rx[m.t] = (this.rx[m.t] ?? 0) + 1;
    const g = this.game;
    if (!g) {
      // host not ready yet: queue
      if (m.t === 'hello') this.pending.push({ ...m, _peer: link.peerId, _link: link } as Msg);
      return;
    }
    if (m.t === 'hello') {
      this.acceptPeer(link, String(m.name ?? link.name), (m.hero as HeroId) ?? 'condor', String(m.b ?? ''));
      return;
    }
    const p = this.peers.get(link.peerId);
    if (!p) return;
    const f = g.fighterById(p.fighterId);
    if (!f) return;
    switch (m.t) {
      case 'p':
        this.applyPose(f, m.d as number[]);
        break;
      case 'fx':
      case 'pj':
      case 'bm':
      case 'ab':
        this.applyEvent(m);
        // relay to the other clients
        this.host?.broadcast(m, m.t !== 'fx', link);
        if (m.t === 'ab') this.hostAbilityAuthority(f, String(m.id));
        break;
      case 'dmg': {
        const t = g.fighterById(m.tg as number);
        if (!t || !t.alive || !f.alive) break;
        const amt = Math.min(500, Number(m.amt) || 0);
        g.damage({ target: t, attacker: f, amount: amt, source: m.src as DamageSource, part: (m.part as 'head' | 'body' | 'legs') ?? 'body', dir: m.d ? vec(m.d as number[]) : null, point: m.pt ? vec(m.pt as number[]) : null, suitMul: Number(m.sm) || 0.7, silent: !!m.sil });
        break;
      }
      case 'heal': {
        const t = g.fighterById(m.tg as number);
        if (t) g.heal(t, f, Math.min(200, Number(m.hp) || 0), Math.min(200, Number(m.su) || 0));
        break;
      }
      case 'hero':
        if (!f.alive) {
          g.setHero(f, m.hero as HeroId);
          f.applyBuild(String(m.b ?? ''));
          this.broadcast({ t: 'hero', id: f.id, hero: f.hero, b: f.buildId });
        }
        break;
      case 'sdmg': {
        const sm = g.summons.list.find((q) => q.id === m.id);
        if (sm && f.alive) g.summons.damage(sm, Math.min(300, Number(m.amt) || 0), f);
        break;
      }
      case 'seal':
        if (f.sealants > 0) {
          f.sealants--;
          f.sealT = 1.2;
        }
        break;
    }
  }

  private acceptPeer(link: PeerLink, name: string, hero: HeroId, build = ''): void {
    const g = this.game!;
    let team = -1;
    if (g.modeInfo.teams) {
      const c0 = g.fighters.filter((f) => f.team === 0 && !f.isBot).length;
      const c1 = g.fighters.filter((f) => f.team === 1 && !f.isBot).length;
      team = c0 <= c1 ? 0 : 1;
    }
    if (g.fighters.length >= g.modeInfo.slots) {
      const bot = [...g.fighters].reverse().find((b) => b.isBot && (team < 0 || b.team === team)) ?? [...g.fighters].reverse().find((b) => b.isBot);
      if (bot) {
        g.removeFighter(bot);
        this.broadcast({ t: 'leave', id: bot.id });
        if (team >= 0) team = bot.team;
      }
    }
    const f = g.addFighter(name.slice(0, 24), team, hero, 'remote', link.peerId);
    f.applyBuild(build);
    f.respawnT = 0.5;
    this.peers.set(link.peerId, { link, fighterId: f.id, name });
    // everybody learns about the newcomer, the newcomer gets the full state
    this.broadcast({ t: 'join', ...this.fighterInfo(f) }, link);
    this.known.add(f.id);
    link.send({
      t: 'welcome',
      you: f.id,
      mode: g.modeInfo.id,
      fighters: g.fighters.map((o) => this.fighterInfo(o)),
      devices: g.summons.pack(),
      scores: g.match.teamScores,
      timeLeft: g.match.timeLeft,
      pod: g.match.pod ? { p: v3(g.match.pod.pos), w: g.match.pod.weapon, t: g.match.pod.t } : null,
    });
    this.host?.setPlayers(1 + this.peers.size);
    g.event({ type: 'toast', text: `+ ${f.name}`, kind: 'info' });
    // make the newcomer spawn now
    g.respawn(f);
  }

  /** Gameplay effects of client abilities that must run on the authority. */
  private hostAbilityAuthority(f: Fighter, id: string): void {
    const g = this.game!;
    const pos = f.body.center(new THREE.Vector3());
    if (HOST_ABILITIES.has(id)) {
      g.abilities.authority(f, id);
      return;
    }
    if (id === 'o2burst') {
      const full = f.flags.has('fullSeal');
      for (const o of g.fighters) {
        if (!o.alive || g.areEnemies(f, o) || o.body.pos.distanceTo(pos) > 10) continue;
        g.heal(o, f, 55, full ? o.maxSuit : 40);
        o.oxygen = Math.min(100, o.oxygen + (full ? 100 : 50));
      }
    } else if (id === 'empnova') {
      const R = f.flags.has('wideEmp') ? 28 : 22;
      for (const sm of g.summons.list) if (!sm.dead && sm.pos.distanceTo(pos) < R && g.summons.hostileTo(sm, f)) g.summons.damage(sm, 200, f);
      for (const o of g.fighters) {
        if (!o.alive || !g.areEnemies(f, o) || o.body.pos.distanceTo(pos) > R) continue;
        g.applyEmp(o, 5);
        g.damage({ target: o, attacker: f, amount: 60, source: 'empnova', part: 'body', dir: null, point: null, suitMul: 1.2 });
        this.sendTo(o, { t: 'emp', s: 5 });
      }
    } else if (id === 'tacnuke') {
      f.superWeapon = makeWeapon('nuke');
    }
  }

  // ------------------------------------------------------------------ client

  private async bindClient(session: ClientSession): Promise<void> {
    this.client = session;
    const link = session.link;
    link.send({ t: 'hello', name: this.name, hero: this.hero, b: this.build });
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout')), 30000);
      link.onMessage = (m) => {
        const msg = m as Msg;
        if (msg.t === 'welcome') {
          clearTimeout(to);
          this.welcome = msg;
          this.mode = msg.mode as ModeId;
          resolve();
        } else this.pending.push(msg);
      };
      link.onClose = () => {
        clearTimeout(to);
        reject(new Error('host_left'));
      };
    });
    link.onMessage = (m) => this.onClientMessage(m as Msg);
    link.onClose = () => {
      if (this.closed) return;
      this.game?.event({ type: 'big', title: 'HOST', sub: 'connection lost', kind: 'bad' });
      if (this.game) this.game.match.end(-1);
    };
  }

  private onClientMessage(m: Msg): void {
    this.rx[m.t] = (this.rx[m.t] ?? 0) + 1;
    if (!this.game) {
      this.pending.push(m);
      return;
    }
    const g = this.game;
    switch (m.t) {
      case 's':
        this.applySnapshot(m);
        break;
      case 'fx':
      case 'pj':
      case 'bm':
      case 'ab':
        this.applyEvent(m);
        break;
      case 'join': {
        if (g.fighterById(m.id as number)) break;
        if (typeof m.so === 'number' && m.so >= 0) {
          g.addServitorGhost(m.id as number, m.so, vec(m.p as number[]), 0, false);
          break;
        }
        const f = g.addFighter(String(m.name), m.team as number, m.hero as HeroId, 'remote', String(m.owner), m.id as number);
        f.applyBuild(String(m.b ?? ''));
        f.isBot = !!m.bot;
        f.alive = !!m.alive;
        f.body.pos.copy(vec(m.p as number[]));
        break;
      }
      case 'sv':
        g.addServitorGhost(m.id as number, m.owner as number, vec(m.p as number[]), Number(m.yaw) || 0, !!m.tough);
        break;
      case 'sd':
        g.summons.remoteDestroy(m.id as number, !!m.v);
        break;
      case 'sbm':
        g.combat.explosionFx(vec(m.p as number[]), 3.6, 'missile');
        break;
      case 'sfx': {
        const a = vec(m.a as number[]);
        const b = vec(m.b as number[]);
        g.effects.tracer(a, b, m.c as number, 0.05, 260);
        g.effects.muzzle(a, b.clone().sub(a).normalize(), m.c as number, 0.5);
        g.sound('drone_fire', null, 0.8, a);
        break;
      }
      case 'leave': {
        const f = g.fighterById(m.id as number);
        if (f && f !== g.local) g.removeFighter(f);
        break;
      }
      case 'spawn': {
        const f = g.fighterById(m.id as number);
        if (!f) break;
        if (m.hero && f.hero !== m.hero) g.setHero(f, m.hero as HeroId);
        const pos = vec(m.p as number[]);
        if (f === g.local) {
          f.spawn(pos, m.yaw as number);
          if (f.model) {
            f.model.setWeapon(f.weapon.id);
            f.model.root.visible = true;
          }
          g.sound('respawn', f, 1);
        } else {
          f.alive = true;
          f.snaps.length = 0;
          f.body.pos.copy(pos);
          f.renderPos.copy(pos);
          f.model?.resetPose();
          if (f.model) f.model.root.visible = true;
        }
        break;
      }
      case 'kill': {
        const v = g.fighterById(m.v as number);
        const k = m.k !== undefined && m.k !== null ? g.fighterById(m.k as number) : null;
        if (!v) break;
        if (v.summonOf >= 0) {
          v.alive = false;
          const c = v.body.center(new THREE.Vector3());
          g.effects.explosion(c, 1.4, 0xffa050, false);
          g.sound('explosion', null, 0.6, c);
          break;
        }
        v.alive = false;
        v.respawnT = g.match.respawnDelay();
        if (v === g.local) {
          v.lastAttacker = k ? k.id : -1;
          v.lastAttackerT = 0;
        }
        g.announceKill(v, k, m.src as DamageSource, !!m.h, !!m.w);
        break;
      }
      case 'hero': {
        const f = g.fighterById(m.id as number);
        if (f && f !== g.local) {
          g.setHero(f, m.hero as HeroId);
          f.applyBuild(String(m.b ?? ''));
        }
        break;
      }
      case 'pod':
        g.match.spawnPod(vec(m.p as number[]), m.w as WeaponId);
        break;
      case 'podt': {
        const f = g.fighterById(m.f as number);
        g.match.removePod();
        if (f) {
          if (f === g.local) f.superWeapon = makeWeapon(m.w as WeaponId);
          g.onPodTaken(f, m.w as WeaponId);
        }
        break;
      }
      case 'pick': {
        const pk = g.match.pickups[m.i as number];
        if (pk) pk.t = pk.respawn;
        const f = g.fighterById(m.f as number);
        if (f && f === g.local && pk) g.match.applyPickup(f, pk.kind);
        break;
      }
      case 'cap':
        g.onCapture(m.id as 'A' | 'B' | 'C', m.team as number);
        break;
      case 'emp':
        if (g.local) {
          g.local.empT = Math.max(g.local.empT, Number(m.s));
          g.local.body.emp(Number(m.s));
        }
        break;
      case 'sb':
        for (const row of m.r as number[][]) {
          const f = g.fighterById(row[0]);
          if (!f) continue;
          f.stats.kills = row[1];
          f.stats.deaths = row[2];
          f.stats.assists = row[3];
          f.stats.score = row[4];
          f.stats.damage = row[5];
          f.stats.healing = row[6];
          f.ping = row[7];
        }
        break;
      case 'end':
        g.match.teamScores = m.scores as number[];
        g.match.end(m.winner as number);
        break;
    }
  }

  // ------------------------------------------------------------------ shared

  attach(g: Game): void {
    this.game = g;
    if (this.role === 'host') {
      g.net = this.bridge;
      g.onKillEvent = (v, k, src, head, wall) => this.broadcast({ t: 'kill', v: v.id, k: k ? k.id : null, src, h: head, w: wall });
      g.onRespawn = (f) => this.broadcast({ t: 'spawn', id: f.id, p: v3(f.body.pos), yaw: yawOf(f), hero: f.hero });
      g.netHook = (ev, data) => {
        const d = data as Record<string, unknown>;
        if (ev === 'pod') this.broadcast({ t: 'pod', ...d });
        else if (ev === 'podt') this.broadcast({ t: 'podt', ...d });
        else if (ev === 'pick') this.broadcast({ t: 'pick', ...d });
        else if (ev === 'cap') this.broadcast({ t: 'cap', ...d });
        else if (ev === 'end') this.broadcast({ t: 'end', ...d });
        else if (ev === 'servitor') {
          this.known.add(d.id as number);
          this.broadcast({ t: 'sv', ...d });
        } else if (ev === 'servitorGone') this.broadcast({ t: 'leave', ...d });
        else if (ev === 'sdestroy') this.broadcast({ t: 'sd', ...d });
        else if (ev === 'sboom') this.broadcast({ t: 'sbm', ...d });
        else if (ev === 'sfx' && this.peers.size) this.host?.broadcast({ t: 'sfx', ...d }, false);
      };
      for (const f of g.fighters) this.known.add(f.id);
      // peers that said hello while we were loading
      const queued = this.pending.splice(0);
      for (const m of queued) {
        const link = (m as unknown as { _link: PeerLink })._link;
        if (link) this.acceptPeer(link, String(m.name ?? link.name), (m.hero as HeroId) ?? 'condor', String(m.b ?? ''));
      }
      this.host?.setPlayers(1 + this.peers.size);
    } else {
      g.net = this.bridge;
      const w = this.welcome!;
      const me = g.local!;
      // replace the auto-created local fighter with the id the host assigned
      g.removeFighter(me);
      const infos = w.fighters as Record<string, unknown>[];
      for (const info of infos) {
        if (typeof info.so === 'number' && info.so >= 0) continue; // servitors after their owners
        const isMe = info.id === w.you;
        const f = g.addFighter(String(info.name), info.team as number, isMe ? this.hero : (info.hero as HeroId), isMe ? 'local' : 'remote', String(info.owner), info.id as number);
        f.applyBuild(isMe ? g.builds[this.hero] ?? '' : String(info.b ?? ''));
        f.isBot = !!info.bot;
        f.alive = !isMe && !!info.alive;
        f.respawnT = 999;
        f.body.pos.copy(vec(info.p as number[]));
        f.renderPos.copy(f.body.pos);
        if (isMe) {
          g.local = f;
          f.model?.setFirstPerson(!g.thirdPerson);
        }
      }
      for (const info of infos) if (typeof info.so === 'number' && info.so >= 0) g.addServitorGhost(info.id as number, info.so, vec(info.p as number[]), 0, false);
      if (w.devices) g.summons.unpack(w.devices as number[][]);
      g.refreshHighlights();
      g.match.teamScores = w.scores as number[];
      g.match.timeLeft = w.timeLeft as number;
      if (w.pod) {
        const pd = w.pod as { p: number[]; w: WeaponId };
        g.match.spawnPod(vec(pd.p), pd.w);
      }
      g.onClientClaim = (d: DamageSpec) => this.sendClaim(d);
      g.onClientHeal = (t, hp, su) => this.client?.link.send({ t: 'heal', tg: t.id, hp, su });
      g.onClientSeal = () => this.client?.link.send({ t: 'seal' });
      g.onClientSummonClaim = (sm, amt) => this.client?.link.send({ t: 'sdmg', id: sm.id, amt: r2(amt) });
      const queued = this.pending.splice(0);
      for (const m of queued) this.onClientMessage(m);
    }
  }

  private sendClaim(d: DamageSpec): void {
    this.client?.link.send({ t: 'dmg', tg: d.target.id, amt: r2(d.amount), src: d.source, part: d.part, d: d.dir ? v3(d.dir) : undefined, pt: d.point ? v3(d.point) : undefined, sm: d.suitMul, sil: d.silent ? 1 : 0 }, !d.silent);
  }

  heroChanged(hero: HeroId, build = ''): void {
    this.hero = hero;
    this.build = build;
    if (this.role === 'client') this.client?.link.send({ t: 'hero', hero, b: build });
    else if (this.game?.local) this.broadcast({ t: 'hero', id: this.game.local.id, hero, b: build });
  }

  private emit(m: Msg, reliable: boolean, f: Fighter | null): void {
    const g = this.game;
    if (!g) return;
    // only the owner of the fighter publishes its events
    if (this.role === 'host') {
      if (f && f.control === 'remote') return; // relayed separately
      this.host?.broadcast(m, reliable);
    } else if (f === g.local) this.client?.link.send(m, reliable);
  }

  private broadcast(m: Msg, except?: PeerLink): void {
    this.host?.broadcast(m, true, except);
  }

  private sendTo(f: Fighter, m: Msg): void {
    for (const p of this.peers.values()) if (p.fighterId === f.id) p.link.send(m, true);
  }

  private applyEvent(m: Msg): void {
    const g = this.game!;
    const f = g.fighterById(m.f as number);
    if (!f || f === g.local) return;
    if (m.t === 'fx') {
      const w = WIDS[m.w as number];
      const a = vec(m.a as number[]);
      const b = vec(m.b as number[]);
      const def = WEAPONS[w];
      if (w === 'rail') {
        g.effects.beam(a, b, def.color, 0.12, 0.5);
        g.effects.beam(a, b, 0xffffff, 0.035, 0.25);
      } else g.effects.tracer(a, b, def.color, 0.07);
      g.effects.muzzle(a, b.clone().sub(a).normalize(), def.color, 1);
      g.sound(def.sfx, f, 1);
      f.firingVisual = 0.15;
      f.model?.fired();
    } else if (m.t === 'pj') {
      const p = g.combat.spawn(m.k as ProjKind, f, vec(m.p as number[]), vec(m.v as number[]), m.s as DamageSource, vec(m.vf as number[]), true, m.id as number);
      p.target = (m.tg as number) ?? -1;
      if (m.k !== 'missile') g.sound(WEAPONS[m.s as WeaponId]?.sfx ?? 'grenade_throw', f, 1);
    } else if (m.t === 'bm') {
      g.combat.remoteBoom(m.id as number, vec(m.p as number[]), String(m.w));
    } else if (m.t === 'ab') {
      g.abilities.remote(f, String(m.id), m.p ? vec(m.p as number[]) : undefined);
    }
  }

  private applyPose(f: Fighter, d: number[]): void {
    // [x,y,z,qx,qy,qz,qw,pitch,vx,vy,vz,flags,weapon]
    const snap = { t: this.clock, pos: new THREE.Vector3(d[0], d[1], d[2]), quat: new THREE.Quaternion(d[3], d[4], d[5], d[6]), pitch: d[7], vel: new THREE.Vector3(d[8], d[9], d[10]), flags: d[11] };
    f.snaps.push(snap);
    if (f.snaps.length > 30) f.snaps.shift();
    const flags = d[11];
    f.body.crouching = !!(flags & F_CROUCH);
    f.body.jetting = !!(flags & F_JET);
    f.body.magOn = !!(flags & F_MAG);
    f.body.attached = !!(flags & F_ATTACH);
    f.body.grounded = !!(flags & F_GROUND);
    f.cloakT = flags & F_CLOAK ? Math.max(f.cloakT, 0.3) : f.cloakT;
    if (flags & F_FIRE) f.firingVisual = 0.15;
    f.body.stance = flags & F_ROLL ? 'roll' : flags & F_SLIDE ? 'slide' : flags & F_PRONE ? 'prone' : f.body.crouching ? 'crouch' : 'stand';
    f.deflectT = flags & F_DEFLECT ? Math.max(f.deflectT, 0.15) : 0;
    if (!(flags & F_SHIELD)) f.shieldHp = 0;
    else if (f.shieldHp <= 0) f.shieldHp = 100;
    const wid = WIDS[d[12]];
    if (wid && f.activeWeapon.id !== wid) {
      if (wid === f.weapon.id) f.slot = 0;
      else {
        f.superWeapon = makeWeapon(wid);
        f.slot = 1;
      }
    }
  }

  private applySnapshot(m: Msg): void {
    const g = this.game!;
    for (const d of m.f as number[][]) {
      const f = g.fighterById(d[0]);
      if (!f) continue;
      const flags = d[12];
      if (f !== g.local) {
        this.applyPose(f, [d[1], d[2], d[3], d[4], d[5], d[6], d[7], d[8], d[9], d[10], d[11], flags, d[18]]);
        const alive = !!(flags & F_ALIVE);
        if (alive !== f.alive) {
          f.alive = alive;
          if (alive) f.model?.resetPose();
        }
      }
      // vitals are host-authoritative for everyone (including us)
      f.health = d[13];
      f.suit = d[14];
      f.oxygen = d[15];
      f.breached = !!(flags & F_BREACH);
      f.suffocating = f.oxygen <= 0 && f.alive;
      f.invulnT = flags & F_INVULN ? 0.2 : 0;
      f.shieldHp = d[19] ?? 0;
      if (f === g.local) {
        f.ultCharge = Math.max(f.ultCharge, d[16]);
        if (!(flags & F_ALIVE) && f.alive) {
          f.alive = false;
          f.respawnT = g.match.respawnDelay();
        }
        f.sealants = d[17];
      }
    }
    if (m.d) g.summons.unpack(m.d as number[][]);
    const mm = m.m as number[];
    g.match.teamScores[0] = mm[0];
    g.match.teamScores[1] = mm[1];
    g.match.timeLeft = mm[2];
    for (let i = 0; i < g.match.controlPoints.length; i++) {
      const cp = g.match.controlPoints[i];
      cp.owner = mm[3 + i * 3];
      cp.progress = mm[4 + i * 3];
      cp.contested = !!mm[5 + i * 3];
    }
  }

  update(dt: number): void {
    const g = this.game;
    if (!g || this.closed) return;
    this.clock += dt;
    if (this.role === 'host') {
      this.snapT += dt;
      if (this.snapT >= 0.05 && this.peers.size) {
        this.snapT = 0;
        const fs = g.fighters.map((f) => {
          const b = f.body;
          const flags = flagsOf(f);
          const q = f.control === 'remote' ? f.renderQuat : b.quat;
          const p = f.control === 'remote' ? f.renderPos : b.pos;
          return [f.id, r2(p.x), r2(p.y), r2(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r3(b.pitch), r2(b.vel.x), r2(b.vel.y), r2(b.vel.z), flags, Math.round(f.health), Math.round(f.suit), Math.round(f.oxygen), Math.round(f.ultCharge), f.sealants, WIDS.indexOf(f.activeWeapon.id), Math.round(f.shieldHp)];
        });
        const mm: number[] = [g.match.teamScores[0], g.match.teamScores[1], Math.round(g.match.timeLeft)];
        for (const cp of g.match.controlPoints) mm.push(cp.owner, r2(cp.progress), cp.contested ? 1 : 0);
        this.devT ^= 1;
        this.host?.broadcast(this.devT ? { t: 's', f: fs, m: mm, d: g.summons.pack() } : { t: 's', f: fs, m: mm }, false);
      }
      this.sbT += dt;
      if (this.sbT >= 1 && this.peers.size) {
        this.sbT = 0;
        for (const p of this.peers.values()) {
          const f = g.fighterById(p.fighterId);
          if (f) f.ping = Math.round(p.link.rtt);
        }
        this.broadcast({ t: 'sb', r: g.fighters.map((f) => [f.id, f.stats.kills, f.stats.deaths, f.stats.assists, f.stats.score, Math.round(f.stats.damage), Math.round(f.stats.healing), f.ping]) });
      }
    } else {
      this.sendT += dt;
      const me = g.local;
      if (me && this.sendT >= 1 / 30) {
        this.sendT = 0;
        const b = me.body;
        this.client?.link.send({ t: 'p', d: [r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), r3(b.quat.x), r3(b.quat.y), r3(b.quat.z), r3(b.quat.w), r3(b.pitch), r2(b.vel.x), r2(b.vel.y), r2(b.vel.z), flagsOf(me), WIDS.indexOf(me.activeWeapon.id)] }, false);
        me.ping = Math.round(this.client?.link.rtt ?? 0);
      }
    }
    // interpolate remote fighters ~100 ms in the past
    const renderT = this.clock - 0.1;
    for (const f of g.fighters) {
      if (f.control !== 'remote' || f.snaps.length === 0) continue;
      const s = f.snaps;
      let a = s[0];
      let b = s[s.length - 1];
      for (let i = 0; i < s.length - 1; i++) {
        if (s[i].t <= renderT && s[i + 1].t >= renderT) {
          a = s[i];
          b = s[i + 1];
          break;
        }
      }
      const k = b.t > a.t ? THREE.MathUtils.clamp((renderT - a.t) / (b.t - a.t), 0, 1) : 1;
      f.renderPos.copy(a.pos).lerp(b.pos, k);
      f.renderQuat.copy(a.quat).slerp(b.quat, k);
      f.renderPitch = a.pitch + (b.pitch - a.pitch) * k;
      f.body.pos.copy(f.renderPos);
      f.body.quat.copy(f.renderQuat);
      f.body.up.set(0, 1, 0).applyQuaternion(f.renderQuat);
      f.body.pitch = f.renderPitch;
      f.body.vel.copy(b.vel);
      f.body.moveSpeed = f.body.grounded ? Math.hypot(b.vel.x, b.vel.z) : 0;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.host?.close();
    this.client?.close();
  }
}

function v3(v: THREE.Vector3): number[] {
  return [r2(v.x), r2(v.y), r2(v.z)];
}
function vec(a: number[]): THREE.Vector3 {
  return new THREE.Vector3(a[0], a[1], a[2]);
}
function yawOf(f: Fighter): number {
  const fwd = f.body.forward(new THREE.Vector3());
  return Math.atan2(-fwd.x, -fwd.z);
}
function flagsOf(f: Fighter): number {
  const b = f.body;
  return (
    (f.alive ? F_ALIVE : 0) |
    (b.crouching ? F_CROUCH : 0) |
    (b.jetting ? F_JET : 0) |
    (b.magOn ? F_MAG : 0) |
    (b.attached ? F_ATTACH : 0) |
    (b.grounded ? F_GROUND : 0) |
    (f.cloakT > 0 ? F_CLOAK : 0) |
    (f.firingVisual > 0 ? F_FIRE : 0) |
    (f.activeWeapon.reloadT > 0 ? F_RELOAD : 0) |
    (f.breached ? F_BREACH : 0) |
    (f.invulnT > 0 ? F_INVULN : 0) |
    (f.slot === 1 ? F_SLOT1 : 0) |
    (b.stance === 'prone' ? F_PRONE : 0) |
    (b.stance === 'slide' ? F_SLIDE : 0) |
    (b.stance === 'roll' ? F_ROLL : 0) |
    (f.deflectT > 0 ? F_DEFLECT : 0) |
    (f.shieldHp > 0 ? F_SHIELD : 0)
  );
}
