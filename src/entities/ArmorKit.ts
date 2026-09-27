import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Hard-surface armour toolkit for the hero kits.
 *
 * The core primitive is `plate()`: a 2D outline (rounded polygon, metres) is laid onto a curved
 * surface through a `Wrap` (u, v → surface point, h → offset along the surface normal) and given
 * thickness, a rounded two-step bevel and a sunk wall, so shells conform to the torso, limbs or
 * helmet instead of floating as boxes. Every part carries a vertex colour (paint slot × bevel
 * highlight / wall occlusion) so one painted material serves main, accent and secondary plates.
 */

export type V2 = [number, number];
/** (u, v) on a surface chart (≈ metres) + height h along the outward normal → local position */
export type Wrap = (u: number, v: number, h: number, out: THREE.Vector3) => THREE.Vector3;

export const V3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
export const E = (x = 0, y = 0, z = 0): THREE.Euler => new THREE.Euler(x, y, z);

export function tx(g: THREE.BufferGeometry, pos: THREE.Vector3, rot?: THREE.Euler, scale?: THREE.Vector3): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), scale ?? V3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/** mirror across x = 0 (keeps faces front-facing) */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.clone();
  out.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  if (out.index) {
    const a = out.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    out.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(out.attributes)) {
      const at = out.getAttribute(name) as THREE.BufferAttribute;
      const s = at.itemSize;
      const arr = at.array as Float32Array;
      for (let i = 0; i < at.count; i += 3) {
        for (let c = 0; c < s; c++) {
          const t = arr[(i + 1) * s + c];
          arr[(i + 1) * s + c] = arr[(i + 2) * s + c];
          arr[(i + 2) * s + c] = t;
        }
      }
      at.needsUpdate = true;
    }
  }
  return out;
}

/** set (or multiply) a per-vertex colour */
export function tint(g: THREE.BufferGeometry, col: THREE.ColorRepresentation, mul = false): THREE.BufferGeometry {
  const c = new THREE.Color(col);
  const n = g.getAttribute('position').count;
  const prev = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r0 = mul && prev ? prev.getX(i) : 1;
    const g0 = mul && prev ? prev.getY(i) : 1;
    const b0 = mul && prev ? prev.getZ(i) : 1;
    arr[i * 3] = c.r * r0;
    arr[i * 3 + 1] = c.g * g0;
    arr[i * 3 + 2] = c.b * b0;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** darken toward -y within the part (cheap painted ambient occlusion) */
export function gradeY(g: THREE.BufferGeometry, lo: number, hi: number, dark = 0.7): THREE.BufferGeometry {
  if (!g.getAttribute('color')) tint(g, 0xffffff);
  const p = g.getAttribute('position');
  const c = g.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - lo) / (hi - lo), 0, 1);
    const k = THREE.MathUtils.lerp(dark, 1, t * t * (3 - 2 * t));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return g;
}

// ---------------------------------------------------------------------------
// outlines

/**
 * Rounded polygon: corners [x, y, filletRadius?] (any winding). Straight edges are split to
 * `maxLen` so wrapped plates follow the surface curvature.
 */
