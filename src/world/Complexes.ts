import * as THREE from 'three';
import { StructureBuilder, Mat } from './Builder';
import { Kit, Opening, Side, FLOOR, SLAB, DOOR_W, DOOR_H, WARM, WARM2, COOL, teamMat, teamGlow, teamLight, qAxis, qY, V } from './Kit';
import type { MapDef } from './MapDefs';
import type { LayoutInfo, PickupKind } from './Layouts';
import * as P from './Prefabs';
import { Rng } from '../core/Rng';

/**
 * Signature multi-level complexes built from the Kit. Real-world concepts, stylised OW-like:
 *  - fortress: star-fort bastion trace, ramparts + parapets, glacis, hardened aircraft shelter vault,
 *    Cheyenne-style portal command bunker under a regolith mound, entry control point (serpentine
 *    barriers, guard tower), Hesco / sandbag lines, turret emplacements.
 *  - processingPlant: ISRU chain — excavation conveyor, crusher hopper, molten-regolith-electrolysis
 *    reactors, O₂ tank farm behind a berm, control room over a double-height machine hall.
 *  - spaceport: sintered-regolith pads ringed by blast-deflection berms, terminal hall + mezzanine,
 *    control tower with wrap-around stairs, walkable jet-bridge tube to a docked shuttle, gantry crane,
 *    cryo tanks set apart behind a berm.
 *  - lab: ESA/Foster printed cellular regolith shell over an atrium with ring balconies, lab wing,
 *    telescope dome, radome.
 *  - habTown: glass dome on a drum over a civic plaza with two-storey habs, sky-bridges, hydroponic
 *    garden and monument; TransHab-style inflatables linked by pressurised tube corridors.
 *  - silo complex, comm relay (radome on high ground), supply depot (Hesco), power station
 *    (sun-tracking vertical arrays, fission reactor + radiators behind a berm).
 */

export interface Markers {
  spawns: { pos: THREE.Vector3; yaw: number }[];
  perches: THREE.Vector3[];
  pickups: { pos: THREE.Vector3; kind: PickupKind; elevated: boolean }[];
  keep: { x: number; z: number; r: number }[];
  cp?: THREE.Vector3;
}
export function markers(): Markers {
  return { spawns: [], perches: [], pickups: [], keep: [] };
}

// ---------------------------------------------------------------------------
// helpers

/** Doors at u positions + evenly spaced windows between them along a wall of length len. */
export function ops(len: number, doors: (number | Opening)[] = [], o: { every?: number; w?: number; h?: number; sill?: number; glass?: Opening['glass']; margin?: number; team?: number | null } = {}): Opening[] {
  const out: Opening[] = doors.map((d) => (typeof d === 'number' ? { u: d, w: DOOR_W, h: DOOR_H, team: o.team } : d));
  const every = o.every ?? 3.4;
  if (every <= 0) return out;
  const w = o.w ?? 1.6;
  const margin = o.margin ?? 1.2;
  const n = Math.floor((len - 2 * margin) / every);
  const start = (len - (n - 1) * every) / 2;
  for (let i = 0; i < n; i++) {
    const u = start + i * every;
    if (out.some((d) => Math.abs(d.u - u) < d.w / 2 + w / 2 + 0.5)) continue;
    out.push({ u, w, h: o.h ?? 1.5, sill: o.sill ?? 1.0, glass: o.glass ?? 'warm' });
  }
  return out;
}

export interface StairSpec {
  /** bottom point (local x,z) and top point; y from the storey base to the next */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  width?: number;
  from: number; // storey index at the bottom
  rails?: 'both' | 'l' | 'r' | 'none';
}

export interface BlockSpec {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  floors: number;
  fh?: number;
  t?: number;
  wall?: Mat;
  floorMat?: Mat;
  ceil?: Mat;
  /** openings per storey */
  open: Partial<Record<Side, Opening[]>>[];
  stairs?: StairSpec[];
  /** roof: parapet height (0 = none) */
  parapet?: number;
  lining?: Mat | null;
  light?: THREE.ColorRepresentation;
  lightI?: number;
  ribs?: Mat | null;
  team?: number | null;
  /** extra slab holes per storey index (atria) */
  holes?: Record<number, [number, number, number, number][]>;
  roofMat?: Mat;
  cap?: Mat;
  clutter?: boolean;
}

/** Multi-storey rectangular building with floors, stairwells, lit interiors, parapet roof. */
export function block(k: Kit, s: BlockSpec): void {
  const fh = s.fh ?? FLOOR;
  const t = s.t ?? 0.4;
  const wall = s.wall ?? 'cream';
  const floorMat = s.floorMat ?? 'tile';
  const ix0 = s.x0 + t / 2;
  const iz0 = s.z0 + t / 2;
  const ix1 = s.x1 - t / 2;
  const iz1 = s.z1 - t / 2;
  const stairs = s.stairs ?? [];
  const holeOf = (st: StairSpec): [number, number, number, number] => {
    const w = st.width ?? 1.6;
    const dx = st.x1 - st.x0;
    const dz = st.z1 - st.z0;
    const L = Math.hypot(dx, dz);
    const ux = dx / L;
    const uz = dz / L;
    // hole spans the upper 65% of the run (head clearance) across the stair width
    const a = [st.x0 + ux * L * 0.35, st.z0 + uz * L * 0.35];
    const c = [st.x1, st.z1];
    const px = -uz * (w / 2 + 0.15);
    const pz = ux * (w / 2 + 0.15);
    const xs = [a[0] + px, a[0] - px, c[0] + px, c[0] - px];
    const zs = [a[1] + pz, a[1] - pz, c[1] + pz, c[1] - pz];
    return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  };
  // ground slab
  k.slab(ix0 - 0.02, iz0 - 0.02, ix1 + 0.02, iz1 + 0.02, 0.2, 0.5, floorMat, { seg: 2 });
  for (let i = 0; i < s.floors; i++) {
    const y = i * fh;
    const openI: Partial<Record<Side, Opening[]>> = {};
    for (const [sd, list] of Object.entries(s.open[i] ?? {}) as [Side, Opening[]][]) openI[sd] = list.map((op) => (op.accent || op.team !== undefined || !s.ribs ? op : { ...op, accent: s.ribs }));
    k.room(s.x0, s.z0, s.x1, s.z1, y, fh, t, wall, openI, {
      cap: s.cap ?? 'trim',
      lining: s.lining === null ? undefined : { side: 1, mat: s.lining ?? 'wood' },
      ribs: s.ribs ? { side: 1, every: 4, mat: s.ribs } : undefined,
      light: null,
    });
    const base = i === 0 ? 0.2 : y;
    k.roomLights(ix0, iz0, ix1, iz1, base, y + fh - SLAB, s.light ?? WARM, s.lightI ?? 6);
    if (i > 0) {
      const holes = stairs.filter((st) => st.from === i - 1).map(holeOf).concat(s.holes?.[i] ?? []);
      k.slab(ix0, iz0, ix1, iz1, y, SLAB, floorMat, { holes, under: s.ceil ?? 'cream', edge: 'trim' });
      // railings around stairwell holes (open on the arrival side)
      for (const st of stairs.filter((q) => q.from === i - 1)) {
        const h = holeOf(st);
        const dx = st.x1 - st.x0;
        const dz = st.z1 - st.z0;
        const arrive: Side = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : dz > 0 ? 'n' : 's';
        const edges: [Side, number, number, number, number][] = [
          ['s', h[0], h[1], h[2], h[1]],
          ['n', h[0], h[3], h[2], h[3]],
          ['w', h[0], h[1], h[0], h[3]],
          ['e', h[2], h[1], h[2], h[3]],
        ];
        for (const [sd, ax, az, bx, bz] of edges) {
          if (sd === arrive) continue;
          // skip edges that coincide with an exterior wall
          if (Math.abs(ax - bx) < 1e-3 && (Math.abs(ax - ix0) < 0.3 || Math.abs(ax - ix1) < 0.3)) continue;
          if (Math.abs(az - bz) < 1e-3 && (Math.abs(az - iz0) < 0.3 || Math.abs(az - iz1) < 0.3)) continue;
          k.railing(ax, az, bx, bz, y, { mat: 'brass' });
        }
      }
    }
  }
  const roofY = s.floors * fh;
  const roofHoles = stairs.filter((st) => st.from === s.floors - 1).map(holeOf);
  k.slab(ix0 - 0.02, iz0 - 0.02, ix1 + 0.02, iz1 + 0.02, roofY, SLAB, s.roofMat ?? 'hullGray', { holes: roofHoles, under: s.ceil ?? 'cream', edge: 'trim' });
  for (const st of stairs) k.stairs(st.x0, st.z0, st.x1, st.z1, st.from * fh + (st.from === 0 ? 0.2 : 0), (st.from + 1) * fh, st.width ?? 1.6, { rails: st.rails ?? 'r', mat: 'trim', style: 'open', tread: floorMat === 'grid' ? 'grid' : 'wood', railMat: 'brass' });
  // rooftop clutter: HVAC units, vents, antenna (skipped over stairwells / walkways)
  if (s.clutter !== false) {
    const rng = new Rng(Math.floor(Math.abs(k.f.x * 13.7 + k.f.z * 7.1)) + s.floors);
    const W = s.x1 - s.x0;
    const D = s.z1 - s.z0;
    const n = Math.max(1, Math.floor((W * D) / 40));
    for (let i = 0; i < n; i++) {
      const w = rng.range(1.0, 2.2);
      const d = rng.range(0.8, 1.6);
      const x = rng.range(s.x0 + 1 + w / 2, s.x1 - 1 - w / 2);
      const z = rng.range(s.z0 + 1 + d / 2, s.z1 - 1 - d / 2);
      if (k.blocked(x, z, w + 0.6, d + 0.6, roofY)) continue;
      const kind = rng.next();
      if (kind < 0.45) {
        k.box(x, roofY + 0.45, z, w, 0.9, d, 'hullGray', { bevel: 0.06 });
        k.cyl(x + w * 0.2, roofY + 0.95, z, Math.min(w, d) * 0.3, 0.12, 'dark', { seg: 12, collide: false });
        k.box(x - w * 0.25, roofY + 0.5, z + d / 2 + 0.01, w * 0.4, 0.5, 0.03, 'vent', { collide: false, bevel: 0 });
      } else if (kind < 0.75) {
        k.box(x, roofY + 0.3, z, w, 0.6, d, 'vent', { bevel: 0.05 });
        k.box(x, roofY + 0.65, z, w + 0.1, 0.1, d + 0.1, 'trim', { collide: false, bevel: 0.02 });
      } else {
        k.box(x, roofY + 0.15, z, 1.0, 0.3, 1.0, 'darkPanel', { bevel: 0.04 });
        k.beam([x, roofY + 0.3, z], [x, roofY + 3.2, z], 0.08, 'steel', { round: true });
        k.beam([x, roofY + 2.4, z], [x + 0.7, roofY + 2.4, z], 0.05, 'steel', { round: true });
        k.beacon(x, roofY + 3.3, z, 0xff3a2a, 1.9, rng.next());
      }
    }
  }
  const ph = s.parapet ?? 1.1;
  const capMat: Mat = s.ribs ?? 'trim';
  if (ph > 0) {
    const pt = 0.3;
    k.wall(s.x0, s.z0 + pt / 2, s.x1, s.z0 + pt / 2, roofY, ph, pt, wall, [], { cap: capMat });
    k.wall(s.x0, s.z1 - pt / 2, s.x1, s.z1 - pt / 2, roofY, ph, pt, wall, [], { cap: capMat });
    k.wall(s.x0 + pt / 2, s.z0 + pt, s.x0 + pt / 2, s.z1 - pt, roofY, ph, pt, wall, [], { cap: capMat });
    k.wall(s.x1 - pt / 2, s.z0 + pt, s.x1 - pt / 2, s.z1 - pt, roofY, ph, pt, wall, [], { cap: capMat });
  } else k.span(s.x0 - 0.05, roofY - 0.05, s.z0 - 0.05, s.x1 + 0.05, roofY + 0.18, s.z1 + 0.05, capMat, { collide: false, bevel: 0.06, faces: 1 | 2 | 4 | 16 | 32 });
}

/** A short exterior stair + landing to reach a roof or balcony (with rails). */
export function extStair(k: Kit, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, w = 1.6, mat: Mat = 'darkPanel'): void {
  k.stairs(x0, z0, x1, z1, y0, y1, w, { rails: 'both', style: 'open', mat });
  void mat;
}

// ---------------------------------------------------------------------------
// kit test scene (preview ?kit)

export function kitTest(b: StructureBuilder, _def: MapDef, info: LayoutInfo): void {
  const x = -60;
  const z = 0;
  const k = new Kit(b, { x, y: b.ground(x, z), z, rot: 0 });
  block(k, {
    x0: -8,
    z0: -6,
    x1: 8,
    z1: 6,
    floors: 2,
    open: [
      { s: ops(16, [4], { every: 3.4 }), n: ops(16, [12]), e: ops(12, [6]), w: ops(12, [], { glass: 'tint' }) },
      { s: ops(16, [], {}), n: ops(16, [], { glass: 'tint' }), e: ops(12, [6]), w: ops(12, []) },
    ],
    stairs: [{ x0: -6.5, z0: 3.6, x1: -0.5, z1: 3.6, from: 0, width: 1.8, rails: 'r' }, { x0: 6.5, z0: -3.6, x1: 0.5, z1: -3.6, from: 1, width: 1.6 }],
    ribs: 'trim',
  });
  k.balcony(8.2, 0, Math.PI / 2, 5, 2.2, FLOOR);
  k.tube(8, -12, 30, -12, 0.2);
  k.glassDome(30, 22, 4.5, 12, {});
  k.at(30, 22).wall(-12, 0, 12, 0, 0, 4.5, 0.5, 'cream', [{ u: 12, w: DOOR_W, h: DOOR_H }]);
  k.at(-6, -26).vault(14, 16, 7, { team: 0 });
  k.berm(-30, 10, -30, 30, 3, 2, 8);
  k.sandbags(-20, 14, -14, 18);
  k.hesco(-20, 22, -10, 22);
  k.jersey(-10, 12, 0.3);
  k.turret(-2, 18, 0, 0, 1);
  k.lampPost(-4, 12);
  k.regolithShell(20, -30, 12, 1.1, [
    { az: 0, w: 4, h: 4 },
    { az: Math.PI, w: 4, h: 4 },
  ]);
  k.radome(40, -8, 0, 4);
  k.inflatable(44, 6, 3.5, 5);
  k.catwalk(-20, -10, -20, -30, 4, 2, { posts: 4 });
  info.spawns.push({ pos: V(x, 0, z - 14), yaw: 0, team: 0 });
}

