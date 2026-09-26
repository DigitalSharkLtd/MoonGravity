import * as THREE from 'three';
import { TerrainData } from './TerrainGen';
import { MapDef } from './MapDefs';
import { registerLit, stylize } from '../render/Materials';
import { regolithSet } from '../render/TextureGen';
import type { BakeLight } from './Builder';

const CHUNK = 64; // cells per chunk side

/** Shader chunk: procedural regolith detail (micro craters, grain, pebbles) layered on top of the toon lighting. */
const TERRAIN_PARS = /* glsl */ `
varying vec3 vWorldPos;
varying float vOre;
varying float vTintShift;
uniform float uTime;
uniform vec3 uCool;
uniform vec3 uWarm;
uniform vec3 uOre;
uniform sampler2D tDetail;
uniform sampler2D tDetailN;

vec2 th22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float th12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float tvnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = th12(i), b = th12(i + vec2(1.0, 0.0)), c = th12(i + vec2(0.0, 1.0)), d = th12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Cellular crater field. returns (dh/dx, dh/dz, h, rimMask) in cell units
vec4 craterField(vec2 p, float density) {
  vec2 ip = floor(p); vec2 fp = fract(p);
  vec4 acc = vec4(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 h = th22(ip + g);
      if (fract(h.x * 7.13 + h.y * 3.1) > density) continue;
      float r = mix(0.16, 0.5, fract(h.y * 13.7 + h.x));
      vec2 c = g + 0.2 + 0.6 * h - fp;
      float d = length(c);
      float x = d / r;
      if (x > 1.7) continue;
      float hh; float dh;
      if (x < 1.0) { hh = (x * x - 1.0) * 0.55 + 0.18; dh = 1.1 * x; }
      else { float t = (x - 1.0) / 0.7; hh = 0.18 * (1.0 - t) * (1.0 - t); dh = -0.36 * (1.0 - t) / 0.7; }
      vec2 dir = -c / max(d, 1e-4);
      acc.xy += dir * dh / r;
      acc.z += hh;
      acc.w = max(acc.w, 1.0 - abs(x - 1.0) * 4.0);
    }
  }
  return acc;
}
`;

export class TerrainMesh {
  group = new THREE.Group();
  chunks: { mesh: THREE.Mesh; i0: number; j0: number; i1: number; j1: number }[] = [];
  material: THREE.MeshStandardMaterial;
  farMesh: THREE.Mesh;
  private data: TerrainData;
  uniforms = {
    uTime: { value: 0 },
    uCool: { value: new THREE.Color(0x6b76a8) },
    uWarm: { value: new THREE.Color(0xd9c7a8) },
    uOre: { value: new THREE.Color(0x7ff0ff) },
    tDetail: { value: null as THREE.Texture | null },
    tDetailN: { value: null as THREE.Texture | null },
  };

  constructor(data: TerrainData, def: MapDef) {
    this.data = data;
    const base = new THREE.Color(def.tint);
    this.material = new THREE.MeshStandardMaterial({ color: base, vertexColors: true, roughness: 0.97, metalness: 0 });
    this.patchMaterial(this.material, true);
    const hf = data.hf;
    for (let j0 = 0; j0 < hf.nz - 1; j0 += CHUNK) {
      for (let i0 = 0; i0 < hf.nx - 1; i0 += CHUNK) {
        const i1 = Math.min(hf.nx - 1, i0 + CHUNK);
        const j1 = Math.min(hf.nz - 1, j0 + CHUNK);
        const geo = this.buildChunk(i0, j0, i1, j1);
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.chunks.push({ mesh, i0, j0, i1, j1 });
      }
    }
    this.farMesh = this.buildFar(def);
    this.group.add(this.farMesh);
  }

