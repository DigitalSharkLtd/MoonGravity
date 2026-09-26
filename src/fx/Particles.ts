import * as THREE from 'three';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';
import { MOON_G } from '../core/Physics';

/**
 * CPU-simulated, GPU-drawn particle system (instanced camera-facing quads).
 * Lunar vacuum physics: no drag by default — dust flies in long ballistic arcs under 1.62 m/s².
 * Sprites: 0 soft dot, 1 smoke/dust puff, 2 spark (stretched along velocity), 3 ring, 4 flare star.
 */
export interface ParticleSpec {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life: number;
  size0: number;
  size1?: number;
  color0: THREE.Color | number;
  color1?: THREE.Color | number;
  alpha0?: number;
  alpha1?: number;
  gravity?: number; // multiplier of lunar g
  drag?: number; // 1/s
  sprite?: 0 | 1 | 2 | 3 | 4;
  stretch?: number; // for sparks: length per m/s
  spin?: number;
  collide?: boolean; // stop at terrain
}

const _c0 = new THREE.Color();
const _c1 = new THREE.Color();

function atlas(): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S * 5;
  cv.height = S;
  const c = cv.getContext('2d')!;
  // 0 soft dot
  let g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  // 1 puff: several blobs
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const x = S + S / 2 + (rnd() - 0.5) * S * 0.45;
    const y = S / 2 + (rnd() - 0.5) * S * 0.45;
    const r = S * (0.15 + rnd() * 0.22);
    g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(S, 0, S, S);
  }
  // 2 spark: horizontal streak
  g = c.createLinearGradient(S * 2, 0, S * 3, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(S * 2, S * 0.42, S, S * 0.16);
  // 3 ring
  c.strokeStyle = 'rgba(255,255,255,1)';
  c.lineWidth = S * 0.06;
  c.beginPath();
  c.arc(S * 3.5, S / 2, S * 0.42, 0, Math.PI * 2);
  c.stroke();
  g = c.createRadialGradient(S * 3.5, S / 2, S * 0.3, S * 3.5, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(S * 3, 0, S, S);
  // 4 flare star
  c.save();
  c.translate(S * 4.5, S / 2);
  for (let k = 0; k < 2; k++) {
    g = c.createLinearGradient(-S / 2, 0, S / 2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(-S / 2, -S * 0.03, S, S * 0.06);
    c.rotate(Math.PI / 2);
  }
  c.restore();
  g = c.createRadialGradient(S * 4.5, S / 2, 0, S * 4.5, S / 2, S * 0.25);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(S * 4, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let sharedAtlas: THREE.CanvasTexture | null = null;

export class ParticleSystem {
  readonly max: number;
  mesh: THREE.Mesh;
  private count = 0;
  // simulation arrays
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array; // size0,size1
  private col: Float32Array; // r0,g0,b0,r1,g1,b1
  private alpha: Float32Array; // a0,a1
  private phys: Float32Array; // gravity, drag, stretch, spin
  private sprite: Uint8Array;
  private collide: Uint8Array;
  // gpu attributes
  private aOffset: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aParams: THREE.InstancedBufferAttribute; // size, sprite, stretch, rotation
  private aVel: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  ground: ((x: number, z: number) => number) | null = null;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max * 2);
    this.col = new Float32Array(max * 6);
    this.alpha = new Float32Array(max * 2);
    this.phys = new Float32Array(max * 4);
    this.sprite = new Uint8Array(max);
    this.collide = new Uint8Array(max);
    this.spinSpeed = new Float32Array(max);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const a of [this.aOffset, this.aColor, this.aParams, this.aVel]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aOffset', this.aOffset);
    this.geo.setAttribute('aColor', this.aColor);
    this.geo.setAttribute('aParams', this.aParams);
    this.geo.setAttribute('aVel', this.aVel);
    this.geo.instanceCount = 0;
    sharedAtlas ??= atlas();
    const mat = new THREE.ShaderMaterial({
      uniforms: { tAtlas: { value: sharedAtlas } },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset; attribute vec4 aColor; attribute vec4 aParams; attribute vec3 aVel;
        varying vec2 vUv; varying vec4 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
          float size = aParams.x;
          float sprite = aParams.y;
          float stretch = aParams.z;
          float rot = aParams.w;
          vec2 p = position.xy;
          vec2 q;
          if (stretch > 0.0) {
            vec3 vv = (modelViewMatrix * vec4(aVel, 0.0)).xyz;
            vec2 d = vv.xy;
            float l = length(d);
            vec2 ax = l > 1e-4 ? d / l : vec2(1.0, 0.0);
            vec2 ay = vec2(-ax.y, ax.x);
            float len = size + l * stretch;
            q = ax * p.x * len + ay * p.y * size * 0.35;
          } else {
            float c = cos(rot), s = sin(rot);
            q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * size;
          }
          mv.xy += q;
          gl_Position = projectionMatrix * mv;
          vUv = vec2((uv.x + sprite) / 5.0, uv.y);
          vColor = aColor;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tAtlas; varying vec2 vUv; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(tAtlas, vUv);
          float a = t.a * vColor.a;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor.rgb * t.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER_NO_OUTLINE);
    this.mesh.renderOrder = additive ? 10 : 9;
  }

  spawn(s: ParticleSpec): void {
    let i: number;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max); // overwrite a random one when saturated
    this.pos[i * 3] = s.pos.x;
    this.pos[i * 3 + 1] = s.pos.y;
    this.pos[i * 3 + 2] = s.pos.z;
    this.vel[i * 3] = s.vel?.x ?? 0;
    this.vel[i * 3 + 1] = s.vel?.y ?? 0;
    this.vel[i * 3 + 2] = s.vel?.z ?? 0;
    this.life[i] = s.life;
    this.maxLife[i] = s.life;
    this.size[i * 2] = s.size0;
    this.size[i * 2 + 1] = s.size1 ?? s.size0;
    typeof s.color0 === 'number' ? _c0.setHex(s.color0) : _c0.copy(s.color0);
    s.color1 === undefined ? _c1.copy(_c0) : typeof s.color1 === 'number' ? _c1.setHex(s.color1) : _c1.copy(s.color1);
    this.col[i * 6] = _c0.r;
    this.col[i * 6 + 1] = _c0.g;
    this.col[i * 6 + 2] = _c0.b;
    this.col[i * 6 + 3] = _c1.r;
    this.col[i * 6 + 4] = _c1.g;
    this.col[i * 6 + 5] = _c1.b;
    this.alpha[i * 2] = s.alpha0 ?? 1;
    this.alpha[i * 2 + 1] = s.alpha1 ?? 0;
    this.phys[i * 4] = s.gravity ?? 0;
    this.phys[i * 4 + 1] = s.drag ?? 0;
    this.phys[i * 4 + 2] = s.stretch ?? 0;
    this.phys[i * 4 + 3] = (s.spin ?? 0) === 0 ? Math.random() * 6.28 : 0;
    this.sprite[i] = s.sprite ?? 0;
    this.collide[i] = s.collide ? 1 : 0;
    // encode spin speed sign in the upper bits of rotation (stored separately below)
    this.spinSpeed[i] = s.spin ?? 0;
  }
  private spinSpeed: Float32Array;

  update(dt: number): void {
    const P = this.pos;
    const Vv = this.vel;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        if (i !== n) this.copy(n, i);
        i--;
        continue;
      }
      const g = this.phys[i * 4] * MOON_G;
      const drag = this.phys[i * 4 + 1];
      if (drag > 0) {
        const k = Math.max(0, 1 - drag * dt);
        Vv[i * 3] *= k;
        Vv[i * 3 + 1] *= k;
        Vv[i * 3 + 2] *= k;
      }
      Vv[i * 3 + 1] -= g * dt;
      P[i * 3] += Vv[i * 3] * dt;
      P[i * 3 + 1] += Vv[i * 3 + 1] * dt;
      P[i * 3 + 2] += Vv[i * 3 + 2] * dt;
      this.phys[i * 4 + 3] += this.spinSpeed[i] * dt;
      if (this.collide[i] && this.ground) {
        const h = this.ground(P[i * 3], P[i * 3 + 2]);
        if (P[i * 3 + 1] < h) {
          P[i * 3 + 1] = h;
          Vv[i * 3] *= 0.3;
          Vv[i * 3 + 2] *= 0.3;
          Vv[i * 3 + 1] = Math.abs(Vv[i * 3 + 1]) * 0.15;
          // settled dust fades quickly
          this.life[i] = Math.min(this.life[i], 0.6);
        }
      }
    }
    this.count = n;
    // write gpu buffers
    const off = this.aOffset.array as Float32Array;
    const col = this.aColor.array as Float32Array;
    const par = this.aParams.array as Float32Array;
    const vel = this.aVel.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const t = 1 - this.life[i] / this.maxLife[i];
      off[i * 3] = P[i * 3];
      off[i * 3 + 1] = P[i * 3 + 1];
      off[i * 3 + 2] = P[i * 3 + 2];
      vel[i * 3] = Vv[i * 3];
      vel[i * 3 + 1] = Vv[i * 3 + 1];
      vel[i * 3 + 2] = Vv[i * 3 + 2];
      col[i * 4] = this.col[i * 6] + (this.col[i * 6 + 3] - this.col[i * 6]) * t;
      col[i * 4 + 1] = this.col[i * 6 + 1] + (this.col[i * 6 + 4] - this.col[i * 6 + 1]) * t;
      col[i * 4 + 2] = this.col[i * 6 + 2] + (this.col[i * 6 + 5] - this.col[i * 6 + 2]) * t;
      // ease-in for the first 8% of life, then linear towards alpha1
      const fadeIn = Math.min(1, t / 0.08);
      col[i * 4 + 3] = (this.alpha[i * 2] + (this.alpha[i * 2 + 1] - this.alpha[i * 2]) * t) * fadeIn;
      par[i * 4] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * t;
      par[i * 4 + 1] = this.sprite[i];
      par[i * 4 + 2] = this.phys[i * 4 + 2];
      par[i * 4 + 3] = this.phys[i * 4 + 3];
    }
    this.geo.instanceCount = n;
    if (n > 0) {
      for (const a of [this.aOffset, this.aColor, this.aParams, this.aVel]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  private copy(from: number, to: number): void {
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size[to * 2] = this.size[from * 2];
    this.size[to * 2 + 1] = this.size[from * 2 + 1];
    for (let k = 0; k < 6; k++) this.col[to * 6 + k] = this.col[from * 6 + k];
    this.alpha[to * 2] = this.alpha[from * 2];
    this.alpha[to * 2 + 1] = this.alpha[from * 2 + 1];
    for (let k = 0; k < 4; k++) this.phys[to * 4 + k] = this.phys[from * 4 + k];
    this.sprite[to] = this.sprite[from];
    this.collide[to] = this.collide[from];
    this.spinSpeed[to] = this.spinSpeed[from];
  }

  clear(): void {
    this.count = 0;
    this.geo.instanceCount = 0;
  }
}