export function outline(corners: ([number, number] | [number, number, number])[], opts: { r?: number; seg?: number; maxLen?: number } = {}): V2[] {
  const n = corners.length;
  const maxLen = opts.maxLen ?? 0.075;
  const arcs: V2[][] = [];
  for (let i = 0; i < n; i++) {
    const p = corners[i];
    const a = corners[(i + n - 1) % n];
    const b = corners[(i + 1) % n];
    let r = p[2] ?? opts.r ?? 0.01;
    const d1x = a[0] - p[0];
    const d1y = a[1] - p[1];
    const d2x = b[0] - p[0];
    const d2y = b[1] - p[1];
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    if (r <= 1e-5 || l1 < 1e-6 || l2 < 1e-6) {
      arcs.push([[p[0], p[1]]]);
      continue;
    }
    const u1x = d1x / l1;
    const u1y = d1y / l1;
    const u2x = d2x / l2;
    const u2y = d2y / l2;
    const cosA = THREE.MathUtils.clamp(u1x * u2x + u1y * u2y, -0.9999, 0.9999);
    const half = Math.acos(cosA) / 2;
    let tl = r / Math.tan(half);
    const lim = Math.min(l1, l2) * 0.49;
    if (tl > lim) {
      tl = lim;
      r = tl * Math.tan(half);
    }
    const t1: V2 = [p[0] + u1x * tl, p[1] + u1y * tl];
    const t2: V2 = [p[0] + u2x * tl, p[1] + u2y * tl];
    let bx = u1x + u2x;
    let by = u1y + u2y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const cd = r / Math.sin(half);
    const cx = p[0] + bx * cd;
    const cy = p[1] + by * cd;
    let a0 = Math.atan2(t1[1] - cy, t1[0] - cx);
    let a1 = Math.atan2(t2[1] - cy, t2[0] - cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const seg = Math.max(1, Math.round(opts.seg ?? Math.max(1, Math.round((Math.abs(da) / (Math.PI / 2)) * 2))));
    const arc: V2[] = [];
    for (let s = 0; s <= seg; s++) {
      const ang = a0 + (da * s) / seg;
      arc.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
    }
    void a1;
    arcs.push(arc);
  }
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const arc = arcs[i];
    for (const q of arc) out.push(q);
    const next = arcs[(i + 1) % n][0];
    const last = arc[arc.length - 1];
    const len = Math.hypot(next[0] - last[0], next[1] - last[1]);
    const k = Math.ceil(len / maxLen);
    for (let s = 1; s < k; s++) out.push([last[0] + ((next[0] - last[0]) * s) / k, last[1] + ((next[1] - last[1]) * s) / k]);
  }
  return out;
}

export function ellipse(rx: number, ry: number, n = 20, cx = 0, cy = 0, p = 2): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push([cx + Math.sign(c) * Math.pow(Math.abs(c), 2 / p) * rx, cy + Math.sign(s) * Math.pow(Math.abs(s), 2 / p) * ry]);
  }
  return out;
}

export function rrect(cx: number, cy: number, w: number, h: number, r: number, maxLen = 0.045): V2[] {
  return outline(
    [
      [cx - w / 2, cy - h / 2, r],
      [cx + w / 2, cy - h / 2, r],
      [cx + w / 2, cy + h / 2, r],
      [cx - w / 2, cy + h / 2, r],
    ],
    { maxLen },
  );
}

/** mirror an outline across u = 0 */
export function flipU(ol: V2[]): V2[] {
  return ol.map(([u, v]) => [-u, v] as V2).reverse();
}

