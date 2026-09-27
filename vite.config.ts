import { defineConfig, type Connect, type Plugin } from 'vite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

/**
 * PWA: emits dist/sw.js from src/pwa/sw.js with a precache list of every built asset
 * plus the public/ files (icons, audio, manifest), versioned per build.
 */
function pwa(): Plugin {
  const publicFiles = (dir: string, root = dir): string[] => {
    let out: string[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out = out.concat(publicFiles(full, root));
      else out.push(relative(root, full).split(sep).join('/'));
    }
    return out;
  };
  return {
    name: 'moongravity-pwa',
    apply: 'build',
    generateBundle(_opts, bundle) {
      // fonts: woff2 only (every target browser supports it), no scripts we never render
      const skip = (f: string) => f.startsWith('.well-known/') || f === '_headers' || f === '_redirects' || f.endsWith('.map') || f.endsWith('.md') || f.endsWith('.woff') || /(vietnamese|greek)/.test(f);
      const files = [...Object.keys(bundle), ...publicFiles('public')].filter((f) => !skip(f) && f !== 'sw.js');
      const urls = ['./', ...files.map((f) => './' + f)];
      const version = Date.now().toString(36);
      const src = readFileSync('src/pwa/sw.js', 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(urls));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [lobbyDevApi(), pwa()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
