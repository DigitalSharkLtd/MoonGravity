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
  /** added to the sampled height (plateaus > 0, sunken courts < 0) */
  offset?: number;
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

/**
 * Compact, dense arenas (per product direction): duel ≈ 110×80 m, quarry ≈ 150×150 m, front ≈ 220×140 m.
 * Flats are levelled pads under every complex footprint (the mine's spoil berm is suppressed on them).
 */
export const MAPS: Record<MapId, MapDef> = {
  duel: {
    id: 'duel',
    seed: 7071,
    halfX: 55,
    halfZ: 40,
    margin: 60,
    cell: 0.6,
    baseAmp: 2.6,
    detailAmp: 0.3,
    randomCraters: 45,
    craterMaxR: 7,
    craters: [
      { x: -22, z: 30, r: 5, rays: true },
      { x: 24, z: -30, r: 5 },
      { x: 90, z: 50, r: 34, peak: 0.05 },
    ],
    mine: { x: 0, z: 0, r: 21, floorR: 6.5, depth: 8, benches: 2, ramps: [80 * D, 260 * D] },
    flats: [
      { x: -41, z: 0, w: 13.5, d: 17.5, soft: 6 },
      { x: 41, z: 0, w: 13.5, d: 17.5, soft: 6 },
      { x: 0, z: 31, w: 11, d: 7, soft: 5 },
      { x: 0, z: -31, w: 11, d: 7, soft: 5 },
    ],
    sun: { azimuth: 35 * D, elevation: 17 * D },
    earth: { azimuth: 215 * D, elevation: 32 * D, size: 1 },
    tint: 0xaeaaa2,
  },
  quarry: {
    id: 'quarry',
    seed: 4242,
    halfX: 75,
    halfZ: 75,
    margin: 60,
    cell: 0.7,
    baseAmp: 3.6,
    detailAmp: 0.35,
    randomCraters: 60,
    craterMaxR: 8,
    craters: [
      { x: -140, z: 40, r: 50, peak: 0.06 },
      { x: 110, z: -120, r: 40 },
    ],
    mine: { x: 0, z: 0, r: 40, floorR: 12, depth: 16, benches: 4, ramps: [20 * D, 150 * D, 270 * D] },
    flats: [
      { x: 0, z: 60, w: 14, d: 12, soft: 5 }, // N processing plant
      { x: 53, z: 53, w: 20, d: 20, soft: 5, rot: 0 }, // NE spaceport
      { x: 62, z: 0, w: 11, d: 11, soft: 5, offset: 1.5 }, // E relay on high ground
      { x: 53, z: -53, w: 19, d: 19, soft: 5 }, // SE lab
      { x: 0, z: -61, w: 14, d: 11, soft: 5 }, // S silos / power
      { x: -53, z: -53, w: 20, d: 20, soft: 5 }, // SW hab dome
      { x: -62, z: 0, w: 11, d: 12, soft: 5 }, // W depot
      { x: -53, z: 53, w: 18, d: 18, soft: 5 }, // NW power station
    ],
    sun: { azimuth: 120 * D, elevation: 21 * D },
    earth: { azimuth: 330 * D, elevation: 40 * D, size: 1.1 },
    tint: 0xaba8a1,
  },
  front: {
    id: 'front',
    seed: 1969,
    halfX: 110,
    halfZ: 70,
    margin: 70,
    cell: 0.75,
    baseAmp: 3.8,
    detailAmp: 0.4,
    randomCraters: 80,
    craterMaxR: 9,
    craters: [
      { x: -64, z: 58, r: 6, rays: true },
      { x: 66, z: -58, r: 6 },
      { x: 0, z: 200, r: 80, peak: 0.05 },
    ],
    mine: { x: 0, z: 0, r: 30, floorR: 9, depth: 12, benches: 3, ramps: [0, 180 * D] },
    flats: [
      { x: -88, z: 0, w: 22, d: 44, soft: 8 },
      { x: 88, z: 0, w: 22, d: 44, soft: 8 },
      { x: -46, z: 0, w: 13.5, d: 17, soft: 6 }, // A processing plant
      { x: 46, z: 0, w: 13.5, d: 17, soft: 6 }, // C silo complex
      { x: 0, z: 53, w: 27, d: 14, soft: 6 }, // north spaceport
      { x: 0, z: -53, w: 27, d: 14, soft: 6 }, // south lab
      { x: -62, z: 52, w: 8, d: 8, soft: 5 },
      { x: 62, z: -52, w: 8, d: 8, soft: 5 },
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
