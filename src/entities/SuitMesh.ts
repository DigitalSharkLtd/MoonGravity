import * as THREE from 'three';

/**
 * Reference suit mesh: one continuous, smooth-shaded pressure suit (torso, arms, legs, neck)
 * lofted along the bind-pose skeleton, with *blended* skin weights across every joint
 * (hips→spine→chest, chest→shoulder, shoulder→elbow, hip→knee, …) so the fabric bends
 * instead of the rigid-part look. Mid-poly (~2.5k tris) — enough silhouette for the
 * stylised look and clean deformation, cheap enough for 8 heroes on screen.
 *
 * Hard parts (helmet, armour plates, gloves, boots, packs) stay rigid on their bones; that is
 * physically right for a hard-shell suit and keeps the per-hero kits simple.
 */

export interface SuitRig {
  /** bind-pose model-space position of a bone */
  pos(name: string): THREE.Vector3;
  /** skeleton index of a bone */
  index(name: string): number;
}

interface Ring {
  c: THREE.Vector3; // centre
  t: THREE.Vector3; // tangent (direction of travel)
  n: THREE.Vector3; // first cross axis
  b: THREE.Vector3; // second cross axis
  rx: number; // radius along n
  ry: number; // radius along b
  bi: number[]; // up to 4 bone indices
  bw: number[]; // matching weights (sum 1)
  v: number; // texture v
}

/** bone name → weight */
type Wts = Record<string, number>;

/** blend two weight maps, keep the 4 strongest influences, normalise */
function mixW(a: Wts, b: Wts, f: number, I: (n: string) => number): { bi: number[]; bw: number[] } {
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(a)) m.set(k, (m.get(k) ?? 0) + v * (1 - f));
  for (const [k, v] of Object.entries(b)) m.set(k, (m.get(k) ?? 0) + v * f);
  const list = [...m.entries()].filter((e) => e[1] > 1e-4).sort((x, y) => y[1] - x[1]).slice(0, 4);
  const sum = list.reduce((acc, e) => acc + e[1], 0) || 1;
  const bi = [0, 0, 0, 0];
  const bw = [0, 0, 0, 0];
  list.forEach((e, i) => {
    bi[i] = I(e[0]);
    bw[i] = e[1] / sum;
  });
  return { bi, bw };
}

const SEG_T = 20; // radial segments: torso
const SEG_L = 12; // limbs

/** smooth 0→1 between a and b */
const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

