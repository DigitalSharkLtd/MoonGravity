import * as THREE from 'three';
import { ParticleSystem } from './Particles';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';
import type { World } from '../world/World';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
function randDir(out: THREE.Vector3): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(t), u, r * Math.sin(t));
}
/** random direction in a cone around n */
function coneDir(n: THREE.Vector3, spread: number, out: THREE.Vector3): THREE.Vector3 {
  randDir(out).multiplyScalar(spread).add(n);
  return out.normalize();
}

interface Beam {
  a: THREE.Vector3;
  b: THREE.Vector3;
  color: THREE.Color;
  width: number;
  life: number;
  max: number;
  /** travelling tracer: segment length (0 = full beam) */
  seg: number;
  speed: number;
}

interface Timed {
  obj: THREE.Object3D;
  t: number;
  life: number;
  update: (t: number, k: number, obj: THREE.Object3D) => void;
}

interface Decal {
  mesh: THREE.InstancedMesh;
  i: number;
}

/**
 * All transient visual effects of a match.
 */
export class Effects {
  group = new THREE.Group();
  add: ParticleSystem; // additive: sparks, energy, fire
  alpha: ParticleSystem; // alpha: dust, smoke, foam
  private beams: Beam[] = [];
  private beamGeo: THREE.BufferGeometry;
  private beamMesh: THREE.Mesh;
  private beamPos: Float32Array;
  private beamCol: Float32Array;
  private beamUv: Float32Array;
  private readonly maxBeams = 256;
  private timed: Timed[] = [];
  private lights: { light: THREE.PointLight; t: number; life: number; i0: number }[] = [];
  private decals: THREE.InstancedMesh;
  private decalIdx = 0;
  private footprints: THREE.InstancedMesh;
  private footIdx = 0;
  world: World;
  camera: THREE.Camera;
  /** camera shake request (consumed by the game camera) */
  shake = 0;
  /** screen flash request (nukes) */
  flash = 0;
  private sphereGeo = new THREE.SphereGeometry(1, 24, 16);
  private ringGeo = new THREE.RingGeometry(0.85, 1, 64);

  /** graphics setting: particle density */
  setParticles(level: 'low' | 'medium' | 'high'): void {
    const d = level === 'low' ? 0.4 : level === 'medium' ? 0.7 : 1;
    this.add.density = d;
    this.alpha.density = d;
  }