  private patchMaterial(mat: THREE.MeshStandardMaterial, detail: boolean): void {
    const u = this.uniforms;
    const reg = regolithSet(12);
    u.tDetail.value = reg.map;
    u.tDetailN.value = reg.normalMap;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aOre;
          attribute float aTint;
          attribute vec3 aBake;
          varying vec3 vBake;
          varying vec3 vWorldPos;
          varying float vOre;
          varying float vTintShift;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vOre = aOre;
          vBake = aBake;
          vTintShift = aTint;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBake;\n' + TERRAIN_PARS)
        .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse += vBake * diffuseColor.rgb;\n#include <aomap_fragment>')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec2 wp = vWorldPos.xz;
          float camDist = length(vViewPosition);
          // regolith: fine grain + mottling + warm/cool large scale shift
          float grain = tvnoise(wp * 3.1) * 0.5 + tvnoise(wp * 7.3) * 0.3 + tvnoise(wp * 0.9) * 0.6;
          float mott = tvnoise(wp * 0.12) * 0.7 + tvnoise(wp * 0.37) * 0.3;
          diffuseColor.rgb *= 0.86 + 0.1 * grain * (1.0 - smoothstep(20.0, 120.0, camDist)) + 0.12 * mott;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uWarm * 1.15, clamp(vTintShift, 0.0, 1.0) * 0.35);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uCool * 1.35, clamp(-vTintShift, 0.0, 1.0) * 0.3);
          // scattered pebbles
          vec2 pc = floor(wp * 1.3);
          vec2 pf = fract(wp * 1.3) - th22(pc) * 0.8 - 0.1;
          float peb = step(0.82, th12(pc + 3.7)) * (1.0 - smoothstep(0.05, 0.11, length(pf)));
          diffuseColor.rgb *= 1.0 - peb * 0.25 * (1.0 - smoothstep(10.0, 40.0, camDist));
          vec3 det = texture2D(tDetail, wp / 3.0).rgb * 0.6 + texture2D(tDetail, wp / 11.0).rgb * 0.4;
          diffuseColor.rgb *= mix(vec3(1.0), det * 1.08, 1.0 - smoothstep(30.0, 110.0, camDist));
          `,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          ${
            detail
              ? `{
            // micro craters at two scales perturb the shading normal
            float lod = 1.0 - smoothstep(35.0, 150.0, camDist);
            vec4 c1 = craterField(wp / 6.5, 0.18);
            vec4 c3 = craterField(wp / 2.6 + 17.0, 0.22);
            vec4 c2 = craterField(wp / 0.9, 0.2) * (1.0 - smoothstep(8.0, 45.0, camDist));
            vec2 grad = c1.xy * 0.2 + c3.xy * 0.14 + c2.xy * 0.1;
            c1 = max(c1, c3);
            vec2 g2 = vec2(tvnoise(wp * 2.3 + 0.37) - tvnoise(wp * 2.3 - 0.37), tvnoise(wp * 2.3 + vec2(0.0, 0.37)) - tvnoise(wp * 2.3 - vec2(0.0, 0.37)));
            grad += g2 * 0.35 * (1.0 - smoothstep(6.0, 30.0, camDist));
            grad *= lod;
            vec3 dn1 = texture2D(tDetailN, wp / 3.0).xyz * 2.0 - 1.0;
            vec3 dn2 = texture2D(tDetailN, wp / 11.0).xyz * 2.0 - 1.0;
            float dl = 1.0 - smoothstep(25.0, 90.0, camDist);
            grad -= (dn1.xy * 0.55 + dn2.xy * 0.45) * 0.9 * dl;
            vec3 pert = mat3(viewMatrix) * vec3(-grad.x, 0.0, -grad.y);
            normal = normalize(normal + pert);
            diffuseColor.rgb *= 1.0 + (c1.w * 0.1 + c2.w * 0.06) * lod - clamp(-c1.z, 0.0, 1.0) * 0.07 * lod;
          }`
              : ''
          }
          `,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            float veinN = tvnoise(wp * 1.7 + uTime * 0.05) * 0.6 + 0.4;
            float pulse = 0.75 + 0.25 * sin(uTime * 1.3 + wp.x * 0.2 + wp.y * 0.17);
            totalEmissiveRadiance += uOre * vOre * veinN * pulse * 1.6;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.93, 1.0), vOre * 0.5);
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'terrainB' + (detail ? 'D' : '');
    stylize(mat, { rim: 0.1, wrap: 0.12, rimColor: 0xb8c8ff });
    registerLit(mat);
  }

  private buildChunk(i0: number, j0: number, i1: number, j1: number): THREE.BufferGeometry {
    const hf = this.data.hf;
    const cw = i1 - i0 + 1;
    const ch = j1 - j0 + 1;
    const pos = new Float32Array(cw * ch * 3);
    const nrm = new Float32Array(cw * ch * 3);
    const col = new Float32Array(cw * ch * 3);
    const oreA = new Float32Array(cw * ch);
    const tintA = new Float32Array(cw * ch);
    this.fillChunk(i0, j0, i1, j1, pos, nrm, col, oreA, tintA);
    const idx: number[] = [];
    for (let j = 0; j < ch - 1; j++) {
      for (let i = 0; i < cw - 1; i++) {
        const a = j * cw + i;
        const b = a + 1;
        const c = a + cw;
        const d = c + 1;
        idx.push(a, d, b, a, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aOre', new THREE.BufferAttribute(oreA, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tintA, 1));
    geo.setAttribute('aBake', new THREE.BufferAttribute(new Float32Array(cw * ch * 3), 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    // leave headroom for deformation
    geo.boundingBox!.min.y -= 20;
    geo.boundingSphere!.radius += 20;
    return geo;
  }

  private fillChunk(
    i0: number,
    j0: number,
    i1: number,
    j1: number,
    pos: Float32Array,
    nrm: Float32Array,
    col: Float32Array,
    oreA: Float32Array,
    tintA: Float32Array,
  ): void {
    const hf = this.data.hf;
    const cw = i1 - i0 + 1;
    const n = new THREE.Vector3();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const v = (j - j0) * cw + (i - i0);
        const k = hf.idx(i, j);
        const x = hf.x0 + i * hf.cell;
        const z = hf.z0 + j * hf.cell;
        pos[v * 3] = x;
        pos[v * 3 + 1] = hf.data[k];
        pos[v * 3 + 2] = z;
        const hl = hf.get(i - 1, j);
        const hr = hf.get(i + 1, j);
        const hd = hf.get(i, j - 1);
        const hu = hf.get(i, j + 1);
        n.set(hl - hr, 2 * hf.cell, hd - hu).normalize();
        nrm[v * 3] = n.x;
        nrm[v * 3 + 1] = n.y;
        nrm[v * 3 + 2] = n.z;
        const a = this.data.albedo[k];
        col[v * 3] = a;
        col[v * 3 + 1] = a;
        col[v * 3 + 2] = a;
        oreA[v] = this.data.ore[k];
        tintA[v] = this.data.tint[k];
      }
    }
  }

  /** Re-upload chunks overlapping a deformed index box. */
  refresh(box: { i0: number; i1: number; j0: number; j1: number }): void {
    for (const c of this.chunks) {
      if (c.i1 < box.i0 - 1 || c.i0 > box.i1 + 1 || c.j1 < box.j0 - 1 || c.j0 > box.j1 + 1) continue;
      const g = c.mesh.geometry;
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
      const col = g.getAttribute('color') as THREE.BufferAttribute;
      const ore = g.getAttribute('aOre') as THREE.BufferAttribute;
      const tint = g.getAttribute('aTint') as THREE.BufferAttribute;
      this.fillChunk(
        c.i0,
        c.j0,
        c.i1,
        c.j1,
        pos.array as Float32Array,
        nrm.array as Float32Array,
        col.array as Float32Array,
        ore.array as Float32Array,
        tint.array as Float32Array,
      );
      pos.needsUpdate = true;
      nrm.needsUpdate = true;
      col.needsUpdate = true;
    }
  }

  /** Darken albedo in a disc (scorch marks). */
  scorch(x: number, z: number, r: number, amount: number): { i0: number; i1: number; j0: number; j1: number } {
    const hf = this.data.hf;
    const i0 = Math.max(0, Math.floor((x - r - hf.x0) / hf.cell));
    const i1 = Math.min(hf.nx - 1, Math.ceil((x + r - hf.x0) / hf.cell));
    const j0 = Math.max(0, Math.floor((z - r - hf.z0) / hf.cell));
    const j1 = Math.min(hf.nz - 1, Math.ceil((z + r - hf.z0) / hf.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(hf.x0 + i * hf.cell - x, hf.z0 + j * hf.cell - z) / r;
        if (d >= 1) continue;
        const k = hf.idx(i, j);
        this.data.albedo[k] = Math.max(0.35, this.data.albedo[k] - amount * (1 - d * d));
      }
    }
    return { i0, i1, j0, j1 };
  }

  /** Distant mountains: a rectangular ring around the heightfield out to the horizon. */
  private buildFar(def: MapDef): THREE.Mesh {
    const hf = this.data.hf;
    const ex0 = hf.x0,
      ex1 = hf.x1,
      ez0 = hf.z0,
      ez1 = hf.z1;
    const R = 2600;
    const coords = (a0: number, a1: number): number[] => {
      const out: number[] = [];
      // outward from the edges with growing spacing
      const steps: number[] = [];
      let d = 0;
      let s = 4;
      while (d < R) {
        d += s;
        steps.push(d);
        s *= 1.07;
      }
      for (let k = steps.length - 1; k >= 0; k--) out.push(a0 - steps[k]);
      const inner = Math.ceil((a1 - a0) / 12);
      for (let k = 0; k <= inner; k++) out.push(a0 + ((a1 - a0) * k) / inner);
      for (const st of steps) out.push(a1 + st);
      return out;
    };
    const xs = coords(ex0, ex1);
    const zs = coords(ez0, ez1);
    const W = xs.length;
    const pos: number[] = [];
    const col: number[] = [];
    for (let j = 0; j < zs.length; j++) {
      for (let i = 0; i < W; i++) {
        const x = xs[i];
        const z = zs[j];
        const inside = x >= ex0 - 0.01 && x <= ex1 + 0.01 && z >= ez0 - 0.01 && z <= ez1 + 0.01;
        let y: number;
        if (inside) {
          // on the border use the detailed terrain's own height (seam match); interior never rendered
          y = hf.heightAt(x, z) - 0.05;
        } else y = this.data.farHeight(x, z);
        pos.push(x, y, z);
        const a = 0.9 + 0.1 * this.data.noise.fbm2(x / 300, z / 300, 3);
        col.push(a, a, a);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < zs.length - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2;
        const cz = (zs[j] + zs[j + 1]) / 2;
        if (cx > ex0 && cx < ex1 && cz > ez0 && cz < ez1) continue; // hole for detailed terrain
        const a = j * W + i;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        idx.push(a, d, b, a, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aOre', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
    geo.setAttribute('aTint', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
    geo.setAttribute('aBake', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.tint), vertexColors: true, roughness: 0.97, metalness: 0 });
    this.patchMaterial(mat, false);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  update(t: number): void {
    this.uniforms.uTime.value = t;
  }

  /**
   * Bake static structure lights (door spills, lamp posts, catwalk downlights) into terrain vertices
   * so warm pools of light sit on the regolith without any real-time lights.
   */
  bakeLights(lights: BakeLight[], lamps: THREE.Vector3[] = []): void {
    const hf = this.data.hf;
    const warm = new THREE.Color(0xffd8a0);
    const all: BakeLight[] = lights.concat(lamps.map((p) => ({ pos: p, color: warm, intensity: 5, radius: 11 })));
    if (!all.length) return;
    const acc = new Float32Array(hf.nx * hf.nz * 3);
    let any = false;
    for (const L of all) {
      const r = L.radius;
      const i0 = Math.max(0, Math.floor((L.pos.x - r - hf.x0) / hf.cell));
      const i1 = Math.min(hf.nx - 1, Math.ceil((L.pos.x + r - hf.x0) / hf.cell));
      const j0 = Math.max(0, Math.floor((L.pos.z - r - hf.z0) / hf.cell));
      const j1 = Math.min(hf.nz - 1, Math.ceil((L.pos.z + r - hf.z0) / hf.cell));
      const r2 = r * r;
      const bb = L.bounds;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = hf.x0 + i * hf.cell;
          const z = hf.z0 + j * hf.cell;
          const k = j * hf.nx + i;
          const y = hf.data[k];
          if (bb && (x < bb.min.x || x > bb.max.x || y < bb.min.y || y > bb.max.y || z < bb.min.z || z > bb.max.z)) continue;
          const dx = L.pos.x - x;
          const dy = L.pos.y - y;
          const dz = L.pos.z - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r2) continue;
          const d = Math.sqrt(d2) || 1e-3;
          let nx = hf.get(i - 1, j) - hf.get(i + 1, j);
          let ny = 2 * hf.cell;
          let nz = hf.get(i, j - 1) - hf.get(i, j + 1);
          const nl = Math.hypot(nx, ny, nz);
          nx /= nl;
          ny /= nl;
          nz /= nl;
          const wrap = ((nx * dx + ny * dy + nz * dz) / d + 0.3) / 1.3;
          if (wrap <= 0) continue;
          const q = d2 / r2;
          let win = 1 - q * q;
          win *= win;
          let att = (L.intensity * win) / (d2 + 1);
          if (L.dir) {
            const c = -(dx * L.dir.x + dy * L.dir.y + dz * L.dir.z) / d;
            const cone = L.cone ?? 0.5;
            const t = Math.min(1, Math.max(0, (c - cone) / Math.max(0.05, (1 - cone) * 0.6)));
            att *= t * t * (3 - 2 * t);
          }
          const e = att * Math.min(1, wrap);
          if (e <= 1e-4) continue;
          acc[k * 3] += L.color.r * e;
          acc[k * 3 + 1] += L.color.g * e;
          acc[k * 3 + 2] += L.color.b * e;
          any = true;
        }
      }
    }
    if (!any) return;
    for (const c of this.chunks) {
      const attr = c.mesh.geometry.getAttribute('aBake') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const cw = c.i1 - c.i0 + 1;
      for (let j = c.j0; j <= c.j1; j++) {
        for (let i = c.i0; i <= c.i1; i++) {
          const v = (j - c.j0) * cw + (i - c.i0);
          const k = j * hf.nx + i;
          for (let ch = 0; ch < 3; ch++) {
            const a = acc[k * 3 + ch];
            arr[v * 3 + ch] = a / (1 + a * 0.25);
          }
        }
      }
      attr.needsUpdate = true;
    }
  }
}