class Loft {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];

  private vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, bi: number[], bw: number[]): number {
    const id = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.si.push(bi[0], bi[1], bi[2], bi[3]);
    this.sw.push(bw[0], bw[1], bw[2], bw[3]);
    return id;
  }

  /** closed tube through the rings; optional hemispherical end caps */
  tube(rings: Ring[], seg: number, capStart: boolean, capEnd: boolean): void {
    const _p = new THREE.Vector3();
    const _n = new THREE.Vector3();
    // radius slope along the path (for tilted normals on tapering sections)
    const slope = rings.map((r, i) => {
      const a = rings[Math.max(0, i - 1)];
      const b = rings[Math.min(rings.length - 1, i + 1)];
      const ds = a.c.distanceTo(b.c) || 1;
      return ((b.rx + b.ry) * 0.5 - (a.rx + a.ry) * 0.5) / ds;
    });
    const rows: number[][] = [];
    const ringVerts = (r: Ring, dr: number, v: number): number[] => {
      const row: number[] = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        _p.copy(r.c).addScaledVector(r.n, ca * r.rx).addScaledVector(r.b, sa * r.ry);
        _n.copy(r.n).multiplyScalar(ca / r.rx).addScaledVector(r.b, sa / r.ry).normalize().addScaledVector(r.t, -dr).normalize();
        row.push(this.vert(_p, _n, k / seg, v, r.bi, r.bw));
      }
      return row;
    };
    const dome = (r: Ring, dir: number): number[][] => {
      // hemisphere-ish cap: 3 shrinking rings + pole
      const out: number[][] = [];
      for (let j = 1; j <= 3; j++) {
        const th = (j / 4) * Math.PI * 0.5;
        const k = Math.cos(th);
        const off = Math.sin(th) * (r.rx + r.ry) * 0.5 * 0.9 * dir;
        const rr: Ring = { ...r, c: r.c.clone().addScaledVector(r.t, off), rx: r.rx * k, ry: r.ry * k, v: r.v + off };
        out.push(ringVerts(rr, -Math.tan(th) * dir, rr.v));
      }
      return out;
    };
    const pole = (r: Ring, dir: number): number => {
      const p = r.c.clone().addScaledVector(r.t, (r.rx + r.ry) * 0.5 * 0.9 * dir);
      return this.vert(p, r.t.clone().multiplyScalar(dir), 0.5, r.v + dir * 0.1, r.bi, r.bw);
    };
    let startPole = -1;
    if (capStart) {
      const d = dome(rings[0], -1).reverse();
      startPole = pole(rings[0], -1);
      rows.push(...d);
    }
    rings.forEach((r, i) => rows.push(ringVerts(r, slope[i], r.v)));
    let endPole = -1;
    if (capEnd) {
      rows.push(...dome(rings[rings.length - 1], 1));
      endPole = pole(rings[rings.length - 1], 1);
    }
    for (let j = 0; j < rows.length - 1; j++) {
      const A = rows[j];
      const Bn = rows[j + 1];
      for (let k = 0; k < seg; k++) this.idx.push(A[k], Bn[k], A[k + 1], A[k + 1], Bn[k], Bn[k + 1]);
    }
    if (startPole >= 0) {
      const R = rows[0];
      for (let k = 0; k < seg; k++) this.idx.push(startPole, R[k], R[k + 1]);
    }
    if (endPole >= 0) {
      const R = rows[rows.length - 1];
      for (let k = 0; k < seg; k++) this.idx.push(R[k], endPole, R[k + 1]);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Torso cross-sections: [height above feet (unscaled), half width, half depth, z offset] — shared
 * with the armour kits so chest / back / abdominal plates conform to the suit.
 */
export const TORSO_PROFILE: [number, number, number, number][] = [
  [0.76, 0.13, 0.12, 0.0],
  [0.82, 0.2, 0.15, 0.0],
  [0.9, 0.235, 0.165, 0.005],
  [0.99, 0.232, 0.162, 0.0],
  [1.06, 0.215, 0.155, -0.005],
  [1.14, 0.228, 0.162, -0.01],
  [1.23, 0.262, 0.178, -0.018],
  [1.32, 0.3, 0.19, -0.022],
  [1.41, 0.318, 0.192, -0.02],
  [1.48, 0.318, 0.185, -0.012],
  [1.54, 0.29, 0.172, -0.004],
  [1.59, 0.235, 0.155, 0.0],
  [1.625, 0.16, 0.13, 0.0],
  [1.645, 0.125, 0.115, 0.0],
];

/** suit torso skin weights at an (unscaled) height: hips → spine → chest (→ neck at the collar) */
export function torsoWeights(h: number, neck = true): Record<string, number> {
  if (h <= 1.16) return { hips: 1 - sstep(0.95, 1.16, h), spine: sstep(0.95, 1.16, h) };
  if (h <= 1.6 || !neck) return { spine: 1 - sstep(1.17, 1.36, h), chest: sstep(1.17, 1.36, h) };
  return { chest: 1 - sstep(1.6, 1.66, h) * 0.6, neck: sstep(1.6, 1.66, h) * 0.6 };
}

/** limb suit radii (unscaled, before bulk): [fraction along the bone chain, radius] */
export const ARM_RADII = { top: 0.118, upper: 0.112, lowUpper: 0.098, elbow: 0.094, fore: 0.098, lowFore: 0.085, wrist: 0.078 };
export const LEG_RADII = { top: 0.13, thigh: 0.135, lowThigh: 0.112, knee: 0.108, calf: 0.11, lowCalf: 0.093, ankle: 0.088 };

/** frame for a path segment: tangent + two perpendicular axes (ref keeps them stable) */
function frame(t: THREE.Vector3, ref: THREE.Vector3): { n: THREE.Vector3; b: THREE.Vector3 } {
  const b = new THREE.Vector3().crossVectors(t, ref);
  if (b.lengthSq() < 1e-6) b.crossVectors(t, new THREE.Vector3(1, 0, 0));
  b.normalize();
  const n = new THREE.Vector3().crossVectors(b, t).normalize();
  // same handedness as the torso rings (n × b = -t) so every tube winds outward
  return { n: b, b: n };
}

export interface SuitShape {
  bulk: number; // overall girth (1 = standard, reactor ~1.25, slim scouts ~0.9)
  scale: number; // root bone scale (heights already include it via rig.pos)
  /** puffy pressure-suit folds at elbows / knees (0..1) */
  folds: number;
}

/**
 * Build the continuous suit (indexed; the caller converts / merges).
 * Coordinates are in bind-pose model space, i.e. already scaled by the root bone.
 */
export function buildSuit(rig: SuitRig, shape: SuitShape): THREE.BufferGeometry {
  const L = new Loft();
  const s = shape.scale;
  const k = shape.bulk;
  const hipsY = rig.pos('hips').y;
  const I = (n: string) => rig.index(n);

  // ---- torso: pelvis → waist → chest → shoulders → neck base -------------------------------
  const prof = TORSO_PROFILE;
  const up = new THREE.Vector3(0, 1, 0);
  const torso: Ring[] = prof.map(([h, w, d, z]) => {
    const y = h * s;
    // weights: hips → spine (0.95–1.16), spine → chest (1.17–1.36), chest → neck at the collar
    const wts: Wts = torsoWeights(h);
    return { c: new THREE.Vector3(0, y, z * s), t: up.clone(), n: new THREE.Vector3(1, 0, 0), b: new THREE.Vector3(0, 0, 1), rx: w * k * s, ry: d * k * s, ...mixW(wts, wts, 0, I), v: h * 2.2 };
  });
  L.tube(torso, SEG_T, true, false);

  // ---- neck (short soft collar under the helmet ring) -----------------------------------
  const nb = rig.pos('neck');
  const hb = rig.pos('head');
  const neckRings: Ring[] = [0, 0.5, 1].map((f) => ({
    c: new THREE.Vector3(0, THREE.MathUtils.lerp(nb.y - 0.03 * s, hb.y + 0.02 * s, f), 0),
    t: up.clone(),
    n: new THREE.Vector3(1, 0, 0),
    b: new THREE.Vector3(0, 0, 1),
    rx: (0.12 - f * 0.02) * s,
    ry: (0.11 - f * 0.02) * s,
    ...mixW({ neck: 1 }, { head: 1 }, f, I),
    v: 4 + f * 0.3,
  }));
  L.tube(neckRings, SEG_L, false, true);

  // ---- limbs ----------------------------------------------------------------------------------
  const folds = shape.folds;
  const limb = (pts: { p: THREE.Vector3; r: number; w: Wts }[], capStart: boolean, ref: THREE.Vector3, foldAt: number[]): void => {
    // resample the polyline into rings (~every 4 cm)
    const rings: Ring[] = [];
    let v = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b2 = pts[i + 1];
      const len = a.p.distanceTo(b2.p);
      const n = Math.max(2, Math.round(len / (0.045 * s)));
      const t = b2.p.clone().sub(a.p).normalize();
      const fr = frame(t, ref);
      for (let j = 0; j < n; j++) {
        const f = j / n;
        const c = a.p.clone().lerp(b2.p, f);
        let r = THREE.MathUtils.lerp(a.r, b2.r, f);
        // bellows folds near joints
        for (const fa of foldAt) {
          const d = c.distanceTo(pts[fa].p) / s;
          if (d < 0.07) r *= 1 + folds * 0.06 * Math.cos((d / 0.07) * Math.PI * 1.5) * (1 - d / 0.07);
        }
        rings.push({ c, t: t.clone(), n: fr.n, b: fr.b, rx: r * k * s, ry: r * k * s * 0.96, ...mixW(a.w, b2.w, f, I), v });
        v += (len / n) * 3;
      }
    }
    const last = pts[pts.length - 1];
    const lt = last.p.clone().sub(pts[pts.length - 2].p).normalize();
    const lf = frame(lt, ref);
    rings.push({ c: last.p.clone(), t: lt, n: lf.n, b: lf.b, rx: last.r * k * s, ry: last.r * k * s * 0.96, ...mixW(last.w, last.w, 0, I), v });
    L.tube(rings, SEG_L, capStart, true);
  };

  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    // arm: deltoid cap overlapping the shoulder, blend chest→arm, elbow blend arm→fore
    const sh = rig.pos('arm' + side);
    const el = rig.pos('fore' + side);
    const wr = rig.pos('hand' + side);
    const top = sh.clone().add(new THREE.Vector3(-sx * 0.02 * s, 0.03 * s, 0));
    const arm = 'arm' + side;
    const fore = 'fore' + side;
    limb(
      [
        { p: top, r: 0.118, w: { chest: 0.45, [arm]: 0.55 } },
        { p: sh.clone().lerp(el, 0.22), r: 0.112, w: { [arm]: 1 } },
        { p: sh.clone().lerp(el, 0.8), r: 0.098, w: { [arm]: 0.9, [fore]: 0.1 } },
        { p: el.clone(), r: 0.094, w: { [arm]: 0.5, [fore]: 0.5 } },
        { p: el.clone().lerp(wr, 0.22), r: 0.098, w: { [arm]: 0.08, [fore]: 0.92 } },
        { p: el.clone().lerp(wr, 0.8), r: 0.085, w: { [fore]: 1 } },
        { p: wr.clone().add(new THREE.Vector3(0, 0.02 * s, 0)), r: 0.078, w: { [fore]: 0.85, ['hand' + side]: 0.15 } },
      ],
      true,
      new THREE.Vector3(0, 0, 1),
      [3],
    );
    // leg: thigh top hidden in the pelvis, hip blend hips→leg, knee blend leg→shin
    const hp = rig.pos('leg' + side);
    const kn = rig.pos('shin' + side);
    const an = rig.pos('foot' + side);
    const leg = 'leg' + side;
    const shin = 'shin' + side;
    limb(
      [
        { p: hp.clone().add(new THREE.Vector3(0, 0.06 * s, 0)), r: 0.13, w: { hips: 0.55, [leg]: 0.45 } },
        { p: hp.clone().lerp(kn, 0.2), r: 0.135, w: { [leg]: 1 } },
        { p: hp.clone().lerp(kn, 0.82), r: 0.112, w: { [leg]: 0.9, [shin]: 0.1 } },
        { p: kn.clone(), r: 0.108, w: { [leg]: 0.5, [shin]: 0.5 } },
        { p: kn.clone().lerp(an, 0.2), r: 0.11, w: { [leg]: 0.08, [shin]: 0.92 } },
        { p: kn.clone().lerp(an, 0.75), r: 0.093, w: { [shin]: 1 } },
        { p: an.clone().add(new THREE.Vector3(0, 0.1 * s, 0)), r: 0.088, w: { [shin]: 0.8, ['foot' + side]: 0.2 } },
      ],
      false,
      new THREE.Vector3(0, 0, 1),
      [3],
    );
  }
  void hipsY;
  return L.geometry();
}