// ---------------------------------------------------------------------------
// fortification pieces

/**
 * Rampart (sintered regolith curtain wall, non-metal) from a→b: walkable crest at h, outer parapet
 * with merlons/crenels on side `outer` (+1 = wall-local +z), gates as openings (passage under the crest).
 */
export function rampart(k: Kit, ax: number, az: number, bx: number, bz: number, o: { h?: number; w?: number; gates?: Opening[]; outer: 1 | -1; team?: number | null; lamps?: boolean }): void {
  const h = o.h ?? FLOOR;
  const w = o.w ?? 3;
  k.wall(ax, az, bx, bz, 0, h, w, 'regolith', o.gates ?? [], { metal: false, cap: null, base: 'concrete', bevel: 0.12, seg: 3, doorLight: teamLight(o.team) });
  const len = Math.hypot(bx - ax, bz - az);
  const rot = Math.atan2(-(bz - az), bx - ax);
  const kk = k.at((ax + bx) / 2, (az + bz) / 2, rot, 0);
  const s = o.outer;
  // metal crest deck (mag-consistent with the metal stairs/bridges that land on it)
  kk.box(0, h + 0.05, -s * 0.3, len - 0.1, 0.1, w - 0.6, 'grid', { bevel: 0.02, seg: 3 });
  // parapet: continuous breast wall + merlons with crenel gaps
  kk.box(0, h + 0.375, s * (w / 2 - 0.3), len, 0.75, 0.6, 'regolith', { metal: false, bevel: 0.1 });
  for (let u = -len / 2 + 1.0; u <= len / 2 - 0.9; u += 2.6) kk.box(u, h + 1.12, s * (w / 2 - 0.3), 1.6, 0.75, 0.62, 'regolith', { metal: false, bevel: 0.12 });
  kk.box(0, h + 0.77, s * (w / 2 - 0.3), len + 0.02, 0.06, 0.66, o.team === null || o.team === undefined ? 'trim' : teamMat(o.team), { collide: false, bevel: 0 });
  kk.box(0, h + 0.1, -s * (w / 2 - 0.12), len, 0.2, 0.24, 'trim', { collide: false, bevel: 0.04 });
  // outer face: buttress ribs + team band
  for (let u = -len / 2 + 3; u < len / 2 - 2; u += 6) {
    if ((o.gates ?? []).some((g) => Math.abs(g.u - (u + len / 2)) < g.w / 2 + 1.2)) continue;
    kk.box(u, h / 2 - 0.2, s * (w / 2 + 0.35), 1.1, h - 0.4, 0.7, 'regolith', { metal: false, bevel: 0.15, collide: false });
  }
  if (o.lamps !== false) {
    for (let u = -len / 2 + 4; u < len / 2 - 2; u += 9) {
      kk.box(u, h + 0.35, -s * (w / 2 - 0.12), 0.3, 0.3, 0.3, 'trim', { collide: false });
      kk.box(u, h + 0.55, -s * (w / 2 - 0.12), 0.24, 0.1, 0.24, 'neonWarm', { collide: false, bevel: 0 });
      kk.light(u, h + 1.2, -s * 0.3, WARM, 3.5, 7);
    }
  }
}

/** Diamond bastion (star-fort corner): walkable top at h, merlons on the two outer faces, turret. */
export function bastion(k: Kit, x: number, z: number, size: number, faceRot: number, team: number | null, h = FLOOR): void {
  // faceRot: direction (radians, local frame) the bastion tip points to
  const kk = k.at(x, z, faceRot, 0);
  kk.box(0, h / 2, 0, size, h, size, 'regolith', { rot: Math.PI / 4, metal: false, bevel: 0.2, seg: 3 });
  kk.box(0, 0.25, 0, size + 0.6, 0.5, size + 0.6, 'concrete', { rot: Math.PI / 4, collide: false, bevel: 0.1 });
  const d = size / Math.SQRT2; // half diagonal
  // tip at local +x: outer faces run from (d,0) to (0,±d)
  for (const s of [-1, 1]) {
    const ax = d - 0.45;
    const az = 0;
    const bx = 0;
    const bz = s * (d - 0.45);
    const len = Math.hypot(bx - ax, bz - az);
    const rot = Math.atan2(-(bz - az), bx - ax);
    const pk = kk.at((ax + bx) / 2, (az + bz) / 2, rot, h);
    pk.box(0, 0.3, 0, len, 0.6, 0.6, 'regolith', { metal: false, bevel: 0.1 });
    for (let u = -len / 2 + 0.9; u <= len / 2 - 0.8; u += 2.6) pk.box(u, 1.0, 0, 1.6, 0.8, 0.62, 'regolith', { metal: false, bevel: 0.12 });
    pk.box(0, 0.62, 0, len, 0.06, 0.66, teamMat(team), { collide: false, bevel: 0 });
  }
  kk.box(0, h + 0.05, 0, size * 0.94, 0.1, size * 0.94, 'grid', { rot: Math.PI / 4, bevel: 0.02, seg: 3 });
  kk.turret(d * 0.2, 0, 0, h, team);
  kk.light(0, h + 2.5, 0, teamLight(team), 5, 9);
  kk.beacon(d - 0.3, h + 1.6, 0, teamLight(team), 2.2, x * 0.03);
}

// ---------------------------------------------------------------------------
// FORTRESS — star-fort faction base. Local +x faces the enemy / map centre. Footprint x -19..20, z -39..39.

export function fortress(k: Kit, team: number, m: Markers): void {
  const tm = teamMat(team);
  const tg = teamGlow(team);
  const tl = teamLight(team);
  const H = FLOOR;
  // paved sintered apron inside the walls
  k.span(-17.8, -0.4, -30, 8.5, 0.12, 30, 'padDark', { metal: false, bevel: 0.04, seg: 4 });
  for (const z of [-12, 12]) k.box(-2, 0.13, z, 20, 0.02, 0.18, 'yellow', { collide: false, bevel: 0 });
  k.box(3, 0.13, 0, 0.18, 0.02, 24, 'yellow', { collide: false, bevel: 0 });

  // ---- curtain walls (front with main gate, flanks with sally ports) ----
  rampart(k, 9.5, -30, 9.5, 30, { outer: -1, team, gates: [{ u: 30, w: 6, h: 3.3, team, kind: 'door' }] });
  // sally ports: north one opens into the alley behind the shelter, south one into the barracks
  rampart(k, 9.5, 31.5, -19.5, 31.5, { outer: -1, team, gates: [{ u: 10.5, w: DOOR_W + 0.4, h: DOOR_H, team }] });
  rampart(k, -19.5, -31.5, 9.5, -31.5, { outer: -1, team, gates: [{ u: 16.5, w: DOOR_W + 0.4, h: DOOR_H, team }] });
  bastion(k, 9.5, 31.5, 11, Math.PI / 4, team);
  bastion(k, 9.5, -31.5, 11, -Math.PI / 4, team);
  // back corners: low hesco + berm line at the map edge
  k.berm(-20.5, -30, -20.5, 30, 2.4, 1.2, 5, 0, 'dirt');

  // ---- main gate: blast doors, team banners, ECP outside ----
  const g = k.at(9.5, 0, 0, 0);
  for (const s of [-1, 1]) {
    g.box(-2.4, 1.7, s * 4.6, 0.4, 3.4, 3.0, 'darkPanel', { rot: s * 0.2, bevel: 0.08 });
    g.panel(-2.18, 1.7, s * 4.6, 2.6, 3.0, 1, 0, 0, 'hazard');
    // banners flanking the gate (outer face)
    g.box(-1.7 + 3.2, 2.6, s * 6.2, 0.2, 4.2, 1.6, tm, { collide: false, bevel: 0.04 });
    g.box(-1.7 + 3.3, 4.55, s * 6.2, 0.3, 0.3, 1.9, 'brass', { collide: false });
  }
  g.sign(1.62, 3.75, 0, 3.8, 0.5, 1, 0, team === 0 ? 'label0' : 'label1');
  g.light(3.5, 3, 0, tl, 6, 10);
  // entry control point: serpentine jersey barriers, booth, floodlight
  k.jersey(13, -2.2, Math.PI / 2, 3.4);
  k.jersey(15.6, 2.2, Math.PI / 2, 3.4);
  k.jersey(18.2, -2.2, Math.PI / 2, 3.4);
  const booth = k.at(14.5, 6.2, 0, 0);
  booth.span(-1.3, 0, -1.3, 1.3, 1.1, 1.3, 'concrete', { metal: false });
  booth.span(-1.3, 1.1, -1.3, 1.3, 2.4, -1.1, 'glassTint', { noShoot: true, metal: false, bevel: 0 });
  booth.span(1.1, 1.1, -1.1, 1.3, 2.4, 1.3, 'glassTint', { noShoot: true, metal: false, bevel: 0 });
  booth.span(-1.5, 2.4, -1.5, 1.5, 2.75, 1.5, tm, { bevel: 0.08 });
  booth.console(0, 0.4, Math.PI, 0);
  booth.light(0, 2.1, 0, WARM, 3, 4.5);
  k.hesco(12, -9, 18, -9, 1.3);
  k.hesco(12, 10.5, 18, 10.5, 1.3);
  k.lampPost(18.5, 4.5, Math.PI, 0, 4.5, WARM);
  // glacis: regolith slope in front of the curtain (attackers exposed, wall base shielded)
  k.berm(12.2, 12.5, 12.2, 25, 1.5, 0.8, 5.2);
  k.berm(12.2, -25, 12.2, -12.5, 1.5, 0.8, 5.2);

  // ---- rampart access: stairs along the inner faces + landings ----
  for (const s of [-1, 1]) {
    k.stairs(6.9, s * 24.8, 6.9, s * 16.8, 0.12, H + 0.1, 1.9, { rails: s > 0 ? 'r' : 'l', mat: 'concrete', foot: true });
    k.span(5.9, H - 0.3, s * 16.8, 8.3, H + 0.1, s * 14.2, 'grid', { bevel: 0.03 });
    k.railing(5.95, s * 14.3, 5.95, s * 16.7, H + 0.1, { mat: 'yellow' });
    k.railing(5.95, s * 14.25, 8.0, s * 14.25, H + 0.1, { mat: 'yellow' });
  }
  // flank stairs up to the side ramparts (near the back), arriving straight onto the crest
  for (const s of [-1, 1]) k.stairs(-16.6, s * 21.2, -16.6, s * 30.05, 0.12, H + 0.1, 1.8, { rails: 'both', mat: 'concrete', foot: true });

  // ---- command bunker: Cheyenne-style portal into a regolith mound ----
  commandBunker(k.at(-12.5, 0, 0, 0), team, m);

  // ---- hardened aircraft shelter (arched vault, mag-walkable ceiling), opening toward the gate ----
  const has = k.at(-1, 19.6, Math.PI, 0.12);
  has.vault(10, 13, 5.6, { team });
  // lander parked inside (cover)
  const lk = has.at(0, -1.5, 0, 0);
  lk.cyl(0, 1.5, 0, 1.8, 1.8, 'gold', { seg: 8 });
  lk.cyl(0, 3.1, 0, 1.3, 1.4, 'hullGray', { seg: 8 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    lk.beam([Math.cos(a) * 1.5, 1.3, Math.sin(a) * 1.5], [Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6], 0.14, 'steel', { round: true, collide: true });
  }
  lk.panel(0, 3.2, 1.28, 0.8, 0.5, 0, 0, 1, 'glassBlue');

  // ---- barracks / ops block (2 storeys + roof), bridge to the south rampart ----
  const bk = k.at(-6, -23.5, 0, 0);
  block(bk, {
    x0: -8,
    z0: -5.5,
    x1: 8,
    z1: 5.5,
    floors: 2,
    wall: 'cream',
    ribs: tm,
    lining: 'wood',
    team,
    open: [
      { n: ops(16, [4.5, { u: 11.5, w: 2.6, h: DOOR_H, team }], { every: 3.3 }), e: ops(11, [5.5], { every: 3.2 }), w: ops(11, [], { every: 3.2 }), s: ops(16, [{ u: 11, w: DOOR_W + 0.2, h: DOOR_H, team }], { every: 4 }) },
      { n: ops(16, [{ u: 8, w: DOOR_W, h: DOOR_H }], { every: 3.3, glass: 'tint' }), e: ops(11, [], { every: 3.2, glass: 'none', h: 1.3, sill: 1.1 }), w: ops(11, [], { every: 3.2 }), s: ops(16, [{ u: 13, w: DOOR_W, h: DOOR_H, team }], { every: 4 }) },
    ],
    stairs: [
      { x0: -6.2, z0: -3.9, x1: -6.2 + 7, z1: -3.9, from: 0, width: 1.7, rails: 'l' },
      { x0: 6.3, z0: 3.9, x1: 6.3 - 7, z1: 3.9, from: 1, width: 1.6, rails: 'l' },
    ],
  });
  bk.balcony(0.5, 5.5, 0, 6, 2.2, H, { glass: false, rail: tm });
  // bridge from the upper-floor south door to the rampart crest
  bk.span(3.8, H - 0.35, -8.05, 6.2, H + 0.1, -5.5, 'grid', { bevel: 0.03 });
  bk.railing(3.85, -8, 3.85, -5.6, H + 0.1);
  bk.railing(6.15, -8, 6.15, -5.6, H + 0.1);
  // interior props (skipped automatically where they would block doors / stairs)
  bk.bunk(-6.6, 0.8, Math.PI / 2, H);
  bk.bunk(-4.9, 0.8, Math.PI / 2, H);
  bk.locker(2.5, -1.2, Math.PI / 2, 3, H, tm);
  bk.table(-2, 1, 0, 3, 1.1, 0.2);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) bk.chair(-3 + i, 1 + s * 0.85, s < 0 ? 0 : Math.PI, 0.2, tm);
  bk.rack(7.3, 3.8, -Math.PI / 2, 0.2);
  bk.rack(7.3, -3.9, -Math.PI / 2, 0.2);
  bk.console(3, -4.8, 0, 0.2);
  bk.crate(-6.8, 4.4, 0.2, 1.0, 0.2);
  m.pickups.push({ pos: bk.p(0, H + 0.3, 1), kind: 'armor', elevated: true });
  m.perches.push(bk.p(-4, 2 * H + 0.2, 0), bk.p(4, 2 * H + 0.2, -3));

  // ---- courtyard cover & dressing ----
  k.hesco(-1, 3, -1, 8, 1.3);
  k.hesco(2.5, -7, 2.5, -2.5, 1.3);
  k.sandbags(4, 9, 7, 11);
  k.sandbags(4, -11, 7, -9);
  k.crate(0, -12.5, 0.3, 1.3);
  k.crate(1.2, -13.4, 0.9, 1.0);
  k.barrels(-2, 12, 3);
  P.o2Station(k.b, { ...k.at(-4.5, -9.8, 0, 0.12).f }, team);
  P.o2Station(k.b, { ...k.at(-4.5, 9.8, Math.PI, 0.12).f }, team);
  // vertical sun-tracking solar masts along the back
  for (const z of [-17.5, 17.5]) solarMast(k.at(-17.8, z, 0, 0), 8);
  k.lampPost(4, -15.5, 0, 0.12);
  k.lampPost(4, 15.5, 0, 0.12);

  m.pickups.push({ pos: k.p(-4, 0.3, -8.5), kind: 'o2', elevated: false }, { pos: k.p(-4, 0.3, 8.5), kind: 'o2', elevated: false });
  m.pickups.push({ pos: k.p(8, H + 0.3, 31.5), kind: 'ammo', elevated: true }, { pos: k.p(1.5, 0.3, 16.5), kind: 'grenade', elevated: false });
  m.perches.push(k.p(9.5, H + 0.2, 31.5), k.p(9.5, H + 0.2, -31.5));
  m.keep.push({ x: k.f.x, z: k.f.z, r: 44 });
}

