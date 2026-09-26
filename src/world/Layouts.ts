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
export interface LayoutInfo {
  spawns: SpawnPoint[];
  controlPoints: ControlPoint[];
  pickups: PickupSpot[];
  podZones: THREE.Vector3[];
  perches: THREE.Vector3[];
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
  return info;
}

function addSpawn(b: StructureBuilder, info: LayoutInfo, x: number, z: number, team: number, tx = 0, tz = 0): void {
  info.spawns.push({ pos: V(x, b.ground(x, z), z), yaw: yawToward(x, z, tx, tz), team });
}

// ---------------------------------------------------------------------------
// 2v2 — "Shaft-7": two outposts facing each other over a compact open-pit mine.
function buildDuel(b: StructureBuilder, def: MapDef, info: LayoutInfo, top: number, floorY: number): void {
  P.drillRig(b, F(b, 0, 0));
  info.controlPoints.push({ id: 'B', pos: V(0, floorY, 0), radius: 9 });
  // bridge across the pit (walk under it upside-down)
  P.bridge(b, 14, -33, 14, 33, top + 0.6);
  P.pylon(b, 14, -17, top - 2.5);
  P.pylon(b, 14, 17, top - 2.5);
  P.conveyor(b, -6, floorY + 1.2, 8, -8, top + 4.5, 37);
  P.pylon(b, -8, 40, top + 4);
  info.perches.push(V(14, top + 0.7, 0));

  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1;
    const face = team === 0 ? 0 : Math.PI; // local +X toward the center
    P.domeHab(b, F(b, s * 67, -9, face), 6.5, team);
    P.habModule(b, F(b, s * 60, 13, Math.PI / 2), 10, team);
    P.commTower(b, F(b, s * 71, 15), 12, team);
    info.perches.push(V(s * 71, b.ground(s * 71, 15) + 12.5, 15));
    P.barricade(b, F(b, s * 47, -9, Math.PI / 2), 5, team);
    P.barricade(b, F(b, s * 47, 7, Math.PI / 2), 5, team);
    P.barricade(b, F(b, s * 53, 0, Math.PI / 2 + 0.2), 3, team);
    P.containers(b, F(b, s * 55, -21, 0), [
      [0, 0, 0, 0],
      [2.5, 0, 0, 0],
      [1.25, 0, 1, 0.1],
    ], 11 + team);
    P.solarArray(b, F(b, s * 75, -24, Math.PI / 2), 3);
    P.o2Station(b, F(b, s * 60, -2, s < 0 ? Math.PI / 2 : -Math.PI / 2), team);
    P.spawnGate(b, F(b, s * 73, 3, s < 0 ? -Math.PI / 2 : Math.PI / 2), team);
    P.lightPole(b, F(b, s * 50, 20, face));
    P.lightPole(b, F(b, s * 50, -20, face));
    info.pickups.push({ pos: V(s * 60, 0, 1.5), kind: 'o2' });
    info.pickups.push({ pos: V(s * 55, 0, -14), kind: 'ammo' });
    info.baseCenters.push(V(s * 62, b.ground(s * 62, 0), 0));
    info.keepOut.push({ x: s * 62, z: 0, r: 26 });
    for (let i = 0; i < 4; i++) addSpawn(b, info, s * (68 + (i % 2) * 5), -2 + i * 3, team, 0, 0);
  }
  // neutral cover around the rim
  P.wreck(b, F(b, -24, 41, 0.8));
  P.containers(b, F(b, 30, 41, 0.3), [
    [0, 0, 0, 0],
    [-3, 1, 0, 1.4],
  ], 5);
  P.containers(b, F(b, -32, -40, -0.4), [[0, 0, 0, 0]], 6);
  P.bunker(b, F(b, 26, -42, 0.2), null);
  P.crate(b, F(b, -36, 22));
  P.crate(b, F(b, 36, -22));
  P.crate(b, F(b, 37, -20.5), 0.9);
  P.lightPole(b, F(b, 0, 36));
  P.lightPole(b, F(b, 0, -36));
  info.pickups.push({ pos: V(-24, 0, 36), kind: 'armor' }, { pos: V(28, 0, -37), kind: 'grenade' }, { pos: V(0, 0, 8.5), kind: 'ammo' });
  info.podZones.push(V(0, 0, 0), V(-30, 0, 42), V(30, 0, -42));
  info.keepOut.push({ x: 14, z: 0, r: 4 }, { x: -24, z: 41, r: 6 }, { x: 30, z: 41, r: 7 }, { x: -32, z: -40, r: 6 }, { x: 26, z: -42, r: 6 });
}

