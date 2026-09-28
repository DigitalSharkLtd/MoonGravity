import * as THREE from 'three';
import { StructureBuilder, Frame, Mat, TEAM_COLORS } from './Builder';
import type { Collider } from '../core/Physics';
import { chamferBox, prismXZ, extrudeProfile, sphereBand, chamferCyl } from './KitGeo';
import { Rng } from '../core/Rng';

/**
 * Architectural kit: reusable, collider-correct building blocks in a local frame.
 *
 * Conventions: local +x / +z / +y, lengths in metres, `y` relative to the frame origin (usually
 * a levelled flat). Floors are 4 m apart (FLOOR), doorways 2.2 × 2.7 m, stairs ≤ 32°.
 * Everything is merged per material by the StructureBuilder; only structural pieces get colliders.
 * Metal colliders (default) are mag-boot walkable; regolith / sandbags / glass railings are not.
 */

export const FLOOR = 4;
export const SLAB = 0.35;
export const DOOR_W = 2.2;
export const DOOR_H = 2.7;

const Y = new THREE.Vector3(0, 1, 0);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export const qY = (a: number) => new THREE.Quaternion().setFromAxisAngle(Y, a);
export const qAxis = (x: number, y: number, z: number, a: number) => new THREE.Quaternion().setFromAxisAngle(V(x, y, z).normalize(), a);

export type Side = 'n' | 's' | 'e' | 'w';

export interface BoxOpts {
  bevel?: number;
  collide?: boolean;
  metal?: boolean;
  noShoot?: boolean;
  rot?: number;
  tilt?: THREE.Quaternion;
  seg?: number;
  faces?: number;
  uo?: number[];
}

export interface Opening {
  /** centre along the wall, measured from its start point */
  u: number;
  w: number;
  h: number;
  sill?: number;
  kind?: 'door' | 'window' | 'gap';
  /** window glazing: warm glow, transparent tint, or open */
  glass?: 'warm' | 'tint' | 'blue' | 'none';
  team?: number | null;
  /** door frame accent */
  accent?: Mat;
  /** doorway spill lights (default on for doors) */
  light?: boolean;
  /** don't record a walk test through this door */
  noTest?: boolean;
}

export interface WallOpts {
  collide?: boolean;
  metal?: boolean;
  bevel?: number;
  /** cornice along the top */
  cap?: Mat | null;
  /** skirting along the bottom */
  base?: Mat | null;
  /** interior lining on one side (+1 = local +z / left of travel) */
  lining?: { side: 1 | -1; mat: Mat; h?: number; rail?: Mat };
  /** exterior pilasters every n metres on a side */
  ribs?: { side: 1 | -1; every: number; mat: Mat; depth?: number };
  /** light colour for doorways */
  doorLight?: THREE.ColorRepresentation;
  seg?: number;
}

export function teamMat(team: number | null | undefined): Mat {
  return team === 0 ? 'team0' : team === 1 ? 'team1' : 'orange';
}
export function teamGlow(team: number | null | undefined): Mat {
  return team === 0 ? 'team0Glow' : team === 1 ? 'team1Glow' : 'neonWarm';
}
export function teamLight(team: number | null | undefined): number {
  return team === 0 ? TEAM_COLORS[0].glow : team === 1 ? TEAM_COLORS[1].glow : 0xffc98a;
}
export const WARM = 0xffc98a;
export const WARM2 = 0xffb46a;
export const COOL = 0x9fdcff;

/** Local-frame builder. */
let slabN = 0;

export class Kit {
  constructor(
    public b: StructureBuilder,
    public f: Frame,
  ) {}

