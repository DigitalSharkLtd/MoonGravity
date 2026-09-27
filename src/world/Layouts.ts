import * as THREE from 'three';
import { StructureBuilder, Frame } from './Builder';
import * as P from './Prefabs';
import { MapDef } from './MapDefs';
import { TerrainData } from './TerrainGen';
import { Kit, frameAt } from './Kit';
import * as C from './Complexes';

export interface SpawnPoint {
  pos: THREE.Vector3;
  yaw: number;
  team: number; // -1 = FFA
}
export interface ControlPoint {
  id: 'A' | 'B' | 'C';
  pos: THREE.Vector3;
  radius: number;
}
export type PickupKind = 'o2' | 'ammo' | 'armor' | 'grenade';
export interface PickupSpot {
  pos: THREE.Vector3;
  kind: PickupKind;
  /** on an upper floor / roof: pos.y is authoritative (not snapped to the terrain) */
  elevated?: boolean;
}
/** Sniper spot (a plain Vector3; `elevated` marks roofs / upper floors / towers, y is explicit). */
export type PerchSpot = THREE.Vector3 & { elevated?: boolean };
export interface LayoutInfo {
  spawns: SpawnPoint[];
  controlPoints: ControlPoint[];
  pickups: PickupSpot[];
  podZones: THREE.Vector3[];
  perches: PerchSpot[];
  baseCenters: THREE.Vector3[];
  /** circles that props should avoid */
  keepOut: { x: number; z: number; r: number }[];
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** yaw such that the body faces from (x,z) toward (tx,tz) */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - x), -(tz - z));
}

function F(b: StructureBuilder, x: number, z: number, rot = 0): Frame {
  return { x, y: b.ground(x, z), z, rot };
}

/** Dev hook (world preview): replaces the map's structures with a custom builder. */
export const devLayout: { fn?: (b: StructureBuilder, def: MapDef, info: LayoutInfo, top: number, floorY: number) => void } = {};

export function buildLayout(b: StructureBuilder, def: MapDef, td: TerrainData): LayoutInfo {
  const info: LayoutInfo = { spawns: [], controlPoints: [], pickups: [], podZones: [], perches: [], baseCenters: [], keepOut: [] };
  if (devLayout.fn) {
    devLayout.fn(b, def, info, td.mineTop, td.mineTop - def.mine.depth);
    return info;
  }
  const mineTop = td.mineTop;
  const m = def.mine;
  const floorY = mineTop - m.depth;
  info.keepOut.push({ x: m.x, z: m.z, r: m.floorR + 8 });
  if (def.id === 'duel') buildDuel(b, def, info, mineTop, floorY);
  else if (def.id === 'quarry') buildQuarry(b, def, info, mineTop, floorY);
  else buildFront(b, def, info, mineTop, floorY);
  // spawns: keep explicit heights (interiors); only snap spawns that are below the terrain
  for (const s of info.spawns) s.pos.y = Math.max(s.pos.y, b.ground(s.pos.x, s.pos.z) + 0.3);
  // final pass: move markers out of props placed later (cover clusters, rooftop clutter)
  for (const s of info.spawns) s.pos.copy(nudgeFree(b, s.pos));
  for (const p of info.pickups) {
    if (!p.elevated) p.pos.y = b.ground(p.pos.x, p.pos.z);
    p.pos.copy(nudgeFree(b, p.pos));
  }
  for (const p of info.perches) {
    p.copy(nudgeFree(b, p));
    if (p.y - b.ground(p.x, p.z) > 1.5) p.elevated = true;
  }
  return info;
}

function addSpawn(b: StructureBuilder, info: LayoutInfo, x: number, z: number, team: number, tx = 0, tz = 0): void {
  info.spawns.push({ pos: V(x, b.ground(x, z), z), yaw: yawToward(x, z, tx, tz), team });
}

/**
 * Move a marker to the nearest free spot (no overlap with colliders at body height, with a floor
 * under it) within ~2.4 m; returns the original if nothing better is found.
 */
