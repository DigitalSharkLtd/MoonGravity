import * as THREE from 'three';
import { toonMat, glowMat } from '../render/Toon';
import { pbr } from '../render/Materials';
import { brushedSet } from '../render/TextureGen';
import { WeaponId, WEAPONS } from './WeaponDefs';
import { hazardTex } from '../render/Textures';
import { P2, ExOpts, side, sect, lathe, tubeZ, rbox, put, mergeStatic, circle, bandGeo } from '../render/HardSurface';

export interface WeaponModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  glows: THREE.Mesh[];
  /** parts that animate (drum spin, charge rings) — spun around their local Z */
  spin?: THREE.Object3D;
  /** second weapon held in the left hand (twin pistols); positioned in the gun frame, detachable */
  offhand?: THREE.Object3D;
  /** muzzle of the left-hand weapon (twin pistols fire alternately) */
  offMuzzle?: THREE.Object3D;
  /** sight line for aiming down sights: height above the grip, rear / front window distance (f) and front window half-size */
  sight: { y: number; near: number; far: number; hw: number } | null;
}

/*
 * Stylised hard-surface sci-fi guns (Overwatch-ish: chunky readable silhouettes, layered painted
 * shells over a dark gunmetal chassis, chamfered edges, restrained emissive accents).
 * Frame: barrel → -Z, grip at the origin, y up. Builders use `f` = forward distance (z = -f).
 * Materials are few and shared through the toonMat cache: shell paint, gunmetal, steel, rubber,
 * hero tint, weapon glow — static parts are merged per material (≈5–7 draw calls per gun).
 */

// lunar sun is harsh (intensity ~4 at a fixed exposure): "white" paint is a light grey so lit faces stay
// just under blow-out, and hero tints are toned down to paint values
const shell = (c = 0xaeaca6) => toonMat(c, { spec: 0.5, rim: 0.4 });
function paintOf(tint: number): number {
  const c = new THREE.Color(tint);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(0.85, hsl.s), Math.min(0.42, hsl.l * 0.8));
  return c.getHex();
}
// gunmetal / steel share the heroes' procedural brushed-metal set (already generated, no extra cost)
const dark = () => pbr('w-dark', { color: 0x2f343e, set: brushedSet(24), repeat: 3, roughness: 1.3, metalness: 0.6, style: { rim: 0.45 } });
const steel = () => pbr('w-steel', { color: 0xa2aab8, set: brushedSet(25), repeat: 3, roughness: 1.15, metalness: 0.7, style: { rim: 0.4 } });
const rubber = () => toonMat(0x1c1f26, { spec: 0.15, rim: 0.3 });

type Mat = THREE.Material;

/** tiny DSL bound to one group: `at(geo, mat, x, y, f, rx, ry, rz)` with f = forward distance */
function kit(root: THREE.Object3D) {
  return (geo: THREE.BufferGeometry, mat: Mat, x = 0, y = 0, f = 0, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = root): THREE.Mesh => put(parent, geo, mat, x, y, -f, rx, ry, rz);
}
type At = ReturnType<typeof kit>;

/**
 * Shell = side profile with sloped flanks. Returns the geometry plus a function giving the shell's
 * half-width at height y — used to lay inlay panels flush on the slope.
 */
function shellGeo(pts: P2[], w: number, o: ExOpts = {}): { geo: THREE.BufferGeometry; hw: (y: number) => number } {
  const ys = pts.map((p) => p[1]);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const hw = (y: number) => {
    const t = (y - y0) / Math.max(1e-6, y1 - y0);
    return (w / 2) * (1 - (o.top ?? 0) * t) * (1 - (o.bot ?? 0) * (1 - t));
  };
  return { geo: side(pts, w, { bevel: 0.007, ...o }), hw };
}

/** decal-like panel sitting proud of a sloped shell (follows the slope; ignores nose/tail tapers) */
function inlay(pts: P2[], hw: (y: number) => number, proud = 0.0018, bevel = 0.0022): THREE.BufferGeometry {
  const ys = pts.map((p) => p[1]);
  const a = hw(Math.min(...ys)) + proud;
  const b = hw(Math.max(...ys)) + proud;
  return side(pts, 2 * a, { top: 1 - b / a, bevel });
}

// ---------------------------------------------------------------- shared parts

/** raked pistol grip with palm swell; top at y=0 around f=0 */
function pistolGrip(at: At, mat: Mat, w = 0.05, f = 0, scale = 1): void {
  const s = scale;
  const pts: P2[] = [
    [f + 0.036 * s, 0.004, 0.004],
    [f + 0.03 * s, -0.035 * s, 0.012],
    [f + 0.012 * s, -0.1 * s, 0.03],
    [f + 0.004 * s, -0.142 * s, 0.01],
    [f - 0.058 * s, -0.15 * s, 0.012],
    [f - 0.052 * s, -0.1 * s, 0.035],
    [f - 0.036 * s, -0.03 * s, 0.02],
    [f - 0.045 * s, 0.004, 0.004],
  ];
  at(side(pts, w, { bevel: 0.006, bot: 0.08 }), mat);
  // base plate
  at(side([[f + 0.006 * s, -0.138 * s, 0.006], [f - 0.062 * s, -0.146 * s, 0.006], [f - 0.064 * s, -0.162 * s, 0.006], [f + 0.008 * s, -0.154 * s, 0.006]], w + 0.006, { bevel: 0.003 }), mat);
}

/** trigger guard loop + trigger in front of the grip */
function triggerGuard(at: At, mat: Mat, f = 0.035, len = 0.085, drop = 0.07, w = 0.016): void {
  const outer: P2[] = [
    [f, 0.0, 0],
    [f + len, 0.0, 0],
    [f + len, -drop * 0.45, 0.012],
    [f + len * 0.78, -drop, 0.018],
    [f, -drop, 0.01],
  ];
  const hole: P2[] = [
    [f + 0.012, -0.012, 0.004],
    [f + len - 0.012, -0.012, 0.004],
    [f + len - 0.014, -drop * 0.42, 0.008],
    [f + len * 0.72, -drop + 0.012, 0.01],
    [f + 0.01, -drop + 0.012, 0.004],
  ];
  at(side(outer, w, { holes: [hole], bevel: 0.003 }), mat);
  at(side([[f + 0.03, -0.012, 0.002], [f + 0.042, -0.012, 0.002], [f + 0.03, -0.05, 0.008], [f + 0.02, -0.05, 0.004]], 0.008, { bevel: 0.002 }), mat);
}

/** muzzle brake with a real bore and an optional glowing bore disc */
function muzzleBrake(at: At, mat: Mat, y: number, f0: number, len: number, r: number, bore: number, seg = 12, glow?: Mat, x = 0): void {
  at(
    lathe(
      [
        [r * 0.62, f0],
        [r * 0.96, f0 + 0.004],
        [r, f0 + 0.012],
        [r, f0 + len - 0.01],
        [r * 0.86, f0 + len],
        [bore, f0 + len],
        [bore, f0 + len - 0.03],
        [0, f0 + len - 0.03],
      ],
      seg,
      { phase: Math.PI / seg },
    ),
    mat,
    x,
    y,
  );
  if (glow) at(new THREE.CircleGeometry(bore * 0.95, 12), glow, x, y, f0 + len - 0.028, 0, Math.PI, 0);
}

/** round screw heads (axis along X) on both flanks */
const boltGeo = new Map<number, THREE.BufferGeometry>();
function bolts(at: At, mat: Mat, pts: [number, number][], x: number | ((y: number) => number), r = 0.0055): void {
  let geo = boltGeo.get(r);
  if (!geo) boltGeo.set(r, (geo = new THREE.CylinderGeometry(r, r, 0.004, 6)));
  for (const [f, y] of pts) {
    const xx = typeof x === 'number' ? x : x(y) + 0.001;
    for (const sx of [xx, -xx]) at(geo, mat, sx, y, f, 0, 0, Math.PI / 2);
  }
}

/** short accessory rail with teeth on top of a receiver */
function topRail(at: At, mat: Mat, y: number, f0: number, f1: number, w = 0.026): void {
  at(sect([[-w / 2, y], [w / 2, y], [w / 2, y + 0.008], [-w / 2, y + 0.008]], f0, f1, { bevel: 0.002 }), mat);
  const n = Math.floor((f1 - f0) / 0.022);
  const tooth = new THREE.BoxGeometry(w + 0.004, 0.006, 0.01);
  for (let i = 0; i < n; i++) at(tooth, mat, 0, y + 0.01, f0 + 0.014 + i * 0.022);
}

/** inner windows of the frame sights of the gun being built: [low, high, f, half-width] */
let sightWins: [number, number, number, number][] = [];

/** open frame sight (hood with a window) on top of the gun */
function frameSight(at: At, mat: Mat, y: number, f0: number, f1: number, hw: number, h: number): void {
  sightWins.push([y + 0.008, y + h - 0.008, (f0 + f1) / 2, hw - 0.008]);
  at(
    sect([[-hw, y, 0.004], [hw, y, 0.004], [hw, y + h, 0.01], [-hw, y + h, 0.01]], f0, f1, {
      holes: [[[-hw + 0.008, y + 0.008, 0.003], [hw - 0.008, y + 0.008, 0.003], [hw - 0.008, y + h - 0.008, 0.006], [-hw + 0.008, y + h - 0.008, 0.006]]],
      bevel: 0.003,
    }),
    mat,
  );
}

// ---------------------------------------------------------------- nuke decal texture