function area(ol: V2[]): number {
  let a = 0;
  for (let i = 0; i < ol.length; i++) {
    const p = ol[i];
    const q = ol[(i + 1) % ol.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function ccw(ol: V2[]): V2[] {
  return area(ol) < 0 ? ol.slice().reverse() : ol.slice();
}

function centroid(ol: V2[]): V2 {
  let x = 0;
  let y = 0;
  for (const p of ol) {
    x += p[0];
    y += p[1];
  }
  return [x / ol.length, y / ol.length];
}

/** offset a CCW outline inward by d (negative = outward), miter-limited */
function offset(ol: V2[], d: number): V2[] {
  const n = ol.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = ol[(i + n - 1) % n];
    const p = ol[i];
    const b = ol[(i + 1) % n];
    let e1x = p[0] - a[0];
    let e1y = p[1] - a[1];
    let e2x = b[0] - p[0];
    let e2y = b[1] - p[1];
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1;
    e1y /= l1;
    e2x /= l2;
    e2y /= l2;
    // left normals (inward for CCW)
    const n1x = -e1y;
    const n1y = e1x;
    const n2x = -e2y;
    const n2y = e2x;
    let mx = n1x + n2x;
    let my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const dot = Math.max(0.35, mx * n1x + my * n1y);
    out.push([p[0] + (mx * d) / dot, p[1] + (my * d) / dot]);
  }
  return out;
}

/** resample a closed outline to n points by arc length, starting nearest the +u ray from `c` */
function resample(ol: V2[], n: number, c: V2): V2[] {
  const m = ol.length;
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < m; i++) {
    const a = Math.abs(Math.atan2(ol[i][1] - c[1], ol[i][0] - c[0]));
    if (a < best) {
      best = a;
      start = i;
    }
  }
  const pts: V2[] = [];
  for (let i = 0; i <= m; i++) pts.push(ol[(start + i) % m]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  const out: V2[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / n) * total;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// plates

export interface PlateOpts {
  /** thickness of the top face above h0 */
  t?: number;
  /** offset of the plate base above the surface */
  h0?: number;
  /** wall continues this far below h0 (hides gaps on curved surfaces) */
  sink?: number;
  /** bevel inset width */
  bevel?: number;
  /** bevel height drop */
  bevelH?: number;
  /** interior rings (curvature following), auto from size */
  rings?: number;
  /** star centre for the ring topology (default: centroid) */
  center?: V2;
  /** extra height on the top face (sculpting: ridges, pecs, crowns) */
  lift?: (u: number, v: number) => number;
  col?: THREE.ColorRepresentation;
  /** bevel brightness (painted edge highlight) */
  edge?: number;
  /** inner outline → frame with a hole */
  hole?: V2[];
  /** close the underside (default true) */
  back?: boolean;
  /** texture scale (uv per metre) */
  uv?: number;
  /** rounded two-step bevel (default); false = single chamfer (tiny plates) */
  soft?: boolean;
}

const _w0 = new THREE.Vector3();
const _w1 = new THREE.Vector3();

/** Thick bevelled shell plate: outline laid onto a surface chart. */
export function plate(wrap: Wrap, ol: V2[], o: PlateOpts = {}): THREE.BufferGeometry {
  const t = o.t ?? 0.016;
  const h0 = o.h0 ?? 0.005;
  const sink = o.sink ?? 0.012;
  const bev = o.bevel ?? 0.0065;
  const bevH = o.bevelH ?? bev * 0.75;
  const lift = o.lift ?? (() => 0);
  const col = new THREE.Color(o.col ?? 0xffffff);
  const edge = o.edge ?? 1.22;
  const uvs = o.uv ?? 2;
  let O = ccw(ol);
  let H: V2[] | null = o.hole ? ccw(o.hole) : null;
  const C = o.center ?? centroid(O);
  if (H) {
    const n = Math.max(O.length, H.length);
    O = resample(O, n, C);
    H = resample(H, n, C);
  }
  const N = O.length;
  const I = offset(O, bev);
  // rows of 2D points with a height function and colour factor
  type Row = { p: V2[]; h: (u: number, v: number) => number; c: number };
  const top = (u: number, v: number) => h0 + t + lift(u, v);
  const rows: Row[] = [];
  let centerTop = -1;
  let centerBack = -1;
  const lerp2 = (a: V2[], b: V2[], f: number): V2[] => a.map((p, i) => [p[0] + (b[i][0] - p[0]) * f, p[1] + (b[i][1] - p[1]) * f] as V2);
  if (H) {
    const HI = offset(H, -bev);
    rows.push({ p: H, h: () => h0 - sink, c: 0.55 });
    rows.push({ p: H, h: (u, v) => top(u, v) - bevH, c: edge * 0.92 });
    if (o.soft !== false) rows.push({ p: lerp2(HI, H, 0.45), h: (u, v) => top(u, v) - bevH * 0.3, c: edge });
    const nr = o.rings ?? 1;
    for (let j = 0; j <= nr; j++) rows.push({ p: lerp2(HI, I, j / nr), h: top, c: 1 });
  } else {
    let maxR = 0;
    for (const p of I) maxR = Math.max(maxR, Math.hypot(p[0] - C[0], p[1] - C[1]));
    const nr = o.rings ?? THREE.MathUtils.clamp(Math.ceil(maxR / 0.07), 1, 3);
    const Cs: V2[] = I.map(() => [C[0], C[1]] as V2);
    for (let j = 1; j <= nr; j++) rows.push({ p: lerp2(Cs, I, j / nr), h: top, c: 1 });
  }
  if (o.soft !== false) rows.push({ p: lerp2(I, O, 0.55), h: (u, v) => top(u, v) - bevH * 0.3, c: edge });
  rows.push({ p: O, h: (u, v) => top(u, v) - bevH, c: edge * 0.92 });
  rows.push({ p: O, h: () => h0 - sink, c: 0.55 });

  const pos: number[] = [];
  const uv: number[] = [];
  const cl: number[] = [];
  const idx: number[] = [];
  const vert = (u: number, v: number, h: number, c: number): number => {
    wrap(u, v, h, _w0);
    pos.push(_w0.x, _w0.y, _w0.z);
    uv.push(u * uvs, v * uvs);
    cl.push(col.r * c, col.g * c, col.b * c);
    return pos.length / 3 - 1;
  };
  if (!H) centerTop = vert(C[0], C[1], top(C[0], C[1]), 1);
  const ids: number[][] = rows.map((r) => r.p.map(([u, v]) => vert(u, v, r.h(u, v), r.c)));
  // plates sink into the suit / other plates: the underside is never seen (opt in with `back`)
  if (!H && o.back === true) centerBack = vert(C[0], C[1], h0 - sink * 1.5, 0.45);
  const quad = (A: number[], B: number[]) => {
    for (let k = 0; k < N; k++) {
      const k1 = (k + 1) % N;
      idx.push(A[k], B[k], A[k1], A[k1], B[k], B[k1]);
    }
  };
  if (centerTop >= 0) for (let k = 0; k < N; k++) idx.push(centerTop, ids[0][k], ids[0][(k + 1) % N]);
  for (let j = 0; j < ids.length - 1; j++) quad(ids[j], ids[j + 1]);
  if (H) quad(ids[ids.length - 1], ids[0]);
  else if (centerBack >= 0) {
    const L = ids[ids.length - 1];
    for (let k = 0; k < N; k++) idx.push(L[k], centerBack, L[(k + 1) % N]);
  }
  // orientation: the first top triangle must face along the wrap normal
  const tr = o.soft !== false ? 3 : 2; // first top row of a frame
  const probeRow = H ? ids[tr + 1] : ids[0];
  const a = probeRow[0];
  const b = probeRow[1];
  const refTri = H ? [ids[tr][0], ids[tr + 1][0], ids[tr][1]] : [centerTop, a, b];
  const P = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const n = P(refTri[1]).sub(P(refTri[0])).cross(P(refTri[2]).sub(P(refTri[0])));
  const pu = H ? H[0] : C;
  wrap(pu[0], pu[1], 0, _w0);
  wrap(pu[0], pu[1], 1, _w1);
  if (n.dot(_w1.sub(_w0)) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = tmp;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// surface charts

const _p0 = new THREE.Vector3();
const _pu0 = new THREE.Vector3();
const _pu1 = new THREE.Vector3();
const _pv0 = new THREE.Vector3();
const _pv1 = new THREE.Vector3();
const _nn = new THREE.Vector3();
const _hint = new THREE.Vector3();

/** Wrap from a surface point function; the normal is numeric and oriented by `outward` */
export function surfaceWrap(P: (u: number, v: number, out: THREE.Vector3) => THREE.Vector3, outward: (p: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3, eps = 1e-3): Wrap {
  return (u, v, h, out) => {
    P(u, v, _p0);
    if (h === 0) return out.copy(_p0);
    P(u + eps, v, _pu1);
    P(u - eps, v, _pu0);
    P(u, v + eps, _pv1);
    P(u, v - eps, _pv0);
    _nn.crossVectors(_pu1.sub(_pu0), _pv1.sub(_pv0)).normalize();
    if (_nn.dot(outward(_p0, _hint)) < 0) _nn.negate();
    return out.copy(_p0).addScaledVector(_nn, h);
  };
}

/** plane: u → x, v → y, h → z, then an optional transform */
export function planeWrap(m?: THREE.Matrix4): Wrap {
  return (u, v, h, out) => {
    out.set(u, v, h);
    if (m) out.applyMatrix4(m);
    return out;
  };
}

/** piecewise-linear profile lookup: rows [key, ...values] sorted by key */
export function profile(rows0: number[][]): (x: number, i: number) => number {
  const rows = rows0.slice().sort((a, b) => a[0] - b[0]);
  return (x, i) => {
    if (x <= rows[0][0]) return rows[0][i];
    for (let k = 0; k < rows.length - 1; k++) {
      const a = rows[k];
      const b = rows[k + 1];
      if (x <= b[0]) {
        const f = (x - a[0]) / (b[0] - a[0]);
        const s = f * f * (3 - 2 * f) * 0.35 + f * 0.65;
        return a[i] + (b[i] - a[i]) * s;
      }
    }
    return rows[rows.length - 1][i];
  };
}

/**
 * Elliptic-section column (torso): rows [y, halfWidth, halfDepth, zCentre], u = arc length from the
 * front centre (toward +x) — or from the back centre (toward -x) with `back` — v = y. Front is -z.
 * With `angular`, u is the angle in radians (for closed bands).
 */
export function columnWrap(rows: number[][], o: { back?: boolean; angular?: boolean } = {}): Wrap {
  const pr = profile(rows);
  const arcCache = new Map<number, Float32Array>();
  const STEPS = 96;
  const arcTable = (w: number, d: number): Float32Array => {
    const key = Math.round(w * 2000) * 10000 + Math.round(d * 2000);
    let tb = arcCache.get(key);
    if (tb) return tb;
    tb = new Float32Array(STEPS + 1);
    let acc = 0;
    let px = 0;
    let pz = -d;
    for (let i = 1; i <= STEPS; i++) {
      const a = (i / STEPS) * Math.PI;
      const x = w * Math.sin(a);
      const z = -d * Math.cos(a);
      acc += Math.hypot(x - px, z - pz);
      tb[i] = acc;
      px = x;
      pz = z;
    }
    arcCache.set(key, tb);
    return tb;
  };
  const a0 = o.back ? Math.PI : 0;
  const P = (u: number, v: number, out: THREE.Vector3) => {
    const w = pr(v, 1);
    const d = pr(v, 2);
    const z0 = pr(v, 3);
    let a: number;
    if (o.angular) a = u;
    else {
      const tb = arcTable(w, d);
      const s = Math.min(Math.abs(u), tb[STEPS] * 0.999);
      let i = 0;
      while (i < STEPS - 1 && tb[i + 1] < s) i++;
      const f = (s - tb[i]) / (tb[i + 1] - tb[i] || 1);
      a = ((i + f) / STEPS) * Math.PI * Math.sign(u);
    }
    a += a0;
    return out.set(w * Math.sin(a), v, z0 - d * Math.cos(a));
  };
  return surfaceWrap(P, (p, out) => out.set(p.x, 0, p.z - pr(p.y, 3)));
}

/**
 * Limb tube in bone space (bone hangs along -Y): rows [y, radius, xOff?, zOff?]. u = arc length
 * around from the front (-z) toward +x, v = bone-local y.
 */
export function limbWrap(rows: number[][], k = 1, flat = 1): Wrap {
  const pr = profile(rows.map((r) => [r[0], r[1], r[2] ?? 0, r[3] ?? 0]));
  const P = (u: number, v: number, out: THREE.Vector3) => {
    const r = pr(v, 1) * k;
    const a = u / r;
    return out.set(r * Math.sin(a) + pr(v, 2), v, -r * Math.cos(a) * flat + pr(v, 3));
  };
  return surfaceWrap(P, (p, o) => o.set(p.x - pr(p.y, 2), 0, p.z - pr(p.y, 3)));
}

/** star-shaped closed surface around `c`: radius along a unit direction */
export type StarSurface = { c: THREE.Vector3; r: (dir: THREE.Vector3) => number };

/**
 * Azimuthal-equidistant chart on a star surface, centred on direction `axis`; u runs along
 * `uAxis`, v along axis × uAxis-ish (`vAxis`), both in metres at nominal radius `rn`.
 */
export function starWrap(S: StarSurface, axis: THREE.Vector3, uAxis: THREE.Vector3, vAxis: THREE.Vector3, rn: number): Wrap {
  const ax = axis.clone().normalize();
  const e1 = uAxis.clone().addScaledVector(ax, -uAxis.dot(ax)).normalize();
  const e2 = vAxis.clone().addScaledVector(ax, -vAxis.dot(ax)).addScaledVector(e1, -vAxis.dot(e1)).normalize();
  const dir = new THREE.Vector3();
  const P = (u: number, v: number, out: THREE.Vector3) => {
    const rho = Math.hypot(u, v) / rn;
    const beta = Math.atan2(v, u);
    dir.copy(ax).multiplyScalar(Math.cos(rho)).addScaledVector(e1, Math.sin(rho) * Math.cos(beta)).addScaledVector(e2, Math.sin(rho) * Math.sin(beta)).normalize();
    return out.copy(S.c).addScaledVector(dir, S.r(dir));
  };
  return surfaceWrap(P, (p, o) => o.copy(p).sub(S.c));
}

/** smooth closed mesh of a star surface (lat/long grid, seam welded) */
export function starMesh(S: StarSurface, wSeg = 28, hSeg = 18, cut?: (dir: THREE.Vector3) => boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const dir = new THREE.Vector3();
  const grid: number[][] = [];
  for (let j = 0; j <= hSeg; j++) {
    const th = (j / hSeg) * Math.PI;
    const row: number[] = [];
    const n = j === 0 || j === hSeg ? 1 : wSeg;
    for (let i = 0; i < n; i++) {
      const ph = (i / wSeg) * Math.PI * 2;
      dir.set(Math.sin(th) * Math.sin(ph), Math.cos(th), -Math.sin(th) * Math.cos(ph));
      const r = S.r(dir);
      pos.push(S.c.x + dir.x * r, S.c.y + dir.y * r, S.c.z + dir.z * r);
      uv.push(i / wSeg, 1 - j / hSeg);
      row.push(pos.length / 3 - 1);
    }
    grid.push(row);
  }
  const P = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const keep = (a: number, b: number, c: number) => {
    if (!cut) return true;
    const m = P(a).add(P(b)).add(P(c)).multiplyScalar(1 / 3).sub(S.c).normalize();
    return !cut(m);
  };
  for (let j = 0; j < hSeg; j++) {
    const A = grid[j];
    const B = grid[j + 1];
    for (let i = 0; i < wSeg; i++) {
      const i1 = (i + 1) % wSeg;
      if (A.length === 1) {
        if (keep(A[0], B[i1], B[i])) idx.push(A[0], B[i1], B[i]);
      } else if (B.length === 1) {
        if (keep(A[i], A[i1], B[0])) idx.push(A[i], A[i1], B[0]);
      } else {
        if (keep(A[i], A[i1], B[i])) idx.push(A[i], A[i1], B[i]);
        if (keep(A[i1], B[i1], B[i])) idx.push(A[i1], B[i1], B[i]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orientation check (outward)
  const n = g.getAttribute('normal');
  const p = g.getAttribute('position');
  let dot = 0;
  for (let i = 0; i < p.count; i += 7) dot += n.getX(i) * (p.getX(i) - S.c.x) + n.getY(i) * (p.getY(i) - S.c.y) + n.getZ(i) * (p.getZ(i) - S.c.z);
  if (dot < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = tmp;
    }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

// ---------------------------------------------------------------------------
// hard-surface primitives

/** lathe: profile [radius, y]; duplicate a point to get a crisp edge */
export function lathe(prof: [number, number][], seg = 20, phiStart = 0, phiLen = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)),
    seg,
    phiStart,
    phiLen,
  );
}

/** cylinder with chamfered rims (along Y, centred) */
export function bcyl(rTop: number, rBot: number, h: number, bevel = 0.006, seg = 14, open = false): THREE.BufferGeometry {
  const b = Math.min(bevel, h * 0.3, rTop * 0.5, rBot * 0.5);
  const pr: [number, number][] = [];
  if (!open) pr.push([0, -h / 2]);
  pr.push([rBot - b, -h / 2], [rBot, -h / 2 + b], [rTop, h / 2 - b], [rTop - b, h / 2]);
  if (!open) pr.push([0, h / 2]);
  return lathe(pr, seg);
}

/** rounded box */
export function rbox(w: number, h: number, d: number, r = 0.01, seg = 1): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
}

/** extruded rounded outline (in XY, depth along Z, centred), bevelled, crease-shaded */
export function extr(ol: V2[], depth: number, bevel = 0.005, bevelSegs = 2, curveSegs = 4): THREE.BufferGeometry {
  const shape = new THREE.Shape(ccw(ol).map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, depth - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: bevelSegs, curveSegments: curveSegs });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return toCreasedNormals(g, 0.7);
}

/** hose / cable through points */
export function hose(pts: THREE.Vector3[], r: number, seg = 16, radial = 6): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, radial, false);
}

/** crisp faceted normals (for hex prisms etc.) */
export function creased(g: THREE.BufferGeometry, angle = 0.5): THREE.BufferGeometry {
  return toCreasedNormals(g, angle);
}

/** scale a geometry's own color attribute (after tint) */
export function shade(g: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  const c = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!c) return g;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  return g;
}

/**
 * Band across a chart: `us` columns (closed ring when `closed`), cross-section rows [v, h]
 * (smooth-shaded; repeat a row with a tiny v step for a tighter edge).
 */
export function band(wrap: Wrap, us: number[], prof: [number, number][], closed: boolean, edge = 1.15): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const cl: number[] = [];
  const idx: number[] = [];
  const nU = us.length;
  const hMax = Math.max(...prof.map((r) => r[1]));
  const hMin = Math.min(...prof.map((r) => r[1]));
  for (let j = 0; j < prof.length; j++) {
    const [v, h] = prof[j];
    const f = (h - hMin) / (hMax - hMin || 1);
    const c = 0.6 + 0.4 * f;
    const isEdge = j > 0 && j < prof.length - 1 && (prof[j - 1][1] < h - 1e-4 || prof[j + 1][1] < h - 1e-4);
    const k = isEdge ? c * edge : c;
    for (let i = 0; i < nU; i++) {
      wrap(us[i], v, h, _w0);
      pos.push(_w0.x, _w0.y, _w0.z);
      uv.push(us[i] * 2, v * 2);
      cl.push(k, k, k);
    }
  }
  const cols = closed ? nU : nU - 1;
  for (let j = 0; j < prof.length - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const i1 = (i + 1) % nU;
      const a = j * nU + i;
      const b = j * nU + i1;
      const c = (j + 1) * nU + i;
      const d = (j + 1) * nU + i1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // orientation vs the wrap normal at the middle
  const mid = Math.floor(prof.length / 2);
  const P = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  const a = (mid - 1) * nU;
  const n = P(a + nU).sub(P(a)).cross(P(a + 1).sub(P(a)));
  wrap(us[0], prof[mid][0], 0, _w0);
  wrap(us[0], prof[mid][0], 1, _w1);
  if (n.dot(_w1.sub(_w0)) < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** evenly spaced values */
export function span(a: number, b: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
/**
 * Place a primitive on a chart: its +Y goes along the surface normal at (u, v), origin at height h.
 * `spin` rotates about the normal; `tilt` leans the part (radians about its local X) first.
 */
export function onSurface(wrap: Wrap, u: number, v: number, h: number, g: THREE.BufferGeometry, spin = 0, tilt = 0): THREE.BufferGeometry {
  const p = wrap(u, v, h, new THREE.Vector3());
  const n = wrap(u, v, h + 0.01, new THREE.Vector3()).sub(p).normalize();
  // tangent along +v for a stable spin reference
  const pv = wrap(u, v + 0.01, h, new THREE.Vector3()).sub(p);
  pv.addScaledVector(n, -pv.dot(n)).normalize();
  const x = new THREE.Vector3().crossVectors(pv, n).normalize();
  const m = new THREE.Matrix4().makeBasis(x, n, pv.clone().negate());
  const pre = new THREE.Matrix4().makeRotationY(spin).multiply(new THREE.Matrix4().makeRotationX(tilt));
  g.applyMatrix4(pre);
  g.applyMatrix4(m);
  g.translate(p.x, p.y, p.z);
  void _q;
  void _up;
  return g;
}

/** periodic smooth radius curve through [angleDeg, rho] keys (CCW from +u) → outline */
export function polarKeys(keys: [number, number][], n = 48, cx = 0, cy = 0): V2[] {
  const ks = keys.slice().sort((a, b) => a[0] - b[0]);
  const m = ks.length;
  const at = (i: number): [number, number] => {
    const k = ((i % m) + m) % m;
    const wrapN = Math.floor(i / m);
    return [ks[k][0] + wrapN * 360, ks[k][1]];
  };
  const out: V2[] = [];
  for (let s = 0; s < n; s++) {
    const deg = (s / n) * 360;
    // find segment
    let i = -1;
    for (let j = -1; j <= m; j++) {
      const a = at(j);
      const b = at(j + 1);
      if (deg >= a[0] && deg < b[0]) {
        i = j;
        break;
      }
    }
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const t = (deg - p1[0]) / (p2[0] - p1[0] || 1);
    // Catmull-Rom on rho
    const t2 = t * t;
    const t3 = t2 * t;
    const r = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
    const a = (deg * Math.PI) / 180;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/**
 * Ring chart around a star surface: u = angle about `axis` (× rn) starting at `e1`, v = elevation
 * off the ring plane (× rn), offset by `v0` metres along the axis-direction. Use with `band()` for
 * straps, rims and collars that follow a helmet / boot shell.
 */
export function ringWrap(S: StarSurface, axis: THREE.Vector3, e1: THREE.Vector3, rn: number, lift = 0): Wrap {
  const n = axis.clone().normalize();
  const a = e1.clone().addScaledVector(n, -e1.dot(n)).normalize();
  const b = new THREE.Vector3().crossVectors(n, a);
  const dir = new THREE.Vector3();
  const P = (u: number, v: number, out: THREE.Vector3) => {
    const phi = u / rn;
    const th = v / rn + lift;
    dir.copy(a).multiplyScalar(Math.cos(phi)).addScaledVector(b, Math.sin(phi)).multiplyScalar(Math.cos(th)).addScaledVector(n, Math.sin(th)).normalize();
    return out.copy(S.c).addScaledVector(dir, S.r(dir));
  };
  return surfaceWrap(P, (p, o) => o.copy(p).sub(S.c));
}

/** straight strip outline between two chart points (width w, rounded ends) */
export function strip(u0: number, v0: number, u1: number, v1: number, w: number, r = w * 0.45): V2[] {
  const dx = u1 - u0;
  const dy = v1 - v0;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (w / 2);
  const ny = (dx / l) * (w / 2);
  return outline(
    [
      [u0 + nx, v0 + ny, r],
      [u0 - nx, v0 - ny, r],
      [u1 - nx, v1 - ny, r],
      [u1 + nx, v1 + ny, r],
    ],
    { maxLen: 0.06 },
  );
}

/** regular hexagon outline (flat top when rot = 0) */
export function hexagon(cx: number, cy: number, r: number, rot = 0, fillet = 0.004): V2[] {
  const c: [number, number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * Math.PI * 2;
    c.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, fillet]);
  }
  return outline(c, { maxLen: 1 });
}

// ---------------------------------------------------------------------------
// kit context shared by the helmet / body kits

export type BoneName = 'root' | 'hips' | 'spine' | 'chest' | 'neck' | 'head' | 'pack' | 'armL' | 'foreL' | 'handL' | 'armR' | 'foreR' | 'handR' | 'legL' | 'shinL' | 'footL' | 'legR' | 'shinR' | 'footR';
export type Mat = 'suit' | 'paint' | 'dark' | 'metal' | 'visor' | 'glow';
export type Col = THREE.ColorRepresentation;

export interface Palette {
  main: THREE.Color; // team / hero colour (primary plates)
  acc: THREE.Color; // hero accent
  sec: THREE.Color; // secondary plates (neutral)
  trim: THREE.Color; // dark painted trim
  glow: THREE.Color; // emissive details
}

export interface KitCtx {
  pal: Palette;
  bulk: number;
  /** rigid part in bone space */
  add(bone: BoneName, mat: Mat, geo: THREE.BufferGeometry, col?: Col): void;
  /** rigid part authored in `space` bone space, skinned with blended weights */
  blend(space: BoneName, w: Partial<Record<BoneName, number>>, mat: Mat, geo: THREE.BufferGeometry, col?: Col): void;
  /** part in unscaled bind (model) space, skinned like the suit torso (hips → spine → chest) */
  torso(mat: Mat, geo: THREE.BufferGeometry, col?: Col): void;
  /** jet nozzle exits in pack space (flames) */
  nozzles: [number, number, number][];
}

export const SIDES = [1, -1] as const;
export const sideBone = (b: 'arm' | 'fore' | 'hand' | 'leg' | 'shin' | 'foot', s: number): BoneName => (b + (s > 0 ? 'R' : 'L')) as BoneName;
/** author for the right side (+x), mirror for the left */
export const sided = (g: THREE.BufferGeometry, s: number): THREE.BufferGeometry => (s > 0 ? g : mirrorX(g));
export const bump = (x: number, y: number): number => {
  const d = x * x + y * y;
  return d >= 1 ? 0 : (1 - d) * (1 - d);
};
export const ridge = (x: number, w: number): number => Math.max(0, 1 - Math.abs(x) / w);
export const smooth = (a: number, b: number, x: number): number => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