/** Partially buried command centre: portal headwall with blast doors, war room, roof hatch stairs. */
function commandBunker(k: Kit, team: number, m: Markers): void {
  const tm = teamMat(team);
  const tl = teamLight(team);
  // interior box: x -6..5.5 (front at +5.5), z -7..7, walls 5 m, roof slab
  const x0 = -6.5;
  const x1 = 5.5;
  const hh = 5;
  k.slab(x0, -7, x1, 7, 0.2, 0.5, 'tile', {});
  k.wall(x0, -7, x0, 7, 0, hh, 0.8, 'concrete', [], { metal: false, cap: null, lining: { side: 1, mat: 'darkPanel', h: 1.4, rail: tm } });
  k.wall(x0, -7, x1, -7, 0, hh, 0.8, 'concrete', [], { metal: false, cap: null, lining: { side: 1, mat: 'darkPanel', h: 1.4, rail: tm } });
  k.wall(x0, 7, x1, 7, 0, hh, 0.8, 'concrete', [], { metal: false, cap: null, lining: { side: -1, mat: 'darkPanel', h: 1.4, rail: tm } });
  // headwall with the portal (wider & taller than the box, reads as a mountain portal)
  k.wall(x1 + 0.4, -10, x1 + 0.4, 10, 0, 6.6, 1.6, 'concrete', [{ u: 10, w: 4.4, h: 3.8, team, kind: 'door' }], { metal: false, cap: 'trim', bevel: 0.2 });
  for (const s of [-1, 1]) {
    // blast door leaves, swung open against the headwall
    k.box(x1 + 2.6, 1.95, s * 4.5, 3.4, 3.9, 0.7, 'darkPanel', { rot: s * 0.25, bevel: 0.12 });
    k.box(x1 + 2.6, 1.95, s * 4.5 - s * 0.38, 2.8, 3.2, 0.08, 'hazard', { rot: s * 0.25, collide: false, bevel: 0 });
    k.box(x1 + 1.3, 3.2, s * 6.8, 0.2, 5.8, 1.2, tm, { collide: false });
  }
  k.box(x1 + 1.25, 5.9, 0, 0.3, 0.8, 8, 'trim', { collide: false });
  k.panel(x1 + 1.42, 5.9, 0, 6, 0.6, 1, 0, 0, 'hazard');
  // roof slab (metal) + roof hatch; the stairs arrive on an exposed metal apron around the hatch,
  // the regolith cap sits 0.7 m higher (non-metal surfaces never meet metal ones at the same height)
  const stair = { x0: 3.3, z0: 5.6, x1: -5.1, z1: 5.6 };
  const cap = hh + 1.2;
  k.slab(x0 - 0.4, -7.4, x1 + 0.4, 7.4, hh + 0.5, 0.5, 'concrete', { holes: [[stair.x1, 4.6, 0.0, 6.6]], under: 'darkPanel' });
  k.stairs(stair.x0, stair.z0, stair.x1, stair.z1, 0.2, hh + 0.5, 1.6, { rails: 'r', mat: 'darkPanel' });
  k.berm(x0 - 1, 11, x1 + 0.5, 11, cap, 2.5, 9);
  k.berm(x0 - 1, -11, x1 + 0.5, -11, cap, 2.5, 9);
  // cap pieces around a 1.4 m metal margin of the hatch (x -6.5..1.4, z 3.2..7.4)
  k.span(x0 - 1.2, hh + 0.5, -9, x1 + 0.2, cap, 3.2, 'dirt', { metal: false, bevel: 0.15, seg: 3 });
  k.span(1.4, hh + 0.5, 3.2, x1 + 0.2, cap, 9, 'dirt', { metal: false, bevel: 0.15 });
  k.span(x0 - 1.2, hh + 0.5, 7.4, 1.4, cap, 9, 'dirt', { metal: false, bevel: 0.15 });
  k.span(x0 - 0.4, hh + 0.52, 3.2, 1.4, hh + 0.56, 7.4, 'grid', { collide: false, bevel: 0 });
  k.railing(0.2, 4.4, 0.2, 6.6, hh + 0.5, { mat: 'yellow' });
  k.railing(stair.x1, 4.45, 0.2, 4.45, hh + 0.5, { mat: 'yellow' });
  k.light(-3, hh + 1.8, 5.5, tl, 3, 6);
  k.radome(-2.5, -4.5, cap, 2.4, team);
  // war room: screen wall, consoles in rows, holo table
  k.box(x0 + 0.45, 2.6, 0, 0.1, 2.8, 9, 'dark', { collide: false, bevel: 0.02 });
  k.panel(x0 + 0.52, 2.6, 0, 8.4, 2.4, 1, 0, 0, 'screenMap');
  k.panel(x0 + 0.54, 3.9, 0, 3, 0.5, 1, 0, 0, team === 0 ? 'label0' : 'label1');
  for (const z of [-3.2, 0, 3.2]) k.console(-3.4, z, -Math.PI / 2, 0.2);
  k.cyl(0.8, 0.65, 0, 1.2, 0.9, 'darkPanel', { seg: 16 });
  k.cyl(0.8, 1.13, 0, 1.05, 0.04, 'screenMap', { seg: 16, collide: false, bevel: 0 });
  k.light(0.8, 2.2, 0, tl, 3, 6, { bounds: k.aabb(x0, 0, -7, x1, hh, 7) });
  k.roomLights(x0 + 0.5, -6.5, x1 - 0.2, 6.5, 0.2, hh, WARM, 5);
  k.locker(4.2, -6.4, 0, 4, 0.2, tm);
  k.locker(4.2, 6.4, Math.PI, 4, 0.2, tm);
  // spawn points inside the war room and just outside the portal
  for (let i = 0; i < 8; i++) {
    const p = i < 5 ? k.p(-1.5 + (i % 2) * 2.6, 0.5, -4.2 + i * 2.1) : k.p(x1 + 3.5, 0.5, -3 + (i - 5) * 3);
    m.spawns.push({ pos: p, yaw: k.f.rot - Math.PI / 2 });
  }
  m.perches.push(k.p(-2, cap + 0.1, 0));
}

/** Tall sun-tracking vertical solar array mast (two panels) — lunar south-pole style. */
export function solarMast(k: Kit, h = 9): void {
  k.cyl(0, 0.3, 0, 0.6, 0.6, 'concrete', { seg: 10, metal: false });
  k.beam([0, 0, 0], [0, h + 0.5, 0], 0.28, 'steel', { round: true, collide: true });
  for (const y of [h * 0.55, h]) {
    k.box(0, y, 0, 0.12, 2.6, 3.4, 'solar', { collide: false, bevel: 0.02 });
    k.box(-0.08, y, 0, 0.06, 2.7, 3.5, 'dark', { collide: false, bevel: 0 });
  }
  k.beacon(0, h + 1.8, 0, 0xff3a2a, 1.9, h * 0.1);
}

// ---------------------------------------------------------------------------
// OUTPOST — compact 2v2 base: 2-storey command block, redan (V-rampart), small HAS, lattice tower.
// Local +x faces the map centre; footprint x -12..12, z -16..16.

export function outpost(k: Kit, team: number, m: Markers): void {
  const tm = teamMat(team);
  const tl = teamLight(team);
  k.span(-12.5, -0.4, -9, 4, 0.12, 9, 'padDark', { metal: false, bevel: 0.04, seg: 4 });
  const ck = k.at(-7, 0, 0, 0);
  block(ck, {
    x0: -5,
    z0: -6,
    x1: 5,
    z1: 6,
    floors: 2,
    wall: 'cream',
    ribs: tm,
    lining: 'wood',
    team,
    open: [
      { e: ops(12, [{ u: 6, w: 2.6, h: DOOR_H, team }], { every: 3.3 }), n: ops(10, [], { every: 3, glass: 'warm' }), s: ops(10, [5], { every: 0 }), w: ops(12, [], { every: 3.3 }) },
      { e: ops(12, [{ u: 6, w: DOOR_W, h: DOOR_H }], { every: 3.3, glass: 'none', sill: 1.0, h: 1.3 }), n: ops(10, [], { every: 3, glass: 'tint' }), s: ops(10, [], { every: 3, glass: 'none', sill: 1.1, h: 1.2 }), w: ops(12, [], { every: 3.3 }) },
    ],
    stairs: [
      { x0: -3.8, z0: -4.4, x1: -3.8, z1: 2.4, from: 0, width: 1.6, rails: 'l' },
      { x0: 1.6, z0: 4.9, x1: -4.6 + 0.8, z1: 4.9, from: 1, width: 1.4, rails: 'r' },
    ],
  });
  ck.balcony(5, 0, Math.PI / 2, 6, 2.4, FLOOR, { rail: tm });
  ck.sign(5.25, 3.3, 0, 3, 0.8, 1, 0, team === 0 ? 'label0' : 'label1');
  ck.console(3.5, -4.9, 0, 0.2);
  ck.locker(3.8, 5.3, Math.PI, 3, 0.2, tm);
  ck.table(0.8, 3.8, 0, 2, 1, FLOOR);
  ck.rack(-4.2, -5.2, 0, FLOOR);
  ck.rack(-3.3, -5.2, 0, FLOOR);
  ck.console(2.5, -5.1, 0, FLOOR);
  m.perches.push(ck.p(-2, 2 * FLOOR + 0.2, -2), ck.p(6.8, FLOOR + 0.2, 0));
  m.pickups.push({ pos: ck.p(1, FLOOR + 0.3, -2.5), kind: 'armor', elevated: true });
  for (let i = 0; i < 4; i++) m.spawns.push({ pos: ck.p(1.2 + (i % 2) * 2.2, 0.5, -3 + i * 1.6), yaw: k.f.rot - Math.PI / 2 });
  // redan: V-shaped rampart pointing at the enemy, entrance at the tip
  rampart(k, 1.5, -13, 9.5, -2.6, { h: 3, w: 2.4, outer: -1, team, lamps: false });
  rampart(k, 9.5, 2.6, 1.5, 13, { h: 3, w: 2.4, outer: -1, team, lamps: false });
  k.stairs(0.05, -4.94, 4.15, -8.11, 0.12, 3.1, 1.5, { rails: 'both', mat: 'concrete', foot: true });
  k.stairs(0.05, 4.94, 4.15, 8.11, 0.12, 3.1, 1.5, { rails: 'both', mat: 'concrete', foot: true });
  k.turret(7.9, -4.7, -0.9, 3, team);
  k.turret(7.9, 4.7, 0.9, 3, team);
  // small hardened shelter for the rover (opening toward the centre)
  const hk = k.at(-6.5, 12, Math.PI / 2, 0.12);
  hk.vault(7.6, 9, 4.2, { team, door: false });
  const rov = hk.at(0, 0.5, 0, 0);
  rov.box(0, 1.0, 0, 2.2, 1.0, 3.8, tm, { bevel: 0.2 });
  rov.box(0, 1.8, -0.4, 1.9, 0.7, 2.0, 'hullGray', { bevel: 0.15 });
  rov.panel(0, 1.85, 0.62, 1.6, 0.45, 0, 0.3, 1, 'glassBlue');
  for (const sx of [-1, 1]) for (const sz of [-1.2, 1.2]) rov.cylH(sx * 1.2, 0.5, sz, 0.5, 0.4, 'x', 'rubber', { seg: 12, collide: false });
  // lattice tower (mag-climbable legs) as sniper perch
  P.commTower(k.b, { ...k.at(-9.5, -12.5).f }, 9, team);
  m.perches.push(k.p(-9.5, 9.5, -12.5));
  // cover & dressing
  k.sandbags(4, -1.2, 4, 1.2, 1.0, 0.12);
  k.hesco(-1, -10.5, -1, -15.5, 1.3);
  k.crate(1.5, 10.2, 0.2, 1.2);
  k.crate(2.6, 11.0, 0.7, 0.9);
  k.barrels(-0.8, -3.2, 2);
  P.o2Station(k.b, { ...k.at(-1.2, 3.8, -Math.PI / 2, 0.12).f }, team);
  m.pickups.push({ pos: k.p(0, 0.3, 3.8), kind: 'o2', elevated: false });
  k.lampPost(1.2, -3, 0, 0.12, 4.2, tl);
  for (const z of [-14, 14]) solarMast(k.at(-11.5, z * 0.55 + (z > 0 ? 3 : -3), 0, 0), 6.5);
  m.keep.push({ x: k.f.x, z: k.f.z, r: 20 });
}

