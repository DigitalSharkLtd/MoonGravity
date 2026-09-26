import * as THREE from 'three';
import { MAPS, MapId, MapDef } from './MapDefs';
import { generateTerrain, TerrainData } from './TerrainGen';
import { TerrainMesh } from './TerrainMesh';
import { Sky, dirFromAngles } from './Sky';
import { Lighting } from './Lighting';
import { PhysicsWorld } from '../core/Physics';
import { StructureBuilder, Animated } from './Builder';
import { buildLayout, LayoutInfo } from './Layouts';
import { scatterRocks } from './Props';
import type { Quality } from '../render/Pipeline';

/** Everything static about a map: terrain, sky, lights, structures, colliders and gameplay markers. */
export class World {
  def: MapDef;
  scene = new THREE.Scene();
  terrainData: TerrainData;
  terrain: TerrainMesh;
  sky: Sky;
  lighting: Lighting;
  physics: PhysicsWorld;
  layout: LayoutInfo;
  animated: Animated[];
  sunDir: THREE.Vector3;
  structures: THREE.Group;
  time = 0;

  constructor(mapId: MapId, quality: Quality) {
    const def = (this.def = structuredClone(MAPS[mapId]));
    this.terrainData = generateTerrain(def);
    this.terrain = new TerrainMesh(this.terrainData, def);
    this.scene.add(this.terrain.group);
    this.sunDir = dirFromAngles(def.sun.azimuth, def.sun.elevation);
    this.sky = new Sky(this.sunDir, dirFromAngles(def.earth.azimuth, def.earth.elevation), def.earth.size, def.seed);
    this.scene.add(this.sky.group);
    this.lighting = new Lighting(this.scene, this.sunDir, quality);
    this.physics = new PhysicsWorld(this.terrainData.hf);
    this.physics.bounds = { minX: -def.halfX, maxX: def.halfX, minZ: -def.halfZ, maxZ: def.halfZ };

    const b = new StructureBuilder(this.physics, this.terrainData.hf);
    this.layout = buildLayout(b, def, this.terrainData);
    this.structures = b.finish();
    this.scene.add(this.structures);
    this.animated = b.animated;
    for (const p of this.layout.pickups) p.pos.y = this.terrainData.hf.heightAt(p.pos.x, p.pos.z);
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
  }

  update(dt: number, camPos: THREE.Vector3, focus: THREE.Vector3, pixelScale: number): void {
    this.time += dt;
    for (const a of this.animated) a.update(this.time, dt);
    this.terrain.update(this.time);
    this.sky.update(camPos, this.time, pixelScale);
    this.lighting.update(focus);
  }
}