let nukeTexCache: THREE.CanvasTexture | null = null;
/** yellow launcher tube skin: hazard bands + radiation trefoils (u = around, v = along) */
function nukeTex(): THREE.CanvasTexture {
  if (nukeTexCache) return nukeTexCache;
  const w = 512;
  const h = 512;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#e6ae1a';
  c.fillRect(0, 0, w, h);
  // subtle panel seams along the tube
  c.fillStyle = 'rgba(80,50,0,0.35)';
  for (const y of [140, 372]) c.fillRect(0, y, w, 4);
  const band = (y0: number, bh: number) => {
    c.save();
    c.beginPath();
    c.rect(0, y0, w, bh);
    c.clip();
    c.fillStyle = '#16181f';
    for (let i = -8; i < 40; i++) {
      c.beginPath();
      c.moveTo(i * 32, y0);
      c.lineTo(i * 32 + 16, y0);
      c.lineTo(i * 32 + 16 + bh, y0 + bh);
      c.lineTo(i * 32 + bh, y0 + bh);
      c.closePath();
      c.fill();
    }
    c.restore();
    c.fillStyle = '#16181f';
    c.fillRect(0, y0 - 3, w, 3);
    c.fillRect(0, y0 + bh, w, 3);
  };
  band(30, 48);
  band(430, 48);
  // trefoils on both flanks — drawn in metres so they stay round on the tube (C = 2πR around, L along)
  const C = 2 * Math.PI * 0.11;
  const L = 1.16;
  const trefoil = (u: number, v: number, r: number) => {
    c.save();
    c.translate(u * w, (1 - v) * h);
    c.scale(w / C, h / L);
    c.fillStyle = '#16181f';
    c.beginPath();
    c.arc(0, 0, r * 1.2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#e6ae1a';
    c.beginPath();
    c.arc(0, 0, r * 1.07, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#16181f';
    for (let k = 0; k < 3; k++) {
      const a0 = -Math.PI / 2 + (k * Math.PI * 2) / 3 - Math.PI / 6;
      c.beginPath();
      c.arc(0, 0, r * 0.95, a0, a0 + Math.PI / 3);
      c.arc(0, 0, r * 0.24, a0 + Math.PI / 3, a0, true);
      c.closePath();
      c.fill();
    }
    c.beginPath();
    c.arc(0, 0, r * 0.15, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  trefoil(0.25, 0.5, 0.055);
  trefoil(0.75, 0.5, 0.055);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  nukeTexCache = t;
  return t;
}

// ---------------------------------------------------------------- per-weapon builders

interface Ctx {
  g: THREE.Group;
  at: At;
  col: number;
  glow: Mat;
  glowSoft: Mat;
  accent: Mat;
  glows: THREE.Mesh[];
  muzzle: THREE.Object3D;
  spin?: THREE.Object3D;
  offhand?: THREE.Object3D;
  offMuzzle?: THREE.Object3D;
}

/** Condor's heavy pulse rifle: white split shell over a gunmetal chassis, vented shroud, under-barrel helix pod, skeleton stock */
function pulse(c: Ctx): void {
  const { at, glow, glowSoft, accent, glows } = c;
  const W = shell();
  const D = dark();
  const S = steel();
  at(side([[-0.06, -0.032, 0.01], [0.44, -0.032, 0.01], [0.46, 0.0, 0.01], [0.44, 0.05, 0.01], [0.36, 0.09, 0.02], [-0.06, 0.1, 0.01]], 0.07, { top: 0.15 }), D);
  // upper shell split in two panels (seam at f≈0.25)
  const rear = shellGeo([[-0.05, 0.004, 0.006], [0.245, 0.004, 0.004], [0.245, 0.11, 0.004], [0.04, 0.116, 0.035], [-0.05, 0.096, 0.015]], 0.09, { top: 0.28 });
  at(rear.geo, W);
  const front = shellGeo([[0.256, 0.004, 0.004], [0.37, 0.004, 0.006], [0.418, 0.045, 0.022], [0.37, 0.104, 0.02], [0.256, 0.11, 0.004]], 0.092, { top: 0.3 });
  at(front.geo, W);
  at(inlay([[0.27, 0.03], [0.35, 0.03], [0.372, 0.056], [0.292, 0.074]], front.hw), accent);
  at(inlay([[0.06, 0.064], [0.2, 0.064], [0.2, 0.08], [0.075, 0.084]], rear.hw), accent);
  at(inlay([[0.1, 0.02], [0.2, 0.02], [0.2, 0.05], [0.12, 0.05]].map((p) => [p[0], p[1], 0.004] as P2), rear.hw, 0.001), D);
  // lower front rail (support hand)
  at(side([[0.24, -0.028, 0.004], [0.44, -0.028, 0.004], [0.43, -0.05, 0.01], [0.26, -0.052, 0.01]], 0.062, { bevel: 0.004, bot: 0.1 }), rubber());
  const rib = new THREE.BoxGeometry(0.066, 0.006, 0.012);
  for (let i = 0; i < 4; i++) at(rib, rubber(), 0, -0.052, 0.285 + i * 0.035);
  // energy magazine with glowing cell window
  at(side([[0.13, 0.0, 0.004], [0.215, 0.0, 0.004], [0.24, -0.15, 0.012], [0.155, -0.155, 0.012]], 0.058, { bevel: 0.006, bot: 0.12 }), D);
  glows.push(at(rbox(0.06, 0.075, 0.03, 0.004), glow, 0, -0.085, 0.192, 0.18));
  at(side([[0.148, -0.128, 0.004], [0.238, -0.13, 0.004], [0.242, -0.152, 0.006], [0.155, -0.158, 0.006]], 0.062, { bevel: 0.003 }), accent);
  // vented barrel shroud: two side plates with slots + glowing core seen through them
  const slots: P2[][] = [0, 1, 2].map((i) => {
    const f = 0.455 + i * 0.05;
    return [
      [f, 0.03, 0.003],
      [f + 0.03, 0.03, 0.003],
      [f + 0.042, 0.064, 0.003],
      [f + 0.012, 0.064, 0.003],
    ];
  });
  const plate: P2[] = [[0.4, 0.004, 0.006], [0.635, 0.008, 0.012], [0.662, 0.045, 0.014], [0.635, 0.088, 0.012], [0.4, 0.096, 0.006]];
  for (const sx of [1, -1]) at(side(plate, 0.014, { holes: slots, bevel: 0.003, nose: 0.1 }), W, sx * 0.037);
  at(sect([[-0.043, 0.078, 0.004], [0.043, 0.078, 0.004], [0.032, 0.102, 0.01], [-0.032, 0.102, 0.01]], 0.41, 0.63, { bevel: 0.004 }), W);
  at(rbox(0.06, 0.08, 0.26, 0.008), D, 0, 0.045, 0.53);
  at(rbox(0.064, 0.024, 0.2, 0.004), glowSoft, 0, 0.047, 0.525);
  // under-barrel helix pod: three short tubes in a triangle, tint band, steel face
  const pc = -0.018;
  const tube = lathe([[0.0, 0.45], [0.013, 0.45], [0.014, 0.46], [0.014, 0.625], [0.009, 0.63], [0.009, 0.61], [0, 0.61]], 10);
  for (let k = 0; k < 3; k++) {
    const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
    at(tube, D, Math.cos(a) * 0.016, pc + Math.sin(a) * 0.016);
  }
  at(tubeZ(0.034, 0.48, 0.5, 16), accent, 0, pc);
  at(tubeZ(0.034, 0.585, 0.6, 16), S, 0, pc);
  // barrel + brake with glowing bore
  at(tubeZ(0.019, 0.64, 0.73, 14), S, 0, 0.045);
  at(tubeZ(0.025, 0.655, 0.672, 14), D, 0, 0.045);
  muzzleBrake(at, D, 0.045, 0.72, 0.1, 0.037, 0.013, 8, glow);
  // top rail + holo sight
  topRail(at, D, 0.112, 0.02, 0.3);
  frameSight(at, D, 0.118, 0.2, 0.23, 0.032, 0.06);
  frameSight(at, D, 0.118, 0.07, 0.09, 0.024, 0.04);
  at(sect([[-0.032, 0.118], [0.032, 0.118], [0.032, 0.126], [-0.032, 0.126]], 0.09, 0.2, { bevel: 0.002 }), D);
  at(rbox(0.012, 0.008, 0.012, 0.003), glow, 0, 0.183, 0.215); // lamp on top of the hood, clear of the sight picture
  // skeleton stock + butt pad + tint cheek riser
  at(
    side(
      [[-0.04, 0.09, 0.01], [-0.3, 0.075, 0.015], [-0.31, 0.06, 0.006], [-0.31, -0.065, 0.006], [-0.295, -0.078, 0.012], [-0.225, -0.075, 0.025], [-0.07, -0.01, 0.025], [-0.04, -0.005, 0.006]],
      0.052,
      { holes: [[[-0.105, 0.058], [-0.268, 0.05], [-0.268, -0.042], [-0.21, -0.042]].map((p) => [p[0], p[1], 0.014] as P2)], bevel: 0.006, top: 0.15 },
    ),
    W,
  );
  at(rbox(0.058, 0.155, 0.024, 0.008), rubber(), 0, -0.002, -0.322);
  at(side([[-0.11, 0.084], [-0.27, 0.074], [-0.275, 0.094, 0.008], [-0.13, 0.104, 0.01]], 0.04, { bevel: 0.004, top: 0.25 }), accent);
  pistolGrip(at, rubber(), 0.05);
  triggerGuard(at, D, 0.035, 0.09, 0.06);
  at(rbox(0.024, 0.016, 0.03, 0.004), S, 0.05, 0.07, 0.03);
  bolts(at, S, [[0.0, 0.03], [0.0, 0.08], [0.23, 0.09]], rear.hw);
  c.muzzle.position.set(0, 0.045, -0.83);
}

/** Needle's railgun: split rails wrapped in copper coil collars (spin), long scope, thumbhole stock, capacitor bank */
function rail(c: Ctx): void {
  const { g, at, col, glow, glowSoft, accent, glows } = c;
  const W = shell();
  const D = dark();
  const S = steel();
  const yc = 0.04;
  at(side([[-0.06, -0.022, 0.01], [0.36, -0.022, 0.01], [0.39, 0.02, 0.01], [0.36, 0.084, 0.01], [0.04, 0.09, 0.015], [-0.06, 0.084, 0.01]], 0.074, { top: 0.15 }), D);
  const shA = shellGeo([[0.05, 0.028, 0.008], [0.2, 0.028, 0.004], [0.2, 0.104, 0.004], [0.1, 0.106, 0.02], [0.04, 0.07, 0.015]], 0.086, { top: 0.3 });
  at(shA.geo, W);
  const shB = shellGeo([[0.21, 0.028, 0.004], [0.33, 0.026, 0.01], [0.41, 0.058, 0.015], [0.36, 0.1, 0.02], [0.21, 0.104, 0.004]], 0.088, { top: 0.3, nose: 0.12 });
  at(shB.geo, W);
  at(inlay([[0.22, 0.056], [0.33, 0.056], [0.35, 0.072], [0.235, 0.078]], shB.hw), accent);
  // capacitor bank on the flank (charge lights)
  at(inlay([[-0.04, 0.012], [0.035, 0.012], [0.035, 0.068], [-0.04, 0.068]].map((p) => [p[0], p[1], 0.006] as P2), (y) => 0.037 * (1 - 0.15 * ((y + 0.022) / 0.112)), 0.004, 0.003), D);
  for (let i = 0; i < 3; i++) at(rbox(0.086, 0.008, 0.06, 0.002), glowSoft, 0, 0.024 + i * 0.016, -0.003);
  // rails (top / bottom) with a glowing channel
  const railTop: P2[] = [[0.35, yc + 0.018, 0.004], [0.96, yc + 0.018, 0.004], [1.03, yc + 0.03, 0.006], [0.99, yc + 0.045, 0.006], [0.35, yc + 0.047, 0.004]];
  const railBot: P2[] = railTop.map((p) => [p[0], 2 * yc - p[1], p[2]] as P2).reverse();
  at(side(railTop, 0.034, { bevel: 0.004, top: 0.3 }), S);
  at(side(railBot, 0.034, { bevel: 0.004, bot: 0.3 }), S);
  at(side([[0.35, yc + 0.03], [0.93, yc + 0.03], [0.93, yc + 0.043], [0.35, yc + 0.043]], 0.038, { bevel: 0.003 }), D);
  at(side([[0.35, yc - 0.03], [0.93, yc - 0.03], [0.93, yc - 0.043], [0.35, yc - 0.043]], 0.038, { bevel: 0.003 }), D);
  at(rbox(0.012, 0.01, 0.58, 0.003), glowSoft, 0, yc, 0.66);
  // coil collars (spin around the barrel axis)
  const coils = new THREE.Group();
  coils.position.set(0, yc, -0.69);
  g.add(coils);
  const collar = lathe([[0.062, -0.016], [0.074, -0.016], [0.079, -0.006], [0.079, 0.006], [0.074, 0.016], [0.062, 0.016], [0.062, -0.016]], 6, { phase: Math.PI / 6 });
  const copper = toonMat(0xb8743c, { spec: 0.85, rim: 0.4 });
  const band = lathe([[0.0795, -0.004], [0.0815, -0.004], [0.0815, 0.004], [0.0795, 0.004], [0.0795, -0.004]], 6, { phase: Math.PI / 6 });
  for (let i = 0; i < 4; i++) {
    const f = -0.21 + i * 0.14;
    put(coils, collar, copper, 0, 0, -f);
    glows.push(put(coils, band, glow, 0, 0, -f));
  }
  mergeStatic(coils, glows);
  c.spin = coils;
  // scope
  const sy = 0.148;
  at(
    lathe([[0, -0.03], [0.02, -0.03], [0.026, -0.018], [0.026, 0.02], [0.019, 0.05], [0.019, 0.21], [0.03, 0.25], [0.033, 0.26], [0.033, 0.31], [0.028, 0.316], [0.024, 0.316], [0.024, 0.305], [0, 0.305]], 16),
    D,
    0,
    sy,
  );
  at(new THREE.CircleGeometry(0.024, 16), glowMat(col, 1.1), 0, sy, 0.306, 0, Math.PI, 0);
  at(tubeZ(0.028, 0.1, 0.13, 16), accent, 0, sy);
  at(new THREE.CylinderGeometry(0.011, 0.011, 0.026, 10), S, 0, sy + 0.028, 0.12);
  at(new THREE.CylinderGeometry(0.011, 0.011, 0.026, 10), S, 0.028, sy, 0.12, 0, 0, Math.PI / 2);
  for (const f of [0.06, 0.2]) at(sect([[-0.018, 0.086], [0.018, 0.086], [0.012, sy - 0.012], [-0.012, sy - 0.012]], f - 0.014, f + 0.014, { bevel: 0.003 }), D);
  // thumbhole stock + cheek pad + butt
  at(
    side(
      [[-0.05, 0.084, 0.01], [-0.32, 0.066, 0.015], [-0.335, 0.05, 0.006], [-0.335, -0.075, 0.006], [-0.315, -0.09, 0.012], [-0.24, -0.088, 0.02], [-0.12, -0.02, 0.03], [-0.05, -0.02, 0.006]],
      0.052,
      { holes: [[[-0.11, 0.046], [-0.255, 0.04], [-0.255, -0.05], [-0.2, -0.055], [-0.14, -0.006]].map((p) => [p[0], p[1], 0.015] as P2)], bevel: 0.006, top: 0.15 },
    ),
    W,
  );
  at(side([[-0.12, 0.08], [-0.3, 0.066], [-0.3, 0.09, 0.008], [-0.14, 0.1, 0.012]], 0.038, { bevel: 0.004, top: 0.25 }), accent);
  at(rbox(0.058, 0.17, 0.022, 0.008), rubber(), 0, -0.012, -0.345);
  // handguard (support hand) + heat-sink fins
  at(side([[0.23, -0.02, 0.004], [0.43, -0.02, 0.004], [0.42, -0.048, 0.012], [0.25, -0.05, 0.012]], 0.058, { bevel: 0.005, bot: 0.1 }), rubber());
  const fin = new THREE.BoxGeometry(0.07, 0.03, 0.007);
  for (let i = 0; i < 4; i++) at(fin, S, 0, 0.1, 0.07 + i * 0.022);
  pistolGrip(at, rubber(), 0.05);
  triggerGuard(at, D, 0.035, 0.085, 0.058);
  bolts(at, S, [[0.36, 0.0], [0.0, 0.03]], 0.038);
  c.muzzle.position.set(0, yc, -1.03);
}

/** Reactor's plasma caster: bulbous armoured housing, caged plasma capsule, finned neck, big clawed emitter bell */
function plasma(c: Ctx): void {
  const { at, col, glowSoft, accent, glows, g } = c;
  const W = shell();
  const D = dark();
  const S = steel();
  const yc = 0.035;
  at(side([[-0.08, -0.03, 0.015], [0.3, -0.04, 0.015], [0.34, 0.0, 0.01], [0.34, 0.08, 0.015], [0.1, 0.09, 0.02], [-0.08, 0.084, 0.02]], 0.12, { top: 0.2 }), D);
  const shA = shellGeo([[-0.065, 0.0, 0.01], [0.105, -0.006, 0.004], [0.105, 0.118, 0.004], [-0.02, 0.112, 0.04], [-0.065, 0.09, 0.02]], 0.15, { top: 0.35, bot: 0.12 });
  at(shA.geo, W);
  const shB = shellGeo([[0.115, -0.006, 0.004], [0.27, -0.012, 0.012], [0.33, 0.03, 0.03], [0.31, 0.1, 0.03], [0.2, 0.12, 0.035], [0.115, 0.118, 0.004]], 0.152, { top: 0.35, bot: 0.12 });
  at(shB.geo, W);
  at(inlay([[0.13, 0.03], [0.25, 0.024], [0.28, 0.058], [0.15, 0.07]], shB.hw), accent);
  // rear vent: dark recess + glowing slats
  at(inlay([[-0.05, 0.02, 0.006], [0.07, 0.02, 0.006], [0.07, 0.08, 0.006], [-0.05, 0.08, 0.006]], shA.hw, 0.003, 0.003), D);
  const slat = new THREE.BoxGeometry(1, 0.008, 0.1);
  for (let i = 0; i < 3; i++) {
    const y = 0.032 + i * 0.018;
    const m = at(slat, glowSoft, 0, y, 0.01);
    m.scale.x = 2 * shA.hw(y) + 0.008;
  }
  // plasma capsule in a cage (top)
  const cy = 0.158;
  const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.13, 6, 14), glowMat(col, 1.3));
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, cy, -0.155);
  g.add(cap);
  glows.push(cap);
  for (const f of [0.115, 0.195]) at(tubeZ(0.034, f - 0.006, f + 0.006, 16), D, 0, cy);
  at(lathe([[0, 0.0], [0.024, 0.006], [0.04, 0.02], [0.044, 0.03], [0.044, 0.062], [0.03, 0.066], [0, 0.066]], 16), D, 0, cy);
  at(lathe([[0, 0.244], [0.044, 0.244], [0.046, 0.25], [0.046, 0.27], [0.036, 0.284], [0, 0.29]], 16), D, 0, cy);
  for (const f of [0.058, 0.25]) at(tubeZ(0.047, f, f + 0.008, 16), S, 0, cy);
  const bar = rbox(0.009, 0.009, 0.22, 0.003);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    at(bar, D, Math.cos(a) * 0.042, cy + Math.sin(a) * 0.042, 0.155);
  }
  at(side([[0.04, 0.105], [0.27, 0.105], [0.26, 0.13, 0.01], [0.05, 0.13, 0.01]], 0.05, { bevel: 0.004 }), D);
  // finned neck + emitter bell + four claws + inner plasma glow
  const fins: [number, number][] = [[0.0, 0.3]];
  for (let i = 0; i < 4; i++) {
    const f = 0.3 + i * 0.015;
    fins.push([0.058, f], [0.08, f + 0.002], [0.08, f + 0.006], [0.058, f + 0.008]);
  }
  fins.push([0.058, 0.365], [0, 0.365]);
  at(lathe(fins, 16), D, 0, yc);
  at(
    lathe([[0.05, 0.36], [0.066, 0.37], [0.07, 0.4], [0.07, 0.43], [0.094, 0.48], [0.1, 0.5], [0.092, 0.51], [0.07, 0.49], [0.056, 0.445], [0.0, 0.445]], 20),
    D,
    0,
    yc,
  );
  at(lathe([[0.096, 0.488], [0.103, 0.494], [0.103, 0.506], [0.094, 0.512], [0.09, 0.5]], 20), S, 0, yc);
  at(tubeZ(0.073, 0.395, 0.425, 20), accent, 0, yc);
  at(new THREE.CircleGeometry(0.055, 18), glowMat(col, 1.6), 0, yc, 0.448, 0, Math.PI, 0);
  const claw = side([[0.42, 0.064, 0.006], [0.52, 0.092, 0.02], [0.6, 0.082, 0.012], [0.63, 0.056, 0.004], [0.575, 0.062, 0.012], [0.48, 0.056, 0.006]], 0.024, { bevel: 0.004, top: 0.3 });
  for (let i = 0; i < 4; i++) at(claw, D, 0, yc, 0, 0, 0, Math.PI / 4 + (i * Math.PI) / 2);
  // pump foregrip (ribbed)
  at(side([[0.17, -0.036, 0.006], [0.33, -0.04, 0.006], [0.335, -0.07, 0.012], [0.31, -0.092, 0.014], [0.2, -0.092, 0.014], [0.17, -0.07, 0.01]], 0.074, { bevel: 0.006, bot: 0.15 }), rubber());
  const rib = rbox(0.078, 0.042, 0.008, 0.003);
  for (let i = 0; i < 4; i++) at(rib, D, 0, -0.068, 0.21 + i * 0.03);
  // stubby stock
  at(
    side([[-0.07, 0.084, 0.01], [-0.2, 0.074, 0.015], [-0.225, 0.05, 0.01], [-0.225, -0.06, 0.01], [-0.19, -0.072, 0.012], [-0.1, -0.03, 0.02], [-0.07, -0.025, 0.006]], 0.08, {
      holes: [[[-0.105, 0.05], [-0.185, 0.046], [-0.185, -0.03], [-0.135, -0.012]].map((p) => [p[0], p[1], 0.012] as P2)],
      bevel: 0.007,
      top: 0.2,
    }),
    W,
  );
  at(rbox(0.086, 0.14, 0.024, 0.008), rubber(), 0, 0.0, -0.232);
  pistolGrip(at, rubber(), 0.056);
  triggerGuard(at, D, 0.035, 0.09, 0.06, 0.018);
  bolts(at, S, [[0.28, 0.06], [0.14, 0.09], [0.14, 0.012]], shB.hw);
  c.muzzle.position.set(0, yc, -0.5);
}

