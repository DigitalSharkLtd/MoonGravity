import * as THREE from 'three';
import { PbrSet } from './TextureGen';

/**
 * Stylised PBR materials ("almost real, but painted" — Overwatch-like).
 * All lit materials are registered so the cascaded-shadow system can patch them.
 */

type LitMat = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
const lit = new Set<LitMat>();
const listeners: ((m: LitMat) => void)[] = [];

export function registerLit<T extends LitMat>(m: T): T {
  if (!lit.has(m)) {
    lit.add(m);
    for (const l of listeners) l(m);
  }
  return m;
}
export function allLit(): Iterable<LitMat> {
  return lit;
}
export function onLitMaterial(cb: (m: LitMat) => void): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export interface Stylize {
  rim?: number; // fresnel rim strength
  rimColor?: THREE.ColorRepresentation;
  /** soft "painted" terminator: lifts the dark side a bit with a tinted wrap light */
  wrap?: number;
}

/** Chain a shader patch onto a material (keeps earlier patches & cache keys). */
export function addPatch(mat: THREE.Material, key: string, patch: (shader: THREE.WebGLProgramParametersWithUniforms) => void): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    patch(shader);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + '|' + key;
}

export function stylize(mat: THREE.Material, s: Stylize): void {
  const rim = s.rim ?? 0.25;
  const rimColor = new THREE.Color(s.rimColor ?? 0xc8d8ff);
  const wrap = s.wrap ?? 0.18;
  addPatch(mat, 'sty', (shader) => {
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uWrap = { value: wrap };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float uRim;\nuniform vec3 uRimColor;\nuniform float uWrap;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 vdir = normalize(vViewPosition);
          float ndv = clamp(dot(normal, -vdir), 0.0, 1.0);
          float fres = pow(1.0 - ndv, 3.0);
          #if NUM_DIR_LIGHTS > 0
            vec3 L = directionalLights[0].direction;
            float ndl = dot(normal, L);
            // painted wrap light on the terminator (never in full shadow side)
            float wrapT = clamp((ndl + 0.35) / 1.35, 0.0, 1.0) * (1.0 - clamp(ndl, 0.0, 1.0));
            outgoingLight += diffuseColor.rgb * directionalLights[0].color * wrapT * uWrap * 0.25;
            // rim picks up the sun colour when back-lit, cool sky otherwise
            float back = clamp(-dot(vdir, L) * 0.5 + 0.5, 0.0, 1.0);
            outgoingLight += mix(uRimColor, directionalLights[0].color * 0.35, back) * fres * uRim * (0.4 + 0.6 * diffuseColor.rgb);
          #else
            outgoingLight += uRimColor * fres * uRim * 0.5;
          #endif
        }
        #include <opaque_fragment>`,
      );
  });
}

export interface PbrOpts {
  color?: THREE.ColorRepresentation;
  set?: PbrSet | null;
  /** UV repeat multiplier on the set */
  repeat?: number;
  roughness?: number; // multiplier on the ORM roughness when a set is used; absolute otherwise
  metalness?: number; // multiplier/absolute
  normalScale?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  envMapIntensity?: number;
  physical?: {
    clearcoat?: number;
    clearcoatRoughness?: number;
    sheen?: number;
    sheenColor?: THREE.ColorRepresentation;
    sheenRoughness?: number;
    iridescence?: number;
    anisotropy?: number;
    transmission?: number;
    ior?: number;
    thickness?: number;
  };
  flat?: boolean;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  vertexColors?: boolean;
  style?: Stylize | false;
  map?: THREE.Texture | null; // override albedo
  aoIntensity?: number;
}

const cache = new Map<string, LitMat>();

function cloneRepeat(t: THREE.Texture, r: number): THREE.Texture {
  if (r === 1) return t;
  const c = t.clone();
  c.repeat.set(r, r);
  c.needsUpdate = true;
  return c;
}

export function pbr(key: string, o: PbrOpts): LitMat {
  const hit = cache.get(key);
  if (hit) return hit;
  const params: THREE.MeshPhysicalMaterialParameters = {
    color: new THREE.Color(o.color ?? 0xffffff),
    roughness: o.roughness ?? (o.set ? 1 : 0.6),
    metalness: o.metalness ?? (o.set ? 1 : 0),
    emissive: new THREE.Color(o.emissive ?? 0x000000),
    emissiveIntensity: o.emissiveIntensity ?? 1,
    envMapIntensity: o.envMapIntensity ?? 1,
    flatShading: !!o.flat,
    side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    vertexColors: !!o.vertexColors,
  };
  if (o.set) {
    const r = o.repeat ?? 1;
    params.map = o.map ?? cloneRepeat(o.set.map, r);
    params.normalMap = cloneRepeat(o.set.normalMap, r);
    const orm = cloneRepeat(o.set.orm, r);
    params.roughnessMap = orm;
    params.metalnessMap = orm;
    params.aoMap = orm;
    params.aoMapIntensity = o.aoIntensity ?? 1;
    params.normalScale = new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1);
  } else if (o.map) params.map = o.map;
  let m: LitMat;
  if (o.physical) {
    const p = o.physical;
    const pm = new THREE.MeshPhysicalMaterial(params);
    if (p.clearcoat !== undefined) pm.clearcoat = p.clearcoat;
    if (p.clearcoatRoughness !== undefined) pm.clearcoatRoughness = p.clearcoatRoughness;
    if (p.sheen !== undefined) {
      pm.sheen = p.sheen;
      pm.sheenColor = new THREE.Color(p.sheenColor ?? 0xffffff);
      pm.sheenRoughness = p.sheenRoughness ?? 0.6;
    }
    if (p.iridescence !== undefined) pm.iridescence = p.iridescence;
    if (p.anisotropy !== undefined) pm.anisotropy = p.anisotropy;
    if (p.transmission !== undefined) {
      pm.transmission = p.transmission;
      pm.ior = p.ior ?? 1.5;
      pm.thickness = p.thickness ?? 0.1;
    }
    m = pm;
  } else {
    delete (params as Record<string, unknown>).clearcoat;
    m = new THREE.MeshStandardMaterial(params as THREE.MeshStandardMaterialParameters);
  }
  if (o.style !== false) stylize(m, o.style ?? {});
  cache.set(key, m);
  return registerLit(m);
}
