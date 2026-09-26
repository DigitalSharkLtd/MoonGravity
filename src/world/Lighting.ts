import * as THREE from 'three';
import type { Quality } from '../render/Pipeline';

/** Harsh low-angle sun + bluish earthshine fill. The sun's shadow frustum follows the camera. */
export class Lighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  sunDir: THREE.Vector3;
  private extent: number;

  constructor(scene: THREE.Scene, sunDir: THREE.Vector3, quality: Quality) {
    this.sunDir = sunDir.clone().normalize();
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.35);
    this.sun.castShadow = true;
    const size = quality === 'high' ? 4096 : quality === 'medium' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    this.extent = quality === 'low' ? 60 : 85;
    const cam = this.sun.shadow.camera;
    cam.left = -this.extent;
    cam.right = this.extent;
    cam.top = this.extent;
    cam.bottom = -this.extent;
    cam.near = 1;
    cam.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 2;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // earthshine from above (cool) + regolith bounce from below (warm)
    this.hemi = new THREE.HemisphereLight(0x7d8fd6, 0x5a4a3c, 0.75);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x27305a, 0.45);
    scene.add(this.ambient);
  }

  update(focus: THREE.Vector3): void {
    // snap to shadow texels to avoid shimmering
    const texel = (this.extent * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(this.sunDir, 300);
    this.sun.target.updateMatrixWorld();
  }
}