/** Lunatic's drum launcher: revolving 6-shot cylinder (spin), fat ringed barrel with a flared muzzle, ring sight */
function glauncher(c: Ctx): void {
  const { g, at, glow, glowSoft, accent } = c;
  const Y = shell(0xd6a025);
  const D = dark();
  const S = steel();
  const yd = 0.05; // drum axis
  const yb = yd + 0.052; // barrel axis (top chamber)
  // rear receiver
  at(side([[-0.07, -0.03, 0.012], [0.13, -0.036, 0.008], [0.13, 0.14, 0.008], [0.03, 0.15, 0.02], [-0.07, 0.12, 0.02]], 0.086, { top: 0.15 }), D);
  const rec = shellGeo([[-0.06, 0.02, 0.008], [0.105, 0.02, 0.008], [0.125, 0.08, 0.015], [0.105, 0.158, 0.015], [0.02, 0.166, 0.025], [-0.06, 0.134, 0.015]], 0.1, { top: 0.3 });
  at(rec.geo, Y);
  at(inlay([[-0.035, 0.06], [0.07, 0.056], [0.085, 0.1], [-0.02, 0.11]], rec.hw), accent);
  at(inlay([[-0.04, 0.03, 0.004], [0.08, 0.03, 0.004], [0.08, 0.042, 0.004], [-0.04, 0.042, 0.004]], rec.hw, 0.001), D);
  // drum (spins around its axis): dark core, steel tubes with yellow bands, glowing grenade caps
  const drum = new THREE.Group();
  drum.position.set(0, yd, -0.235);
  g.add(drum);
  put(drum, lathe([[0, -0.1], [0.036, -0.1], [0.046, -0.09], [0.046, 0.09], [0.036, 0.1], [0, 0.1]], 12), D);
  const tube = lathe([[0, -0.095], [0.022, -0.095], [0.027, -0.088], [0.027, 0.088], [0.022, 0.095], [0, 0.095]], 10);
  const tip = lathe([[0.02, -0.098], [0.02, -0.095], [0.012, -0.104], [0, -0.107]], 10);
  const ringG = lathe([[0.0275, -0.03], [0.0295, -0.028], [0.0295, 0.028], [0.0275, 0.03]], 10);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    const x = Math.cos(a) * 0.052;
    const y = Math.sin(a) * 0.052;
    put(drum, tube, S, x, y, 0);
    put(drum, ringG, Y, x, y, 0);
    put(drum, tip, glowSoft, x, y, 0);
  }
  put(drum, tubeZ(0.02, -0.106, -0.09, 12), D, 0, 0, 0);
  mergeStatic(drum);
  c.spin = drum;
  // frame: top strap over the drum, lower strap, front plate, axle
  at(side([[0.1, yb + 0.03, 0.006], [0.36, yb + 0.032, 0.006], [0.37, yb + 0.062, 0.01], [0.12, yb + 0.07, 0.015], [0.1, yb + 0.05, 0.006]], 0.056, { bevel: 0.005, top: 0.3 }), Y);
  at(side([[0.1, -0.03, 0.006], [0.36, -0.03, 0.006], [0.37, -0.012, 0.006], [0.1, -0.008, 0.006]], 0.044, { bevel: 0.004 }), D);
  at(sect([[-0.052, -0.034, 0.012], [0.052, -0.034, 0.012], [0.058, yb + 0.056, 0.02], [-0.058, yb + 0.056, 0.02]], 0.335, 0.37, { bevel: 0.006 }), D);
  at(tubeZ(0.012, 0.12, 0.35, 10), S, 0, yd);
  // barrel: yellow sleeve with dark cooling rings, hazard band, big flared muzzle with bore
  at(lathe([[0.0, 0.37], [0.053, 0.37], [0.056, 0.38], [0.056, 0.53], [0.053, 0.54], [0.0, 0.54]], 18), Y, 0, yb);
  for (const f of [0.4, 0.46]) at(lathe([[0.055, f], [0.06, f + 0.003], [0.06, f + 0.015], [0.055, f + 0.018]], 18), D, 0, yb);
  const band = new THREE.Mesh(bandGeo(0.0572, 0.032, 18), toonMat(0xffffff, { map: hazardTex(), spec: 0.4 }));
  band.rotation.x = Math.PI / 2;
  band.position.set(0, yb, -0.515);
  g.add(band);
  at(lathe([[0.048, 0.53], [0.058, 0.54], [0.074, 0.6], [0.077, 0.63], [0.07, 0.64], [0.044, 0.64], [0.044, 0.58], [0, 0.58]], 18), D, 0, yb);
  at(new THREE.CircleGeometry(0.043, 18), glowMat(0xff8a2a, 1.1), 0, yb, 0.582, 0, Math.PI, 0);
  // ring sight at the front + rear notch, lamp
  at(sect(circle(0, yb + 0.1, 0.03, 16), 0.33, 0.342, { holes: [circle(0, yb + 0.1, 0.021, 16)], bevel: 0.002 }), D);
  at(side([[0.325, yb + 0.056], [0.345, yb + 0.056], [0.342, yb + 0.075], [0.328, yb + 0.075]], 0.01, { bevel: 0.002 }), D);
  at(side([[0.0, yb + 0.056], [0.03, yb + 0.056], [0.03, yb + 0.085, 0.004], [0.0, yb + 0.085, 0.004]], 0.03, { bevel: 0.003, holes: [[[0.01, yb + 0.072], [0.02, yb + 0.072], [0.02, yb + 0.09], [0.01, yb + 0.09]]] }), D);
  at(rbox(0.016, 0.014, 0.016, 0.004), glow, 0.04, yb + 0.05, 0.22);
  // foregrip under the drum frame
  at(side([[0.2, -0.03, 0.004], [0.34, -0.03, 0.004], [0.33, -0.062, 0.012], [0.22, -0.064, 0.012]], 0.058, { bevel: 0.005, bot: 0.12 }), rubber());
  // stock
  at(
    side([[-0.06, 0.12, 0.01], [-0.28, 0.1, 0.02], [-0.3, 0.07, 0.006], [-0.3, -0.06, 0.006], [-0.27, -0.072, 0.012], [-0.16, -0.05, 0.03], [-0.07, -0.02, 0.006]], 0.058, {
      holes: [[[-0.1, 0.085], [-0.255, 0.07], [-0.255, -0.03], [-0.17, -0.02]].map((p) => [p[0], p[1], 0.015] as P2)],
      bevel: 0.006,
      top: 0.2,
    }),
    Y,
  );
  at(rbox(0.064, 0.17, 0.026, 0.008), rubber(), 0, 0.02, -0.31);
  pistolGrip(at, rubber(), 0.052);
  triggerGuard(at, D, 0.035, 0.085, 0.058);
  bolts(at, S, [[0.07, 0.13], [-0.03, 0.03]], rec.hw);
  c.muzzle.position.set(0, yb, -0.64);
}

