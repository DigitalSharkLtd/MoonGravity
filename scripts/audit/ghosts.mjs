// Ghost-geometry audit: rays from walkable nav nodes vs. the physics world — reports visible level
// surfaces with no collider (you walk / jump through them), clustered and traced to the generator call.
//
// Usage (needs playwright-core — `npm i --no-save playwright-core`; readable call sites need an unminified build):
//   npx vite build --minify false --outDir /tmp/mg-dbg && npx vite preview --outDir /tmp/mg-dbg --port 5193
//   node scripts/audit/ghosts.mjs http://localhost:5193 war4v4|ffa|duel2v2 [samples]
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:5192';
const MODE = process.argv[3] ?? 'war4v4';
const N = +(process.argv[4] ?? 1500);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
await page.addInitScript(() => { globalThis.__mgGeoDebug = []; });
await page.addInitScript(() => localStorage.setItem('mg.settings', JSON.stringify({ quality: 'low', shadows: 'off', ambientOcclusion: false, renderScale: 0.4 })));
await page.goto(BASE + '/index.html?menu', { timeout: 120000 });
await page.waitForFunction(() => window.__mg && window.__mg.world, null, { timeout: 400000 });
await page.evaluate((m) => { globalThis.__w0 = window.__mg.world; globalThis.__n0 = [(globalThis.__mgStairDebug ?? []).length, (globalThis.__mgGeoDebug ?? []).length]; window.__mg.start(m, 'condor'); }, MODE);
await page.waitForFunction(() => window.__mg.game && window.__mg.game.bots && window.__mg.game.bots.nav, null, { timeout: 300000 });
await page.evaluate(() => { if (window.__mg.world !== globalThis.__w0) { if (globalThis.__mgStairDebug) globalThis.__mgStairDebug.splice(0, globalThis.__n0[0]); if (globalThis.__mgGeoDebug) globalThis.__mgGeoDebug.splice(0, globalThis.__n0[1]); } });
const r = await page.evaluate((N) => {
  const T = window.__mg.THREE; const g = window.__mg.game; const w = window.__mg.world; const phys = w.physics;
  const skip = new Set(); w.terrain.group.traverse((o) => skip.add(o));
  const meshes = [];
  w.scene.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || skip.has(o) || !o.visible) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.transparent || m.opacity < 1 || !o.layers.isEnabled(0)) return;
    if (!/^static-/.test(o.name)) return; // level geometry only
    meshes.push(o);
  });
  // triangle soup + XZ grid (2 m cells): a ray only tests the triangles of the cells it crosses
  const CS = 2; const grid = new Map(); const TR = []; const TM = []; const v = [new T.Vector3(), new T.Vector3(), new T.Vector3()];
  meshes.forEach((m, mi) => {
    m.updateMatrixWorld(true);
    const pos = m.geometry.attributes.position; const idx = m.geometry.index; const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(m.matrixWorld);
      const ti = TR.length / 9; TR.push(v[0].x, v[0].y, v[0].z, v[1].x, v[1].y, v[1].z, v[2].x, v[2].y, v[2].z); TM.push(mi);
      const x0 = Math.floor(Math.min(v[0].x, v[1].x, v[2].x) / CS), x1 = Math.floor(Math.max(v[0].x, v[1].x, v[2].x) / CS);
      const z0 = Math.floor(Math.min(v[0].z, v[1].z, v[2].z) / CS), z1 = Math.floor(Math.max(v[0].z, v[1].z, v[2].z) / CS);
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const key = i * 100003 + j; let l = grid.get(key); if (!l) grid.set(key, (l = [])); l.push(ti); }
    }
  });
  const rayTri = (o, d, ti) => {
    const a = ti * 9; const e1x = TR[a + 3] - TR[a], e1y = TR[a + 4] - TR[a + 1], e1z = TR[a + 5] - TR[a + 2];
    const e2x = TR[a + 6] - TR[a], e2y = TR[a + 7] - TR[a + 1], e2z = TR[a + 8] - TR[a + 2];
    const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-9) return Infinity; const inv = 1 / det;
    const tx = o.x - TR[a], ty = o.y - TR[a + 1], tz = o.z - TR[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return Infinity;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const w = (d.x * qx + d.y * qy + d.z * qz) * inv; if (w < 0 || u + w > 1) return Infinity;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t > 0.02 ? t : Infinity;
  };
  const cast = (o, d, far) => {
    const cells = new Set(); for (let s = 0; s <= far + 0.01; s += 0.5) cells.add(Math.floor((o.x + d.x * s) / CS) * 100003 + Math.floor((o.z + d.z * s) / CS));
    let best = far, bi = -1;
    for (const c of cells) for (const ti of grid.get(c) ?? []) { const t = rayTri(o, d, ti); if (t < best) { best = t; bi = ti; } }
    return bi < 0 ? null : { distance: best, mesh: meshes[TM[bi]].name, point: new T.Vector3().copy(o).addScaledVector(d, best) };
  };
  const nodes = g.bots.nav.nodes; const ghosts = {}; const samples = []; let rays = 0;
  const dirs = []; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; dirs.push(new T.Vector3(Math.cos(a), 0, Math.sin(a))); }
  const up = new T.Vector3(0, 1, 0);
  let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    const nd = nodes[Math.floor(rnd() * nodes.length)];
    for (const [h, list] of [[0.6, dirs], [1.4, dirs], [1.0, [up]]]) {
      for (const d of list) {
        const o = new T.Vector3(nd.x, nd.y + h, nd.z);
        rays++;
        const hit = cast(o, d, 3);
        if (!hit) continue;
        const ph = phys.raycast(o, d, hit.distance + 0.6, { forMove: true });
        if (ph) continue;
        ghosts[hit.mesh] = (ghosts[hit.mesh] ?? 0) + 1;
        samples.push([hit.mesh, d === up ? 'up' : 'side', +hit.point.x.toFixed(1), +hit.point.y.toFixed(1), +hit.point.z.toFixed(1), +hit.distance.toFixed(2)]);
      }
    }
  }
  var tris = TM.length;
  // attribute ghost hits to Kit.box calls (debug build only)
  const D = globalThis.__mgGeoDebug ?? []; const src = {};
  const qi = new T.Quaternion(); const lp = new T.Vector3();
  for (const s of samples) {
    const p = new T.Vector3(s[2], s[3], s[4]); let found = null;
    for (const b of D) {
      lp.set(p.x - b.c[0], p.y - b.c[1], p.z - b.c[2]).applyQuaternion(qi.set(b.q[0], b.q[1], b.q[2], b.q[3]).invert());
      if (Math.abs(lp.x) <= b.h[0] + 0.12 && Math.abs(lp.y) <= b.h[1] + 0.12 && Math.abs(lp.z) <= b.h[2] + 0.12 && ('static-' + b.mat) === s[0]) { const vol = b.h[0] * b.h[1] * b.h[2]; if (!found || vol < found.vol) found = { ...b, vol }; }
    }
    const key = found ? found.mat + ' ' + found.h.map((v) => (v * 2).toFixed(1)).join('x') + ' :: ' + found.st : 'unattributed ' + s[0];
    const e = src[key] ?? (src[key] = { n: 0, at: [] }); e.n++; if (e.at.length < 3) e.at.push([s[2], s[3], s[4]]);
  }
  return { rays, meshes: meshes.length, tris, ghosts, samples, src };
}, N);
console.log(MODE, 'rays', r.rays, 'meshes', r.meshes, 'tris', r.tris);
console.log('ghost hits by material:', JSON.stringify(Object.entries(r.ghosts).sort((a, b) => b[1] - a[1])));
const cl = new Map();
for (const s of r.samples) { const k = s[0] + '@' + Math.round(s[2] / 4) * 4 + ',' + Math.round(s[4] / 4) * 4; const e = cl.get(k) ?? { n: 0, ymin: 1e9, ymax: -1e9, up: 0 }; e.n++; e.ymin = Math.min(e.ymin, s[3]); e.ymax = Math.max(e.ymax, s[3]); if (s[1] === 'up') e.up++; cl.set(k, e); }
const top = [...cl.entries()].filter(([k]) => !/oreRock|dirt|regolith|plant|rubber|brass/.test(k)).sort((a, b) => b[1].n - a[1].n).slice(0, 30);
for (const [k, e] of top) console.log('  ', k.padEnd(28), 'hits', e.n, 'y', e.ymin, '..', e.ymax, 'up', e.up);
if (process.env.SRC) for (const [k, e] of Object.entries(r.src).filter(([k]) => !/oreRock|dirt|regolith|plant|rubber|brass/.test(k)).sort((a, b) => b[1].n - a[1].n).slice(0, 40)) console.log('SRC', e.n, k, JSON.stringify(e.at));
await browser.close();
