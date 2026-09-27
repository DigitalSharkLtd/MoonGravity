import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { Noise } from '../core/Noise';

/**
 * Procedural PBR texture sets, generated once at startup (no external image assets).
 * Every set is a seamless tile: albedo (sRGB), normal (tangent space) and ORM
 * (R = ambient occlusion, G = roughness, B = metalness — the layout three.js expects).
 */

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  orm: THREE.Texture;
}

const cache = new Map<string, PbrSet>();
let SIZE = 512;
let ANISO = 8;

/** Returns true when the resolution changed (cached sets are dropped and regenerate on demand). */
export function setTextureQuality(size: number, aniso: number): boolean {
  if (size === SIZE && aniso === ANISO) return false;
  SIZE = size;
  ANISO = aniso;
  cache.clear();
  return true;
}

class Field {
  w: number;
  h: number;
  height: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  ao: Float32Array;
  rough: Float32Array;
  metal: Float32Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.height = new Float32Array(n).fill(0.5);
    this.r = new Float32Array(n).fill(1);
    this.g = new Float32Array(n).fill(1);
    this.b = new Float32Array(n).fill(1);
    this.ao = new Float32Array(n).fill(1);
    this.rough = new Float32Array(n).fill(0.5);
    this.metal = new Float32Array(n).fill(0);
  }
  idx(x: number, y: number): number {
    x = ((x % this.w) + this.w) % this.w;
    y = ((y % this.h) + this.h) % this.h;
    return y * this.w + x;
  }
}

/** grayscale canvas → Float32 0..1 */
function canvasField(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Float32Array {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  draw(c);
  const d = c.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = d[i * 4] / 255;
  return out;
}

function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[y * w + ((i + w) % w)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / k;
      acc += src[y * w + ((x + r + 1) % w)] - src[y * w + ((x - r + w) % w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += tmp[((i + h) % h) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / k;
      acc += tmp[((y + r + 1) % h) * w + x] - tmp[((y - r + h) % h) * w + x];
    }
  }
  return out;
}

function finish(f: Field, normalStrength: number, key: string): PbrSet {
  const { w, h } = f;
  const n = w * h;
  const alb = new Uint8Array(n * 4);
  const nrm = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      alb[i * 4] = Math.max(0, Math.min(255, f.r[i] * 255));
      alb[i * 4 + 1] = Math.max(0, Math.min(255, f.g[i] * 255));
      alb[i * 4 + 2] = Math.max(0, Math.min(255, f.b[i] * 255));
      alb[i * 4 + 3] = 255;
      // sobel normal (wrapping)
      const hL = f.height[f.idx(x - 1, y)];
      const hR = f.height[f.idx(x + 1, y)];
      const hU = f.height[f.idx(x, y - 1)];
      const hD = f.height[f.idx(x, y + 1)];
      const hUL = f.height[f.idx(x - 1, y - 1)];
      const hUR = f.height[f.idx(x + 1, y - 1)];
      const hDL = f.height[f.idx(x - 1, y + 1)];
      const hDR = f.height[f.idx(x + 1, y + 1)];
      const dx = (hR - hL) * 2 + (hUR - hUL) + (hDR - hDL);
      const dy = (hD - hU) * 2 + (hDL - hUL) + (hDR - hUR);
      let nx = -dx * normalStrength;
      let ny = -dy * normalStrength; // DataTexture row 0 = v 0, so +y index = +v
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      nrm[i * 4] = (nx * 0.5 + 0.5) * 255;
      nrm[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      nrm[i * 4 + 3] = 255;
      orm[i * 4] = Math.max(0, Math.min(255, f.ao[i] * 255));
      orm[i * 4 + 1] = Math.max(0, Math.min(255, f.rough[i] * 255));
      orm[i * 4 + 2] = Math.max(0, Math.min(255, f.metal[i] * 255));
      orm[i * 4 + 3] = 255;
    }
  }
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = ANISO;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const set = { map: mk(alb, true), normalMap: mk(nrm, false), orm: mk(orm, false) };
  cache.set(key, set);
  return set;
}

function grain(f: Field, nz: Noise, amt: number, scale: number): void {
  const { w, h } = f;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // tileable noise via 4D-torus trick approximated with 3D wrapping on two circles
      const u = (x / w) * Math.PI * 2;
      const v = (y / h) * Math.PI * 2;
      const n = nz.noise3(Math.cos(u) * scale, Math.sin(u) * scale + Math.cos(v) * scale, Math.sin(v) * scale);
      f.height[i] += n * amt;
    }
  }
}