/** Helios' sealant foam gun: rounded medical shell, canister cradle, flat duckbill nozzle, hoses, healer cross */
function sealer(c: Ctx): void {
  const { at, col, glow, glowSoft, accent, glows, g } = c;
  const W = shell(0xb2b0aa);
  const D = dark();
  const S = steel();
  const yc = 0.035;
  at(side([[-0.07, -0.02, 0.01], [0.27, -0.036, 0.01], [0.28, 0.0, 0.01], [0.26, 0.07, 0.01], [-0.07, 0.07, 0.01]], 0.08, { top: 0.2 }), D);
  // rounded "medical" hull: rear body with a hump over the grip + a snout tapering into the nozzle
  const shA = shellGeo([[-0.085, -0.02, 0.025], [0.13, -0.026, 0.004], [0.13, 0.1, 0.004], [0.03, 0.112, 0.05], [-0.085, 0.086, 0.04]], 0.112, { top: 0.42, bot: 0.28 });
  at(shA.geo, W);
  const shB = shellGeo([[0.14, -0.028, 0.004], [0.24, -0.03, 0.035], [0.33, 0.004, 0.03], [0.345, 0.045, 0.015], [0.3, 0.08, 0.035], [0.14, 0.1, 0.004]], 0.114, { top: 0.42, bot: 0.28, nose: 0.3 });
  at(shB.geo, W);
  at(inlay([[0.15, 0.03], [0.24, 0.02], [0.29, 0.034], [0.3, 0.05], [0.16, 0.056]], shB.hw), accent);
  // pressure gauge on the rear hump (faces the shooter)
  at(new THREE.CylinderGeometry(0.02, 0.023, 0.014, 16), S, 0.028, 0.108, -0.035, 0.6);
  at(new THREE.CylinderGeometry(0.016, 0.016, 0.004, 16), glowSoft, 0.028, 0.1128, -0.0314, 0.6);
  at(new THREE.BoxGeometry(0.003, 0.004, 0.014), D, 0.03, 0.1158, -0.029, 0.6, 0, 0.7);
  // healer cross on the rear flank
  at(inlay([[0.02, 0.028], [0.07, 0.028], [0.07, 0.042], [0.02, 0.042]], shA.hw, 0.002, 0.0015), glowSoft);
  at(inlay([[0.038, 0.012], [0.052, 0.012], [0.052, 0.058], [0.038, 0.058]], shA.hw, 0.0022, 0.0015), glowSoft);
  // canister in a cradle
  const ty = 0.124;
  const tank = new THREE.Mesh(tubeZ(0.027, 0.03, 0.21, 16), glowMat(col, 1.1));
  tank.position.set(0, ty, 0);
  g.add(tank);
  glows.push(tank);
  at(lathe([[0, -0.01], [0.02, -0.006], [0.034, 0.008], [0.036, 0.02], [0.036, 0.034], [0.028, 0.038], [0, 0.038]], 16), W, 0, ty);
  at(lathe([[0, 0.2], [0.036, 0.2], [0.038, 0.208], [0.038, 0.232], [0.03, 0.236], [0, 0.236]], 16), W, 0, ty);
  for (const f of [0.09, 0.15]) at(tubeZ(0.031, f - 0.005, f + 0.005, 16), D, 0, ty);
  for (const a of [Math.PI / 6, (5 * Math.PI) / 6]) at(rbox(0.009, 0.009, 0.17, 0.003), S, Math.cos(a) * 0.031, ty + Math.sin(a) * 0.031, 0.12);
  at(side([[0.0, 0.09], [0.21, 0.09], [0.2, 0.104, 0.006], [0.01, 0.104, 0.006]], 0.046, { bevel: 0.004 }), D);
  // duckbill nozzle
  const nz = lathe([[0.03, 0.33], [0.04, 0.35], [0.046, 0.4], [0.06, 0.455], [0.062, 0.476], [0.054, 0.482], [0.04, 0.462], [0, 0.462]], 18);
  nz.scale(1.7, 0.5, 1);
  at(nz, D, 0, yc);
  at(tubeZ(0.047, 0.328, 0.352, 16), accent, 0, yc);
  at(tubeZ(0.043, 0.36, 0.372, 16), S, 0, yc);
  at(rbox(0.16, 0.012, 0.01, 0.004), glow, 0, yc, 0.468);
  // hoses from the canister to the nozzle
  for (const sx of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.028, ty - 0.008, -0.215),
      new THREE.Vector3(sx * 0.048, ty - 0.03, -0.265),
      new THREE.Vector3(sx * 0.052, yc + 0.03, -0.31),
      new THREE.Vector3(sx * 0.044, yc + 0.01, -0.33),
    ]);
    at(new THREE.TubeGeometry(curve, 12, 0.008, 6), rubber());
  }
  // short rounded stock
  at(side([[-0.07, 0.085, 0.01], [-0.18, 0.07, 0.03], [-0.2, 0.02, 0.02], [-0.18, -0.05, 0.02], [-0.07, -0.015, 0.01]], 0.07, { bevel: 0.007, top: 0.3, bot: 0.2 }), W);
  at(rbox(0.074, 0.11, 0.02, 0.008), rubber(), 0, 0.012, -0.196);
  at(side([[0.19, -0.04, 0.004], [0.3, -0.036, 0.004], [0.29, -0.064, 0.012], [0.2, -0.066, 0.012]], 0.06, { bevel: 0.005, bot: 0.12 }), rubber());
  pistolGrip(at, rubber(), 0.05);
  triggerGuard(at, D, 0.035, 0.085, 0.058);
  c.muzzle.position.set(0, yc, -0.47);
}

