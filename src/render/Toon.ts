import * as THREE from 'three';
import { pbr } from './Materials';

/**
 * Shared cartoon material factory.
 * MeshToonMaterial + soft multi-step gradient + injected fresnel rim light.
 * Materials are cached so identical looks share one program and one material.
 */

let gradientTex: THREE.DataTexture | null = null;

export function toonGradient(): THREE.DataTexture {
  if (gradientTex) return gradientTex;
  const n = 64;
  const data = new Uint8Array(n * 4);
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1); // 0 = facing away, 0.5 = terminator, 1 = facing light
    // three soft bands: core shadow / mid tone / lit
    let v = 0.0;
    v += 0.42 * ss(0.47, 0.53, u);
    v += 0.58 * ss(0.64, 0.7, u);
    const c = Math.round(v * 255);
    data[i * 4] = c;
    data[i * 4 + 1] = c;
    data[i * 4 + 2] = c;
    data[i * 4 + 3] = 255;
  }
  gradientTex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  gradientTex.minFilter = THREE.LinearFilter;
  gradientTex.magFilter = THREE.LinearFilter;
  gradientTex.needsUpdate = true;
  return gradientTex;
}

export interface ToonOpts {
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  rim?: number; // rim strength
  rimColor?: THREE.ColorRepresentation;
  flat?: boolean;
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  map?: THREE.Texture | null;
  depthWrite?: boolean;
  /** metallic "spec" band highlight strength (fake cartoon specular) */
  spec?: number;
  fog?: boolean;
}

const cache = new Map<string, THREE.Material>();

export function injectRim(mat: THREE.Material, rim: number, rimColor: THREE.Color, spec: number): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uSpec = { value: spec };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float uRim;\nuniform vec3 uRimColor;\nuniform float uSpec;\nvoid main() {',
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 vdir = normalize(vViewPosition);
          float fres = 1.0 - clamp(dot(normal, -vdir), 0.0, 1.0);
          float rimT = smoothstep(0.55, 0.85, fres);
          outgoingLight += uRimColor * rimT * uRim * (0.35 + 0.65 * diffuseColor.rgb);
          #if NUM_DIR_LIGHTS > 0
          if (uSpec > 0.0) {
            vec3 L = directionalLights[0].direction;
            vec3 H = normalize(L - vdir);
            float s = smoothstep(0.93, 0.955, dot(normal, H));
            outgoingLight += directionalLights[0].color * s * uSpec * 0.35;
          }
          #endif
        }
        #include <opaque_fragment>`,
      );
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|rim' + (spec > 0 ? 's' : '');
}

/**
 * Legacy-named factory kept for call sites: now returns a stylised PBR material
 * (MeshStandardMaterial) — "spec" maps to glossier, slightly metallic surfaces.
 */
export function toonMat(color: THREE.ColorRepresentation, o: ToonOpts = {}): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  const key = [
    'toon',
    c.getHexString(),
    o.emissive !== undefined ? new THREE.Color(o.emissive).getHexString() : '-',
    o.emissiveIntensity ?? 1,
    o.rim ?? 0.35,
    o.rimColor !== undefined ? new THREE.Color(o.rimColor).getHexString() : '-',
    o.flat ? 1 : 0,
    o.vertexColors ? 1 : 0,
    o.transparent ? 1 : 0,
    o.opacity ?? 1,
    o.side ?? THREE.FrontSide,
    o.map ? o.map.uuid : '-',
    o.depthWrite ?? 1,
    o.spec ?? 0,
  ].join('|');
  const spec = o.spec ?? 0;
  const m = pbr(key, {
    color: c,
    roughness: Math.max(0.18, 0.72 - spec * 0.28),
    metalness: spec >= 0.8 ? 0.55 : spec > 0.3 ? 0.15 : 0.02,
    emissive: o.emissive,
    emissiveIntensity: o.emissiveIntensity,
    flat: o.flat,
    vertexColors: o.vertexColors,
    transparent: o.transparent,
    opacity: o.opacity,
    side: o.side,
    map: o.map ?? null,
    style: { rim: (o.rim ?? 0.35) * 0.8, rimColor: o.rimColor },
  }) as THREE.MeshStandardMaterial;
  if (o.depthWrite === false) m.depthWrite = false;
  return m;
}

/** Unlit glowing material for lights, screens, energy. Values > 1 bloom. */
export function glowMat(color: THREE.ColorRepresentation, intensity = 2.5, opts: { transparent?: boolean; opacity?: number; additive?: boolean; side?: THREE.Side; depthWrite?: boolean } = {}): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const key = 'glow|' + c.r.toFixed(3) + ',' + c.g.toFixed(3) + ',' + c.b.toFixed(3) + '|' + JSON.stringify(opts);
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshBasicMaterial;
  const m = new THREE.MeshBasicMaterial({
    color: c,
    transparent: !!opts.transparent || !!opts.additive,
    opacity: opts.opacity ?? 1,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? !opts.additive,
    toneMapped: false,
  });
  cache.set(key, m);
  return m;
}

/** Inverted-hull outline material (used for close-up meshes: characters, viewmodel). */
const outlineCache = new Map<string, THREE.ShaderMaterial>();
export function outlineMat(thickness = 0.02, color: THREE.ColorRepresentation = 0x141826): THREE.ShaderMaterial {
  const key = thickness + '|' + new THREE.Color(color).getHexString();
  const hit = outlineCache.get(key);
  if (hit) return hit;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uThickness: { value: thickness },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: /* glsl */ `
      uniform float uThickness;
      #include <common>
      #include <skinning_pars_vertex>
      void main() {
        vec3 transformed = position + normal * uThickness;
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }
    `,
    side: THREE.BackSide,
  });
  outlineCache.set(key, m);
  return m;
}
