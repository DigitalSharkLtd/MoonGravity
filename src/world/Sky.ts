import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { Noise } from '../core/Noise';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';

export function dirFromAngles(azimuth: number, elevation: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth));
}

/** Black lunar sky: gradient dome, star field + milky way, stylized Earth, sun disc with glare. */
export class Sky {
  group = new THREE.Group();
  earth: THREE.Mesh;
  earthGlow: THREE.Mesh;
  sunSprite: THREE.Mesh;
  private stars: THREE.Points;
  private dome: THREE.Mesh;

  constructor(sunDir: THREE.Vector3, earthDir: THREE.Vector3, earthSize: number, seed: number) {
    const R = 5200;
    // --- dome gradient ---
    const domeMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sunDir.clone() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 top = vec3(0.004, 0.005, 0.014);
          vec3 hor = vec3(0.028, 0.036, 0.085);
          vec3 c = mix(hor, top, smoothstep(-0.05, 0.45, h));
          float s = max(dot(normalize(vDir), normalize(uSun)), 0.0);
          c += vec3(1.0, 0.85, 0.6) * pow(s, 60.0) * 0.35 + vec3(0.5, 0.55, 0.9) * pow(s, 6.0) * 0.03;
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16), domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.dome.layers.set(LAYER_NO_OUTLINE);
    this.group.add(this.dome);

    // --- stars (+ milky way band) ---
    const rng = new Rng(seed + 5);
    const n = 9000;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const band = new THREE.Vector3(0.3, 0.8, 0.52).normalize(); // galactic pole
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      let accepted = false;
      while (!accepted) {
        v.set(rng.gauss(), rng.gauss(), rng.gauss()).normalize();
        const inBand = 1 - Math.abs(v.dot(band));
        accepted = i < n * 0.45 || rng.next() < Math.pow(inBand, 10);
      }
      pos[i * 3] = v.x * (R * 0.95);
      pos[i * 3 + 1] = v.y * (R * 0.95);
      pos[i * 3 + 2] = v.z * (R * 0.95);
      const t = rng.next();
      const c = t < 0.15 ? [0.7, 0.8, 1] : t < 0.25 ? [1, 0.85, 0.7] : t < 0.3 ? [1, 0.7, 0.6] : [1, 1, 1];
      const b = 0.4 + Math.pow(rng.next(), 6) * 2.4;
      col[i * 3] = c[0] * b;
      col[i * 3 + 1] = c[1] * b;
      col[i * 3 + 2] = c[2] * b;
      size[i] = 1 + Math.pow(rng.next(), 8) * 3.2;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const sm = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.99999; gl_PointSize = size * uScale; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * a, 1.0); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.stars = new THREE.Points(sg, sm);
    this.stars.frustumCulled = false;
    this.stars.layers.set(LAYER_NO_OUTLINE);
    this.stars.renderOrder = -9;
    this.group.add(this.stars);

    // --- Earth ---
    const earthTex = makeEarthTexture(seed);
    const earthR = 150 * earthSize;
    const earthMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: earthTex }, uSun: { value: sunDir.clone() }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp; gl_Position.z = gl_Position.w * 0.99995; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap; uniform vec3 uSun; uniform float uTime;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){
          vec3 c = texture2D(tMap, vUv + vec2(uTime * 0.002, 0.0)).rgb;
          float d = dot(normalize(vN), normalize(uSun));
          float lit = smoothstep(-0.08, 0.2, d);
          lit = floor(lit * 3.0 + 0.5) / 3.0 * 0.85 + lit * 0.15; // toon banding
          float fres = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.5);
          vec3 col = c * (0.04 + 1.25 * lit) + vec3(0.35, 0.6, 1.0) * fres * (0.2 + lit) * 1.2;
          // city lights on the night side
          col += vec3(1.0, 0.75, 0.35) * step(0.93, fract(sin(dot(floor(vUv * vec2(220.0, 110.0)), vec2(12.9898, 78.233))) * 43758.5)) * (1.0 - smoothstep(-0.1, 0.05, d)) * step(0.5, c.g - c.b + 0.5) * 0.6;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(earthR, 64, 32), earthMat);
    this.earth.position.copy(earthDir).multiplyScalar(R * 0.8);
    this.earth.rotation.set(0.35, 1.3, 0.1);
    this.earth.layers.set(LAYER_NO_OUTLINE);
    this.earth.frustumCulled = false;
    this.group.add(this.earth);
    // atmosphere glow
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sunDir.clone() } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV;
        void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.0); vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp; gl_Position.z = gl_Position.w * 0.99996; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; varying vec3 vN; varying vec3 vV;
        void main(){
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float a = pow(f, 4.0);
          float lit = smoothstep(-0.4, 0.4, dot(normalize(vN), normalize(uSun)));
          gl_FragColor = vec4(vec3(0.3, 0.6, 1.4) * a * (0.15 + lit), 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.earthGlow = new THREE.Mesh(new THREE.SphereGeometry(earthR * 1.12, 48, 24), glowMat);
    this.earthGlow.position.copy(this.earth.position);
    this.earthGlow.layers.set(LAYER_NO_OUTLINE);
    this.earthGlow.frustumCulled = false;
    this.group.add(this.earthGlow);

    // --- sun disc + glare ---
    const sunMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); p.z = p.w * 0.99994; gl_Position = p; }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main(){
          vec2 p = vUv - 0.5; float d = length(p) * 2.0;
          float core = smoothstep(0.12, 0.1, d);
          float glow = pow(max(0.0, 1.0 - d), 3.0) * 0.8;
          float ang = atan(p.y, p.x);
          float rays = pow(max(0.0, cos(ang * 6.0)), 30.0) * pow(max(0.0, 1.0 - d), 2.0) * 0.6;
          vec3 c = vec3(1.0, 0.96, 0.86) * (core * 6.0 + glow + rays);
          gl_FragColor = vec4(c, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sunSprite = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), sunMat);
    this.sunSprite.position.copy(sunDir).multiplyScalar(R * 0.85);
    this.sunSprite.lookAt(0, 0, 0);
    this.sunSprite.layers.set(LAYER_NO_OUTLINE);
    this.sunSprite.frustumCulled = false;
    this.group.add(this.sunSprite);
  }

  /** Keep sky centered on the camera so it's infinitely far. */
  update(camPos: THREE.Vector3, t: number, pixelScale: number): void {
    this.group.position.copy(camPos);
    (this.earth.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    (this.stars.material as THREE.ShaderMaterial).uniforms.uScale.value = pixelScale;
  }
}