  constructor(world: World, camera: THREE.Camera, quality: 'low' | 'medium' | 'high' | 'ultra') {
    this.world = world;
    this.camera = camera;
    const n = quality === 'low' ? 2500 : quality === 'medium' ? 5000 : 9000;
    this.add = new ParticleSystem(n, true);
    this.alpha = new ParticleSystem(n, false);
    const ground = (x: number, z: number) => world.terrainData.hf.heightAt(x, z);
    this.add.ground = ground;
    this.alpha.ground = ground;
    this.group.add(this.alpha.mesh, this.add.mesh);

    // beams: camera-facing strips rebuilt on the CPU every frame
    this.beamPos = new Float32Array(this.maxBeams * 4 * 3);
    this.beamCol = new Float32Array(this.maxBeams * 4 * 4);
    this.beamUv = new Float32Array(this.maxBeams * 4 * 2);
    const idx: number[] = [];
    for (let i = 0; i < this.maxBeams; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    this.beamGeo = new THREE.BufferGeometry();
    this.beamGeo.setAttribute('position', new THREE.BufferAttribute(this.beamPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.beamGeo.setAttribute('color', new THREE.BufferAttribute(this.beamCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.beamGeo.setAttribute('uv', new THREE.BufferAttribute(this.beamUv, 2).setUsage(THREE.DynamicDrawUsage));
    this.beamGeo.setIndex(idx);
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: `attribute vec4 color; varying vec4 vC; varying vec2 vUv; void main(){ vC = color; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec4 vC; varying vec2 vUv; void main(){ float d = abs(vUv.y - 0.5) * 2.0; float core = exp(-d * d * 10.0); float a = core * vC.a * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.85, vUv.x); gl_FragColor = vec4(vC.rgb * (0.6 + core * 1.6), a); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.beamMesh = new THREE.Mesh(this.beamGeo, beamMat);
    this.beamMesh.frustumCulled = false;
    this.beamMesh.layers.set(LAYER_NO_OUTLINE);
    this.beamMesh.renderOrder = 11;
    this.group.add(this.beamMesh);

    // point light pool for flashes. The lights stay visible (intensity 0 when idle): three.js bakes the
    // number of lights into every lit shader, so toggling them recompiled every material mid-fight
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 20, 2);
      this.group.add(l);
      this.lights.push({ light: l, t: 0, life: 0, i0: 0 });
    }

    // decals (scorch / bullet marks) and lunar bootprints
    const decalTex = makeDecalTexture();
    const dm = new THREE.MeshStandardMaterial({ map: decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1, metalness: 0, color: 0x222222 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dm, 300);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.layers.set(LAYER_NO_OUTLINE);
    this.group.add(this.decals);
    const footTex = makeFootTexture();
    const fm = new THREE.MeshStandardMaterial({ map: footTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, roughness: 1, metalness: 0, color: 0x6a6660, normalScale: new THREE.Vector2(1, 1) });
    this.footprints = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.34), fm, 600);
    this.footprints.count = 0;
    this.footprints.frustumCulled = false;
    this.footprints.receiveShadow = true;
    this.footprints.layers.set(LAYER_NO_OUTLINE);
    this.group.add(this.footprints);
  }

  // ---------------------------------------------------------------- primitives

  beam(a: THREE.Vector3, b: THREE.Vector3, color: number, width: number, life: number, seg = 0, speed = 0): void {
    if (this.beams.length >= this.maxBeams) this.beams.shift();
    this.beams.push({ a: a.clone(), b: b.clone(), color: new THREE.Color(color), width, life, max: life, seg, speed });
  }

  /** travelling tracer bolt */
  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number, width = 0.06, speed = 320): void {
    const len = a.distanceTo(b);
    this.beam(a, b, color, width, Math.max(0.05, len / speed) + 0.03, Math.min(len, 6), speed);
  }

  flashLight(pos: THREE.Vector3, color: number, intensity: number, dist: number, life: number): void {
    // take the least-used light
    let best = this.lights[0];
    for (const l of this.lights) if (l.t >= l.life || l.i0 < best.i0) best = l;
    best.light.position.copy(pos);
    best.light.color.setHex(color);
    best.light.distance = dist;
    best.light.intensity = intensity;
    best.t = 0;
    best.life = life;
    best.i0 = intensity;
  }

  private addTimed(obj: THREE.Object3D, life: number, update: Timed['update']): void {
    this.group.add(obj);
    this.timed.push({ obj, t: 0, life, update });
  }

  // ---------------------------------------------------------------- composites

  muzzle(pos: THREE.Vector3, dir: THREE.Vector3, color: number, scale = 1): void {
    this.add.spawn({ pos, life: 0.05, size0: 0.45 * scale, size1: 0.2 * scale, color0: color, alpha0: 1, alpha1: 0, sprite: 4 });
    this.add.spawn({ pos, life: 0.06, size0: 0.28 * scale, size1: 0.1 * scale, color0: 0xffffff, sprite: 0 });
    for (let i = 0; i < 3; i++) {
      coneDir(dir, 0.25, _v).multiplyScalar(rnd(6, 14));
      this.add.spawn({ pos, vel: _v, life: rnd(0.05, 0.1), size0: 0.05 * scale, color0: color, sprite: 2, stretch: 0.02 });
    }
    this.flashLight(pos, color, 6 * scale, 8, 0.06);
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3, surface: 'metal' | 'dirt' | 'flesh' | 'shield' | 'energy', color = 0xfff0c0): void {
    if (surface === 'metal') {
      for (let i = 0; i < 9; i++) {
        coneDir(normal, 0.8, _v).multiplyScalar(rnd(4, 12));
        this.add.spawn({ pos, vel: _v, life: rnd(0.2, 0.6), size0: 0.05, color0: 0xffe6a0, color1: 0xff7a30, gravity: 1, sprite: 2, stretch: 0.03, collide: true });
      }
      this.add.spawn({ pos, life: 0.08, size0: 0.4, size1: 0.2, color0: 0xfff2d0, sprite: 4 });
      this.alpha.spawn({ pos: _w.copy(pos).addScaledVector(normal, 0.05), vel: _v.copy(normal).multiplyScalar(0.4), life: 0.6, size0: 0.15, size1: 0.5, color0: 0x9aa0aa, alpha0: 0.35, sprite: 1 });
      this.decal(pos, normal, 0.18, 0);
    } else if (surface === 'dirt') {
      // regolith: puff + ballistic grains (no air → no billowing, long arcs)
      for (let i = 0; i < 10; i++) {
        coneDir(normal, 0.5, _v).multiplyScalar(rnd(1.5, 5.5));
        this.alpha.spawn({ pos, vel: _v, life: rnd(1.2, 2.6), size0: rnd(0.04, 0.09), color0: 0xb6b0a4, alpha0: 0.9, alpha1: 0.6, gravity: 1, sprite: 0, collide: true });
      }
      this.alpha.spawn({ pos, vel: _v.copy(normal).multiplyScalar(0.9), life: 0.9, size0: 0.25, size1: 0.9, color0: 0xb0aa9e, alpha0: 0.5, gravity: 0.3, sprite: 1 });
      this.add.spawn({ pos, life: 0.06, size0: 0.22, color0: color, sprite: 0 });
    } else if (surface === 'flesh') {
      // suit hit: white fabric flecks + gas puff
      for (let i = 0; i < 6; i++) {
        coneDir(normal, 0.7, _v).multiplyScalar(rnd(2, 6));
        this.alpha.spawn({ pos, vel: _v, life: rnd(0.3, 0.7), size0: 0.05, color0: 0xf2f0ea, gravity: 1, sprite: 0 });
      }
      this.alpha.spawn({ pos, vel: _v.copy(normal).multiplyScalar(1.4), life: 0.5, size0: 0.2, size1: 0.7, color0: 0xdbe8ff, alpha0: 0.5, sprite: 1 });
      this.add.spawn({ pos, life: 0.07, size0: 0.35, color0: color, sprite: 4 });
    } else if (surface === 'shield') {
      this.add.spawn({ pos, life: 0.25, size0: 0.2, size1: 1.4, color0: 0x7fd8ff, alpha0: 0.9, sprite: 3 });
      for (let i = 0; i < 5; i++) {
        coneDir(normal, 1, _v).multiplyScalar(rnd(2, 5));
        this.add.spawn({ pos, vel: _v, life: 0.3, size0: 0.05, color0: 0x9fe6ff, sprite: 2, stretch: 0.03 });
      }
    } else {
      this.add.spawn({ pos, life: 0.18, size0: 0.15, size1: 0.8, color0: color, alpha0: 1, sprite: 3 });
      for (let i = 0; i < 6; i++) {
        coneDir(normal, 1, _v).multiplyScalar(rnd(3, 7));
        this.add.spawn({ pos, vel: _v, life: rnd(0.15, 0.35), size0: 0.05, color0: color, sprite: 2, stretch: 0.025 });
      }
    }
  }

  /** Lunar dust kicked by boots / landings. */
  dust(pos: THREE.Vector3, amount: number, strength = 1): void {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.4, 1.8) * strength;
      _v.set(Math.cos(a) * sp, rnd(0.4, 1.4) * strength, Math.sin(a) * sp);
      this.alpha.spawn({ pos, vel: _v, life: rnd(0.9, 2.0), size0: rnd(0.03, 0.06), color0: 0xbdb7ab, alpha0: 0.85, alpha1: 0.4, gravity: 1, collide: true });
    }
    this.alpha.spawn({ pos, vel: _v.set(0, 0.25 * strength, 0), life: 1.1, size0: 0.25 * strength, size1: 0.9 * strength, color0: 0xb8b2a6, alpha0: 0.35, gravity: 0.2, sprite: 1 });
  }

  footprint(pos: THREE.Vector3, yaw: number, normal: THREE.Vector3): void {
    const m = new THREE.Matrix4();
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const q2 = new THREE.Quaternion().setFromAxisAngle(normal, yaw);
    q2.multiply(_q);
    m.compose(_v.copy(pos).addScaledVector(normal, 0.015), q2, new THREE.Vector3(1, 1, 1));
    this.footprints.setMatrixAt(this.footIdx, m);
    this.footIdx = (this.footIdx + 1) % 600;
    this.footprints.count = Math.max(this.footprints.count, this.footIdx);
    this.footprints.instanceMatrix.needsUpdate = true;
  }

  decal(pos: THREE.Vector3, normal: THREE.Vector3, size: number, rot: number): void {
    const m = new THREE.Matrix4();
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const q2 = new THREE.Quaternion().setFromAxisAngle(normal, rot || Math.random() * 6.28);
    q2.multiply(_q);
    m.compose(_v.copy(pos).addScaledVector(normal, 0.01), q2, new THREE.Vector3(size, size, size));
    this.decals.setMatrixAt(this.decalIdx, m);
    this.decalIdx = (this.decalIdx + 1) % 300;
    this.decals.count = Math.max(this.decals.count, this.decalIdx);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** Expanding shockwave ring aligned with a surface normal. */
  shockwave(pos: THREE.Vector3, normal: THREE.Vector3, radius: number, color: number, life: number, opacity = 0.8): void {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const ring = new THREE.Mesh(this.ringGeo, mat);
    ring.position.copy(pos).addScaledVector(normal, 0.15);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    ring.layers.set(LAYER_NO_OUTLINE);
    this.addTimed(ring, life, (_t, k, o) => {
      const e = 1 - Math.pow(1 - k, 2.5);
      o.scale.setScalar(0.3 + e * radius);
      mat.opacity = opacity * (1 - k);
    });
  }

  /** Glowing expanding sphere (explosion core / fireball). */
  fireball(pos: THREE.Vector3, radius: number, color: number, life: number, intensity = 3): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }, uK: { value: 0 }, uTime: { value: Math.random() * 10 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uK; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        float n3(vec3 p){ vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){
          float fres = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
          float n = n3(vP * 3.0 + uTime) * 0.6 + n3(vP * 7.0 - uTime) * 0.4;
          float core = pow(fres, 1.5);
          float a = (core * 0.85 + 0.15) * (1.0 - uK) * (0.7 + n * 0.5);
          vec3 c = mix(uColor * 0.6, uColor * 1.8, core) * (0.8 + n * 0.4);
          c = mix(c, vec3(1.0, 0.95, 0.8) * 4.0, pow(core, 4.0) * (1.0 - uK));
          gl_FragColor = vec4(c * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const s = new THREE.Mesh(this.sphereGeo, mat);
    s.position.copy(pos);
    s.layers.set(LAYER_NO_OUTLINE);
    this.addTimed(s, life, (t, k, o) => {
      const e = 1 - Math.pow(1 - k, 3);
      o.scale.setScalar(radius * (0.25 + e * 0.9));
      mat.uniforms.uK.value = k * k;
      mat.uniforms.uTime.value += 0.02;
    });
  }

  /**
   * Standard explosion (frag / grenade / missile / plasma burst).
   * Vacuum: bright flash + hot debris + regolith ejected in ballistic arcs; no rolling smoke.
   */
  explosion(pos: THREE.Vector3, radius: number, color = 0xffa040, onGround = true): void {
    const normal = onGround ? this.groundNormal(pos, _w) : UP;
    this.fireball(pos, radius * 0.9, color, 0.45, 3);
    this.add.spawn({ pos, life: 0.12, size0: radius * 3.2, size1: radius * 1.5, color0: 0xfff2d8, alpha0: 1, sprite: 4 });
    this.shockwave(pos, normal, radius * 2.2, color, 0.5, 0.6);
    this.flashLight(pos, color, 40, radius * 7, 0.35);
    // hot sparks
    for (let i = 0; i < 28; i++) {
      randDir(_v).multiplyScalar(rnd(6, 22));
      if (_v.dot(normal) < 0) _v.reflect(normal);
      this.add.spawn({ pos, vel: _v, life: rnd(0.4, 1.3), size0: 0.08, color0: 0xffd080, color1: 0xff5020, gravity: 1, sprite: 2, stretch: 0.025, collide: true });
    }
    // glowing embers
    for (let i = 0; i < 12; i++) {
      randDir(_v).multiplyScalar(rnd(1, 5));
      this.add.spawn({ pos, vel: _v, life: rnd(0.6, 1.2), size0: rnd(0.3, 0.7), size1: 0.05, color0: color, alpha0: 0.8, sprite: 0 });
    }
    if (onGround) {
      // regolith ejecta: dust curtain in ballistic arcs
      for (let i = 0; i < 40; i++) {
        coneDir(normal, 0.9, _v).multiplyScalar(rnd(3, 11) * Math.sqrt(radius / 4));
        this.alpha.spawn({ pos, vel: _v, life: rnd(2, 4), size0: rnd(0.05, 0.14), color0: 0xb3ad9f, alpha0: 0.95, alpha1: 0.5, gravity: 1, collide: true });
      }
      for (let i = 0; i < 8; i++) {
        coneDir(normal, 0.8, _v).multiplyScalar(rnd(1, 3));
        this.alpha.spawn({ pos, vel: _v, life: rnd(1.5, 2.5), size0: radius * 0.4, size1: radius * 1.3, color0: 0xa8a294, alpha0: 0.45, gravity: 0.35, sprite: 1 });
      }
      const box = this.world.terrain.scorch(pos.x, pos.z, radius * 0.9, 0.35);
      this.world.terrain.refresh(box);
    }
    this.shake = Math.max(this.shake, 0.3);
  }

  /** EMP pulse: blue lightning ring + sparks */
  emp(pos: THREE.Vector3, radius: number): void {
    this.fireball(pos, radius * 0.5, 0x5fb8ff, 0.4, 2.5);
    this.shockwave(pos, UP, radius, 0x6fd0ff, 0.6, 0.9);
    this.shockwave(pos, UP, radius * 0.6, 0xffffff, 0.4, 0.6);
    this.flashLight(pos, 0x6fd0ff, 30, radius * 3, 0.4);
    for (let i = 0; i < 40; i++) {
      randDir(_v).multiplyScalar(rnd(8, 20));
      this.add.spawn({ pos, vel: _v, life: rnd(0.2, 0.6), size0: 0.06, color0: 0xbfe8ff, sprite: 2, stretch: 0.03 });
    }
    // lightning arcs
    for (let i = 0; i < 8; i++) {
      randDir(_v).multiplyScalar(radius * rnd(0.4, 0.9)).add(pos);
      this.lightning(pos, _v.clone(), 0x9fe0ff, 0.25);
    }
  }

  lightning(a: THREE.Vector3, b: THREE.Vector3, color: number, life: number): void {
    const n = 6;
    let prev = a.clone();
    for (let i = 1; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      if (i < n) p.add(randDir(_v).multiplyScalar(a.distanceTo(b) * 0.08));
      this.beam(prev, p, color, 0.06, life);
      prev = p;
    }
  }

  /** Suit breach venting (called every frame while leaking). */
  vent(pos: THREE.Vector3, dir: THREE.Vector3, rate: number): void {
    if (Math.random() > rate) return;
    coneDir(dir, 0.35, _v).multiplyScalar(rnd(2, 4));
    this.alpha.spawn({ pos, vel: _v, life: rnd(0.4, 0.8), size0: 0.08, size1: 0.45, color0: 0xe8f2ff, alpha0: 0.55, sprite: 1 });
    if (Math.random() < 0.3) this.add.spawn({ pos, vel: _v.multiplyScalar(1.5), life: 0.3, size0: 0.03, color0: 0xcfe8ff, sprite: 2, stretch: 0.02 });
  }

  jet(pos: THREE.Vector3, dir: THREE.Vector3, color = 0x9fd8ff): void {
    coneDir(dir, 0.15, _v).multiplyScalar(rnd(6, 10));
    this.add.spawn({ pos, vel: _v, life: rnd(0.12, 0.25), size0: 0.22, size1: 0.05, color0: color, color1: 0x3060ff, alpha0: 0.8, sprite: 0 });
    if (Math.random() < 0.35) this.alpha.spawn({ pos, vel: _v.multiplyScalar(0.3), life: 0.8, size0: 0.1, size1: 0.5, color0: 0xd8e0f0, alpha0: 0.15, sprite: 1 });
  }

  /**
   * Tactical nuke: white-out flash, plasma fireball, ground shockwave, huge lunar dust ring
   * thrown in ballistic arcs, crater carved into the terrain, lingering radiation glow.
   */
  nuke(pos: THREE.Vector3, radius: number): void {
    this.flash = 1;
    this.shake = 1.6;
    this.fireball(pos, radius * 0.75, 0xffe8b0, 1.4, 5);
    this.fireball(pos, radius * 1.2, 0xff8840, 2.6, 2.2);
    this.fireball(pos, radius * 0.45, 0xffffff, 0.8, 8);
    const n = this.groundNormal(pos, new THREE.Vector3());
    this.shockwave(pos, n, radius * 3.5, 0xfff0d0, 2.2, 1);
    this.shockwave(pos, n, radius * 2.2, 0xffa060, 1.6, 0.8);
    this.shockwave(pos, UP.clone(), radius * 2.8, 0x80c0ff, 1.8, 0.5);
    this.flashLight(pos, 0xfff0d0, 3000, radius * 12, 3);
    this.add.spawn({ pos, life: 0.6, size0: radius * 8, size1: radius * 3, color0: 0xffffff, alpha0: 1, sprite: 4 });
    // dust curtain: lunar ejecta flying far
    for (let i = 0; i < 700; i++) {
      coneDir(n, 1.3, _v);
      const flat = Math.abs(_v.dot(n));
      _v.multiplyScalar(rnd(6, 34) * (1.15 - flat * 0.6));
      this.alpha.spawn({
        pos: _w.copy(pos).addScaledVector(randDir(new THREE.Vector3()), radius * 0.2),
        vel: _v,
        life: rnd(4, 9),
        size0: rnd(0.15, 0.6),
        size1: rnd(0.8, 2.5),
        color0: 0xc2baa8,
        color1: 0x8f887a,
        alpha0: 0.7,
        alpha1: 0.2,
        gravity: 1,
        sprite: i % 3 === 0 ? 1 : 0,
        collide: true,
      });
    }
    for (let i = 0; i < 160; i++) {
      randDir(_v).multiplyScalar(rnd(15, 45));
      if (_v.dot(n) < 0) _v.reflect(n);
      this.add.spawn({ pos, vel: _v, life: rnd(1, 3), size0: 0.2, color0: 0xffe0a0, color1: 0xff4010, gravity: 1, sprite: 2, stretch: 0.04, collide: true });
    }
    // crater + scorch
    const hf = this.world.terrainData.hf;
    const box = hf.deform(pos.x, pos.z, radius * 0.45, radius * 0.18);
    const sc = this.world.terrain.scorch(pos.x, pos.z, radius * 1.1, 0.5);
    this.world.terrain.refresh({ i0: Math.min(box.i0, sc.i0), i1: Math.max(box.i1, sc.i1), j0: Math.min(box.j0, sc.j0), j1: Math.max(box.j1, sc.j1) });
    // radiation glow disc
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.9, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7dff6a).multiplyScalar(1.5), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    glow.position.set(pos.x, hf.heightAt(pos.x, pos.z) + 0.3, pos.z);
    glow.rotation.x = -Math.PI / 2;
    glow.layers.set(LAYER_NO_OUTLINE);
    this.addTimed(glow, 20, (t, k, o) => {
      ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.25 * (1 - k) * (0.8 + 0.2 * Math.sin(t * 4));
      if (Math.random() < 0.5) {
        const a = Math.random() * 6.28;
        const r = Math.random() * radius * 0.8;
        this.add.spawn({ pos: _w.set(pos.x + Math.cos(a) * r, o.position.y, pos.z + Math.sin(a) * r), vel: _v.set(0, rnd(0.3, 1.2), 0), life: 1.5, size0: 0.12, color0: 0x9dff7a, alpha0: 0.8 * (1 - k), sprite: 0 });
      }
    });
  }

  /** Singularity: swirling dark orb with accretion disk; returns the object to move along. */
  singularity(pos: THREE.Vector3, radius: number, life: number): THREE.Object3D {
    const g = new THREE.Group();
    g.position.copy(pos);
    const core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    g.add(core);
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 3.2, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb06cff).multiplyScalar(2.5), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    disk.rotation.x = Math.PI / 2 - 0.3;
    disk.layers.set(LAYER_NO_OUTLINE);
    g.add(disk);
    const halo = new THREE.Mesh(this.sphereGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7040ff).multiplyScalar(1.5), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.scale.setScalar(2);
    halo.layers.set(LAYER_NO_OUTLINE);
    g.add(halo);
    this.addTimed(g, life, (t, k, o) => {
      const s = (0.3 + Math.min(1, t * 2) * 0.7) * (k > 0.9 ? (1 - k) * 10 : 1) * (radius / 9);
      o.scale.setScalar(s);
      disk.rotation.z += 0.08;
      // inward spiralling particles
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * 6.28;
        const r = radius * rnd(0.6, 1.1);
        _w.set(Math.cos(a) * r, rnd(-1, 1) * r * 0.3, Math.sin(a) * r);
        _v.copy(_w).multiplyScalar(-1.2).add(new THREE.Vector3(-_w.z, 0, _w.x).multiplyScalar(0.8));
        this.add.spawn({ pos: _w.add(o.position), vel: _v, life: 0.8, size0: 0.12, size1: 0.02, color0: 0xd0a0ff, sprite: 2, stretch: 0.03 });
      }
    });
    return g;
  }

  /** Orbital laser strike column. */
  orbitalBeam(pos: THREE.Vector3, radius: number, life: number): THREE.Object3D {
    const h = 400;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5040).multiplyScalar(4), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.35, radius * 0.5, h, 24, 1, true), mat);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.12, radius * 0.15, h, 16, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(6), toneMapped: false }));
    const g = new THREE.Group();
    g.add(col, core);
    col.position.y = h / 2;
    core.position.y = h / 2;
    g.position.copy(pos);
    g.traverse((o) => o.layers.set(LAYER_NO_OUTLINE));
    this.addTimed(g, life, (t, k, o) => {
      const w = Math.min(1, t * 4) * (k > 0.85 ? (1 - k) / 0.15 : 1);
      o.scale.set(w, 1, w);
      mat.opacity = 0.6 + Math.sin(t * 40) * 0.2;
      const gy = this.world.terrainData.hf.heightAt(o.position.x, o.position.z);
      _w.set(o.position.x, gy, o.position.z);
      for (let i = 0; i < 4; i++) {
        randDir(_v).multiplyScalar(rnd(5, 15));
        _v.y = Math.abs(_v.y);
        this.add.spawn({ pos: _w, vel: _v, life: rnd(0.3, 0.8), size0: 0.08, color0: 0xffc080, color1: 0xff3010, gravity: 1, sprite: 2, stretch: 0.03, collide: true });
      }
      if (Math.random() < 0.4) this.alpha.spawn({ pos: _w, vel: _v.set(rnd(-2, 2), rnd(1, 4), rnd(-2, 2)), life: 2, size0: 0.5, size1: 2, color0: 0xb0a898, alpha0: 0.4, gravity: 0.5, sprite: 1 });
    });
    return g;
  }

  /** Shield bubble (Reactor dome / Helios life bubble) */
  bubble(pos: THREE.Vector3, radius: number, color: number, life: number): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 }, uHit: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uK; uniform float uHit; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float hex = abs(sin(vP.x * 9.0 + uTime) * sin(vP.y * 9.0) * sin(vP.z * 9.0 - uTime));
          float a = (pow(f, 2.5) * 0.9 + 0.06 + smoothstep(0.92, 1.0, hex) * 0.15 + uHit * 0.3) * (1.0 - uK);
          gl_FragColor = vec4(uColor * 2.2 * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const m = new THREE.Mesh(this.sphereGeo, mat);
    m.position.copy(pos);
    m.layers.set(LAYER_NO_OUTLINE);
    this.addTimed(m, life, (t, k, o) => {
      const grow = Math.min(1, t * 5);
      o.scale.setScalar(radius * (0.2 + 0.8 * (1 - Math.pow(1 - grow, 3))));
      mat.uniforms.uK.value = k > 0.9 ? (k - 0.9) * 10 : 0;
      mat.uniforms.uTime.value = t;
      mat.uniforms.uHit.value = Math.max(0, mat.uniforms.uHit.value - 0.05);
    });
    return m;
  }

  groundNormal(pos: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const h = this.world.terrainData.hf.heightAt(pos.x, pos.z);
    if (pos.y - h < 1.5) return this.world.terrainData.hf.normalAt(pos.x, pos.z, out);
    return out.set(0, 1, 0);
  }

  // ---------------------------------------------------------------- update

  update(dt: number): void {
    this.add.update(dt);
    this.alpha.update(dt);
    // timed objects
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.t += dt;
      const k = Math.min(1, t.t / t.life);
      t.update(t.t, k, t.obj);
      if (t.t >= t.life) {
        this.group.remove(t.obj);
        t.obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.material) (m.material as THREE.Material).dispose();
        });
        this.timed.splice(i, 1);
      }
    }
    for (const l of this.lights) {
      if (l.t >= l.life) continue;
      l.t += dt;
      const k = l.t / l.life;
      if (k >= 1) l.light.intensity = 0;
      else l.light.intensity = l.i0 * (1 - k) * (1 - k);
    }
    this.updateBeams(dt);
    this.flash = Math.max(0, this.flash - dt * 0.8);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  private updateBeams(dt: number): void {
    const cam = this.camera.getWorldPosition(new THREE.Vector3());
    let n = 0;
    const P = this.beamPos;
    const C = this.beamCol;
    const U = this.beamUv;
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const bm = this.beams[i];
      bm.life -= dt;
      if (bm.life <= 0) {
        this.beams.splice(i, 1);
        continue;
      }
    }
    for (const bm of this.beams) {
      if (n >= this.maxBeams) break;
      const k = 1 - bm.life / bm.max;
      a.copy(bm.a);
      b.copy(bm.b);
      let alpha = 1 - k;
      if (bm.seg > 0) {
        const len = bm.a.distanceTo(bm.b);
        const head = Math.min(len, (bm.max - bm.life) * bm.speed);
        const tail = Math.max(0, head - bm.seg);
        dir.copy(bm.b).sub(bm.a).normalize();
        b.copy(bm.a).addScaledVector(dir, head);
        a.copy(bm.a).addScaledVector(dir, tail);
        alpha = 1;
      }
      dir.copy(b).sub(a);
      if (dir.lengthSq() < 1e-6) continue;
      toCam.copy(cam).sub(a);
      side.crossVectors(dir, toCam).normalize().multiplyScalar(bm.width * 0.5 * (bm.seg > 0 ? 1 : 1 - k * 0.5));
      const o = n * 12;
      P[o] = a.x - side.x;
      P[o + 1] = a.y - side.y;
      P[o + 2] = a.z - side.z;
      P[o + 3] = b.x - side.x;
      P[o + 4] = b.y - side.y;
      P[o + 5] = b.z - side.z;
      P[o + 6] = b.x + side.x;
      P[o + 7] = b.y + side.y;
      P[o + 8] = b.z + side.z;
      P[o + 9] = a.x + side.x;
      P[o + 10] = a.y + side.y;
      P[o + 11] = a.z + side.z;
      for (let v = 0; v < 4; v++) {
        C[n * 16 + v * 4] = bm.color.r;
        C[n * 16 + v * 4 + 1] = bm.color.g;
        C[n * 16 + v * 4 + 2] = bm.color.b;
        C[n * 16 + v * 4 + 3] = alpha;
      }
      U.set([0, 0, 1, 0, 1, 1, 0, 1], n * 8);
      n++;
    }
    this.beamGeo.setDrawRange(0, n * 6);
    (this.beamGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.beamGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.beamGeo.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.add.clear();
    this.alpha.clear();
    this.beams.length = 0;
    for (const t of this.timed) this.group.remove(t.obj);
    this.timed.length = 0;
  }
}

function makeDecalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(10,10,12,0.95)');
  g.addColorStop(0.3, 'rgba(25,24,26,0.7)');
  g.addColorStop(1, 'rgba(40,38,36,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(0,0,0,0.6)';
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * 6.28;
    x.beginPath();
    x.moveTo(64, 64);
    x.lineTo(64 + Math.cos(a) * 50, 64 + Math.sin(a) * 50);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeFootTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 112;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(40,38,34,0.55)';
  x.beginPath();
  x.ellipse(32, 36, 24, 32, 0, 0, Math.PI * 2);
  x.ellipse(32, 88, 20, 22, 0, 0, Math.PI * 2);
  x.fill();
  // tread bars (iconic Apollo boot print)
  x.fillStyle = 'rgba(20,18,16,0.6)';
  for (let i = 0; i < 9; i++) x.fillRect(10, 8 + i * 11, 44, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