function tileNoise(nz: Noise, x: number, y: number, w: number, h: number, scale: number): number {
  const u = (x / w) * Math.PI * 2;
  const v = (y / h) * Math.PI * 2;
  return nz.noise3(Math.cos(u) * scale + 11, Math.sin(u) * scale + Math.cos(v) * scale, Math.sin(v) * scale - 7);
}

function tileFbm(nz: Noise, x: number, y: number, w: number, h: number, scale: number, oct: number): number {
  let s = 0;
  let a = 0.5;
  let f = scale;
  for (let o = 0; o < oct; o++) {
    s += a * tileNoise(nz, x, y, w, h, f);
    a *= 0.5;
    f *= 2;
  }
  return s;
}

// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function subdivide(r: Rect, rng: Rng, depth: number, out: Rect[], minSize: number): void {
  if (depth <= 0 || (r.w < minSize * 2 && r.h < minSize * 2) || (depth < 3 && rng.chance(0.25))) {
    out.push(r);
    return;
  }
  const vertical = r.w > r.h ? rng.chance(0.8) : rng.chance(0.2);
  if (vertical && r.w >= minSize * 2) {
    const s = Math.round((r.w * rng.pick([0.25, 0.5, 0.5, 0.75])) / 8) * 8;
    subdivide({ x: r.x, y: r.y, w: s, h: r.h }, rng, depth - 1, out, minSize);
    subdivide({ x: r.x + s, y: r.y, w: r.w - s, h: r.h }, rng, depth - 1, out, minSize);
  } else if (r.h >= minSize * 2) {
    const s = Math.round((r.h * rng.pick([0.25, 0.5, 0.5, 0.75])) / 8) * 8;
    subdivide({ x: r.x, y: r.y, w: r.w, h: s }, rng, depth - 1, out, minSize);
    subdivide({ x: r.x, y: r.y + s, w: r.w, h: r.h - s }, rng, depth - 1, out, minSize);
  } else out.push(r);
}

/**
 * Painted sci-fi hull plating: bevelled panels, seams, bolts, vents, stencils, dust and chipped edges.
 * Albedo is near-white so materials tint it with their base colour.
 */
