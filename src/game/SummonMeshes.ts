import * as THREE from 'three';
import { toonMat, glowMat } from '../render/Toon';
import { LAYER_NO_OUTLINE } from '../render/Pipeline';
import { P2, side, sect, lathe, latheY, tubeZ, rbox, put, mergeStatic, bandGeo } from '../render/HardSurface';
import { hazardTex } from '../render/Textures';

export type DeviceKind = 'turret' | 'huntdrone' | 'spotdrone' | 'kamikaze' | 'barricade';

/*
 * Deployable device meshes (Torbjörn-turret / Echo-drone school: chunky readable shapes, painted
 * shells over gunmetal, team-coloured emissive lights). Forward = -Z, ground at y = 0.
 * `head` (turret) yaws around Y; everything static is merged per material.
 */

const cream = () => toonMat(0xaaa08a, { spec: 0.5, rim: 0.4 });
const white = () => toonMat(0xaeaca6, { spec: 0.5, rim: 0.4 });
const dark = () => toonMat(0x2c313c, { spec: 0.9, rim: 0.45 });
const steel = () => toonMat(0x9098a6, { spec: 0.85, rim: 0.4 });
const rubber = () => toonMat(0x1c1f26, { spec: 0.15, rim: 0.3 });

/** glow mesh on the no-outline layer */
function lit(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const m = put(parent, geo, mat, x, y, z, rx, ry, rz);
  m.layers.set(LAYER_NO_OUTLINE);
  return m;
}

/** team-tinted paint: darker/saturated variant of the team light colour */
function teamPaint(teamCol: number): THREE.Material {
  const c = new THREE.Color(teamCol);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 0.9), 0.45);
  return toonMat(c.getHex(), { spec: 0.6, rim: 0.4 });
}

