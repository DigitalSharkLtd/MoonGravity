// Tunneling test: fires the local body at thin walls / floor slabs at 12–55 m/s and checks it never
// ends up on the far side by crossing the collider itself (going around through an opening is fine).
//
// Usage (needs playwright-core — `npm i --no-save playwright-core`; readable call sites need an unminified build):
//   npx vite build --minify false --outDir /tmp/mg-dbg && npx vite preview --outDir /tmp/mg-dbg --port 5193
//   node scripts/audit/tunnel.mjs http://localhost:5193 war4v4|ffa|duel2v2 [samples]
import { chromium } from 'playwright-core';
const BASE = process.argv[2]; const MODE = process.argv[3] ?? 'war4v4'; const N = +(process.argv[4] ?? 150);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.addInitScript(() => localStorage.setItem('mg.settings', JSON.stringify({ quality: 'low', shadows: 'off', ambientOcclusion: false, renderScale: 0.3 })));
await page.goto(BASE + '/index.html?menu', { timeout: 120000 });
await page.waitForFunction(() => window.__mg && window.__mg.world, null, { timeout: 400000 });
await page.evaluate((m) => window.__mg.start(m, 'condor'), MODE);
await page.waitForFunction(() => window.__mg.game && window.__mg.game.local && window.__mg.game.local.alive && window.__mg.game.bots, null, { timeout: 300000 });
const r = await page.evaluate((N) => {
  const T = window.__mg.THREE; const g = window.__mg.game; const phys = window.__mg.world.physics; const me = g.local; const b = me.body;
  for (const f of g.fighters.filter((f) => f !== me)) g.removeFighter(f);
  g.pause = () => {}; // (keep the rAF loop from racing us: we step manually inside one task)
  const axes = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)];
  const cands = [];
  for (const c of phys.colliders) {
    if (c.kind !== 'box' || c.dynamic || !c.enabled || c.noMove) continue;
    const h = [c.half.x, c.half.y, c.half.z]; const ti = h.indexOf(Math.min(...h));
    const others = h.filter((_, i) => i !== ti);
    if (h[ti] > 0.45 || Math.min(...others) < 1.2) continue;
    const n = axes[ti].clone().applyQuaternion(c.rot);
    const kind = Math.abs(n.y) < 0.15 ? 'wall' : Math.abs(n.y) > 0.95 ? 'slab' : null;
    if (kind) cands.push({ c, n, t: h[ti], kind });
  }
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blocked = (feet) => { for (const off of [b.radius, b.height * 0.5, b.height - b.radius]) if (phys.pointBlocked(feet.clone().setY(feet.y + off), b.radius * 0.98)) return true; return false; };
  const res = { tried: 0, byKind: {}, fails: [] };
  const speeds = [12, 22, 35, 55];
  for (let i = 0; i < N * 6 && res.tried < N; i++) {
    const cd = cands[Math.floor(rnd() * cands.length)]; const c = cd.c;
    // random point on the big face (local coords)
    const loc = new T.Vector3((rnd() * 2 - 1) * c.half.x * 0.8, (rnd() * 2 - 1) * c.half.y * 0.8, (rnd() * 2 - 1) * c.half.z * 0.8);
    const h = [c.half.x, c.half.y, c.half.z]; const ti = h.indexOf(cd.t); loc.setComponent(ti, 0);
    const p = loc.applyQuaternion(c.rot).add(c.center);
    const sgn = rnd() < 0.5 ? 1 : -1; const n = cd.n.clone().multiplyScalar(sgn); // travel direction: -n side → +n side
    let start, end;
    if (cd.kind === 'wall') {
      start = p.clone().addScaledVector(n, -(cd.t + 1.4)); start.y -= b.height * 0.5;
      end = p.clone().addScaledVector(n, cd.t + 1.4); end.y -= b.height * 0.5;
    } else {
      start = p.clone().addScaledVector(n, -(cd.t + (n.y > 0 ? b.height + 0.6 : 0.6))); if (n.y < 0) start.y -= 0; 
      end = p.clone().addScaledVector(n, cd.t + (n.y > 0 ? 0.6 : b.height + 0.6));
      if (n.y > 0) { start = p.clone(); start.y = c.center.y - cd.t - b.height - 0.5; end = p.clone(); end.y = c.center.y + cd.t + 0.3; }
      else { start = p.clone(); start.y = c.center.y + cd.t + 0.6; end = p.clone(); end.y = c.center.y - cd.t - b.height - 0.3; }
    }
    if (blocked(start) || blocked(end)) continue;
    // the straight line between must be blocked only by this collider (no other stuff in the way)
    res.tried++;
    for (const v of speeds) {
      b.pos.copy(start); b.vel.copy(n).multiplyScalar(v); b.magOn = false; b.grapple = null; b.mantle = null;
      me.prevPos && me.prevPos.copy(b.pos);
      let died = false, teleported = false; let prevSide = null, crossInside = false, moved = 0; const p0 = b.pos.clone(); globalThis.__mgTrace = [];
      const inv = c.rot.clone().invert();
      for (let s = 0; s < 40; s++) {
        const before = b.pos.clone(); before.y += b.height * 0.5;
        me.health = Math.max(me.health, 90); if (me.armor !== undefined) me.armor = Math.max(me.armor, 50);
        g.fixedStep(1 / 60, s === 0);
        if (!me.alive) { died = true; break; }
        const mid0 = b.pos.clone(); mid0.y += b.height * 0.5;
        if (mid0.distanceTo(before) > v / 60 + 0.6) { teleported = true; break; }
        const s0 = before.clone().sub(c.center).dot(n), s1 = mid0.clone().sub(c.center).dot(n);
        if (globalThis.__mgTrace) globalThis.__mgTrace.push([s, +mid0.x.toFixed(2), +mid0.y.toFixed(2), +mid0.z.toFixed(2), +s1.toFixed(2), b.grounded, !!b.mantle, b.stance, +b.height.toFixed(2)]);
        if (s0 <= 0 && s1 > 0) { // crossed the collider's mid-plane: inside its face area?
          const t = s0 / (s0 - s1); const x = before.clone().lerp(mid0, t).sub(c.center).applyQuaternion(inv);
          const hh = [c.half.x, c.half.y, c.half.z]; let inside = true; for (let k = 0; k < 3; k++) if (k !== ti && Math.abs(x.getComponent(k)) > hh[k] - 0.05) inside = false;
          if (inside) crossInside = true;
        }
      }
      moved = b.pos.distanceTo(p0);
      if (died || teleported) { res.invalid = (res.invalid ?? 0) + 1; if (!me.alive) g.respawn(me); continue; }
      const mid = b.pos.clone(); mid.y += b.height * 0.5;
      const side = mid.clone().sub(c.center).dot(n);
      const key = cd.kind + '@' + v; const e = res.byKind[key] ?? (res.byKind[key] = { n: 0, through: 0, around: 0, still: 0 }); e.n++;
      if (moved < 0.3) e.still++;
      if (side > 0 && !crossInside) e.around++;
      if (side > 0 && crossInside) { e.through++; if (res.fails.length < 25) res.fails.push({ trace: globalThis.__mgTrace.slice(0, 14), start: [start.x, start.y, start.z].map((x) => +x.toFixed(2)), kind: cd.kind, v, c: [c.center.x, c.center.y, c.center.z].map((x) => +x.toFixed(1)), half: h.map((x) => +x.toFixed(2)), dir: [n.x, n.y, n.z].map((x) => +x.toFixed(2)), tag: c.tag, metal: c.metal }); }
    }
  }
  return res;
}, N);
console.log(MODE, 'tried', r.tried, 'invalid', r.invalid, JSON.stringify(r.byKind));
for (const f of r.fails) console.log('  THROUGH', JSON.stringify(f));
await browser.close();
