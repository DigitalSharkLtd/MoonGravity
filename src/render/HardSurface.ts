import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Hard-surface modelling kit for props (weapons, deployables): bevelled 2D-profile extrusions,
 * lathed barrels, rounded boxes and a crease-angle normal pass so chamfers stay crisp while
 * curves shade smoothly. All helpers use a "gun frame": x = right, y = up, forward = -Z
 * (profiles take the forward distance `f` as a positive number).
 */

/** 2D point, optional third value = fillet radius for that corner */
export type P2 = [number, number] | [number, number, number];

const V2 = THREE.Vector2;

/** polygon with filleted corners (per-corner radius, or the default `r`) */
export function outline(pts: P2[], r = 0, seg = 3): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n];
    const c = pts[i];
    const q = pts[(i + 1) % n];
    const rr = c[2] ?? r;
    if (rr <= 0) {
      out.push(new V2(c[0], c[1]));
      continue;
    }
    let ax = p[0] - c[0];
    let ay = p[1] - c[1];
    const la = Math.hypot(ax, ay) || 1;
    ax /= la;
    ay /= la;
    let bx = q[0] - c[0];
    let by = q[1] - c[1];
    const lb = Math.hypot(bx, by) || 1;
    bx /= lb;
    by /= lb;
    const ang = Math.acos(THREE.MathUtils.clamp(ax * bx + ay * by, -1, 1));
    if (ang > Math.PI - 0.02) {
      out.push(new V2(c[0], c[1]));
      continue;
    }
    const t = Math.min(rr / Math.tan(ang / 2), la * 0.48, lb * 0.48);
    const sx = c[0] + ax * t;
    const sy = c[1] + ay * t;
    const ex = c[0] + bx * t;
    const ey = c[1] + by * t;
    // fewer segments on tiny fillets (they read as chamfers anyway)
    const k = Math.max(1, Math.round(((Math.PI - ang) / (Math.PI / 2)) * seg * THREE.MathUtils.clamp(rr / 0.02, 0.34, 1)));
    for (let j = 0; j <= k; j++) {
      const u = j / k;
      const a = (1 - u) * (1 - u);
      const b = 2 * u * (1 - u);
      const d = u * u;
      out.push(new V2(a * sx + b * c[0] + d * ex, a * sy + b * c[1] + d * ey));
    }
  }
  // drop coincident neighbours (degenerate caps otherwise)
  const res: THREE.Vector2[] = [];
  for (const v of out) if (!res.length || res[res.length - 1].distanceTo(v) > 1e-5) res.push(v);
  if (res.length > 2 && res[0].distanceTo(res[res.length - 1]) < 1e-5) res.pop();
  return res;
}

/** circle / ellipse outline (for holes, round bosses) */
export function circle(cx: number, cy: number, r: number, seg = 16, ry = r): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * ry, 0]);
  }
  return out;
}

export interface ExOpts {
  /** chamfer size (m) */
  bevel?: number;
  /** default fillet radius for corners */
  r?: number;
  holes?: P2[][];
  /** smoothing threshold (rad): faces closer than this share normals */
  crease?: number;
  seg?: number;
  /** side(): narrow the top by this fraction (sloped flanks, like a machined receiver) */
  top?: number;
  /** side(): narrow the bottom by this fraction */
  bot?: number;
  /** side(): narrow the front (max forward) end by this fraction */
  nose?: number;
  /** side(): narrow the rear (min forward) end by this fraction */
  tail?: number;
}

function shapeOf(pts: P2[], o: ExOpts): THREE.Shape {
  const s = new THREE.Shape(outline(pts, o.r ?? 0, o.seg ?? 3));
  for (const h of o.holes ?? []) s.holes.push(new THREE.Path(outline(h, o.r ?? 0, o.seg ?? 3)));
  return s;
}