function makeEarthTexture(seed: number): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const nz = new Noise(seed + 1234);
  for (let y = 0; y < h; y++) {
    const lat = (y / h - 0.5) * Math.PI;
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      const px = Math.cos(lat) * Math.cos(lon);
      const py = Math.sin(lat);
      const pz = Math.cos(lat) * Math.sin(lon);
      const land = nz.noise3(px * 1.6, py * 1.6, pz * 1.6) * 0.65 + nz.noise3(px * 4, py * 4, pz * 4) * 0.25 + nz.noise3(px * 9, py * 9, pz * 9) * 0.1;
      const cloud = nz.noise3(px * 3 + 10, py * 6, pz * 3) * 0.6 + nz.noise3(px * 8, py * 12 + 5, pz * 8) * 0.4;
      let r: number, g: number, b: number;
      if (land > 0.08) {
        const t = Math.min(1, (land - 0.08) * 3);
        const desert = Math.abs(lat) < 0.5 && nz.noise3(px * 3 - 4, py * 3, pz * 3) > 0.15;
        if (desert) {
          r = 210; g = 180; b = 120;
        } else {
          r = 70 + 60 * t; g = 150 - 30 * t; b = 70;
        }
      } else {
        const t = Math.min(1, -land * 2 + 0.3);
        r = 25; g = 90 + 40 * (1 - t); b = 200 + 30 * (1 - t);
      }
      if (Math.abs(lat) > 1.2) {
        r = g = b = 240;
      }
      const cl = Math.max(0, Math.min(1, (cloud - 0.15) * 2.5));
      r = r * (1 - cl) + 255 * cl;
      g = g * (1 - cl) + 255 * cl;
      b = b * (1 - cl) + 255 * cl;
      const k = (y * w + x) * 4;
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}
