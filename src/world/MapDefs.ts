export type MapId = 'duel' | 'quarry' | 'front';
export type ModeId = 'duel2v2' | 'ffa' | 'war4v4';

export interface CraterDef {
  x: number;
  z: number;
  r: number;
  depth?: number; // relative to r (default 0.22)
  rim?: number; // relative to r (default 0.06)
  peak?: number; // central peak height relative to r
  rays?: boolean; // bright ejecta ray system
}

export interface MineDef {
  x: number;
  z: number;
  r: number; // outer radius at the surface
  floorR: number; // radius of flat pit floor
  depth: number;
  benches: number;
  ramps: number[]; // azimuths (radians) of haul ramps cut into the benches
}

export interface FlatDef {
  x: number;
  z: number;
  w: number; // half width (x)
  d: number; // half depth (z)
  rot?: number;
  h?: number; // target height (defaults to sampled terrain)
  soft?: number; // falloff distance
}

export interface MapDef {
  id: MapId;
  seed: number;
  halfX: number; // playable half extents
  halfZ: number;
  margin: number; // terrain beyond the playable area
  cell: number;
  baseAmp: number;
  detailAmp: number;
  randomCraters: number;
  craterMaxR: number;
  craters: CraterDef[];
  mine: MineDef;
  flats: FlatDef[];
  sun: { azimuth: number; elevation: number };
  earth: { azimuth: number; elevation: number; size: number };
  tint: number; // regolith base color
}

const D = Math.PI / 180;

export const MAPS: Record<MapId, MapDef> = {
  duel: {
    id: 'duel',
    seed: 7071,
    halfX: 78,
    halfZ: 54,
    margin: 70,
    cell: 0.7,
    baseAmp: 3.2,
    detailAmp: 0.35,
    randomCraters: 70,
    craterMaxR: 11,
    craters: [
      { x: -30, z: 34, r: 9, rays: true },
      { x: 34, z: -36, r: 8 },
      { x: 12, z: 40, r: 5 },
      { x: -18, z: -40, r: 6 },
      { x: 110, z: 60, r: 40, peak: 0.05 },
    ],
    mine: { x: 0, z: 0, r: 30, floorR: 9, depth: 11, benches: 3, ramps: [80 * D, 260 * D] },
    flats: [
      { x: -60, z: 0, w: 16, d: 22, soft: 8 },
      { x: 60, z: 0, w: 16, d: 22, soft: 8 },
    ],
    sun: { azimuth: 35 * D, elevation: 17 * D },
    earth: { azimuth: 215 * D, elevation: 32 * D, size: 1 },
    tint: 0xaeaaa2,
  },
  quarry: {
    id: 'quarry',
    seed: 4242,
    halfX: 100,
    halfZ: 100,
    margin: 80,
    cell: 0.8,
    baseAmp: 4.5,
    detailAmp: 0.4,
    randomCraters: 110,
    craterMaxR: 14,
    craters: [
      { x: 62, z: 70, r: 12, rays: true },
      { x: -75, z: -58, r: 13, peak: 0.08 },
      { x: -64, z: 70, r: 7 },
      { x: 80, z: -30, r: 6 },
      { x: -180, z: 40, r: 60, peak: 0.06 },
    ],
    mine: { x: 0, z: 0, r: 58, floorR: 16, depth: 22, benches: 5, ramps: [20 * D, 150 * D, 270 * D] },
    flats: [
      { x: 0, z: 78, w: 22, d: 12, soft: 8 },
      { x: 0, z: -78, w: 22, d: 12, soft: 8 },
      { x: 78, z: 20, w: 12, d: 18, soft: 8 },
      { x: -78, z: -10, w: 12, d: 18, soft: 8 },
    ],
    sun: { azimuth: 120 * D, elevation: 21 * D },
    earth: { azimuth: 330 * D, elevation: 40 * D, size: 1.1 },
    tint: 0xaba8a1,
  },
  front: {
    id: 'front',
    seed: 1969,
    halfX: 165,
    halfZ: 95,
    margin: 90,
    cell: 0.9,
    baseAmp: 5,
    detailAmp: 0.45,
    randomCraters: 150,
    craterMaxR: 16,
    craters: [
      { x: -60, z: 62, r: 14, rays: true },
      { x: 64, z: -62, r: 13, peak: 0.07 },
      { x: 0, z: 78, r: 8 },
      { x: 0, z: -80, r: 9 },
      { x: -82, z: -58, r: 7 },
      { x: 86, z: 56, r: 7 },
      { x: 0, z: 230, r: 90, peak: 0.05 },
    ],
    mine: { x: 0, z: 0, r: 48, floorR: 13, depth: 18, benches: 4, ramps: [0, 180 * D] },
    flats: [
      { x: -132, z: 0, w: 32, d: 58, soft: 10 },
      { x: 132, z: 0, w: 32, d: 58, soft: 10 },
      { x: -70, z: 0, w: 10, d: 12, soft: 6 },
      { x: 70, z: 0, w: 10, d: 12, soft: 6 },
    ],
    sun: { azimuth: 70 * D, elevation: 14 * D },
    earth: { azimuth: 250 * D, elevation: 36 * D, size: 1.25 },
    tint: 0xb0aba2,
  },
};

export const MODE_MAP: Record<ModeId, MapId> = {
  duel2v2: 'duel',
  ffa: 'quarry',
  war4v4: 'front',
};