const _dn = new THREE.Vector3(0, -1, 0);
function nudgeFree(b: StructureBuilder, p: THREE.Vector3): THREE.Vector3 {
  const offs: [number, number][] = [[0, 0]];
  for (const r of [0.8, 1.6, 2.4]) for (let i = 0; i < 8; i++) offs.push([Math.cos((i / 8) * Math.PI * 2) * r, Math.sin((i / 8) * Math.PI * 2) * r]);
  for (const [dx, dz] of offs) {
    const q = new THREE.Vector3(p.x + dx, p.y, p.z + dz);
    if (b.world.pointBlocked(q.clone().setY(q.y + 0.9), 0.4)) continue;
    const hit = b.world.raycast(q.clone().setY(q.y + 0.4), _dn, 1.4, { forMove: true });
    const gy = b.ground(q.x, q.z);
    if (!hit && q.y - gy > 1.0) continue; // would float
    return q;
  }
  return p;
}

function pushMarkers(info: LayoutInfo, m: C.Markers, team: number | null, o: { spawns?: boolean; cp?: 'A' | 'B' | 'C'; cpR?: number; pickups?: boolean; b?: StructureBuilder } = {}): void {
  const fix = (p: THREE.Vector3) => (o.b ? nudgeFree(o.b, p) : p.clone());
  if (o.pickups !== false) for (const p of m.pickups) info.pickups.push({ pos: fix(p.pos), kind: p.kind, elevated: p.elevated || undefined });
  for (const p of m.perches) info.perches.push(fix(p));
  for (const k of m.keep) info.keepOut.push(k);
  if (o.spawns) for (const sp of m.spawns) info.spawns.push({ pos: fix(sp.pos), yaw: sp.yaw, team: team ?? -1 });
  if (o.cp && m.cp) info.controlPoints.push({ id: o.cp, pos: m.cp.clone(), radius: o.cpR ?? 8 });
}

/**
 * Greedy FFA spawn selection: keeps existing (interior) spawns, then adds ground candidates on the
 * outer ring that see the fewest already-chosen spawns (eye-to-eye raycasts), spaced ≥ 11 m apart.
 */
function pickSpawns(b: StructureBuilder, info: LayoutInfo, def: MapDef, total: number, rMin: number): void {
  const eye = new THREE.Vector3(0, 1.6, 0);
  const chosen = info.spawns.filter((s) => s.team === -1);
  // drop interior spawns that see each other
  for (let i = chosen.length - 1; i >= 0; i--)
    for (let j = 0; j < i; j++)
      if (b.world.visible(chosen[i].pos.clone().add(eye), chosen[j].pos.clone().add(eye))) {
        info.spawns.splice(info.spawns.indexOf(chosen[i]), 1);
        chosen.splice(i, 1);
        break;
      }
  const cands: THREE.Vector3[] = [];
  const hx = def.halfX - 4;
  const hz = def.halfZ - 4;
  const up06 = new THREE.Vector3(0, 0.6, 0);
  const up14 = new THREE.Vector3(0, 1.4, 0);
  for (let x = -hx; x <= hx; x += 4.5)
    for (let z = -hz; z <= hz; z += 4.5) {
      if (Math.hypot(x, z) < rMin) continue;
      const p = new THREE.Vector3(x, b.ground(x, z) + 0.3, z);
      if (b.world.pointBlocked(p.clone().add(up06), 0.5) || b.world.pointBlocked(p.clone().add(up14), 0.5)) continue;
      cands.push(p);
    }
  // incremental scores: visibility count and nearest-spawn distance per candidate
  const vis = new Int32Array(cands.length);
  const near = new Float32Array(cands.length).fill(Infinity);
  const alive = new Uint8Array(cands.length).fill(1);
  const ce = cands.map((c) => c.clone().add(eye));
  const account = (sp: THREE.Vector3) => {
    const se = sp.clone().add(eye);
    for (let i = 0; i < cands.length; i++) {
      if (!alive[i]) continue;
      const d = Math.hypot(cands[i].x - sp.x, cands[i].z - sp.z);
      near[i] = Math.min(near[i], d);
      if (d < 11) continue;
      if (b.world.visible(ce[i], se)) vis[i]++;
    }
  };
  for (const sp of chosen) account(sp.pos);
  while (chosen.length < total) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < cands.length; i++) {
      if (!alive[i] || near[i] < 11) continue;
      const score = vis[i] * 100 - Math.min(near[i], 40);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    alive[best] = 0;
    const c = cands[best];
    const sp = { pos: c, yaw: yawToward(c.x, c.z, 0, 0), team: -1 };
    info.spawns.push(sp);
    chosen.push(sp);
    account(c);
  }
}

