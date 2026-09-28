import * as THREE from 'three';
import { MAPS, MapId, MapDef } from './MapDefs';
import { generateTerrain, TerrainData } from './TerrainGen';
import { TerrainMesh } from './TerrainMesh';
import { Sky, dirFromAngles } from './Sky';
import { PhysicsWorld } from '../core/Physics';
import { StructureBuilder, Animated } from './Builder';
import { buildLayout, LayoutInfo } from './Layouts';
import { gradeFoundations } from './Foundations';
import { tidySpawns } from './Spawns';
import { scatterRocks } from './Props';
import type { Quality } from '../game/Types';
import { Lighting as _L, ShadowMode } from './Lighting';

/** Everything static about a map: terrain, sky, lights, structures, colliders and gameplay markers. */
export class World {
  def: MapDef;
  scene = new THREE.Scene();
  terrainData: TerrainData;
  terrain: TerrainMesh;
  sky: Sky;
  lighting: _L;
  physics: PhysicsWorld;
  layout: LayoutInfo;
  animated: Animated[];
  sunDir: THREE.Vector3;
  structures: THREE.Group;
  time = 0;
  /** build phase timings (ms) for diagnostics */
  timings: Record<string, number> = {};

  constructor(mapId: MapId, opts: { quality: Quality; shadows: ShadowMode; renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; terrainDetail?: boolean }) {
    const quality = opts.quality;
    const def = (this.def = structuredClone(MAPS[mapId]));
    let tm = performance.now();
    const lap = (k: string) => {
      const now = performance.now();
      this.timings[k] = Math.round(now - tm);
      tm = now;
    };
    this.terrainData = generateTerrain(def);
    lap('terrainGen');
    this.terrain = new TerrainMesh(this.terrainData, def, opts.terrainDetail ?? true);
    lap('terrainMesh');
    this.scene.add(this.terrain.group);
    this.sunDir = dirFromAngles(def.sun.azimuth, def.sun.elevation);
    this.sky = new Sky(this.sunDir, dirFromAngles(def.earth.azimuth, def.earth.elevation), def.earth.size, def.seed);
    this.scene.add(this.sky.group);
    const earthDir = dirFromAngles(def.earth.azimuth, def.earth.elevation);
    this.lighting = new _L(this.scene, opts.camera, opts.renderer, this.sunDir, earthDir, quality, opts.shadows);
    this.physics = new PhysicsWorld(this.terrainData.hf);
    this.physics.bounds = { minX: -def.halfX, maxX: def.halfX, minZ: -def.halfZ, maxZ: def.halfZ };
    lap('skyLighting');

    const b = new StructureBuilder(this.physics, this.terrainData.hf);
    lap('materials');
    this.layout = buildLayout(b, def, this.terrainData);
    lap('layout');
    this.structures = b.finish();
    lap('merge+bake');
    // level the ground under every foundation, then rebuild the terrain surface over it
    const noGrade = typeof location !== 'undefined' && location.search.includes('nograde'); // debug A/B
    const graded = noGrade ? { footprints: 0, cells: 0, box: null } : gradeFoundations(this.physics, this.terrainData.hf);
    if (graded.box) this.terrain.refresh(graded.box);
    for (const s of this.layout.spawns) s.pos.y = Math.max(s.pos.y, this.terrainData.hf.heightAt(s.pos.x, s.pos.z) + 0.3);
    const tidied = tidySpawns(this.physics, this.layout.spawns); // out of cramped corners, facing the way out
    if (tidied) console.info(`[world] moved ${tidied} cramped spawns`);
    console.info(`[world] graded ${graded.footprints} foundations (${graded.cells} cells)`);
    lap('grading');
    this.terrain.bakeLights(b.lights, b.lamps);
    lap('terrainBake');
    this.scene.add(this.structures);
    this.animated = b.animated;
    // pickups on upper floors keep their explicit height (elevated), the rest sit on the terrain
    for (const p of this.layout.pickups) if (!p.elevated) p.pos.y = this.terrainData.hf.heightAt(p.pos.x, p.pos.z);
    for (const p of this.layout.podZones) p.y = this.terrainData.hf.heightAt(p.x, p.z);

    const rocks = new THREE.Group();
    const flats = def.flats;
    const keep = this.layout.keepOut;
    const m = def.mine;
    scatterRocks(rocks, this.physics, def, (x, z, r) => {
      for (const f of flats) if (Math.abs(x - f.x) < f.w + r && Math.abs(z - f.z) < f.d + r) return true;
      for (const k of keep) if (Math.hypot(x - k.x, z - k.z) < k.r + r) return true;
      const dm = Math.hypot(x - m.x, z - m.z);
      if (dm < m.r && dm > m.floorR - 2) {
        // keep ramps clear
        const ang = Math.atan2(z - m.z, x - m.x);
        for (const ra of m.ramps) {
          let da = Math.abs(ang - ra);
          if (da > Math.PI) da = 2 * Math.PI - da;
          if (da * dm < 7) return true;
        }
      }
      return this.physics.pointBlocked(new THREE.Vector3(x, this.terrainData.hf.heightAt(x, z) + 1, z), r);
    });
    this.scene.add(rocks);
    lap('rocks');
  }

  update(dt: number, camPos: THREE.Vector3, focus: THREE.Vector3, pixelScale: number): void {
    this.time += dt;
    for (const a of this.animated) a.update(this.time, dt);
    this.terrain.update(this.time);
    this.sky.update(camPos, this.time, pixelScale);
    this.lighting.update();
  }
}
