// Stair audit: every Kit.stairs flight is checked for visual-only ceilings over it, walls right at the
// top and dead-end landings (flood fill of a 0.42 m capsule from the top step).
//
// Usage (needs playwright-core — `npm i --no-save playwright-core`; readable call sites need an unminified build):
//   npx vite build --minify false --outDir /tmp/mg-dbg && npx vite preview --outDir /tmp/mg-dbg --port 5193
//   node scripts/audit/stairs.mjs http://localhost:5193 war4v4|ffa|duel2v2 [samples]
import { chromium } from 'playwright-core';
const BASE = process.argv[2] ?? 'http://localhost:5192';
const MODE = process.argv[3] ?? 'war4v4';
const N = +(process.argv[4] ?? 1500);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
await page.addInitScript(() => { globalThis.__mgStairDebug = []; });
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
  const tris = TM.length;
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
  const S = globalThis.__mgStairDebug ?? []; const out = [];
  const up = new T.Vector3(0, 1, 0);
  for (const st of S) {
    const a = new T.Vector3(...st.a), c = new T.Vector3(...st.c), e = new T.Vector3(...st.e);
    const probs = [];
    { // stale entry from another map build? (the ramp must exist under the stair midpoint)
      const mid = a.clone().lerp(c, 0.5); const o = mid.clone(); o.y += 0.6;
      const f = phys.raycast(o, new T.Vector3(0, -1, 0), 1.2, { forMove: true });
      if (!f || Math.abs(f.point.y - mid.y) > 0.35) continue;
    }
    const pts = [];
    for (let t = 0.2; t <= 1.001; t += 0.1) pts.push(a.clone().lerp(c, t));
    pts.push(c.clone().lerp(e, 0.5), e.clone());
    for (const p of pts) {
      const o = p.clone(); o.y += 0.35;
      const vh = cast(o, up, 1.9);
      const ph = phys.raycast(o, up, 1.9, { forMove: true });
      if (vh && vh.distance > 0.06 && !ph) probs.push(['GHOST-CEIL', +p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), vh.mesh, +vh.distance.toFixed(2)]);
      else if (ph) probs.push(['LOW-CEIL', +p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), vh ? vh.mesh : '-', +ph.t.toFixed(2)]);
    }
    // straight on at the top: a wall right after the last step
    const fwd = e.clone().sub(c).setY(0).normalize();
    for (const h of [0.5, 1.2]) {
      const o = c.clone(); o.y += h;
      const vh = cast(o, fwd, 1.1); const ph = phys.raycast(o, fwd, 1.1, { forMove: true });
      if (vh && !ph) probs.push(['GHOST-WALL', +o.x.toFixed(1), +o.y.toFixed(1), +o.z.toFixed(1), vh.mesh, +vh.distance.toFixed(2)]);
      else if (ph) probs.push(['WALL', +o.x.toFixed(1), +o.y.toFixed(1), +o.z.toFixed(1), vh ? vh.mesh : '-', +ph.t.toFixed(2)]);
    }
    // exit flood fill at the top floor: can a 0.42 m capsule leave the stair corridor?
    {
      const dn = new T.Vector3(0, -1, 0); const fw2 = e.clone().sub(c).setY(0).normalize(); const side = new T.Vector3(-fw2.z, 0, fw2.x);
      const step = 0.2, R = 4, key = (i, j) => i * 1000 + j; const seen = new Set(); const q = [];
      const cellOk = (x, z) => {
        const o = new T.Vector3(x, c.y + 0.7, z); const f = phys.raycast(o, dn, 1.3, { forMove: true });
        const fy = f ? o.y - (f.t ?? f.distance ?? f.dist ?? 0) : null; if (fy === null || fy < c.y - 0.6) return false;
        return !phys.pointBlocked(new T.Vector3(x, fy + 0.5, z), 0.4) && !phys.pointBlocked(new T.Vector3(x, fy + 1.3, z), 0.4);
      };
      let s0 = null;
      for (const d of [0.15, 0, -0.2, 0.35, -0.4]) { const p = c.clone().addScaledVector(fw2, d); if (cellOk(p.x, p.z)) { s0 = p; break; } }
      let off = 0, tot = 0;
      if (s0) { q.push([0, 0]); seen.add(key(0, 0)); } else s0 = c.clone();
      while (q.length && tot < 900) {
        const [i, j] = q.shift(); tot++;
        const x = s0.x + i * step, z = s0.z + j * step;
        const rel = new T.Vector3(x - c.x, 0, z - c.z); const along = rel.dot(fw2), lat = Math.abs(rel.dot(side));
        if (lat > st.w / 2 + 0.6 || along > 0.9) off++;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj; if (Math.hypot(ni, nj) * step > R || seen.has(key(ni, nj))) continue; seen.add(key(ni, nj));
          if (cellOk(s0.x + ni * step, s0.z + nj * step)) q.push([ni, nj]);
        }
      }
      if (off < 12) probs.push(['DEAD-END', +c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1), 'reach', tot, 'off', off]);
    }
    if (probs.length) out.push({ a: st.a.map((v) => +v.toFixed(1)), c: st.c.map((v) => +v.toFixed(1)), w: st.w, st: st.st.replace(/\(http[^)]*\)/g, ''), probs });
  }
  const rays = 0, ghosts = {}, samples = [], src = {};
  return { rays, meshes: meshes.length, tris, ghosts, samples, src, stairs: out, nStairs: S.length };

}, N);
console.log(MODE, 'stairs', r.nStairs, 'with problems', r.stairs.length);
for (const x of r.stairs) { console.log('STAIR', JSON.stringify(x.a), '->', JSON.stringify(x.c), 'w', x.w, '::', x.st); for (const p of x.probs) console.log('     ', JSON.stringify(p)); }
await browser.close();