export function buildSummonMesh(kind: DeviceKind, teamCol: number): { mesh: THREE.Object3D; head?: THREE.Object3D } {
  const grp = new THREE.Group();
  let head: THREE.Object3D | undefined;
  const glow = glowMat(teamCol, 1.8);
  const glowHot = glowMat(teamCol, 2.3);
  const paint = teamPaint(teamCol);
  const D = dark();
  const S = steel();
  switch (kind) {
    case 'turret': {
      const C = cream();
      const orange = toonMat(0xe0842c, { spec: 0.6, rim: 0.4 });
      // tripod legs (profile in the leg plane, rotated around the hub)
      const leg: P2[] = [
        [0.06, 0.44, 0.02],
        [0.16, 0.44, 0.03],
        [0.46, 0.1, 0.04],
        [0.56, 0.02, 0.01],
        [0.56, 0.0, 0.0],
        [0.42, 0.0, 0.01],
        [0.4, 0.05, 0.02],
        [0.13, 0.3, 0.03],
        [0.06, 0.3, 0.01],
      ];
      const legGeo = side(leg, 0.08, { bevel: 0.012 });
      const legArmor = side([[0.17, 0.4, 0.02], [0.3, 0.3, 0.02], [0.36, 0.2, 0.01], [0.26, 0.24, 0.02], [0.14, 0.34, 0.02]], 0.094, { bevel: 0.006 });
      const foot = rbox(0.16, 0.05, 0.2, 0.018);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI;
        put(grp, legGeo, D, 0, 0, 0, 0, a, 0);
        put(grp, legArmor, orange, 0, 0, 0, 0, a, 0);
        put(grp, foot, rubber(), Math.sin(a) * -0.5, 0.025, Math.cos(a) * -0.5, 0, a, 0);
      }
      // hub + bearing + team light ring
      put(grp, latheY([[0, 0.24], [0.12, 0.24], [0.15, 0.28], [0.16, 0.44], [0.13, 0.5], [0.0, 0.5]], 16), D);
      put(grp, latheY([[0.1, 0.5], [0.17, 0.5], [0.185, 0.52], [0.185, 0.57], [0.17, 0.59], [0.1, 0.59]], 20), S);
      lit(grp, latheY([[0.162, 0.35], [0.166, 0.35], [0.166, 0.37], [0.162, 0.37]], 20), glow);
      put(grp, latheY([[0.0, 0.59], [0.09, 0.59], [0.09, 0.68], [0.0, 0.68]], 12), D);
      // head (yaws)
      const h = new THREE.Group();
      h.position.y = 0.85;
      grp.add(h);
      head = h;
      // main housing: aggressive wedge with sloped flanks, dark belly
      const hull: P2[] = [[-0.27, -0.1, 0.04], [0.1, -0.14, 0.03], [0.29, -0.08, 0.03], [0.31, 0.0, 0.02], [0.2, 0.1, 0.04], [-0.04, 0.17, 0.05], [-0.24, 0.15, 0.05], [-0.31, 0.05, 0.04]];
      put(h, side(hull, 0.36, { bevel: 0.016, top: 0.3, bot: 0.1 }), C);
      put(h, side([[-0.26, -0.15, 0.02], [0.1, -0.17, 0.02], [0.12, -0.08, 0.01], [-0.26, -0.06, 0.01]], 0.28, { bevel: 0.01, bot: 0.15 }), D);
      // dorsal plate in team paint + spine light
      put(h, side([[-0.2, 0.13, 0.02], [0.0, 0.15, 0.03], [0.12, 0.1, 0.02], [0.14, 0.12, 0.01], [0.0, 0.19, 0.03], [-0.22, 0.17, 0.02]], 0.16, { bevel: 0.01, top: 0.3 }), paint);
      lit(h, rbox(0.018, 0.012, 0.2, 0.004), glow, 0, 0.19, 0.07, -0.12, 0, 0);
      // cheek armour (team paint) + glow strips + ammo boxes with feed chutes
      for (const sx of [1, -1]) {
        put(h, side([[-0.22, -0.08, 0.02], [0.14, -0.1, 0.02], [0.2, -0.03, 0.02], [0.16, 0.06, 0.02], [-0.14, 0.09, 0.03], [-0.24, 0.02, 0.02]], 0.05, { bevel: 0.01, top: 0.2 }), paint, sx * 0.18);
        lit(h, rbox(0.012, 0.014, 0.24, 0.004), glow, sx * 0.207, -0.005, 0.0);
        put(h, rbox(0.07, 0.12, 0.2, 0.018), D, sx * 0.24, -0.04, 0.1);
        put(h, rbox(0.074, 0.02, 0.204, 0.006), orange, sx * 0.24, 0.0, 0.1);
        put(h, rbox(0.03, 0.03, 0.12, 0.008), S, sx * 0.16, -0.05, -0.08);
      }
      // twin barrels with ribbed shrouds
      for (const sx of [1, -1]) {
        put(h, tubeZ(0.03, 0.2, 0.62, 14), D, sx * 0.1, -0.03, 0);
        put(h, lathe([[0.0, 0.26], [0.048, 0.26], [0.05, 0.27], [0.05, 0.44], [0.044, 0.45], [0.0, 0.45]], 8, { phase: Math.PI / 8 }), S, sx * 0.1, -0.03, 0);
        for (let i = 0; i < 3; i++) put(h, lathe([[0.049, 0.29 + i * 0.05], [0.056, 0.295 + i * 0.05], [0.056, 0.315 + i * 0.05], [0.049, 0.32 + i * 0.05]], 8, { phase: Math.PI / 8 }), D, sx * 0.1, -0.03, 0);
        put(h, lathe([[0.03, 0.6], [0.044, 0.61], [0.044, 0.67], [0.018, 0.67], [0.018, 0.64], [0, 0.64]], 12), D, sx * 0.1, -0.03, 0);
        lit(h, new THREE.CircleGeometry(0.017, 12), glowMat(0xff9f43, 1.6), sx * 0.1, -0.03, -0.642, 0, Math.PI, 0);
      }
      // sensor eye (big lens) + visor strip
      put(h, lathe([[0, 0.22], [0.075, 0.22], [0.082, 0.24], [0.082, 0.29], [0.07, 0.3], [0.058, 0.3], [0.058, 0.285], [0, 0.285]], 20), D, 0, 0.07, 0);
      lit(h, new THREE.CircleGeometry(0.05, 20), glowHot, 0, 0.07, -0.288, 0, Math.PI, 0);
      put(h, new THREE.TorusGeometry(0.07, 0.006, 6, 24), S, 0, 0.07, -0.302);
      // top: sensor mast + small plate
      put(h, new THREE.CylinderGeometry(0.008, 0.01, 0.16, 8), S, 0.1, 0.21, 0.12);
      lit(h, rbox(0.018, 0.018, 0.018, 0.005), glowHot, 0.1, 0.3, 0.12);
      mergeStatic(h);
      mergeStatic(grp, [h]);
      break;
    }
    case 'huntdrone':
    case 'spotdrone':
    case 'kamikaze': {
      const col = kind === 'huntdrone' ? 0xe6e14d : kind === 'spotdrone' ? 0x4db8ff : 0xff5a3a;
      const tag = glowMat(col, 1.8);
      if (kind === 'huntdrone') {
        // Hive hunter "bee": dark thorax, yellow head with a big eye, striped abdomen with a stinger light,
        // four ducted fans as wings, twin guns under the chin
        const Y = toonMat(0xcaa92f, { spec: 0.5, rim: 0.4 });
        put(grp, lathe([[0, -0.13], [0.08, -0.115], [0.12, -0.06], [0.13, 0.0], [0.12, 0.06], [0.085, 0.1], [0, 0.11]], 16), D);
        put(grp, lathe([[0, 0.07], [0.075, 0.08], [0.1, 0.12], [0.1, 0.16], [0.08, 0.2], [0.045, 0.225], [0, 0.23]], 16), Y, 0, 0.015, 0);
        put(grp, lathe([[0.062, 0.2], [0.07, 0.205], [0.064, 0.226], [0.05, 0.23]], 16), rubber(), 0, 0.02, 0);
        lit(grp, new THREE.CircleGeometry(0.04, 18), glow, 0, 0.02, -0.229, 0, Math.PI, 0);
        const abd = new THREE.Group();
        abd.position.set(0, 0.02, 0.08);
        abd.rotation.x = -0.28;
        grp.add(abd);
        put(abd, lathe([[0, 0.02], [0.08, 0.0], [0.115, -0.07], [0.118, -0.15], [0.095, -0.24], [0.05, -0.3], [0, -0.31]], 16), Y);
        for (const [f, r] of [[-0.065, 0.112], [-0.15, 0.118], [-0.225, 0.1]]) put(abd, lathe([[r - 0.012, f + 0.018], [r + 0.004, f + 0.013], [r + 0.004, f - 0.013], [r - 0.012, f - 0.018]], 16), D);
        lit(abd, new THREE.SphereGeometry(0.022, 10, 8), glowHot, 0, 0, 0.305);
        // wings: ducted fans on swept arms
        for (const sx of [1, -1]) {
          for (const sz of [1, -1]) {
            const x = sx * 0.27;
            const z = sz * 0.12 - 0.02;
            put(grp, rbox(0.2, 0.03, 0.05, 0.012), D, sx * 0.14, 0.05, z * 0.7, 0, sx * sz * 0.35, sx * 0.25);
            put(grp, latheY([[0.085, -0.03], [0.1, -0.026], [0.104, 0.0], [0.1, 0.03], [0.085, 0.034], [0.078, 0.0], [0.085, -0.03]], 18), Y, x, 0.08, z);
            put(grp, latheY([[0, -0.012], [0.084, -0.012], [0.084, -0.004], [0.03, 0.0], [0.024, 0.014], [0, 0.016]], 16), D, x, 0.08, z);
            for (let k = 0; k < 3; k++) put(grp, new THREE.BoxGeometry(0.16, 0.008, 0.024), S, x, 0.08, z, 0.25, (k * Math.PI) / 3 + sx, 0);
            lit(grp, latheY([[0.072, -0.031], [0.08, -0.031], [0.08, -0.026], [0.072, -0.026]], 18), tag, x, 0.08, z);
          }
        }
        // chin guns
        put(grp, rbox(0.12, 0.06, 0.14, 0.02), D, 0, -0.1, -0.08);
        for (const sx of [1, -1]) {
          put(grp, tubeZ(0.014, 0.08, 0.3, 10), S, sx * 0.032, -0.105, 0);
          put(grp, lathe([[0.014, 0.28], [0.021, 0.285], [0.021, 0.32], [0.01, 0.32], [0.01, 0.3], [0, 0.3]], 6), D, sx * 0.032, -0.105, 0);
        }
        lit(grp, rbox(0.01, 0.01, 0.14, 0.004), glow, 0, 0.13, -0.01);
      } else if (kind === 'spotdrone') {
        // spotter: white saucer with a team-lit rim, big iris eye pod up front, radar dish on a mast, two ducts
        const W = white();
        put(grp, latheY([[0, -0.06], [0.12, -0.052], [0.2, -0.024], [0.222, 0.0], [0.2, 0.024], [0.13, 0.05], [0.07, 0.07], [0, 0.074]], 24), W);
        lit(grp, latheY([[0.221, -0.007], [0.226, -0.005], [0.226, 0.005], [0.221, 0.007]], 24), glow);
        put(grp, latheY([[0, -0.066], [0.1, -0.058], [0.1, -0.05], [0, -0.05]], 16), paint);
        // eye pod
        put(grp, new THREE.SphereGeometry(0.095, 18, 12), D, 0, -0.01, -0.16);
        put(grp, lathe([[0.07, 0.2], [0.09, 0.205], [0.095, 0.23], [0.08, 0.26], [0.064, 0.262], [0.064, 0.245], [0, 0.245]], 20), D, 0, -0.01, 0);
        lit(grp, new THREE.CircleGeometry(0.062, 20), glowMat(col, 1.5), 0, -0.01, -0.247, 0, Math.PI, 0);
        put(grp, lathe([[0, 0.24], [0.028, 0.25], [0.02, 0.262], [0, 0.266]], 12), rubber(), 0, -0.01, 0);
        lit(grp, new THREE.TorusGeometry(0.078, 0.005, 6, 24), glowHot, 0, -0.01, -0.262);
        // radar dish on a mast
        put(grp, new THREE.CylinderGeometry(0.012, 0.016, 0.12, 8), S, 0, 0.13, 0.04);
        const dish = latheY([[0, 0], [0.03, 0.004], [0.075, 0.022], [0.092, 0.036], [0.086, 0.04], [0.068, 0.029], [0.026, 0.011], [0, 0.008]], 18);
        put(grp, dish, W, 0, 0.19, 0.03, 0.9, 0, 0);
        lit(grp, new THREE.SphereGeometry(0.012, 8, 6), tag, 0, 0.215, 0.0);
        // side ducts
        for (const sx of [1, -1]) {
          put(grp, rbox(0.1, 0.035, 0.07, 0.014), D, sx * 0.25, 0.0, 0.04);
          put(grp, latheY([[0.07, -0.028], [0.085, -0.024], [0.09, 0.0], [0.085, 0.028], [0.07, 0.032], [0.064, 0.0], [0.07, -0.028]], 18), paint, sx * 0.33, 0.0, 0.04);
          lit(grp, latheY([[0.058, -0.029], [0.066, -0.029], [0.066, -0.023], [0.058, -0.023]], 18), tag, sx * 0.33, 0.0, 0.04);
          put(grp, latheY([[0, -0.012], [0.07, -0.012], [0.07, -0.005], [0.026, 0.0], [0.022, 0.012], [0, 0.014]], 14), D, sx * 0.33, 0.0, 0.04);
          for (let k = 0; k < 3; k++) put(grp, new THREE.BoxGeometry(0.13, 0.007, 0.02), S, sx * 0.33, 0.0, 0.04, 0.25, (k * Math.PI) / 3, 0);
        }
        // tail antennae
        for (const sx of [1, -1]) put(grp, new THREE.CylinderGeometry(0.004, 0.006, 0.16, 6), S, sx * 0.05, 0.1, 0.17, 0.6, 0, sx * -0.3);
      } else {
        // kamikaze: armoured sea-mine orb (horns), hazard belt, red eye, three little rotors
        put(grp, new THREE.SphereGeometry(0.2, 20, 14), D);
        const belt = new THREE.Mesh(bandGeo(0.205, 0.08, 24), toonMat(0xffffff, { map: hazardTex(), spec: 0.4 }));
        grp.add(belt);
        const horn = latheY([[0.034, 0], [0.03, 0.06], [0.016, 0.095], [0, 0.1]], 8);
        const hornCap = new THREE.CylinderGeometry(0.036, 0.036, 0.014, 10);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          const el = i % 2 ? 0.55 : -0.5;
          const dir = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          const e = new THREE.Euler().setFromQuaternion(q);
          put(grp, horn, S, dir.x * 0.185, dir.y * 0.185, dir.z * 0.185, e.x, e.y, e.z);
          put(grp, hornCap, D, dir.x * 0.19, dir.y * 0.19, dir.z * 0.19, e.x, e.y, e.z);
        }
        put(grp, lathe([[0, 0.12], [0.07, 0.13], [0.08, 0.17], [0.07, 0.2], [0, 0.21]], 14), rubber(), 0, 0, 0);
        lit(grp, new THREE.CircleGeometry(0.05, 14), glowMat(0xff3020, 3.5), 0, 0, -0.212, 0, Math.PI, 0);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
          const x = Math.cos(a) * 0.26;
          const z = Math.sin(a) * 0.26;
          put(grp, rbox(0.16, 0.025, 0.04, 0.01), D, x * 0.6, 0.15, z * 0.6, 0, -a, 0);
          put(grp, latheY([[0.06, -0.02], [0.072, -0.016], [0.072, 0.016], [0.06, 0.02], [0.056, 0], [0.06, -0.02]], 16), toonMat(0xb02a22, { spec: 0.5 }), x, 0.17, z);
          lit(grp, latheY([[0.048, -0.022], [0.056, -0.022], [0.056, -0.016], [0.048, -0.016]], 16), glow, x, 0.17, z);
        }
        lit(grp, latheY([[0.2, -0.004], [0.207, -0.004], [0.207, 0.004], [0.2, 0.004]], 24), glowMat(0xff3020, 2.2), 0, 0.055, 0);
        lit(grp, latheY([[0.2, -0.004], [0.207, -0.004], [0.207, 0.004], [0.2, 0.004]], 24), glowMat(0xff3020, 2.2), 0, -0.055, 0);
      }
      mergeStatic(grp);
      grp.scale.setScalar(kind === 'kamikaze' ? 0.8 : 1);
      break;
    }
    case 'barricade': {
      // hard-light reinforced cover wall: 3 armour panels between emitter pylons on a base rail
      const panelMat = toonMat(0x7d838e, { spec: 0.7, rim: 0.4 });
      const W = white();
      // base rail + stabiliser feet
      put(grp, sect([[-1.6, 0.0, 0.02], [1.6, 0.0, 0.02], [1.58, 0.16, 0.03], [-1.58, 0.16, 0.03]], -0.22, 0.22, { bevel: 0.02 }), D);
      for (const x of [-1.1, 0, 1.1]) put(grp, side([[-0.46, 0.0, 0.02], [0.46, 0.0, 0.02], [0.4, 0.08, 0.03], [0.2, 0.16, 0.02], [-0.2, 0.16, 0.02], [-0.4, 0.08, 0.03]], 0.14, { bevel: 0.015 }), D, x);
      // armour panels (chamfered slabs, slightly canted), light panel paint + team-painted top band
      const pw = 0.94;
      const slab: P2[] = [
        [-pw / 2, 0.0, 0.0],
        [pw / 2, 0.0, 0.0],
        [pw / 2, 1.16, 0.0],
        [pw / 2 - 0.1, 1.28, 0.0],
        [-pw / 2 + 0.1, 1.28, 0.0],
        [-pw / 2, 1.16, 0.0],
      ];
      for (const [i, x] of [-1.02, 0, 1.02].entries()) {
        put(grp, sect(slab, -0.17, 0.17, { bevel: 0.035 }), i === 1 ? W : panelMat, x, 0.16, 0, 0, 0, 0);
        put(grp, sect([[-pw / 2 + 0.06, 0.0], [pw / 2 - 0.06, 0.0], [pw / 2 - 0.06, 0.12], [-pw / 2 + 0.06, 0.12]], -0.185, 0.185, { bevel: 0.02 }), paint, x, 0.98, 0);
        // horizontal armour ribs
        for (const y of [0.34, 0.66]) put(grp, sect([[-pw / 2 + 0.08, 0.0], [pw / 2 - 0.08, 0.0], [pw / 2 - 0.1, 0.07], [-pw / 2 + 0.1, 0.07]], -0.19, 0.19, { bevel: 0.015 }), D, x, y, 0);
      }
      // seams between panels: hard-light strips
      for (const x of [-0.51, 0.51]) {
        put(grp, sect([[-0.04, 0.0], [0.04, 0.0], [0.04, 1.3], [-0.04, 1.3]], -0.15, 0.15, { bevel: 0.01 }), D, x, 0.16, 0);
        lit(grp, rbox(0.03, 1.1, 0.31, 0.01), glow, x, 0.8, 0);
      }
      // end pylons with emitter heads
      for (const sx of [1, -1]) {
        put(grp, side([[-0.22, 0.0, 0.02], [0.22, 0.0, 0.02], [0.2, 1.4, 0.04], [0.12, 1.62, 0.03], [-0.12, 1.62, 0.03], [-0.2, 1.4, 0.04]], 0.16, { bevel: 0.02 }), D, sx * 1.52);
        put(grp, side([[-0.16, 0.2, 0.02], [0.16, 0.2, 0.02], [0.15, 1.3, 0.03], [-0.15, 1.3, 0.03]], 0.176, { bevel: 0.012 }), paint, sx * 1.52);
        lit(grp, rbox(0.04, 1.0, 0.04, 0.012), glowHot, sx * 1.52, 0.78, 0.2);
        lit(grp, rbox(0.04, 1.0, 0.04, 0.012), glowHot, sx * 1.52, 0.78, -0.2);
        put(grp, rbox(0.2, 0.08, 0.3, 0.025), S, sx * 1.52, 1.6, 0);
      }
      // top hard-light edge
      lit(grp, rbox(2.9, 0.04, 0.06, 0.015), glow, 0, 1.46, 0);
      mergeStatic(grp);
      break;
    }
  }
  return { mesh: grp, head };
}