/** Kit at the terrain under (x, z) facing `rot`. */
function K(b: StructureBuilder, x: number, z: number, rot = 0): Kit {
  return new Kit(b, frameAt(b, x, z, rot));
}

/** Mine dressing shared by all maps: drill rig, ore, rim lights. */
function mineCore(b: StructureBuilder, def: MapDef, info: LayoutInfo, top: number, floorY: number, rigRot: number, cpR: number): void {
  P.drillRig(b, F(b, def.mine.x, def.mine.z, rigRot));
  info.controlPoints.push({ id: 'B', pos: V(def.mine.x, floorY, def.mine.z), radius: cpR });
  const r = def.mine.r;
  const n = Math.max(6, Math.round(r / 4.5));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const k = K(b, Math.cos(a) * (r + 3), Math.sin(a) * (r + 3), -a);
    k.lampPost(0, 0, Math.PI, 0, 4.5, 0xffc98a);
  }
  info.podZones.push(V(def.mine.x, 0, def.mine.z));
}

// ---------------------------------------------------------------------------
// 2v2 — "Шахта-7": two outposts facing each other over a compact open-pit mine; three lanes
// (north relay, the mine with two bridges, south relay).
function buildDuel(b: StructureBuilder, def: MapDef, info: LayoutInfo, top: number, floorY: number): void {
  mineCore(b, def, info, top, floorY, Math.PI / 4, 7);
  for (const x of [-10, 10]) {
    P.bridge(b, x, -24, x, 24, top + 0.6);
    P.pylon(b, x, x < 0 ? -9 : 9, top - 1.9);
  }
  info.perches.push(V(-10, top + 0.7, 0), V(10, top + 0.7, 0));
  P.oreCluster(b, V(5, 0, -5), 1.1, 31);
  P.oreCluster(b, V(-5, 0, 5), 1.1, 32);
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1;
    const m = C.markers();
    C.outpost(K(b, s * 41, 0, team === 0 ? 0 : Math.PI), team, m);
    pushMarkers(info, m, team, { b,  spawns: true });
    info.baseCenters.push(V(s * 41, b.ground(s * 41, 0), 0));
  }
  // lanes: relays (point-symmetric)
  for (const s of [-1, 1]) {
    const m = C.markers();
    C.relay(K(b, 0, s * 31, s > 0 ? Math.PI : 0), m, { seed: s > 0 ? 1 : 2 });
    pushMarkers(info, m, null, { b });
  }
  // rim cover between lanes
  const kk = K(b, 0, 0);
  for (const s of [-1, 1]) {
    P.containers(b, F(b, s * 24, s * -17, 0.5 * s), [[0, 0, 0, 0], [2.6, 0, 0, 0]], 11 + s);
    kk.hesco(s * 26, s * 12, s * 26, s * 6, 1.3);
    kk.sandbags(s * 20, s * 23, s * 16, s * 25.5, 1.0);
    kk.crate(s * 30, s * -25, 0.3, 1.2);
  }
  for (const s of [-1, 1]) {
    C.coverCluster(K(b, s * 21, s * 27, s > 0 ? 0 : Math.PI), 2);
    C.coverCluster(K(b, s * -19, s * 29, s > 0 ? 0.4 : Math.PI + 0.4), 1, { lamp: false });
    info.keepOut.push({ x: s * 21, z: s * 27, r: 6 }, { x: -s * 19, z: s * 29, r: 6 });
  }
  info.pickups.push({ pos: V(0, 0, 9), kind: 'ammo' }, { pos: V(-28, 0, 22), kind: 'grenade' }, { pos: V(28, 0, -22), kind: 'grenade' });
  info.podZones.push(V(0, 0, 22), V(0, 0, -22));
  info.keepOut.push({ x: -10, z: 0, r: 3 }, { x: 10, z: 0, r: 3 });
}

