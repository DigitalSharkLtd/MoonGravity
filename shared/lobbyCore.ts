/**
 * MOON GRAVITY — lobby / matchmaking / WebRTC-signaling core.
 *
 * Pure logic: no Node or Netlify imports, only web-standard globals
 * (crypto.getRandomValues, crypto.subtle, TextEncoder, URL, Request/Response).
 * Storage is injected through the small `LobbyStorage` interface, so the same
 * code runs in:
 *   - netlify/functions/lobby.mts  — Netlify Functions v2 + Netlify Blobs
 *   - vite.config.ts               — dev / preview middleware with MemoryLobbyStorage
 *
 * ─── Storage layout (one key per record → no read-modify-write races between writers) ───
 *   rooms/<roomId>                         RoomRecord (written only by the room's host)
 *   mail/<peerId>/<15-digit ms>-<rand>     MailRecord (one key per signaling message)
 *
 * ─── Identity / auth ───
 *   Every mailbox owner holds a secret `key` (URL-safe, 16–64 chars). Its public
 *   address is `peerId = base64url(sha256("mg-peer:" + key))[0..16)`, derived on the
 *   server. Therefore:
 *     - only the key holder can read (poll) a mailbox,
 *     - the `from` of a message is derived from the sender's key and cannot be spoofed.
 *   A host's key is its `hostToken` (returned by /host); room.hostPeerId = peerId(hostToken),
 *   which is also how /heartbeat and /close authenticate the host.
 *   Clients generate their key locally (random), no registration needed.
 *
 * ─── HTTP API (mounted at /api/lobby/). JSON in/out, every response `Cache-Control: no-store`.
 *   Errors: non-2xx status with body {error: <code>, message?}. Codes: bad_request (400),
 *   bad_json (400), forbidden (403), not_found (404), unknown_endpoint (404),
 *   method_not_allowed (405), room_taken (409), too_large (413), internal (500).
 *
 *   GET  health                                   → {ok:true, service:'moongravity-lobby', api, time}
 *   POST host  {mode, name, capacity, players, version, region?, resume?:{roomId, hostToken}}
 *                                                 → {roomId, hostPeerId, hostToken, ttlMs, heartbeatMs}
 *        `resume` re-registers an expired room under the same id/token (host tab was asleep).
 *   POST heartbeat {roomId, hostToken, players, capacity?, name?}
 *                                                 → {ok:true, ttlMs}   | 404 not_found (expired → resume)
 *   POST close {roomId, hostToken}                → {ok:true}          (idempotent)
 *   GET  find?mode=&version=&exclude=id1,id2      → {room: PublicRoom | null}
 *        Only fresh rooms of that mode AND version with players < capacity; the fullest room
 *        wins (ties → oldest), so rooms fill up one by one.
 *   GET  room?id=                                 → {room: PublicRoom} | 404 not_found
 *   GET  list?mode=&version=                      → {rooms: PublicRoom[]}  (incl. full rooms, max 100)
 *   POST signal {to, key, data}                   → {ok:true, from}    data: any JSON ≤ 16 KB
 *   POST poll {key}                               → {peerId, messages:[{from, data, t}]}
 *        Returns (≤ 32, oldest first) and deletes pending messages. Delivery is at-least-once.
 *
 *   PublicRoom = {roomId, hostPeerId, mode, name, players, capacity, version, region?, created, lastSeen}
 *
 * ─── Lifetimes ───
 *   A room disappears from find/list/room when its host has not heartbeated for ROOM_TTL_MS
 *   (hosts heartbeat every HEARTBEAT_MS) or on /close. Expired rooms are deleted lazily during
 *   find/list/room. Messages older than MAIL_TTL_MS are never delivered and are garbage-collected
 *   opportunistically (at most once per MAIL_GC_INTERVAL_MS per server instance).
 */

// ───────────────────────────── constants ─────────────────────────────

export const LOBBY_API_VERSION = 1;
export const ROOM_TTL_MS = 20_000;
export const HEARTBEAT_MS = 5_000;
export const MAIL_TTL_MS = 60_000;
export const MAIL_GC_INTERVAL_MS = 30_000;
export const MIN_CAPACITY = 2;
export const MAX_CAPACITY = 8;
export const MAX_NAME_LEN = 24;
export const MAX_DATA_BYTES = 16 * 1024;
export const MAX_BODY_BYTES = 24 * 1024;
export const MAX_POLL_BATCH = 32;
export const MAX_LIST_ROOMS = 100;
const IO_CONCURRENCY = 16;

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const B64URL = ALNUM + '-_';

