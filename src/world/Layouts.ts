import * as THREE from 'three';
import { StructureBuilder, Frame } from './Builder';
import * as P from './Prefabs';
import { MapDef } from './MapDefs';
import { TerrainData } from './TerrainGen';

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

export function buildLayout(b: StructureBuilder, def: MapDef, td: TerrainData): LayoutInfo {
  const info: LayoutInfo = { spawns: [], controlPoints: [], pickups: [], podZones: [], perches: [], baseCenters: [], keepOut: [] };
  const mineTop = td.mineTop;
  const m = def.mine;
  const floorY = mineTop - m.depth;
  info.keepOut.push({ x: m.x, z: m.z, r: m.floorR + 8 });
  if (def.id === 'duel') buildDuel(b, def, info, mineTop, floorY);
  else if (def.id === 'quarry') buildQuarry(b, def, info, mineTop, floorY);
  else buildFront(b, def, info, mineTop, floorY);
  // spawns: lift slightly above ground
  for (const s of info.spawns) s.pos.y = b.ground(s.pos.x, s.pos.z) + 0.3;
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
// 4v4 — "Tycho Front": two fortified bases, three control points around the mine.
function buildFront(b: StructureBuilder, def: MapDef, info: LayoutInfo, top: number, floorY: number): void {
  // --- the mine ---
  P.drillRig(b, F(b, 0, 0, Math.PI / 4));
  info.controlPoints.push({ id: 'B', pos: V(0, floorY, 0), radius: 10 });
  P.bridge(b, -15, -52, -15, 52, top + 0.8);
  P.bridge(b, 15, -52, 15, 52, top + 0.8);
  for (const z of [-26, 26]) {
    P.pylon(b, -15, z, top - 2.1);
    P.pylon(b, 15, z, top - 2.1);
  }
  info.perches.push(V(-15, top + 0.9, 0), V(15, top + 0.9, 0));
  P.conveyor(b, -9, floorY + 1.4, 9, -60, top + 5, 9);
  P.conveyor(b, 9, floorY + 1.4, -9, 60, top + 5, -9);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    P.lightPole(b, F(b, Math.cos(a) * 54, Math.sin(a) * 54, -a));
  }
  P.oreCluster(b, V(8, 0, 8), 1.4, 41);
  P.oreCluster(b, V(-9, 0, -7), 1.3, 42);

  // --- control points A / C: processing plant & ore silos ---
  P.refinery(b, F(b, -70, 0, Math.PI / 2), null);
  info.controlPoints.push({ id: 'A', pos: V(-70, b.ground(-70, 0), 9), radius: 9 });
  P.silos(b, F(b, 70, 0, -Math.PI / 2), null);
  info.controlPoints.push({ id: 'C', pos: V(70, b.ground(70, 0), -8), radius: 9 });
  info.perches.push(V(70, b.ground(70, 0) + 12.3, 0));

  // --- flanks ---
  P.commTower(b, F(b, 0, 76), 16, null);
  P.commTower(b, F(b, 0, -76), 16, null);
  info.perches.push(V(0, b.ground(0, 76) + 16.5, 76), V(0, b.ground(0, -76) + 16.5, -76));
  P.wreck(b, F(b, -40, 70, 0.4));
  P.wreck(b, F(b, 42, -72, 2.6));
  P.bunker(b, F(b, 36, 64, -0.3), null);
  P.bunker(b, F(b, -36, -64, 0.3), null);
  P.tankFarm(b, F(b, -30, 84, 0), null);
  P.tankFarm(b, F(b, 30, -84, Math.PI), null);
  P.containers(b, F(b, 48, 40, 0.6), [
    [0, 0, 0, 0],
    [2.6, 0, 0, 0],
  ], 51);
  P.containers(b, F(b, -48, -40, 0.6), [
    [0, 0, 0, 0],
    [2.6, 0, 0, 0],
  ], 52);
  P.containers(b, F(b, -50, 42, -0.5), [
    [0, 0, 0, 0],
    [1.3, 0, 1, 0.2],
  ], 53);
  P.containers(b, F(b, 50, -42, -0.5), [
    [0, 0, 0, 0],
    [1.3, 0, 1, 0.2],
  ], 54);
  for (const [x, z, r] of [
    [-92, 22, 0.3],
    [-92, -22, -0.3],
    [92, 22, -0.3],
    [92, -22, 0.3],
    [-40, 12, 1.6],
    [40, -12, 1.6],
  ] as const)
    P.barricade(b, F(b, x, z, Math.PI / 2 + r), 5, null);
  P.radar(b, F(b, 0, 90), null);
  P.solarArray(b, F(b, 22, 88, 0), 3);
  P.solarArray(b, F(b, -22, -88, 0), 3);

  // --- bases ---
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1;
    const bx = s * 132;
    const face = team === 0 ? 0 : Math.PI; // local +X → map center
    // front wall with central gate + side gates
    P.armorWall(b, s * 103, -52, s * 103, -9, 5, team);
    P.armorWall(b, s * 103, 9, s * 103, 52, 5, team);
    P.armorWall(b, s * 103, -52, s * 160, -56, 5, team);
    P.armorWall(b, s * 103, 52, s * 160, 56, 5, team);
    P.commTower(b, F(b, s * 105, -48), 10, team);
    P.commTower(b, F(b, s * 105, 48), 10, team);
    info.perches.push(V(s * 105, b.ground(s * 105, -48) + 10.5, -48), V(s * 105, b.ground(s * 105, 48) + 10.5, 48));
    P.bunker(b, F(b, s * 98, -14, Math.PI / 2), team);
    P.bunker(b, F(b, s * 98, 14, Math.PI / 2), team);
    // command dome
    P.domeHab(b, F(b, s * 142, 0, face), 10, team);
    // hangar opening toward the centre
    P.hangar(b, F(b, s * 128, 34, -s * Math.PI / 2), 16, 20, 9, team);
    // habitat row
    P.habModule(b, F(b, s * 122, -22, Math.PI / 2), 12, team);
    P.habModule(b, F(b, s * 150, -24, Math.PI / 2), 10, team);
    P.landingPad(b, F(b, s * 136, -42), 7, team);
    P.commTower(b, F(b, s * 157, 32), 24, team);
    info.perches.push(V(s * 157, b.ground(s * 157, 32) + 24.5, 32));
    P.radar(b, F(b, s * 158, 8), team);
    P.solarArray(b, F(b, s * 158, -44, Math.PI / 2), 4);
    P.tankFarm(b, F(b, s * 116, 48, 0), team);
    P.containers(b, F(b, s * 114, -40, 0), [
      [0, 0, 0, 0],
      [2.6, 0, 0, 0],
      [1.3, 0, 1, 0],
    ], 60 + team);
    P.o2Station(b, F(b, s * 126, -6, s < 0 ? Math.PI / 2 : -Math.PI / 2), team);
    P.o2Station(b, F(b, s * 126, 8, s < 0 ? Math.PI / 2 : -Math.PI / 2), team);
    P.spawnGate(b, F(b, s * 152, -12, s < 0 ? -Math.PI / 2 : Math.PI / 2), team);
    P.spawnGate(b, F(b, s * 152, 14, s < 0 ? -Math.PI / 2 : Math.PI / 2), team);
    P.lightPole(b, F(b, s * 110, -6, face));
    P.lightPole(b, F(b, s * 110, 6, face));
    info.pickups.push(
      { pos: V(s * 124, 0, -6), kind: 'o2' },
      { pos: V(s * 124, 0, 8), kind: 'o2' },
      { pos: V(s * 128, 0, 34), kind: 'armor' },
      { pos: V(s * 114, 0, -34), kind: 'ammo' },
      { pos: V(s * 112, 0, 42), kind: 'grenade' },
    );
    info.baseCenters.push(V(bx, b.ground(bx, 0), 0));
    info.keepOut.push({ x: bx, z: 0, r: 64 });
    for (let i = 0; i < 8; i++) addSpawn(b, info, s * (146 + (i % 2) * 5), -14 + Math.floor(i / 2) * 8.5, team, 0, 0);
  }
  info.pickups.push(
    { pos: V(-58, 0, 10), kind: 'ammo' },
    { pos: V(58, 0, -10), kind: 'ammo' },
    { pos: V(0, 0, 66), kind: 'o2' },
    { pos: V(0, 0, -66), kind: 'o2' },
    { pos: V(0, 0, 11), kind: 'armor' },
    { pos: V(-36, 0, 58), kind: 'grenade' },
    { pos: V(36, 0, -58), kind: 'grenade' },
  );
  info.podZones.push(V(0, 0, 0), V(0, 0, 62), V(0, 0, -62), V(-40, 0, 0), V(40, 0, 0));
  info.keepOut.push(
    { x: -70, z: 0, r: 16 },
    { x: 70, z: 0, r: 12 },
    { x: 0, z: 76, r: 6 },
    { x: 0, z: -76, r: 6 },
    { x: -40, z: 70, r: 6 },
    { x: 42, z: -72, r: 6 },
    { x: 36, z: 64, r: 6 },
    { x: -36, z: -64, r: 6 },
    { x: -30, z: 84, r: 7 },
    { x: 30, z: -84, r: 7 },
    { x: 0, z: 90, r: 5 },
  );
}