// ---------------------------------------------------------------------------
// FFA — "Палладиевый карьер": the terraced pit with crossing bridges, ringed by complexes:
// N processing plant, NE spaceport, E relay (high ground), SE lab, S silos, SW hab dome,
// W depot, NW power station. Spawns spread inside/behind every complex.
function buildQuarry(b: StructureBuilder, def: MapDef, info: LayoutInfo, top: number, floorY: number): void {
  mineCore(b, def, info, top, floorY, 0.4, 10);
  P.bridge(b, -14, -45, -14, 45, top + 0.8);
  P.bridge(b, -45, 18, 45, 18, top + 0.8);
  for (const z of [-26, 30]) P.pylon(b, -14, z, top - 2.1);
  for (const x of [-30, 22]) P.pylon(b, x, 18, top - 2.1);
  info.perches.push(V(-14, top + 0.9, 18), V(-14, top + 0.9, -20), V(20, top + 0.9, 18));
  P.oreCluster(b, V(7, 0, -7), 1.3, 33);
  P.oreCluster(b, V(-9, 0, 5), 1.2, 34);
  // pit life & cover: haul trucks on the floor and a bench, ore piles
  const pk = new Kit(b, { x: 0, y: floorY, z: 0, rot: 0 });
  C.haulTruck(pk, 9.5, 4, 0.7, 0);
  C.haulTruck(pk, -6, -9.5, 2.3, 0, false);
  const bench = K(b, -24, -18, 0.9);
  C.haulTruck(bench, 0, 0, 0, 0);
  for (const [x, z, sd] of [[-9, -2, 35], [4, 10, 36]] as const) P.oreCluster(b, V(x, 0, z), 0.9, sd);
  const add = (m: C.Markers, spawns = true) => pushMarkers(info, m, null, { b,  spawns });
  let m = C.markers();
  C.processingPlant(K(b, 0, 60, Math.PI / 2), m, { conveyorTo: V(-6, floorY + 1.4, 9), seed: 3 });
  m.spawns.push({ pos: new Kit(b, frameAt(b, 0, 60, Math.PI / 2)).p(-8, 0.5, -12), yaw: 0 });
  add(m);
  m = C.markers();
  C.spaceport(K(b, 53, 53, Math.PI / 4).at(-4, 0), m, { compact: true, seed: 4 });
  add(m);
  m = C.markers();
  C.relay(K(b, 62, 0, -Math.PI / 2), m, { seed: 5 });
  add(m);
  m = C.markers();
  C.lab(K(b, 53, -53, 0), m, { seed: 6, compact: true });
  add(m);
  m = C.markers();
  C.siloComplex(K(b, 0, -61, -Math.PI / 2), m, { seed: 7 });
  add(m);
  m = C.markers();
  C.habTown(K(b, -53, -53, 0), m, { seed: 8 });
  add(m);
  m = C.markers();
  C.depot(K(b, -62, 0, Math.PI / 2), m, { seed: 9 });
  add(m);
  m = C.markers();
  C.powerStation(K(b, -53, 53, 0), m, { seed: 10 });
  add(m);
  // FFA spawns: complex interiors first, then a greedy LOS-aware pick over the outer ring
  pickSpawns(b, info, def, 20, 44);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 49;
    const z = Math.sin(a) * 49;
    C.coverCluster(K(b, x, z, -a + Math.PI / 2), 20 + i);
    info.keepOut.push({ x, z, r: 6 });
  }
  info.pickups.push({ pos: V(0, 0, 13), kind: 'ammo' }, { pos: V(-38, 0, 38), kind: 'grenade' }, { pos: V(40, 0, -32), kind: 'armor' });
  info.podZones.push(V(0, 0, 25), V(25, 0, -15), V(-30, 0, 30), V(35, 0, 35), V(-35, 0, -30));
  info.keepOut.push({ x: -14, z: 0, r: 3 }, { x: 0, z: 18, r: 3 });
}

