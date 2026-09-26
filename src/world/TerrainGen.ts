import { Heightfield } from './Heightfield';
import { MapDef, CraterDef } from './MapDefs';
import { Noise } from '../core/Noise';
import { Rng } from '../core/Rng';

export interface TerrainData {
  hf: Heightfield;
  /** per-vertex albedo multiplier (0..~1.3) */
  albedo: Float32Array;
  /** per-vertex tint shift toward warm (+) / cool (-) */
  tint: Float32Array;
  /** per-vertex ore glow (palladium veins in the mine walls) */
  ore: Float32Array;
  noise: Noise;
  craters: CraterDef[];
  /** smooth height function used for the distant ring terrain & margin blend */
  farHeight: (x: number, z: number) => number;
  mineTop: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Crater height offset. r normalized distance (d / R). */
export function craterProfile(r: number, depth: number, rim: number, peak: number): number {
  if (r >= 2.4) return 0;
  // parabolic bowl, flattened floor, sharp raised rim, exponential ejecta blanket
  let h: number;
  if (r < 1) {
    const bowl = rim + depth * (r * r - 1);
    const floor = rim - depth * 0.82;
    // smooth max between bowl and floor
    const k = depth * 0.15;
    const hmax = Math.max(bowl, floor);
    const d = Math.abs(bowl - floor);
    h = hmax + (d < k ? ((k - d) * (k - d)) / (4 * k) : 0);
  } else {
    const t = (r - 1) / 1.4;
    h = rim * Math.pow(1 - Math.min(1, t), 2.2) * Math.exp(-t * 1.5);
  }
  if (peak > 0) h += peak * Math.exp(-(r * r) / 0.03);
  // soften the rim crest
  return h;
}

export function generateTerrain(def: MapDef): TerrainData {
  const noise = new Noise(def.seed);
  const rng = new Rng(def.seed * 31 + 7);
  const ex = def.halfX + def.margin;
  const ez = def.halfZ + def.margin;
  const nx = Math.ceil((2 * ex) / def.cell) + 1;
  const nz = Math.ceil((2 * ez) / def.cell) + 1;
  const hf = new Heightfield(nx, nz, def.cell, -ex, -ez);
  const H = hf.data;
  const albedo = new Float32Array(nx * nz).fill(1);
  const tint = new Float32Array(nx * nz);
  const ore = new Float32Array(nx * nz);

  // --- distant/terrain frame function (mountain ring that encloses the arena) ---
  const farNoise = new Noise(def.seed + 99);
  const farHeight = (x: number, z: number): number => {
    const dx = Math.max(0, Math.abs(x) - def.halfX);
    const dz = Math.max(0, Math.abs(z) - def.halfZ);
    const out = Math.hypot(dx, dz); // distance outside the playable box
    // rounded, eroded lunar highlands (domain warped fbm, softened ridges)
    const wx = x + 90 * farNoise.fbm2(x / 700 + 3, z / 700, 2);
    const wz = z + 90 * farNoise.fbm2(x / 700, z / 700 - 3, 2);
    const r = 1 - Math.abs(farNoise.fbm2(wx / 420, wz / 420, 4));
    const ridge = r * r * (3 - 2 * r);
    const hills = farNoise.fbm2(wx / 260, wz / 260, 4) * 0.5 + 0.5;
    const rise = smooth(20, 900, out);
    const near = smooth(0, 90, out);
    return near * (5 + hills * 14 + ridge * 8) + rise * (ridge * 150 + hills * 70);
  };

  // --- base terrain ---
  for (let j = 0; j < nz; j++) {
    const z = hf.z0 + j * def.cell;
    for (let i = 0; i < nx; i++) {
      const x = hf.x0 + i * def.cell;
      let h = def.baseAmp * (noise.fbm2(x / 140, z / 140, 5) * 0.8 + (noise.ridged2(x / 95, z / 95, 4) - 0.35) * 0.9);
      h += def.detailAmp * noise.fbm2(x / 9, z / 9, 3);
      h += def.detailAmp * 0.35 * noise.noise2(x / 2.3, z / 2.3);
      H[j * nx + i] = h;
      // large-scale albedo: maria (darker) vs highland (lighter) patches
      albedo[j * nx + i] = 0.93 + 0.1 * noise.fbm2(x / 180 + 40, z / 180 - 11, 4) + 0.04 * noise.noise2(x / 23, z / 23);
      tint[j * nx + i] = noise.fbm2(x / 300 - 7, z / 300 + 3, 3);
    }
  }

  // --- craters (largest first so that smaller ones overprint) ---
  const craters: CraterDef[] = [...def.craters];
  const inFlat = (x: number, z: number, pad: number) =>
    def.flats.some((f) => Math.abs(x - f.x) < f.w + pad && Math.abs(z - f.z) < f.d + pad);
  let guard = 0;
  while (craters.length < def.craters.length + def.randomCraters && guard++ < 5000) {
    const u = rng.next();
    const r = 1.2 + (def.craterMaxR - 1.2) * Math.pow(u, 3.2);
    const x = rng.range(hf.x0 + 5, hf.x1 - 5);
    const z = rng.range(hf.z0 + 5, hf.z1 - 5);
    const md = Math.hypot(x - def.mine.x, z - def.mine.z);
    if (md < def.mine.r + r * 1.2) continue;
    if (inFlat(x, z, r * 1.3) && r > 2) continue;
    craters.push({ x, z, r, rays: r > 6 && rng.chance(0.25) });
  }
  craters.sort((a, b) => b.r - a.r);

  for (const c of craters) {
    const depth = (c.depth ?? 0.22) * c.r * (c.r > 20 ? 0.6 : 1);
    const rim = (c.rim ?? 0.06) * c.r;
    const peak = (c.peak ?? 0) * c.r;
    const R = c.r * 2.4;
    const i0 = Math.max(0, Math.floor((c.x - R - hf.x0) / def.cell));
    const i1 = Math.min(nx - 1, Math.ceil((c.x + R - hf.x0) / def.cell));
    const j0 = Math.max(0, Math.floor((c.z - R - hf.z0) / def.cell));
    const j1 = Math.min(nz - 1, Math.ceil((c.z + R - hf.z0) / def.cell));
    const phase = rng.next() * 100;
    const wob = 0.06 + 0.05 * rng.next();
    for (let j = j0; j <= j1; j++) {
      const z = hf.z0 + j * def.cell;
      for (let i = i0; i <= i1; i++) {
        const x = hf.x0 + i * def.cell;
        const dx = x - c.x;
        const dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const ang = Math.atan2(dz, dx);
        // irregular outline
        const irr = 1 + wob * noise.noise2(Math.cos(ang) * 1.7 + phase, Math.sin(ang) * 1.7 + phase);
        const r = d / (c.r * irr);
        if (r >= 2.4) continue;
        const k = j * nx + i;
        H[k] += craterProfile(r, depth, rim, peak);
        // albedo: dark bowl interior shading is done by lighting; brighten fresh rims/ejecta
        const young = c.r < 8 ? 1 : 0.5;
        if (r > 0.85 && r < 1.35) albedo[k] += 0.05 * young * (1 - Math.abs(r - 1.08) / 0.27);
        if (r < 0.9) albedo[k] -= 0.035 * young;
        if (c.rays && r > 0.9) {
          // bright ray system radiating from the crater
          const rays = Math.pow(Math.max(0, noise.noise2(Math.cos(ang) * 5 + phase, Math.sin(ang) * 5 - phase)), 2.2);
          const fall = Math.exp(-(r - 1) * 0.9);
          albedo[k] += rays * fall * 0.22;
        }
      }
    }
    // rays extend beyond the local window — apply a second, cheaper pass at larger radius
    if (c.rays) {
      const RR = c.r * 7;
      const a0 = Math.max(0, Math.floor((c.x - RR - hf.x0) / def.cell));
      const a1 = Math.min(nx - 1, Math.ceil((c.x + RR - hf.x0) / def.cell));
      const b0 = Math.max(0, Math.floor((c.z - RR - hf.z0) / def.cell));
      const b1 = Math.min(nz - 1, Math.ceil((c.z + RR - hf.z0) / def.cell));
      for (let j = b0; j <= b1; j++) {
        const z = hf.z0 + j * def.cell;
        for (let i = a0; i <= a1; i++) {
          const x = hf.x0 + i * def.cell;
          const d = Math.hypot(x - c.x, z - c.z) / c.r;
          if (d < 2.4 || d > 7) continue;
          const ang = Math.atan2(z - c.z, x - c.x);
          const rays = Math.pow(Math.max(0, noise.noise2(Math.cos(ang) * 5 + phase, Math.sin(ang) * 5 - phase)), 2.6);
          albedo[j * nx + i] += rays * Math.exp(-(d - 1) * 0.5) * 0.18;
        }
      }
    }
  }

  // --- flats for bases (blend toward a level pad) ---
  for (const f of def.flats) {
    const soft = f.soft ?? 8;
    const target = f.h ?? averageHeight(hf, f.x, f.z, Math.min(f.w, f.d)) + (f.offset ?? 0);
    f.h = target;
    const cr = Math.cos(-(f.rot ?? 0));
    const sr = Math.sin(-(f.rot ?? 0));
    const R = Math.hypot(f.w, f.d) + soft;
    const i0 = Math.max(0, Math.floor((f.x - R - hf.x0) / def.cell));
    const i1 = Math.min(nx - 1, Math.ceil((f.x + R - hf.x0) / def.cell));
    const j0 = Math.max(0, Math.floor((f.z - R - hf.z0) / def.cell));
    const j1 = Math.min(nz - 1, Math.ceil((f.z + R - hf.z0) / def.cell));
    for (let j = j0; j <= j1; j++) {
      const z = hf.z0 + j * def.cell;
      for (let i = i0; i <= i1; i++) {
        const x = hf.x0 + i * def.cell;
        const lx = (x - f.x) * cr - (z - f.z) * sr;
        const lz = (x - f.x) * sr + (z - f.z) * cr;
        const ox = Math.max(0, Math.abs(lx) - f.w);
        const oz = Math.max(0, Math.abs(lz) - f.d);
        const o = Math.hypot(ox, oz);
        const t = 1 - smooth(0, soft, o);
        if (t <= 0) continue;
        const k = j * nx + i;
        // keep a hint of micro detail on the pad
        const micro = def.detailAmp * 0.12 * noise.noise2(x / 1.7, z / 1.7);
        H[k] = H[k] * (1 - t) + (target + micro) * t;
        albedo[k] = albedo[k] * (1 - t * 0.5) + 0.97 * t * 0.5;
      }
    }
  }

  // --- the palladium open-pit mine ---
  const m = def.mine;
  const mineTop = averageHeight(hf, m.x, m.z, m.r * 1.1);
  {
    const R = m.r * 1.5;
    const i0 = Math.max(0, Math.floor((m.x - R - hf.x0) / def.cell));
    const i1 = Math.min(nx - 1, Math.ceil((m.x + R - hf.x0) / def.cell));
    const j0 = Math.max(0, Math.floor((m.z - R - hf.z0) / def.cell));
    const j1 = Math.min(nz - 1, Math.ceil((m.z + R - hf.z0) / def.cell));
    const benchH = m.depth / m.benches;
    for (let j = j0; j <= j1; j++) {
      const z = hf.z0 + j * def.cell;
      for (let i = i0; i <= i1; i++) {
        const x = hf.x0 + i * def.cell;
        const dx = x - m.x;
        const dz = z - m.z;
        const d = Math.hypot(dx, dz);
        const ang = Math.atan2(dz, dx);
        const k = j * nx + i;
        // slightly irregular benches
        const irr = 1 + 0.035 * noise.noise2(Math.cos(ang) * 2 + 3, Math.sin(ang) * 2 - 5);
        const dn = d / irr;
        if (dn > m.r * 1.45) continue;
        // spoil berm around the rim (not on levelled building pads)
        if (dn >= m.r) {
          const t = (dn - m.r) / (m.r * 0.45);
          const berm = 1.6 * Math.sin(Math.min(1, t) * Math.PI) * (0.7 + 0.3 * noise.noise2(x / 6, z / 6));
          H[k] += berm * (1 - smooth(0.6, 1, t)) * (1 - flatWeight(def, x, z));
          continue;
        }
        // stepped profile: t=0 at floor edge, 1 at the rim
        const t = Math.max(0, (dn - m.floorR) / (m.r - m.floorR));
        const s = t * m.benches;
        const step = Math.floor(s);
        const f = s - step;
        // bench (flat, 65%) + steep face (35%)
        const stepped = (step + smooth(0.62, 0.98, f)) / m.benches;
        let pit = mineTop - m.depth + stepped * m.depth;
        // ramps: linear slope, carved along given azimuths
        for (const ra of m.ramps) {
          let da = Math.abs(ang - ra);
          if (da > Math.PI) da = 2 * Math.PI - da;
          const wAng = 5.5 / Math.max(dn, 4); // ~5.5 m wide ramp
          if (da < wAng * 1.6) {
            const lin = mineTop - m.depth + t * m.depth;
            const w = 1 - smooth(wAng * 0.8, wAng * 1.6, da);
            pit = pit * (1 - w) + lin * w;
          }
        }
        // blend to surface at the rim
        const edge = smooth(m.r * 0.94, m.r, dn);
        const surf = H[k];
        let h = Math.min(surf, pit + def.detailAmp * 0.25 * noise.noise2(x / 3, z / 3));
        h = h * (1 - edge) + surf * edge;
        H[k] = h;
        // mined rock is darker, fresher & slightly warm, bench faces show ore veins
        albedo[k] = 0.88 + 0.05 * noise.noise2(x / 5, z / 5);
        tint[k] = 0.35;
        // ore veins show up along the toe of each bench face
        const toe = f > 0.5 && f < 0.7 ? 1 : 0;
        if (toe) {
          const vein = Math.max(0, noise.ridged2(x / 7 + ang, z / 7 - ang, 3) - 0.7) * 2.2;
          ore[k] = Math.min(0.6, vein);
        }
        if (dn < m.floorR) {
          const vein = Math.max(0, noise.ridged2(x / 5, z / 5, 3) - 0.66) * 2.5;
          ore[k] = Math.max(ore[k], Math.min(1, vein));
        }
      }
    }
  }

  // --- blend the margin into the far mountain ring so the seams match ---
  for (let j = 0; j < nz; j++) {
    const z = hf.z0 + j * def.cell;
    for (let i = 0; i < nx; i++) {
      const x = hf.x0 + i * def.cell;
      const dx = Math.max(0, Math.abs(x) - def.halfX);
      const dz = Math.max(0, Math.abs(z) - def.halfZ);
      const out = Math.hypot(dx, dz);
      if (out <= 0) continue;
      const k = j * nx + i;
      const fh = farHeight(x, z);
      // distance to heightfield border
      const border = Math.min(x - hf.x0, hf.x1 - x, z - hf.z0, hf.z1 - z);
      const toBorder = 1 - smooth(0, def.margin * 0.45, border);
      const rise = smooth(0, def.margin * 0.8, out);
      H[k] = H[k] + fh * rise * (1 - toBorder);
      H[k] = H[k] * (1 - toBorder) + fh * toBorder;
    }
  }

  // --- ambient occlusion / cavity from height relative to local average ---
  const blur = boxBlur(H, nx, nz, Math.max(2, Math.round(3 / def.cell)));
  for (let k = 0; k < H.length; k++) {
    const cav = H[k] - blur[k];
    albedo[k] *= 1 + Math.max(-0.22, Math.min(0.12, cav * 0.18));
  }

  return { hf, albedo, tint, ore, noise, craters, farHeight, mineTop };
}

/** 1 inside a levelled flat, fading to 0 across its soft edge */
function flatWeight(def: MapDef, x: number, z: number): number {
  let w = 0;
  for (const f of def.flats) {
    const soft = f.soft ?? 8;
    const cr = Math.cos(-(f.rot ?? 0));
    const sr = Math.sin(-(f.rot ?? 0));
    const lx = (x - f.x) * cr - (z - f.z) * sr;
    const lz = (x - f.x) * sr + (z - f.z) * cr;
    const o = Math.hypot(Math.max(0, Math.abs(lx) - f.w), Math.max(0, Math.abs(lz) - f.d));
    w = Math.max(w, 1 - smooth(0, soft, o));
  }
  return w;
}

function averageHeight(hf: Heightfield, x: number, z: number, r: number): number {
  let s = 0;
  let n = 0;
  for (let a = 0; a < 16; a++) {
    for (const rr of [0, r * 0.5, r]) {
      s += hf.heightAt(x + Math.cos(a * 0.3927) * rr, z + Math.sin(a * 0.3927) * rr);
      n++;
    }
  }
  return s / n;
}

function boxBlur(src: Float32Array, nx: number, nz: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const w = 2 * r + 1;
  for (let j = 0; j < nz; j++) {
    let acc = 0;
    const row = j * nx;
    for (let i = -r; i <= r; i++) acc += src[row + Math.min(nx - 1, Math.max(0, i))];
    for (let i = 0; i < nx; i++) {
      tmp[row + i] = acc / w;
      acc += src[row + Math.min(nx - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < nx; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[Math.min(nz - 1, Math.max(0, j)) * nx + i];
    for (let j = 0; j < nz; j++) {
      out[j * nx + i] = acc / w;
      acc += tmp[Math.min(nz - 1, j + r + 1) * nx + i] - tmp[Math.max(0, j - r) * nx + i];
    }
  }
  return out;
}
