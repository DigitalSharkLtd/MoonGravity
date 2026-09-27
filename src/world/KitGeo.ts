import * as THREE from 'three';

/**
 * Low-level geometry generators for the architectural kit. All geometries are indexed, carry
 * position/normal/uv, use world-scaled UVs (TILE metres per texture repeat) and are tessellated
 * to a maximum quad size so per-vertex baked light can form soft pools on large faces.
 */
export const TILE = 2;

class GeoBuf {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  get count(): number {
    return this.pos.length / 3;
  }
  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, w);
    return this.count - 1;
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

/** planar UV from the dominant normal axis (box-local coordinates + offset) */
function projUV(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: [number, number]): void {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) {
    out[0] = x / TILE;
    out[1] = (ny > 0 ? -z : z) / TILE;
  } else if (ax >= az) {
    out[0] = (nx > 0 ? -z : z) / TILE;
    out[1] = y / TILE;
  } else {
    out[0] = (nz > 0 ? x : -x) / TILE;
    out[1] = y / TILE;
  }
}

const _uv: [number, number] = [0, 0];

/**
 * Quad grid from origin o spanning eu × ev, facing n. Winding is fixed up to face n.
 */
function grid(gb: GeoBuf, o: number[], eu: number[], ev: number[], nu: number, nv: number, n: number[], uo: number[]): void {
  const base = gb.count;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const a = i / nu;
      const b = j / nv;
      const x = o[0] + eu[0] * a + ev[0] * b;
      const y = o[1] + eu[1] * a + ev[1] * b;
      const z = o[2] + eu[2] * a + ev[2] * b;
      projUV(x + uo[0], y + uo[1], z + uo[2], n[0], n[1], n[2], _uv);
      gb.v(x, y, z, n[0], n[1], n[2], _uv[0], _uv[1]);
    }
  }
  // orientation: cross(eu, ev) · n
  const cx = eu[1] * ev[2] - eu[2] * ev[1];
  const cy = eu[2] * ev[0] - eu[0] * ev[2];
  const cz = eu[0] * ev[1] - eu[1] * ev[0];
  const ccw = cx * n[0] + cy * n[1] + cz * n[2] > 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      if (ccw) gb.idx.push(a, b, d, a, d, c);
      else gb.idx.push(a, d, b, a, c, d);
    }
  }
}

function tri(gb: GeoBuf, p: number[][], n: number[], uo: number[]): void {
  const base = gb.count;
  for (const q of p) {
    projUV(q[0] + uo[0], q[1] + uo[1], q[2] + uo[2], n[0], n[1], n[2], _uv);
    gb.v(q[0], q[1], q[2], n[0], n[1], n[2], _uv[0], _uv[1]);
  }
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  if (c[0] * n[0] + c[1] * n[1] + c[2] * n[2] > 0) gb.idx.push(base, base + 1, base + 2);
  else gb.idx.push(base, base + 2, base + 1);
}

const nseg = (len: number, seg: number) => Math.max(1, Math.min(20, Math.ceil(len / seg - 0.01)));

/**
 * Chamfered box centred on the origin: 6 inset faces + 12 45° bevel strips + 8 corner facets.
 * The bevels catch the light and give the chunky hand-crafted look. `faces` can drop faces
 * (bit mask: +x,-x,+y,-y,+z,-z) that are never seen (e.g. bottoms on the ground).
 */