export function panelSet(seed = 1, opts: { depth?: number; minSize?: number; wear?: number; stencil?: boolean } = {}): PbrSet {
  const key = 'panel|' + seed + '|' + JSON.stringify(opts) + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const H = SIZE;
  const f = new Field(W, H);
  const rng = new Rng(seed * 977 + 13);
  const nz = new Noise(seed + 5);
  const rects: Rect[] = [];
  subdivide({ x: 0, y: 0, w: W, h: H }, rng, opts.depth ?? 4, rects, opts.minSize ?? W / 8);
  const wear = opts.wear ?? 1;
  const seam = Math.max(2, Math.round(W / 170));

  // per-panel height/tone via canvas
  const heightC = canvasField(W, H, (c) => {
    c.fillStyle = 'rgb(70,70,70)';
    c.fillRect(0, 0, W, H);
    for (const r of rects) {
      const v = 150 + Math.floor(rng.next() * 30);
      // bevel: draw concentric rects getting brighter toward the inside
      for (let k = 0; k < 5; k++) {
        const t = k / 4;
        const cv = Math.round(95 + (v - 95) * t);
        c.fillStyle = `rgb(${cv},${cv},${cv})`;
        c.fillRect(r.x + seam + k, r.y + seam + k, r.w - 2 * (seam + k), r.h - 2 * (seam + k));
      }
      const kind = rng.next();
      const inner = { x: r.x + seam + 6, y: r.y + seam + 6, w: r.w - 2 * seam - 12, h: r.h - 2 * seam - 12 };
      if (inner.w < 20 || inner.h < 20) continue;
      if (kind < 0.18) {
        // vent slats
        const n = Math.max(3, Math.floor(inner.h / 12));
        const vx = inner.x + inner.w * 0.15;
        const vw = inner.w * 0.7;
        for (let i = 0; i < n; i++) {
          c.fillStyle = 'rgb(60,60,60)';
          c.fillRect(vx, inner.y + (i + 0.3) * (inner.h / n), vw, (inner.h / n) * 0.45);
        }
      } else if (kind < 0.33) {
        // recessed hatch with handle
        c.fillStyle = `rgb(${v - 40},${v - 40},${v - 40})`;
        c.fillRect(inner.x + inner.w * 0.2, inner.y + inner.h * 0.2, inner.w * 0.6, inner.h * 0.6);
        c.fillStyle = `rgb(${v - 10},${v - 10},${v - 10})`;
        c.fillRect(inner.x + inner.w * 0.23, inner.y + inner.h * 0.23, inner.w * 0.54, inner.h * 0.54);
        c.fillStyle = 'rgb(230,230,230)';
        c.fillRect(inner.x + inner.w * 0.42, inner.y + inner.h * 0.45, inner.w * 0.16, inner.h * 0.08);
      } else if (kind < 0.45) {
        // raised greeble blocks
        for (let i = 0; i < 3; i++) {
          const gw = inner.w * rng.range(0.15, 0.35);
          const gh = inner.h * rng.range(0.1, 0.3);
          c.fillStyle = `rgb(${v + 30},${v + 30},${v + 30})`;
          c.fillRect(inner.x + rng.next() * (inner.w - gw), inner.y + rng.next() * (inner.h - gh), gw, gh);
        }
      } else if (kind < 0.55) {
        // horizontal groove lines
        const n = 2 + Math.floor(rng.next() * 3);
        for (let i = 1; i <= n; i++) {
          c.fillStyle = 'rgb(90,90,90)';
          c.fillRect(inner.x, inner.y + (i * inner.h) / (n + 1), inner.w, 2);
        }
      }
      // bolts in corners
      if (r.w > W / 10 && r.h > H / 10) {
        const bo = seam + 7;
        for (const [bx, by] of [
          [r.x + bo, r.y + bo],
          [r.x + r.w - bo, r.y + bo],
          [r.x + bo, r.y + r.h - bo],
          [r.x + r.w - bo, r.y + r.h - bo],
        ]) {
          const g = c.createRadialGradient(bx, by, 0, bx, by, 3.2);
          g.addColorStop(0, 'rgb(255,255,255)');
          g.addColorStop(1, `rgb(${v - 30},${v - 30},${v - 30})`);
          c.fillStyle = g;
          c.beginPath();
          c.arc(bx, by, 3.2, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
  });
  const soft = blur(heightC, W, H, 1);
  for (let i = 0; i < W * H; i++) f.height[i] = soft[i];
  grain(f, nz, 0.006, 6);

  // cavity (AO) from blurred height
  const bl = blur(f.height, W, H, 4);
  // stencils (albedo only)
  const stencil = opts.stencil !== false
    ? canvasField(W, H, (c) => {
        c.fillStyle = '#000';
        c.fillRect(0, 0, W, H);
        c.fillStyle = '#fff';
        c.font = `bold ${Math.round(W / 22)}px "Russo One", "Arial Black", sans-serif`;
        const labels = ['PD-46', 'A-07', 'B-12', 'MG', 'O₂', 'HV', 'SEC-3', '46'];
        for (const r of rects) {
          if (r.w < W / 5 || r.h < H / 7 || !rng.chance(0.28)) continue;
          c.fillText(rng.pick(labels), r.x + seam + 10, r.y + r.h - seam - 12);
        }
        // warning chevrons strip
        for (const r of rects) {
          if (r.h < H / 6 || r.w < W / 4 || !rng.chance(0.12)) continue;
          const y = r.y + seam + 8;
          for (let x = r.x + seam + 8; x < r.x + r.w - seam - 20; x += 16) {
            c.beginPath();
            c.moveTo(x, y);
            c.lineTo(x + 8, y);
            c.lineTo(x + 14, y + 6);
            c.lineTo(x + 8, y + 12);
            c.lineTo(x, y + 12);
            c.lineTo(x + 6, y + 6);
            c.closePath();
            c.fill();
          }
        }
      })
    : new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const hgt = f.height[i];
      const cav = Math.max(0, bl[i] - hgt); // positive in seams
      const edge = Math.max(0, hgt - bl[i]); // positive on raised edges
      const dust = tileFbm(nz, x, y, W, H, 2.5, 4) * 0.5 + 0.5;
      const chipN = tileNoise(nz, x * 3.1, y * 3.1, W * 3.1, H * 3.1, 14);
      const chip = wear > 0 && edge > 0.012 && chipN > 0.25 - wear * 0.1 ? 1 : 0;
      const tone = 0.9 + (hgt - 0.55) * 0.35;
      let a = Math.min(1, tone) * (1 - cav * 3.2);
      a *= 1 - dust * 0.08 * wear;
      a *= 1 - stencil[i] * 0.55;
      f.r[i] = f.g[i] = f.b[i] = a;
      if (chip) {
        // exposed bare aluminium
        f.r[i] = 0.72;
        f.g[i] = 0.74;
        f.b[i] = 0.78;
        f.metal[i] = 0.85;
        f.rough[i] = 0.32;
      } else {
        f.metal[i] = 0.08;
        f.rough[i] = 0.42 + dust * 0.22 * wear + cav * 2 + stencil[i] * 0.1;
      }
      f.ao[i] = Math.max(0.35, 1 - cav * 7);
    }
  }
  return finish(f, 2.4, key);
}

/** Diamond tread plate (floors, platforms, bridge decks). */
export function treadSet(seed = 3): PbrSet {
  const key = 'tread|' + seed + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const nz = new Noise(seed);
  const cell = W / 16;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const row = Math.floor(y / cell);
      const ox = (row % 2) * cell * 0.5;
      const lx = ((x + ox) % cell) / cell - 0.5;
      const ly = (y % cell) / cell - 0.5;
      // rotated elongated diamond (alternating orientation)
      const flip = (Math.floor((x + ox) / cell) + row) % 2 ? 1 : -1;
      const u = (lx + ly * flip) * 0.707;
      const v = (lx - ly * flip) * 0.707;
      const d = Math.abs(u) / 0.36 + Math.abs(v) / 0.09;
      const bump = d < 1 ? Math.sqrt(1 - d) : 0;
      f.height[i] = 0.5 + bump * 0.08;
      const scratch = Math.abs(tileNoise(nz, x * 0.3, y * 6, W * 0.3, W * 6, 20));
      const n = tileFbm(nz, x, y, W, W, 3, 3);
      const base = 0.62 + n * 0.08;
      f.r[i] = base;
      f.g[i] = base * 1.01;
      f.b[i] = base * 1.04;
      f.metal[i] = 0.92;
      f.rough[i] = 0.38 + n * 0.15 + (scratch < 0.05 ? -0.12 : 0) - bump * 0.1;
      f.ao[i] = 1;
    }
  }
  const bl = blur(f.height, W, W, 3);
  for (let i = 0; i < W * W; i++) f.ao[i] = Math.max(0.5, 1 - Math.max(0, bl[i] - f.height[i]) * 12);
  return finish(f, 3, key);
}

