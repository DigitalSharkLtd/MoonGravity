import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import type { Quality } from '../game/Types';

export const LAYER_NO_OUTLINE = 1; // particles, sky, glows: rendered, but no ink outline wanted

export interface PipelineOptions {
  quality: Quality;
  renderScale: number;
  ao: boolean;
  bloom: boolean;
  outlines: boolean;
  filmGrain: boolean;
  /** heavy: SMAA post anti-aliasing (defaults to on except 'low') */
  antialias?: boolean;
  /** medium: sun lens flare & glare */
  lensFlare?: boolean;
}

/** Renders the scene into a HDR target with a depth texture (shared by AO and outlines). */
class ScenePass extends Pass {
  rt: THREE.WebGLRenderTarget;
  constructor(public scene: THREE.Scene, public camera: THREE.PerspectiveCamera, w: number, h: number) {
    super();
    this.needsSwap = false;
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, depthTexture });
    this.rt.texture.minFilter = THREE.LinearFilter;
  }
  setSize(w: number, h: number): void {
    this.rt.setSize(w, h);
  }
  render(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }
}

/** Copies the scene target into the composer chain when AO is disabled. */
class CopyPass extends Pass {
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  constructor(private src: THREE.WebGLRenderTarget) {
    super();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { t: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget): void {
    this.mat.uniforms.t.value = this.src.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

/** Stylised ink lines from depth discontinuities (optional "cartoon" look). */
class OutlinePass extends Pass {
  private quad: FullScreenQuad;
  mat: THREE.ShaderMaterial;
  constructor(depth: THREE.DepthTexture, private camera: THREE.PerspectiveCamera) {
    super();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: depth },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uThickness: { value: 1 },
        uStrength: { value: 0.7 },
        uInk: { value: new THREE.Color(0x0b0e1a) },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform float uNear, uFar, uThickness, uStrength; uniform vec2 uTexel; uniform vec3 uInk;
        varying vec2 vUv;
        float lin(vec2 uv) { float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
        void main() {
          vec4 col = texture2D(tColor, vUv);
          vec2 o = uTexel * uThickness;
          float c = lin(vUv);
          float l = lin(vUv - vec2(o.x, 0.0)), r = lin(vUv + vec2(o.x, 0.0));
          float d = lin(vUv - vec2(0.0, o.y)), u = lin(vUv + vec2(0.0, o.y));
          float lap = abs(l + r - 2.0 * c) + abs(u + d - 2.0 * c);
          float edge = smoothstep(0.015, 0.045, lap / max(c, 0.001));
          float skyN = step(uFar * 0.9, max(max(l, r), max(u, d)));
          float skyC = step(uFar * 0.9, c);
          edge = max(edge, abs(skyN - skyC) * (1.0 - skyC) * 0.6);
          edge *= mix(0.1, 1.0, 1.0 - smoothstep(40.0, 260.0, c));
          if (c > uFar * 0.9) edge = 0.0;
          gl_FragColor = vec4(mix(col.rgb, uInk * (0.5 + 0.5 * col.rgb), clamp(edge, 0.0, 1.0) * uStrength), col.a);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w: number, h: number): void {
    (this.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    this.mat.uniforms.uThickness.value = Math.max(1, Math.round(h / 1000));
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.mat.uniforms.tColor.value = readBuffer.texture;
    this.mat.uniforms.uNear.value = this.camera.near;
    this.mat.uniforms.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

/** First-person weapon/hands drawn on top of the frame (own depth). */
class OverlayPass extends Pass {
  constructor(public scene: THREE.Scene, public camera: THREE.Camera) {
    super();
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

/**
 * Cinematic grade: lens flare from the sun, saturation/contrast, split-toning, vignette,
 * damage/suffocation feedback (tint, blur, chromatic aberration), nuke flash, film grain.
 */
class GradePass extends Pass {
  quad: FullScreenQuad;
  mat: THREE.ShaderMaterial;
  constructor() {
    super();
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uSat: { value: 1.12 },
        uContrast: { value: 1.06 },
        uVignette: { value: 0.32 },
        uTint: { value: new THREE.Color(0, 0, 0) },
        uTintAmt: { value: 0 },
        uFlash: { value: 0 },
        uAberr: { value: 0 },
        uTime: { value: 0 },
        uBlur: { value: 0 },
        uGrain: { value: 0.035 },
        uAspect: { value: 1.7 },
        uSunPos: { value: new THREE.Vector2(-10, -10) },
        uSunVis: { value: 0 },
        uDesat: { value: 0 },
        uMotion: { value: new THREE.Vector2() },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uSat, uContrast, uVignette, uTintAmt, uFlash, uAberr, uTime, uBlur, uGrain, uAspect, uSunVis, uDesat;
        uniform vec3 uTint; uniform vec2 uSunPos; uniform vec2 uMotion;
        varying vec2 vUv;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 flare(vec2 uv) {
          if (uSunVis <= 0.001) return vec3(0.0);
          vec2 s = uSunPos;
          vec2 dir = vec2(0.5) - s;
          vec3 acc = vec3(0.0);
          for (int i = 1; i <= 5; i++) {
            float fi = float(i);
            vec2 gp = s + dir * (0.35 * fi);
            vec2 d = (uv - gp) * vec2(uAspect, 1.0);
            float r = 0.02 + 0.018 * fi;
            float g = smoothstep(r, r * 0.6, length(d)) * 0.06;
            vec3 tint = fi == 2.0 ? vec3(0.4, 0.7, 1.0) : fi == 4.0 ? vec3(1.0, 0.6, 0.3) : vec3(0.7, 1.0, 0.8);
            acc += tint * g;
          }
          vec2 hd = (uv - (s + dir * 2.0)) * vec2(uAspect, 1.0);
          float ring = smoothstep(0.03, 0.0, abs(length(hd) - 0.28)) * 0.05;
          acc += vec3(0.6, 0.8, 1.0) * ring;
          vec2 sd = (uv - s) * vec2(uAspect, 1.0);
          float streak = exp(-abs(sd.y) * 220.0) * exp(-abs(sd.x) * 2.2) * 0.35;
          acc += vec3(0.55, 0.75, 1.0) * streak;
          float glow = exp(-length(sd) * 7.0) * 0.25;
          acc += vec3(1.0, 0.9, 0.75) * glow;
          return acc * uSunVis;
        }
        void main(){
          vec2 c = vUv - 0.5;
          float r2 = dot(c, c);
          vec2 off = c * uAberr * 0.03;
          vec3 col;
          col.r = texture2D(tDiffuse, vUv + off).r;
          col.g = texture2D(tDiffuse, vUv).g;
          col.b = texture2D(tDiffuse, vUv - off).b;
          // camera-rotation motion blur (medium setting): 7 taps along the screen-space velocity
          if (dot(uMotion, uMotion) > 2.5e-7) {
            vec3 mb = col;
            for (int i = 1; i <= 3; i++) {
              float t = float(i) / 3.0;
              mb += texture2D(tDiffuse, vUv + uMotion * t).rgb;
              mb += texture2D(tDiffuse, vUv - uMotion * t).rgb;
            }
            col = mb / 7.0;
          }
          if (uBlur > 0.0) {
            vec3 acc = col;
            float k = uBlur * 0.008;
            acc += texture2D(tDiffuse, vUv + vec2(k, k)).rgb;
            acc += texture2D(tDiffuse, vUv - vec2(k, k)).rgb;
            acc += texture2D(tDiffuse, vUv + vec2(-k, k)).rgb;
            acc += texture2D(tDiffuse, vUv + vec2(k, -k)).rgb;
            col = mix(col, acc / 5.0, smoothstep(0.01, 0.16, r2));
          }
          col += flare(vUv);
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, uSat * (1.0 - uDesat));
          col = pow(max(col, 0.0), vec3(uContrast));
          col *= mix(vec3(0.93, 0.97, 1.08), vec3(1.05, 1.0, 0.94), smoothstep(0.05, 0.8, l));
          col *= 1.0 - uVignette * smoothstep(0.1, 0.62, r2);
          col = mix(col, uTint * (0.35 + l), uTintAmt * smoothstep(0.0, 0.5, r2 + 0.12));
          col = mix(col, vec3(1.0, 0.98, 0.92) * 6.0, uFlash);
          float gr = h21(vUv * 1000.0 + fract(uTime * 13.7) * 100.0) - 0.5;
          col += gr * uGrain * (0.25 + l * 0.6);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w: number, h: number): void {
    this.mat.uniforms.uAspect.value = w / h;
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.mat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

export class Pipeline {
  renderer: THREE.WebGLRenderer;
  composer!: EffectComposer;
  scenePass!: ScenePass;
  ao: N8AOPass | null = null;
  outline!: OutlinePass;
  overlayPass!: OverlayPass;
  bloom!: UnrealBloomPass;
  grade!: GradePass;
  smaa: SMAAPass | null = null;
  opts: PipelineOptions;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  overlayScene: THREE.Scene;
  overlayCamera: THREE.Camera;

  constructor(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera, overlayScene: THREE.Scene, overlayCamera: THREE.Camera, opts: PipelineOptions) {
    this.opts = { ...opts };
    this.scene = scene;
    this.camera = camera;
    this.overlayScene = overlayScene;
    this.overlayCamera = overlayCamera;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(1);
    camera.layers.enable(LAYER_NO_OUTLINE);
    this.build();
  }

  /** Point the passes at another scene/camera (menu backdrop ↔ match). */
  setScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
    camera.layers.enable(LAYER_NO_OUTLINE);
    this.build();
  }

  /** (Re)build the pass chain for the current options. */
  build(): void {
    const { w, h } = this.size();
    this.renderer.setDrawingBufferSize(w, h, 1);
    if (this.composer) {
      this.composer.dispose();
      this.scenePass?.rt.dispose();
    }
    const o = this.opts;
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }));
    this.composer.setPixelRatio(1);
    this.scenePass = new ScenePass(this.scene, this.camera, w, h);
    this.composer.addPass(this.scenePass);
    if (o.ao && o.quality !== 'low') {
      const ao = new N8AOPass(this.scene, this.camera, w, h);
      ao.beautyRenderTarget = this.scenePass.rt;
      ao.configuration.autoRenderBeauty = false;
      ao.configuration.gammaCorrection = false;
      ao.configuration.aoRadius = 2.2;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.6;
      ao.configuration.color = new THREE.Color(0x05060f);
      ao.configuration.halfRes = o.quality !== 'ultra';
      ao.configuration.transparencyAware = false;
      (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
      ao.setQualityMode(o.quality === 'ultra' ? 'High' : o.quality === 'high' ? 'Medium' : 'Performance');
      this.ao = ao;
      this.composer.addPass(ao);
    } else {
      this.ao = null;
      this.composer.addPass(new CopyPass(this.scenePass.rt));
    }
    this.outline = new OutlinePass(this.scenePass.rt.depthTexture as THREE.DepthTexture, this.camera);
    this.outline.enabled = o.outlines;
    this.composer.addPass(this.outline);
    this.overlayPass = new OverlayPass(this.overlayScene, this.overlayCamera);
    this.composer.addPass(this.overlayPass);
    // threshold above sunlit white (lum ~0.9–1.1 in HDR): only emissives, flashes and ore bloom, so
    // bright structures stay crisp instead of hazing over (the high pass keeps the full texel value)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.58, 0.5, 1.15);
    this.bloom.enabled = o.bloom;
    this.composer.addPass(this.bloom);
    this.grade = new GradePass();
    this.grade.mat.uniforms.uGrain.value = o.filmGrain ? 0.035 : 0;
    this.composer.addPass(this.grade);
    if (o.antialias ?? o.quality !== 'low') {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    } else this.smaa = null;
    this.flareScale = o.lensFlare === false ? 0 : 1;
    this.composer.addPass(new OutputPass());
    this.composer.setSize(w, h);
  }

  setOptions(next: Partial<PipelineOptions>): void {
    const prev = this.opts;
    this.opts = { ...prev, ...next };
    const rebuild = prev.quality !== this.opts.quality || prev.ao !== this.opts.ao || prev.renderScale !== this.opts.renderScale || prev.antialias !== this.opts.antialias;
    if (rebuild) this.build();
    else {
      this.outline.enabled = this.opts.outlines;
      this.bloom.enabled = this.opts.bloom;
      this.grade.mat.uniforms.uGrain.value = this.opts.filmGrain ? 0.035 : 0;
      this.flareScale = this.opts.lensFlare === false ? 0 : 1;
    }
  }

  /** 0 disables the sun flare (multiplies uSunVis set by the game each frame) */
  flareScale = 1;

  size(): { w: number; h: number } {
    const dprCap = this.opts.quality === 'ultra' ? 2 : this.opts.quality === 'high' ? 1.5 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const s = this.opts.renderScale * (this.opts.quality === 'low' ? 0.8 : 1);
    return {
      w: Math.max(2, Math.floor(window.innerWidth * dpr * s)),
      h: Math.max(2, Math.floor(window.innerHeight * dpr * s)),
    };
  }

  resize(): void {
    const { w, h } = this.size();
    this.renderer.setDrawingBufferSize(w, h, 1);
    this.composer.setSize(w, h);
  }

  get gradeUniforms(): Record<string, THREE.IUniform> {
    return this.grade.mat.uniforms;
  }

  /** per-frame totals across every pass (renderer.info is reset once per frame, not per pass) */
  stats = { calls: 0, triangles: 0, ms: 0 };

  render(dt: number): void {
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    const t0 = performance.now();
    this.grade.mat.uniforms.uTime.value += dt;
    this.composer.render(dt);
    this.stats.calls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.ms = performance.now() - t0;
  }
}
