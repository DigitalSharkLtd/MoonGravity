/**
 * Client-side matchmaking / lobby API (listen-server model).
 *
 *   quickMatch()  → join the fullest non-full room of the mode, or host a new one
 *   hostRoom()    → register a room and accept WebRTC peers (HostSession)
 *   joinRoom(id)  → connect to a room's host (ClientSession)
 *
 * Talks to /api/lobby/* (Netlify Function in production, Vite middleware in dev; see
 * shared/lobbyCore.ts for the HTTP API). Signaling uses polled mailboxes with
 * non-trickle ICE: one offer message, one answer message per connection.
 *
 * All failures surface as rejected promises with Error(<code>) — codes: 'lobby_unavailable',
 * 'not_found', 'full', 'version_mismatch', 'timeout', 'rtc_failed', 'rtc_unsupported',
 * 'closed', or a server error code.
 */
import { createPeerConnection, gatherLocalSdp, rtcSupported, RtcPeerLink, serialize, type PeerLink } from './Transport';

export { ICE_SERVERS, NET_TIMING, rtcSupported, type PeerLink } from './Transport';

export type NetMode = string; // e.g. 'duel2v2' | 'ffa' | 'war4v4'

/** Protocol version: rooms are only matched with clients of the same version. Bump on any wire-protocol change. */
export const NET_VERSION = 'mg-1';

/** Lobby API root (override at build time with VITE_LOBBY_API). */
export const LOBBY_API: string = ((import.meta.env as Record<string, string | undefined>).VITE_LOBBY_API ?? '/api/lobby').replace(/\/+$/, '');

export const LOBBY_TIMING = {
  heartbeatMs: 5000,
  hostPollIdleMs: 1000,
  hostPollActiveMs: 400,
  /** Poll fast for this long after any signaling activity. */
  hostPollBoostMs: 5000,
  hostPollFullMs: 2500,
  clientPollMs: 500,
  /** Max wait for the host's answer. */
  joinTimeoutMs: 15000,
  /** Answer received → max wait for the data channel to open. */
  connectTimeoutMs: 10000,
  /** Host side: answer sent → max wait for the joiner's channel to open. */
  hostPendingTimeoutMs: 25000,
  requestTimeoutMs: 8000,
};

const MAX_NAME_LEN = 24;
const RE_ROOM_ID = /^[A-Za-z0-9]{8}$/;

export interface RoomInfo {
  roomId: string;
  mode: string;
  name: string;
  players: number;
  capacity: number;
}

interface ServerRoom extends RoomInfo {
  hostPeerId: string;
  version: string;
  region?: string;
  created: number;
  lastSeen: number;
}

export interface HostSession {
  readonly roomId: string;
  /** Full URL with #join=<roomId>. */
  readonly joinLink: string;
  /** Connected peers (a snapshot array; do not keep it across joins/leaves). */
  readonly links: PeerLink[];
  /** Max humans incl. host (2..8). Offers beyond it are rejected with 'full'. */
  capacity: number;
  onPeerJoin: ((link: PeerLink) => void) | null;
  onPeerLeave: ((link: PeerLink) => void) | null;
  /** Humans currently in the room incl. host; triggers a heartbeat. The advertised count is max(n, 1 + connected + connecting). */
  setPlayers(n: number): void;
  broadcast(msg: unknown, reliable?: boolean, except?: PeerLink): void;
  /** Unregister the room and close all links (onPeerLeave is not called for them). */
  close(): Promise<void>;
}

export interface ClientSession {
  readonly roomId: string;
  /** Link to the host; link.name is the host's name. */
  readonly link: PeerLink;
  close(): void;
}

// ───────────────────────────── small utils ─────────────────────────────

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Secret mailbox key (32 url-safe chars, 192 bits). Only needs crypto.getRandomValues (works on plain http too). */
function randomKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += B64URL[b & 63];
  return s;
}