/** Corrugated cargo container sides with chipped paint and stencils. */
export function corrugatedSet(seed = 4): PbrSet {
  const key = 'corr|' + seed + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const nz = new Noise(seed);
  const period = W / 8;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const p = (x % period) / period;
      // trapezoid rib profile
      const rib = p < 0.15 ? p / 0.15 : p < 0.5 ? 1 : p < 0.65 ? 1 - (p - 0.5) / 0.15 : 0;
      f.height[i] = 0.4 + rib * 0.2;
      const n = tileFbm(nz, x, y, W, W, 2, 4);
      const chip = tileNoise(nz, x * 2, y * 2, W * 2, W * 2, 16) > 0.42 ? 1 : 0;
      const a = 0.92 + n * 0.08 - (1 - rib) * 0.06;
      if (chip) {
        f.r[i] = 0.55;
        f.g[i] = 0.56;
        f.b[i] = 0.58;
        f.metal[i] = 0.8;
        f.rough[i] = 0.4;
      } else {
        f.r[i] = f.g[i] = f.b[i] = a;
        f.metal[i] = 0.1;
        f.rough[i] = 0.55 + n * 0.2;
      }
      f.ao[i] = 0.75 + rib * 0.25;
    }
  }
  return finish(f, 3.2, key);
}