// ---------------------------------------------------------------------------
// PROCESSING PLANT (ISRU) — machine hall with gallery + control room, MRE reactors with catwalk
// ring, hopper tower fed by a conveyor, O₂ tanks behind a berm. Local +x faces the pit.
// Footprint x -12..12, z -16..16; control point in the yard (x 1..10, z -9..2).

export function processingPlant(k: Kit, m: Markers, o: { conveyorTo?: THREE.Vector3; seed?: number } = {}): void {
  k.span(-12.5, -0.4, -16, 12.5, 0.12, 16, 'padDark', { metal: false, bevel: 0.04, seg: 4 });
  // --- machine hall (double-height core, gallery + control room upstairs) ---
  const hk = k.at(-5, 7, 0, 0);
  block(hk, {
    x0: -7,
    z0: -6,
    x1: 7,
    z1: 7,
    floors: 2,
    wall: 'hullGray',
    ribs: 'orange',
    lining: 'darkPanel',
    floorMat: 'grid',
    ceil: 'darkPanel',
    open: [
      { s: ops(14, [{ u: 4, w: 3.2, h: 3.2 }, { u: 10.5, w: DOOR_W, h: DOOR_H }], { every: 0 }), e: ops(13, [{ u: 4.5, w: 3, h: 3.2 }], { every: 3.2, glass: 'none', h: 1.2, sill: 1.1 }), w: ops(13, [10.8], { every: 0 }), n: ops(14, [7], { every: 3.4 }) },
      { s: ops(14, [{ u: 11, w: DOOR_W, h: DOOR_H }], { every: 2.6, glass: 'none', w: 1.8, h: 1.4, sill: 1.0 }), e: ops(13, [{ u: 9.5, w: DOOR_W, h: DOOR_H }], { every: 3.2, glass: 'tint' }), w: ops(13, [], { every: 3.2, glass: 'warm' }), n: ops(14, [], { every: 3.4, glass: 'warm' }) },
    ],
    stairs: [
      { x0: -5.4, z0: -4.3, x1: -5.4, z1: 2.7, from: 0, width: 1.6, rails: 'l' },
      { x0: 5.2, z0: 5.3, x1: -1.8, z1: 5.3, from: 1, width: 1.5, rails: 'r' },
    ],
    holes: { 1: [[-3.2, -3.8, 4.2, 2.8]] },
    light: WARM2,
    lightI: 5,
  });
  // gallery railings around the atrium
  hk.railing(-3.2, -3.8, 4.2, -3.8, FLOOR, { mat: 'orange' });
  hk.railing(-3.2, 2.8, 4.2, 2.8, FLOOR, { mat: 'orange' });
  hk.railing(-3.2, -3.8, -3.2, 2.8, FLOOR, { mat: 'orange' });
  hk.railing(4.2, -3.8, 4.2, 2.8, FLOOR, { mat: 'orange' });
  // crusher (jaw crusher block + flywheel) in the double-height core
  hk.box(0.5, 1.4, -0.5, 4, 2.8, 3.2, 'yellow', { bevel: 0.15 });
  hk.box(0.5, 3.1, -0.5, 3.2, 0.6, 2.4, 'darkPanel', { bevel: 0.1 });
  hk.cylH(-2, 1.9, -0.5, 1.3, 0.5, 'x', 'dark', { seg: 16 });
  hk.box(0.5, 4.2, -0.5, 2.6, 1.6, 2.2, 'dark', { collide: false, bevel: 0.08 });
  hk.pipe([[0.5, 5.0, -0.5], [0.5, 7.6, -0.5]], 0.35, 'steel');
  // control room props (upstairs, north)
  for (const x of [-5.5, -3.2]) hk.console(x, 6.1, Math.PI, FLOOR, 'screen');
  hk.console(6.0, -1.8, -Math.PI / 2, FLOOR, 'screenAmber');
  hk.rack(5.8, -5.2, 0, FLOOR);
  hk.sign(0, 6.3, -6.35, 4.2, 1.0, 0, -1, 'labelMine');
  hk.greebles(-6.8, 6.8, 0.6, 3.4, 7.25, 1, 11 + (o.seed ?? 0), 0.6);
  m.perches.push(hk.p(-4, 2 * FLOOR + 0.2, 4), hk.p(4, 2 * FLOOR + 0.2, -3));
  m.pickups.push({ pos: hk.p(-4.5, FLOOR + 0.3, -4.3), kind: 'ammo', elevated: true });

  // --- molten-regolith-electrolysis reactors with a catwalk ring at 4 m ---
  const reactors: [number, number][] = [
    [7.5, -12],
    [7.5, -4.5],
  ];
  for (const [x, z] of reactors) {
    k.cyl(x, 0.5, z, 2.6, 1.0, 'concrete', { seg: 16, metal: false });
    k.cyl(x, 5.5, z, 2.1, 9, 'hull', { seg: 20 });
    k.cyl(x, 10.4, z, 1.5, 0.8, 'darkPanel', { seg: 16 });
    for (const y of [2.2, 6.8]) k.cyl(x, y, z, 2.2, 0.35, 'screenAmber', { seg: 20, collide: false, bevel: 0 });
    k.cyl(x, 8.6, z, 2.18, 0.3, 'orange', { seg: 20, collide: false });
    k.pipe([[x - 1.6, 9.5, z], [x - 1.6, 11.6, z], [x - 5, 11.6, z]], 0.22, 'steel');
    k.light(x - 2.8, 2.2, z, 0xff9a40, 5, 7);
  }
  // catwalk: reactors ↔ hall east door (upper floor), stair up from the yard
  k.catwalk(4.2, -15.2, 4.2, 10.5, FLOOR, 1.8, { rails: 'r', posts: 5 });
  k.catwalk(2.05, 10.5, 3.3, 10.5, FLOOR, 1.8, { rails: 'none', lights: false });
  k.stairs(1.6, -8.2, 1.6, -2.0, 0.12, FLOOR, 1.6, { rails: 'l', style: 'open', foot: true });
  k.span(-2.4, FLOOR - 0.3, -2.0, 3.3, FLOOR, 0.8, 'grid', { bevel: 0.03 });
  k.railing(-2.35, -1.95, 0.8, -1.95, FLOOR);
  k.railing(-2.35, -1.95, -2.35, 0.75, FLOOR);
  m.perches.push(k.p(4.2, FLOOR + 0.2, -10));

  // --- hopper tower fed by the pit conveyor ---
  const hop = k.at(9, 12, 0, 0);
  for (const sx of [-1.6, 1.6]) for (const sz of [-1.6, 1.6]) hop.box(sx, 3.2, sz, 0.4, 6.4, 0.4, 'yellow', { bevel: 0.05 });
  hop.span(-2.1, 6.2, -2.1, 2.1, 6.6, 2.1, 'grid', { bevel: 0.04 });
  hop.cyl(0, 4.8, 0, 1.8, 2.4, 'darkPanel', { seg: 12, collide: false });
  hop.cyl(0, 3.2, 0, 0.6, 1.0, 'dark', { seg: 10, collide: false });
  hop.railing(-2, -2, 2, -2, 6.6);
  hop.railing(-2, 2, 2, 2, 6.6);
  hop.railing(-2, -2, -2, 2, 6.6);
  hop.light(0, 5.8, 0, WARM, 3, 6);
  if (o.conveyorTo) {
    const a = hop.p(0, 6.2, 2.1);
    P.conveyor(k.b, o.conveyorTo.x, o.conveyorTo.y, o.conveyorTo.z, a.x, a.y, a.z);
  }

  // --- O₂ tank farm behind a berm (cover for the yard) ---
  k.berm(-10, -8, -2, -8, 1.8, 1.0, 4.2);
  for (const [x, z, r] of [
    [-9, -12.5, 2.0],
    [-4.6, -12.5, 1.7],
  ] as const) {
    k.cyl(x, 0.6, z, r * 0.7, 1.2, 'concrete', { seg: 12, metal: false });
    k.b.sphere(k.p(x, r + 1.2, z), r, 'hull', { collide: true, seg: 20 });
    k.b.torus(k.p(x, r + 1.2, z), r + 0.02, 0.08, qAxis(1, 0, 0, Math.PI / 2), 'teal');
  }
  k.pipe([[-9, 4.4, -12.5], [-4.6, 4.4, -12.5], [-4.6, 4.4, -6.5]], 0.18, 'steel');
  k.sign(-6.8, 1.2, -5.95, 2.2, 0.55, 0, 1, 'hazard');

  // --- excavator (bucket-wheel rover) parked by the pit ---
  const ex = k.at(9.2, 3.2, 0.3, 0.12);
  ex.box(0, 1.2, 0, 3.4, 1.4, 2.2, 'yellow', { bevel: 0.2 });
  ex.box(-0.6, 2.4, 0, 1.6, 1.0, 1.8, 'hull', { bevel: 0.15 });
  ex.panel(0.22, 2.45, 0, 1.2, 0.6, 1, 0, 0, 'glassBlue');
  ex.cylH(2.3, 1.6, 0, 1.1, 0.5, 'z', 'dark', { seg: 10 });
  for (const sz of [-1.2, 1.2]) ex.box(0, 0.45, sz, 3.6, 0.8, 0.6, 'rubber', { collide: false, bevel: 0.2 });

  // --- yard cover around the control point ---
  k.hesco(-0.6, -6.5, -0.6, -2.5, 1.3);
  P.containers(k.b, k.at(0.8, -12.8, 0.1).f, [[0, 0, 0, Math.PI / 2]], 71 + (o.seed ?? 0));
  k.crate(3, -1.5, 0.4, 1.2);
  k.barrels(2.2, -9.8, 3, 0.12);
  k.lampPost(1.5, -15, 0, 0.12);
  k.lampPost(11.5, -8.2, Math.PI, 0.12);
  m.cp = k.p(0.8, 0.12, -9.6);
  m.pickups.push({ pos: k.p(-2.6, 0.3, -5.5), kind: 'o2', elevated: false });
  m.keep.push({ x: k.f.x, z: k.f.z, r: 20 });
}

// ---------------------------------------------------------------------------
// SILO COMPLEX — three ore silos with an 8 m gantry, loadout building (2 storeys, roof walk),
// rail loader bay, containers. Local +x faces the pit. Footprint x -12..12, z -16..16.

export function siloComplex(k: Kit, m: Markers, o: { seed?: number } = {}): void {
  k.span(-12.5, -0.4, -16, 12.5, 0.12, 16, 'padDark', { metal: false, bevel: 0.04, seg: 4 });
  const sx = -8;
  for (const z of [-10, 0, 10]) {
    k.cyl(sx, 0.7, z, 3.0, 1.4, 'concrete', { seg: 20, metal: false });
    k.cyl(sx, 7.4, z, 2.7, 12, 'cream', { seg: 24 });
    k.cyl(sx, 13.6, z, 2.8, 0.5, 'teal', { seg: 24, collide: false });
    k.b.dome(k.p(sx, 13.8, z), 2.7, 'hullGray', { seg: 24 });
    for (let y = 3; y < 13; y += 3) k.b.torus(k.p(sx, y, z), 2.73, 0.08, qAxis(1, 0, 0, Math.PI / 2), 'trim');
    k.panel(sx + 2.72, 6, z, 2.0, 2.0, 1, 0, 0, 'pd');
    // discharge chute
    k.box(sx + 2.8, 1.8, z, 1.6, 0.9, 1.4, 'yellow', { tilt: qAxis(0, 0, 1, -0.4), bevel: 0.1 });
  }
  // gantry at 8 m along the silo faces
  k.catwalk(sx + 3.9, -12.5, sx + 3.9, 7.5, 8, 2, { rails: 'l', lights: true });
  for (const z of [-12, -2, 7]) k.box(sx + 3.9, 4, z, 0.4, 8, 0.4, 'darkPanel', { bevel: 0.05 });
  // loadout building (2 storeys); the 8 m gantry lands on its roof (no parapet on that side)
  const lk = k.at(3.2, 10.5, 0, 0);
  block(lk, {
    x0: -6,
    z0: -4.5,
    x1: 6,
    z1: 4.5,
    floors: 2,
    wall: 'cream',
    ribs: 'teal',
    open: [
      { s: ops(12, [{ u: 3, w: 3.0, h: 3.2 }, 9], { every: 0 }), e: ops(9, [4.5], { every: 0 }), w: ops(9, [4.5], { every: 0 }), n: ops(12, [], { every: 3 }) },
      { s: ops(12, [], { every: 2.8, glass: 'none', h: 1.3, sill: 1.0 }), e: ops(9, [], { every: 3, glass: 'tint' }), w: ops(9, [], { every: 3, glass: 'warm' }), n: ops(12, [], { every: 3 }) },
    ],
    stairs: [
      { x0: -4.0, z0: 2.9, x1: 2.5, z1: 2.9, from: 0, width: 1.4, rails: 'r' },
      { x0: 4.0, z0: -2.9, x1: -2.5, z1: -2.9, from: 1, width: 1.4, rails: 'r' },
    ],
    parapet: 0,
    clutter: false,
  });
  lk.railing(-5.9, -4.4, 5.9, -4.4, 2 * FLOOR);
  lk.railing(5.9, -4.4, 5.9, 4.4, 2 * FLOOR);
  lk.railing(-5.9, 4.4, 5.9, 4.4, 2 * FLOOR);
  // two-flight stair from the yard up to the gantry (landing at 4 m)
  k.stairs(-2, -15.2, -2, -8.8, 0.12, FLOOR, 1.6, { rails: 'both', style: 'open', foot: true });
  k.span(-2.8, FLOOR - 0.3, -8.8, -1.2, FLOOR, -7.0, 'grid', { bevel: 0.03 });
  k.stairs(-2, -7.0, -2, -0.6, FLOOR, 8, 1.6, { rails: 'r', style: 'open' });
  k.span(-3.2, 7.7, -0.6, -1.2, 8, 1.2, 'grid', { bevel: 0.03 });
  k.railing(-1.25, -0.6, -1.25, 1.15, 8);
  k.railing(-3.1, 1.15, -1.25, 1.15, 8);
  for (let i = 0; i < 2; i++) lk.console(-4 + i * 2.2, -3.9, 0, 0.2);
  lk.rack(5.2, -3.6, 0, FLOOR);
  lk.crate(-4.8, -3.3, 0.3, 1.1, FLOOR);
  lk.table(2, 0.2, 0, 2.2, 1, FLOOR);
  m.pickups.push({ pos: lk.p(-1, FLOOR + 0.3, 0.2), kind: 'grenade', elevated: true });
  m.perches.push(lk.p(3, 2 * FLOOR + 0.2, 1), k.p(sx + 3.9, 8.2, -8));
  // rail loader bay (walk-under hopper bridge)
  const rb = k.at(5, -4, 0, 0);
  for (const s of [-1, 1]) {
    rb.box(s * 3.2, 2.6, -3, 0.8, 5.2, 0.8, 'darkPanel', { bevel: 0.08 });
    rb.box(s * 3.2, 2.6, 3, 0.8, 5.2, 0.8, 'darkPanel', { bevel: 0.08 });
  }
  rb.span(-3.6, 5.2, -3.6, 3.6, 5.8, 3.6, 'grid', { bevel: 0.05 });
  rb.box(0, 6.8, 0, 3.4, 2.0, 3.4, 'yellow', { bevel: 0.15 });
  rb.cyl(0, 4.6, 0, 0.7, 1.2, 'dark', { seg: 10, collide: false });
  rb.railing(-3.5, -3.5, 3.5, -3.5, 5.8);
  rb.railing(-3.5, 3.5, 3.5, 3.5, 5.8);
  rb.light(0, 4.2, 0, WARM, 5, 8, { dir: [0, -1, 0], cone: -0.3 });
  for (const x of [-1.6, 1.6]) rb.box(x, 0.16, 0, 0.18, 0.1, 14, 'steel', { collide: false, bevel: 0.02 });
  // ore wagons on the rail (cover)
  for (const z of [-4.5, 4.5]) {
    const wk = rb.at(0, z, 0, 0.12);
    wk.box(0, 1.0, 0, 2.6, 1.6, 3.8, 'orange', { bevel: 0.12 });
    wk.box(0, 1.9, 0, 2.2, 0.3, 3.4, 'oreRock', { collide: false, bevel: 0.1 });
  }
  // yard cover
  P.containers(k.b, k.at(10.5, -3, 0.04).f, [[0, 0, 0, 0]], 81 + (o.seed ?? 0));
  k.hesco(10.5, -14, 10.5, -9, 1.3);
  k.crate(1.2, -13, 0.3, 1.3);
  k.crate(2.4, -14.2, 0.9, 1.0);
  k.barrels(10.5, 3.5, 3, 0.12, 'teal');
  k.lampPost(-2.5, -6, 0, 0.12);
  k.lampPost(10.8, 2, Math.PI, 0.12);
  m.cp = k.p(4.5, 0.12, -4);
  m.pickups.push({ pos: k.p(-3.5, 0.3, -8), kind: 'o2', elevated: false });
  m.keep.push({ x: k.f.x, z: k.f.z, r: 20 });
}