function extrude(pts: P2[], depth: number, o: ExOpts): THREE.BufferGeometry {
  const bevel = Math.min(o.bevel ?? 0.006, depth * 0.3);
  const geo = new THREE.ExtrudeGeometry(shapeOf(pts, o), {
    depth: Math.max(1e-4, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 1,
    curveSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -(depth - bevel * 2) / 2);
  return geo;
}

/** side profile: pts = (forward, up); extruded across X, centred, total width w */
export function side(pts: P2[], w: number, o: ExOpts = {}): THREE.BufferGeometry {
  const geo = extrude(pts, w, o);
  geo.rotateY(Math.PI / 2);
  if (o.top || o.bot || o.nose || o.tail) {
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const hy = Math.max(1e-6, bb.max.y - bb.min.y);
    const hz = Math.max(1e-6, bb.max.z - bb.min.z);
    for (let i = 0; i < pos.count; i++) {
      const ty = (pos.getY(i) - bb.min.y) / hy; // 0 bottom → 1 top
      const tz = (bb.max.z - pos.getZ(i)) / hz; // 0 rear → 1 front
      const k = (1 - (o.top ?? 0) * ty) * (1 - (o.bot ?? 0) * (1 - ty)) * (1 - (o.nose ?? 0) * tz) * (1 - (o.tail ?? 0) * (1 - tz));
      pos.setX(i, pos.getX(i) * k);
    }
  }
  return creased(geo, o.crease ?? 0.7);
}

/** cross-section: pts = (right, up); extruded along the barrel between forward f0 → f1 */
export function sect(pts: P2[], f0: number, f1: number, o: ExOpts = {}): THREE.BufferGeometry {
  const geo = extrude(pts, Math.abs(f1 - f0), o);
  geo.translate(0, 0, -(f0 + f1) / 2);
  return creased(geo, o.crease ?? 0.7);
}

/** top plan: pts = (right, forward); extruded vertically between y0 → y1 */
export function plan(pts: P2[], y0: number, y1: number, o: ExOpts = {}): THREE.BufferGeometry {
  const geo = extrude(pts, Math.abs(y1 - y0), o);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, (y0 + y1) / 2, 0);
  return creased(geo, o.crease ?? 0.7);
}

/** lathe around the barrel (Z) axis: pts = (radius, forward). seg 6/8 = hard faceted shrouds */
export function lathe(pts: [number, number][], seg = 16, o: { phase?: number; crease?: number; arc?: number } = {}): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(
    pts.map(([r, f]) => new V2(Math.max(0, r), f)),
    seg,
    o.phase ?? 0,
    o.arc ?? Math.PI * 2,
  );
  geo.rotateX(-Math.PI / 2);
  return creased(geo, o.crease ?? (seg <= 8 ? 0.5 : 0.75));
}

/** lathe around the vertical (Y) axis: pts = (radius, height) */
export function latheY(pts: [number, number][], seg = 16, o: { phase?: number; crease?: number } = {}): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(
    pts.map(([r, y]) => new V2(Math.max(0, r), y)),
    seg,
    o.phase ?? 0,
  );
  return creased(geo, o.crease ?? (seg <= 8 ? 0.5 : 0.75));
}

/** simple tube along the barrel axis from f0 → f1 (with optional end radius) */
export function tubeZ(r: number, f0: number, f1: number, seg = 16, r1 = r): THREE.BufferGeometry {
  return lathe(
    [
      [0, f0],
      [r, f0],
      [r1, f1],
      [0, f1],
    ],
    seg,
  );
}

/** open cylinder band (axis Y) whose UVs tile a square texture around it without stretching (hazard stripes) */
export function bandGeo(r: number, h: number, seg = 16): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  const tiles = Math.max(1, Math.round((2 * Math.PI * r) / h));
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * tiles);
  return geo;
}