/** Phantom's twin arc pistols (both in one model: right hand at x=0, left hand ~0.4 m to the left) */
function twinarc(c: Ctx): void {
  const { g, glow, glowSoft, accent, glows } = c;
  const W = shell(0xa7a3b2);
  const D = dark();
  const S = steel();
  for (const ox of [0, -0.4]) {
    const pg = new THREE.Group();
    pg.position.x = ox;
    g.add(pg);
    if (ox !== 0) c.offhand = pg; // the left pistol: holders re-parent it to the left hand
    const at = kit(pg);
    const yc = 0.045;
    at(side([[-0.06, -0.004, 0.01], [0.2, -0.004, 0.01], [0.225, 0.02, 0.008], [0.225, 0.074, 0.008], [0.0, 0.086, 0.012], [-0.06, 0.074, 0.012]], 0.05, { bevel: 0.005, top: 0.2 }), D);
    const sh = shellGeo([[-0.05, 0.038, 0.006], [0.17, 0.04, 0.006], [0.215, 0.07, 0.014], [0.17, 0.104, 0.018], [-0.02, 0.108, 0.02], [-0.07, 0.1, 0.006], [-0.055, 0.076, 0.01]], 0.064, { top: 0.35 });
    at(sh.geo, W);
    at(inlay([[0.0, 0.058], [0.14, 0.058], [0.16, 0.07], [0.0, 0.072]], sh.hw, 0.0015, 0.0015), glowSoft);
    // swept dorsal fin in hero tint
    at(side([[-0.07, 0.1, 0.004], [0.02, 0.104, 0.01], [0.12, 0.106, 0.004], [0.02, 0.122, 0.01], [-0.06, 0.124, 0.006]], 0.02, { bevel: 0.003, top: 0.4 }), accent);
    // fork prongs + arc
    const prong: P2[] = [[0.2, yc + 0.018, 0.004], [0.32, yc + 0.022, 0.006], [0.37, yc + 0.034, 0.004], [0.35, yc + 0.043, 0.004], [0.2, yc + 0.045, 0.004]];
    at(side(prong, 0.026, { bevel: 0.003, top: 0.3 }), S);
    at(side(prong.map((p) => [p[0], 2 * yc - p[1], p[2]] as P2).reverse(), 0.026, { bevel: 0.003, bot: 0.3 }), S);
    glows.push(at(rbox(0.007, 0.046, 0.007, 0.002), glow, 0, yc, 0.35));
    at(rbox(0.007, 0.007, 0.13, 0.002), glowSoft, 0, yc, 0.28);
    const torus = new THREE.TorusGeometry(0.032, 0.006, 6, 16);
    for (const f of [0.232, 0.26]) at(torus, accent, 0, yc, f);
    pistolGrip(at, rubber(), 0.044, 0, 0.92);
    triggerGuard(at, D, 0.03, 0.07, 0.05, 0.014);
    at(rbox(0.01, 0.012, 0.018, 0.003), glow, 0, 0.114, -0.04);
  }
  c.muzzle.position.set(0, 0.045, -0.37);
  if (c.offhand) {
    c.offMuzzle = new THREE.Object3D();
    c.offMuzzle.position.set(0, 0.045, -0.37);
    c.offhand.add(c.offMuzzle);
  }
}

/** Blade's plasma katana: wrapped tsuka, hex tsuba, emitter collar, hard-light blade with a metal spine */
function blade(c: Ctx): void {
  const { at, col, glow, accent, glows } = c;
  const D = dark();
  const S = steel();
  const handle = lathe([[0, -0.19], [0.018, -0.19], [0.022, -0.18], [0.02, -0.165], [0.018, -0.08], [0.02, 0.0], [0.023, 0.018], [0, 0.02]], 10);
  handle.scale(1, 1.2, 1);
  at(handle, rubber());
  const wrap = rbox(0.004, 0.032, 0.014, 0.0015);
  for (let i = 0; i < 5; i++) {
    const f = -0.15 + i * 0.034;
    at(wrap, accent, 0.019, 0, f, Math.PI / 4);
    at(wrap, accent, -0.019, 0, f, -Math.PI / 4);
  }
  at(lathe([[0.0, -0.215], [0.018, -0.215], [0.025, -0.205], [0.026, -0.19], [0.022, -0.182], [0.0, -0.182]], 12), S);
  at(new THREE.TorusGeometry(0.024, 0.003, 6, 16), glow, 0, 0, -0.198);
  // tsuba (guard) + tint inlay
  const tsuba: P2[] = [[-0.052, 0.0, 0.006], [-0.03, 0.04, 0.01], [0.03, 0.04, 0.01], [0.052, 0.0, 0.006], [0.03, -0.04, 0.01], [-0.03, -0.04, 0.01]];
  at(sect(tsuba, 0.02, 0.036, { bevel: 0.004 }), D);
  at(sect(tsuba.map((p) => [p[0] * 0.72, p[1] * 0.72, 0.006] as P2), 0.017, 0.039, { bevel: 0.002 }), accent);
  // emitter collar
  at(lathe([[0.024, 0.036], [0.026, 0.05], [0.022, 0.1], [0.016, 0.11], [0, 0.11]], 12), S);
  at(new THREE.TorusGeometry(0.02, 0.0035, 6, 16), glow, 0, 0, 0.085);
  // blade: curved (sori) profile; emissive core + metal spine along the back
  const n = 14;
  const f0 = 0.1;
  const f1 = 1.1;
  const curve = (u: number) => 0.035 * u * u;
  const edge: P2[] = [];
  const spine: P2[] = [];
  const back: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const f = f0 + (f1 - 0.1 - f0) * u;
    const hgt = 0.019 - 0.004 * u;
    edge.push([f, curve(u) - hgt]);
    spine.push([f, curve(u) + hgt]);
    back.push([f, curve(u) + 0.002 - 0.002 * u]);
  }
  const core: P2[] = [...edge, [f1 - 0.04, curve(1) - 0.008], [f1, curve(1) + 0.014], ...spine.slice().reverse()];
  glows.push(at(side(core, 0.007, { bevel: 0.0025 }), glowMat(col, 1.25)));
  const spineShape: P2[] = [...back, [f1 - 0.06, curve(1) + 0.012], ...spine.slice().reverse().map((p) => [p[0], p[1] + 0.003] as P2)];
  at(side(spineShape, 0.013, { bevel: 0.003, top: 0.3 }), S);
  at(side([[0.1, -0.02, 0.004], [0.2, -0.018, 0.02], [0.2, 0.022, 0.004], [0.1, 0.023, 0.004]], 0.014, { bevel: 0.003 }), D);
  c.muzzle.position.set(0, 0, -0.9);
}