/** Crinkled gold MLI foil (lander descent stages, satellites). */
export function foilSet(seed = 6): PbrSet {
  const key = 'foil|' + seed + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const rng = new Rng(seed);
  const cells = 90;
  const pts: { x: number; y: number; ax: number; ay: number; tone: number }[] = [];
  for (let i = 0; i < cells; i++) pts.push({ x: rng.next() * W, y: rng.next() * W, ax: rng.range(-1, 1), ay: rng.range(-1, 1), tone: rng.range(0.85, 1.1) });
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let best = Infinity;
      let second = Infinity;
      let bp = pts[0];
      for (const p of pts) {
        let dx = Math.abs(x - p.x);
        let dy = Math.abs(y - p.y);
        if (dx > W / 2) dx = W - dx;
        if (dy > W / 2) dy = W - dy;
        const d = dx * dx + dy * dy;
        if (d < best) {
          second = best;
          best = d;
          bp = p;
        } else if (d < second) second = d;
      }
      const i = y * W + x;
      // each facet is a tilted plane → faceted crinkles
      f.height[i] = 0.5 + ((x - bp.x) * bp.ax + (y - bp.y) * bp.ay) * 0.0022;
      const crease = Math.sqrt(second) - Math.sqrt(best) < 1.5 ? 1 : 0;
      f.r[i] = 0.98 * bp.tone;
      f.g[i] = 0.74 * bp.tone;
      f.b[i] = 0.3 * bp.tone;
      f.metal[i] = 1;
      f.rough[i] = 0.18 + crease * 0.25 + (bp.tone - 0.85) * 0.3;
      f.ao[i] = crease ? 0.7 : 1;
    }
  }
  return finish(f, 2.2, key);
}

/** Photovoltaic cells with silver bus bars. */
export function solarSet(): PbrSet {
  const key = 'solar' + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const nz = new Noise(77);
  const cell = W / 8;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lx = x % cell;
      const ly = y % cell;
      const gap = lx < 3 || ly < 3;
      const bus = Math.abs(lx - cell * 0.33) < 1.2 || Math.abs(lx - cell * 0.66) < 1.2;
      const finger = ly % 6 < 1;
      const crystal = tileNoise(nz, x, y, W, W, 30) * 0.05;
      if (gap) {
        f.r[i] = 0.85;
        f.g[i] = 0.87;
        f.b[i] = 0.9;
        f.rough[i] = 0.4;
        f.metal[i] = 0.2;
        f.height[i] = 0.45;
      } else if (bus || finger) {
        f.r[i] = 0.78;
        f.g[i] = 0.8;
        f.b[i] = 0.84;
        f.rough[i] = 0.25;
        f.metal[i] = 1;
        f.height[i] = 0.53;
      } else {
        f.r[i] = 0.07 + crystal;
        f.g[i] = 0.13 + crystal;
        f.b[i] = 0.38 + crystal * 2;
        f.rough[i] = 0.1;
        f.metal[i] = 0.3;
        f.height[i] = 0.5;
      }
    }
  }
  return finish(f, 2, key);
}

/** Yellow/black hazard stripes with scuffs. */
export function hazardSet(): PbrSet {
  const key = 'hazard' + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const nz = new Noise(21);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const s = ((x + y) / (W / 4)) % 1 < 0.5;
      const scuff = tileFbm(nz, x, y, W, W, 4, 4);
      const chip = tileNoise(nz, x * 2, y * 2, W * 2, W * 2, 20) > 0.45;
      if (chip) {
        f.r[i] = 0.6;
        f.g[i] = 0.61;
        f.b[i] = 0.63;
        f.metal[i] = 0.8;
        f.rough[i] = 0.35;
      } else if (s) {
        f.r[i] = 1;
        f.g[i] = 0.74;
        f.b[i] = 0.06;
        f.rough[i] = 0.5 + scuff * 0.2;
      } else {
        f.r[i] = 0.07;
        f.g[i] = 0.07;
        f.b[i] = 0.08;
        f.rough[i] = 0.55 + scuff * 0.2;
      }
      f.r[i] *= 0.9 + scuff * 0.1;
      f.g[i] *= 0.9 + scuff * 0.1;
      f.b[i] *= 0.9 + scuff * 0.1;
      f.height[i] = 0.5 + scuff * 0.01 + (chip ? -0.01 : 0);
    }
  }
  return finish(f, 2, key);
}

