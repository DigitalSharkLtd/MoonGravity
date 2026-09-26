import * as THREE from 'three';
import type { PbrSet } from '../render/TextureGen';
import { Rng } from '../core/Rng';

/**
 * Extra procedural PBR sets for the architectural kit (kept out of TextureGen.ts):
 * 3D-printed sintered regolith, interior floor tiles, warm composite wood panels,
 * regolith-filled barrier mesh (Hesco) and sandbags. Seamless tiles; ORM = (AO, rough, metal).
 */

const SIZE = 256;
const cache = new Map<string, PbrSet>();

class F {
  h: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  ao: Float32Array;
  rough: Float32Array;
  metal: Float32Array;
  constructor(public w: number) {
    const n = w * w;
    this.h = new Float32Array(n).fill(0.5);
    this.r = new Float32Array(n).fill(1);
    this.g = new Float32Array(n).fill(1);
    this.b = new Float32Array(n).fill(1);
    this.ao = new Float32Array(n).fill(1);
    this.rough = new Float32Array(n).fill(0.8);
    this.metal = new Float32Array(n);
  }
  at(x: number, y: number): number {
    const w = this.w;
    return (((y % w) + w) % w) * w + (((x % w) + w) % w);
  }
}

/** tileable value noise, period p (in lattice cells) */
function vnoise(x: number, y: number, p: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const hsh = (i: number, j: number) => {
    i = ((i % p) + p) % p;
    j = ((j % p) + p) % p;
    let t = (i * 374761393 + j * 668265263 + seed * 1442695041) | 0;
    t = Math.imul(t ^ (t >>> 13), 1274126177);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hsh(xi, yi);
  const b = hsh(xi + 1, yi);
  const c = hsh(xi, yi + 1);
  const d = hsh(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x: number, y: number, W: number, cells: number, oct: number, seed: number): number {
  let s = 0;
  let amp = 0.5;
  let f = cells;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise((x / W) * f, (y / W) * f, f, seed + o * 17);
    amp *= 0.5;
    f *= 2;
  }
  return s;
}

function finish(f: F, strength: number, key: string): PbrSet {
  const w = f.w;
  const n = w * w;
  const alb = new Uint8Array(n * 4);
  const nrm = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  const c8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      alb[i * 4] = c8(f.r[i]);
      alb[i * 4 + 1] = c8(f.g[i]);
      alb[i * 4 + 2] = c8(f.b[i]);
      alb[i * 4 + 3] = 255;
      const dx = f.h[f.at(x + 1, y)] - f.h[f.at(x - 1, y)];
      const dy = f.h[f.at(x, y + 1)] - f.h[f.at(x, y - 1)];
      let nx = -dx * strength;
      let ny = -dy * strength;
      const l = Math.hypot(nx, ny, 1);
      nx /= l;
      ny /= l;
      nrm[i * 4] = c8(nx * 0.5 + 0.5);
      nrm[i * 4 + 1] = c8(ny * 0.5 + 0.5);
      nrm[i * 4 + 2] = c8(1 / l * 0.5 + 0.5);
      nrm[i * 4 + 3] = 255;
      orm[i * 4] = c8(f.ao[i]);
      orm[i * 4 + 1] = c8(f.rough[i]);
      orm[i * 4 + 2] = c8(f.metal[i]);
      orm[i * 4 + 3] = 255;
    }
  }
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, w, w, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const set: PbrSet = { map: mk(alb, true), normalMap: mk(nrm, false), orm: mk(orm, false) };
  cache.set(key, set);
  return set;
}

/**
 * 3D-printed sintered regolith (ESA/Foster style): horizontal extrusion layers, print-segment joints,
 * pitted grain. `cells` adds the closed-cell (foam-like) pattern of a printed shell.
 */
export function printedSet(seed = 1, cells = false): PbrSet {
  const key = 'printed|' + seed + '|' + cells;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new F(W);
  const layer = 8; // px per extrusion layer (~6 cm at 2 m / tile)
  const seg = W / 2;
  const rng = new Rng(seed * 11 + 3);
  const pts: [number, number][] = [];
  if (cells) for (let i = 0; i < 26; i++) pts.push([rng.next() * W, rng.next() * W]);
  for (let y = 0; y < W; y++) {
    const li = Math.floor(y / layer);
    const ly = (y % layer) / layer;
    const bead = Math.sin(ly * Math.PI); // rounded bead profile
    const layerTone = vnoise(li * 0.7, 3.3, Math.floor(W / layer * 0.7) || 1, seed) * 0.03;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = fbm(x, y, W, 8, 4, seed);
      const pit = vnoise((x / W) * 64, (y / W) * 64, 64, seed + 9) > 0.72 ? -0.05 : 0;
      // print segment joint (vertical seam, staggered per band of 8 layers)
      const band = Math.floor(li / 8);
      const jx = (x + (band % 2) * seg * 0.5) % seg;
      const joint = jx < 2 ? -0.08 : 0;
      let h = 0.45 + bead * 0.07 + n * 0.035 + pit + joint;
      let a = 0.8 + bead * 0.07 + n * 0.08 + layerTone;
      if (cells) {
        // distance to nearest two feature points (tileable) → cell walls
        let d1 = 1e9;
        let d2 = 1e9;
        for (const [px, py] of pts) {
          let dx = Math.abs(x - px);
          let dy = Math.abs(y - py);
          if (dx > W / 2) dx = W - dx;
          if (dy > W / 2) dy = W - dy;
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
          } else if (d < d2) d2 = d;
        }
        const edge = Math.sqrt(d2) - Math.sqrt(d1);
        const wall = 1 - Math.min(1, edge / 6);
        h += wall * 0.18 - 0.06;
        a *= 0.9 + wall * 0.14;
      }
      f.h[i] = h;
      f.r[i] = a * 1.03;
      f.g[i] = a;
      f.b[i] = a * 0.94;
      f.rough[i] = 0.93 - bead * 0.05;
      f.metal[i] = 0;
      f.ao[i] = 0.72 + bead * 0.28 + joint * 2;
    }
  }
  return finish(f, 5, key);
}

