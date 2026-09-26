import { defineConfig, type Connect, type Plugin } from 'vite';
import { createLobby, MemoryLobbyStorage, MAX_BODY_BYTES, LOBBY_HEADERS } from './shared/lobbyCore';

/**
 * Serves the lobby / signaling API (/api/lobby/*, same code as the Netlify function)
 * from an in-memory store in `vite` dev and `vite preview`, so multiplayer works
 * locally (e.g. two browser tabs) without Netlify. State is lost on server restart.
 */
function lobbyDevApi(): Plugin {
  const lobby = createLobby(new MemoryLobbyStorage(), { log: (...a) => console.error('[lobby]', ...a) });

  const middleware: Connect.NextHandleFunction = (req, res) => {
    const send = (status: number, headers: Record<string, string>, body: string) => {
      if (res.headersSent) return;
      res.statusCode = status;
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const fail = (status: number, error: string) => send(status, { ...LOBBY_HEADERS }, JSON.stringify({ error }));

    // connect strips the mount path: req.url is e.g. '/find?mode=ffa'
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = (req.method ?? 'GET').toUpperCase();

    const run = (body: string | null) => {
      lobby
        .handle({ method, path: url.pathname, query: url.searchParams, body })
        .then((r) => send(r.status, r.headers, r.body))
        .catch((e) => {
          console.error('[lobby]', e);
          fail(500, 'internal');
        });
    };

    if (method === 'GET' || method === 'HEAD') return run(null);

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        fail(413, 'too_large');
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!aborted) run(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      if (!aborted) fail(400, 'bad_request');
      aborted = true;
    });
  };

  return {
    name: 'moongravity-lobby-dev-api',
    configureServer(server) {
      server.middlewares.use('/api/lobby', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/lobby', middleware);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [lobbyDevApi()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