/** Quilted spacesuit fabric (Beta cloth) with stitched seams and weave micro-detail. */
export function fabricSet(): PbrSet {
  const key = 'fabric' + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const nz = new Noise(31);
  const q = W / 4;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lx = (x % q) / q;
      const ly = (y % (q * 0.5)) / (q * 0.5);
      const puff = Math.sin(lx * Math.PI) * 0.6 + Math.sin(ly * Math.PI) * 0.4;
      const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.004 : -0.004;
      const stitch = (ly < 0.04 || ly > 0.96) && x % 6 < 3 ? -0.03 : 0;
      const n = tileFbm(nz, x, y, W, W, 5, 3);
      f.height[i] = 0.45 + puff * 0.05 + weave + stitch + n * 0.01;
      const a = 0.93 + n * 0.04 + puff * 0.03;
      f.r[i] = a;
      f.g[i] = a;
      f.b[i] = a * 0.99;
      f.rough[i] = 0.78 - puff * 0.08;
      f.metal[i] = 0;
      f.ao[i] = 0.8 + puff * 0.2;
    }
  }
  return finish(f, 3, key);
}

/** Rough lunar rock (boulders). */
export function rockSet(seed = 9): PbrSet {
  const key = 'rock|' + seed + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const nz = new Noise(seed);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = tileFbm(nz, x, y, W, W, 3, 6);
      const r = Math.abs(tileNoise(nz, x, y, W, W, 7));
      const vesicle = tileNoise(nz, x * 3, y * 3, W * 3, W * 3, 40) > 0.55 ? -0.04 : 0;
      f.height[i] = 0.5 + n * 0.12 + (r < 0.06 ? -0.03 : 0) + vesicle;
      const a = 0.62 + n * 0.25 + (tileNoise(nz, x * 4, y * 4, W * 4, W * 4, 60) > 0.6 ? 0.12 : 0);
      f.r[i] = a;
      f.g[i] = a * 0.98;
      f.b[i] = a * 0.95;
      f.rough[i] = 0.9;
      f.metal[i] = 0;
      f.ao[i] = 1;
    }
  }
  const bl = blur(f.height, W, W, 3);
  for (let i = 0; i < W * W; i++) f.ao[i] = Math.max(0.5, 1 - Math.max(0, bl[i] - f.height[i]) * 6);
  return finish(f, 4, key);
}

/** Regolith detail tile for the terrain: grain, pebbles, micro craters. */
export function regolithSet(seed = 12): PbrSet {
  const key = 'regolith|' + seed + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const nz = new Noise(seed);
  const rng = new Rng(seed);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = tileFbm(nz, x, y, W, W, 4, 6);
      f.height[i] = 0.5 + n * 0.05;
      const a = 0.9 + n * 0.18 + tileNoise(nz, x * 5, y * 5, W * 5, W * 5, 90) * 0.05;
      f.r[i] = a;
      f.g[i] = a;
      f.b[i] = a;
      f.rough[i] = 0.95;
      f.metal[i] = 0;
    }
  }
  // micro craters
  for (let k = 0; k < 60; k++) {
    const cx = rng.next() * W;
    const cy = rng.next() * W;
    const r = 4 + Math.pow(rng.next(), 3) * 40;
    const R = Math.ceil(r * 1.7);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1.7) continue;
        const i = f.idx(Math.floor(cx + dx), Math.floor(cy + dy));
        const hh = d < 1 ? (d * d - 1) * 0.5 + 0.15 : 0.15 * Math.pow(1 - (d - 1) / 0.7, 2);
        f.height[i] += hh * r * 0.004;
        if (d > 0.85 && d < 1.2) {
          f.r[i] *= 1.06;
          f.g[i] *= 1.06;
          f.b[i] *= 1.06;
        }
      }
    }
  }
  // pebbles
  for (let k = 0; k < 260; k++) {
    const cx = rng.next() * W;
    const cy = rng.next() * W;
    const r = 1.5 + Math.pow(rng.next(), 2) * 5;
    const tone = rng.range(0.7, 1.15);
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1) continue;
        const i = f.idx(Math.floor(cx + dx), Math.floor(cy + dy));
        f.height[i] += Math.sqrt(1 - d * d) * r * 0.006;
        f.r[i] *= tone;
        f.g[i] *= tone;
        f.b[i] *= tone;
      }
    }
  }
  const bl = blur(f.height, W, W, 2);
  for (let i = 0; i < W * W; i++) f.ao[i] = Math.max(0.6, 1 - Math.max(0, bl[i] - f.height[i]) * 10);
  return finish(f, 5, key);
}