export function chamferBox(w: number, h: number, d: number, bevel: number, seg = 2.5, uo: number[] = [0, 0, 0], faces = 63): THREE.BufferGeometry {
  const H = [w / 2, h / 2, d / 2];
  const b = Math.max(0, Math.min(bevel, H[0] * 0.8, H[1] * 0.8, H[2] * 0.8));
  const I = [H[0] - b, H[1] - b, H[2] - b];
  const gb = new GeoBuf();
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const s of [1, -1]) {
      const bit = 1 << (a * 2 + (s > 0 ? 0 : 1));
      if (!(faces & bit)) continue;
      const o = [0, 0, 0];
      o[a] = s * H[a];
      o[u] = -I[u];
      o[v] = -I[v];
      const eu = [0, 0, 0];
      eu[u] = 2 * I[u];
      const ev = [0, 0, 0];
      ev[v] = 2 * I[v];
      const n = [0, 0, 0];
      n[a] = s;
      grid(gb, o, eu, ev, nseg(2 * I[u], seg), nseg(2 * I[v], seg), n, uo);
    }
  }
  if (b > 1e-4) {
    const k = Math.SQRT1_2;
    for (let c = 0; c < 3; c++) {
      const a = (c + 1) % 3;
      const bb = (c + 2) % 3;
      for (const sa of [1, -1]) {
        for (const sb of [1, -1]) {
          const p0 = [0, 0, 0];
          p0[a] = sa * H[a];
          p0[bb] = sb * I[bb];
          p0[c] = -I[c];
          const p1 = [0, 0, 0];
          p1[a] = sa * I[a];
          p1[bb] = sb * H[bb];
          p1[c] = -I[c];
          const eu = [0, 0, 0];
          eu[c] = 2 * I[c];
          const ev = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
          const n = [0, 0, 0];
          n[a] = sa * k;
          n[bb] = sb * k;
          grid(gb, p0, eu, ev, nseg(2 * I[c], seg), 1, n, uo);
        }
      }
    }
    const r3 = 1 / Math.sqrt(3);
    for (const sx of [1, -1])
      for (const sy of [1, -1])
        for (const sz of [1, -1]) {
          tri(
            gb,
            [
              [sx * H[0], sy * I[1], sz * I[2]],
              [sx * I[0], sy * H[1], sz * I[2]],
              [sx * I[0], sy * I[1], sz * H[2]],
            ],
            [sx * r3, sy * r3, sz * r3],
            uo,
          );
        }
  }
  const g = gb.build();
  // shadow proxy hint for the StructureBuilder: a plain 12-triangle box casts the same shadow
  g.userData.shadow = 'box';
  return g;
}

/**
 * Right prism from a convex-or-concave polygon in the XZ plane (CCW seen from above), from y0 to y1.
 * Flat-shaded sides (optional top chamfer inset) — bastions, berm ends, wedges.
 */
export function prismXZ(poly: [number, number][], y0: number, y1: number, seg = 2.5, uo: number[] = [0, 0, 0], opts: { top?: boolean; bottom?: boolean } = {}): THREE.BufferGeometry {
  const gb = new GeoBuf();
  const n = poly.length;
  // signed area in the (x, z) plane: > 0 → counter-clockwise → outward normal of edge e is (ez, -ex)
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    area += ax * bz - bx * az;
  }
  const sgn = area > 0 ? 1 : -1;
  const pts = poly;
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % n];
    const ex = bx - ax;
    const ez = bz - az;
    const len = Math.hypot(ex, ez);
    if (len < 1e-5) continue;
    const nx = (sgn * ez) / len;
    const nz = (-sgn * ex) / len;
    grid(gb, [ax, y0, az], [ex, 0, ez], [0, y1 - y0, 0], nseg(len, seg), nseg(y1 - y0, seg), [nx, 0, nz], uo);
  }
  const shape = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(shape, []);
  for (const [yy, ny] of [
    [y1, 1],
    [y0, -1],
  ] as const) {
    if (ny > 0 && opts.top === false) continue;
    if (ny < 0 && opts.bottom === false) continue;
    for (const t of tris) tri(gb, t.map((k) => [pts[k][0], yy, pts[k][1]]), [0, ny, 0], uo);
  }
  return gb.build();
}

/**
 * Generic extrusion of a 2D profile (u = local x, v = local y) along local z from -len/2..len/2,
 * with flat-shaded segments and caps (profile must be convex for the caps). Berms, vault ribs, wedges.
 */
export function extrudeProfile(profile: [number, number][], len: number, seg = 2.5, uo: number[] = [0, 0, 0], caps = true): THREE.BufferGeometry {
  const gb = new GeoBuf();
  const n = profile.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = profile[i];
    const [bx, by] = profile[(i + 1) % n];
    area += ax * by - bx * ay;
  }
  const sgn = area > 0 ? 1 : -1; // CCW in (x, y): outward normal of edge e is (ey, -ex)
  for (let i = 0; i < n; i++) {
    const [ax, ay] = profile[i];
    const [bx, by] = profile[(i + 1) % n];
    const ex = bx - ax;
    const ey = by - ay;
    const l = Math.hypot(ex, ey);
    if (l < 1e-5) continue;
    const nx = (sgn * ey) / l;
    const ny = (-sgn * ex) / l;
    grid(gb, [ax, ay, -len / 2], [ex, ey, 0], [0, 0, len], nseg(l, seg), nseg(len, seg), [nx, ny, 0], uo);
  }
  if (caps) {
    const shape = profile.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(shape, []);
    for (const s of [1, -1]) for (const t of tris) tri(gb, t.map((k) => [profile[k][0], profile[k][1], (s * len) / 2]), [0, 0, s], uo);
  }
  return gb.build();
}