// ---------------------------------------------------------------------------
// SPACEPORT — terminal (glazed hall + mezzanine), control tower with glazed cab, jet-bridge tube into
// a walkable shuttle (side hatch + rear cargo ramp), sintered pads with blast-deflection berms,
// gantry crane over containers, cryo tanks behind a berm. Local -z faces the action.
// Footprint x -26..26, z -13..13.

export function spaceport(k: Kit, m: Markers, o: { seed?: number; compact?: boolean } = {}): void {
  const seed = o.seed ?? 0;
  // --- terminal ---
  const t = k.at(-1, 1, 0, 0);
  block(t, {
    x0: -8,
    z0: -5,
    x1: 8,
    z1: 5,
    floors: 2,
    wall: 'cream',
    ribs: 'teal',
    lining: 'wood',
    open: [
      { s: ops(16, [4, 12], { every: 2.6, glass: 'tint', w: 2.0, h: 2.6, sill: 0.4 }), n: ops(16, [{ u: 8, w: DOOR_W, h: DOOR_H }], { every: 3.2 }), w: ops(10, [8.9], { every: 0 }), e: ops(10, [8.6], { every: 0 }) },
      { s: ops(16, [], { every: 2.6, glass: 'tint', w: 2.0, h: 2.8, sill: 0.3 }), n: ops(16, [], { every: 3.2, glass: 'warm' }), w: ops(10, [], { every: 3, glass: 'tint' }), e: ops(10, [{ u: 8, w: DOOR_W, h: DOOR_H }], { every: 0 }) },
    ],
    stairs: [{ x0: -6.3, z0: -3.2, x1: -6.3, z1: 3.0, from: 0, width: 1.7, rails: 'l' }],
    holes: { 1: [[-5.3, -4.8, 7.8, -0.4]] },
    light: WARM,
    lightI: 6.5,
  });
  t.railing(-5.3, -0.4, 7.75, -0.4, FLOOR, { glass: true, mat: 'brass' });
  t.railing(-5.3, -4.75, -5.3, -0.4, FLOOR, { glass: true, mat: 'brass' });
  t.sign(0, 2.9, -5.25, 4.6, 1.15, 0, -1, 'labelPort');
  // lounge: sofas, planters, check-in counters (warm, lived-in)
  t.sofa(-2.5, -2.2, 0, 2.4, 0.2, 'teal');
  t.sofa(2.2, -2.2, 0, 2.4, 0.2, 'orange');
  t.planter(0, 3.6, 0, 3.2, 0.2, seed + 3, 'cream');
  t.table(-0.2, -0.6, 0, 1.4, 0.8, 0.2);
  t.box(5.2, 0.6, 2.8, 3.2, 1.0, 0.9, 'wood', { bevel: 0.06, metal: false });
  t.box(5.2, 1.13, 2.8, 3.4, 0.08, 1.0, 'brass', { collide: false, bevel: 0.02 });
  t.console(5.2, 3.9, Math.PI, 0.2, 'screenAmber');
  // mezzanine: departure lounge + gate
  t.sofa(-3, 3.6, Math.PI, 2.4, FLOOR, 'orange');
  t.sofa(0.5, 3.6, Math.PI, 2.4, FLOOR, 'teal');
  t.planter(4.2, 3.9, 0, 2.2, FLOOR, seed + 5, 'teal');
  t.sign(7.7, FLOOR + 3.0, 2.8, 1.6, 0.5, -1, 0, 'hazard');
  m.pickups.push({ pos: t.p(-2, FLOOR + 0.3, 1.6), kind: 'armor', elevated: true });
  m.perches.push(t.p(-4, 2 * FLOOR + 0.2, 2), t.p(5, 2 * FLOOR + 0.2, -3));
  // east exterior stair to the mezzanine gate landing (jet bridge junction)
  k.stairs(8.8, -5.2, 8.8, 1.6, 0.12, FLOOR, 1.6, { rails: 'r', style: 'open', foot: true });
  k.span(7.2, FLOOR - 0.3, 1.6, 10.6, FLOOR, 5.0, 'grid', { bevel: 0.03 });
  k.railing(9.6, 1.65, 10.55, 1.65, FLOOR);
  k.railing(7.25, 4.95, 10.55, 4.95, FLOOR);
  // --- jet bridge tube → docked shuttle ---
  k.tube(10.4, 3.3, 15.2, 3.3, FLOOR);
  k.span(15.0, FLOOR - 0.3, 2.2, 16.6, FLOOR, 4.4, 'grid', { bevel: 0.02 });
  k.b.torus(k.p(15.6, FLOOR + 1.95, 3.3), 2.35, 0.3, k.q(Math.PI / 2), 'orange');
  shuttle(k.at(18.4, -1, Math.PI, 0), m, seed);
  // --- sintered pads with blast-deflection berms ---
  const pads: [number, number, number][] = o.compact ? [[18.4, -1, 7.5]] : [[18.4, -1, 7.5], [-18, -6.5, 6]];
  for (const [x, z, r] of pads) {
    k.cyl(x, 0.06, z, r, 0.22, 'padDark', { seg: 32, metal: false, bevel: 0.05 });
    k.b.torus(k.p(x, 0.18, z), r * 0.72, 0.1, qAxis(1, 0, 0, Math.PI / 2), 'paintWhite');
    k.box(x, 0.18, z, r * 1.2, 0.02, 0.4, 'yellow', { collide: false, bevel: 0 });
    k.box(x, 0.18, z, 0.4, 0.02, r * 1.2, 'yellow', { collide: false, bevel: 0 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.beacon(x + Math.cos(a) * (r - 0.3), 0.35, z + Math.sin(a) * (r - 0.3), 0x40ff80, 1.2, i / 8);
    }
  }
  // berm arcs (gaps toward the terminal)
  bermArc(k, 18.4, -1, 11, 2.8, -0.55, 1.05);
  if (!o.compact) {
    bermArc(k, -18, -6.5, 9.5, 2.4, Math.PI * 0.85, Math.PI * 1.4);
    // --- control tower with glazed cab ---
    const tw = k.at(-19, 6, 0, 0);
    block(tw, {
      x0: -4,
      z0: -4,
      x1: 4,
      z1: 4,
      floors: 2,
      wall: 'hullGray',
      ribs: 'teal',
      lining: 'darkPanel',
      floorMat: 'grid',
      open: [
        { s: ops(8, [4], { every: 0 }), e: ops(8, [4], { every: 0 }), w: ops(8, [], { every: 2.6, glass: 'warm' }), n: ops(8, [], { every: 2.6, glass: 'warm' }) },
        { s: ops(8, [], { every: 2.6, glass: 'none', h: 1.2, sill: 1.1 }), e: ops(8, [], { every: 2.6, glass: 'tint' }), w: ops(8, [], { every: 2.6, glass: 'none', h: 1.2, sill: 1.1 }), n: ops(8, [], { every: 2.6, glass: 'tint' }) },
      ],
      stairs: [
        { x0: -2.8, z0: 2.6, x1: 3.2, z1: 2.6, from: 0, width: 1.3, rails: 'r' },
        { x0: 2.8, z0: -2.6, x1: -3.2, z1: -2.6, from: 1, width: 1.3, rails: 'r' },
      ],
      parapet: 0,
    });
    // cab: glass ring + roof on posts over the tower roof
    const cy = 2 * FLOOR;
    for (const [ax, az, bx, bz] of [
      [-4.4, -4.4, 4.4, -4.4],
      [4.4, -4.4, 4.4, 4.4],
      [4.4, 4.4, -4.4, 4.4],
      [-4.4, 4.4, -4.4, -4.4],
    ] as const) {
      tw.wall(ax, az, bx, bz, cy, 1.0, 0.3, 'hullGray', [], { cap: 'teal' });
      tw.box((ax + bx) / 2, cy + 2.0, (az + bz) / 2, Math.abs(bx - ax) + 0.2, 2.0, Math.abs(bz - az) + 0.2, 'glassTint', { bevel: 0, noShoot: true, metal: false, collide: false });
    }
    for (const sx of [-4.4, 4.4]) for (const sz of [-4.4, 4.4]) tw.box(sx, cy + 1.6, sz, 0.35, 3.2, 0.35, 'trim', { bevel: 0.05 });
    tw.span(-5, cy + 3.1, -5, 5, cy + 3.5, 5, 'teal', { bevel: 0.1 });
    tw.span(-4.6, cy + 3.5, -4.6, 4.6, cy + 3.8, 4.6, 'hullGray', { bevel: 0.08 });
    tw.beam([0, cy + 3.8, 0], [0, cy + 7, 0], 0.12, 'steel', { round: true });
    tw.beacon(0, cy + 7.1, 0, 0xff3a2a, 1.3, 0.4);
    tw.roomLights(-4, -4, 4, 4, cy, cy + 3.05, WARM, 4, true);
    tw.console(-1.5, 3.6, Math.PI, cy, 'screen');
    tw.console(1.5, 3.6, Math.PI, cy, 'screenAmber');
    tw.console(3.6, 0.8, -Math.PI / 2, cy, 'screen');
    m.perches.push(tw.p(0, cy + 0.2, 1), tw.p(0, cy + 3.9, 0));
    // --- gantry crane over the container yard ---
    const cr = k.at(-2, 10.3, 0, 0);
    for (const sx of [-10, 10]) {
      for (const sz of [-2.2, 2.2]) cr.beam([sx, 0, sz], [sx, 8.5, 0], 0.4, 'yellow', { collide: true });
      cr.box(sx, 0.3, 0, 1.2, 0.6, 5.4, 'darkPanel', { bevel: 0.08 });
    }
    cr.box(0, 8.8, 0, 21, 0.8, 1.2, 'yellow', { bevel: 0.1 });
    cr.box(3.5, 8.1, 0, 2.2, 1.0, 1.8, 'darkPanel', { bevel: 0.1 });
    cr.beam([3.5, 7.6, 0], [3.5, 3.8, 0], 0.06, 'steel', { round: true });
    cr.box(3.5, 3.4, 0, 2.6, 0.5, 0.6, 'hazard', { collide: false });
    cr.light(3.5, 7.3, 0, WARM, 4, 8, { dir: [0, -1, 0], cone: 0.1 });
    P.containers(k.b, cr.at(-6, 0, Math.PI / 2).f, [[0, 0, 0, 0], [0, 2.6, 0, 0], [0, 0, 1, 0]], 91 + seed);
    P.containers(k.b, cr.at(6, 0.3, Math.PI / 2 + 0.05).f, [[0, 0, 0, 0]], 92 + seed);
    m.perches.push(cr.p(-6, 5.2, 0));
  }
  // --- cryo tanks set apart behind a berm ---
  const ct = k.at(o.compact ? -16 : 23, o.compact ? 7 : -11, 0, 0);
  for (const dz of [-1.6, 1.6]) {
    ct.cylH(0, 1.8, dz, 1.3, 6, 'x', 'hull', { seg: 18 });
    for (const s of [-1, 1]) ct.box(s * 2.2, 0.55, dz, 0.5, 1.1, 2.4, 'dark', { collide: false });
    ct.cylH(0, 1.8, dz, 1.34, 0.5, 'x', 'teal', { seg: 18, collide: false });
  }
  ct.pipe([[-3, 2.8, 0], [-5, 2.8, 0], [-5, 0.4, -2]], 0.14, 'brass');
  ct.berm(-4, 3.4, 3.2, 3.4, 2.2, 0.8, 4);
  // --- apron dressing ---
  k.lampPost(-9.5, -7.5, 0, 0.12);
  k.lampPost(9.8, -8.5, Math.PI, 0.12);
  k.jersey(-4, -8.5, 0.1, 3);
  k.jersey(3.5, -9.6, -0.15, 3);
  k.crate(-11, -3.5, 0.3, 1.2);
  k.crate(-11.4, -2.3, 0.8, 0.9);
  k.barrels(12.5, -9.5, 3, 0.12, 'teal');
  m.keep.push({ x: k.f.x, z: k.f.z, r: 26 });
  m.pickups.push({ pos: k.p(-11, 0.3, -6), kind: 'ammo', elevated: false });
}

/** berm arc around a pad (a0..a1 radians, blast deflection) */
function bermArc(k: Kit, x: number, z: number, r: number, h: number, a0: number, a1: number): void {
  const n = Math.max(2, Math.round(((a1 - a0) * r) / 4.5));
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    k.berm(x + Math.cos(t0) * r, z + Math.sin(t0) * r, x + Math.cos(t1) * r, z + Math.sin(t1) * r, h, 1.0, h * 2.2 + 1);
  }
}