const RE_ROOM_ID = /^[A-Za-z0-9]{8}$/;
const RE_PEER_ID = /^[A-Za-z0-9_-]{16}$/;
const RE_KEY = /^[A-Za-z0-9_-]{16,64}$/;
const RE_MODE = /^[A-Za-z0-9_-]{1,24}$/;
const RE_VERSION = /^[A-Za-z0-9._-]{1,16}$/;
const RE_REGION = /^[A-Za-z0-9_-]{1,16}$/;

// ───────────────────────────── storage ─────────────────────────────

/** Minimal key/value storage the lobby needs. Values are JSON-serializable. */
export interface LobbyStorage {
  /** Parsed JSON value, or null when the key does not exist. */
  get(key: string): Promise<unknown>;
  /** Write a value. With onlyIfNew, write only if the key does not exist. Returns whether it was written. */
  set(key: string, value: unknown, opts?: { onlyIfNew?: boolean }): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** All keys that start with `prefix`. */
  list(prefix: string): Promise<string[]>;
}

/** In-memory storage (dev server / tests). Values are stored as JSON strings to mimic a real store. */
export class MemoryLobbyStorage implements LobbyStorage {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<unknown> {
    const s = this.map.get(key);
    return s === undefined ? null : JSON.parse(s);
  }
  async set(key: string, value: unknown, opts?: { onlyIfNew?: boolean }): Promise<boolean> {
    if (opts?.onlyIfNew && this.map.has(key)) return false;
    this.map.set(key, JSON.stringify(value));
    return true;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.map.keys()) if (k.startsWith(prefix)) out.push(k);
    return out;
  }
  get size(): number {
    return this.map.size;
  }
}

// ───────────────────────────── records ─────────────────────────────

export interface RoomRecord {
  roomId: string;
  hostPeerId: string;
  mode: string;
  name: string;
  players: number;
  capacity: number;
  version: string;
  region?: string;
  created: number;
  lastSeen: number;
}

export type PublicRoom = RoomRecord;

interface MailRecord {
  from: string;
  data: unknown;
  t: number;
}

function isRoomRecord(v: unknown): v is RoomRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.roomId === 'string' &&
    typeof r.hostPeerId === 'string' &&
    typeof r.mode === 'string' &&
    typeof r.name === 'string' &&
    typeof r.players === 'number' &&
    typeof r.capacity === 'number' &&
    typeof r.version === 'string' &&
    typeof r.created === 'number' &&
    typeof r.lastSeen === 'number'
  );
}

function isMailRecord(v: unknown): v is MailRecord {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.from === 'string' && typeof m.t === 'number' && 'data' in m;
}

function publicRoom(r: RoomRecord): PublicRoom {
  const out: PublicRoom = {
    roomId: r.roomId,
    hostPeerId: r.hostPeerId,
    mode: r.mode,
    name: r.name,
    players: r.players,
    capacity: r.capacity,
    version: r.version,
    created: r.created,
    lastSeen: r.lastSeen,
  };
  if (r.region) out.region = r.region;
  return out;
}

const roomKey = (roomId: string) => `rooms/${roomId}`;
const mailPrefix = (peerId: string) => `mail/${peerId}/`;

/** Timestamp encoded in a mail key (`mail/<peer>/<15 digits>-<rand>`), or NaN. */
function mailKeyTime(key: string): number {
  const last = key.slice(key.lastIndexOf('/') + 1);
  return Number.parseInt(last.slice(0, 15), 10);
}

// ───────────────────────────── helpers ─────────────────────────────

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

const bad = (message: string) => new HttpError(400, 'bad_request', message);

/** Crypto-random string over `alphabet` (length ≤ 64 → no modulo bias via rejection sampling). */
export function randomString(len: number, alphabet: string = ALNUM): string {
  const n = alphabet.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < len) {
    const bytes = new Uint8Array((len - out.length) * 2);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length && out.length < len; i++) {
      const b = bytes[i]!;
      if (b < limit) out += alphabet[b % n];
    }
  }
  return out;
}

export const randomRoomId = () => randomString(8, ALNUM);
export const randomKey = () => randomString(32, B64URL);

function b64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64URL[(v >> 18) & 63]! + B64URL[(v >> 12) & 63]! + B64URL[(v >> 6) & 63]! + B64URL[v & 63]!;
  }
  return out; // callers only pass multiples of 3 bytes
}