  /** child frame at local (x, y, z) rotated by rot */
  at(x: number, z: number, rot = 0, y = 0): Kit {
    const p = this.p(x, y, z);
    return new Kit(this.b, { x: p.x, y: p.y, z: p.z, rot: this.f.rot + rot });
  }
  p(x: number, y: number, z: number): THREE.Vector3 {
    return this.b.tf(this.f, x, y, z);
  }
  d(x: number, y: number, z: number): THREE.Vector3 {
    const c = Math.cos(this.f.rot);
    const s = Math.sin(this.f.rot);
    return V(x * c + z * s, y, -x * s + z * c);
  }
  q(rotY = 0, tilt?: THREE.Quaternion): THREE.Quaternion {
    const q = qY(this.f.rot + rotY);
    return tilt ? q.multiply(tilt) : q;
  }
  /** terrain height relative to this frame at local (x, z) */
  ground(x: number, z: number): number {
    const p = this.p(x, 0, z);
    return this.b.ground(p.x, p.z) - this.f.y;
  }
  /** world AABB of a local box */
  aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, pad = 0.08): THREE.Box3 {
    const bb = new THREE.Box3();
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) bb.expandByPoint(this.p(x, y, z));
    return bb.expandByScalar(pad);
  }

  // ---------------------------------------------------------------- primitives

  /** chamfered box (centre x,y,z) */
  box(x: number, y: number, z: number, w: number, h: number, d: number, mat: Mat, o: BoxOpts = {}): Collider | null {
    const bev = o.bevel ?? Math.min(0.1, 0.18 * Math.min(w, h, d));
    const g = chamferBox(w, h, d, bev, o.seg ?? 2.5, o.uo ?? [x, y, z], o.faces ?? 63);
    const q = this.q(o.rot ?? 0, o.tilt);
    const c = this.p(x, y, z);
    // floors / decks / slabs that overlap in one plane z-fight (flicker): lift each flat slab's visual
    // by a different 1–8 mm so one always wins (colliders are untouched)
    const flat = !o.tilt && h < 0.6 && w > 0.6 && d > 0.6;
    this.b.add(mat, g, flat ? c.clone().setY(c.y + ((slabN++ % 8) + 1) * 0.001) : c, q);
    if (o.collide === false) return null;
    return this.b.world.addBox(c, V(w / 2, h / 2, d / 2), q, o.metal ?? true, o.noShoot ? { noShoot: true } : {});
  }
  /** box spanning local corners (axis aligned in this frame) */
  span(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: Mat, o: BoxOpts = {}): Collider | null {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), mat, o);
  }
  /** vertical cylinder (centre) with chamfered rims */
  cyl(x: number, y: number, z: number, r: number, h: number, mat: Mat, o: { bevel?: number; collide?: boolean; metal?: boolean; seg?: number; caps?: boolean; tilt?: THREE.Quaternion } = {}): Collider | null {
    const g = chamferCyl(r, h, o.bevel ?? Math.min(0.08, r * 0.2), o.seg ?? 20, [x, y, z], o.caps ?? true);
    const q = this.q(0, o.tilt);
    const c = this.p(x, y, z);
    this.b.add(mat, g, c, q);
    if (o.collide === false) return null;
    return this.b.world.addCylinder(c, r, h / 2, q, o.metal ?? true);
  }
  /** horizontal cylinder along local x (axis = 'x') or z */
  cylH(x: number, y: number, z: number, r: number, len: number, axis: 'x' | 'z', mat: Mat, o: { bevel?: number; collide?: boolean; metal?: boolean; seg?: number; caps?: boolean } = {}): Collider | null {
    const tilt = axis === 'x' ? qAxis(0, 0, 1, Math.PI / 2) : qAxis(1, 0, 0, Math.PI / 2);
    return this.cyl(x, y, z, r, len, mat, { ...o, tilt });
  }
  /** round or square beam between two local points */
  beam(a: [number, number, number], c: [number, number, number], t: number, mat: Mat, o: { collide?: boolean; round?: boolean; metal?: boolean } = {}): void {
    this.b.beam(this.p(...a), this.p(...c), t, mat, o);
  }
  /** decal / emissive quad facing local normal (nx, ny, nz) */
  panel(x: number, y: number, z: number, w: number, h: number, nx: number, ny: number, nz: number, mat: Mat): void {
    this.b.panel(this.p(x, y, z), w, h, this.d(nx, ny, nz).normalize(), mat);
  }
  prism(poly: [number, number][], y0: number, y1: number, mat: Mat, o: { seg?: number } = {}): void {
    const g = prismXZ(poly, y0, y1, o.seg ?? 2.5, [0, 0, 0]);
    this.b.add(mat, g, this.p(0, 0, 0), this.q());
  }
  /** profile (u = along local x of the child, v = up) extruded along the segment a→b */
  extrude(ax: number, az: number, bx: number, bz: number, y: number, profile: [number, number][], mat: Mat, o: { seg?: number; caps?: boolean } = {}): void {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az), bx - ax) + Math.PI / 2; // local z of the extrusion runs a→b
    const k = this.at((ax + bx) / 2, (az + bz) / 2, rot, y);
    const g = extrudeProfile(profile, len, o.seg ?? 2.5, [0, 0, 0], o.caps ?? true);
    this.b.add(mat, g, k.p(0, 0, 0), k.q());
  }
  light(x: number, y: number, z: number, color: THREE.ColorRepresentation = WARM, intensity = 5, radius = 9, o: { bounds?: THREE.Box3; shadow?: boolean; dir?: [number, number, number]; cone?: number } = {}): void {
    this.b.light(this.p(x, y, z), color, intensity, radius, { bounds: o.bounds, shadow: o.shadow, dir: o.dir ? this.d(...o.dir).normalize() : undefined, cone: o.cone });
  }
  beacon(x: number, y: number, z: number, color: THREE.ColorRepresentation = 0xff3a2a, period = 1.6, phase = 0): void {
    this.b.beacon(this.p(x, y, z), color, period, phase);
  }
  test(name: string, a: [number, number, number], c: [number, number, number]): void {
    this.b.testPaths.push({ name, from: this.p(...a), to: this.p(...c) });
  }
  /** keep a local box clear of props */
  reserve(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.b.reserved.push(this.aabb(x0, y0, z0, x1, y1, z1, 0));
  }
  /** true (and counted) if a prop footprint centred at local (x, z) overlaps a reserved zone */
  blocked(x: number, z: number, w: number, d: number, y = 0, rot = 0): boolean {
    const c = Math.abs(Math.cos(rot));
    const s = Math.abs(Math.sin(rot));
    const hw = (w * c + d * s) / 2;
    const hd = (w * s + d * c) / 2;
    const bb = this.aabb(x - hw, y + 0.05, z - hd, x + hw, y + 1.5, z + hd, -0.05);
    for (const r of this.b.reserved) if (r.intersectsBox(bb)) {
      this.b.skipped++;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- floors

  /**
   * Floor slab (top at `top`) over a rectangle minus rectangular holes (stairwells, atria).
   * Decomposed into few boxes; `under` paints a ceiling panel layer with light fixtures.
   */
  slab(x0: number, z0: number, x1: number, z1: number, top: number, thick: number, mat: Mat, o: { holes?: [number, number, number, number][]; metal?: boolean; collide?: boolean; edge?: Mat | null; under?: Mat | null; seg?: number } = {}): void {
    const holes = (o.holes ?? []).map(([a, b, c, d]) => [Math.max(x0, Math.min(a, c)), Math.max(z0, Math.min(b, d)), Math.min(x1, Math.max(a, c)), Math.min(z1, Math.max(b, d))]).filter((h) => h[2] > h[0] && h[3] > h[1]);
    const xs = [x0, x1];
    for (const h of holes) xs.push(h[0], h[2]);
    const ux = [...new Set(xs.map((v) => +v.toFixed(3)))].sort((a, b) => a - b);
    const rects: [number, number, number, number][] = [];
    let prev: { xa: number; iv: [number, number][] } | null = null;
    const flush = (xb: number) => {
      if (!prev) return;
      for (const [za, zb] of prev.iv) rects.push([prev.xa, za, xb, zb]);
    };
    for (let i = 0; i < ux.length - 1; i++) {
      const xa = ux[i];
      const xb = ux[i + 1];
      if (xb - xa < 1e-3) continue;
      const mid = (xa + xb) / 2;
      let iv: [number, number][] = [[z0, z1]];
      for (const h of holes) {
        if (mid < h[0] || mid > h[2]) continue;
        const nv: [number, number][] = [];
        for (const [za, zb] of iv) {
          if (h[3] <= za || h[1] >= zb) nv.push([za, zb]);
          else {
            if (h[1] > za) nv.push([za, h[1]]);
            if (h[3] < zb) nv.push([h[3], zb]);
          }
        }
        iv = nv;
      }
      const same = prev && prev.iv.length === iv.length && prev.iv.every((p, k) => Math.abs(p[0] - iv[k][0]) < 1e-3 && Math.abs(p[1] - iv[k][1]) < 1e-3);
      if (same) continue;
      flush(xa);
      prev = { xa, iv };
    }
    flush(x1);
    for (const [a, bz, c, d] of rects) {
      if (c - a < 0.02 || d - bz < 0.02) continue;
      this.span(a, top - thick, bz, c, top, d, mat, { collide: o.collide, metal: o.metal, bevel: 0.04, seg: o.seg ?? 2 });
      if (o.under) this.span(a + 0.02, top - thick - 0.04, bz + 0.02, c - 0.02, top - thick, d - 0.02, o.under, { collide: false, bevel: 0, seg: o.seg ?? 2, faces: 8 });
    }
    if (o.edge) {
      // chunky edge band around holes (catches light, reads as a floor edge)
      for (const h of holes) {
        this.span(h[0] - 0.08, top - thick - 0.05, h[1] - 0.08, h[2] + 0.08, top - thick + 0.12, h[1] + 0.06, o.edge, { collide: false });
        this.span(h[0] - 0.08, top - thick - 0.05, h[3] - 0.06, h[2] + 0.08, top - thick + 0.12, h[3] + 0.08, o.edge, { collide: false });
      }
    }
  }

  // ---------------------------------------------------------------- walls

  /**
   * Straight wall from (ax,az) to (bx,bz), base y0, height h, thickness t, with door / window openings.
   * Built from solid segments (colliders), lintels and sills, plus trims, frames, glass and door lights.
   */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, h: number, t: number, mat: Mat, openings: Opening[] = [], o: WallOpts = {}): void {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const rot = Math.atan2(-(bz - az), bx - ax);
    const k = this.at((ax + bx) / 2, (az + bz) / 2, rot, y0);
    const ops = openings.slice().sort((p, q) => p.u - q.u);
    const bo: BoxOpts = { collide: o.collide, metal: o.metal, bevel: o.bevel ?? 0.06, seg: o.seg ?? 2 };
    const L = len / 2;
    const solids: [number, number][] = [];
    let cur = 0;
    const piece = (u0: number, u1: number, v0: number, v1: number) => {
      if (u1 - u0 < 0.03 || v1 - v0 < 0.03) return;
      const cx = (u0 + u1) / 2 - L;
      k.box(cx, (v0 + v1) / 2, 0, u1 - u0, v1 - v0, t, mat, { ...bo, uo: [(u0 + u1) / 2, (v0 + v1) / 2 + y0, 0] });
    };
    for (const op of ops) {
      const u0 = Math.max(0, op.u - op.w / 2);
      const u1 = Math.min(len, op.u + op.w / 2);
      const sill = op.sill ?? 0;
      const top = Math.min(h, sill + op.h);
      piece(cur, u0, 0, h);
      if (u0 - cur > 0.03) solids.push([cur, u0]);
      piece(u0, u1, top, h);
      piece(u0, u1, 0, sill);
      cur = u1;
      this.openingDressing(k, op, u0 - L, u1 - L, sill, top, t, y0, o);
    }
    piece(cur, len, 0, h);
    if (len - cur > 0.03) solids.push([cur, len]);
    // trims
    if (o.cap !== null) k.box(0, h - 0.12, 0, len + 0.04, 0.26, t + 0.18, o.cap ?? 'trim', { collide: false, bevel: 0.07 });
    if (o.base) for (const [u0, u1] of solids) k.box((u0 + u1) / 2 - L, 0.16, 0, u1 - u0, 0.32, t + 0.1, o.base, { collide: false, bevel: 0.05 });
    if (o.lining) {
      const s = o.lining.side;
      const lh = o.lining.h ?? 1.25;
      for (const [u0, u1] of solids) {
        if (u1 - u0 < 0.2) continue;
        k.box((u0 + u1) / 2 - L, lh / 2 + 0.02, s * (t / 2 + 0.03), u1 - u0, lh, 0.06, o.lining.mat, { collide: false, bevel: 0.02 });
        k.box((u0 + u1) / 2 - L, lh + 0.05, s * (t / 2 + 0.06), u1 - u0, 0.07, 0.1, o.lining.rail ?? 'brass', { collide: false, bevel: 0.02 });
      }
    }
    if (o.ribs) {
      const s = o.ribs.side;
      const dd = o.ribs.depth ?? 0.22;
      for (let u = o.ribs.every / 2; u < len - 0.3; u += o.ribs.every) {
        if (ops.some((op) => Math.abs(op.u - u) < op.w / 2 + 0.35)) continue;
        k.box(u - L, h / 2 - 0.1, s * (t / 2 + dd / 2), 0.4, h - 0.2, dd, o.ribs.mat, { collide: false, bevel: 0.06 });
      }
    }
  }

  private openingDressing(k: Kit, op: Opening, x0: number, x1: number, sill: number, top: number, t: number, y0: number, o: WallOpts): void {
    const kind = op.kind ?? (sill > 0.05 ? 'window' : 'door');
    const w = x1 - x0;
    const cx = (x0 + x1) / 2;
    if (kind === 'door') {
      const accent = op.accent ?? (op.team !== undefined && op.team !== null ? teamMat(op.team) : 'trim');
      // chunky jambs + header
      for (const s of [-1, 1]) k.box(s < 0 ? x0 + 0.06 : x1 - 0.06, top / 2, 0, 0.24, top, t + 0.2, 'trim', { collide: false, bevel: 0.06 });
      k.box(cx, top + 0.14, 0, w + 0.3, 0.3, t + 0.24, accent, { collide: false, bevel: 0.08 });
      for (const s of [-1, 1]) {
        k.panel(cx, top + 0.14, s * (t / 2 + 0.13), w - 0.2, 0.16, 0, 0, s, 'hazard');
        k.box(cx, top - 0.05, s * (t / 2 + 0.05), w - 0.3, 0.06, 0.08, teamGlow(op.team), { collide: false, bevel: 0 });
      }
      k.box(cx, 0.03, 0, w - 0.1, 0.06, t + 0.3, 'grid', { collide: false, bevel: 0.02 });
      if (op.light !== false) {
        const col = op.team !== undefined && op.team !== null ? teamLight(op.team) : (o.doorLight ?? WARM);
        for (const s of [-1, 1]) k.light(cx, top - 0.3, s * (t / 2 + 0.9), col, 2.6, 5.5);
      }
      if (!op.noTest) k.test('door', [cx, 0.3, -(t / 2 + 1.6)], [cx, 0.3, t / 2 + 1.6]);
      k.reserve(x0 - 0.2, sill, -(t / 2 + 1.5), x1 + 0.2, top, t / 2 + 1.5);
      void y0;
    } else if (kind === 'window') {
      const g = op.glass ?? 'warm';
      // frame
      k.box(cx, sill - 0.06, 0, w + 0.3, 0.14, t + 0.26, 'trim', { collide: false, bevel: 0.05 });
      k.box(cx, top + 0.06, 0, w + 0.22, 0.14, t + 0.16, 'trim', { collide: false, bevel: 0.05 });
      for (const s of [-1, 1]) k.box(s < 0 ? x0 + 0.05 : x1 - 0.05, (sill + top) / 2, 0, 0.12, top - sill, t + 0.14, 'trim', { collide: false, bevel: 0.04 });
      if (g === 'warm' || g === 'blue') {
        k.box(cx, (sill + top) / 2, 0, w - 0.08, top - sill, 0.06, g === 'warm' ? 'glassWarm' : 'glassBlue', { bevel: 0, noShoot: false });
        if (w > 1.6) k.box(cx, (sill + top) / 2, 0, 0.08, top - sill, t * 0.6, 'trim', { collide: false, bevel: 0.02 });
      } else if (g === 'tint') {
        k.box(cx, (sill + top) / 2, 0, w - 0.08, top - sill, 0.05, 'glassTint', { bevel: 0, noShoot: false, metal: false }); // armoured glass: stops shots (and bot sight)
        for (let u = x0 + 1.6; u < x1 - 0.5; u += 1.6) k.box(u, (sill + top) / 2, 0, 0.08, top - sill, 0.14, 'trim', { collide: false, bevel: 0.02 });
      }
    } else {
      // gap: simple frame
      for (const s of [-1, 1]) k.box(s < 0 ? x0 + 0.05 : x1 - 0.05, (sill + top) / 2, 0, 0.14, top - sill, t + 0.14, 'trim', { collide: false, bevel: 0.04 });
    }
  }

  /**
   * Rectangular room shell (x0..x1, z0..z1) from y0 with walls of height h; per-side openings
   * (u measured from the side's start: n/s sides from x0, e/w sides from z0). Adds bounded warm light.
   */
  room(x0: number, z0: number, x1: number, z1: number, y0: number, h: number, t: number, mat: Mat, open: Partial<Record<Side, Opening[]>>, o: WallOpts & { light?: THREE.ColorRepresentation | null; lightI?: number; fixtures?: boolean; skip?: Side[] } = {}): void {
    const sides: [Side, number, number, number, number, 1 | -1][] = [
      ['s', x0, z0, x1, z0, 1], // runs +x at z0, interior is +z (lining side +1)
      ['n', x0, z1, x1, z1, -1],
      ['w', x0, z0, x0, z1, -1],
      ['e', x1, z0, x1, z1, 1],
    ];
    for (const [side, ax, az, bx, bz, ls] of sides) {
      if (o.skip?.includes(side)) continue;
      // extend e/w walls by t/2 to close corners
      const ext = side === 'w' || side === 'e' ? t / 2 : -t / 2;
      const dz = side === 'w' || side === 'e' ? 1 : 0;
      const a0: [number, number] = dz ? [ax, az - ext] : [ax + t / 2, az];
      const b0: [number, number] = dz ? [bx, bz + ext] : [bx - t / 2, bz];
      const ops = (open[side] ?? []).map((op) => ({ ...op, u: op.u + (dz ? ext : -t / 2) }));
      // lining side: for a wall running +x, local +z is world -z (rot=0 frame maps local z to +z)... compute via direction
      const lining = o.lining ? { ...o.lining, side: this.innerSide(a0, b0, (x0 + x1) / 2, (z0 + z1) / 2) } : undefined;
      const ribs = o.ribs ? { ...o.ribs, side: (-this.innerSide(a0, b0, (x0 + x1) / 2, (z0 + z1) / 2)) as 1 | -1 } : undefined;
      void ls;
      this.wall(a0[0], a0[1], b0[0], b0[1], y0, h, t, mat, ops, { ...o, lining, ribs });
    }
    if (o.light !== null) this.roomLights(x0 + t / 2, z0 + t / 2, x1 - t / 2, z1 - t / 2, y0, y0 + h - 0.05, o.light ?? WARM, o.lightI ?? 6, o.fixtures ?? true);
  }

  /** which local side (+1/-1 of the wall's own z) faces the point (cx, cz) */
  innerSide(a: [number, number], b: [number, number], cx: number, cz: number): 1 | -1 {
    const rot = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    // wall local +z in this frame = (sin rot, cos rot)
    const lz = [Math.sin(rot), Math.cos(rot)];
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    return (cx - mx) * lz[0] + (cz - mz) * lz[1] > 0 ? 1 : -1;
  }

  /** ceiling light fixtures + bounded baked lights over a floor area */
  roomLights(x0: number, z0: number, x1: number, z1: number, y0: number, ceil: number, color: THREE.ColorRepresentation = WARM, intensity = 6, fixtures = true): void {
    const w = x1 - x0;
    const d = z1 - z0;
    const nx = Math.max(1, Math.round(w / 6));
    const nz = Math.max(1, Math.round(d / 6));
    const bounds = this.aabb(x0, y0 - 0.1, z0, x1, ceil + 0.3, z1, 0.08);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = x0 + ((i + 0.5) * w) / nx;
        const z = z0 + ((j + 0.5) * d) / nz;
        if (fixtures) {
          this.box(x, ceil - 0.06, z, 1.4, 0.12, 0.5, 'trim', { collide: false, bevel: 0.03 });
          this.box(x, ceil - 0.13, z, 1.2, 0.03, 0.34, 'neonWarm', { collide: false, bevel: 0 });
        }
        this.light(x, ceil - 0.5, z, color, intensity, Math.max(7, Math.min(12, Math.max(w / nx, d / nz) * 1.3)), { bounds });
      }
    }
  }

  // ---------------------------------------------------------------- circulation

  /**
   * Stairs from bottom (x0,z0,y0) to top (x1,z1,y1): visual steps + one smooth tilted ramp collider
   * (metal, so mag-boots keep contact). Slope is clamped by the caller (≤ 32° recommended).
   */
  stairs(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, width: number, o: { mat?: Mat; style?: 'solid' | 'open'; rails?: 'both' | 'l' | 'r' | 'none'; railMat?: Mat; test?: boolean; light?: boolean; metal?: boolean; foot?: boolean; tread?: Mat } = {}): void {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const H = y1 - y0;
    const rot = Math.atan2(-(z1 - z0), x1 - x0);
    const k = this.at(x0, z0, rot, y0); // local x = run, y = rise, z = width
    const n = Math.max(2, Math.round(H / 0.26));
    const rise = H / n;
    const run = L / n;
    const mat = o.mat ?? 'darkPanel';
    if ((o.style ?? 'solid') === 'solid') {
      const prof: [number, number][] = [[0, 0]];
      for (let i = 0; i < n; i++) {
        prof.push([i * run, (i + 1) * rise]);
        prof.push([(i + 1) * run, (i + 1) * rise]);
      }
      prof.push([L, 0]);
      // extrude along local z (width) → use a child whose extrusion axis is local z
      const g = extrudeProfile(prof, width, 2, [0, 0, 0]);
      this.b.add(mat, g, k.p(0, 0, 0), k.q());
      // nosing strips
      for (let i = 0; i < n; i += 1) k.box((i + 0.08) * run, (i + 1) * rise - 0.02, 0, 0.1, 0.05, width - 0.1, i % 2 ? 'yellow' : 'trim', { collide: false, bevel: 0.01 });
      // the solid body under the ramp collides too (you could walk into a solid-looking flight)
      const m = Math.max(1, Math.ceil(L / 0.9));
      for (let j = 1; j < m; j++) {
        const xa = (j * L) / m;
        const top = (xa * H) / L - 0.1;
        if (top < 0.3) continue;
        this.b.world.addBox(k.p(xa + L / m / 2, top / 2, 0), V(L / m / 2, top / 2, width / 2), k.q(), false);
      }
    } else {
      for (let i = 0; i < n; i++) k.box((i + 0.5) * run, (i + 1) * rise - 0.05, 0, run + 0.04, 0.1, width - 0.2, o.tread ?? 'grid', { collide: false, bevel: 0.02 });
      const sa = Math.atan2(H, L);
      for (const s of [-1, 1]) k.box(L / 2, H / 2 - 0.12, (s * width) / 2 - s * 0.08, Math.hypot(L, H) + 0.1, 0.34, 0.14, mat, { collide: false, bevel: 0.04, tilt: qAxis(0, 0, 1, sa) });
    }
    // ramp collider through the nosings, flush with both floors (a lip at the top edge would snag
    // mag-boots: the support probe prefers the nearest metal edge)
    const ang = Math.atan2(H, L);
    const len = Math.hypot(L, H);
    const th = 0.5;
    const off = 0;
    const cx = L / 2 + Math.sin(ang) * (th / 2);
    const cy = H / 2 + off - Math.cos(ang) * (th / 2);
    const q = k.q(0, qAxis(0, 0, 1, ang));
    const metal = o.metal ?? true;
    // foot on regolith / sintered pads (non-metal): the lowest ~0.45 m of the ramp is non-metal so the
    // terrain hand-over rule releases the mag-boots cleanly when walking off the bottom
    const split = metal && o.foot ? Math.min(L * 0.3, 0.45 / Math.tan(ang)) : 0;
    if (split > 0) {
      const seg = (a0: number, a1: number, m: boolean) => {
        const sl = (a1 - a0) / Math.cos(ang);
        const mx = (a0 + a1) / 2;
        const my = mx * Math.tan(ang);
        this.b.world.addBox(k.p(mx + Math.sin(ang) * (th / 2), my - Math.cos(ang) * (th / 2), 0), V(sl / 2, th / 2, width / 2), q, m);
      };
      seg(0, split, false);
      seg(split, L, true);
    } else this.b.world.addBox(k.p(cx, cy, 0), V(len / 2, th / 2, width / 2), q, metal);
    void off;
    k.reserve(-1.2, 0, -width / 2 - 0.1, L + 1.2, H + 2, width / 2 + 0.1);
    const rails = o.rails ?? 'both';
    for (const s of [-1, 1]) {
      if (rails === 'none' || (rails === 'l' && s < 0) || (rails === 'r' && s > 0)) continue;
      const z = s * (width / 2 - 0.06);
      k.beam([0, 1.0, z], [L, H + 1.0, z], 0.08, o.railMat ?? 'yellow', { round: true });
      for (let u = 0.2; u <= L; u += Math.max(1.2, L / 5)) k.beam([u, (u / L) * H + rise * 0.5, z], [u, (u / L) * H + 1.0, z], 0.06, 'steel', { round: true });
      k.beam([L, H, z], [L, H + 1.0, z], 0.06, 'steel', { round: true });
    }
    if (o.test !== false) k.test('stairs', [-1.0, 0.3, 0], [L + 1.0, H + 0.3, 0]);
    // stair audit hook (scripts/audit/stairs.mjs): bottom, top and the exit point past the top
    const SD = (globalThis as { __mgStairDebug?: unknown[] }).__mgStairDebug;
    if (SD) {
      const [a, c, e] = [k.p(0, 0, 0), k.p(L, H, 0), k.p(L + 1.2, H, 0)];
      SD.push({ a: [a.x, a.y, a.z], c: [c.x, c.y, c.z], e: [e.x, e.y, e.z], w: width, st: (new Error().stack ?? '').split('\n').slice(2, 5).map((l) => l.trim()).join(' | ') });
    }
  }

  /** Straight ramp (smooth slab), e.g. vehicle ramps and glacis walks. */
  ramp(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, width: number, mat: Mat = 'grid', o: { metal?: boolean; thick?: number; test?: boolean } = {}): void {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const H = y1 - y0;
    const rot = Math.atan2(-(z1 - z0), x1 - x0);
    const k = this.at(x0, z0, rot, y0);
    const ang = Math.atan2(H, L);
    const len = Math.hypot(L, H);
    const th = o.thick ?? 0.4;
    k.box(L / 2 + Math.sin(ang) * (th / 2), H / 2 - Math.cos(ang) * (th / 2), 0, len + 0.05, th, width, mat, { tilt: qAxis(0, 0, 1, ang), metal: o.metal ?? true, bevel: 0.06 });
    if (o.test !== false) k.test('ramp', [-1.2, 0.3, 0], [L + 1.2, H + 0.3, 0]);
  }

  /** Railing along a segment at deck height y (thin non-metal collider, bullets pass). */
  railing(ax: number, az: number, bx: number, bz: number, y: number, o: { h?: number; mat?: Mat; collide?: boolean; glass?: boolean; post?: Mat } = {}): void {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.1) return;
    const rot = Math.atan2(-(bz - az), bx - ax);
    const k = this.at((ax + bx) / 2, (az + bz) / 2, rot, y);
    const h = o.h ?? 1.05;
    const L = len / 2;
    const n = Math.max(1, Math.round(len / 1.6));
    for (let i = 0; i <= n; i++) k.box(-L + (i * len) / n, h / 2, 0, 0.09, h, 0.09, o.post ?? 'steel', { collide: false, bevel: 0.02 });
    k.box(0, h, 0, len + 0.06, 0.09, 0.12, o.mat ?? 'yellow', { collide: false, bevel: 0.03 });
    if (o.glass) k.box(0, h * 0.5, 0, len - 0.1, h * 0.8, 0.04, 'glassTint', { collide: false, bevel: 0 });
    else k.box(0, h * 0.5, 0, len, 0.06, 0.06, 'steel', { collide: false, bevel: 0.01 });
    if (o.collide !== false) this.b.world.addBox(k.p(0, h / 2 + 0.05, 0), V(len / 2, h / 2 + 0.05, 0.06), k.q(), false, { noShoot: true });
  }

  /** Column with bevelled plinth and capital. */
  column(x: number, z: number, y0: number, h: number, s: number, mat: Mat, o: { round?: boolean; cap?: Mat; collide?: boolean } = {}): void {
    const cap = o.cap ?? 'trim';
    if (o.round) this.cyl(x, y0 + h / 2, z, s / 2, h, mat, { collide: o.collide, seg: 16 });
    else this.box(x, y0 + h / 2, z, s, h, s, mat, { collide: o.collide, bevel: 0.08 });
    this.box(x, y0 + 0.18, z, s + 0.24, 0.36, s + 0.24, cap, { collide: false, bevel: 0.07 });
    this.box(x, y0 + h - 0.16, z, s + 0.3, 0.32, s + 0.3, cap, { collide: false, bevel: 0.08 });
  }

  /** Arch between two piers (a→b is the opening); collider: piers + haunches + crown. */
  arch(ax: number, az: number, bx: number, bz: number, y0: number, spring: number, depth: number, mat: Mat, o: { pier?: number; thick?: number; accent?: Mat; segs?: number } = {}): void {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az), bx - ax);
    const k = this.at((ax + bx) / 2, (az + bz) / 2, rot, y0);
    const p = o.pier ?? 1.0;
    const R = len / 2;
    const th = o.thick ?? 0.9;
    for (const s of [-1, 1]) {
      k.box(s * (R + p / 2), spring / 2, 0, p, spring, depth, mat, { bevel: 0.1 });
      k.box(s * (R + p / 2), 0.25, 0, p + 0.3, 0.5, depth + 0.3, o.accent ?? 'trim', { collide: false });
    }
    const segs = o.segs ?? 9;
    for (let i = 0; i < segs; i++) {
      const a0 = Math.PI - (i / segs) * Math.PI;
      const a1 = Math.PI - ((i + 1) / segs) * Math.PI;
      const am = (a0 + a1) / 2;
      const rr = R + th / 2;
      const chord = 2 * rr * Math.sin((a0 - a1) / 2) + 0.05;
      k.box(Math.cos(am) * rr, spring + Math.sin(am) * rr, 0, chord, th, depth, i === Math.floor(segs / 2) ? (o.accent ?? mat) : mat, { rot: 0, tilt: qAxis(0, 0, 1, am - Math.PI / 2), collide: false, bevel: 0.06 });
    }
    // collider: haunches and crown blocks above the springing line
    for (const s of [-1, 1]) this.b.world.addBox(k.p(s * (R * 0.78), spring + R * 0.45, 0), V(R * 0.3, R * 0.45, depth / 2), k.q(), true);
    this.b.world.addBox(k.p(0, spring + R + th * 0.5, 0), V(R * 0.6, th * 0.5, depth / 2), k.q(), true);
    // keystone lamp
    k.light(0, spring + R * 0.6, depth / 2 + 1, WARM2, 2.5, 6);
    k.light(0, spring + R * 0.6, -depth / 2 - 1, WARM2, 2.5, 6);
  }

  /** Grating catwalk with C-channel edges, optional rails and under-lights. */
  catwalk(ax: number, az: number, bx: number, bz: number, y: number, width: number, o: { rails?: 'both' | 'l' | 'r' | 'none'; lights?: boolean; posts?: number; railMat?: Mat } = {}): void {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az), bx - ax);
    const k = this.at((ax + bx) / 2, (az + bz) / 2, rot, y);
    k.box(0, -0.1, 0, len, 0.2, width, 'grid', { bevel: 0.03, seg: 2 });
    for (const s of [-1, 1]) k.box(0, -0.28, s * (width / 2 - 0.08), len, 0.36, 0.16, 'trim', { collide: false, bevel: 0.03 });
    const rails = o.rails ?? 'both';
    for (const s of [-1, 1]) {
      if (rails === 'none' || (rails === 'l' && s < 0) || (rails === 'r' && s > 0)) continue;
      k.railing(-len / 2, s * (width / 2 - 0.05), len / 2, s * (width / 2 - 0.05), 0, { mat: o.railMat ?? 'yellow' });
    }
    if (o.lights !== false) {
      for (let u = -len / 2 + 2; u < len / 2 - 1; u += 5) {
        k.box(u, -0.47, 0, 0.8, 0.05, 0.2, 'neonWarm', { collide: false, bevel: 0 });
        k.light(u, -0.8, 0, WARM, 3.2, 6.5, { dir: [0, -1, 0], cone: 0.2 });
      }
    }
    if (o.posts) {
      for (let u = -len / 2 + 1; u <= len / 2 - 0.9; u += o.posts) {
        for (const s of [-1, 1]) {
          const gz = s * (width / 2 - 0.2);
          const g = k.ground(u, gz);
          if (g > -0.6 || k.blocked(u, gz, 0.4, 0.4, g)) continue;
          k.box(u, (g - 0.4) / 2, gz, 0.26, -g + 0.4, 0.26, 'darkPanel', { bevel: 0.04 });
        }
      }
    }
  }

  /** Balcony slab projecting from a facade (local +z outward), with railing and brackets. */
  balcony(x: number, z: number, rot: number, w: number, depth: number, y: number, o: { mat?: Mat; rail?: Mat; glass?: boolean } = {}): void {
    const k = this.at(x, z, rot, y);
    k.box(0, -0.15, depth / 2, w, 0.3, depth, o.mat ?? 'cream', { bevel: 0.06 });
    k.box(0, -0.34, depth - 0.1, w + 0.1, 0.12, 0.3, 'trim', { collide: false });
    k.railing(-w / 2 + 0.05, depth - 0.08, w / 2 - 0.05, depth - 0.08, 0, { glass: o.glass, mat: o.rail ?? 'brass' });
    k.railing(-w / 2 + 0.05, 0.1, -w / 2 + 0.05, depth - 0.08, 0, { glass: o.glass, mat: o.rail ?? 'brass' });
    k.railing(w / 2 - 0.05, 0.1, w / 2 - 0.05, depth - 0.08, 0, { glass: o.glass, mat: o.rail ?? 'brass' });
    for (const s of [-1, 1]) k.beam([s * (w / 2 - 0.4), -1.6, 0.05], [s * (w / 2 - 0.4), -0.3, depth - 0.3], 0.18, 'trim');
    k.light(0, -0.6, depth * 0.6, WARM, 2.4, 5, { dir: [0, -1, 0], cone: 0.1 });
  }

  // ---------------------------------------------------------------- dressing

  /** pipe run through local points with flanged joints (colliders optional, metal) */
  pipe(pts: [number, number, number][], r: number, mat: Mat = 'steel', o: { collide?: boolean; flange?: Mat } = {}): void {
    for (let i = 0; i < pts.length - 1; i++) this.beam(pts[i], pts[i + 1], r * 2, mat, { round: true, collide: o.collide });
    for (let i = 0; i < pts.length; i++) {
      const [x, y, z] = pts[i];
      this.b.sphere(this.p(x, y, z), r * 1.18, o.flange ?? 'trim', { seg: 10 });
    }
  }
  /** wall vent box facing local normal (nx, nz) */
  vent(x: number, y: number, z: number, w: number, h: number, nx: number, nz: number): void {
    const rot = Math.atan2(nx, nz);
    const k = this.at(x, z, rot, y);
    k.box(0, 0, 0.1, w, h, 0.2, 'vent', { collide: false, bevel: 0.04 });
    for (let v = -h / 2 + 0.12; v < h / 2 - 0.08; v += 0.16) k.box(0, v, 0.22, w - 0.14, 0.05, 0.05, 'dark', { collide: false, bevel: 0 });
  }
  /** sign board with a label material */
  sign(x: number, y: number, z: number, w: number, h: number, nx: number, nz: number, label: Mat, frame: Mat = 'trim'): void {
    const rot = Math.atan2(nx, nz);
    const k = this.at(x, z, rot, y);
    k.box(0, 0, 0.06, w + 0.2, h + 0.2, 0.12, frame, { collide: false, bevel: 0.04 });
    k.panel(0, 0, 0.13, w, h, 0, 0, 1, label);
    k.light(0, h / 2 + 0.3, 0.9, WARM, 1.6, 4);
  }
  /** facade greebles: random boxes / vents / conduits in a rectangle on a wall face (local plane z = zf facing +nz) */
  greebles(x0: number, x1: number, y0: number, y1: number, zf: number, nz: 1 | -1, seed: number, density = 1): void {
    const rng = new Rng(seed);
    const area = (x1 - x0) * (y1 - y0);
    const n = Math.floor(area * 0.12 * density);
    for (let i = 0; i < n; i++) {
      const w = rng.range(0.3, 1.2);
      const h = rng.range(0.2, 0.8);
      const d = rng.range(0.08, 0.25);
      const x = rng.range(x0 + w / 2, x1 - w / 2);
      const y = rng.range(y0 + h / 2, y1 - h / 2);
      this.box(x, y, zf + (nz * d) / 2, w, h, d, rng.pick(['darkPanel', 'hullGray', 'vent', 'trim'] as Mat[]), { collide: false, bevel: 0.03 });
    }
    // conduits
    const c = Math.max(1, Math.floor((x1 - x0) / 5));
    for (let i = 0; i < c; i++) {
      const y = rng.range(y0 + 0.3, y1 - 0.3);
      this.beam([x0 + 0.2, y, zf + nz * 0.12], [x1 - 0.2, y, zf + nz * 0.12], 0.1, rng.chance(0.5) ? 'steel' : 'brass', { round: true });
    }
  }

  // ---------------------------------------------------------------- props (collider = simple box)

  console(x: number, z: number, rot: number, y = 0, screen: Mat = 'screen'): void {
    if (this.blocked(x, z, 1.7, 0.9, y, rot)) return;
    const k = this.at(x, z, rot, y);
    k.box(0, 0.45, 0, 1.6, 0.9, 0.7, 'darkPanel', { bevel: 0.06, metal: false });
    k.box(0, 0.93, -0.05, 1.7, 0.08, 0.8, 'trim', { collide: false, bevel: 0.03 });
    k.box(0, 1.28, -0.25, 1.5, 0.6, 0.1, 'dark', { collide: false, bevel: 0.03, tilt: qAxis(1, 0, 0, -0.35) });
    k.panel(0, 1.29, -0.19, 1.3, 0.48, 0, 0.34, 1, screen);
    k.panel(0, 0.98, 0.18, 1.2, 0.18, 0, 1, 0.3, 'screenAmber');
  }
  locker(x: number, z: number, rot: number, n = 3, y = 0, mat: Mat = 'teal'): void {
    const w = n * 0.62;
    if (this.blocked(x, z, w, 0.6, y, rot)) return;
    const k = this.at(x, z, rot, y);
    k.box(0, 1.0, 0, w, 2.0, 0.6, mat, { bevel: 0.04, metal: false });
    for (let i = 0; i < n; i++) {
      const lx = -w / 2 + 0.31 + i * 0.62;
      k.box(lx, 1.0, 0.31, 0.02, 1.9, 0.02, 'dark', { collide: false, bevel: 0 });
      for (let v = 0; v < 3; v++) k.box(lx, 1.6 + v * 0.08, 0.31, 0.34, 0.03, 0.02, 'dark', { collide: false, bevel: 0 });
      k.box(lx + 0.2, 1.05, 0.32, 0.04, 0.2, 0.03, 'brass', { collide: false, bevel: 0 });
    }
  }
  crate(x: number, z: number, rot: number, s = 1.2, y = 0, mat: Mat = 'darkPanel'): void {
    if (this.blocked(x, z, s, s, y, rot)) return;
    const k = this.at(x, z, rot, y);
    k.box(0, s / 2, 0, s, s, s, mat, { bevel: 0.08, metal: false });
    k.box(0, s / 2, 0, s + 0.04, s * 0.16, s + 0.04, 'yellow', { collide: false, bevel: 0.02 });
  }
  table(x: number, z: number, rot: number, w = 2, d = 1, y = 0, top: Mat = 'wood'): void {
    if (this.blocked(x, z, w, d, y, rot)) return;
    const k = this.at(x, z, rot, y);
    k.box(0, 0.76, 0, w, 0.08, d, top, { bevel: 0.03 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * (w / 2 - 0.12), 0.37, sz * (d / 2 - 0.12), 0.08, 0.74, 0.08, 'trim', { collide: false, bevel: 0.01 });
    this.b.world.addBox(k.p(0, 0.4, 0), V(w / 2, 0.4, d / 2), k.q(), false);
  }
  rack(x: number, z: number, rot: number, y = 0): void {
    if (this.blocked(x, z, 0.8, 1.0, y, rot)) return;
    const k = this.at(x, z, rot, y);
    k.box(0, 1.05, 0, 0.8, 2.1, 1.0, 'dark', { bevel: 0.04, metal: false });
    for (let v = 0; v < 7; v++) {
      k.box(0, 0.3 + v * 0.26, 0.51, 0.64, 0.18, 0.02, 'darkPanel', { collide: false, bevel: 0 });
      k.box(-0.22 + (v % 3) * 0.08, 0.3 + v * 0.26, 0.525, 0.05, 0.03, 0.01, v % 2 ? 'screen' : 'screenAmber', { collide: false, bevel: 0 });
    }
  }
  bunk(x: number, z: number, rot: number, y = 0): void {
    if (this.blocked(x, z, 2.2, 1.0, y, rot)) return;
    const k = this.at(x, z, rot, y);
    for (const lv of [0.45, 1.55]) {
      k.box(0, lv, 0, 2.1, 0.14, 0.95, 'trim', { collide: false, bevel: 0.03 });
      k.box(0, lv + 0.14, 0, 1.95, 0.16, 0.85, 'fabric', { collide: false, bevel: 0.06 });
      k.box(-0.8, lv + 0.27, 0, 0.35, 0.12, 0.7, 'paintWhite', { collide: false, bevel: 0.05 });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * 1.02, 1.0, sz * 0.44, 0.07, 2.0, 0.07, 'steel', { collide: false, bevel: 0.01 });
    this.b.world.addBox(k.p(0, 1.0, 0), V(1.08, 1.0, 0.5), k.q(), false);
  }
  /** hydroponic tray with plants and magenta grow lights */
  planter(x: number, z: number, rot: number, len = 3, y = 0, seed = 1, tray: Mat = 'teal'): void {
    if (this.blocked(x, z, len, 1.0, y, rot)) return;
    const k = this.at(x, z, rot, y);
    const rng = new Rng(seed);
    k.box(0, 0.4, 0, len, 0.8, 1.0, tray, { bevel: 0.06, metal: false });
    k.box(0, 0.79, 0, len - 0.16, 0.06, 0.84, 'soil', { collide: false, bevel: 0 });
    const n = Math.floor(len * 2.2);
    for (let i = 0; i < n; i++) {
      const px = -len / 2 + 0.3 + ((i + 0.5) * (len - 0.6)) / n;
      const s = rng.range(0.22, 0.4);
      const g = new THREE.IcosahedronGeometry(s, 0);
      this.b.add(rng.chance(0.5) ? 'plant' : 'plantDark', g, k.p(px, 0.85 + s * 0.6, rng.range(-0.22, 0.22)), qY(rng.next() * 6), V(1, rng.range(0.9, 1.6), 1));
    }
    k.box(0, 2.1, 0, len - 0.2, 0.08, 0.3, 'trim', { collide: false, bevel: 0.02 });
    k.box(0, 2.05, 0, len - 0.4, 0.03, 0.2, 'growPink', { collide: false, bevel: 0 });
    for (const s of [-1, 1]) k.beam([s * (len / 2 - 0.2), 0.8, 0], [s * (len / 2 - 0.2), 2.1, 0], 0.05, 'steel', { round: true });
    k.light(0, 1.6, 0, 0xff7ad8, 1.6, 3.5);
  }
  chair(x: number, z: number, rot: number, y = 0, mat: Mat = 'orange'): void {
    if (this.blocked(x, z, 0.5, 0.5, y, rot)) return;
    const k = this.at(x, z, rot, y);
    const cush: Mat = mat === 'teal' ? 'fabricTeal' : mat === 'orange' ? 'fabricOrange' : mat;
    k.box(0, 0.45, 0, 0.5, 0.12, 0.5, cush, { collide: false, bevel: 0.05 });
    k.box(0, 0.75, -0.22, 0.5, 0.55, 0.1, cush, { collide: false, bevel: 0.05 });
    k.box(0, 0.22, 0, 0.08, 0.44, 0.08, 'steel', { collide: false, bevel: 0 });
  }
  sofa(x: number, z: number, rot: number, w = 2.2, y = 0, mat: Mat = 'teal'): void {
    if (this.blocked(x, z, w, 0.9, y, rot)) return;
    const k = this.at(x, z, rot, y);
    k.box(0, 0.25, 0, w, 0.5, 0.9, 'trim', { bevel: 0.05, metal: false });
    const cush: Mat = mat === 'teal' ? 'fabricTeal' : mat === 'orange' ? 'fabricOrange' : mat;
    for (let i = 0; i < Math.max(1, Math.round(w / 1.1)); i++) {
      const n = Math.max(1, Math.round(w / 1.1));
      const cw = (w - 0.1) / n;
      k.box(-w / 2 + 0.05 + cw * (i + 0.5), 0.58, 0.05, cw - 0.04, 0.24, 0.8, cush, { collide: false, bevel: 0.1 });
      k.box(-w / 2 + 0.05 + cw * (i + 0.5), 0.9, -0.33, cw - 0.04, 0.6, 0.24, cush, { collide: false, bevel: 0.1 });
    }
    for (const s of [-1, 1]) k.box((s * w) / 2, 0.62, 0, 0.2, 0.5, 0.9, cush, { collide: false, bevel: 0.08 });
  }
  barrels(x: number, z: number, n: number, y = 0, mat: Mat = 'orange'): void {
    if (this.blocked(x, z, 2, 2, y)) return;
    for (let i = 0; i < n; i++) {
      const a = i * 2.1;
      const r = i === 0 ? 0 : 0.7;
      this.cyl(x + Math.cos(a) * r, y + 0.55, z + Math.sin(a) * r, 0.34, 1.1, i % 2 ? 'hullGray' : mat, { seg: 12, metal: false });
      this.cyl(x + Math.cos(a) * r, y + 0.8, z + Math.sin(a) * r, 0.36, 0.08, 'trim', { seg: 12, collide: false });
    }
  }
  /** decorative gun turret emplacement (team coloured) */
  turret(x: number, z: number, rot: number, y = 0, team: number | null = null): void {
    const k = this.at(x, z, rot, y);
    k.cyl(0, 0.35, 0, 1.3, 0.7, 'darkPanel', { seg: 12 });
    k.cyl(0, 0.9, 0, 0.8, 0.5, 'dark', { seg: 12, collide: false });
    k.box(0, 1.45, 0, 1.4, 0.8, 1.2, teamMat(team), { bevel: 0.12 });
    k.box(0.1, 1.45, 0, 1.2, 0.5, 1.3, 'darkPanel', { collide: false, bevel: 0.06 });
    for (const s of [-1, 1]) {
      k.beam([0.6, 1.5, s * 0.25], [2.6, 1.55, s * 0.25], 0.14, 'dark', { round: true });
      k.beam([2.2, 1.55, s * 0.25], [2.7, 1.56, s * 0.25], 0.2, 'trim', { round: true });
    }
    k.box(-0.4, 1.9, 0, 0.5, 0.12, 0.5, teamGlow(team), { collide: false, bevel: 0 });
  }
  /** street / flood lamp with a baked downlight pool */
  lampPost(x: number, z: number, rot = 0, y = 0, h = 4.2, color: THREE.ColorRepresentation = WARM): void {
    const k = this.at(x, z, rot, y);
    k.cyl(0, 0.2, 0, 0.28, 0.4, 'trim', { seg: 10, collide: false });
    k.beam([0, 0, 0], [0, h, 0], 0.14, 'trim', { round: true, collide: true });
    k.beam([0, h, 0], [0.7, h + 0.1, 0], 0.1, 'trim', { round: true });
    k.box(0.8, h, 0, 0.6, 0.18, 0.36, 'dark', { collide: false, bevel: 0.04 });
    k.box(0.8, h - 0.1, 0, 0.5, 0.03, 0.28, 'neonWarm', { collide: false, bevel: 0 });
    k.light(0.8, h - 0.5, 0, color, 7, 11, { dir: [0, -1, 0], cone: -0.2 });
  }

  // ---------------------------------------------------------------- set dressing (open ground)

  /** six-wheeled pressurised rover: cabin + cargo bed + mast; ~2.6 m tall stand cover */
  rover(x: number, z: number, rot: number, y = 0, accent: Mat = 'orange', seed = 1): void {
    if (this.blocked(x, z, 2.6, 5, y, rot)) return;
    const k = this.at(x, z, rot, y);
    const rng = new Rng(seed * 97 + 13);
    k.box(0, 0.78, 0, 2.2, 0.42, 4.7, 'darkPanel', { collide: false, bevel: 0.1 });
    k.box(0, 1.72, 0.95, 2.2, 1.5, 2.6, 'hull', { collide: false, bevel: 0.28 });
    k.box(0, 2.5, 0.95, 1.8, 0.12, 2.1, accent, { collide: false, bevel: 0.04 });
    k.box(0, 1.35, 2.22, 2.24, 0.16, 0.2, accent, { collide: false, bevel: 0.04 });
    k.panel(0, 1.95, 2.26, 1.6, 0.62, 0, 0.3, 1, 'glassBlue');
    for (const sx of [-1, 1]) k.panel(sx * 1.11, 1.95, 1.1, 1.0, 0.45, sx, 0, 0, 'glassBlue');
    k.box(0, 1.22, -1.45, 2.2, 0.46, 1.7, 'hullGray', { collide: false, bevel: 0.06 });
    // cargo: crates / an O2 tank on the bed
    if (rng.chance(0.5)) k.box(0.35, 1.72, -1.5, 1.0, 0.55, 0.9, 'darkPanel', { collide: false, bevel: 0.06 });
    else k.cylH(0.2, 1.8, -1.5, 0.36, 1.5, 'x', 'hull', { collide: false, seg: 12 });
    k.box(-0.55, 1.62, -1.2, 0.5, 0.35, 0.5, 'yellow', { collide: false, bevel: 0.05 });
    for (const sx of [-1.22, 1.22])
      for (const sz of [-1.65, 0, 1.65]) {
        k.cylH(sx, 0.52, sz, 0.52, 0.34, 'x', 'rubber', { seg: 14, collide: false });
        k.cylH(sx * 1.04, 0.52, sz, 0.2, 0.06, 'x', 'steel', { seg: 10, collide: false });
      }
    // mast + dish + headlamps
    k.beam([-0.7, 2.5, 0.4], [-0.7, 3.5, 0.4], 0.06, 'steel', { round: true });
    k.cyl(-0.7, 3.55, 0.4, 0.28, 0.08, 'paintWhite', { collide: false, seg: 12, tilt: qAxis(1, 0, 0, 0.5) });
    for (const sx of [-0.7, 0.7]) k.box(sx, 1.35, 2.34, 0.34, 0.12, 0.04, 'lamp', { collide: false, bevel: 0 });
    k.light(0, 1.2, 3.6, WARM, 3.5, 7, { dir: [0, -0.25, 1], cone: 0.25 });
    this.b.world.addBox(k.p(0, 1.3, 0.1), V(1.2, 1.15, 2.4), k.q(), true);
  }

  /** lattice comms mast (tripod) with dish and blinking beacon: skyline landmark, thin collider */
  antennaMast(x: number, z: number, h = 12, y = 0, seed = 1): void {
    const k = this.at(x, z, seed * 0.7, y);
    const r0 = 0.95;
    const r1 = 0.28;
    const pt = (i: number, t: number): [number, number, number] => {
      const a = (i / 3) * Math.PI * 2;
      const r = r0 + (r1 - r0) * t;
      return [Math.cos(a) * r, t * h, Math.sin(a) * r];
    };
    k.cyl(0, 0.2, 0, r0 + 0.4, 0.4, 'concrete', { metal: false, seg: 12 });
    for (let i = 0; i < 3; i++) {
      k.beam(pt(i, 0), pt(i, 1), 0.12, 'paintWhite', { round: true });
      for (let t = 0; t < 1; t += 0.14) {
        k.beam(pt(i, t), pt(i + 1, t + 0.07), 0.04, 'steel', { round: true });
        k.beam(pt(i, t + 0.07), pt(i + 1, t + 0.07), 0.04, 'steel', { round: true });
      }
    }
    for (const t of [0.55, 0.8]) k.box(0, t * h, 0, 0.5, 0.9, 0.18, 'orange', { collide: false, bevel: 0.03, rot: t * 4 });
    k.cyl(0.3, h * 0.92, 0, 0.7, 0.12, 'paintWhite', { collide: false, seg: 16, tilt: qAxis(0, 0, 1, -1.1) });
    k.beacon(0, h + 0.4, 0, 0xff3a2a, 1.7, seed * 0.37);
    this.b.world.addCylinder(k.p(0, h / 2, 0), 0.35, h / 2, k.q(), true);
  }

  /** horizontal fuel / O2 tank on saddles (~2.4 m cover) */
  fuelTank(x: number, z: number, rot: number, y = 0, len = 4.6, mat: Mat = 'hull', band: Mat = 'teal'): void {
    if (this.blocked(x, z, 2.4, len + 0.6, y, rot)) return;
    const k = this.at(x, z, rot, y);
    const r = 1.05;
    k.cylH(0, r + 0.35, 0, r, len, 'z', mat, { seg: 20, collide: false });
    for (const s of [-1, 1]) {
      k.b.sphere(k.p(0, r + 0.35, s * (len / 2)), r * 0.98, mat, { seg: 16 });
      k.box(0, 0.4, s * (len / 2 - 0.8), 1.8, 0.8, 0.4, 'darkPanel', { collide: false, bevel: 0.05 });
      k.cylH(0, r + 0.35, s * (len / 2 - 0.8), r + 0.03, 0.18, 'z', band, { seg: 20, collide: false });
    }
    k.panel(r + 0.01, r + 0.45, 0, 1.6, 0.7, 1, 0, 0, 'hazard');
    k.pipe([[0, 2 * r + 0.35, len / 2 - 0.6], [0, 2 * r + 0.7, len / 2 - 0.6], [0.8, 2 * r + 0.7, len / 2 - 0.6]], 0.08, 'steel');
    this.b.world.addBox(k.p(0, r + 0.3, 0), V(r, r + 0.25, len / 2 + r * 0.7), k.q(), true);
  }

  /** cable reel on its rim (crouch cover ~1.3 m) */
  cableReel(x: number, z: number, rot: number, y = 0, r = 0.68): void {
    if (this.blocked(x, z, 1.1, 2 * r, y, rot)) return;
    const k = this.at(x, z, rot, y);
    for (const s of [-1, 1]) k.cylH(s * 0.42, r, 0, r, 0.08, 'x', 'wood', { seg: 16, collide: false });
    k.cylH(0, r, 0, r * 0.72, 0.76, 'x', 'dark', { seg: 16, collide: false });
    k.cylH(0, r, 0, 0.16, 1.0, 'x', 'steel', { seg: 8, collide: false });
    this.b.world.addBox(k.p(0, r, 0), V(0.47, r, r * 0.9), k.q(), false);
  }

  /** scattered wreckage: bent panels, a strut, a crate lid (no collision beyond ankle height) */
  debris(x: number, z: number, seed: number, y = 0, spread = 2.2): void {
    const rng = new Rng(seed * 131 + 7);
    const k = this.at(x, z, rng.range(0, 6), y);
    const n = 3 + Math.floor(rng.next() * 4);
    for (let i = 0; i < n; i++) {
      const px = rng.range(-spread, spread);
      const pz = rng.range(-spread, spread);
      const kind = rng.next();
      const tilt = qAxis(rng.range(-1, 1), 0.2, rng.range(-1, 1), rng.range(0.1, 0.5));
      if (kind < 0.45) k.box(px, 0.08, pz, rng.range(0.6, 1.4), 0.05, rng.range(0.5, 1.1), rng.pick(['hullGray', 'darkPanel', 'hull', 'yellow'] as Mat[]), { collide: false, bevel: 0.01, rot: rng.range(0, 3), tilt });
      else if (kind < 0.7) k.beam([px, 0.1, pz], [px + rng.range(-1.6, 1.6), rng.range(0.1, 0.6), pz + rng.range(-1.6, 1.6)], 0.1, rng.chance(0.5) ? 'steel' : 'yellow');
      else if (kind < 0.85) k.cylH(px, 0.18, pz, 0.18, rng.range(0.6, 1.2), rng.chance(0.5) ? 'x' : 'z', 'hullGray', { collide: false, seg: 8 });
      else k.box(px, 0.2, pz, 0.5, 0.4, 0.5, 'darkPanel', { collide: false, bevel: 0.04, rot: rng.range(0, 3) });
    }
  }

  /** objective / wayfinding sign on two posts */
  signPost(x: number, z: number, rot: number, label: Mat, y = 0, w = 2.4, h = 1.2): void {
    if (this.blocked(x, z, w, 0.4, y, rot)) return;
    const k = this.at(x, z, rot, y);
    for (const s of [-1, 1]) k.box(s * (w / 2 - 0.15), 1.2, 0, 0.12, 2.4, 0.12, 'trim', { collide: false, bevel: 0.02 });
    k.box(0, 2.3, -0.04, w + 0.16, h + 0.16, 0.08, 'trim', { collide: false, bevel: 0.03 });
    k.panel(0, 2.3, 0.01, w, h, 0, 0, 1, label);
    k.panel(0, 2.3, -0.09, w, h, 0, 0, -1, label);
    k.box(0, 2.3 + h / 2 + 0.12, 0.1, w * 0.8, 0.06, 0.1, 'neonWarm', { collide: false, bevel: 0 });
    this.b.world.addBox(k.p(0, 1.2, 0), V(w / 2, 0.08, 0.08), k.q(), true);
  }

  /** ore / spoil stockpile (walkable regolith heap with a crest); `len` along local x */
  stockpile(x: number, z: number, rot: number, len = 9, h = 3.2, y = 0): void {
    const k = this.at(x, z, rot, y);
    k.berm(-len / 2, 0, len / 2, 0, h, 1.4, 7, 0, 'dirt');
    // conical ends (angle of repose) instead of cut faces
    for (const s of [-1, 1]) {
      const g = new THREE.ConeGeometry(3.6, h + 0.4, 12, 1, true);
      this.b.add('dirt', g, k.p(s * (len / 2), (h + 0.4) / 2 - 0.4, 0), k.q());
      this.b.world.addSphere(k.p(s * (len / 2 + 0.6), -0.3, 0), 2.3, false);
    }
    const rng = new Rng(Math.floor(Math.abs(x * 7 + z * 13)));
    for (let i = 0; i < 5; i++) {
      const g = new THREE.DodecahedronGeometry(rng.range(0.35, 0.7), 0);
      this.b.add('oreRock', g, k.p(rng.range(-len / 2 + 1, len / 2 - 1), rng.range(0.2, 0.6), rng.chance(0.5) ? 2.8 : -2.8), qY(rng.next() * 6), V(1, 0.7, 1));
    }
  }

  // ---------------------------------------------------------------- fortification (non-metal)

  sandbags(ax: number, az: number, bx: number, bz: number, h = 1.0, y = 0): void {
    const prof: [number, number][] = [
      [-0.55, 0],
      [0.55, 0],
      [0.45, h * 0.55],
      [0.3, h],
      [-0.3, h],
      [-0.45, h * 0.55],
    ];
    this.extrude(ax, az, bx, bz, y, prof, 'sandbag', { seg: 3 });
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az), bx - ax);
    const k = this.at((ax + bx) / 2, (az + bz) / 2, rot, y);
    this.b.world.addBox(k.p(0, h / 2, 0), V(len / 2 + 0.3, h / 2, 0.45), k.q(), false);
  }
  /** regolith-filled mesh barrier line (Hesco) */
  hesco(ax: number, az: number, bx: number, bz: number, h = 1.4, y = 0, rows = 1): void {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az), bx - ax);
    const k = this.at((ax + bx) / 2, (az + bz) / 2, rot, y);
    const n = Math.max(1, Math.round(len / 1.1));
    const s = len / n;
    for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) k.box(-len / 2 + (i + 0.5) * s, h / 2 + r * h, 0, s - 0.04, h, 1.05, 'hesco', { collide: false, bevel: 0.05 });
    this.b.world.addBox(k.p(0, (h * rows) / 2, 0), V(len / 2, (h * rows) / 2, 0.52), k.q(), false);
  }
  /**
   * Line of precast concrete T-wall panels ("Alaska" blast barriers, ~1.5 m each) from a→b: blocks
   * standing sightlines into gates / spawn doors. Non-metal; optional painted stripe (team colour).
   */
  tWall(ax: number, az: number, bx: number, bz: number, h = 3.4, y = 0, stripe: Mat | null = 'hazard'): void {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az), bx - ax);
    const k = this.at((ax + bx) / 2, (az + bz) / 2, rot, y);
    const n = Math.max(1, Math.round(len / 1.5));
    const pw = len / n;
    const prof: [number, number][] = [
      [-0.62, 0],
      [0.62, 0],
      [0.62, 0.32],
      [0.2, 0.52],
      [0.16, h - 0.08],
      [0.08, h],
      [-0.08, h],
      [-0.16, h - 0.08],
      [-0.2, 0.52],
      [-0.62, 0.32],
    ];
    for (let i = 0; i < n; i++) {
      const u0 = -len / 2 + i * pw + 0.03;
      const u1 = u0 + pw - 0.06;
      k.extrude(u0, 0, u1, 0, 0, prof, 'concrete', { seg: 3 });
      // lifting loops + stencil band
      k.box((u0 + u1) / 2, h + 0.06, 0, 0.3, 0.12, 0.08, 'steel', { collide: false, bevel: 0.02 });
      if (stripe) for (const s of [-1, 1]) k.panel((u0 + u1) / 2, h * 0.62, s * 0.18, pw - 0.3, 0.3, 0, 0, s, i % 2 ? stripe : 'trim');
    }
    this.b.world.addBox(k.p(0, h / 2, 0), V(len / 2, h / 2, 0.3), k.q(), false);
    this.b.world.addBox(k.p(0, 0.22, 0), V(len / 2, 0.22, 0.6), k.q(), false);
  }
  /** concrete jersey barrier (serpentine checkpoints) */
  jersey(x: number, z: number, rot: number, len = 3, y = 0): void {
    const k = this.at(x, z, rot, y);
    const prof: [number, number][] = [
      [-0.35, 0],
      [0.35, 0],
      [0.3, 0.25],
      [0.14, 0.4],
      [0.12, 0.9],
      [-0.12, 0.9],
      [-0.14, 0.4],
      [-0.3, 0.25],
    ];
    k.extrude(-len / 2, 0, len / 2, 0, 0, prof, 'concrete', { seg: 3 });
    for (const s of [-1, 1]) k.panel(0, 0.6, s * 0.135, len * 0.8, 0.12, 0, 0, s, 'hazard');
    this.b.world.addBox(k.p(0, 0.45, 0), V(len / 2, 0.45, 0.3), k.q(), false);
  }
  /**
   * Regolith berm (trapezoid) along a→b: blast deflection walls, glacis, reactor shielding.
   * Slopes ≤ ~50° are walkable; collider = core box + two tilted slope boxes (non-metal).
   */
  berm(ax: number, az: number, bx: number, bz: number, h: number, top: number, base: number, y = 0, mat: Mat = 'dirt', o: { collide?: boolean; ends?: boolean; metal?: boolean } = {}): void {
    // mounded profile (piled regolith): convex, slightly rounded shoulders
    const sh = (base - top) / 2;
    const prof: [number, number][] = [
      [-base / 2, -0.4],
      [base / 2, -0.4],
      [base / 2 - sh * 0.45, h * 0.62],
      [top / 2 + sh * 0.08, h * 0.95],
      [top / 2 - 0.2, h],
      [-top / 2 + 0.2, h],
      [-top / 2 - sh * 0.08, h * 0.95],
      [-base / 2 + sh * 0.45, h * 0.62],
    ];
    this.extrude(ax, az, bx, bz, y, prof, mat, { seg: 3, caps: true });
    // scattered regolith clods along the crest (breaks the silhouette)
    {
      const L = Math.hypot(bx - ax, bz - az);
      const rng = new Rng(Math.floor((ax * 31 + az * 17 + bx * 7) * 10) | 0);
      const kk = this.at((ax + bx) / 2, (az + bz) / 2, Math.atan2(-(bz - az), bx - ax), y);
      for (let u = -L / 2 + 0.6; u < L / 2 - 0.4; u += rng.range(1.2, 2.4)) {
        const g = new THREE.DodecahedronGeometry(rng.range(0.25, 0.55), 0);
        this.b.add(mat, g, kk.p(u, h - 0.05, rng.range(-top / 2, top / 2)), qY(rng.next() * 6), V(1, 0.6, 1));
      }
    }
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az), bx - ax);
    const k = this.at((ax + bx) / 2, (az + bz) / 2, rot, y);
    if (o.collide === false) return;
    // core under the crest
    this.b.world.addBox(k.p(0, (h - 0.4) / 2, 0), V(len / 2, (h + 0.4) / 2, top / 2), k.q(), o.metal ?? false);
    const run = (base - top) / 2;
    const ang = Math.atan2(h + 0.4, run);
    const sl = Math.hypot(run, h + 0.4);
    for (const s of [-1, 1]) {
      const cz = s * (top / 2 + run / 2);
      const th = 0.6;
      const off = -th / 2;
      // slope plane passes through (top/2, h) and (base/2, -0.4); centre shifted inward by th/2 along its normal
      const nz = s * Math.sin(ang);
      const ny = Math.cos(ang);
      const q = k.q(0, qAxis(1, 0, 0, s * ang));
      this.b.world.addBox(k.p(0, (h - 0.4) / 2 + ny * off, cz + nz * off), V(len / 2, th / 2, sl / 2), q, o.metal ?? false);
    }
  }

  // ---------------------------------------------------------------- shells & domes

  /**
   * Glass dome on a ring (y0 = springing height): transparent shell + metal lattice ribs; polygonal
   * box-panel colliders (metal, so you can mag-walk the lattice inside and out). Open oculus optional.
   */
  glassDome(x: number, z: number, y0: number, r: number, o: { lon?: number; lat?: number; rib?: Mat; oculus?: number; collide?: boolean } = {}): void {
    const lon = o.lon ?? 16;
    const lat = o.lat ?? 5;
    const k = this.at(x, z, 0, y0);
    const top = Math.PI / 2 - (o.oculus ?? 0);
    const g = sphereBand(r, 0, top, 48, 16);
    this.b.add('glassDome', g, k.p(0, 0, 0), k.q());
    const rib = o.rib ?? 'hull';
    // meridian ribs
    for (let i = 0; i < lon; i++) {
      const a = (i / lon) * Math.PI * 2;
      this.b.torus(k.p(0, 0, 0), r + 0.05, 0.13, k.q(-a), rib, top);
    }
    // latitude rings
    for (let j = 1; j <= lat; j++) {
      const la = (j / (lat + 1)) * top;
      const rr = Math.cos(la) * r;
      this.b.torus(k.p(0, Math.sin(la) * r, 0), rr + 0.05, 0.1, qAxis(1, 0, 0, Math.PI / 2), rib);
    }
    this.b.torus(k.p(0, 0.05, 0), r + 0.1, 0.28, qAxis(1, 0, 0, Math.PI / 2), 'trim');
    if (o.oculus) {
      const la = top;
      this.b.torus(k.p(0, Math.sin(la) * r, 0), Math.cos(la) * r + 0.05, 0.25, qAxis(1, 0, 0, Math.PI / 2), 'brass');
    }
    if (o.collide === false) return;
    const bands = 4;
    for (let j = 0; j < bands; j++) {
      const la0 = (j / bands) * top * 0.92;
      const la1 = ((j + 1) / bands) * top * 0.92;
      const lm = (la0 + la1) / 2;
      const hgt = 2 * r * Math.sin((la1 - la0) / 2) * 1.12;
      for (let i = 0; i < lon; i++) {
        const a = ((i + 0.5) / lon) * Math.PI * 2;
        const wid = 2 * Math.cos(la0) * r * Math.sin(Math.PI / lon) * 1.1;
        const nx = Math.cos(lm) * Math.cos(a);
        const ny = Math.sin(lm);
        const nz = Math.cos(lm) * Math.sin(a);
        const c = V(nx, ny, nz).multiplyScalar(r * Math.cos((la1 - la0) / 2) - 0.1);
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), V(nx, ny, nz), Y));
        const wq = k.q().multiply(q);
        this.b.world.addBox(k.p(c.x, c.y, c.z), V(wid / 2, hgt / 2, 0.15), wq, true);
      }
    }
    if (!o.oculus) {
      const la = top * 0.92;
      const cr = Math.cos(la) * r;
      this.b.world.addBox(k.p(0, Math.sin(la) * r + 0.1, 0), V(cr * 0.8, 0.15, cr * 0.8), k.q(), true);
    }
  }

  /**
   * Sintered-regolith catenary shell (ESA / Foster "printed shell over an inflatable core"):
   * a thick cellular dome with arched openings at the given azimuths; non-metal colliders.
   */
  regolithShell(x: number, z: number, r: number, hScale: number, openings: { az: number; w: number; h: number; y0?: number }[], o: { lon?: number; inner?: Mat; y?: number } = {}): void {
    const k = this.at(x, z, 0, o.y ?? 0);
    const lonSeg = 40;
    const latSeg = 12;
    const inOpening = (lon: number, lat: number) => {
      for (const op of openings) {
        let da = Math.abs(((lon - op.az + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        const halfA = op.w / 2 / r;
        const y = Math.sin(lat) * r * hScale;
        // arched top: allowed height shrinks toward the sides
        const y0 = op.y0 ?? 0;
        const hh = op.h * Math.sqrt(Math.max(0, 1 - (da / halfA) ** 2 * 0.6));
        if (da < halfA && y >= y0 && y < y0 + hh) return true;
      }
      return false;
    };
    const outer = sphereBand(r, 0, Math.PI / 2, lonSeg, latSeg, false, inOpening);
    const inner = sphereBand(r - 1.1, 0, Math.PI / 2, lonSeg, latSeg, true, (lo, la) => inOpening(lo, Math.asin(Math.min(1, (Math.sin(la) * (r - 1.1)) / r))));
    const sc = V(1, hScale, 1);
    this.b.add('regolithCell', outer, k.p(0, 0, 0), k.q(), sc);
    this.b.add(o.inner ?? 'cream', inner, k.p(0, 0, 0), k.q(), sc);
    // arched opening frames (reveals)
    for (const op of openings) {
      const y0 = op.y0 ?? 0;
      const rr = Math.sqrt(Math.max(1, r * r - ((y0 + op.h * 0.5) / hScale) ** 2));
      const kk = this.at(x + Math.cos(op.az) * (rr - 0.55), z + Math.sin(op.az) * (rr - 0.55), -op.az + Math.PI / 2, (o.y ?? 0) + y0);
      for (const s of [-1, 1]) kk.box(s * (op.w / 2 + 0.25), op.h * 0.45, 0, 0.7, op.h * 0.9, 1.8, 'regolith', { bevel: 0.15, metal: false });
      kk.box(0, op.h + 0.1, 0, op.w + 1.2, 0.9, 1.8, 'regolith', { bevel: 0.2, metal: false, collide: false });
      kk.box(0, op.h - 0.25, 0, op.w + 0.2, 0.18, 1.9, 'brass', { collide: false, bevel: 0.05 });
      if (y0 > 0) kk.box(0, -0.2, 0, op.w + 1.2, 0.4, 1.9, 'regolith', { bevel: 0.1, metal: false, collide: false });
    }
    // colliders: panels skipping openings
    const lon = o.lon ?? 20;
    const bands = 5;
    for (let j = 0; j < bands; j++) {
      const la0 = (j / bands) * (Math.PI / 2) * 0.9;
      const la1 = ((j + 1) / bands) * (Math.PI / 2) * 0.9;
      const lm = (la0 + la1) / 2;
      const p0 = V(Math.cos(la0) * r, Math.sin(la0) * r * hScale, 0);
      const p1 = V(Math.cos(la1) * r, Math.sin(la1) * r * hScale, 0);
      const hgt = p0.distanceTo(p1) * 1.1;
      const cd = V(p1.x - p0.x, p1.y - p0.y, 0).normalize(); // chord dir in (rho, y)
      for (let i = 0; i < lon; i++) {
        const a = ((i + 0.5) / lon) * Math.PI * 2;
        // skip panels overlapping any opening (angular range × height range)
        const py0 = Math.sin(la0) * r * hScale;
        const py1 = Math.sin(la1) * r * hScale;
        const dA = Math.PI / lon;
        let hit = false;
        for (const op of openings) {
          const da = Math.abs(((a - op.az + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          const oy0 = op.y0 ?? 0;
          if (da < dA + op.w / 2 / r && py1 > oy0 && py0 < oy0 + op.h) hit = true;
        }
        if (hit) continue;
        const wid = 2 * Math.cos(la0) * r * Math.sin(Math.PI / lon) * 1.12;
        const er = V(Math.cos(a), 0, Math.sin(a));
        const et = V(-Math.sin(a), 0, Math.cos(a));
        const ydir = er.clone().multiplyScalar(cd.x).add(V(0, cd.y, 0));
        const n = er.clone().multiplyScalar(cd.y).add(V(0, -cd.x, 0));
        const m = new THREE.Matrix4().makeBasis(et.clone().negate(), ydir, n);
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        const mr = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        const c = er.clone().multiplyScalar(mr).add(V(0, my, 0)).addScaledVector(n, -0.45);
        this.b.world.addBox(k.p(c.x, c.y, c.z), V(wid / 2, hgt / 2, 0.5), k.q().multiply(q), false);
      }
    }
    const la = (Math.PI / 2) * 0.9;
    const cr = Math.cos(la) * r;
    this.b.world.addBox(k.p(0, Math.sin(la) * r * hScale, 0), V(cr, 0.4, cr), k.q(), false);
  }

  /** Geodesic radome on a drum base (fibreglass: non-metal) */
  radome(x: number, z: number, y0: number, r: number, team: number | null = null): void {
    const k = this.at(x, z, 0, y0);
    k.cyl(0, 0.8, 0, r * 0.75, 1.6, 'hullGray', { seg: 16 });
    k.cyl(0, 1.7, 0, r * 0.8, 0.2, teamMat(team), { seg: 16, collide: false });
    const ng = new THREE.IcosahedronGeometry(r, 2);
    ng.computeVertexNormals();
    this.b.add('paintWhite', ng, k.p(0, 1.6 + r * 0.55, 0), k.q());
    this.b.world.addSphere(k.p(0, 1.6 + r * 0.55, 0), r, false);
    k.beacon(0, 1.6 + r * 1.58, 0, 0xff3a2a, 1.7, x * 0.01);
  }

  /**
   * Pressurised tube corridor (octagonal, walkable inside: 3.2 m clear) between two local points
   * at floor height y. Ends are open. Metal lining → mag-walk the ceiling.
   */
  tube(ax: number, az: number, bx: number, bz: number, y: number, o: { shell?: Mat; ribs?: Mat; lights?: boolean } = {}): void {
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az), bx - ax);
    const k = this.at((ax + bx) / 2, (az + bz) / 2, rot, y);
    const R = 1.95; // apothem of the inner octagon
    const t = 0.3;
    const side = 2 * R * Math.tan(Math.PI / 8) + 0.06;
    const cy = R;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2; // i=0 → floor
      const ny = Math.sin(a);
      const nz = Math.cos(a);
      const mat: Mat = i === 0 ? 'grid' : (o.shell ?? 'hull');
      k.box(0, cy + ny * (R + t / 2), nz * (R + t / 2), len, t, side, mat, { tilt: qAxis(1, 0, 0, Math.PI / 2 - a), bevel: 0.04, seg: 2 });
    }
    for (let u = -len / 2 + 1.2; u < len / 2 - 0.6; u += 3) {
      const g = new THREE.TorusGeometry(R + t + 0.05, 0.14, 6, 8);
      this.b.add(o.ribs ?? 'trim', g, k.p(u, cy, 0), k.q(Math.PI / 2).multiply(qAxis(0, 0, 1, Math.PI / 8)));
      if (o.lights !== false) {
        k.box(u + 1.5, cy + R - 0.05, 0, 1.2, 0.05, 0.3, 'neonWarm', { collide: false, bevel: 0 });
        k.light(u + 1.5, cy + R - 0.6, 0, WARM, 3, 6, { bounds: k.aabb(-len / 2 - 0.5, -0.5, -R - 0.1, len / 2 + 0.5, 2 * R + 0.2, R + 0.1) });
      }
    }
    k.test('tube', [-len / 2 - 0.3, 0.4, 0], [len / 2 + 0.3, 0.4, 0]);
  }

  /** TransHab-style inflatable module (ribbed fabric skin between rigid end nodes), vertical axis. */
  inflatable(x: number, z: number, r: number, h: number, y = 0, team: number | null = null): void {
    const k = this.at(x, z, 0, y);
    const g = new THREE.CylinderGeometry(r, r, h, 28, 6, true);
    // bulge the fabric between rings
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      const t = (py / h + 0.5) * 6;
      const bulge = 1 + 0.05 * Math.sin((t % 1) * Math.PI) + 0.08 * Math.sin((py / h + 0.5) * Math.PI);
      pos.setX(i, pos.getX(i) * bulge);
      pos.setZ(i, pos.getZ(i) * bulge);
    }
    g.computeVertexNormals();
    this.b.add('fabric', g, k.p(0, h / 2 + 0.8, 0), k.q());
    for (let j = 0; j <= 6; j++) this.b.torus(k.p(0, 0.8 + (j * h) / 6, 0), r * (1 + (j === 0 || j === 6 ? 0 : 0.04)) + 0.02, 0.07, qAxis(1, 0, 0, Math.PI / 2), j % 3 === 0 ? 'trim' : 'hullGray');
    const cap = new THREE.SphereGeometry(r * 1.02, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.b.add('fabric', cap, k.p(0, h + 0.8, 0), k.q(), V(1, 0.35, 1));
    k.cyl(0, 0.4, 0, r * 0.95, 0.8, 'darkPanel', { seg: 20 });
    k.cyl(0, h + 0.8 + r * 0.35, 0, 0.8, 0.5, teamMat(team), { seg: 12, collide: false });
    this.b.world.addCylinder(k.p(0, h / 2 + 0.8, 0), r * 1.06, h / 2 + r * 0.2, k.q(), false);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      k.panel(Math.cos(a) * (r * 1.09), 0.8 + h * 0.62, Math.sin(a) * (r * 1.09), 0.7, 0.4, Math.cos(a), 0, Math.sin(a), 'glassWarm');
    }
  }

  /**
   * Hardened shelter vault (Cold-War HAS, sintered regolith over a metal-lined arch): open front at
   * local +z, back wall with a door at -z. Interior vault is metal (mag-walkable ceiling).
   */
  vault(span: number, len: number, rise: number, o: { team?: number | null; segs?: number; back?: boolean; door?: boolean } = {}): void {
    const segs = o.segs ?? 10;
    const R = span / 2;
    const sy = rise / R;
    const pts: [number, number][] = [];
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI - (i / segs) * Math.PI;
      pts.push([Math.cos(a) * R, Math.sin(a) * R * sy]);
    }
    const inner = 0.25;
    const outer = 1.1;
    for (let i = 0; i < segs; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const chord = Math.hypot(x1 - x0, y1 - y0);
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      // metal lining (collider, walkable)
      this.box(mx + nx * (inner / 2), my + ny * (inner / 2), 0, chord + 0.12, inner, len, 'darkPanel', { tilt: qAxis(0, 0, 1, ang), bevel: 0.03, seg: 2 });
      // regolith overburden (non-metal)
      this.box(mx + nx * (inner + outer / 2), my + ny * (inner + outer / 2), 0, chord + 0.5, outer, len + 0.6, 'regolith', { tilt: qAxis(0, 0, 1, ang), bevel: 0.12, metal: false, seg: 3 });
    }
    // front arch frame (team), with hazard and floodlights
    for (let i = 0; i < segs; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      const chord = Math.hypot(x1 - x0, y1 - y0);
      this.box((x0 + x1) / 2 + nx * 0.8, (y0 + y1) / 2 + ny * 0.8, len / 2 + 0.2, chord + 0.3, 1.2, 0.8, i % 2 ? teamMat(o.team) : 'trim', { tilt: qAxis(0, 0, 1, ang), collide: false, bevel: 0.1 });
    }
    // floor
    this.box(0, 0.1, 0, span - 0.2, 0.2, len, 'padDark', { bevel: 0.03, seg: 3 });
    for (let x = -R + 2; x <= R - 2; x += 4) this.box(x, 0.21, 0, 0.18, 0.02, len - 1, 'yellow', { collide: false, bevel: 0 });
    // ceiling light strips (visible when mag-walking the vault)
    for (let i = 3; i <= segs - 3; i += 2) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      this.box((x0 + x1) / 2 - nx * 0.02, (y0 + y1) / 2 - ny * 0.02, 0, 0.3, 0.06, len - 3, 'neonWarm', { tilt: qAxis(0, 0, 1, ang), collide: false, bevel: 0 });
    }
    this.light(0, rise * 0.55, -len * 0.25, WARM, 9, 14, { bounds: this.aabb(-R - 0.5, -0.5, -len / 2 - 0.2, R + 0.5, rise + 0.3, len / 2 + 0.5) });
    this.light(0, rise * 0.55, len * 0.25, WARM, 9, 14, { bounds: this.aabb(-R - 0.5, -0.5, -len / 2 - 0.2, R + 0.5, rise + 0.3, len / 2 + 1.5) });
    if (o.back !== false) {
      // back wall following the arch profile, with a personnel door in the middle
      const wz = -len / 2 + 0.35;
      const step = 1.0;
      for (let x = -R + 0.1; x < R - 0.05; x += step) {
        const x1 = Math.min(R - 0.1, x + step);
        const xm = Math.max(Math.abs(x), Math.abs(x1));
        const hh = rise * Math.sqrt(Math.max(0, 1 - (xm / R) ** 2)) - 0.05;
        if (hh < 0.3) continue;
        const dz0 = o.door === false ? 99 : -DOOR_W / 2;
        const dz1 = o.door === false ? 99 : DOOR_W / 2;
        if (x1 <= dz0 || x >= dz1) this.span(x, 0, wz - 0.3, x1, hh, wz + 0.3, 'regolith', { metal: false, bevel: 0.04 });
        else {
          if (x < dz0) this.span(x, 0, wz - 0.3, dz0, hh, wz + 0.3, 'regolith', { metal: false, bevel: 0.04 });
          if (x1 > dz1) this.span(dz1, 0, wz - 0.3, x1, hh, wz + 0.3, 'regolith', { metal: false, bevel: 0.04 });
          this.span(Math.max(x, dz0), DOOR_H, wz - 0.3, Math.min(x1, dz1), hh, wz + 0.3, 'regolith', { metal: false, bevel: 0.04 });
        }
      }
      const dk = this.at(0, wz, 0, 0);
      if (o.door !== false) {
      dk.box(0, DOOR_H + 0.15, 0, DOOR_W + 0.4, 0.3, 0.8, teamMat(o.team), { collide: false });
      for (const sx of [-1, 1]) dk.box(sx * (DOOR_W / 2 + 0.05), DOOR_H / 2, 0, 0.25, DOOR_H, 0.75, 'trim', { collide: false });
      dk.panel(0, DOOR_H + 0.15, 0.41, DOOR_W, 0.18, 0, 0, 1, 'hazard');
      dk.light(0, DOOR_H - 0.3, 1.0, teamLight(o.team), 3, 6);
      dk.light(0, DOOR_H - 0.3, -1.0, teamLight(o.team), 3, 6);
      dk.test('door', [0, 0.3, -1.8], [0, 0.3, 1.8]);
      }
    }
    // blast door leaves pushed aside
    for (const s of [-1, 1]) {
      this.box(s * (R - 1.0), rise * 0.3, len / 2 + 0.9, 1.6, rise * 0.6, 0.5, 'darkPanel', { bevel: 0.08 });
      this.panel(s * (R - 1.0), rise * 0.3, len / 2 + 1.16, 1.2, rise * 0.5, 0, 0, 1, 'hazard');
    }
  }
}

/** Frame at the terrain under (x, z). */
export function frameAt(b: StructureBuilder, x: number, z: number, rot = 0, y?: number): Frame {
  return { x, y: y ?? b.ground(x, z), z, rot };
}
export { V };