/** Sintered-regolith concrete blocks (bunkers, pads, berms). */
export function concreteSet(seed = 15): PbrSet {
  const key = 'concrete|' + seed + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const nz = new Noise(seed);
  const bw = W / 2;
  const bh = W / 4;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const row = Math.floor(y / bh);
      const ox = (row % 2) * bw * 0.5;
      const lx = (x + ox) % bw;
      const ly = y % bh;
      const joint = lx < 3 || ly < 3;
      const n = tileFbm(nz, x, y, W, W, 4, 5);
      const pit = tileNoise(nz, x * 4, y * 4, W * 4, W * 4, 70) > 0.6 ? -0.02 : 0;
      f.height[i] = (joint ? 0.42 : 0.5) + n * 0.03 + pit;
      const a = (joint ? 0.55 : 0.78) + n * 0.12;
      f.r[i] = a * 1.02;
      f.g[i] = a;
      f.b[i] = a * 0.96;
      f.rough[i] = 0.88;
      f.metal[i] = 0;
      f.ao[i] = joint ? 0.6 : 1;
    }
  }
  return finish(f, 3, key);
}

/** Brushed/scratched metal for pipes, rails, gun metal. */
export function brushedSet(seed = 18): PbrSet {
  const key = 'brushed|' + seed + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const nz = new Noise(seed);
  const rng = new Rng(seed);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const streak = tileNoise(nz, x * 0.05, y * 4, W * 0.05, W * 4, 30);
      const n = tileFbm(nz, x, y, W, W, 3, 3);
      f.height[i] = 0.5 + streak * 0.004;
      const a = 0.8 + streak * 0.05 + n * 0.05;
      f.r[i] = a;
      f.g[i] = a;
      f.b[i] = a * 1.02;
      f.rough[i] = 0.32 + streak * 0.08 + n * 0.12;
      f.metal[i] = 1;
      f.ao[i] = 1;
    }
  }
  // random scratches
  for (let k = 0; k < 90; k++) {
    let x = rng.next() * W;
    let y = rng.next() * W;
    const a = rng.next() * Math.PI;
    const len = 10 + rng.next() * 80;
    for (let s = 0; s < len; s++) {
      const i = f.idx(Math.floor(x), Math.floor(y));
      f.height[i] -= 0.01;
      f.rough[i] = 0.2;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  return finish(f, 1.5, key);
}

/**
 * Clean painted hard-shell armour (hero plates): faint mottling, soft roughness breakup and fine
 * scratches — the plate geometry carries the panel detail, the texture only keeps it from reading
 * as plastic. Albedo is near-white so vertex colours / material colour tint it.
 */
export function paintSet(seed = 41): PbrSet {
  const key = 'paint|' + seed + SIZE;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = SIZE;
  const f = new Field(W, W);
  const nz = new Noise(seed);
  const rng = new Rng(seed * 31 + 7);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = tileFbm(nz, x, y, W, W, 2.5, 4);
      const fine = tileNoise(nz, x, y, W, W, 40);
      f.height[i] = 0.5 + fine * 0.0015 + n * 0.004;
      const a = 0.95 + n * 0.035 + fine * 0.008;
      f.r[i] = a;
      f.g[i] = a;
      f.b[i] = a;
      f.rough[i] = 0.4 + n * 0.1 + fine * 0.03;
      f.metal[i] = 0.05;
      f.ao[i] = 1;
    }
  }
  // fine scuffs: lighter, glossier hairlines
  for (let k = 0; k < 140; k++) {
    let x = rng.next() * W;
    let y = rng.next() * W;
    const a = rng.next() * Math.PI;
    const len = 6 + rng.next() * 40;
    for (let s = 0; s < len; s++) {
      const i = f.idx(Math.floor(x), Math.floor(y));
      f.height[i] -= 0.004;
      f.rough[i] = 0.3;
      f.r[i] = f.g[i] = f.b[i] = Math.min(1, f.r[i] + 0.05);
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  return finish(f, 1.6, key);
}
