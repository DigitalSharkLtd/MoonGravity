/**
 * Netlify Function (v2) — MOON GRAVITY lobby / matchmaking / WebRTC signaling.
 * All logic lives in shared/lobbyCore.ts (see the API reference there); this file only
 * adapts it to Netlify Blobs storage and the Functions v2 fetch-style handler.
 *
 * Route: /api/lobby/*   (e.g. POST /api/lobby/host, GET /api/lobby/find?mode=ffa&version=mg-1)
 */
import { getStore } from '@netlify/blobs';
import type { Config, Context } from '@netlify/functions';
import { createLobby, type LobbyStorage } from '../../shared/lobbyCore';

const STORE_NAME = 'moongravity-lobby';

/** Survives across invocations while this function instance stays warm. */
const gcState = { lastMailGc: 0 };

function blobsStorage(): LobbyStorage {
  // Site-wide store with strong consistency: mailbox reads must see writes made
  // a moment ago by another function invocation.
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  return {
    async get(key) {
      return (await store.get(key, { type: 'json' })) ?? null;
    },
    async set(key, value, opts) {
      const res = await store.setJSON(key, value, opts?.onlyIfNew ? { onlyIfNew: true } : {});
      return res.modified;
    },
    async delete(key) {
      await store.delete(key);
    },
    async list(prefix) {
      const { blobs } = await store.list({ prefix });
      return blobs.map((b) => b.key);
    },
  };
}

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    const lobby = createLobby(blobsStorage(), {
      gcState,
      waitUntil: (p) => context.waitUntil(p),
    });
    return await lobby.handleFetch(req, '/api/lobby');
  } catch (e) {
    console.error('[lobby] unhandled', e);
    return new Response(JSON.stringify({ error: 'internal' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
};

export const config: Config = {
  path: '/api/lobby/*',
};