// ---------------------------------------------------------------------------
// FFA — "Palladium Quarry": a huge terraced pit, crossing bridges, industry on every side.
function buildQuarry(b: StructureBuilder, def: MapDef, info: LayoutInfo, top: number, floorY: number): void {
  P.drillRig(b, F(b, 0, 0, 0.4));
  // crossing bridges
  P.bridge(b, -22, -60, -22, 60, top + 0.8);
  P.bridge(b, -62, 24, 62, 24, top + 0.8);
  for (const z of [-38, -12, 44]) P.pylon(b, -22, z, top - 2.1);
  for (const x of [-44, 20, 44]) P.pylon(b, x, 24, top - 2.1);
  info.perches.push(V(-22, top + 0.9, 24), V(-22, top + 0.9, -30), V(30, top + 0.9, 24));
  // north: refinery + conveyor out of the pit
  P.refinery(b, F(b, 0, 80, 0), null);
  P.conveyor(b, 8, floorY + 1.4, 10, 8, top + 6.5, 70);
  // south: silos
  P.silos(b, F(b, 0, -80, Math.PI), null);
  P.conveyor(b, -8, floorY + 1.4, -10, -8, top + 6, -70);
  // east: hangar opening toward the pit
  P.hangar(b, F(b, 80, 20, -Math.PI / 2), 14, 18, 8, null);
  // west: habitat cluster
  P.domeHab(b, F(b, -80, -14, 0), 7, null);
  P.habModule(b, F(b, -78, 6, 0), 9, null);
  // corners
  P.commTower(b, F(b, 62, -64), 14, null);
  P.commTower(b, F(b, -64, 66), 14, null);
  info.perches.push(V(62, b.ground(62, -64) + 14.5, -64), V(-64, b.ground(-64, 66) + 14.5, 66));
  P.radar(b, F(b, -68, -66), null);
  P.landingPad(b, F(b, 70, 68), 6, null);
  P.tankFarm(b, F(b, 40, -78, 0.2), null);
  P.solarArray(b, F(b, -40, 82, 0), 4);
  P.wreck(b, F(b, 86, -30, 2));
  P.containers(b, F(b, -40, -80, 0.5), [
    [0, 0, 0, 0],
    [2.6, 0, 0, 0],
    [0, 3, 1, 1.2],
  ], 21);
  P.containers(b, F(b, 58, 40, -0.7), [
    [0, 0, 0, 0],
    [0, 3.2, 0, 0.3],
  ], 22);
  P.bunker(b, F(b, -86, 42, 1.2), null);
  P.bunker(b, F(b, 36, 76, 0.1), null);
  P.barricade(b, F(b, 0, 62, 0), 6, null);
  P.barricade(b, F(b, 0, -62, 0), 6, null);
  P.barricade(b, F(b, 62, 0, Math.PI / 2), 6, null);
  P.barricade(b, F(b, -62, 0, Math.PI / 2), 6, null);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.26;
    P.lightPole(b, F(b, Math.cos(a) * 64, Math.sin(a) * 64, -a));
  }
  P.oreCluster(b, V(9, 0, -9), 1.4, 31);
  P.oreCluster(b, V(-12, 0, 6), 1.2, 32);
  info.controlPoints.push({ id: 'B', pos: V(0, floorY, 0), radius: 10 });
  // pickups
  info.pickups.push(
    { pos: V(0, 0, 70), kind: 'o2' },
    { pos: V(0, 0, -70), kind: 'o2' },
    { pos: V(74, 0, 20), kind: 'armor' },
    { pos: V(-70, 0, -2), kind: 'o2' },
    { pos: V(0, 0, 10), kind: 'ammo' },
    { pos: V(50, 0, -50), kind: 'grenade' },
    { pos: V(-50, 0, 50), kind: 'grenade' },
    { pos: V(-60, 0, -50), kind: 'ammo' },
    { pos: V(60, 0, 55), kind: 'ammo' },
  );
  info.podZones.push(V(0, 0, 0), V(0, 0, 30), V(30, 0, -20), V(-40, 0, 72), V(72, 0, -40));
  // FFA spawns ringed around the pit
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.1;
    const r = i % 2 ? 72 : 86;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    addSpawn(b, info, x, z, -1, 0, 0);
  }
  info.keepOut.push(
    { x: 0, z: 80, r: 16 },
    { x: 0, z: -80, r: 12 },
    { x: 80, z: 20, r: 16 },
    { x: -80, z: -8, r: 16 },
    { x: 62, z: -64, r: 5 },
    { x: -64, z: 66, r: 5 },
    { x: 70, z: 68, r: 8 },
    { x: 40, z: -78, r: 8 },
    { x: -40, z: 82, r: 9 },
    { x: -40, z: -80, r: 8 },
    { x: 58, z: 40, r: 8 },
  );
}