/** Public mailbox address of a secret key. */
export async function derivePeerId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mg-peer:${key}`));
  return b64url(new Uint8Array(digest).subarray(0, 12)); // 96 bits → 16 chars
}

function sanitizeName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  // strip control chars, collapse whitespace, limit to MAX_NAME_LEN code points
  const clean = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean).slice(0, MAX_NAME_LEN).join('').trim();
  return chars || fallback;
}

function reqString(body: Record<string, unknown>, field: string, re: RegExp): string {
  const v = body[field];
  if (typeof v !== 'string' || !re.test(v)) throw bad(`invalid '${field}'`);
  return v;
}

function reqInt(body: Record<string, unknown>, field: string, min: number, max: number, optional = false): number | undefined {
  const v = body[field];
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`invalid '${field}'`);
  return Math.min(max, Math.max(min, Math.round(v)));
}

function queryString(q: URLSearchParams, field: string, re: RegExp, optional = false): string | undefined {
  const v = q.get(field);
  if ((v === null || v === '') && optional) return undefined;
  if (v === null || !re.test(v)) throw bad(`invalid '${field}'`);
  return v;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

// ───────────────────────────── handler ─────────────────────────────

export interface LobbyRequest {
  method: string;
  /** Endpoint path relative to the API root, e.g. 'host' or 'find'. */
  path: string;
  query: URLSearchParams;
  /** Raw request body (already size-limited by the adapter), or null. */
  body: string | null;
}

export interface LobbyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface LobbyOptions {
  /** Clock (ms). Defaults to Date.now. */
  now?: () => number;
  /** Keep background work (garbage collection) alive after the response, e.g. Netlify's context.waitUntil. */
  waitUntil?: (p: Promise<unknown>) => void;
  /** Shared mutable GC state; pass a module-level object so it survives across per-request lobby instances. */
  gcState?: { lastMailGc: number };
  log?: (...args: unknown[]) => void;
}

export const LOBBY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(status: number, body: unknown): LobbyResponse {
  return { status, headers: { ...LOBBY_HEADERS }, body: JSON.stringify(body) };
}

export interface Lobby {
  /** Transport-agnostic entry point. */
  handle(req: LobbyRequest): Promise<LobbyResponse>;
  /** Fetch-API adapter (Netlify Functions v2, Deno, workers...). `basePath` is stripped from the URL path. */
  handleFetch(req: Request, basePath?: string): Promise<Response>;
}

export function createLobby(storage: LobbyStorage, opts: LobbyOptions = {}): Lobby {
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? ((...a: unknown[]) => console.error('[lobby]', ...a));
  const gcState = opts.gcState ?? { lastMailGc: 0 };

  const background = (p: Promise<unknown>) => {
    const guarded = p.catch((e) => log('background task failed', e));
    if (opts.waitUntil) opts.waitUntil(guarded);
  };

  const isFresh = (r: RoomRecord, t: number) => t - r.lastSeen <= ROOM_TTL_MS;

  /** Read all rooms; expired/corrupt ones are deleted in the background and not returned. */
  async function scanRooms(t: number): Promise<RoomRecord[]> {
    const keys = await storage.list('rooms/');
    const values = await mapLimit(keys, IO_CONCURRENCY, async (k) => ({ k, v: await storage.get(k) }));
    const alive: RoomRecord[] = [];
    const dead: string[] = [];
    for (const { k, v } of values) {
      if (v === null || v === undefined) continue;
      if (isRoomRecord(v) && isFresh(v, t)) alive.push(v);
      else dead.push(k);
    }
    if (dead.length) background(mapLimit(dead, IO_CONCURRENCY, (k) => storage.delete(k)));
    return alive;
  }

  async function gcMail(t: number): Promise<void> {
    const keys = await storage.list('mail/');
    const old = keys.filter((k) => {
      const kt = mailKeyTime(k);
      return !Number.isFinite(kt) || t - kt > MAIL_TTL_MS;
    });
    await mapLimit(old, IO_CONCURRENCY, (k) => storage.delete(k));
  }

  async function authHost(roomId: string, hostToken: string): Promise<RoomRecord | null> {
    const v = await storage.get(roomKey(roomId));
    if (!isRoomRecord(v)) return null;
    if ((await derivePeerId(hostToken)) !== v.hostPeerId) throw new HttpError(403, 'forbidden');
    return v;
  }

  function parseBody(req: LobbyRequest): Record<string, unknown> {
    if (!req.body) throw new HttpError(400, 'bad_json', 'missing body');
    let v: unknown;
    try {
      v = JSON.parse(req.body);
    } catch {
      throw new HttpError(400, 'bad_json');
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'bad_json');
    return v as Record<string, unknown>;
  }

  // ── endpoints ──

  async function host(b: Record<string, unknown>, t: number) {
    const mode = reqString(b, 'mode', RE_MODE);
    const version = reqString(b, 'version', RE_VERSION);
    const capacity = reqInt(b, 'capacity', MIN_CAPACITY, MAX_CAPACITY)!;
    const players = reqInt(b, 'players', 1, capacity)!;
    const name = sanitizeName(b.name, 'Host');
    let region: string | undefined;
    if (b.region !== undefined && b.region !== null && b.region !== '') region = reqString(b, 'region', RE_REGION);

    const base = { mode, name, players, capacity, version, lastSeen: t, ...(region ? { region } : {}) };

    if (b.resume !== undefined && b.resume !== null) {
      const r = b.resume as Record<string, unknown>;
      if (typeof r !== 'object') throw bad(`invalid 'resume'`);
      const roomId = reqString(r, 'roomId', RE_ROOM_ID);
      const hostToken = reqString(r, 'hostToken', RE_KEY);
      const hostPeerId = await derivePeerId(hostToken);
      const existing = await storage.get(roomKey(roomId));
      if (isRoomRecord(existing) && existing.hostPeerId !== hostPeerId) throw new HttpError(409, 'room_taken');
      const rec: RoomRecord = { roomId, hostPeerId, created: isRoomRecord(existing) ? existing.created : t, ...base };
      await storage.set(roomKey(roomId), rec);
      return { roomId, hostPeerId, hostToken, ttlMs: ROOM_TTL_MS, heartbeatMs: HEARTBEAT_MS };
    }

    const hostToken = randomKey();
    const hostPeerId = await derivePeerId(hostToken);
    for (let attempt = 0; attempt < 5; attempt++) {
      const roomId = randomRoomId();
      const rec: RoomRecord = { roomId, hostPeerId, created: t, ...base };
      if (await storage.set(roomKey(roomId), rec, { onlyIfNew: true })) {
        return { roomId, hostPeerId, hostToken, ttlMs: ROOM_TTL_MS, heartbeatMs: HEARTBEAT_MS };
      }
    }
    throw new HttpError(500, 'internal', 'could not allocate a room id');
  }

  async function heartbeat(b: Record<string, unknown>, t: number) {
    const roomId = reqString(b, 'roomId', RE_ROOM_ID);
    const hostToken = reqString(b, 'hostToken', RE_KEY);
    const room = await authHost(roomId, hostToken);
    if (!room) throw new HttpError(404, 'not_found');
    const capacity = reqInt(b, 'capacity', MIN_CAPACITY, MAX_CAPACITY, true) ?? room.capacity;
    const players = reqInt(b, 'players', 1, capacity, true) ?? Math.min(room.players, capacity);
    const name = b.name !== undefined ? sanitizeName(b.name, room.name) : room.name;
    const rec: RoomRecord = { ...room, capacity, players, name, lastSeen: t };
    await storage.set(roomKey(roomId), rec);
    return { ok: true, ttlMs: ROOM_TTL_MS };
  }

  async function close(b: Record<string, unknown>) {
    const roomId = reqString(b, 'roomId', RE_ROOM_ID);
    const hostToken = reqString(b, 'hostToken', RE_KEY);
    const room = await authHost(roomId, hostToken);
    if (room) await storage.delete(roomKey(roomId));
    return { ok: true };
  }

  async function find(q: URLSearchParams, t: number) {
    const mode = queryString(q, 'mode', RE_MODE)!;
    const version = queryString(q, 'version', RE_VERSION)!;
    const exclude = new Set((q.get('exclude') ?? '').split(',').filter((s) => RE_ROOM_ID.test(s)));
    const rooms = (await scanRooms(t)).filter(
      (r) => r.mode === mode && r.version === version && r.players < r.capacity && !exclude.has(r.roomId),
    );
    rooms.sort((a, b) => b.players - a.players || a.created - b.created);
    return { room: rooms.length ? publicRoom(rooms[0]!) : null };
  }

  async function room(q: URLSearchParams, t: number) {
    const id = q.get('id') ?? '';
    if (!RE_ROOM_ID.test(id)) throw new HttpError(404, 'not_found');
    const v = await storage.get(roomKey(id));
    if (!isRoomRecord(v)) throw new HttpError(404, 'not_found');
    if (!isFresh(v, t)) {
      background(storage.delete(roomKey(id)));
      throw new HttpError(404, 'not_found');
    }
    return { room: publicRoom(v) };
  }

  async function list(q: URLSearchParams, t: number) {
    const mode = queryString(q, 'mode', RE_MODE, true);
    const version = queryString(q, 'version', RE_VERSION, true);
    const rooms = (await scanRooms(t)).filter((r) => (!mode || r.mode === mode) && (!version || r.version === version));
    rooms.sort((a, b) => b.players - a.players || a.created - b.created);
    return { rooms: rooms.slice(0, MAX_LIST_ROOMS).map(publicRoom) };
  }

  async function signal(b: Record<string, unknown>, t: number) {
    const to = reqString(b, 'to', RE_PEER_ID);
    const key = reqString(b, 'key', RE_KEY);
    if (!('data' in b) || b.data === undefined) throw bad(`missing 'data'`);
    if (utf8Length(JSON.stringify(b.data)) > MAX_DATA_BYTES) throw new HttpError(413, 'too_large', 'data exceeds 16 KB');
    const from = await derivePeerId(key);
    if (from === to) throw bad('cannot signal yourself');
    const rec: MailRecord = { from, data: b.data, t };
    const k = `${mailPrefix(to)}${String(t).padStart(15, '0')}-${randomString(6)}`;
    await storage.set(k, rec);
    return { ok: true, from };
  }

  async function poll(b: Record<string, unknown>, t: number) {
    const key = reqString(b, 'key', RE_KEY);
    const peerId = await derivePeerId(key);
    const keys = (await storage.list(mailPrefix(peerId))).sort();
    const expired: string[] = [];
    const fresh: string[] = [];
    for (const k of keys) {
      const kt = mailKeyTime(k);
      if (!Number.isFinite(kt) || t - kt > MAIL_TTL_MS) expired.push(k);
      else if (fresh.length < MAX_POLL_BATCH) fresh.push(k);
    }
    const values = await mapLimit(fresh, IO_CONCURRENCY, (k) => storage.get(k));
    await mapLimit([...fresh, ...expired], IO_CONCURRENCY, (k) => storage.delete(k));
    const messages: MailRecord[] = [];
    for (const v of values) if (isMailRecord(v)) messages.push({ from: v.from, data: v.data, t: v.t });
    return { peerId, messages };
  }

  // ── router ──

  async function handle(req: LobbyRequest): Promise<LobbyResponse> {
    const t = now();
    const method = req.method.toUpperCase();
    const path = req.path.replace(/^\/+|\/+$/g, '');
    try {
      const routes: Record<string, { method: string; run: () => Promise<unknown> }> = {
        health: { method: 'GET', run: async () => ({ ok: true, service: 'moongravity-lobby', api: LOBBY_API_VERSION, time: t }) },
        host: { method: 'POST', run: () => host(parseBody(req), t) },
        heartbeat: { method: 'POST', run: () => heartbeat(parseBody(req), t) },
        close: { method: 'POST', run: () => close(parseBody(req)) },
        find: { method: 'GET', run: () => find(req.query, t) },
        room: { method: 'GET', run: () => room(req.query, t) },
        list: { method: 'GET', run: () => list(req.query, t) },
        signal: { method: 'POST', run: () => signal(parseBody(req), t) },
        poll: { method: 'POST', run: () => poll(parseBody(req), t) },
      };
      const route = Object.prototype.hasOwnProperty.call(routes, path) ? routes[path] : undefined;
      if (!route) throw new HttpError(404, 'unknown_endpoint');
      if (method !== route.method && !(method === 'HEAD' && route.method === 'GET')) {
        const res = json(405, { error: 'method_not_allowed' });
        res.headers['Allow'] = route.method;
        return res;
      }
      const result = await route.run();
      if (t - gcState.lastMailGc > MAIL_GC_INTERVAL_MS) {
        gcState.lastMailGc = t;
        background(gcMail(t));
      }
      return json(200, result);
    } catch (e) {
      if (e instanceof HttpError) {
        return json(e.status, e.message !== e.code ? { error: e.code, message: e.message } : { error: e.code });
      }
      log('internal error', e);
      return json(500, { error: 'internal' });
    }
  }

  async function handleFetch(req: Request, basePath = '/api/lobby'): Promise<Response> {
    const url = new URL(req.url);
    let path = url.pathname;
    const i = path.indexOf(basePath);
    if (i >= 0) path = path.slice(i + basePath.length);
    let body: string | null = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const len = Number(req.headers.get('content-length') ?? '0');
      if (len > MAX_BODY_BYTES) return toResponse(json(413, { error: 'too_large' }));
      body = await req.text();
      if (utf8Length(body) > MAX_BODY_BYTES) return toResponse(json(413, { error: 'too_large' }));
    }
    const res = await handle({ method: req.method, path, query: url.searchParams, body });
    return toResponse(res, req.method === 'HEAD');
  }

  return { handle, handleFetch };
}

function toResponse(r: LobbyResponse, head = false): Response {
  return new Response(head ? null : r.body, { status: r.status, headers: r.headers });
}