/** Interior floor tiles (50 cm) with grout, subtle per-tile tone and polish. */
export function tileSet(seed = 2): PbrSet {
  const key = 'tile|' + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new F(W);
  const t = W / 4;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const tx = Math.floor(x / t);
      const ty = Math.floor(y / t);
      const lx = x % t;
      const ly = y % t;
      const grout = lx < 2 || ly < 2;
      const edge = Math.min(lx, ly, t - lx, t - ly);
      const tone = vnoise(tx * 1.7 + 0.3, ty * 1.3 + 0.7, 16, seed) * 0.05;
      const n = fbm(x, y, W, 6, 3, seed + 1);
      f.h[i] = grout ? 0.35 : 0.5 + Math.min(1, edge / 4) * 0.03;
      const a = grout ? 0.45 : 0.86 + tone + n * 0.03;
      f.r[i] = a;
      f.g[i] = a * 0.98;
      f.b[i] = a * 0.94;
      f.rough[i] = grout ? 0.9 : 0.35 + n * 0.1;
      f.metal[i] = 0;
      f.ao[i] = grout ? 0.55 : 1;
    }
  }
  return finish(f, 4, key);
}

/** Warm composite / bamboo panelling (hydroponic-grown) for lived-in interiors. */
export function woodSet(seed = 3): PbrSet {
  const key = 'wood|' + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new F(W);
  const plank = W / 8;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const p = Math.floor(x / plank);
      const lx = x % plank;
      const off = vnoise(p * 3.1, 0.5, 8, seed) * W;
      const grain = Math.sin(((y + off) / W) * Math.PI * 2 * 3 + fbm(x * 4, y, W, 4, 3, seed + p) * 6) * 0.5 + 0.5;
      const seam = lx < 2 ? 1 : 0;
      const tone = vnoise(p * 1.7, 0.2, 8, seed + 5) * 0.08;
      f.h[i] = seam ? 0.38 : 0.5 + grain * 0.015;
      const a = seam ? 0.5 : 0.78 + grain * 0.12 + tone;
      f.r[i] = a;
      f.g[i] = a * 0.9;
      f.b[i] = a * 0.8;
      f.rough[i] = 0.55 - grain * 0.1;
      f.metal[i] = 0;
      f.ao[i] = seam ? 0.6 : 1;
    }
  }
  return finish(f, 3, key);
}

/** Regolith-filled wire-mesh barrier baskets (Hesco-like): welded mesh over lumpy fill. */
export function meshBasketSet(seed = 4): PbrSet {
  const key = 'hesco|' + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new F(W);
  const cell = W / 16;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const wire = x % cell < 2 || y % cell < 2;
      const lump = fbm(x, y, W, 10, 3, seed);
      const bulge = Math.sin(((x % cell) / cell) * Math.PI) * Math.sin(((y % cell) / cell) * Math.PI);
      f.h[i] = wire ? 0.62 : 0.45 + bulge * 0.05 + lump * 0.06;
      if (wire) {
        f.r[i] = 0.62;
        f.g[i] = 0.64;
        f.b[i] = 0.66;
        f.metal[i] = 0.9;
        f.rough[i] = 0.4;
      } else {
        const a = 0.72 + lump * 0.14;
        f.r[i] = a * 1.04;
        f.g[i] = a;
        f.b[i] = a * 0.9;
        f.metal[i] = 0;
        f.rough[i] = 0.95;
      }
      f.ao[i] = wire ? 1 : 0.75 + bulge * 0.25;
    }
  }
  return finish(f, 4, key);
}

/** Stacked regolith sandbags (running bond of rounded bags). */
export function sandbagSet(seed = 5): PbrSet {
  const key = 'sandbag|' + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new F(W);
  const bh = W / 8;
  const bw = W / 3;
  for (let y = 0; y < W; y++) {
    const row = Math.floor(y / bh);
    const ly = (y % bh) / bh;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lx = ((x + (row % 2) * bw * 0.5) % bw) / bw;
      const puff = Math.pow(Math.sin(lx * Math.PI), 0.35) * Math.pow(Math.sin(ly * Math.PI), 0.5);
      const n = fbm(x, y, W, 12, 3, seed);
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.006 : 0;
      f.h[i] = 0.3 + puff * 0.35 + n * 0.02 + weave;
      const a = 0.62 + puff * 0.22 + n * 0.06;
      f.r[i] = a * 1.05;
      f.g[i] = a;
      f.b[i] = a * 0.86;
      f.rough[i] = 0.92;
      f.metal[i] = 0;
      f.ao[i] = 0.45 + puff * 0.55;
    }
  }
  return finish(f, 6, key);
}
