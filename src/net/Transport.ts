/**
 * WebRTC peer links for the listen-server (star) topology.
 *
 * Every link = one RTCPeerConnection with two *negotiated* DataChannels created on
 * both sides with fixed ids (no ondatachannel races):
 *   id 0 'rel'  — ordered, reliable       (events, chat, join/leave, RPC)
 *   id 1 'fast' — unordered, maxRetransmits 0 (snapshots / inputs; stale data is dropped)
 *
 * Wire format: every frame is a string. User messages are plain JSON.stringify(msg);
 * internal control frames (ping/pong/bye) start with '\u0001' (JSON never does) and never
 * reach onMessage.
 *
 * NAT traversal: public STUN only. Peers behind symmetric NATs / strict firewalls may
 * fail to connect ('rtc_failed') — add a TURN server to ICE_SERVERS (or set
 * VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL at build time) to fix that.
 */

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

{
  const env = import.meta.env as Record<string, string | undefined>;
  const turn = env.VITE_TURN_URL;
  if (turn) {
    ICE_SERVERS.push({
      urls: turn.split(',').map((s) => s.trim()).filter(Boolean),
      username: env.VITE_TURN_USERNAME,
      credential: env.VITE_TURN_CREDENTIAL,
    });
  }
}

export const NET_TIMING = {
  /** Non-trickle ICE: max wait for candidate gathering before sending what we have. */
  iceGatherTimeoutMs: 2500,
  /** RTT ping period on the reliable channel. */
  pingIntervalMs: 2000,
  /** Link is closed when nothing (not even a pong) arrived for this long. Generous: a joiner's
   *  main thread stalls for seconds while its match loads (models, shader compiles); real network
   *  loss is caught sooner by connectionState ('disconnected' grace / 'failed'). */
  inactivityTimeoutMs: 20000,
  /** connectionState 'disconnected' longer than this → link closed. */
  disconnectGraceMs: 5000,
  /** Unreliable sends are dropped while the fast channel has more than this buffered. */
  fastBufferLimit: 64 * 1024,
  /** Max messages kept while onMessage is not yet assigned. */
  inboxLimit: 1024,
};

export interface PeerLink {
  readonly peerId: string;
  /** Player name of the remote side. */
  readonly name: string;
  readonly open: boolean;
  /** JSON-serialized; reliable=true (default) → 'rel' channel, false → 'fast' (falls back to 'rel' if 'fast' isn't open). Never throws. */
  send(msg: unknown, reliable?: boolean): void;
  /** Messages received before a handler is assigned are queued and delivered once it is. */
  onMessage: ((msg: unknown, link: PeerLink) => void) | null;
  onClose: ((link: PeerLink) => void) | null;
  close(): void;
  /** Smoothed round-trip time in ms (0 until the first pong). */
  readonly rtt: number;
}

const CTRL = '\u0001';

type Ctrl = { t: 'ping'; s: number } | { t: 'pong'; s: number } | { t: 'bye' };

/** JSON.stringify that never throws (null when the value can't be serialized). */
export function serialize(msg: unknown): string | null {
  try {
    const text = JSON.stringify(msg);
    return typeof text === 'string' ? text : null;
  } catch (e) {
    console.warn('[net] message not serializable', e);
    return null;
  }
}

export function rtcSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined';
}

export interface RtcParts {
  pc: RTCPeerConnection;
  rel: RTCDataChannel;
  fast: RTCDataChannel;
}

/** New peer connection with both negotiated channels (identical on offerer and answerer). */
export function createPeerConnection(): RtcParts {
  if (!rtcSupported()) throw new Error('rtc_unsupported');
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const rel = pc.createDataChannel('rel', { negotiated: true, id: 0, ordered: true });
  const fast = pc.createDataChannel('fast', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
  return { pc, rel, fast };
}

/**
 * Non-trickle ICE: resolve with the local SDP once gathering is complete or after
 * `timeoutMs` (whatever candidates were gathered by then are included).
 * Call after setLocalDescription().
 */
export function gatherLocalSdp(pc: RTCPeerConnection, timeoutMs = NET_TIMING.iceGatherTimeoutMs): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCand);
      const sdp = pc.localDescription?.sdp;
      if (sdp) resolve(sdp);
      else reject(new Error('rtc_failed'));
    };
    const onState = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const onCand = (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCand);
    if (pc.iceGatheringState === 'complete') finish();
  });
}