/** Docked shuttle: walkable cabin (floor at 4 m, side hatch at local -x z=4.3, rear cargo ramp). */
function shuttle(k: Kit, m: Markers, seed: number): void {
  const fy = FLOOR;
  const L = 16;
  const R = 2.7;
  const cy = fy + 1.25;
  // exterior hull (visual shell) + nose + engines + wings + legs
  const g = new THREE.CylinderGeometry(R, R, L, 28, 4, true);
  k.b.add('hull', g, k.p(0, cy, 0), k.q(0, qAxis(1, 0, 0, Math.PI / 2)));
  const nose = new THREE.SphereGeometry(R, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  k.b.add('hull', nose, k.p(0, cy, L / 2), k.q(0, qAxis(1, 0, 0, Math.PI / 2)), V(1, 1.4, 1));
  k.panel(0, cy + 1.6, L / 2 + 2.3, 2.4, 0.9, 0, 0.55, 1, 'glassBlue');
  for (const s of [-1, 1]) {
    k.cylH(s * 2.5, cy - 0.2, -L / 2 - 0.7, 0.95, 1.8, 'z', 'darkPanel', { seg: 16 });
    k.cylH(s * 2.5, cy - 0.2, -L / 2 - 1.65, 0.75, 0.2, 'z', 'screenAmber', { seg: 16, collide: false });
    k.box(s * 5.2, cy - 0.9, -2.5, 5.6, 0.35, 5.5, 'hull', { bevel: 0.15, tilt: qAxis(0, 0, 1, s * 0.12) });
    k.box(s * 7.6, cy - 0.55, -3.8, 0.9, 0.4, 3.0, 'orange', { bevel: 0.1, collide: false });
    for (const lz of [-5, 5]) k.beam([s * 1.8, cy - 2, lz], [s * 2.6, 0.1, lz], 0.28, 'steel', { round: true, collide: true });
  }
  k.box(0, cy + R + 0.5, -L / 2 + 1.5, 0.4, 2.2, 3.0, 'hull', { bevel: 0.12, collide: false });
  k.box(0, cy + 0.2, 0, 2 * R + 0.12, 0.3, L, 'orange', { collide: false, bevel: 0.05 });
  // cabin colliders (box interior inside the round hull)
  const w = 3.4;
  k.span(-w / 2, fy - 0.3, -L / 2 + 0.2, w / 2, fy, L / 2 - 0.4, 'tile', { bevel: 0.02 });
  k.span(-w / 2, fy + 2.8, -L / 2 + 0.2, w / 2, fy + 3.1, L / 2 - 0.4, 'cream', { bevel: 0.02 });
  // walls with the side hatch (local -x, z≈4.3) and the open rear
  k.wall(-w / 2 - 0.15, -L / 2 + 0.2, -w / 2 - 0.15, L / 2 - 0.4, fy, 2.8, 0.3, 'cream', [{ u: 5, w: 1.2, h: 0.8, sill: 1.3, glass: 'warm' }, { u: 9, w: 1.2, h: 0.8, sill: 1.3, glass: 'warm' }], { cap: null, lining: { side: -1, mat: 'wood', h: 1.0 } });
  k.wall(w / 2 + 0.15, -L / 2 + 0.2, w / 2 + 0.15, L / 2 - 0.4, fy, 2.8, 0.3, 'cream', [{ u: 3.5, w: 1.8, h: 2.4, accent: 'orange' }], { cap: null, lining: { side: 1, mat: 'wood', h: 1.0 } });
  k.wall(-w / 2, L / 2 - 0.55, w / 2, L / 2 - 0.55, fy, 2.8, 0.3, 'darkPanel', [], { cap: null });
  // seats + cockpit console
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) k.chair(s * 1.1, -2 + i * 1.6, Math.PI, fy, i % 2 ? 'teal' : 'orange');
  k.console(0, L / 2 - 1.4, 0, fy, 'screen');
  k.roomLights(-w / 2, -L / 2 + 0.5, w / 2, L / 2 - 0.8, fy, fy + 2.8, WARM, 5, true);
  // rear cargo ramp down to the pad
  k.ramp(0, -L / 2 + 0.3, 0, -L / 2 - 6.4, fy, 0.12, 2.8, 'grid');
  for (const s of [-1, 1]) k.box(s * 1.55, fy / 2, -L / 2 - 2.8, 0.2, 0.25, 6.8, 'yellow', { collide: false, tilt: qAxis(1, 0, 0, -Math.atan2(fy - 0.12, 6.7)) });
  k.light(0, fy + 1.5, -L / 2 + 1.5, WARM, 3, 6);
  m.pickups.push({ pos: k.p(0, fy + 0.3, 1.5), kind: 'grenade', elevated: true });
  void seed;
}

/** Octagonal ring balcony (atria, domes): 8 slab segments between radii r0..r1 at height y, minus `skip`. */
export function ringBalcony(k: Kit, r0: number, r1: number, y: number, skip: number[] = [], mat: Mat = 'tile', rail: Mat = 'brass'): void {
  const rm = (r0 + r1) / 2;
  const w = r1 - r0;
  const tl = 2 * r1 * Math.tan(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    if (skip.includes(i)) continue;
    const a = (i * Math.PI) / 4;
    const kk = k.at(Math.cos(a) * rm, Math.sin(a) * rm, -a, 0);
    // local x = radial, local z = tangential
    kk.box(0, y - 0.18, 0, w, 0.36, tl + 0.2, mat, { bevel: 0.04, seg: 2 });
    kk.box(-w / 2 + 0.05, y - 0.3, 0, 0.3, 0.5, tl * (r0 / r1) + 0.2, 'trim', { collide: false, bevel: 0.04 });
    const ti = 2 * r0 * Math.tan(Math.PI / 8);
    k.at(Math.cos(a) * (r0 + 0.08), Math.sin(a) * (r0 + 0.08), -a, 0).railing(0, -ti / 2, 0, ti / 2, y, { glass: true, mat: rail });
    kk.light(0, y - 0.7, 0, WARM, 2.5, 5, { dir: [0, -1, 0], cone: 0.1 });
  }
}

// ---------------------------------------------------------------------------
// LAB — ESA/Foster printed cellular regolith shell over an atrium (ring balcony, Pd sculpture),
// 2-storey lab wing linked at 4 m, telescope drum with a catwalk ring, radome. Local +z faces the action.
// Footprint x -26..26, z -13..13.

export function lab(k: Kit, m: Markers, o: { seed?: number; compact?: boolean } = {}): void {
  const seed = o.seed ?? 0;
  const sh = k.at(-9, 0, 0, 0);
  const R = 11.5;
  sh.regolithShell(0, 0, R, 1.05, [
    { az: Math.PI / 2, w: 4.2, h: 3.8 },
    { az: Math.PI, w: 3.8, h: 3.4 },
    { az: -Math.PI / 2, w: 3.8, h: 3.4 },
    { az: 0, w: 3.2, h: 2.9, y0: FLOOR },
  ]);
  // shell dressing: warm portholes, brass band, oculus cap with antenna (inhabited, printed shell)
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.11;
    if ([Math.PI / 2, Math.PI, -Math.PI / 2 + Math.PI * 2, 0].some((oa) => Math.abs(((a - oa + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.35)) continue;
    const y = 2.6;
    const rr = Math.sqrt(R * R - (y / 1.05) ** 2) + 0.02;
    const n = V(Math.cos(a), 0.22, Math.sin(a)).normalize();
    sh.b.panel(sh.p(Math.cos(a) * rr, y, Math.sin(a) * rr), 0.9, 0.9, n, 'glassWarm');
    sh.b.torus(sh.p(Math.cos(a) * (rr + 0.05), y, Math.sin(a) * (rr + 0.05)), 0.55, 0.1, sh.q(-a + Math.PI / 2).multiply(qAxis(1, 0, 0, -0.22)), 'brass');
  }
  sh.b.torus(sh.p(0, 0.9, 0), R + 0.12, 0.22, qAxis(1, 0, 0, Math.PI / 2), 'orange');
  sh.cyl(0, R * 1.05 - 0.3, 0, 2.2, 0.8, 'brass', { seg: 20, collide: false });
  sh.cyl(0, R * 1.05 + 0.2, 0, 1.6, 0.4, 'glassBlue', { seg: 20, collide: false, bevel: 0 });
  sh.beam([0, R * 1.05 + 0.3, 0], [0, R * 1.05 + 3.5, 0], 0.1, 'steel', { round: true });
  sh.beacon(0, R * 1.05 + 3.6, 0, 0xff3a2a, 1.6, 0.2);
  // floor (octagon from two boxes) + warm interior
  sh.box(0, -0.05, 0, 18.8, 0.5, 8, 'tile', { bevel: 0.03, seg: 2 });
  sh.box(0, -0.05, 0, 8, 0.5, 18.8, 'tile', { bevel: 0.03, seg: 2 });
  sh.box(0, -0.06, 0, 13.4, 0.48, 13.4, 'tile', { rot: Math.PI / 4, bevel: 0.03, seg: 2 });
  // gallery ring at 4 m (reached through the lab wing and the upper east opening)
  ringBalcony(sh, 4.4, 8.6, FLOOR, [], 'wood', 'brass');
  // walkway through the upper east opening → bridge to the lab wing
  sh.span(8.2, FLOOR - 0.35, -1.4, 14.2, FLOOR, 1.4, 'grid', { bevel: 0.03 });
  sh.railing(10.6, -1.35, 14.1, -1.35, FLOOR);
  sh.railing(10.6, 1.35, 14.1, 1.35, FLOOR);
  // Pd crystal sculpture in a planter ring + warm uplights
  P.oreCluster(sh.b, sh.p(0, 0, 0), 1.6, 51 + seed);
  sh.cyl(0, 0.35, 0, 2.6, 0.7, 'brass', { seg: 24, metal: false });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    sh.planter(Math.cos(a) * 3.6, Math.sin(a) * 3.6, -a + Math.PI / 2, 1.6, 0.2, seed + i, 'teal');
  }
  sh.light(0, 3, 0, 0x9ff6ff, 6, 9);
  sh.roomLights(-6, -6, 6, 6, 0.2, 9, WARM, 4, false);
  for (const a of [0.8, 2.4, 3.9, 5.5]) sh.console(Math.cos(a) * 8.2, Math.sin(a) * 8.2, -a - Math.PI / 2, 0.2, a > 3 ? 'screenAmber' : 'screen');
  m.pickups.push({ pos: sh.p(-6.5, FLOOR + 0.3, 0), kind: 'armor', elevated: true });
  m.perches.push(sh.p(0, FLOOR + 0.2, 6.5));

  // --- lab wing ---
  const wk = k.at(12, 0, 0, 0);
  block(wk, {
    x0: -7,
    z0: -6,
    x1: 7,
    z1: 6,
    floors: 2,
    wall: 'cream',
    ribs: 'orange',
    lining: 'wood',
    open: [
      { n: ops(14, [7], { every: 3.3, glass: 'tint', w: 2.0, h: 2.0, sill: 0.8 }), e: ops(12, [10], { every: 0 }), s: ops(14, [11], { every: 3.3 }), w: ops(12, [], { every: 3.2 }) },
      { n: ops(14, [], { every: 3.3, glass: 'tint', w: 2.2, h: 1.8 }), e: ops(12, [{ u: 5, w: DOOR_W, h: DOOR_H }], { every: 0 }), s: ops(14, [], { every: 3.3 }), w: ops(12, [6], { every: 0 }) },
    ],
    stairs: [
      { x0: -5.4, z0: -4.6, x1: 1.0, z1: -4.6, from: 0, width: 1.5, rails: 'l' },
      { x0: 5.4, z0: 4.6, x1: -1.0, z1: 4.6, from: 1, width: 1.4, rails: 'l' },
    ],
  });
  wk.sign(0, 3.0, 6.3, 4.4, 1.1, 0, 1, 'labelLab');
  // lab benches with screens, racks, specimen case
  wk.table(-3.5, 1.2, 0, 2.6, 1.1, 0.2, 'paintWhite');
  wk.table(1.5, 1.2, 0, 2.6, 1.1, 0.2, 'paintWhite');
  wk.console(-3.5, 2.5, Math.PI, 0.2, 'screen');
  wk.rack(6.3, -2, -Math.PI / 2, 0.2);
  wk.rack(6.3, -0.9, -Math.PI / 2, 0.2);
  wk.box(4, 0.7, 4.4, 1.2, 1.0, 1.2, 'trim', { bevel: 0.05, metal: false });
  wk.box(4, 1.6, 4.4, 1.0, 0.9, 1.0, 'glassTint', { bevel: 0, collide: false });
  P.oreCluster(wk.b, wk.p(4, 1.2, 4.4), 0.3, 61 + seed);
  wk.console(-4.5, 1.0, 0, FLOOR);
  wk.console(-1.5, 1.0, 0, FLOOR, 'screenAmber');
  wk.locker(3, -5.4, 0, 4, FLOOR, 'orange');
  wk.radome(3, -2.5, 2 * FLOOR, 2.1, null);
  m.pickups.push({ pos: wk.p(1, FLOOR + 0.3, -2), kind: 'ammo', elevated: true });
  m.perches.push(wk.p(-3, 2 * FLOOR + 0.2, 3));

  // --- telescope drum with catwalk ring (joins the wing's upper east door) ---
  if (!o.compact) {
  const tk = k.at(23.4, -1, 0, 0);
  tk.cyl(0, FLOOR / 2, 0, 2.6, FLOOR, 'cream', { seg: 24 });
  tk.cyl(0, FLOOR + 0.35, 0, 2.7, 0.7, 'orange', { seg: 24 });
  tk.b.dome(tk.p(0, FLOOR + 0.7, 0), 2.6, 'hullGray', { seg: 24 });
  tk.box(0, FLOOR + 2.2, 0.8, 0.9, 3.2, 2.8, 'dark', { tilt: qAxis(1, 0, 0, 0.5), collide: false, bevel: 0.05 });
  tk.beam([0, FLOOR + 1.4, 0], [0, FLOOR + 4.0, 1.9], 0.75, 'paintWhite', { round: true });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const kk = tk.at(Math.cos(a) * 3.35, Math.sin(a) * 3.35, -a, 0);
    kk.box(0, FLOOR - 0.12, 0, 1.6, 0.24, 2.95, 'grid', { bevel: 0.03 });
    if (i !== 4 && i !== 6) tk.at(Math.cos(a) * 4.1, Math.sin(a) * 4.1, -a, 0).railing(0, -1.3, 0, 1.3, FLOOR, { mat: 'orange' });
  }
  k.stairs(23.4, -11.3, 23.4, -5.2, 0.12, FLOOR, 1.5, { rails: 'both', style: 'open', foot: true });
  tk.light(0, FLOOR + 1, 4.5, WARM, 3, 6);
  m.perches.push(tk.p(0, FLOOR + 0.1, 4));
  } else wk.balcony(7, -1, Math.PI / 2, 4, 2.2, FLOOR, { rail: 'orange' });

  // --- grounds: pad, masts, rover, cover ---
  k.span(o.compact ? -21 : -26, -0.3, -13, o.compact ? 20 : 26, 0.1, 13, 'padDark', { metal: false, bevel: 0.03, seg: 5 });
  for (const z of [-9, 9]) solarMast(k.at(o.compact ? -20 : -24.5, z, 0, 0), 8);
  const rv = k.at(1.5, 9.5, 0.4, 0.1);
  rv.box(0, 1.0, 0, 2.2, 1.0, 3.8, 'orange', { bevel: 0.2, metal: false });
  rv.box(0, 1.8, -0.4, 1.9, 0.7, 2.0, 'hull', { bevel: 0.15, metal: false });
  rv.panel(0, 1.85, 0.62, 1.6, 0.45, 0, 0.3, 1, 'glassBlue');
  for (const sx of [-1, 1]) for (const sz of [-1.2, 1.2]) rv.cylH(sx * 1.2, 0.5, sz, 0.5, 0.4, 'x', 'rubber', { seg: 12, collide: false });
  k.crate(4.5, -10.5, 0.2, 1.2);
  k.crate(5.6, -11.2, 0.7, 0.9);
  k.hesco(-3, -11.5, 2, -11.5, 1.2);
  k.sandbags(18, 10.5, 22, 11.5, 1.0, 0.1);
  k.lampPost(-1, 8.5, 0, 0.1);
  k.lampPost(3, -8.5, 0, 0.1);
  m.keep.push({ x: k.f.x, z: k.f.z, r: 27 });
  m.pickups.push({ pos: k.p(-9, 0.4, 6.3), kind: 'o2', elevated: false });
}