// ---------------------------------------------------------------------------
// 4v4 — "Фронт Тихо": two star-forts, A processing plant, B drill rig in the mine, C silo complex,
// spaceport flank (north) and science-lab flank (south), relays / depots between.
function buildFront(b: StructureBuilder, def: MapDef, info: LayoutInfo, top: number, floorY: number): void {
  mineCore(b, def, info, top, floorY, Math.PI / 4, 9);
  for (const x of [-13, 13]) {
    P.bridge(b, x, -34, x, 34, top + 0.8);
    P.pylon(b, x, -16, top - 2.1);
    P.pylon(b, x, 16, top - 2.1);
  }
  info.perches.push(V(-13, top + 0.9, 0), V(13, top + 0.9, 0));
  P.oreCluster(b, V(6, 0, 6.5), 1.3, 41);
  P.oreCluster(b, V(-6.5, 0, -6), 1.2, 42);
  // --- A / C ---
  const mA = C.markers();
  C.processingPlant(K(b, -46, 0, 0), mA, { conveyorTo: V(-6, floorY + 1.4, 7), seed: 1 });
  pushMarkers(info, mA, null, { b,  cp: 'A' });
  const mC = C.markers();
  C.siloComplex(K(b, 46, 0, Math.PI), mC, { seed: 2 });
  pushMarkers(info, mC, null, { b,  cp: 'C' });
  P.conveyor(b, 6, floorY + 1.4, -7, 37, top + 5.5, 4);
  // --- flanks ---
  const mS = C.markers();
  C.spaceport(K(b, 0, 53, 0), mS, { seed: 3 });
  pushMarkers(info, mS, null, { b });
  const mL = C.markers();
  C.lab(K(b, 0, -53, 0), mL, { seed: 4 });
  pushMarkers(info, mL, null, { b });
  for (const s of [-1, 1]) {
    const mr = C.markers();
    C.relay(K(b, s * 62, s * 52, s < 0 ? Math.PI * 0.75 : -Math.PI * 0.25), mr, { seed: 5 + s });
    pushMarkers(info, mr, null, { b });
    const md = C.markers();
    C.depot(K(b, s * 62, -s * 52, s < 0 ? Math.PI * 0.25 : -Math.PI * 0.75), md, { seed: 7 + s });
    pushMarkers(info, md, null, { b });
  }
  // --- bases ---
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1;
    const m = C.markers();
    C.fortress(K(b, s * 88, 0, team === 0 ? 0 : Math.PI), team, m);
    pushMarkers(info, m, team, { b,  spawns: true });
    info.baseCenters.push(V(s * 88, b.ground(s * 88, 0), 0));
  }
  for (const s of [-1, 1]) {
    for (const [x, z, r, sd] of [
      [64, 24, 0.3, 30],
      [64, -24, -0.3, 31],
      [30, 38, 0.8, 32],
      [34, -36, -0.6, 33],
    ] as const) {
      C.coverCluster(K(b, s * x, s * z, s > 0 ? r : r + Math.PI), sd + (s > 0 ? 10 : 0));
      info.keepOut.push({ x: s * x, z: s * z, r: 6 });
    }
  }
  info.pickups.push({ pos: V(0, 0, 10), kind: 'armor' }, { pos: V(-28, 0, 26), kind: 'grenade' }, { pos: V(28, 0, -26), kind: 'grenade' });
  info.podZones.push(V(0, 0, 36), V(0, 0, -36), V(-30, 0, 30), V(30, 0, -30));
  info.keepOut.push({ x: -13, z: 0, r: 3 }, { x: 13, z: 0, r: 3 });
}
