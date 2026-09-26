import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const LAYER_NO_OUTLINE = 1; // objects on this layer are skipped by the normal pre-pass (particles, sky, glows)

export type Quality = 'low' | 'medium' | 'high';

/**
 * Scene pass: renders the scene with a depth texture (MSAA), a view-space normal pre-pass,
 * then composes cartoon ink outlines from depth + normal discontinuities.
 */
class ToonScenePass extends Pass {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  colorRT: THREE.WebGLRenderTarget;
  normalRT: THREE.WebGLRenderTarget;
  normalMat = new THREE.MeshNormalMaterial();
  quad: FullScreenQuad;
  useNormals = true;
  outlineMaterial: THREE.ShaderMaterial;
  private hidden: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number, samples: number) {
    super();
    this.scene = scene;
    this.camera = camera;
    camera.layers.enable(LAYER_NO_OUTLINE);
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    this.colorRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples,
      depthTexture,
      depthBuffer: true,
    });
    this.normalRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: true });
    this.outlineMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.colorRT.texture },
        tDepth: { value: depthTexture },
        tNormal: { value: this.normalRT.texture },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
        uThickness: { value: 1.0 },
        uUseNormals: { value: 1.0 },
        uInk: { value: new THREE.Color(0x0e1120) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform sampler2D tNormal;
        uniform float uNear;
        uniform float uFar;
        uniform vec2 uTexel;
        uniform float uThickness;
        uniform float uUseNormals;
        uniform vec3 uInk;
        varying vec2 vUv;

        float linDepth(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          float z = d * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
        }
        vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

        void main() {
          vec4 col = texture2D(tColor, vUv);
          vec2 o = uTexel * uThickness;
          float dc = linDepth(vUv);
          float d1 = linDepth(vUv + vec2(o.x, 0.0));
          float d2 = linDepth(vUv - vec2(o.x, 0.0));
          float d3 = linDepth(vUv + vec2(0.0, o.y));
          float d4 = linDepth(vUv - vec2(0.0, o.y));
          // second-derivative of depth: robust against smooth slopes, catches silhouettes
          float lap = abs(d1 + d2 - 2.0 * dc) + abs(d3 + d4 - 2.0 * dc);
          float depthEdge = smoothstep(0.012, 0.03, lap / max(dc, 0.001));
          // silhouettes against the sky
          float skyN = step(uFar * 0.9, max(max(d1, d2), max(d3, d4)));
          float skyC = step(uFar * 0.9, dc);
          depthEdge = max(depthEdge, abs(skyN - skyC) * (1.0 - skyC));

          float normalEdge = 0.0;
          if (uUseNormals > 0.5) {
            vec3 nc = nrm(vUv);
            vec3 n1 = nrm(vUv + vec2(o.x, 0.0));
            vec3 n2 = nrm(vUv - vec2(o.x, 0.0));
            vec3 n3 = nrm(vUv + vec2(0.0, o.y));
            vec3 n4 = nrm(vUv - vec2(0.0, o.y));
            float nd = (1.0 - dot(nc, n1)) + (1.0 - dot(nc, n2)) + (1.0 - dot(nc, n3)) + (1.0 - dot(nc, n4));
            normalEdge = smoothstep(0.35, 0.8, nd) * (1.0 - skyC);
          }
          float edge = max(depthEdge, normalEdge * 0.85);
          // fade ink with distance so far terrain doesn't turn into noise
          float fade = 1.0 - smoothstep(50.0, 300.0, dc);
          edge *= mix(0.12, 1.0, fade);
          if (dc > uFar * 0.9) edge *= 0.0;
          vec3 ink = uInk * (0.6 + 0.4 * col.rgb);
          gl_FragColor = vec4(mix(col.rgb, ink, clamp(edge, 0.0, 1.0) * 0.92), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.outlineMaterial);
  }

  setSize(w: number, h: number): void {
    this.colorRT.setSize(w, h);
    this.normalRT.setSize(w, h);
    (this.outlineMaterial.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    this.outlineMaterial.uniforms.uThickness.value = Math.max(1, Math.round(h / 900));
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget): void {
    const cam = this.camera;
    this.outlineMaterial.uniforms.uNear.value = cam.near;
    this.outlineMaterial.uniforms.uFar.value = cam.far;
    this.outlineMaterial.uniforms.uUseNormals.value = this.useNormals ? 1 : 0;

    renderer.setRenderTarget(this.colorRT);
    renderer.clear();
    renderer.render(this.scene, cam);

    if (this.useNormals) {
      const bg = this.scene.background;
      const prevMask = cam.layers.mask;
      cam.layers.disable(LAYER_NO_OUTLINE);
      cam.layers.enable(0);
      this.scene.background = null;
      this.scene.overrideMaterial = this.normalMat;
      renderer.setRenderTarget(this.normalRT);
      renderer.setClearColor(0x8080ff, 1);
      renderer.clear();
      renderer.render(this.scene, cam);
      renderer.setClearColor(0x000000, 1);
      this.scene.overrideMaterial = null;
      this.scene.background = bg;
      cam.layers.mask = prevMask;
    }

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.colorRT.dispose();
    this.normalRT.dispose();
    this.quad.dispose();
  }
}

/** Renders an overlay scene (first-person weapon) on top of the current buffer after clearing depth. */
class OverlayPass extends Pass {
  scene: THREE.Scene;
  camera: THREE.Camera;
  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
  }
  render(renderer: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (!this.scene.visible || this.scene.children.length === 0) return;
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

/** Final grade: saturation, vignette, tint, flash, chromatic aberration for damage & suffocation feedback. */
class GradePass extends Pass {
  quad: FullScreenQuad;
  mat: THREE.ShaderMaterial;
  constructor() {
    super();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uSat: { value: 1.08 },
        uVignette: { value: 0.35 },
        uTint: { value: new THREE.Color(0, 0, 0) },
        uTintAmt: { value: 0 },
        uFlash: { value: 0 },
        uAberr: { value: 0 },
        uTime: { value: 0 },
        uBlur: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0);} `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uSat, uVignette, uTintAmt, uFlash, uAberr, uTime, uBlur;
        uniform vec3 uTint;
        varying vec2 vUv;
        void main(){
          vec2 c = vUv - 0.5;
          float r2 = dot(c, c);
          vec2 off = c * uAberr * 0.04;
          vec3 col;
          col.r = texture2D(tDiffuse, vUv + off).r;
          col.g = texture2D(tDiffuse, vUv).g;
          col.b = texture2D(tDiffuse, vUv - off).b;
          if (uBlur > 0.0) {
            vec3 acc = col;
            float k = uBlur * 0.006;
            acc += texture2D(tDiffuse, vUv + vec2(k, 0.0)).rgb;
            acc += texture2D(tDiffuse, vUv - vec2(k, 0.0)).rgb;
            acc += texture2D(tDiffuse, vUv + vec2(0.0, k)).rgb;
            acc += texture2D(tDiffuse, vUv - vec2(0.0, k)).rgb;
            col = mix(col, acc / 5.0, smoothstep(0.02, 0.2, r2));
          }
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, uSat);
          col *= 1.0 - uVignette * smoothstep(0.08, 0.55, r2);
          col = mix(col, uTint * (0.4 + l), uTintAmt * smoothstep(0.0, 0.45, r2 + 0.1));
          col = mix(col, vec3(1.0, 0.98, 0.92) * 4.0, uFlash);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.mat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

export class Pipeline {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  scenePass: ToonScenePass;
  overlayPass: OverlayPass;
  bloom: UnrealBloomPass;
  grade: GradePass;
  quality: Quality;
  renderScale = 1;

  constructor(
    canvas: HTMLCanvasElement,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    overlayScene: THREE.Scene,
    overlayCamera: THREE.Camera,
    quality: Quality,
  ) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderScale = quality === 'low' ? 0.75 : 1;
    const { w, h } = this.size();
    this.renderer.setPixelRatio(1);
    this.renderer.setDrawingBufferSize(w, h, 1);

    const samples = quality === 'high' ? 4 : quality === 'medium' ? 2 : 0;
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }));
    this.composer.setPixelRatio(1);
    this.scenePass = new ToonScenePass(scene, camera, w, h, samples);
    this.scenePass.useNormals = quality !== 'low';
    this.composer.addPass(this.scenePass);
    this.overlayPass = new OverlayPass(overlayScene, overlayCamera);
    this.composer.addPass(this.overlayPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.55, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.grade = new GradePass();
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  size(): { w: number; h: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.5 : 1);
    return {
      w: Math.max(2, Math.floor(window.innerWidth * dpr * this.renderScale)),
      h: Math.max(2, Math.floor(window.innerHeight * dpr * this.renderScale)),
    };
  }

  resize(): void {
    const { w, h } = this.size();
    this.renderer.setDrawingBufferSize(w, h, 1);
    this.composer.setSize(w, h); // forwards to every pass (scene pass, bloom, ...)
  }

  get gradeUniforms(): Record<string, THREE.IUniform> {
    return this.grade.mat.uniforms;
  }

  render(dt: number): void {
    this.grade.mat.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