function cleanName(name: unknown, fallback = 'Player'): string {
  if (typeof name !== 'string') return fallback;
  const s = Array.from(name.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, MAX_NAME_LEN).join('').trim();
  return s || fallback;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errCode(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ───────────────────────────── HTTP API ─────────────────────────────

async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = LOBBY_TIMING.requestTimeoutMs): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(`${LOBBY_API}/${path}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: ctrl.signal,
      });
    } catch {
      throw new Error('lobby_unavailable');
    }
    let data: unknown = null;
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }
    // not our API (static hosting, SPA fallback, proxy error page...)
    if (!data || typeof data !== 'object') throw new Error('lobby_unavailable');
    if (!res.ok) {
      const code = (data as { error?: unknown }).error;
      throw new Error(typeof code === 'string' ? code : `http_${res.status}`);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

const q = (params: Record<string, string | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.set(k, v);
  return u.toString();
};

type SignalData =
  | { type: 'offer'; sdp: string; name: string; v: string }
  | { type: 'answer'; sdp: string; name: string }
  | { type: 'reject'; reason: string }
  | { type: 'bye' };

interface Mail {
  from: string;
  data: unknown;
  t: number;
}

const signal = (to: string, key: string, data: SignalData) => api<{ ok: true; from: string }>('POST', 'signal', { to, key, data });
const poll = (key: string) => api<{ peerId: string; messages: Mail[] }>('POST', 'poll', { key });

// ───────────────────────────── join links ─────────────────────────────

/** Full URL of the current page with #join=<roomId>. */
export function buildJoinLink(roomId: string): string {
  const base = typeof location !== 'undefined' ? location.href.replace(/#.*$/, '') : '';
  return `${base}#join=${encodeURIComponent(roomId)}`;
}

/** Room id from '#join=<id>' (defaults to location.hash; a full URL is accepted too), or null. */
export function parseJoinLink(hash?: string): string | null {
  let h = hash ?? (typeof location !== 'undefined' ? location.hash : '');
  const i = h.indexOf('#');
  if (i >= 0) h = h.slice(i + 1);
  for (const part of h.split('&')) {
    const [k, v] = part.split('=');
    if (k === 'join' && v) {
      let id = v;
      try {
        id = decodeURIComponent(v).trim();
      } catch {
        return null;
      }
      return RE_ROOM_ID.test(id) ? id : null;
    }
  }
  return null;
}

// ───────────────────────────── queries ─────────────────────────────

/** Quick check that the lobby API responds (static hosting / offline → false). Never rejects. */
export async function lobbyAvailable(): Promise<boolean> {
  try {
    const r = await api<{ ok?: unknown; service?: unknown }>('GET', 'health', undefined, 4000);
    return r.ok === true && r.service === 'moongravity-lobby';
  } catch {
    return false;
  }
}

/** Rooms of this game version (optionally one mode), fullest first; includes full rooms. */
export async function listRooms(mode?: NetMode): Promise<RoomInfo[]> {
  const r = await api<{ rooms: ServerRoom[] }>('GET', `list?${q({ mode, version: NET_VERSION })}`);
  return (Array.isArray(r.rooms) ? r.rooms : []).map((x) => ({
    roomId: x.roomId,
    mode: x.mode,
    name: x.name,
    players: x.players,
    capacity: x.capacity,
  }));
}

async function findRoom(mode: NetMode | undefined, exclude: string[]): Promise<ServerRoom | null> {
  const r = await api<{ room: ServerRoom | null }>('GET', `find?${q({ mode, version: NET_VERSION, exclude: exclude.join(',') })}`);
  return r.room ?? null;
}

// ───────────────────────────── host ─────────────────────────────

interface HostReg {
  roomId: string;
  hostPeerId: string;
  hostToken: string;
}

class HostSessionImpl implements HostSession {
  readonly roomId: string;
  readonly joinLink: string;
  onPeerJoin: ((link: PeerLink) => void) | null = null;
  onPeerLeave: ((link: PeerLink) => void) | null = null;

  private readonly hostToken: string;
  private readonly mode: string;
  private readonly name: string;
  private _capacity: number;
  private _links: RtcPeerLink[] = [];
  private linksView: PeerLink[] = [];
  private readonly pending = new Map<string, RtcPeerLink>();
  private readonly seenOffers = new Set<string>();
  private reportedPlayers = 1;
  private closed = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private hbTimer: ReturnType<typeof setTimeout> | null = null;
  private hbInFlight = false;
  private hbAgain = false;
  private boostUntil = 0;
  private readonly onPageHide = () => this.beaconClose();

  constructor(reg: HostReg, mode: string, name: string, capacity: number) {
    this.roomId = reg.roomId;
    this.hostToken = reg.hostToken;
    this.mode = mode;
    this.name = name;
    this._capacity = capacity;
    this.joinLink = buildJoinLink(reg.roomId);
    if (typeof addEventListener === 'function') addEventListener('pagehide', this.onPageHide);
    this.schedulePoll(0);
    this.scheduleHeartbeat(LOBBY_TIMING.heartbeatMs);
  }

  get links(): PeerLink[] {
    return this.linksView;
  }

  get capacity(): number {
    return this._capacity;
  }

  set capacity(n: number) {
    const c = Math.max(2, Math.min(8, Math.round(n) || 2));
    if (c === this._capacity) return;
    this._capacity = c;
    this.heartbeatSoon();
  }

  setPlayers(n: number): void {
    const v = Math.max(1, Math.round(n) || 1);
    if (v === this.reportedPlayers) return;
    this.reportedPlayers = v;
    this.heartbeatSoon();
  }

  broadcast(msg: unknown, reliable = true, except?: PeerLink): void {
    if (!this._links.length) return;
    const text = serialize(msg); // serialize once for all peers
    if (text === null) return;
    for (const l of this._links) if (l !== except) l.sendText(text, reliable);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.hbTimer) clearTimeout(this.hbTimer);
    this.pollTimer = this.hbTimer = null;
    if (typeof removeEventListener === 'function') removeEventListener('pagehide', this.onPageHide);
    for (const l of this.pending.values()) l.close();
    this.pending.clear();
    const links = this._links;
    this._links = [];
    this.linksView = [];
    for (const l of links) l.close();
    try {
      await api('POST', 'close', { roomId: this.roomId, hostToken: this.hostToken }, 4000);
    } catch {
      /* room expires by TTL anyway */
    }
  }

  // ── players / heartbeat ──

  private advertisedPlayers(): number {
    return Math.min(this._capacity, Math.max(this.reportedPlayers, 1 + this._links.length + this.pending.size));
  }

  private scheduleHeartbeat(delay: number): void {
    if (this.closed) return;
    if (this.hbTimer) clearTimeout(this.hbTimer);
    this.hbTimer = setTimeout(() => {
      this.hbTimer = null;
      void this.heartbeat();
    }, delay);
  }

  private heartbeatSoon(): void {
    this.scheduleHeartbeat(150);
  }

  private async heartbeat(): Promise<void> {
    if (this.closed) return;
    if (this.hbInFlight) {
      this.hbAgain = true;
      return;
    }
    this.hbInFlight = true;
    try {
      const body = { roomId: this.roomId, hostToken: this.hostToken, players: this.advertisedPlayers(), capacity: this._capacity };
      try {
        await api('POST', 'heartbeat', body);
      } catch (e) {
        if (errCode(e) === 'not_found' && !this.closed) {
          // room expired (e.g. tab was asleep) → re-register under the same id/token
          await api('POST', 'host', {
            mode: this.mode,
            name: this.name,
            capacity: this._capacity,
            players: body.players,
            version: NET_VERSION,
            resume: { roomId: this.roomId, hostToken: this.hostToken },
          });
        } else throw e;
      }
    } catch (e) {
      if (!this.closed) console.warn('[net] heartbeat failed:', errCode(e));
    } finally {
      this.hbInFlight = false;
      if (this.hbAgain) {
        this.hbAgain = false;
        this.heartbeatSoon();
      } else this.scheduleHeartbeat(LOBBY_TIMING.heartbeatMs);
    }
  }

  private beaconClose(): void {
    if (this.closed) return;
    try {
      const blob = new Blob([JSON.stringify({ roomId: this.roomId, hostToken: this.hostToken })], { type: 'text/plain' });
      navigator.sendBeacon?.(`${LOBBY_API}/close`, blob);
    } catch {
      /* ignore */
    }
  }

  // ── signaling ──

  private schedulePoll(delay: number): void {
    if (this.closed) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollOnce();
    }, delay);
  }

  private async pollOnce(): Promise<void> {
    if (this.closed) return;
    try {
      const r = await poll(this.hostToken);
      if (Array.isArray(r.messages) && r.messages.length) {
        this.boostUntil = performance.now() + LOBBY_TIMING.hostPollBoostMs;
        for (const m of r.messages) this.onSignal(m);
      }
    } catch (e) {
      if (!this.closed) console.warn('[net] host poll failed:', errCode(e));
    }
    if (this.closed) return;
    const now = performance.now();
    let delay: number = LOBBY_TIMING.hostPollIdleMs;
    if (this.pending.size || now < this.boostUntil) delay = LOBBY_TIMING.hostPollActiveMs;
    else if (1 + this._links.length >= this._capacity) delay = LOBBY_TIMING.hostPollFullMs;
    this.schedulePoll(delay);
  }

  private onSignal(m: Mail): void {
    const d = m.data as Partial<Record<string, unknown>> | null;
    if (!d || typeof d !== 'object' || typeof m.from !== 'string') return;
    if (d.type === 'offer' && typeof d.sdp === 'string') {
      void this.acceptOffer(m.from, d.sdp, cleanName(d.name), typeof d.v === 'string' ? d.v : '');
    } else if (d.type === 'bye') {
      const p = this.pending.get(m.from);
      if (p) {
        this.pending.delete(m.from);
        p.close();
      }
    }
  }

  private reject(to: string, reason: string): void {
    signal(to, this.hostToken, { type: 'reject', reason }).catch(() => {});
  }

  private async acceptOffer(from: string, sdp: string, name: string, version: string): Promise<void> {
    if (this.closed) return;
    // at-least-once delivery: ignore duplicates of an offer we already handled
    const dedupe = `${from}:${sdp.length}:${sdp.slice(-64)}`;
    if (this.seenOffers.has(dedupe) || this.pending.has(from) || this._links.some((l) => l.peerId === from)) return;
    this.seenOffers.add(dedupe);
    if (this.seenOffers.size > 256) this.seenOffers.clear();

    if (version !== NET_VERSION) return this.reject(from, 'version_mismatch');
    if (1 + this._links.length + this.pending.size >= this._capacity) return this.reject(from, 'full');
    if (!rtcSupported()) return this.reject(from, 'rtc_failed');

    let link: RtcPeerLink | null = null;
    try {
      const parts = createPeerConnection();
      link = new RtcPeerLink(parts, from, name);
      this.pending.set(from, link);
      this.heartbeatSoon();
      await parts.pc.setRemoteDescription({ type: 'offer', sdp });
      await parts.pc.setLocalDescription(await parts.pc.createAnswer());
      const answer = await gatherLocalSdp(parts.pc);
      if (this.closed || link.isClosed) throw new Error('closed');
      await signal(from, this.hostToken, { type: 'answer', sdp: answer, name: this.name });
      await link.whenOpen(LOBBY_TIMING.hostPendingTimeoutMs);
      if (this.closed || this.pending.get(from) !== link) throw new Error('closed');
      this.pending.delete(from);
      this.addLink(link);
    } catch (e) {
      if (link && this.pending.get(from) === link) this.pending.delete(from);
      link?.close();
      if (!this.closed) {
        this.heartbeatSoon();
        if (errCode(e) !== 'closed') console.warn('[net] peer connection failed:', from, errCode(e));
      }
    }
  }

  private addLink(link: RtcPeerLink): void {
    this._links.push(link);
    this.linksView = this._links.slice();
    link.addCloseListener(() => this.onLinkClosed(link));
    if (link.isClosed) return;
    this.heartbeatSoon();
    try {
      this.onPeerJoin?.(link);
    } catch (e) {
      console.error('[net] onPeerJoin threw', e);
    }
  }

  private onLinkClosed(link: RtcPeerLink): void {
    const i = this._links.indexOf(link);
    if (i < 0) return; // session closed / already removed
    this._links.splice(i, 1);
    this.linksView = this._links.slice();
    if (this.closed) return;
    this.heartbeatSoon();
    try {
      this.onPeerLeave?.(link);
    } catch (e) {
      console.error('[net] onPeerLeave threw', e);
    }
  }
}