/** stylised hydroponic tree (trunk + faceted canopy) */
function tree(k: Kit, x: number, z: number, y: number, s: number, seed: number): void {
  const rng = new Rng(seed);
  k.cyl(x, y + 0.9 * s, z, 0.14 * s, 1.8 * s, 'wood', { seg: 8, collide: false });
  for (let i = 0; i < 3; i++) {
    const g = new THREE.IcosahedronGeometry(0.9 * s * rng.range(0.8, 1.2), 0);
    k.b.add(i % 2 ? 'plant' : 'plantDark', g, k.p(x + rng.range(-0.4, 0.4) * s, y + (2.0 + i * 0.35) * s, z + rng.range(-0.4, 0.4) * s), qY(rng.next() * 6));
  }
  k.b.world.addCylinder(k.p(x, y + 1.4 * s, z), 0.3 * s, 1.4 * s, new THREE.Quaternion(), false);
}

// ---------------------------------------------------------------------------
// HAB TOWN — civilian block under a glass dome on a drum: plaza with hydroponic garden & trees,
// Pd monument, three 2-storey habs with balconies joined by an elevated ring, drum airlocks with
// pressurised tube corridors to TransHab inflatables outside. Radius ≈ 15 (+ tubes to ~20).

export function habTown(k: Kit, m: Markers, o: { seed?: number; R?: number } = {}): void {
  const seed = o.seed ?? 0;
  const R = o.R ?? 15;
  const drumH = 4.5;
  const doorAz = [37.5, 157.5, 277.5].map((d) => (d * Math.PI) / 180);
  // drum: 24 wall segments with airlock doors
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const isDoor = doorAz.some((d) => Math.abs(((am - d + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.05);
    const len = 2 * R * Math.sin(Math.PI / n) + 0.12;
    const cx = Math.cos(am) * R;
    const cz = Math.sin(am) * R;
    const tx = -Math.sin(am) * (len / 2);
    const tz = Math.cos(am) * (len / 2);
    k.wall(cx - tx, cz - tz, cx + tx, cz + tz, 0, drumH, 0.6, 'cream', isDoor ? [{ u: len / 2, w: 2.6, h: 3.0, accent: 'orange' }] : [{ u: len / 2, w: 2.2, h: 1.4, sill: 1.2, glass: 'warm' }], { cap: 'orange', base: 'trim' });
  }
  k.glassDome(0, 0, drumH, R, { lon: 16, lat: 4, rib: 'cream' });
  // plaza floor (octagon of boxes) — warm stone tiles
  const F = R - 0.5;
  k.box(0, -0.1, 0, F * 2, 0.5, F * 0.8, 'tile', { bevel: 0.03, seg: 2.5 });
  k.box(0, -0.1, 0, F * 0.8, 0.5, F * 2, 'tile', { bevel: 0.03, seg: 2.5 });
  k.box(0, -0.11, 0, F * 1.41, 0.48, F * 1.41, 'tile', { rot: Math.PI / 4, bevel: 0.03, seg: 2.5 });
  // --- three habs (2 storeys) facing the plaza ---
  const habAz = doorAz.map((d) => d + Math.PI / 3);
  habAz.forEach((a, hi) => {
    const r = R * 0.64;
    const rot = Math.atan2(-Math.cos(a), -Math.sin(a)); // local +z → plaza centre
    const hk = k.at(Math.cos(a) * r, Math.sin(a) * r, rot, 0);
    const accent: Mat = hi === 0 ? 'teal' : hi === 1 ? 'orange' : 'brass';
    block(hk, {
      x0: -4.5,
      z0: -3.5,
      x1: 4.5,
      z1: 3.5,
      floors: 2,
      wall: 'cream',
      ribs: accent,
      lining: 'wood',
      light: WARM2,
      open: [
        { n: ops(9, [{ u: 4.5, w: DOOR_W, h: DOOR_H }], { every: 2.6, glass: 'warm', w: 1.4, h: 1.8, sill: 0.6 }), e: ops(7, [], { every: 2.4, glass: 'warm' }), w: ops(7, [], { every: 0 }), s: ops(9, [], { every: 2.6, glass: 'warm' }) },
        { n: ops(9, [{ u: 4.5, w: DOOR_W, h: DOOR_H }], { every: 2.6, glass: 'warm', w: 1.3, h: 1.4 }), e: ops(7, [], { every: 2.4, glass: 'warm' }), w: ops(7, [], { every: 2.4, glass: 'warm' }), s: ops(9, [], { every: 2.6, glass: 'warm' }) },
      ],
      stairs: [{ x0: -3.6, z0: -2.3, x1: 2.6, z1: -2.3, from: 0, width: 1.3, rails: 'l' }],
      lightI: 5,
    });
    // balcony reaching the central ring
    hk.span(-2.2, FLOOR - 0.3, 3.5, 2.2, FLOOR, r - 3.6, 'wood', { bevel: 0.04 });
    hk.railing(-2.15, 3.6, -2.15, r - 3.7, FLOOR, { glass: true, mat: 'brass' });
    hk.railing(2.15, 3.6, 2.15, r - 3.7, FLOOR, { glass: true, mat: 'brass' });
    hk.light(0, FLOOR - 0.6, 4.2, WARM, 2.5, 5, { dir: [0, -1, 0], cone: 0.1 });
    // awning + shop sign + interior life
    hk.box(0, DOOR_H + 0.55, 3.85, 6.4, 0.12, 0.9, accent, { collide: false, bevel: 0.04, tilt: qAxis(1, 0, 0, 0.18) });
    hk.table(2.4, 0.2, 0, 1.8, 0.8, 0.2);
    hk.sofa(2.6, 2.2, Math.PI, 2.0, 0.2, accent);
    hk.bunk(-2.6, 2.4, 0, FLOOR);
    hk.planter(3.4, 0.6, Math.PI / 2, 1.2, FLOOR, seed + hi, 'cream');
    m.perches.push(hk.p(0, 2 * FLOOR + 0.2, -1));
    m.pickups.push({ pos: hk.p(0.5, FLOOR + 0.3, 1.8), kind: hi === 0 ? 'armor' : hi === 1 ? 'ammo' : 'grenade', elevated: true });
    m.spawns.push({ pos: hk.p(1, 0.5, 0.5), yaw: k.f.rot + Math.atan2(Math.cos(a), Math.sin(a)) });
  });
  // --- central elevated ring (joins the balconies) + monument ---
  ringBalcony(k, 1.9, 3.8, FLOOR, [], 'wood', 'brass');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.column(Math.cos(a) * 2.85, Math.sin(a) * 2.85, 0.2, FLOOR - 0.36, 0.45, 'cream', { cap: 'brass' });
  }
  // radial stair from the plaza up to the ring (between a hab and an airlock)
  const sa = habAz[0] + 0.83;
  k.stairs(Math.cos(sa) * 10.1, Math.sin(sa) * 10.1, Math.cos(sa) * 3.75, Math.sin(sa) * 3.75, 0.15, FLOOR, 1.5, { rails: 'both', style: 'open' });
  const ob = k.at(0, 0, Math.PI / 4, 0);
  ob.box(0, 0.6, 0, 2.6, 1.2, 2.6, 'brass', { bevel: 0.15, metal: false });
  ob.box(0, 5.5, 0, 1.2, 9.2, 1.2, 'cream', { bevel: 0.2 });
  ob.box(0, 10.3, 0, 1.5, 0.4, 1.5, 'brass', { bevel: 0.1, collide: false });
  P.oreCluster(k.b, k.p(0, 10.5, 0), 0.9, 71 + seed);
  ob.panel(0, 2.2, 0.61, 1.0, 1.0, 0, 0, 1, 'pd');
  k.light(0, 12, 0, 0x9ff6ff, 5, 10);
  // garden: trees + planters around the plaza, lamps
  for (let i = 0; i < 6; i++) {
    const a = habAz[i % 3] + (i < 3 ? 0.6 : -0.6);
    tree(k, Math.cos(a) * 12, Math.sin(a) * 12, 0.15, 1.1, seed + 10 + i);
    const ap = doorAz[i % 3] + (i < 3 ? -0.45 : 0.45);
    k.planter(Math.cos(ap) * 5.4, Math.sin(ap) * 5.4, -ap + Math.PI / 2, 2.0, 0.15, seed + 20 + i, 'teal');
  }
  for (let i = 0; i < 3; i++) {
    const a = doorAz[i];
    k.lampPost(Math.cos(a) * (R - 3.5), Math.sin(a) * (R - 3.5), a + Math.PI, 0.15, 3.6, WARM2);
    k.sofa(Math.cos(a + 0.35) * (R - 4.5), Math.sin(a + 0.35) * (R - 4.5), -a - Math.PI / 2, 2.0, 0.15, 'orange');
  }
  k.roomLights(-6, -6, 6, 6, 0.15, drumH + 6, WARM, 3.5, false);
  // --- airlock tubes → outside, TransHab inflatables ---
  for (let i = 0; i < 3; i++) {
    const a = doorAz[i];
    const x0 = Math.cos(a) * (R + 0.35);
    const z0 = Math.sin(a) * (R + 0.35);
    const x1 = Math.cos(a) * (R + 4.3);
    const z1 = Math.sin(a) * (R + 4.3);
    k.tube(x0, z0, x1, z1, 0.15, { shell: 'cream' });
    k.at(x1, z1, -a + Math.PI / 2).sign(0, 3.4, 0.2, 2.4, 0.6, 0, 1, i === 0 ? 'labelHab' : 'hazard');
  }
  for (const a of [habAz[0] + 0.05, habAz[2] - 0.05]) k.inflatable(Math.cos(a) * (R + 3.4), Math.sin(a) * (R + 3.4), 2.7, 4.2, 0, null);
  // spawns / markers
  m.spawns.push({ pos: k.p(4.5, 0.5, 4.5), yaw: 0 }, { pos: k.p(-5, 0.5, -3), yaw: 2 });
  m.perches.push(k.p(0, FLOOR + 0.2, 3));
  m.pickups.push({ pos: k.p(-4.5, 0.4, 4.5), kind: 'o2', elevated: false });
  m.keep.push({ x: k.f.x, z: k.f.z, r: R + 6 });
}

// ---------------------------------------------------------------------------
// RELAY — comm relay on high ground: equipment shed (roof reachable), lattice tower, radome on a
// plinth, Hesco + sandbag nest. Footprint x -11..11, z -7..7 (local +z = front).

export function relay(k: Kit, m: Markers, o: { team?: number | null; seed?: number } = {}): void {
  const team = o.team ?? null;
  k.span(-11, -0.3, -7, 11, 0.1, 7, 'padDark', { metal: false, bevel: 0.03, seg: 4 });
  const sk = k.at(0.5, -1.5, 0, 0);
  block(sk, {
    x0: -3.6,
    z0: -2.6,
    x1: 3.6,
    z1: 2.6,
    floors: 1,
    wall: 'hullGray',
    ribs: 'orange',
    lining: 'darkPanel',
    floorMat: 'grid',
    open: [{ n: ops(7.2, [2.2], { every: 2.4, glass: 'warm' }), e: ops(5.2, [], { every: 2.4, glass: 'warm' }), w: ops(5.2, [], { every: 2.4, glass: 'none', sill: 1.1, h: 1.0 }), s: ops(7.2, [5.2], { every: 0 }) }],
    light: WARM2,
    parapet: 0.45,
  });
  sk.rack(-2.9, -1.4, Math.PI / 2, 0.2);
  sk.rack(-2.9, -0.3, Math.PI / 2, 0.2);
  sk.console(1.8, -1.9, 0, 0.2);
  k.stairs(-5.3, 4.0, -5.3, -2.2, 0.1, FLOOR, 1.4, { rails: 'l', style: 'open', foot: true });
  k.span(-6.0, FLOOR - 0.3, -4.3, -2.9, FLOOR, -2.2, 'grid', { bevel: 0.03 });
  k.railing(-5.95, -4.25, -2.95, -4.25, FLOOR);
  k.radome(7.0, -3.2, 0.1, 2.3, team);
  P.commTower(k.b, k.at(-8.2, 3.6).f, 10, team);
  m.perches.push(k.p(-8.2, 10.5, 3.6), sk.p(0.5, FLOOR + 0.2, 0));
  // front sandbag nest + hesco line
  k.sandbags(-3, 5.6, 3, 5.6, 1.0, 0.1);
  k.sandbags(3.4, 5.2, 5, 3.9, 1.0, 0.1);
  k.hesco(7, 2, 10, 2, 1.3);
  k.pipe([[3.2, 0.25, 0.6], [5.6, 0.25, 0.6], [5.6, 0.25, -3.2]], 0.12, 'brass');
  k.crate(8.5, 5.4, 0.3, 1.1);
  k.lampPost(3, 3.5, 0, 0.1, 4, team === null ? WARM : teamLight(team));
  solarMast(k.at(-9.8, -5, 0, 0), 6);
  m.pickups.push({ pos: k.p(0, 0.3, 3.4), kind: 'ammo', elevated: false });
  m.keep.push({ x: k.f.x, z: k.f.z, r: 13 });
  void o.seed;
}

// ---------------------------------------------------------------------------
// DEPOT — supply depot: warehouse with open bays and a roof walk, container stacks, Hesco walls,
// fuel bladders. Footprint x -11..11, z -9..9.

export function depot(k: Kit, m: Markers, o: { seed?: number } = {}): void {
  const seed = o.seed ?? 0;
  k.span(-11, -0.3, -9, 11, 0.1, 9, 'padDark', { metal: false, bevel: 0.03, seg: 4 });
  const wk = k.at(-2, -2.5, 0, 0);
  block(wk, {
    x0: -6.5,
    z0: -4,
    x1: 6.5,
    z1: 4,
    floors: 1,
    fh: 4.5,
    parapet: 0.45,
    wall: 'hullGray',
    ribs: 'yellow',
    lining: null,
    floorMat: 'grid',
    ceil: 'darkPanel',
    open: [{ n: ops(13, [{ u: 3.5, w: 3.4, h: 3.6 }, { u: 9.5, w: 3.4, h: 3.6 }], { every: 0 }), e: ops(8, [4], { every: 0 }), w: ops(8, [], { every: 2.6, glass: 'warm', sill: 2.4, h: 1.2 }), s: ops(13, [], { every: 3.2, glass: 'warm', sill: 2.6, h: 1.2 }) }],
    light: WARM2,
    lightI: 7,
  });
  wk.sign(0, 3.9, 4.25, 4, 0.9, 0, 1, 'labelDepot');
  for (let i = 0; i < 4; i++) wk.rack(-5.6 + i * 0.95, -3.3, 0, 0.2);
  wk.crate(3.5, -2.5, 0.2, 1.3, 0.2, 'containerGreen');
  wk.crate(4.9, -2.7, 0.5, 1.1, 0.2);
  wk.crate(3.9, -2.4, 0.4, 0.9, 1.5);
  wk.barrels(0, 0.3, 3, 0.2, 'orange');
  // roof walk (exterior stair on the east gable)
  k.stairs(-6, -7.6, 1.0, -7.6, 0.1, 4.5, 1.4, { rails: 'r', style: 'open', foot: true });
  k.span(1.0, 4.2, -8.4, 2.9, 4.5, -6.3, 'grid', { bevel: 0.03 });
  m.perches.push(wk.p(0, 4.7, -1));
  // container stacks + hesco walls + fuel bladders
  P.containers(k.b, k.at(-7.5, 5.8, Math.PI / 2).f, [[0, 0, 0, 0], [0, 2.6, 0, 0.05], [0, 1.3, 1, 0]], 101 + seed);
  P.containers(k.b, k.at(8.5, 5.5, 0.1).f, [[0, 0, 0, 0]], 102 + seed);
  k.hesco(-10.5, -8.5, -10.5, 0, 1.4);
  k.hesco(2, 8.5, 6, 8.5, 1.3);
  for (const [x, z] of [
    [9, -6.5],
    [9, -3.5],
  ] as const) {
    k.b.sphere(k.p(x, 0.6, z), 1.5, 'rubber', { collide: false, seg: 14 });
    k.b.world.addBox(k.p(x, 0.5, z), V(1.4, 0.5, 1.2), k.q(), false);
  }
  k.lampPost(1.5, 6, 0, 0.1);
  m.pickups.push({ pos: k.p(1, 0.3, 4), kind: 'ammo', elevated: false }, { pos: wk.p(0, 0.5, -1), kind: 'o2', elevated: false });
  m.keep.push({ x: k.f.x, z: k.f.z, r: 14 });
}

// ---------------------------------------------------------------------------
// POWER STATION — fission surface power unit (cone + edge-on radiators) inside a regolith berm ring,
// sun-tracking vertical solar mast field, control hut with roof access. Footprint ~34 × 34.

export function powerStation(k: Kit, m: Markers, o: { seed?: number } = {}): void {
  // reactor behind berms (gaps for access)
  const rk = k.at(4, 4, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 - 0.19;
    const a1 = a0 + Math.PI / 3 - 0.45;
    rk.berm(Math.cos(a0) * 9, Math.sin(a0) * 9, Math.cos(a1) * 9, Math.sin(a1) * 9, 2.6, 1.0, 6.2);
  }
  rk.cyl(0, 0.5, 0, 3.2, 1.0, 'concrete', { seg: 20, metal: false });
  rk.cyl(0, 3.2, 0, 1.8, 4.4, 'hullGray', { seg: 20 });
  const cone = new THREE.CylinderGeometry(0.5, 1.8, 3, 20, 1);
  rk.b.add('hull', cone, rk.p(0, 6.9, 0), rk.q());
  rk.b.world.addCylinder(rk.p(0, 6.9, 0), 1.8, 1.5, rk.q(), true);
  rk.cyl(0, 2.2, 0, 1.85, 0.3, 'yellow', { seg: 20, collide: false });
  rk.cyl(0, 5.2, 0, 1.85, 0.25, 'screenAmber', { seg: 20, collide: false, bevel: 0 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const kk = rk.at(Math.cos(a) * 4.2, Math.sin(a) * 4.2, -a, 0);
    kk.box(0, 4.2, 0, 4.2, 6.4, 0.18, 'containerWhite', { bevel: 0.03 });
    kk.box(-2.2, 4.2, 0, 0.2, 6.6, 0.3, 'trim', { collide: false, bevel: 0.03 });
    kk.pipe([[-2.2, 1.2, 0], [-3.0, 1.2, 0]], 0.12, 'brass');
  }
  rk.light(0, 3, 0, 0xffb060, 5, 10);
  rk.sign(0, 1.6, 3.35, 1.8, 0.6, 0, 1, 'hazard');
  // solar mast field
  for (let i = 0; i < 6; i++) solarMast(k.at(-12 + (i % 3) * 4.2, -12 + Math.floor(i / 3) * 5.5, 0, 0), 9 + (i % 2));
  // control hut
  const hk = k.at(-12, 11, 0, 0);
  block(hk, {
    x0: -3.5,
    z0: -3,
    x1: 3.5,
    z1: 3,
    floors: 1,
    wall: 'cream',
    ribs: 'yellow',
    open: [{ e: ops(6, [3], { every: 0 }), s: ops(7, [3.5], { every: 0 }), n: ops(7, [], { every: 2.3, glass: 'warm' }), w: ops(6, [], { every: 2.4, glass: 'warm' }) }],
    parapet: 0.45,
  });
  hk.console(-1.5, 2.3, Math.PI, 0.2);
  hk.console(1.4, 2.3, Math.PI, 0.2, 'screenAmber');
  k.stairs(-17, 5.8, -17, 12.4, 0.1, FLOOR, 1.4, { rails: 'l', style: 'open', foot: true });
  k.span(-17.7, FLOOR - 0.3, 12.4, -15.3, FLOOR, 14.2, 'grid', { bevel: 0.03 });
  k.pipe([[-8.4, 0.3, 12.5], [-4, 0.3, 12.5], [-4, 0.3, 4], [0.5, 0.3, 4]], 0.15, 'brass');
  k.lampPost(-6, 3.5, 0, 0);
  k.crate(12, -10, 0.3, 1.2);
  k.hesco(9, -13, 14, -13, 1.3);
  m.perches.push(hk.p(0, FLOOR + 0.2, 0));
  m.pickups.push({ pos: k.p(-6, 0.3, -2), kind: 'grenade', elevated: false });
  m.keep.push({ x: k.f.x, z: k.f.z, r: 20 });
  void o.seed;
}

// ---------------------------------------------------------------------------
/** Small cover cluster for open ground (crates, container, hesco, jersey, barrels, lamp, generator). */
export function coverCluster(k: Kit, seed: number, o: { lamp?: boolean } = {}): void {
  const rng = new Rng(seed * 7919 + 17);
  const kind = seed % 4;
  if (kind === 0) {
    P.containers(k.b, k.at(0, 0, rng.range(-0.3, 0.3)).f, [[0, 0, 0, 0], [0, 2.5, 0, 0.08]], seed);
    k.crate(2.4, 3.6, 0.3, 1.2);
    k.crate(3.2, 2.6, 0.8, 0.9);
  } else if (kind === 1) {
    k.hesco(-3, 0, 3, 0, 1.3);
    k.sandbags(-3.4, 1.6, -1.2, 3.2, 1.0);
    k.barrels(2.2, 1.8, 3, 0, 'orange');
  } else if (kind === 2) {
    k.jersey(0, 0, 0.2, 3.2);
    k.jersey(1.2, 2.4, -0.4, 3.2);
    const g = k.at(-2.6, 1.2, 0.3, 0);
    g.box(0, 0.7, 0, 2.2, 1.4, 1.3, 'yellow', { bevel: 0.12, metal: false });
    g.box(0, 1.5, 0, 1.6, 0.2, 1.0, 'dark', { collide: false, bevel: 0.03 });
    g.cyl(0.6, 1.8, 0, 0.18, 0.6, 'steel', { collide: false, seg: 8 });
    g.box(-1.12, 0.8, 0, 0.04, 0.6, 0.8, 'vent', { collide: false, bevel: 0 });
  } else {
    P.containers(k.b, k.at(0, 0, 1.2 + rng.range(-0.2, 0.2)).f, [[0, 0, 0, 0]], seed);
    k.hesco(2, -3.5, 5, -3.5, 1.3);
    k.crate(-2.6, 2.8, 0.5, 1.3);
  }
  if (o.lamp !== false) k.lampPost(rng.range(-3, 3), -3.2, rng.range(0, 6), 0, 4.2);
}

/** Mining haul truck (cover in the pit): chunky yellow dump body, cab, big wheels. */
export function haulTruck(k: Kit, x: number, z: number, rot: number, y = 0, load = true): void {
  const t = k.at(x, z, rot, y);
  t.box(0, 1.5, 0, 3.0, 1.0, 6.2, 'darkPanel', { bevel: 0.12, metal: false });
  t.box(0, 2.6, -0.8, 3.2, 1.4, 4.4, 'yellow', { bevel: 0.18, metal: false, tilt: qAxis(1, 0, 0, -0.06) });
  if (load) t.box(0, 3.35, -0.8, 2.6, 0.5, 3.8, 'oreRock', { collide: false, bevel: 0.25 });
  t.box(0.5, 2.7, 2.3, 1.8, 1.4, 1.4, 'hull', { bevel: 0.12, metal: false });
  t.panel(0.5, 2.95, 3.01, 1.5, 0.6, 0, 0, 1, 'glassBlue');
  t.box(0, 3.5, 2.3, 3.2, 0.12, 1.8, 'yellow', { collide: false, bevel: 0.04 });
  for (const sx of [-1.55, 1.55]) for (const sz of [-2.1, 2.1]) t.cylH(sx, 0.95, sz, 0.95, 0.7, 'x', 'rubber', { seg: 14, collide: false });
  t.box(0.5, 3.1, 3.02, 0.3, 0.2, 0.05, 'lamp', { collide: false, bevel: 0 });
  t.light(0.5, 2.2, 4.5, WARM, 3, 7, { dir: [0, -0.3, 1], cone: 0.3 });
}