/** Live links; on page unload they all say 'bye' so remote peers notice immediately. */
const liveLinks = new Set<RtcPeerLink>();
let unloadHooked = false;
function hookUnload(): void {
  if (unloadHooked || typeof addEventListener !== 'function') return;
  unloadHooked = true;
  addEventListener('pagehide', () => {
    for (const l of [...liveLinks]) l.close();
  });
}

/** A WebRTC peer link. Create it right after createPeerConnection() so no early message is missed. */
export class RtcPeerLink implements PeerLink {
  readonly peerId: string;
  name: string;
  onClose: ((link: PeerLink) => void) | null = null;

  private readonly pc: RTCPeerConnection;
  private readonly rel: RTCDataChannel;
  private readonly fast: RTCDataChannel;
  private _onMessage: ((msg: unknown, link: PeerLink) => void) | null = null;
  private inbox: unknown[] = [];
  private flushQueued = false;
  private closed = false;
  private _rtt = 0;
  private lastRecv = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private discTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly closeListeners: Array<(link: RtcPeerLink) => void> = [];
  private readonly openWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(parts: RtcParts, peerId: string, name: string) {
    this.pc = parts.pc;
    this.rel = parts.rel;
    this.fast = parts.fast;
    this.peerId = peerId;
    this.name = name;
    liveLinks.add(this);
    hookUnload();

    const onFrame = (e: MessageEvent) => this.onFrame(e.data);
    this.rel.onmessage = onFrame;
    this.fast.onmessage = onFrame;
    this.rel.onopen = () => this.onRelOpen();
    this.rel.onclose = () => this.dispose();
    this.rel.onerror = () => {
      /* a close event follows if the channel is really dead */
    };
    this.pc.onconnectionstatechange = () => this.onConnState();
    if (this.rel.readyState === 'open') this.onRelOpen();
  }

  get open(): boolean {
    return !this.closed && this.rel.readyState === 'open';
  }

  get rtt(): number {
    return this._rtt;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get onMessage(): ((msg: unknown, link: PeerLink) => void) | null {
    return this._onMessage;
  }

  set onMessage(fn: ((msg: unknown, link: PeerLink) => void) | null) {
    this._onMessage = fn;
    if (fn && this.inbox.length && !this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => {
        this.flushQueued = false;
        while (this.inbox.length && this._onMessage) this.deliver(this.inbox.shift());
      });
    }
  }

  send(msg: unknown, reliable = true): void {
    if (this.closed) return;
    const text = serialize(msg);
    if (text !== null) this.sendText(text, reliable);
  }

  /** Send an already JSON-serialized message (used by broadcast to serialize once). */
  sendText(text: string, reliable = true): void {
    if (this.closed) return;
    try {
      if (!reliable && this.fast.readyState === 'open') {
        if (this.fast.bufferedAmount <= NET_TIMING.fastBufferLimit) this.fast.send(text);
        return; // congested: drop unreliable data
      }
      if (this.rel.readyState === 'open') this.rel.send(text);
    } catch (e) {
      console.warn('[net] send failed', e);
    }
  }

  close(): void {
    if (this.closed) return;
    const sayBye = this.rel.readyState === 'open';
    if (sayBye) this.sendCtrl({ t: 'bye' });
    // give the 'bye' a moment to leave before the SCTP association is torn down
    this.dispose(sayBye ? 150 : 0);
  }

  /** Internal: notified once when the link closes (before onClose). */
  addCloseListener(fn: (link: RtcPeerLink) => void): void {
    if (this.closed) fn(this);
    else this.closeListeners.push(fn);
  }