/** Forge's rivet gun: stepped industrial housing, pan magazine (spins), air tank, heated coil barrel, square driver head */
function riveter(c: Ctx): void {
  const { g, at, col, glow, accent, glows } = c;
  const W = shell(0xaaa08a);
  const D = dark();
  const S = steel();
  const brass = toonMat(0xb08a3a, { spec: 0.85, rim: 0.4 });
  const orange = shell(0xc4711f);
  const yc = 0.035;
  at(side([[-0.06, -0.045, 0.006], [0.3, -0.05, 0.006], [0.31, -0.02, 0.006], [-0.06, -0.014, 0.006]], 0.09, { bevel: 0.005 }), D);
  // stepped housing: tall rear block + lower front snout
  const shA = shellGeo([[-0.075, -0.03, 0.012], [0.16, -0.036, 0.004], [0.16, 0.098, 0.004], [0.08, 0.102, 0.02], [-0.075, 0.092, 0.02]], 0.116, { top: 0.22 });
  at(shA.geo, W);
  const shB = shellGeo([[0.17, -0.036, 0.004], [0.3, -0.036, 0.012], [0.335, 0.0, 0.012], [0.33, 0.07, 0.012], [0.17, 0.078, 0.004]], 0.104, { top: 0.22, nose: 0.1 });
  at(shB.geo, W);
  at(inlay([[0.18, -0.014], [0.3, -0.016], [0.315, 0.012], [0.3, 0.05], [0.19, 0.052]], shB.hw), accent);
  at(inlay([[-0.05, 0.05], [0.14, 0.048], [0.14, 0.064], [-0.05, 0.066]], shA.hw, 0.0015), accent);
  bolts(at, brass, [[-0.04, 0.02], [0.13, 0.02], [-0.04, 0.078], [0.13, 0.078]], shA.hw, 0.006);
  // top vent slats on the snout
  const slat = new THREE.BoxGeometry(0.07, 0.006, 0.012);
  for (let i = 0; i < 4; i++) at(slat, D, 0, 0.08, 0.2 + i * 0.03);
  // pan magazine (spins about the vertical axis)
  const pan = new THREE.Group();
  pan.position.set(0, 0.104, -0.075);
  pan.rotation.x = -Math.PI / 2;
  g.add(pan);
  const inner = new THREE.Group();
  inner.rotation.x = Math.PI / 2;
  pan.add(inner);
  const panGeo = new THREE.LatheGeometry(
    [[0, 0.0], [0.03, 0.0], [0.06, 0.004], [0.067, 0.014], [0.067, 0.028], [0.06, 0.038], [0.02, 0.042], [0, 0.042]].map(([r, y]) => new THREE.Vector2(r, y)),
    18,
  );
  put(inner, panGeo, orange);
  put(inner, new THREE.CylinderGeometry(0.02, 0.024, 0.02, 12), D, 0, 0.05, 0);
  const stud = new THREE.CylinderGeometry(0.007, 0.007, 0.012, 8);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    put(inner, stud, brass, Math.cos(a) * 0.047, 0.042, Math.sin(a) * 0.047);
  }
  put(inner, rbox(0.026, 0.01, 0.012, 0.003), glow, 0.04, 0.041, 0);
  mergeStatic(pan);
  c.spin = pan;
  at(new THREE.CylinderGeometry(0.03, 0.036, 0.012, 12), D, 0, 0.1, 0.075);
  // air tank on the right flank + hose
  at(lathe([[0, -0.04], [0.022, -0.04], [0.028, -0.03], [0.028, 0.12], [0.022, 0.13], [0, 0.13]], 14), S, 0.072, 0.018);
  for (const f of [-0.02, 0.11]) at(tubeZ(0.0295, f - 0.006, f + 0.006, 14), orange, 0.072, 0.018);
  const hose = new THREE.CatmullRomCurve3([new THREE.Vector3(0.072, 0.018, -0.135), new THREE.Vector3(0.07, 0.03, -0.19), new THREE.Vector3(0.05, 0.04, -0.25), new THREE.Vector3(0.03, 0.04, -0.3)]);
  at(new THREE.TubeGeometry(hose, 12, 0.008, 6), rubber());
  // barrel with heating coil + square driver head
  at(tubeZ(0.026, 0.3, 0.52, 14), D, 0, yc);
  const helix: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const u = i / 48;
    const a = u * Math.PI * 2 * 4;
    helix.push(new THREE.Vector3(Math.cos(a) * 0.032, yc + Math.sin(a) * 0.032, -(0.36 + u * 0.12)));
  }
  glows.push(at(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 64, 0.0055, 5), glowMat(col, 1.8)));
  at(tubeZ(0.04, 0.34, 0.355, 14), S, 0, yc);
  at(tubeZ(0.04, 0.49, 0.505, 14), S, 0, yc);
  at(sect([[-0.044, yc - 0.044], [0.044, yc - 0.044], [0.044, yc + 0.044], [-0.044, yc + 0.044]].map((p) => [p[0], p[1], 0.012] as P2), 0.515, 0.6, { holes: [circle(0, yc, 0.017, 12)], bevel: 0.006 }), D);
  at(tubeZ(0.017, 0.54, 0.6, 12), brass, 0, yc);
  at(new THREE.CircleGeometry(0.012, 12), glow, 0, yc, 0.601, 0, Math.PI, 0);
  const guide = rbox(0.013, 0.013, 0.05, 0.003);
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) at(guide, S, sx * 0.035, yc + sy * 0.035, 0.615);
  // pneumatic ram under the barrel (support hand)
  at(lathe([[0, 0.14], [0.022, 0.14], [0.024, 0.15], [0.024, 0.4], [0.02, 0.41], [0, 0.41]], 12), S, 0, -0.035);
  at(tubeZ(0.026, 0.16, 0.18, 12), accent, 0, -0.035);
  at(tubeZ(0.026, 0.38, 0.4, 12), accent, 0, -0.035);
  // work light
  at(rbox(0.024, 0.03, 0.04, 0.006), D, -0.064, 0.06, 0.24);
  at(rbox(0.004, 0.018, 0.028, 0.002), glowMat(0xfff2c8, 2.2), -0.077, 0.06, 0.24);
  // stock: tubular frame + butt
  const rod = lathe([[0, -0.07], [0.011, -0.07], [0.011, -0.22], [0, -0.22]], 10);
  for (const y of [0.07, -0.02]) at(rod, S, 0, y);
  at(side([[-0.2, 0.1, 0.012], [-0.25, 0.1, 0.012], [-0.25, -0.07, 0.012], [-0.2, -0.05, 0.012]], 0.062, { bevel: 0.006, top: 0.2 }), W);
  at(rbox(0.066, 0.18, 0.02, 0.008), rubber(), 0, 0.015, -0.255);
  pistolGrip(at, rubber(), 0.054);
  triggerGuard(at, D, 0.035, 0.085, 0.06);
  c.muzzle.position.set(0, yc, -0.64);
}

/** Hive's burst rifle: black/yellow striping, hex shroud with honeycomb glow cells, hex scope, drone-link antenna, tube stock */
function burst(c: Ctx): void {
  const { at, col, glow, glowSoft, accent } = c;
  const Y = shell(0xcaa92f);
  const D = dark();
  const S = steel();
  const yc = 0.038;
  at(side([[-0.06, -0.022, 0.01], [0.42, -0.022, 0.01], [0.44, 0.01, 0.01], [0.42, 0.072, 0.01], [-0.06, 0.078, 0.01]], 0.068, { top: 0.15 }), D);
  const sh = shellGeo([[-0.045, 0.018, 0.006], [0.36, 0.018, 0.006], [0.4, 0.05, 0.015], [0.36, 0.1, 0.02], [0.0, 0.106, 0.02], [-0.045, 0.09, 0.015]], 0.082, { top: 0.3, nose: 0.1 });
  at(sh.geo, Y);
  // bee stripes (dark bands wrapping over the top)
  for (const f of [0.12, 0.2]) at(side([[f, 0.016], [f + 0.03, 0.016], [f + 0.03, 0.109], [f, 0.109]], 0.086, { bevel: 0.002, top: 0.3 }), D);
  at(inlay([[0.25, 0.03], [0.34, 0.03], [0.36, 0.06], [0.27, 0.07]], sh.hw), accent);
  // hex shroud + honeycomb cells
  at(lathe([[0, 0.4], [0.036, 0.4], [0.042, 0.41], [0.042, 0.6], [0.036, 0.62], [0, 0.62]], 6), D, 0, yc);
  const hex = new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 6);
  const ap = 0.042 * Math.cos(Math.PI / 6);
  for (const sx of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      for (const r of [0, 1]) {
        const f = 0.43 + i * 0.04 + r * 0.02;
        at(hex, glowSoft, sx * (ap + 0.0005), yc + (r ? -0.008 : 0.008), f, 0, 0, Math.PI / 2);
      }
    }
  }
  at(tubeZ(0.015, 0.62, 0.7, 12), S, 0, yc);
  at(lathe([[0.016, 0.69], [0.025, 0.695], [0.025, 0.76], [0.012, 0.76], [0.012, 0.73], [0, 0.73]], 6), D, 0, yc);
  at(new THREE.CircleGeometry(0.011, 6), glow, 0, yc, 0.735, 0, Math.PI, 0);
  // angled magazine with a yellow band
  at(side([[0.12, 0.0, 0.004], [0.2, 0.0, 0.004], [0.23, -0.14, 0.01], [0.15, -0.146, 0.01]], 0.054, { bevel: 0.005, bot: 0.12 }), D);
  at(side([[0.14, -0.1], [0.22, -0.1], [0.225, -0.12], [0.145, -0.12]], 0.058, { bevel: 0.002, bot: 0.1 }), Y);
  // hex scope with a glowing lens
  const sy = 0.148;
  at(lathe([[0, 0.04], [0.02, 0.04], [0.026, 0.05], [0.026, 0.2], [0.032, 0.22], [0.032, 0.25], [0.028, 0.255], [0, 0.255]], 6), D, 0, sy);
  at(new THREE.CircleGeometry(0.024, 6), glowMat(col, 1.2), 0, sy, 0.2555, 0, Math.PI, 0);
  for (const f of [0.08, 0.19]) at(sect([[-0.014, 0.1], [0.014, 0.1], [0.012, sy - 0.02], [-0.012, sy - 0.02]], f - 0.012, f + 0.012, { bevel: 0.003 }), D);
  // drone-link antenna
  // drone-link antenna on the stock (on the receiver it stood right in front of the eye when aiming)
  at(new THREE.CylinderGeometry(0.004, 0.006, 0.09, 6), S, -0.03, 0.135, -0.265, 0.35, 0, 0);
  at(rbox(0.01, 0.01, 0.01, 0.003), glowSoft, -0.03, 0.177, -0.28);
  at(rbox(0.024, 0.03, 0.03, 0.006), D, -0.03, 0.1, -0.255);
  // tube stock + butt plate
  const rod = lathe([[0, -0.05], [0.01, -0.05], [0.01, -0.27], [0, -0.27]], 10);
  for (const y of [0.06, 0.0]) at(rod, S, 0, y);
  at(side([[-0.24, 0.085, 0.012], [-0.29, 0.08, 0.012], [-0.3, -0.07, 0.012], [-0.25, -0.06, 0.012]], 0.056, { bevel: 0.006, top: 0.2 }), Y);
  at(rbox(0.06, 0.16, 0.02, 0.008), rubber(), 0, 0.006, -0.3);
  // handguard + grip
  at(side([[0.26, -0.02, 0.004], [0.42, -0.02, 0.004], [0.41, -0.046, 0.012], [0.28, -0.048, 0.012]], 0.058, { bevel: 0.005, bot: 0.12 }), rubber());
  pistolGrip(at, rubber(), 0.05);
  triggerGuard(at, D, 0.035, 0.08, 0.056);
  c.muzzle.position.set(0, yc, -0.77);
}