/**
 * Parametric spherical shell section (for domes): lat from lat0..lat1 (radians, 0 = equator),
 * lon full circle, with optional skipped cells (openings). Normals outward (or inward).
 */
export function sphereBand(r: number, lat0: number, lat1: number, lonSeg: number, latSeg: number, inward = false, skip?: (lon: number, lat: number) => boolean): THREE.BufferGeometry {
  const gb = new GeoBuf();
  const s = inward ? -1 : 1;
  for (let j = 0; j < latSeg; j++) {
    for (let i = 0; i < lonSeg; i++) {
      const la0 = lat0 + ((lat1 - lat0) * j) / latSeg;
      const la1 = lat0 + ((lat1 - lat0) * (j + 1)) / latSeg;
      const lo0 = (i / lonSeg) * Math.PI * 2;
      const lo1 = ((i + 1) / lonSeg) * Math.PI * 2;
      if (skip && skip((lo0 + lo1) / 2, (la0 + la1) / 2)) continue;
      const base = gb.count;
      for (const [lo, la] of [
        [lo0, la0],
        [lo1, la0],
        [lo0, la1],
        [lo1, la1],
      ]) {
        const cx = Math.cos(la) * Math.cos(lo);
        const cy = Math.sin(la);
        const cz = Math.cos(la) * Math.sin(lo);
        gb.v(cx * r, cy * r, cz * r, cx * s, cy * s, cz * s, (lo * r) / TILE, (la * r) / TILE);
      }
      // outward winding: (a, c, b), (b, c, d) for increasing lon then lat
      if (!inward) gb.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      else gb.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  return gb.build();
}

/** Cylinder with chamfered rims (smooth sides, crisp bevels); open option for tubes. */
export function chamferCyl(r: number, h: number, bevel: number, radial = 20, uo: number[] = [0, 0, 0], caps = true): THREE.BufferGeometry {
  const b = Math.max(0, Math.min(bevel, r * 0.4, h * 0.4));
  const hh = h / 2;
  // profile rings: (radius, y, normal r, normal y)
  const rings: [number, number, number, number][][] = [];
  const k = Math.SQRT1_2;
  if (b > 1e-4) {
    rings.push([
      [r - b, -hh, k * -0 + 0, -1],
      [r - b, -hh, k, -k],
    ]);
  }
  const gb = new GeoBuf();
  const band = (r0: number, y0: number, r1: number, y1: number, nr: number, ny: number) => {
    const base = gb.count;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const u = (a * r) / TILE + uo[0];
      gb.v(c * r0, y0, s * r0, c * nr, ny, s * nr, u, (y0 + uo[1]) / TILE);
      gb.v(c * r1, y1, s * r1, c * nr, ny, s * nr, u, (y1 + uo[1]) / TILE);
    }
    for (let i = 0; i < radial; i++) {
      const a = base + i * 2;
      gb.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  };
  void rings;
  if (b > 1e-4) band(r - b, -hh, r, -hh + b, k, -k);
  band(r, -hh + b, r, hh - b, 1, 0);
  if (b > 1e-4) band(r, hh - b, r - b, hh, k, k);
  if (caps) {
    for (const s of [1, -1]) {
      const c0 = gb.v(0, s * hh, 0, 0, s, 0, uo[0] / TILE, uo[2] / TILE);
      const base = gb.count;
      for (let i = 0; i <= radial; i++) {
        const a = (i / radial) * Math.PI * 2;
        const x = Math.cos(a) * (r - b);
        const z = Math.sin(a) * (r - b);
        gb.v(x, s * hh, z, 0, s, 0, (x + uo[0]) / TILE, (z + uo[2]) / TILE);
      }
      for (let i = 0; i < radial; i++) {
        if (s > 0) gb.idx.push(c0, base + i + 1, base + i);
        else gb.idx.push(c0, base + i, base + i + 1);
      }
    }
  }
  const g = gb.build();
  g.userData.shadow = 'cyl';
  g.userData.r = r;
  g.userData.h = h;
  return g;
}