/** Register a new room and start accepting peers. Rejects with Error('lobby_unavailable') if the API is unreachable. */
export async function hostRoom(opts: { mode: NetMode; name: string; capacity: number }): Promise<HostSession> {
  const capacity = Math.max(2, Math.min(8, Math.round(opts.capacity) || 2));
  const name = cleanName(opts.name, 'Host');
  const reg = await api<HostReg>('POST', 'host', { mode: opts.mode, name, capacity, players: 1, version: NET_VERSION });
  if (!reg || !RE_ROOM_ID.test(reg.roomId) || typeof reg.hostToken !== 'string') throw new Error('lobby_unavailable');
  return new HostSessionImpl(reg, opts.mode, name, capacity);
}

// ───────────────────────────── client ─────────────────────────────

class ClientSessionImpl implements ClientSession {
  constructor(
    readonly roomId: string,
    readonly link: PeerLink,
  ) {}
  close(): void {
    this.link.close();
  }
}

/**
 * Connect to a room's host. Rejects with Error('not_found' | 'full' | 'version_mismatch' |
 * 'timeout' | 'rtc_failed' | 'rtc_unsupported' | 'lobby_unavailable' | ...).
 */
export async function joinRoom(roomId: string, opts: { name: string; timeoutMs?: number }): Promise<ClientSession> {
  if (!RE_ROOM_ID.test(roomId)) throw new Error('not_found');
  if (!rtcSupported()) throw new Error('rtc_unsupported');

  const { room } = await api<{ room: ServerRoom }>('GET', `room?${q({ id: roomId })}`);
  if (!room || typeof room.hostPeerId !== 'string') throw new Error('not_found');
  if (room.version !== NET_VERSION) throw new Error('version_mismatch');
  if (room.players >= room.capacity) throw new Error('full');

  const key = randomKey();
  const name = cleanName(opts.name);
  let link: RtcPeerLink | null = null;
  let offerSent = false;
  try {
    const parts = createPeerConnection();
    link = new RtcPeerLink(parts, room.hostPeerId, room.name);
    await parts.pc.setLocalDescription(await parts.pc.createOffer());
    const sdp = await gatherLocalSdp(parts.pc);
    if (link.isClosed) throw new Error('rtc_failed');

    await signal(room.hostPeerId, key, { type: 'offer', sdp, name, v: NET_VERSION });
    offerSent = true;

    // wait for the host's answer (or rejection)
    const deadline = performance.now() + (opts.timeoutMs ?? LOBBY_TIMING.joinTimeoutMs);
    let answer: { sdp: string; name?: unknown } | null = null;
    while (!answer) {
      if (performance.now() > deadline) throw new Error('timeout');
      await sleep(LOBBY_TIMING.clientPollMs);
      if (link.isClosed) throw new Error('rtc_failed');
      let msgs: Mail[] = [];
      try {
        msgs = (await poll(key)).messages ?? [];
      } catch (e) {
        if (errCode(e) !== 'lobby_unavailable') throw e; // transient network errors: keep trying until the deadline
      }
      for (const m of msgs) {
        if (m.from !== room.hostPeerId) continue;
        const d = m.data as Partial<Record<string, unknown>> | null;
        if (!d || typeof d !== 'object') continue;
        if (d.type === 'reject') {
          offerSent = false;
          throw new Error(typeof d.reason === 'string' && d.reason ? d.reason : 'rejected');
        }
        if (d.type === 'answer' && typeof d.sdp === 'string') answer = { sdp: d.sdp, name: d.name };
      }
    }

    await parts.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    if (typeof answer.name === 'string') link.name = cleanName(answer.name, room.name);
    await link.whenOpen(LOBBY_TIMING.connectTimeoutMs);
    return new ClientSessionImpl(room.roomId, link);
  } catch (e) {
    link?.close();
    if (offerSent) signal(room.hostPeerId, key, { type: 'bye' }).catch(() => {});
    // RTCPeerConnection API failures (bad SDP, invalid state...) surface as DOMException
    if (e instanceof DOMException) throw new Error('rtc_failed');
    throw e instanceof Error ? e : new Error(errCode(e));
  }
}