/** shoulder-fired tactical nuke launcher: hazard-yellow tube, venturi, fins, warhead nose, targeting unit */
function nuke(c: Ctx): void {
  const { g, at, accent, glows } = c;
  const D = dark();
  const S = steel();
  const yt = 0.105;
  const R = 0.11;
  const skin = toonMat(0xffffff, { map: nukeTex(), spec: 0.5, rim: 0.4 });
  const tubeG = new THREE.CylinderGeometry(R, R, 1.16, 28, 1, true);
  tubeG.rotateY(Math.PI);
  const tubeM = new THREE.Mesh(tubeG, skin);
  tubeM.rotation.x = -Math.PI / 2;
  tubeM.position.set(0, yt, -0.2);
  g.add(tubeM);
  // reinforcement rings
  for (const [f0, f1] of [[-0.36, -0.32], [0.08, 0.12], [0.5, 0.53]] as const)
    at(lathe([[R - 0.002, f0], [R + 0.012, f0 + 0.004], [R + 0.014, f0 + 0.01], [R + 0.014, f1 - 0.01], [R + 0.012, f1 - 0.004], [R - 0.002, f1]], 28), D, 0, yt);
  // rear venturi (flared) with a faint ember glow inside + stabiliser fins
  at(lathe([[R - 0.004, -0.37], [R + 0.01, -0.38], [R + 0.03, -0.46], [R + 0.03, -0.475], [R + 0.018, -0.48], [R - 0.012, -0.44], [0.05, -0.41], [0.0, -0.41]], 28), D, 0, yt);
  at(new THREE.CircleGeometry(0.06, 20), glowMat(0xff7a2a, 1.2), 0, yt, -0.412);
  const fin = side([[-0.3, R - 0.01, 0.004], [-0.2, R - 0.01, 0.004], [-0.3, R + 0.05, 0.01], [-0.36, R + 0.05, 0.006]], 0.012, { bevel: 0.003 });
  for (let k = 0; k < 4; k++) at(fin, D, 0, yt, 0, 0, 0, Math.PI / 4 + (k * Math.PI) / 2);
  // front collar + warhead
  at(lathe([[R - 0.004, 0.76], [R + 0.018, 0.77], [R + 0.022, 0.8], [R + 0.022, 0.83], [R + 0.01, 0.84], [R - 0.012, 0.84], [R - 0.012, 0.78], [0, 0.78]], 28), D, 0, yt);
  at(lathe([[0, 0.7], [0.086, 0.7], [0.088, 0.8], [0.082, 0.86], [0.062, 0.92], [0.036, 0.96], [0.012, 0.975], [0, 0.978]], 20), shell(0xb4b2ac), 0, yt);
  at(lathe([[0.0885, 0.8], [0.0895, 0.8], [0.0875, 0.835], [0.0835, 0.835]], 20), toonMat(0xc02a24, { spec: 0.5 }), 0, yt);
  // grip housing + pistol grip + vertical foregrip
  at(side([[-0.07, -0.02, 0.008], [0.18, -0.02, 0.008], [0.2, 0.0, 0.004], [-0.09, 0.0, 0.004]], 0.07, { bevel: 0.005 }), D);
  pistolGrip(at, rubber(), 0.052);
  triggerGuard(at, D, 0.035, 0.08, 0.055);
  at(side([[0.1, -0.015, 0.004], [0.16, -0.015, 0.004], [0.17, -0.12, 0.012], [0.12, -0.125, 0.012]], 0.046, { bevel: 0.005, bot: 0.1 }), rubber());
  // shoulder pad
  at(side([[-0.34, -0.012, 0.01], [-0.1, -0.012, 0.01], [-0.12, -0.04, 0.02], [-0.32, -0.042, 0.02]], 0.1, { bevel: 0.008, bot: 0.15 }), rubber());
  // targeting unit (left side, visible from first person)
  const tx = -0.145;
  at(side([[-0.02, 0.14, 0.01], [0.2, 0.14, 0.01], [0.22, 0.17, 0.01], [0.2, 0.22, 0.012], [0.0, 0.22, 0.012], [-0.03, 0.19, 0.01]], 0.05, { bevel: 0.006, top: 0.2 }), D, tx);
  at(side([[0.04, 0.15], [0.19, 0.15], [0.2, 0.17], [0.19, 0.21], [0.04, 0.21]], 0.054, { bevel: 0.003, top: 0.18 }), accent, tx);
  at(lathe([[0, 0.2], [0.022, 0.2], [0.024, 0.21], [0.024, 0.25], [0.02, 0.255], [0, 0.255]], 14), S, tx, 0.18);
  glows.push(at(new THREE.CircleGeometry(0.017, 14), glowMat(0xff3030, 3), tx, 0.18, 0.2555, 0, Math.PI, 0));
  at(rbox(0.036, 0.034, 0.004, 0.003), glowMat(0xffd24a, 1.2), tx, 0.185, -0.032);
  at(rbox(0.05, 0.02, 0.06, 0.006), D, -0.1, 0.15, 0.1);
  // top carry handle
  const handle = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, yt + R, 0.08),
    new THREE.Vector3(0, yt + R + 0.05, 0.05),
    new THREE.Vector3(0, yt + R + 0.06, -0.1),
    new THREE.Vector3(0, yt + R + 0.05, -0.25),
    new THREE.Vector3(0, yt + R, -0.28),
  ]);
  at(new THREE.TubeGeometry(handle, 16, 0.012, 8), D);
  at(rbox(0.014, 0.014, 0.014, 0.004), glowMat(0xff3030, 3), 0.075, yt + 0.085, 0.3);
  c.muzzle.position.set(0, yt, -0.98);
}

/** black-hole projector: violet armoured body, three claws around a spinning gyro cage, black core + accretion disc */
function singularity(c: Ctx): void {
  const { g, at, col, glow, glowSoft, accent, glows } = c;
  const P = shell(0x4b3380);
  const W = shell();
  const D = dark();
  const S = steel();
  const yc = 0.04;
  at(side([[-0.08, -0.034, 0.015], [0.3, -0.042, 0.015], [0.36, 0.0, 0.015], [0.36, 0.08, 0.015], [-0.08, 0.09, 0.02]], 0.11, { top: 0.2 }), D);
  const shA = shellGeo([[-0.08, -0.03, 0.015], [0.14, -0.036, 0.004], [0.14, 0.11, 0.004], [-0.02, 0.112, 0.03], [-0.08, 0.1, 0.02]], 0.132, { top: 0.32, bot: 0.1 });
  at(shA.geo, P);
  const shB = shellGeo([[0.15, -0.036, 0.004], [0.3, -0.04, 0.015], [0.36, 0.0, 0.02], [0.36, 0.085, 0.02], [0.24, 0.116, 0.025], [0.15, 0.11, 0.004]], 0.134, { top: 0.32, bot: 0.1, nose: 0.12 });
  at(shB.geo, P);
  at(side([[0.0, 0.1], [0.26, 0.104], [0.3, 0.126, 0.015], [0.04, 0.142, 0.02]], 0.08, { bevel: 0.006, top: 0.35 }), W);
  at(inlay([[0.16, 0.012], [0.28, 0.006], [0.31, 0.04], [0.18, 0.052]], shB.hw), accent);
  // capacitor windows on the flanks (dark recess + two glowing vials each side)
  at(inlay([[-0.06, 0.012, 0.006], [0.1, 0.012, 0.006], [0.1, 0.086, 0.006], [-0.06, 0.086, 0.006]], shA.hw, 0.002, 0.003), D);
  const vial = tubeZ(0.011, -0.05, 0.09, 10);
  for (const y of [0.03, 0.068]) for (const sx of [1, -1]) at(vial, glowSoft, sx * (shA.hw(y) + 0.002), y);
  // gravity rings on the neck
  at(lathe([[0.03, 0.34], [0.052, 0.35], [0.056, 0.4], [0.03, 0.43], [0, 0.43]], 16), D, 0, yc);
  const nr = new THREE.TorusGeometry(0.057, 0.004, 6, 24);
  for (const f of [0.365, 0.385]) at(nr, glow, 0, yc, f);
  // claws
  const claw = side([[0.33, 0.035, 0.006], [0.44, 0.11, 0.02], [0.6, 0.128, 0.02], [0.68, 0.1, 0.006], [0.64, 0.095, 0.01], [0.5, 0.098, 0.02], [0.38, 0.03, 0.006]], 0.026, { bevel: 0.004, top: 0.3 });
  for (let i = 0; i < 3; i++) at(claw, S, 0, yc, 0, 0, 0, (i * Math.PI * 2) / 3);
  // black hole + accretion disc (static) and a gyro cage (spins)
  const hole = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), toonMat(0x05040a, { spec: 0.0, rim: 0.9, rimColor: col }));
  hole.position.set(0, yc, -0.55);
  g.add(hole);
  const disc = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.009, 6, 36), glowMat(col, 2.0));
  disc.scale.set(1, 1, 0.35);
  disc.rotation.set(Math.PI / 2 - 0.35, 0, 0.2);
  disc.position.copy(hole.position);
  g.add(disc);
  glows.push(disc);
  const cage = new THREE.Group();
  cage.position.set(0, yc, -0.55);
  g.add(cage);
  const ring = new THREE.TorusGeometry(0.092, 0.0065, 5, 24);
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = (i * Math.PI) / 3;
    cage.add(pivot);
    put(pivot, ring, D, 0, 0, 0, 0, Math.PI / 2, 0);
  }
  put(cage, new THREE.TorusGeometry(0.094, 0.009, 6, 28), S);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    put(cage, rbox(0.018, 0.018, 0.018, 0.005), glow, Math.cos(a) * 0.094, Math.sin(a) * 0.094, 0);
  }
  mergeStatic(cage);
  c.spin = cage;
  // stock + grip
  at(
    side([[-0.07, 0.09, 0.01], [-0.22, 0.08, 0.015], [-0.24, 0.05, 0.01], [-0.24, -0.06, 0.01], [-0.2, -0.074, 0.012], [-0.1, -0.03, 0.02], [-0.07, -0.025, 0.006]], 0.072, {
      holes: [[[-0.105, 0.055], [-0.2, 0.05], [-0.2, -0.03], [-0.14, -0.01]].map((p) => [p[0], p[1], 0.012] as P2)],
      bevel: 0.007,
      top: 0.2,
    }),
    W,
  );
  at(rbox(0.076, 0.15, 0.024, 0.008), rubber(), 0, 0.005, -0.25);
  at(side([[0.2, -0.036, 0.004], [0.33, -0.04, 0.004], [0.32, -0.068, 0.012], [0.22, -0.068, 0.012]], 0.064, { bevel: 0.005, bot: 0.12 }), rubber());
  pistolGrip(at, rubber(), 0.054);
  triggerGuard(at, D, 0.035, 0.09, 0.06, 0.018);
  c.muzzle.position.set(0, yc, -0.7);
}