// ---------------------------------------------------------------------------
// 4v4 — "Tycho Front": two star-forts, A processing plant, B drill rig in the mine, C silo complex,
// spaceport flank (north) and science lab flank (south).
function pushMarkers(info: LayoutInfo, m: C.Markers, team: number | null, o: { spawns?: boolean; cp?: 'A' | 'B' | 'C'; cpR?: number } = {}): void {
  for (const p of m.pickups) info.pickups.push({ pos: p.pos.clone(), kind: p.kind, elevated: p.elevated || undefined });
  for (const p of m.perches) info.perches.push(p.clone());
  for (const k of m.keep) info.keepOut.push(k);
  if (o.spawns) for (const sp of m.spawns) info.spawns.push({ pos: sp.pos.clone(), yaw: sp.yaw, team: team ?? -1 });
  if (o.cp && m.cp) info.controlPoints.push({ id: o.cp, pos: m.cp.clone(), radius: o.cpR ?? 8 });
}

function buildFront(b: StructureBuilder, def: MapDef, info: LayoutInfo, top: number, floorY: number): void {
  // --- B: the mine ---
  P.drillRig(b, F(b, 0, 0, Math.PI / 4));
  info.controlPoints.push({ id: 'B', pos: V(0, floorY, 0), radius: 9 });
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
  C.processingPlant(new Kit(b, frameAt(b, -46, 0, 0)), mA, { conveyorTo: V(-6, floorY + 1.4, 7), seed: 1 });
  pushMarkers(info, mA, null, { cp: 'A' });
  const mC = C.markers();
  C.siloComplex(new Kit(b, frameAt(b, 46, 0, Math.PI)), mC, { seed: 2 });
  pushMarkers(info, mC, null, { cp: 'C' });
  P.conveyor(b, 6, floorY + 1.4, -7, 37, top + 5.5, 4);
  // --- bases ---
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1;
    const m = C.markers();
    C.fortress(new Kit(b, frameAt(b, s * 88, 0, team === 0 ? 0 : Math.PI)), team, m);
    pushMarkers(info, m, team, { spawns: true });
    info.baseCenters.push(V(s * 88, b.ground(s * 88, 0), 0));
  }
  info.podZones.push(V(0, 0, 0), V(0, 0, 50), V(0, 0, -50), V(-30, 0, 30), V(30, 0, -30));
}
