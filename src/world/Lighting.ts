import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import * as CSMShaderModule from 'three/examples/jsm/csm/CSMShader.js';
const CSMShader = (CSMShaderModule as unknown as { CSMShader: { lights_fragment_begin: string } }).CSMShader;
import { allLit, onLitMaterial } from '../render/Materials';
import type { Quality } from '../game/Types';

export type ShadowMode = 'off' | 'low' | 'high';

/**
 * three's CSM ships a copy of `lights_fragment_begin` that lags behind the core chunk
 * (iridescence + multi-scatter changes). Splice CSM's directional-light cascade logic into the
 * current core chunk instead, once, before any CSM instance injects it.
 */
const ORIGINAL_LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin;
(function fixCsmChunk() {
  const cur = ORIGINAL_LIGHTS_BEGIN;
  const csm = (CSMShader as { lights_fragment_begin: string }).lights_fragment_begin;
  const dirTag = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  const rectTag = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';
  const a = cur.indexOf(dirTag);
  const b = cur.indexOf(rectTag);
  const c = csm.indexOf(dirTag);
  const d = csm.indexOf(rectTag);
  if (a < 0 || b < 0 || c < 0 || d < 0) return; // layout changed: keep three's version
  (CSMShader as { lights_fragment_begin: string }).lights_fragment_begin = cur.slice(0, a) + csm.slice(c, d) + cur.slice(b);
})();

/**
 * Harsh low-angle sun with cascaded shadow maps, earthshine/regolith-bounce fill and
 * an image-based environment (black sky, bright sunlit regolith below, sun disc, Earth).
 */
export class Lighting {
  csm: CSM | null = null;
  sun: THREE.DirectionalLight | null = null;
  hemi: THREE.HemisphereLight;
  sunDir: THREE.Vector3;
  envMap: THREE.Texture;
  private unsub: (() => void) | null = null;
  private scene: THREE.Scene;
  readonly sunColor = new THREE.Color(0xfff0dc);
  readonly sunIntensity = 4.2;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3, earthDir: THREE.Vector3, quality: Quality, shadows: ShadowMode) {
    this.scene = scene;
    this.sunDir = sunDir.clone().normalize();
    if (shadows === 'off') {
      this.sun = new THREE.DirectionalLight(this.sunColor, this.sunIntensity);
      this.sun.position.copy(this.sunDir).multiplyScalar(100);
      scene.add(this.sun, this.sun.target);
    } else {
      const size = shadows === 'low' ? 1024 : quality === 'ultra' ? 4096 : 2048;
      this.csm = new CSM({
        camera,
        parent: scene,
        cascades: shadows === 'low' ? 2 : quality === 'ultra' ? 4 : 3,
        maxFar: shadows === 'low' ? 160 : quality === 'ultra' ? 520 : 380,
        mode: 'practical',
        shadowMapSize: size,
        lightDirection: this.sunDir.clone().negate(),
        lightIntensity: this.sunIntensity,
        lightNear: 1,
        lightFar: 2000,
        lightMargin: 220,
        shadowBias: -0.00025,
      });
      this.csm.fade = true;
      for (const l of this.csm.lights) {
        l.color.copy(this.sunColor);
        l.shadow.normalBias = 0.035;
        l.shadow.radius = 1.5;
        l.shadow.camera.layers.enable(5); // LAYER_SHADOW_ONLY: first-person body still casts a shadow
      }
      for (const m of allLit()) this.setupMaterial(m);
      this.unsub = onLitMaterial((m) => this.setupMaterial(m));
    }
    // earthshine (cool, from above) + regolith bounce (warm, from below): lifts shadows to a painted blue-grey
    this.hemi = new THREE.HemisphereLight(0x6f82c8, 0x7b6a58, 0.32);
    scene.add(this.hemi);
    this.envMap = buildEnvironment(renderer, this.sunDir, earthDir);
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.55;
  }

  private setupMaterial(m: THREE.Material): void {
    if (!this.csm || (m as THREE.Material & { userData: { csm?: boolean } }).userData.csm) return;
    const mine = (m.userData.baseOBC as typeof m.onBeforeCompile | undefined) ?? m.onBeforeCompile;
    m.userData.baseOBC = mine;
    this.csm.setupMaterial(m);
    const theirs = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      theirs.call(m, shader, renderer);
      mine.call(m, shader, renderer);
    };
    m.userData.csm = true;
    m.needsUpdate = true;
  }

  update(): void {
    if (!this.csm) return;
    // CSM reads camera.matrixWorld, which three only refreshes inside render(): update it first
    this.csm.camera.updateMatrixWorld();
    this.csm.update();
  }

  dispose(): void {
    this.unsub?.();
    if (this.csm) {
      this.csm.remove();
      this.csm.dispose();
      for (const m of allLit()) {
        // materials will be re-setup by the next Lighting instance
        m.userData.csm = false;
      }
    }
    if (this.sun) this.scene.remove(this.sun, this.sun.target);
    this.scene.remove(this.hemi);
    this.envMap.dispose();
  }
}

/** Prefiltered environment: sky, sunlit ground, sun disc, Earth. */
function buildEnvironment(renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3, earthDir: THREE.Vector3): THREE.Texture {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uSun: { value: sunDir }, uEarth: { value: earthDir.clone().normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform vec3 uEarth; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sky = mix(vec3(0.03, 0.035, 0.07), vec3(0.008, 0.01, 0.025), smoothstep(0.0, 0.6, h));
        // sunlit regolith below, brighter toward the sun azimuth (backscatter)
        float toward = dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(-uSun.x, 0.0, -uSun.z))) * 0.5 + 0.5;
        vec3 ground = vec3(0.42, 0.40, 0.37) * (0.55 + 0.45 * toward);
        vec3 c = mix(ground, sky, smoothstep(-0.06, 0.03, h));
        float s = dot(d, normalize(uSun));
        c += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9998, s) * 400.0;
        c += vec3(1.0, 0.9, 0.75) * pow(max(s, 0.0), 40.0) * 0.6;
        float e = dot(d, uEarth);
        c += vec3(0.35, 0.55, 1.0) * smoothstep(0.997, 0.999, e) * 2.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0, 0.1, 100);
  pm.dispose();
  mat.dispose();
  return rt.texture;
}