/** "Sunspear" orbital designator: white/gold faceted housing, sunburst-ringed emitter lens, rangefinder, uplink dish */
function helios(c: Ctx): void {
  const { at, col, accent, glows, g } = c;
  const W = shell();
  const D = dark();
  const S = steel();
  const gold = toonMat(0xb88a38, { spec: 0.9, rim: 0.45 });
  const yc = 0.055;
  at(side([[-0.06, -0.026, 0.006], [0.22, -0.032, 0.006], [0.23, -0.006, 0.006], [-0.06, 0.0, 0.006]], 0.09, { bevel: 0.005 }), D);
  // rear body tapering to the back + a flared front cowl wrapping the emitter
  const shA = shellGeo([[-0.075, -0.012, 0.012], [0.1, -0.016, 0.004], [0.1, 0.122, 0.004], [-0.01, 0.128, 0.04], [-0.075, 0.098, 0.03]], 0.118, { top: 0.4, bot: 0.12, tail: 0.12 });
  at(shA.geo, W);
  const shB = shellGeo([[0.11, -0.016, 0.004], [0.21, -0.026, 0.015], [0.262, 0.0, 0.02], [0.28, 0.055, 0.01], [0.262, 0.112, 0.02], [0.18, 0.134, 0.03], [0.11, 0.126, 0.004]], 0.132, { top: 0.4, bot: 0.12, nose: 0.1 });
  at(shB.geo, W);
  at(inlay([[0.12, 0.018], [0.22, 0.012], [0.25, 0.05], [0.13, 0.058]], shB.hw), accent);
  at(inlay([[-0.055, 0.074], [0.09, 0.074], [0.09, 0.086], [-0.05, 0.086]], shA.hw, 0.0015), gold);
  // gold sun crest along the top
  at(side([[-0.07, 0.1, 0.006], [0.12, 0.124, 0.01], [0.24, 0.13, 0.006], [0.14, 0.15, 0.02], [0.0, 0.146, 0.02], [-0.06, 0.124, 0.01]], 0.014, { bevel: 0.003, top: 0.4 }), gold);
  // spear emitter: tapered barrel with gold rings, sunburst halo mid-barrel, lens at the tip
  at(lathe([[0, 0.24], [0.042, 0.24], [0.048, 0.26], [0.048, 0.3], [0.036, 0.32], [0.03, 0.34], [0.024, 0.5], [0.028, 0.51], [0.028, 0.54], [0.018, 0.545], [0.018, 0.536], [0, 0.536]], 16), D, 0, yc);
  for (const f of [0.3, 0.43]) at(tubeZ(0.034 - (f - 0.3) * 0.05, f, f + 0.012, 16), gold, 0, yc);
  const rays = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const len = i % 2 ? 0.022 : 0.04;
    put(rays, sect([[-0.0075, 0.05], [0.0075, 0.05], [0.0, 0.05 + len]], 0.37, 0.382, { bevel: 0.0015 }), gold, 0, 0, 0, 0, 0, a);
  }
  rays.position.y = yc;
  g.add(rays);
  at(lathe([[0.03, 0.365], [0.054, 0.368], [0.054, 0.386], [0.03, 0.389]], 24), gold, 0, yc);
  at(new THREE.TorusGeometry(0.043, 0.004, 6, 24), glowMat(col, 1.8), 0, yc, 0.3765);
  glows.push(at(new THREE.CircleGeometry(0.019, 16), glowMat(col, 2.6), 0, yc, 0.537, 0, Math.PI, 0));
  // rangefinder along the left flank
  at(lathe([[0, 0.1], [0.016, 0.1], [0.018, 0.11], [0.018, 0.27], [0.015, 0.275], [0, 0.275]], 12), S, -0.07, 0.092);
  at(new THREE.CircleGeometry(0.012, 12), glowMat(0xffb070, 1.2), -0.07, 0.092, 0.276, 0, Math.PI, 0);
  // small uplink dish on the rear, facing the sky
  const dish = new THREE.LatheGeometry([[0, 0], [0.012, 0.001], [0.028, 0.008], [0.034, 0.013], [0.032, 0.015], [0.025, 0.01], [0.011, 0.005], [0, 0.004]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
  at(new THREE.CylinderGeometry(0.006, 0.008, 0.02, 8), S, 0.03, 0.118, -0.045);
  at(dish, gold, 0.03, 0.128, -0.045, 0.35, 0, 0);
  at(new THREE.SphereGeometry(0.005, 8, 6), glowMat(col, 3), 0.03, 0.136, -0.043);
  // status screen facing the user
  at(rbox(0.05, 0.034, 0.012, 0.006), D, -0.022, 0.116, -0.07, -0.3);
  at(rbox(0.04, 0.022, 0.004, 0.002), glowMat(0xff7050, 1.1), -0.022, 0.115, -0.077, -0.3);
  // handguard + grip + short brace
  at(side([[0.16, -0.03, 0.004], [0.33, -0.028, 0.004], [0.32, -0.06, 0.012], [0.18, -0.062, 0.012]], 0.06, { bevel: 0.005, bot: 0.12 }), rubber());
  at(side([[-0.07, 0.07, 0.01], [-0.15, 0.06, 0.02], [-0.16, -0.03, 0.015], [-0.07, -0.01, 0.01]], 0.064, { bevel: 0.006, top: 0.2 }), W);
  at(rbox(0.066, 0.1, 0.02, 0.008), rubber(), 0, 0.016, -0.162);
  pistolGrip(at, rubber(), 0.05);
  triggerGuard(at, D, 0.035, 0.08, 0.055);
  c.muzzle.position.set(0, yc, -0.55);
}

/** rail + two-frame holo sight sitting on the top surface of the receiver (found by ray casts) */
function mountHolo(g: THREE.Group, at: At): void {
  g.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  let top = -Infinity;
  for (const f of [0.02, 0.08, 0.14, 0.2, 0.26]) {
    rc.set(new THREE.Vector3(0, 1, -f), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObject(g, true)[0];
    if (hit) top = Math.max(top, hit.point.y);
  }
  if (!Number.isFinite(top)) top = new THREE.Box3().setFromObject(g).max.y;
  // everything ahead of the sight (shroud, front post, muzzle brake) must stay below the window: the
  // line of sight runs 0.021 above the base, and a part 0.5 m ahead needs ~3.5 cm of drop to leave the
  // window — the pulse rifle's shroud used to fill the lower half of the holo view
  let front = -Infinity;
  for (let f = 0.3; f <= 1.2; f += 0.03) {
    rc.set(new THREE.Vector3(0, 1, -f), new THREE.Vector3(0, -1, 0));
    const hit = rc.intersectObject(g, true)[0];
    if (hit) front = Math.max(front, hit.point.y);
  }
  const D = dark();
  topRail(at, D, top, 0.0, 0.29);
  const y = Math.max(top + 0.012, front + 0.035 - 0.021);
  // riser block when the optic has to sit higher than the rail
  if (y - top > 0.02) at(sect([[-0.02, top], [0.02, top], [0.02, y - 0.004], [-0.02, y - 0.004]], 0.06, 0.22, { bevel: 0.003 }), D);
  at(sect([[-0.03, y - 0.004], [0.03, y - 0.004], [0.03, y + 0.004], [-0.03, y + 0.004]], 0.03, 0.25, { bevel: 0.002 }), D);
  frameSight(at, D, y, 0.04, 0.06, 0.024, 0.042);
  frameSight(at, D, y, 0.21, 0.24, 0.032, 0.062);
}

const BUILDERS: Record<WeaponId, (c: Ctx) => void> = { pulse, rail, plasma, glauncher, sealer, twinarc, blade, riveter, burst, nuke, singularity, helios };

/** Stylised chunky sci-fi guns. Barrel points to -Z, grip near the origin. */
export function buildWeaponModel(id: WeaponId, tint?: number): WeaponModel {
  const g = new THREE.Group();
  const col = WEAPONS[id].color;
  const c: Ctx = {
    g,
    at: kit(g),
    col,
    glow: glowMat(col, 2.0),
    glowSoft: glowMat(col, 1.35),
    accent: toonMat(paintOf(tint ?? 0x2f7cf6), { spec: 0.6, rim: 0.4 }),
    glows: [],
    muzzle: new THREE.Object3D(),
  };
  sightWins = [];
  BUILDERS[id](c);
  // aim-down-sights guns without an optic get a compact holo sight on the receiver
  if (sightWins.length === 0 && WEAPONS[id].alt === 'ads' && id !== 'nuke' && id !== 'helios') mountHolo(g, c.at);
  let sight: WeaponModel['sight'] = null;
  if (sightWins.length) {
    const lo = Math.max(...sightWins.map((w) => w[0]));
    const hi = Math.min(...sightWins.map((w) => w[1]));
    const front = sightWins.reduce((a, b) => (b[2] > a[2] ? b : a));
    sight = { y: (lo + hi) / 2, near: Math.min(...sightWins.map((w) => w[2])), far: front[2], hw: front[3] };
  }
  g.add(c.muzzle);
  if (c.offhand) mergeStatic(c.offhand, c.glows);
  mergeStatic(g, [...c.glows, c.spin, c.offhand]);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  return { group: g, muzzle: c.muzzle, glows: c.glows, spin: c.spin, sight, offhand: c.offhand, offMuzzle: c.offMuzzle };
}