  /** Resolves when the reliable channel is open; rejects with Error('rtc_failed') on failure/close/timeout. */
  whenOpen(timeoutMs: number): Promise<void> {
    if (this.open) return Promise.resolve();
    if (this.closed) return Promise.reject(new Error('rtc_failed'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.openWaiters.indexOf(w);
        if (i >= 0) this.openWaiters.splice(i, 1);
        reject(new Error('rtc_failed'));
      }, timeoutMs);
      const w = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.openWaiters.push(w);
    });
  }

  // ── internals ──

  private sendCtrl(c: Ctrl): void {
    try {
      if (this.rel.readyState === 'open') this.rel.send(CTRL + JSON.stringify(c));
    } catch {
      /* ignore */
    }
  }

  private onRelOpen(): void {
    if (this.closed || this.pingTimer) return;
    this.lastRecv = performance.now();
    for (const w of this.openWaiters.splice(0)) w.resolve();
    this.sendCtrl({ t: 'ping', s: performance.now() });
    this.pingTimer = setInterval(() => {
      const now = performance.now();
      if (now - this.lastRecv > NET_TIMING.inactivityTimeoutMs) {
        this.dispose();
        return;
      }
      this.sendCtrl({ t: 'ping', s: now });
    }, NET_TIMING.pingIntervalMs);
  }

  private onConnState(): void {
    const s = this.pc.connectionState;
    if (s === 'failed' || s === 'closed') {
      this.dispose();
    } else if (s === 'disconnected') {
      if (!this.discTimer) {
        this.discTimer = setTimeout(() => {
          this.discTimer = null;
          if (this.pc.connectionState !== 'connected') this.dispose();
        }, NET_TIMING.disconnectGraceMs);
      }
    } else if (this.discTimer) {
      clearTimeout(this.discTimer);
      this.discTimer = null;
    }
  }

  private onFrame(data: unknown): void {
    if (this.closed || typeof data !== 'string') return;
    this.lastRecv = performance.now();
    if (data.charCodeAt(0) === 1) {
      let c: Ctrl;
      try {
        c = JSON.parse(data.slice(1)) as Ctrl;
      } catch {
        return;
      }
      if (c.t === 'ping') this.sendCtrl({ t: 'pong', s: c.s });
      else if (c.t === 'pong' && typeof c.s === 'number') {
        const sample = Math.max(0, performance.now() - c.s);
        this._rtt = this._rtt === 0 ? sample : this._rtt * 0.8 + sample * 0.2;
      } else if (c.t === 'bye') this.dispose();
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (this._onMessage && !this.inbox.length) this.deliver(msg);
    else {
      this.inbox.push(msg);
      if (this.inbox.length > NET_TIMING.inboxLimit) this.inbox.shift();
    }
  }

  private deliver(msg: unknown): void {
    try {
      this._onMessage?.(msg, this);
    } catch (e) {
      console.error('[net] onMessage handler threw', e);
    }
  }

  private dispose(pcCloseDelayMs = 0): void {
    if (this.closed) return;
    this.closed = true;
    liveLinks.delete(this);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.discTimer) clearTimeout(this.discTimer);
    this.pingTimer = this.discTimer = null;
    for (const w of this.openWaiters.splice(0)) w.reject(new Error('rtc_failed'));

    this.rel.onmessage = this.fast.onmessage = null;
    this.rel.onopen = this.rel.onclose = this.rel.onerror = null;
    this.pc.onconnectionstatechange = null;
    const shutdown = () => {
      try {
        this.rel.close();
        this.fast.close();
        this.pc.close();
      } catch {
        /* ignore */
      }
    };
    if (pcCloseDelayMs > 0) setTimeout(shutdown, pcCloseDelayMs);
    else shutdown();

    for (const fn of this.closeListeners.splice(0)) {
      try {
        fn(this);
      } catch (e) {
        console.error('[net] close listener threw', e);
      }
    }
    try {
      this.onClose?.(this);
    } catch (e) {
      console.error('[net] onClose handler threw', e);
    }
  }
}