// ───────────────────────────── quick match ─────────────────────────────

/** A slow network / busy tab must not throw the player into a bot match: retry the lookup. */
async function findRoomRetry(mode: NetMode | undefined, exclude: string[]): Promise<ServerRoom | null> {
  for (let i = 0; ; i++) {
    try {
      return await findRoom(mode, exclude);
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

/** Find the fullest non-full room of this mode and join it; if none (or all joins fail) → host a new room. */
export async function quickMatch(opts: {
  mode: NetMode;
  name: string;
  capacity: number;
  /** join an open room of any mode (the room's host decides the mode); host `mode` if none */
  anyMode?: boolean;
  onStatus?: (s: string) => void;
}): Promise<{ role: 'host'; session: HostSession } | { role: 'client'; session: ClientSession }> {
  const status = (s: string) => {
    try {
      opts.onStatus?.(s);
    } catch {
      /* ignore */
    }
  };
  if (!rtcSupported()) throw new Error('rtc_unsupported');

  const tried: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    status(attempt === 0 ? 'searching' : 'searching_again');
    let room: ServerRoom | null;
    try {
      room = await findRoomRetry(opts.anyMode ? undefined : opts.mode, tried);
    } catch (e) {
      if (errCode(e) !== 'lobby_unavailable') console.warn('[net] quickMatch: find failed:', errCode(e));
      throw new Error('lobby_unavailable');
    }
    if (!room) break;
    tried.push(room.roomId);
    status(`joining:${room.name}`);
    try {
      // patient: a failed join splits players into separate rooms, which is worse than a short wait
      const session = await joinRoom(room.roomId, { name: opts.name, timeoutMs: 25000 });
      status('connected');
      return { role: 'client', session };
    } catch (e) {
      if (errCode(e) === 'lobby_unavailable') throw e;
      console.warn('[net] quickMatch: join failed', room.roomId, errCode(e));
    }
  }

  status('hosting');
  try {
    const session = await hostRoom({ mode: opts.mode, name: opts.name, capacity: opts.capacity });
    status('hosted');
    return { role: 'host', session };
  } catch (e) {
    throw new Error(errCode(e) === 'rtc_unsupported' ? 'rtc_unsupported' : 'lobby_unavailable');
  }
}