const boxCache = new Map<string, THREE.BufferGeometry>();
/** bevelled box (smooth rounded edges) */
export function rbox(w: number, h: number, d: number, r?: number, seg = 1): THREE.BufferGeometry {
  const rr = r ?? Math.min(0.012, Math.min(w, h, d) * 0.25);
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${rr.toFixed(4)}|${seg}`;
  let geo = boxCache.get(key);
  if (!geo) {
    geo = new RoundedBoxGeometry(w, h, d, seg, rr);
    boxCache.set(key, geo);
  }
  return geo;
}

/** crease-angle normals with fine (0.1 mm) welding — the stock util welds at 1 cm, too coarse for props */
export function creased(src: THREE.BufferGeometry, angle = 0.7): THREE.BufferGeometry {
  const geo = src.index ? src.toNonIndexed() : src;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const fc = Math.floor(n / 3);
  const fnx = new Float32Array(fc * 3); // area-weighted
  const fnu = new Float32Array(fc * 3); // unit
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let f = 0; f < fc; f++) {
    a.fromBufferAttribute(pos, f * 3);
    b.fromBufferAttribute(pos, f * 3 + 1);
    c.fromBufferAttribute(pos, f * 3 + 2);
    c.sub(b);
    a.sub(b);
    c.cross(a);
    fnx[f * 3] = c.x;
    fnx[f * 3 + 1] = c.y;
    fnx[f * 3 + 2] = c.z;
    const l = c.length() || 1;
    fnu[f * 3] = c.x / l;
    fnu[f * 3 + 1] = c.y / l;
    fnu[f * 3 + 2] = c.z / l;
  }
  const ids = new Int32Array(n);
  const map = new Map<string, number>();
  const buckets: number[][] = [];
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) * 1e4) + ',' + Math.round(pos.getY(i) * 1e4) + ',' + Math.round(pos.getZ(i) * 1e4);
    let id = map.get(k);
    if (id === undefined) {
      id = buckets.length;
      map.set(k, id);
      buckets.push([]);
    }
    ids[i] = id;
    buckets[id].push(Math.floor(i / 3));
  }
  const cd = Math.cos(angle);
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const f = Math.floor(i / 3);
    const ux = fnu[f * 3];
    const uy = fnu[f * 3 + 1];
    const uz = fnu[f * 3 + 2];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const o of buckets[ids[i]]) {
      if (ux * fnu[o * 3] + uy * fnu[o * 3 + 1] + uz * fnu[o * 3 + 2] >= cd) {
        sx += fnx[o * 3];
        sy += fnx[o * 3 + 1];
        sz += fnx[o * 3 + 2];
      }
    }
    const l = Math.hypot(sx, sy, sz);
    if (l > 1e-12) {
      nrm[i * 3] = sx / l;
      nrm[i * 3 + 1] = sy / l;
      nrm[i * 3 + 2] = sz / l;
    } else {
      nrm[i * 3] = ux;
      nrm[i * 3 + 1] = uy;
      nrm[i * 3 + 2] = uz;
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return geo;
}

/** add a mesh to a parent with position / euler rotation (radians) */
export function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

/** triangle count of an object tree */
export function triCount(o: THREE.Object3D): number {
  let t = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    t += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return Math.round(t);
}

/**
 * Draw-call diet: bake every static mesh under `g` into one mesh per material (+layer mask).
 * Meshes inside `keep` subtrees (animated parts, pulsing glows) stay separate.
 * Works for nested groups: geometry is baked relative to `g`.
 */
export function mergeStatic(g: THREE.Object3D, keep: (THREE.Object3D | undefined)[] = []): void {
  g.updateMatrixWorld(true);
  const inv = g.matrixWorld.clone().invert();
  const kept = new Set<THREE.Object3D>();
  for (const k of keep) k?.traverse((o) => kept.add(o));
  const byMat = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[]; layers: number; shadow: boolean }>();
  const mtx = new THREE.Matrix4();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || kept.has(m) || Array.isArray(m.material) || m.userData.noMerge) return;
    const mat = m.material as THREE.Material;
    const key = mat.uuid + '|' + m.layers.mask;
    let e = byMat.get(key);
    if (!e) byMat.set(key, (e = { mat, geos: [], meshes: [], layers: m.layers.mask, shadow: m.castShadow }));
    let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    mtx.multiplyMatrices(inv, m.matrixWorld);
    geo = geo.applyMatrix4(mtx);
    e.geos.push(geo);
    e.meshes.push(m);
  });
  for (const e of byMat.values()) {
    if (e.meshes.length < 2) continue;
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    for (const m of e.meshes) m.parent?.remove(m);
    const mesh = new THREE.Mesh(merged, e.mat);
    mesh.layers.mask = e.layers;
    mesh.castShadow = e.shadow;
    g.add(mesh);
  }
}
