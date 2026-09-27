import * as THREE from 'three';
import type { HeroId } from '../game/Types';
import { TORSO_PROFILE } from './SuitMesh';
import {
  V2, Wrap, StarSurface, V3, E, tx, mirrorX, tint, plate, PlateOpts, outline, rrect, flipU, columnWrap, limbWrap, starWrap, starMesh, lathe, bcyl, rbox, extr, hose, band, span, onSurface, planeWrap, strip, hexagon, creased,
  KitCtx, BoneName, Col, SIDES, sideBone, sided, bump, ridge, smooth,
} from './ArmorKit';
import { buildHelmet, helmSurface, symOutline } from './HelmetKit';

export type { BoneName, Mat, Palette, KitCtx } from './ArmorKit';

/**
 * Per-hero body armour (Halo / Mass Effect hard-shell kit with an Overwatch finish): layered plates
 * conforming to the suit (chest, abdomen, back, belt, tassets), pauldrons, gauntlets, gloves,
 * thigh plates, knee cops, greaves, boots and life-support packs. Torso plates are skinned with the
 * suit's own torso weights so they bend with it; limb plates ride their bones.
 */

export type Variant = HeroId | 'servitor';

// ---------------------------------------------------------------------------
// body charts (bulk-aware)

interface BodyCharts {
  front: Wrap;
  back: Wrap;
  ring: Wrap;
  upperArm: Wrap; // arm-bone space, right side
  fore: Wrap; // fore-bone space
  thigh: Wrap; // leg-bone space
  shin: Wrap; // shin-bone space
}

function bodyCharts(k: number): BodyCharts {
  const rows = TORSO_PROFILE.map((r) => [r[0], r[1] * k, r[2] * k, r[3]]);
  return {
    front: columnWrap(rows),
    back: columnWrap(rows, { back: true }),
    ring: columnWrap(rows, { angular: true }),
    upperArm: limbWrap([[0.03, 0.118, -0.02], [-0.07, 0.112, -0.016], [-0.26, 0.098, -0.004], [-0.33, 0.094, 0]], k),
    fore: limbWrap([[0, 0.094], [-0.066, 0.098], [-0.24, 0.085], [-0.28, 0.078]], k),
    thigh: limbWrap([[0.06, 0.13], [-0.088, 0.135], [-0.36, 0.112], [-0.44, 0.108]], k),
    shin: limbWrap([[0, 0.108], [-0.084, 0.11], [-0.315, 0.093], [-0.32, 0.088]], k),
  };
}

// ---------------------------------------------------------------------------
// torso blocks

/** closed elliptical band around the torso at [v0, v1] */
function torsoBand(B: BodyCharts, v0: number, v1: number, h: number, seg = 36, bev = 0.006): THREE.BufferGeometry {
  const us = span(-Math.PI, Math.PI, seg + 1).slice(0, seg);
  return band(
    B.ring,
    us,
    [
      [v0 - 0.002, -0.006],
      [v0 + bev * 0.3, h - bev * 0.7],
      [v0 + bev, h],
      [v1 - bev, h],
      [v1 - bev * 0.3, h - bev * 0.7],
      [v1 + 0.002, -0.006],
    ],
    true,
  );
}

/** neck gorget: elliptical lathe collar around the neck base (chest bone space) */
function gorget(k: KitCtx, col: Col, o: { r?: number; h?: number; y?: number; rim?: Col } = {}): void {
  const r = (o.r ?? 0.17) * Math.sqrt(k.bulk);
  const h = o.h ?? 0.105;
  const y = o.y ?? 0.265;
  const rt = 0.125 * Math.sqrt(k.bulk);
  const g = lathe(
    [
      [r, y],
      [r + 0.006, y + 0.008],
      [r - 0.008, y + h * 0.55],
      [rt + 0.012, y + h - 0.004],
      [rt + 0.004, y + h],
      [rt - 0.006, y + h - 0.01],
      [rt - 0.01, y - 0.01],
    ],
    24,
  );
  tx(g, V3(0, 0, 0.004), E(), V3(1.16, 1, 0.98));
  k.add('chest', 'paint', tint(g, 0xffffff), col);
  if (o.rim) {
    const rim = lathe([[rt + 0.016, y + h - 0.012], [rt + 0.02, y + h - 0.026], [rt + 0.03, y + h - 0.04], [rt + 0.012, y + h - 0.04]], 24);
    tx(rim, V3(0, 0, 0.004), E(), V3(1.16, 1, 0.98));
    k.add('chest', 'paint', tint(rim, 0xffffff), o.rim);
  }
}

/** belt band + buckle + side pouches */
function belt(k: KitCtx, B: BodyCharts, col: Col, buckle: Col, o: { pouches?: number; pouchCol?: Col; v0?: number; v1?: number } = {}): void {
  const v0 = o.v0 ?? 0.948;
  const v1 = o.v1 ?? 1.01;
  k.torso('paint', torsoBand(B, v0, v1, 0.016), col);
  k.torso('paint', plate(B.front, rrect(0, (v0 + v1) / 2, 0.085, v1 - v0 - 0.008, 0.012), { t: 0.01, h0: 0.016, bevel: 0.004, rings: 1 }), buckle);
  const np = o.pouches ?? 2;
  for (let i = 0; i < np; i++) {
    for (const s of SIDES) {
      const u = s * (0.17 + i * 0.075) * k.bulk;
      k.torso('paint', plate(B.front, rrect(u, v0 + 0.005, 0.06, 0.07, 0.012), { t: 0.03, h0: 0.014, bevel: 0.006, rings: 1 }), o.pouchCol ?? k.pal.trim);
    }
  }
}

/** segmented abdominal plates */
function abs(k: KitCtx, B: BodyCharts, cols: Col[], o: { n?: number; w?: number; top?: number; bot?: number; t?: number } = {}): void {
  const n = o.n ?? 3;
  const top = o.top ?? 1.25;
  const bot = o.bot ?? 1.035;
  const w = (o.w ?? 0.2) * k.bulk;
  const step = (top - bot) / n;
  for (let i = 0; i < n; i++) {
    const v1 = top - i * step;
    const v0 = v1 - step + 0.012;
    const ww = w * (1 - i * 0.05);
    const ol = outline(
      [
        [-ww / 2, v0, 0.012],
        [ww / 2, v0, 0.012],
        [ww / 2 + 0.01, v1, 0.012],
        [-ww / 2 - 0.01, v1, 0.012],
      ],
      { maxLen: 0.05 },
    );
    k.torso('paint', plate(B.front, ol, { t: o.t ?? 0.014, h0: 0.004, bevel: 0.005, rings: 1 }), cols[i % cols.length]);
  }
}

type Half = [number, number, number][];

/** default right-half pec outline */
function pecShape(top: number, bot: number, w: number, gap: number): Half {
  return [
    [gap, top - 0.022, 0.008],
    [0.1, top, 0.03],
    [w - 0.05, top - 0.03, 0.04],
    [w, top - 0.1, 0.04],
    [w - 0.01, bot + 0.11, 0.05],
    [w - 0.08, bot + 0.025, 0.04],
    [gap, bot, 0.008],
  ];
}

/** two pec plates + optional sternum spine */
function chestPecs(k: KitCtx, B: BodyCharts, cols: [Col, Col], spine: Col | null, o: { top?: number; bot?: number; w?: number; t?: number; gap?: number; lift?: number; shape?: Half } = {}): void {
  const top = o.top ?? 1.6;
  const bot = o.bot ?? 1.26;
  const w = (o.w ?? 0.255) * k.bulk;
  const gap = o.gap ?? 0.016;
  const pec = outline(o.shape ?? pecShape(top, bot, w, gap), { maxLen: 0.05 });
  const lift = (u: number, v: number) => (o.lift ?? 0.012) * bump((Math.abs(u) - 0.12 * k.bulk) / (0.15 * k.bulk), (v - (top + bot) / 2 - 0.02) / 0.19);
  const po: PlateOpts = { t: o.t ?? 0.02, h0: 0.008, bevel: 0.008, lift, rings: 3 };
  k.torso('paint', plate(B.front, pec, po), cols[0]);
  k.torso('paint', plate(B.front, flipU(pec), po), cols[1]);
  if (spine) {
    const sp = outline([[-0.026, bot - 0.01, 0.01], [0.026, bot - 0.01, 0.01], [0.03, top - 0.03, 0.014], [-0.03, top - 0.03, 0.014]], { maxLen: 0.06 });
    k.torso('paint', plate(B.front, sp, { t: 0.024, h0: 0.008, bevel: 0.007, rings: 1, lift: (u) => 0.004 * ridge(u, 0.03) }), spine);
  }
}

/** one-piece chest plate from a right-half outline */
function chestPlate(k: KitCtx, B: BodyCharts, col: Col, half: Half, o: PlateOpts = {}): void {
  k.torso('paint', plate(B.front, symOutline(half, 0.05), { t: 0.022, h0: 0.008, bevel: 0.009, rings: 3, ...o }), col);
}

/** back plate (mostly under the pack) */
function backPlate(k: KitCtx, B: BodyCharts, col: Col, o: { top?: number; bot?: number; w?: number } = {}): void {
  const top = o.top ?? 1.58;
  const bot = o.bot ?? 1.2;
  const w = (o.w ?? 0.24) * k.bulk;
  k.torso(
    'paint',
    plate(B.back, symOutline([[0, top, 0.02], [0.08, top, 0.03], [w, top - 0.06, 0.04], [w - 0.03, bot + 0.05, 0.04], [0, bot, 0.02]], 0.06), { t: 0.016, h0: 0.008, bevel: 0.007, rings: 2 }),
    col,
  );
}

/** lower-back kidney plate */
function kidney(k: KitCtx, B: BodyCharts, col: Col, o: { top?: number; bot?: number; w?: number } = {}): void {
  const top = o.top ?? 1.16;
  const bot = o.bot ?? 1.03;
  const w = (o.w ?? 0.17) * k.bulk;
  k.torso('paint', plate(B.back, symOutline([[0, top, 0.01], [w, top - 0.01, 0.03], [w * 0.9, bot, 0.03], [0, bot - 0.012, 0.01]], 0.06), { t: 0.016, h0: 0.006, bevel: 0.006, rings: 2 }), col);
}

/** codpiece / pelvis guard */
function codpiece(k: KitCtx, B: BodyCharts, col: Col, o: { w?: number; top?: number; bot?: number } = {}): void {
  const w = (o.w ?? 0.085) * k.bulk;
  const top = o.top ?? 0.94;
  const bot = o.bot ?? 0.81;
  k.torso('paint', plate(B.front, symOutline([[0, top, 0.01], [w, top, 0.015], [w * 0.6, bot + 0.03, 0.02], [0, bot, 0.02]], 0.05), { t: 0.016, h0: 0.01, bevel: 0.006, rings: 1 }), col);
}

/** hip tasset riding the thigh top, blended hips ↔ leg */
function tasset(k: KitCtx, B: BodyCharts, s: number, col: Col, o: { u0?: number; u1?: number; top?: number; bot?: number; h0?: number; wLeg?: number; t?: number } = {}): void {
  const kb = k.bulk;
  const u0 = (o.u0 ?? 0.06) * kb;
  const u1 = (o.u1 ?? 0.24) * kb;
  const top = o.top ?? 0.05;
  const bot = o.bot ?? -0.14;
  const ol = outline([[u0, bot + 0.01, 0.02], [u1, bot, 0.025], [u1 - 0.01, top, 0.02], [u0 + 0.01, top - 0.01, 0.02]], { maxLen: 0.05 });
  const leg = sideBone('leg', s);
  const wl = o.wLeg ?? 0.45;
  k.blend(leg, { hips: 1 - wl, [leg]: wl } as Partial<Record<BoneName, number>>, 'paint', sided(plate(B.thigh, ol, { t: o.t ?? 0.014, h0: o.h0 ?? 0.03, bevel: 0.006, sink: 0.02, rings: 2 }), s), col);
}

// ---------------------------------------------------------------------------
// limb blocks

interface PauldronOpts {
  r?: number; // cap shell radius
  w?: number; // arc width (front-back)
  down?: number; // how far the cap reaches down the side
  over?: number; // how far over the top toward the neck
  t?: number;
  lames?: number; // lower layered plates
  lameCol?: Col;
  capCol: Col;
  rim?: Col | null;
  tilt?: number; // shell axis angle from vertical (rad)
  sq?: number; // squareness
  lift?: number;
}

/** Layered pauldron: concentric shells around the shoulder joint, riding the upper arm. */
function pauldron(k: KitCtx, s: number, o: PauldronOpts): void {
  const kb = k.bulk;
  const R = (o.r ?? 0.152) * kb;
  const tilt = o.tilt ?? 0.55;
  const shell = (r: number): StarSurface => ({ c: V3(0.0, -0.01, 0), r: () => r });
  const axis = V3(Math.sin(tilt), Math.cos(tilt), 0);
  const vax = V3(-Math.cos(tilt), Math.sin(tilt), 0);
  const cap = starWrap(shell(R), axis, V3(0, 0, -1), vax, R);
  const w = (o.w ?? 0.25) * kb;
  const down = (o.down ?? 0.1) * kb;
  const over = (o.over ?? 0.06) * kb;
  const sq = o.sq ?? 0.05;
  const capOl = outline([[-w / 2, -down, sq], [w / 2, -down, sq], [w / 2 - 0.01, over, sq * 0.9], [-w / 2 + 0.01, over, sq * 0.9]], { maxLen: 0.045 });
  const t = o.t ?? 0.022;
  const arm = sideBone('arm', s);
  k.add(arm, 'paint', sided(plate(cap, capOl, { t, h0: 0.0, bevel: 0.009, rings: 3, lift: (u, v) => (o.lift ?? 0.008) * bump(u / (w * 0.6), (v + down * 0.2) / (down + over)) }), s), o.capCol);
  if (o.rim) {
    const rimOl = outline([[-w / 2 - 0.004, -down - 0.004, sq], [w / 2 + 0.004, -down - 0.004, sq], [w / 2 + 0.004, -down + 0.026, sq * 0.5], [-w / 2 - 0.004, -down + 0.026, sq * 0.5]], { maxLen: 0.05 });
    k.add(arm, 'paint', sided(plate(cap, rimOl, { t: 0.01, h0: t - 0.004, bevel: 0.005, rings: 1 }), s), o.rim);
  }
  const n = o.lames ?? 1;
  for (let i = 0; i < n; i++) {
    const r = R - 0.016 - i * 0.01;
    const lw = starWrap(shell(r), V3(1, 0.05 - i * 0.25, 0), V3(0, 0, -1), V3(0, 1, 0), r);
    const vTop = 0.02 - i * 0.055;
    const ol = outline([[-w / 2 + 0.01 + i * 0.012, vTop - 0.075, 0.03], [w / 2 - 0.01 - i * 0.012, vTop - 0.075, 0.03], [w / 2 - 0.02, vTop, 0.02], [-w / 2 + 0.02, vTop, 0.02]], { maxLen: 0.05 });
    k.add(arm, 'paint', sided(plate(lw, ol, { t: 0.016, h0: 0.0, bevel: 0.007, rings: 2 }), s), o.lameCol ?? o.capCol);
  }
}

/** upper-arm plate (arm bone), lateral/front */
function bicep(k: KitCtx, B: BodyCharts, s: number, col: Col, o: { top?: number; bot?: number; u0?: number; u1?: number } = {}): void {
  const kb = k.bulk;
  const top = o.top ?? -0.1;
  const bot = o.bot ?? -0.27;
  const u0 = (o.u0 ?? -0.02) * kb;
  const u1 = (o.u1 ?? 0.2) * kb;
  const ol = outline([[u0, bot, 0.02], [u1, bot + 0.01, 0.02], [u1, top - 0.01, 0.025], [u0 + 0.01, top, 0.025]], { maxLen: 0.05 });
  k.add(sideBone('arm', s), 'paint', sided(plate(B.upperArm, ol, { t: 0.014, h0: 0.003, bevel: 0.006, rings: 2 }), s), col);
}

/** gauntlet: closed forearm shell + outer plate */
function bracer(k: KitCtx, s: number, col: Col | null, shellCol: Col, o: { t?: number; flare?: number; top?: number } = {}): void {
  const kb = k.bulk;
  const fore = sideBone('fore', s);
  const top = o.top ?? -0.07;
  const bot = -0.27;
  const f = o.flare ?? 1;
  const shell = lathe(
    [
      [0.093 * kb * f, top + 0.008],
      [0.101 * kb * f, top],
      [0.107 * kb * f, top - 0.012],
      [0.1 * kb, bot + 0.03],
      [0.093 * kb, bot],
      [0.084 * kb, bot - 0.004],
    ],
    16,
  );
  k.add(fore, 'paint', tint(shell, 0xffffff), shellCol);
  if (col !== null) {
    const ol = outline([[0.02, bot + 0.012, 0.02], [0.24 * kb, bot + 0.012, 0.02], [0.25 * kb, top - 0.02, 0.03], [0.03, top - 0.035, 0.03]], { maxLen: 0.05 });
    const wrap = limbWrap([[0, 0.107 * f], [-0.2, 0.1], [-0.3, 0.093]], kb);
    k.add(fore, 'paint', sided(plate(wrap, ol, { t: o.t ?? 0.014, h0: 0.001, bevel: 0.006, rings: 2 }), s), col);
  }
}

/** armoured glove (hand bone): palm block, knuckle guard, curled fingers, thumb */
function glove(k: KitCtx, s: number, col: Col, o: { big?: number } = {}): void {
  const hand = sideBone('hand', s);
  const b = o.big ?? 1;
  const parts: [THREE.BufferGeometry, 'dark' | 'paint' | 'metal', Col][] = [
    [tx(rbox(0.082 * b, 0.085, 0.05 * b, 0.018), V3(0, -0.045, -0.004)), 'dark', 0xffffff],
    [tx(rbox(0.086 * b, 0.05, 0.024, 0.01), V3(0, -0.07, 0.022), E(0.15)), 'paint', col],
    [tx(rbox(0.08 * b, 0.034, 0.036, 0.013), V3(0, -0.108, -0.004), E(0.35)), 'dark', 0xffffff],
    [tx(rbox(0.076 * b, 0.03, 0.032, 0.012), V3(0, -0.128, -0.036), E(1.2)), 'dark', 0xffffff],
    [tx(new THREE.CapsuleGeometry(0.017, 0.045, 1, 5), V3(-0.046 * b, -0.058, -0.03), E(0.45, 0, -0.5)), 'dark', 0xffffff],
    [tx(bcyl(0.066 * b, 0.07 * b, 0.028, 0.006, 12, true), V3(0, -0.005, 0)), 'metal', 0xffffff],
  ];
  for (const [g, m, c] of parts) k.add(hand, m, sided(tint(g, 0xffffff), s), c);
}

/** thigh plate (leg bone) */
function thighPlate(k: KitCtx, B: BodyCharts, s: number, col: Col, o: { top?: number; bot?: number; u0?: number; u1?: number; t?: number; lift?: number } = {}): void {
  const kb = k.bulk;
  const top = o.top ?? -0.07;
  const bot = o.bot ?? -0.32;
  const u0 = (o.u0 ?? -0.08) * kb;
  const u1 = (o.u1 ?? 0.2) * kb;
  const ol = outline([[u0, bot + 0.02, 0.03], [u1 - 0.02, bot, 0.03], [u1, top - 0.02, 0.03], [u0 + 0.02, top, 0.03]], { maxLen: 0.05 });
  const lift = (u: number, v: number) => (o.lift ?? 0.006) * bump((u - (u0 + u1) / 2) / ((u1 - u0) * 0.6), (v - (top + bot) / 2) / ((top - bot) * 0.6));
  k.add(sideBone('leg', s), 'paint', sided(plate(B.thigh, ol, { t: o.t ?? 0.016, h0: 0.004, bevel: 0.007, lift, rings: 2 }), s), col);
}

/** knee cop (shin bone) */
function kneeCap(k: KitCtx, s: number, col: Col, o: { size?: number; t?: number; spike?: number } = {}): void {
  const kb = k.bulk;
  const z = (o.size ?? 1) * kb;
  const S: StarSurface = { c: V3(0, -0.01, -0.02 * kb), r: () => 0.1 * kb };
  const w = starWrap(S, V3(0, 0.12, -1), V3(1, 0, 0), V3(0, 1, 0), 0.1 * kb);
  const ol = outline([[-0.05 * z, 0.045 * z, 0.018], [0.05 * z, 0.045 * z, 0.018], [0.058 * z, -0.02 * z, 0.02], [0, (-0.07 - (o.spike ?? 0)) * z, 0.018], [-0.058 * z, -0.02 * z, 0.02]], { maxLen: 0.04 });
  k.add(sideBone('shin', s), 'paint', sided(plate(w, ol, { t: o.t ?? 0.018, h0: 0.0, bevel: 0.007, rings: 2, lift: (u, v) => 0.006 * bump(u / 0.06, v / 0.06) }), s), col);
}

/** shin greave (shin bone) */
function greave(k: KitCtx, B: BodyCharts, s: number, col: Col, o: { top?: number; bot?: number; w?: number; t?: number; ridge?: number } = {}): void {
  const kb = k.bulk;
  const top = o.top ?? -0.08;
  const bot = o.bot ?? -0.33;
  const w = (o.w ?? 0.095) * kb;
  const ol = outline([[-w, top - 0.01, 0.025], [0, top, 0.02], [w, top - 0.01, 0.025], [w * 0.85, bot, 0.02], [-w * 0.85, bot, 0.02]], { maxLen: 0.05 });
  const rg = o.ridge ?? 0.008;
  k.add(sideBone('shin', s), 'paint', sided(plate(B.shin, ol, { t: o.t ?? 0.016, h0: 0.004, bevel: 0.007, rings: 2, lift: (u) => rg * ridge(u, 0.035) }), s), col);
}

/** boot: sculpted shell, sole, magnetic plate, toe cap, heel, ankle cuff (foot bone) */
function boot(k: KitCtx, s: number, shellCol: Col, toeCol: Col, o: { big?: number; cuffCol?: Col; cuff?: boolean } = {}): void {
  const kb = k.bulk;
  const b = o.big ?? 1;
  const foot = sideBone('foot', s);
  const S: StarSurface = helmSurface({ w: 0.088 * kb * b, up: 0.1, dn: 0.07, fr: 0.18 * b, bk: 0.1, p: 2.7, jaw: 0, cy: 0.0, cz: -0.05 });
  const parts: [THREE.BufferGeometry, 'paint' | 'dark' | 'metal', Col][] = [];
  parts.push([starMesh(S, 14, 8, (d) => d.y > 0.72), 'paint', shellCol]);
  const fp = outline([[-0.085 * kb * b, 0.12, 0.05], [0.085 * kb * b, 0.12, 0.05], [0.09 * kb * b, -0.15 * b, 0.06], [-0.09 * kb * b, -0.15 * b, 0.06]], { maxLen: 0.06 });
  const sole = extr(fp, 0.03, 0.007, 1, 2);
  tx(sole, V3(0, -0.066, -0.05), E(Math.PI / 2));
  parts.push([sole, 'dark', 0xffffff]);
  const mag = tx(rbox(0.14 * kb * b, 0.012, 0.22 * b, 0.005), V3(0, -0.084, -0.065));
  parts.push([mag, 'metal', 0xffffff]);
  const front = starWrap(S, V3(0, -0.25, -1), V3(1, 0, 0), V3(0, 1, 0), 0.12);
  parts.push([plate(front, outline([[-0.06 * kb, 0.035, 0.02], [0.06 * kb, 0.035, 0.02], [0.075 * kb, -0.05, 0.02], [-0.075 * kb, -0.05, 0.02]], { maxLen: 0.06 }), { t: 0.014, h0: 0.0, bevel: 0.006, rings: 2 }), 'paint', toeCol]);
  const back = starWrap(S, V3(0, -0.3, 1), V3(-1, 0, 0), V3(0, 1, 0), 0.1);
  parts.push([plate(back, rrect(0, 0.0, 0.1 * kb, 0.07, 0.02, 0.06), { t: 0.012, h0: 0.0, bevel: 0.005, rings: 1 }), 'paint', toeCol]);
  if (o.cuff !== false) {
    const cuff = lathe([[0.098 * kb, 0.03], [0.104 * kb, 0.038], [0.106 * kb, 0.1], [0.1 * kb, 0.112], [0.088 * kb, 0.108]], 14);
    tx(cuff, V3(0, 0, 0.005));
    parts.push([cuff, 'paint', o.cuffCol ?? k.pal.trim]);
  }
  for (const [g, m, c] of parts) k.add(foot, m, sided(tint(g, 0xffffff, true), s), c);
}

/** the standard limb set */
function limbs(
  k: KitCtx,
  B: BodyCharts,
  o: {
    pauldron: PauldronOpts | ((s: number) => PauldronOpts | null);
    bicep?: Col | null;
    bracer: [Col | null, Col];
    glove: Col;
    gloveBig?: number;
    thigh?: Col | null;
    knee?: Col | null;
    greave?: Col | null;
    boot: [Col, Col];
    bootBig?: number;
    flare?: number;
  },
): void {
  for (const s of SIDES) {
    const po = typeof o.pauldron === 'function' ? o.pauldron(s) : o.pauldron;
    if (po) pauldron(k, s, po);
    if (o.bicep) bicep(k, B, s, o.bicep);
    bracer(k, s, o.bracer[0], o.bracer[1], { flare: o.flare });
    glove(k, s, o.glove, { big: o.gloveBig });
    if (o.thigh) thighPlate(k, B, s, o.thigh);
    if (o.knee) kneeCap(k, s, o.knee);
    if (o.greave) greave(k, B, s, o.greave);
    boot(k, s, o.boot[0], o.boot[1], { big: o.bootBig });
  }
}

// ---------------------------------------------------------------------------
// packs (pack-bone space; front face of the pack sits against the back at z ≈ -0.11)

const onPack = (k: KitCtx, mat: 'paint' | 'dark' | 'metal' | 'glow', g: THREE.BufferGeometry, col?: Col) => k.add('pack', mat, tint(g, 0xffffff, true), col);

/** bell nozzle pointing down */
function nozzle(r = 0.06, len = 0.12): THREE.BufferGeometry {
  return lathe([[r * 0.55, len * 0.5], [r * 0.62, len * 0.3], [r * 0.7, 0], [r * 0.95, -len * 0.45], [r, -len * 0.5], [r * 0.9, -len * 0.5], [r * 0.6, -len * 0.1], [r * 0.3, len * 0.1]], 14);
}

/** capsule tank along Y */
function tank(r: number, len: number, seg = 12): THREE.BufferGeometry {
  const pr: [number, number][] = [[0.001, -len / 2]];
  for (let i = 1; i <= 3; i++) {
    const a = (i / 3) * Math.PI * 0.5;
    pr.push([Math.sin(a) * r, -len / 2 + r - Math.cos(a) * r]);
  }
  for (let i = 0; i <= 3; i++) {
    const a = (i / 3) * Math.PI * 0.5;
    pr.push([Math.cos(a) * r, len / 2 - r + Math.sin(a) * r]);
  }
  pr[pr.length - 1][0] = 0.001;
  return lathe(pr, seg);
}

/** pair of thruster nozzles at x = ±sx, y (top of the nozzle housing) */
function thrusters(k: KitCtx, sx: number, y: number, z: number, r = 0.06, col: Col = 0xffffff): void {
  for (const s of SIDES) {
    onPack(k, 'dark', tx(bcyl(r * 0.85, r * 0.92, 0.05, 0.006, 12), V3(s * sx, y - 0.025, z)));
    onPack(k, 'metal', tx(nozzle(r, r * 2), V3(s * sx, y - 0.05 - r, z)), col);
  }
  const exit = y - 0.05 - r * 2;
  k.nozzles = [
    [sx, exit - 0.35, z],
    [-sx, exit - 0.35, z],
  ];
}

/** raised face panel on a box pack */
function packPanel(k: KitCtx, w: number, h: number, zFace: number, col: Col, y = 0): void {
  const face = planeWrap(new THREE.Matrix4().makeTranslation(0, y, zFace));
  onPack(k, 'paint', plate(face, outline([[-w * 0.5, -h * 0.5, 0.03], [w * 0.5, -h * 0.5, 0.03], [w * 0.54, h * 0.48, 0.04], [-w * 0.54, h * 0.48, 0.04]], { maxLen: 0.08 }), { t: 0.02, h0: 0.0, bevel: 0.008, rings: 1 }), col);
}

function jetpack(k: KitCtx, o: { col: Col; body: Col; tankCol?: Col; fins?: Col | null; w?: number; h?: number; d?: number; tanks?: boolean; antenna?: boolean }): void {
  const w = o.w ?? 0.42;
  const h = o.h ?? 0.5;
  const d = o.d ?? 0.2;
  onPack(k, 'paint', tx(rbox(w, h, d, 0.045, 2), V3(0, 0.0, 0.0)), o.body);
  packPanel(k, w * 0.66, h * 0.82, d / 2, o.col);
  onPack(k, 'glow', tx(rbox(w * 0.4, 0.014, 0.01, 0.004, 1), V3(0, h * 0.25, d / 2 + 0.022)), k.pal.glow);
  for (let i = 0; i < 3; i++) onPack(k, 'dark', tx(rbox(w * 0.42, 0.013, 0.012, 0.004, 1), V3(0, -h * 0.05 - i * 0.03, d / 2 + 0.022)));
  if (o.tanks !== false) {
    for (const s of SIDES) {
      onPack(k, 'paint', tx(tank(0.062, h * 0.92), V3(s * (w / 2 + 0.02), 0.0, 0.03)), o.tankCol ?? k.pal.sec);
      for (const y of [-h * 0.26, h * 0.26]) onPack(k, 'dark', tx(bcyl(0.067, 0.067, 0.022, 0.004, 12, true), V3(s * (w / 2 + 0.02), y, 0.03)));
    }
  }
  thrusters(k, 0.15, -h / 2 + 0.01, 0.06);
  if (o.fins) {
    const fin = outline([[0, 0, 0.01], [0.1, 0.06, 0.02], [0.13, 0.24, 0.015], [0.03, 0.2, 0.02]], { maxLen: 0.1 });
    for (const s of SIDES) {
      const g = extr(fin, 0.022, 0.006, 1);
      tx(g, V3(0, 0, 0), E(0, Math.PI / 2, 0));
      tx(g, V3(w / 2 + 0.07, -0.05, 0.06), E(0, 0, -0.2));
      onPack(k, 'paint', s > 0 ? g : mirrorX(g), o.fins);
    }
  }
  if (o.antenna) {
    onPack(k, 'metal', tx(bcyl(0.004, 0.007, 0.34, 0.001, 6), V3(0.13, h / 2 + 0.15, 0.03), E(0.05, 0, -0.1)));
    onPack(k, 'glow', tx(new THREE.SphereGeometry(0.01, 8, 6), V3(0.147, h / 2 + 0.32, 0.04)), k.pal.glow);
  }
}

// ---------------------------------------------------------------------------
// heroes

function kitCondor(k: KitCtx): void {
  const P = k.pal;
  const B = bodyCharts(k.bulk);
  gorget(k, P.trim, { rim: P.main });
  chestPecs(k, B, [P.main, P.main], P.sec);
  abs(k, B, [P.trim]);
  backPlate(k, B, P.main);
  kidney(k, B, P.trim);
  belt(k, B, P.trim, P.sec);
  codpiece(k, B, P.main);
  limbs(k, B, { pauldron: { capCol: P.main, lameCol: P.sec, lames: 1 }, bicep: P.trim, bracer: [P.main, P.trim], glove: P.main, thigh: P.main, knee: P.sec, greave: P.main, boot: [P.trim, P.main] });
  jetpack(k, { col: P.main, body: P.trim, fins: P.acc, antenna: true });
}

function kitLunatic(k: KitCtx): void {
  const P = k.pal;
  const B = bodyCharts(k.bulk);
  gorget(k, P.trim);
  // mismatched chest: orange left pec, scrap-metal right pec with rivets
  chestPecs(k, B, [P.sec, P.main], null, { lift: 0.01 });
  for (const [u, v] of [[0.06, 1.52], [0.2, 1.48], [0.2, 1.33], [0.08, 1.3]] as [number, number][]) k.torso('metal', onSurface(B.front, u, v, 0.028, bcyl(0.008, 0.009, 0.008, 0.002, 6)));
  for (let i = 0; i < 3; i++) k.torso('paint', plate(B.front, strip(-0.2 + i * 0.045, 1.33, -0.16 + i * 0.045, 1.4, 0.018), { t: 0.004, h0: 0.028, bevel: 0.002, sink: 0.008, rings: 1, soft: false }), P.trim);
  abs(k, B, [P.trim], { n: 2 });
  // bandolier with grenades
  k.torso('paint', plate(B.front, strip(-0.25, 1.58, 0.22, 1.0, 0.05, 0.015), { t: 0.012, h0: 0.028, bevel: 0.005, rings: 1 }), P.trim);
  k.torso('paint', plate(B.back, strip(0.24, 1.58, -0.22, 1.0, 0.05, 0.015), { t: 0.01, h0: 0.02, bevel: 0.005, rings: 1 }), P.trim);
  for (let i = 0; i < 5; i++) {
    const f = 0.12 + i * 0.17;
    const u = -0.25 + (0.47 * f);
    const v = 1.58 - 0.58 * f;
    k.torso('paint', onSurface(B.front, u, v, 0.034, tank(0.028, 0.07, 8)), P.acc);
    k.torso('metal', onSurface(B.front, u, v, 0.1, bcyl(0.012, 0.014, 0.014, 0.003, 6, true)));
  }
  backPlate(k, B, P.main);
  belt(k, B, P.trim, P.sec, { pouches: 2, pouchCol: P.sec });
  codpiece(k, B, P.main);
  limbs(k, B, {
    pauldron: (s) => (s < 0 ? { capCol: P.sec, lameCol: P.main, lames: 2, r: 0.165, w: 0.27, rim: P.trim } : { capCol: P.main, lames: 0, r: 0.145, w: 0.22, down: 0.085 }),
    bracer: [P.main, P.trim],
    glove: P.sec,
    knee: P.sec,
    greave: P.main,
    boot: [P.trim, P.sec],
  });
  thighPlate(k, B, -1, P.main);
  k.add('legR', 'paint', tint(tx(rbox(0.07, 0.1, 0.05, 0.012), V3(0.12, -0.2, -0.05), E(0, 0.8, 0)), 0xffffff), P.trim);
  k.add('legR', 'paint', tint(tx(rbox(0.07, 0.1, 0.05, 0.012), V3(0.02, -0.22, -0.13), E(0, 0.1, 0)), 0xffffff), P.trim);
  // mini-nuke canister on a frame
  onPack(k, 'paint', tx(rbox(0.36, 0.42, 0.12, 0.03), V3(0, -0.02, -0.04)), P.trim);
  onPack(k, 'paint', tx(tank(0.13, 0.5, 16), V3(0, 0.04, 0.1)), P.acc);
  for (const y of [-0.12, 0.0, 0.12]) onPack(k, 'paint', tx(bcyl(0.134, 0.134, 0.035, 0.005, 16, true), V3(0, 0.04 + y, 0.1)), P.trim);
  onPack(k, 'glow', tx(new THREE.TorusGeometry(0.135, 0.009, 6, 24), V3(0, 0.1, 0.1), E(Math.PI / 2)), P.glow);
  onPack(k, 'metal', tx(lathe([[0.1, 0], [0.07, 0.08], [0.02, 0.14], [0.001, 0.15]], 16), V3(0, 0.26, 0.1)));
  for (const s of SIDES) onPack(k, 'paint', tx(extr(outline([[0, 0, 0.005], [0.07, -0.03, 0.01], [0.07, 0.05, 0.01], [0, 0.1, 0.005]], { maxLen: 0.2 }), 0.012, 0.004, 1), V3(s * 0.12, -0.2, 0.1), E(0, s > 0 ? 0 : Math.PI, 0)), P.main);
  thrusters(k, 0.13, -0.22, 0.02, 0.05);
}

function kitNeedle(k: KitCtx): void {
  const P = k.pal;
  const B = bodyCharts(k.bulk);
  gorget(k, P.trim, { r: 0.16 });
  chestPlate(k, B, P.main, [[0, 1.58, 0.01], [0.1, 1.6, 0.03], [0.21, 1.55, 0.04], [0.235, 1.42, 0.04], [0.2, 1.3, 0.04], [0.06, 1.24, 0.03], [0, 1.23, 0.01]], { lift: (u, v) => 0.01 * bump((Math.abs(u) - 0.1) / 0.14, (v - 1.45) / 0.16) });
  k.torso('paint', plate(B.front, strip(0.075, 1.27, 0.075, 1.58, 0.03, 0.012), { t: 0.006, h0: 0.03, bevel: 0.003, rings: 1 }), P.sec);
  abs(k, B, [P.trim], { n: 3, w: 0.18 });
  backPlate(k, B, P.main, { w: 0.21 });
  kidney(k, B, P.trim);
  belt(k, B, P.trim, P.sec, { pouches: 1 });
  codpiece(k, B, P.trim, { w: 0.07 });
  // long coat-like tassets: sides + back tails
  for (const s of SIDES) {
    tasset(k, B, s, P.main, { u0: 0.04, u1: 0.24, top: 0.06, bot: -0.24, wLeg: 0.4 });
    tasset(k, B, s, P.sec, { u0: 0.24, u1: 0.44, top: 0.05, bot: -0.3, wLeg: 0.3, h0: 0.026 });
  }
  limbs(k, B, { pauldron: { capCol: P.sec, lames: 0, r: 0.138, w: 0.22, down: 0.085, over: 0.05 }, bracer: [P.main, P.trim], glove: P.trim, thigh: P.main, knee: P.sec, greave: P.main, boot: [P.trim, P.sec] });
  // slim pack with a sensor mast
  onPack(k, 'paint', tx(rbox(0.3, 0.46, 0.15, 0.035, 2), V3(0, 0.0, -0.03)), P.trim);
  packPanel(k, 0.2, 0.36, 0.045, P.main);
  onPack(k, 'glow', tx(rbox(0.012, 0.26, 0.01, 0.004), V3(-0.07, 0.0, 0.07)), P.glow);
  for (const s of SIDES) onPack(k, 'paint', tx(tank(0.04, 0.34, 10), V3(s * 0.17, -0.02, 0.0)), P.sec);
  thrusters(k, 0.1, -0.22, 0.0, 0.045);
}

function kitPhantom(k: KitCtx): void {
  const P = k.pal;
  const B = bodyCharts(k.bulk);
  gorget(k, P.sec, { r: 0.16 });
  chestPecs(k, B, [P.sec, P.sec], P.main, { lift: 0.008, t: 0.016 });
  for (const s of SIDES) k.torso('glow', plate(B.front, strip(s * 0.07, 1.3, s * 0.2, 1.52, 0.01), { t: 0.004, h0: 0.028, bevel: 0.001, sink: 0.01, rings: 1, soft: false }), P.glow);
  k.torso('paint', torsoBand(B, 1.08, 1.2, 0.012), P.sec);
  backPlate(k, B, P.sec, { w: 0.2 });
  belt(k, B, P.trim, P.main, { pouches: 1 });
  for (const s of SIDES) {
    pauldron(k, s, { capCol: P.sec, lames: 0, r: 0.135, w: 0.2, down: 0.08, over: 0.05, lift: 0.004 });
    bracer(k, s, P.sec, P.trim, { t: 0.01 });
    k.add(sideBone('fore', s), 'glow', sided(plate(B.fore, strip(0.13, -0.09, 0.13, -0.24, 0.01), { t: 0.004, h0: 0.02, bevel: 0.001, sink: 0.01, rings: 1, soft: false }), s), P.glow);
    glove(k, s, P.sec);
    kneeCap(k, s, P.sec, { size: 0.85 });
    greave(k, B, s, P.sec, { t: 0.012 });
    k.add(sideBone('shin', s), 'glow', sided(plate(B.shin, strip(0, -0.12, 0, -0.3, 0.01), { t: 0.004, h0: 0.026, bevel: 0.001, sink: 0.01, rings: 1, soft: false }), s), P.glow);
    boot(k, s, P.trim, P.sec);
  }
  // slim cloak-emitter pack
  const pk = tank(0.12, 0.44, 16);
  tx(pk, V3(0, 0.0, -0.02), E(), V3(1.25, 1, 0.55));
  onPack(k, 'paint', pk, P.sec);
  onPack(k, 'glow', tx(new THREE.TorusGeometry(0.075, 0.01, 6, 24), V3(0, 0.05, 0.05)), P.glow);
  onPack(k, 'paint', tx(bcyl(0.06, 0.06, 0.02, 0.004, 16), V3(0, 0.05, 0.045), E(Math.PI / 2)), P.main);
  thrusters(k, 0.09, -0.2, -0.01, 0.042);
}

function kitBlade(k: KitCtx): void {
  const P = k.pal;
  const B = bodyCharts(k.bulk);
  gorget(k, P.sec, { r: 0.16, rim: P.main });
  // do: lamellar chest bands (lower band over the upper)
  const bands: [number, number, number][] = [
    [1.49, 1.6, 0.25],
    [1.39, 1.5, 0.265],
    [1.29, 1.4, 0.26],
  ];
  bands.forEach(([v0, v1, w], i) => {
    const ww = w * k.bulk;
    k.torso('paint', plate(B.front, symOutline([[0, v1, 0.01], [ww, v1 - 0.01, 0.02], [ww, v0, 0.02], [0, v0, 0.01]], 0.05), { t: 0.016, h0: 0.008 + i * 0.006, bevel: 0.006, rings: 2 }), P.main);
    k.torso('paint', plate(B.front, strip(-ww + 0.02, v0 + 0.012, ww - 0.02, v0 + 0.012, 0.008), { t: 0.003, h0: 0.022 + i * 0.006, bevel: 0.001, sink: 0.006, rings: 1, soft: false }), P.acc);
  });
  abs(k, B, [P.sec, P.main], { n: 2, top: 1.28, bot: 1.1 });
  backPlate(k, B, P.sec, { w: 0.22 });
  // obi belt with knot
  belt(k, B, P.sec, P.acc, { pouches: 0, v0: 0.95, v1: 1.05 });
  // kusazuri: two-tier skirt plates around the hips (lathe phi 0 = back, pi = front)
  for (const phi of [Math.PI - 0.34, Math.PI + 0.34, Math.PI - 1.0, Math.PI + 1.0, 1.62, -1.62, 0.36, -0.36]) {
    const x = Math.sin(phi);
    const side = x > 0.25 ? 1 : x < -0.25 ? -1 : 0;
    for (let tier = 0; tier < 2; tier++) {
      const yT = -0.02 - tier * 0.1;
      const rT = 0.235 * k.bulk + tier * 0.022;
      const g = lathe([[rT - 0.01, yT + 0.004], [rT, yT], [rT + 0.034, yT - 0.12], [rT + 0.026, yT - 0.126], [rT - 0.008, yT - 0.006]], 3, phi - 0.29, 0.58);
      tx(g, V3(0, 0, 0), E(), V3(1, 1, 0.78));
      const col = tier === 1 ? P.main : P.sec;
      if (side === 0) k.add('hips', 'paint', tint(g, 0xffffff), col);
      else k.blend('hips', { hips: 0.55, [side > 0 ? 'legR' : 'legL']: 0.45 } as Partial<Record<BoneName, number>>, 'paint', tint(g, 0xffffff), col);
    }
  }
  // sode: big layered left shoulder, light right
  for (const s of SIDES) {
    if (s < 0) {
      for (let i = 0; i < 3; i++) {
        const r = (0.17 + i * 0.012) * k.bulk;
        const W = limbWrap([[0.1, r], [-0.3, r + 0.03]], 1);
        const top = 0.08 - i * 0.075;
        const ol = outline([[0.06, top - 0.1, 0.02], [0.36, top - 0.1, 0.02], [0.36, top, 0.02], [0.06, top, 0.02]], { maxLen: 0.06 });
        k.add('armL', 'paint', mirrorX(plate(W, ol, { t: 0.014, h0: 0.0, bevel: 0.006, rings: 1 })), i === 2 ? P.acc : P.main);
      }
      k.add('armL', 'paint', mirrorX(tint(tx(rbox(0.05, 0.03, 0.26, 0.01), V3(0.12, 0.15, 0.0), E(0, 0, -0.55)), 0xffffff)), P.sec);
    } else pauldron(k, s, { capCol: P.main, lames: 0, r: 0.14, w: 0.2, down: 0.08, over: 0.05 });
    bracer(k, s, P.main, P.sec, { t: 0.012 });
    glove(k, s, P.sec);
    kneeCap(k, s, P.main, { size: 0.9 });
    // suneate: splinted greaves
    greave(k, B, s, P.main, { ridge: 0.004 });
    for (const u of [-0.045, 0.045]) k.add(sideBone('shin', s), 'paint', sided(plate(B.shin, strip(u, -0.1, u, -0.31, 0.012), { t: 0.004, h0: 0.022, bevel: 0.002, sink: 0.008, rings: 1, soft: false }), s), P.acc);
    boot(k, s, P.sec, P.sec);
  }
  // compact thruster pack + saya across the back
  onPack(k, 'paint', tx(rbox(0.32, 0.36, 0.13, 0.03, 2), V3(0, 0.02, -0.04)), P.sec);
  packPanel(k, 0.2, 0.26, 0.025, P.main, 0.02);
  const saya = extr(outline([[-0.028, -0.5, 0.012], [0.028, -0.5, 0.012], [0.03, 0.46, 0.012], [-0.03, 0.46, 0.012]], { maxLen: 0.3 }), 0.045, 0.008, 1);
  tx(saya, V3(0.02, 0.05, 0.08), E(0, 0, -0.62));
  onPack(k, 'paint', saya, P.trim);
  for (const f of [-0.35, 0.3]) onPack(k, 'paint', tx(bcyl(0.036, 0.036, 0.03, 0.006, 10), V3(0.02 + Math.sin(0.62) * f, 0.05 + Math.cos(0.62) * f, 0.08), E(0, 0, -0.62)), P.acc);
  onPack(k, 'metal', tx(bcyl(0.055, 0.055, 0.012, 0.004, 12), V3(0.02 - Math.sin(0.62) * -0.47, 0.05 + Math.cos(0.62) * 0.47, 0.08), E(0, 0, -0.62)), 0xd8b25a);
  onPack(k, 'paint', tx(bcyl(0.022, 0.022, 0.2, 0.004, 8), V3(0.02 - Math.sin(0.62) * -0.58, 0.05 + Math.cos(0.62) * 0.58, 0.08), E(0, 0, -0.62)), P.acc);
  onPack(k, 'glow', tx(rbox(0.012, 0.2, 0.01, 0.004), V3(-0.06, 0.02, 0.03)), P.glow);
  thrusters(k, 0.1, -0.16, -0.02, 0.042);
}

function kitReactor(k: KitCtx): void {
  const P = k.pal;
  const B = bodyCharts(k.bulk);
  gorget(k, P.sec, { r: 0.19, h: 0.12, rim: P.main });
  // massive chest plate with the reactor core
  chestPlate(k, B, P.main, [[0, 1.6, 0.01], [0.12, 1.62, 0.03], [0.3, 1.57, 0.05], [0.335, 1.44, 0.05], [0.3, 1.29, 0.05], [0.14, 1.22, 0.04], [0, 1.2, 0.01]], { t: 0.03, lift: (u, v) => 0.014 * bump((Math.abs(u) - 0.16) / 0.2, (v - 1.47) / 0.2) });
  const core = onSurface(B.front, 0, 1.42, 0.03, lathe([[0.11, -0.002], [0.12, 0.01], [0.115, 0.03], [0.095, 0.034], [0.085, 0.012]], 20));
  k.torso('paint', core, P.trim);
  k.torso('glow', onSurface(B.front, 0, 1.42, 0.04, bcyl(0.084, 0.084, 0.014, 0.004, 20)), P.glow);
  for (let i = 0; i < 4; i++) k.torso('metal', onSurface(B.front, 0, 1.42, 0.058, tx(rbox(0.17, 0.012, 0.012, 0.004), V3(0, 0, 0), E(0, (i * Math.PI) / 4, 0))));
  for (let i = 0; i < 4; i++) k.torso('paint', plate(B.front, strip(-0.2 + i * 0.06, 1.24, -0.17 + i * 0.06, 1.3, 0.024), { t: 0.004, h0: 0.038, bevel: 0.002, sink: 0.008, rings: 1, soft: false }), P.trim);
  abs(k, B, [P.sec], { n: 3, w: 0.22, t: 0.02 });
  backPlate(k, B, P.main, { w: 0.28 });
  kidney(k, B, P.sec, { w: 0.2 });
  belt(k, B, P.trim, P.main, { pouches: 1, pouchCol: P.sec });
  codpiece(k, B, P.main, { w: 0.1 });
  for (const s of SIDES) tasset(k, B, s, P.main, { u0: 0.08, u1: 0.26, top: 0.06, bot: -0.12, t: 0.02 });
  limbs(k, B, {
    pauldron: { capCol: P.main, lameCol: P.sec, rim: P.sec, lames: 2, r: 0.18, w: 0.3, down: 0.12, over: 0.07, t: 0.03, lift: 0.014 },
    bicep: P.sec,
    bracer: [P.main, P.trim],
    flare: 1.15,
    glove: P.main,
    gloveBig: 1.2,
    thigh: P.main,
    knee: P.sec,
    greave: P.main,
    boot: [P.trim, P.main],
    bootBig: 1.08,
  });
  // big reactor pack: coolant rods in cages, radiator fins, heavy nozzles
  onPack(k, 'paint', tx(rbox(0.5, 0.58, 0.24, 0.05, 2), V3(0, 0.0, 0.0)), P.trim);
  packPanel(k, 0.34, 0.48, 0.12, P.main);
  for (const x of [-0.11, 0, 0.11]) {
    onPack(k, 'glow', tx(bcyl(0.018, 0.018, 0.4, 0.004, 6), V3(x, 0.02, 0.15)), P.glow);
    onPack(k, 'metal', tx(bcyl(0.04, 0.04, 0.03, 0.005, 10), V3(x, 0.24, 0.17)));
    onPack(k, 'metal', tx(bcyl(0.04, 0.04, 0.03, 0.005, 10), V3(x, -0.2, 0.17)));
  }
  for (const s of SIDES) for (let i = 0; i < 4; i++) onPack(k, 'paint', tx(rbox(0.06, 0.012, 0.18, 0.004), V3(s * 0.27, 0.16 - i * 0.07, 0.0)), P.sec);
  thrusters(k, 0.17, -0.28, 0.05, 0.07);
}

function kitHelios(k: KitCtx): void {
  const P = k.pal;
  const B = bodyCharts(k.bulk);
  gorget(k, P.main, { rim: P.sec });
  // rounded medic chest plate with the glowing cross badge
  chestPlate(k, B, P.sec, [[0, 1.58, 0.01], [0.12, 1.6, 0.04], [0.235, 1.53, 0.06], [0.25, 1.4, 0.06], [0.2, 1.28, 0.06], [0.08, 1.24, 0.04], [0, 1.235, 0.02]], { lift: (u, v) => 0.012 * bump(u / 0.3, (v - 1.43) / 0.2) });
  k.torso('paint', plate(B.front, outline([[0, 1.35, 0], [0.07, 1.42, 0], [0, 1.49, 0], [-0.07, 1.42, 0]].map(([u, v]) => [u, v, 0.03] as [number, number, number]), { maxLen: 0.04 }), { t: 0.01, h0: 0.034, bevel: 0.004, rings: 2 }), P.main);
  k.torso('glow', plate(B.front, strip(0, 1.385, 0, 1.455, 0.02, 0.004), { t: 0.004, h0: 0.042, bevel: 0.001, sink: 0.008, rings: 1, soft: false }), P.glow);
  k.torso('glow', plate(B.front, strip(-0.035, 1.42, 0.035, 1.42, 0.02, 0.004), { t: 0.004, h0: 0.042, bevel: 0.001, sink: 0.008, rings: 1, soft: false }), P.glow);
  abs(k, B, [P.sec], { n: 2, top: 1.22, bot: 1.06 });
  backPlate(k, B, P.sec);
  belt(k, B, P.main, P.sec, { pouches: 2, pouchCol: P.sec });
  codpiece(k, B, P.sec);
  limbs(k, B, { pauldron: { capCol: P.main, lameCol: P.sec, lames: 1, sq: 0.07 }, bracer: [P.sec, P.main], glove: P.main, thigh: P.sec, knee: P.main, greave: P.sec, boot: [P.sec, P.main] });
  // O2 life-support pack with glowing canisters
  const body = tank(0.17, 0.5, 16);
  tx(body, V3(0, 0.0, -0.02), E(), V3(1.2, 1, 0.62));
  onPack(k, 'paint', body, P.sec);
  for (const s of SIDES) {
    onPack(k, 'paint', tx(tank(0.075, 0.52), V3(s * 0.2, -0.02, 0.07)), P.main);
    onPack(k, 'glow', tx(bcyl(0.05, 0.05, 0.26, 0.004, 10), V3(s * 0.2, -0.02, 0.1), E(), V3(1, 1, 0.9)), P.glow);
    onPack(k, 'dark', hose([V3(s * 0.2, 0.26, 0.05), V3(s * 0.16, 0.36, -0.02), V3(s * 0.1, 0.32, -0.14)], 0.014, 10, 6));
  }
  onPack(k, 'glow', tx(rbox(0.06, 0.018, 0.01, 0.004), V3(0, 0.1, 0.09)), P.glow);
  onPack(k, 'glow', tx(rbox(0.018, 0.06, 0.01, 0.004), V3(0, 0.1, 0.09)), P.glow);
  thrusters(k, 0.1, -0.25, 0.02, 0.048);
}

function kitForge(k: KitCtx): void {
  const P = k.pal;
  const B = bodyCharts(k.bulk);
  gorget(k, P.trim, { r: 0.175 });
  // work vest: padded chest panel, pouches, orange straps
  chestPlate(k, B, P.sec, [[0, 1.57, 0.01], [0.1, 1.6, 0.03], [0.24, 1.55, 0.05], [0.265, 1.4, 0.05], [0.255, 1.18, 0.04], [0, 1.16, 0.01]], { t: 0.018, rings: 3, lift: (u, v) => 0.008 * bump((Math.abs(u) - 0.12) / 0.16, (v - 1.42) / 0.18) });
  for (const s of SIDES) {
    k.torso('paint', plate(B.front, strip(s * 0.15, 1.62, s * 0.13, 1.2, 0.05, 0.015), { t: 0.006, h0: 0.028, bevel: 0.003, rings: 1 }), P.main);
    k.torso('paint', plate(B.back, strip(s * 0.15, 1.62, s * 0.13, 1.2, 0.05, 0.015), { t: 0.006, h0: 0.028, bevel: 0.003, rings: 1 }), P.main);
    for (const [u, v] of [[0.06, 1.26], [0.21, 1.27]] as [number, number][]) {
      k.torso('paint', plate(B.front, rrect(s * u, v, 0.1, 0.1, 0.015), { t: 0.035, h0: 0.022, bevel: 0.007, rings: 1 }), P.trim);
      k.torso('paint', plate(B.front, rrect(s * u, v + 0.035, 0.105, 0.035, 0.012), { t: 0.01, h0: 0.056, bevel: 0.004, rings: 1 }), P.main);
    }
  }
  backPlate(k, B, P.sec, { w: 0.25 });
  belt(k, B, P.trim, P.main, { pouches: 3, pouchCol: P.sec });
  k.torso('metal', onSurface(B.front, 0.28, 0.9, 0.03, tx(rbox(0.024, 0.2, 0.012, 0.005), V3(0, 0, 0), E(0, 0, 0.2))));
  codpiece(k, B, P.trim);
  limbs(k, B, { pauldron: { capCol: P.main, lameCol: P.sec, lames: 1, r: 0.16, sq: 0.06 }, bicep: P.sec, bracer: [P.main, P.trim], flare: 1.08, glove: P.main, gloveBig: 1.12, knee: P.main, greave: P.main, boot: [P.trim, P.main], bootBig: 1.05 });
  for (const s of SIDES) k.add(sideBone('leg', s), 'paint', sided(tint(tx(rbox(0.06, 0.12, 0.08, 0.014), V3(0.14 * k.bulk, -0.2, -0.02), E(0, 0.2, 0)), 0xffffff), s), P.sec);
  // fabricator backpack with a folded manipulator arm
  onPack(k, 'paint', tx(rbox(0.5, 0.52, 0.26, 0.05, 2), V3(0, -0.02, 0.01)), P.trim);
  for (const s of SIDES) onPack(k, 'paint', tx(rbox(0.04, 0.44, 0.22, 0.015), V3(s * 0.25, -0.02, 0.01)), P.main);
  packPanel(k, 0.3, 0.3, 0.14, P.sec, 0.05);
  onPack(k, 'glow', tx(rbox(0.28, 0.016, 0.01, 0.004), V3(0, -0.16, 0.145)), P.glow);
  const j0 = V3(0.18, 0.26, 0.04);
  const j1 = V3(0.1, 0.5, -0.02);
  const j2 = V3(-0.08, 0.6, -0.06);
  onPack(k, 'metal', tx(bcyl(0.04, 0.04, 0.05, 0.006, 12), j0, E(0, 0, Math.PI / 2)));
  onPack(k, 'paint', hose([j0, j1], 0.026, 2, 8), P.main);
  onPack(k, 'metal', tx(bcyl(0.034, 0.034, 0.05, 0.006, 12), j1, E(0, 0, Math.PI / 2)));
  onPack(k, 'paint', hose([j1, j2], 0.022, 2, 8), P.main);
  onPack(k, 'metal', tx(new THREE.SphereGeometry(0.03, 10, 8), j2));
  for (const a of [-0.5, 0.5, 1.6]) onPack(k, 'dark', tx(rbox(0.014, 0.07, 0.014, 0.004), V3(j2.x - 0.04, j2.y + Math.sin(a) * 0.02, j2.z + Math.cos(a) * 0.02), E(a, 0, 0.9)));
  thrusters(k, 0.17, -0.28, 0.04, 0.06);
}

function kitHive(k: KitCtx): void {
  const P = k.pal;
  const B = bodyCharts(k.bulk);
  gorget(k, P.sec, { rim: P.main });
  // honeycomb chest: hex plates
  const hx: [number, number, number, boolean][] = [
    [0, 1.46, 0.085, true],
    [0.15, 1.52, 0.075, false],
    [-0.15, 1.52, 0.075, false],
    [0.15, 1.37, 0.075, false],
    [-0.15, 1.37, 0.075, false],
    [0, 1.31, 0.07, false],
  ];
  for (const [u, v, r, main] of hx) k.torso('paint', plate(B.front, hexagon(u * k.bulk, v, r, 0, 0.012), { t: 0.02, h0: 0.008, bevel: 0.008, rings: 2 }), main ? P.main : P.sec);
  k.torso('glow', plate(B.front, hexagon(0, 1.46, 0.03, 0, 0.004), { t: 0.004, h0: 0.028, bevel: 0.002, sink: 0.008, rings: 1, soft: false }), P.glow);
  // bee-striped abdomen
  abs(k, B, [P.main, P.sec, P.main], { n: 3, w: 0.24, top: 1.26 });
  backPlate(k, B, P.sec);
  belt(k, B, P.sec, P.main, { pouches: 1 });
  codpiece(k, B, P.sec);
  limbs(k, B, { pauldron: { capCol: P.main, lameCol: P.sec, lames: 1, sq: 0.03 }, bracer: [P.main, P.sec], glove: P.sec, thigh: P.main, knee: P.sec, greave: P.main, boot: [P.sec, P.main] });
  // hex drone hive pack with three docked micro-drones
  const hexBody = creased(tx(lathe([[0.001, -0.09], [0.3, -0.09], [0.3, 0.09], [0.001, 0.09]], 6), V3(0, 0, 0), E(Math.PI / 2, Math.PI / 6, 0)), 0.5);
  tx(hexBody, V3(0, 0.02, 0.0));
  onPack(k, 'paint', hexBody, P.sec);
  const rim = creased(tx(lathe([[0.3, -0.03], [0.34, -0.03], [0.34, 0.03], [0.3, 0.03]], 6), V3(0, 0, 0), E(Math.PI / 2, Math.PI / 6, 0)), 0.5);
  tx(rim, V3(0, 0.02, 0.07));
  onPack(k, 'paint', rim, P.main);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * 0.15;
    const y = Math.sin(a) * 0.15 + 0.02;
    onPack(k, 'dark', tx(bcyl(0.085, 0.085, 0.02, 0.004, 6), V3(x, y, 0.09), E(Math.PI / 2)));
    onPack(k, 'paint', tx(lathe([[0.001, -0.02], [0.06, -0.018], [0.075, 0.0], [0.06, 0.016], [0.03, 0.03], [0.001, 0.032]], 12), V3(x, y, 0.12), E(Math.PI / 2)), P.main);
    onPack(k, 'glow', tx(new THREE.SphereGeometry(0.016, 8, 6), V3(x, y, 0.155)), P.glow);
    for (let r = 0; r < 4; r++) {
      const ra = (r / 4) * Math.PI * 2 + Math.PI / 4;
      onPack(k, 'metal', tx(bcyl(0.018, 0.018, 0.008, 0.002, 8), V3(x + Math.cos(ra) * 0.06, y + Math.sin(ra) * 0.06, 0.14), E(Math.PI / 2)));
    }
  }
  thrusters(k, 0.12, -0.25, 0.0, 0.05);
}

/** Servitor — industrial work robot: no suit, exposed actuators and joints */
function kitServitor(k: KitCtx): void {
  const P = k.pal;
  const add = (b: BoneName, m: 'paint' | 'dark' | 'metal' | 'glow' | 'suit', g: THREE.BufferGeometry, c?: Col) => k.add(b, m, tint(g, 0xffffff, true), c);
  // pelvis + exposed spine
  add('hips', 'paint', tx(rbox(0.34, 0.14, 0.22, 0.04, 2), V3(0, 0.0, 0.0)), P.trim);
  add('hips', 'paint', tx(rbox(0.2, 0.1, 0.05, 0.02), V3(0, -0.02, -0.11)), P.main);
  for (let i = 0; i < 3; i++) add('spine', 'metal', tx(bcyl(0.075 - i * 0.004, 0.08 - i * 0.004, 0.05, 0.008, 12), V3(0, -0.06 + i * 0.07, 0.02)));
  add('spine', 'dark', tx(bcyl(0.035, 0.035, 0.3, 0.004, 8), V3(0, 0.06, 0.02)));
  for (const s of SIDES) add('spine', 'dark', hose([V3(s * 0.08, -0.08, -0.04), V3(s * 0.12, 0.05, -0.08), V3(s * 0.1, 0.2, -0.06)], 0.014, 8, 6));
  // chest shell
  add('chest', 'paint', tx(rbox(0.5, 0.34, 0.3, 0.06, 2), V3(0, 0.14, 0.0)), P.main);
  add('chest', 'paint', tx(rbox(0.36, 0.2, 0.05, 0.03, 2), V3(0, 0.14, -0.15)), P.trim);
  add('chest', 'glow', tx(bcyl(0.05, 0.05, 0.02, 0.004, 14), V3(0, 0.15, -0.18), E(Math.PI / 2)), P.glow);
  for (let i = 0; i < 3; i++) add('chest', 'metal', tx(rbox(0.1, 0.012, 0.012, 0.004), V3(-0.12, 0.2 - i * 0.03, -0.18)));
  for (let i = 0; i < 3; i++) add('chest', 'metal', tx(rbox(0.1, 0.012, 0.012, 0.004), V3(0.12, 0.2 - i * 0.03, -0.18)));
  add('chest', 'paint', tx(rbox(0.52, 0.04, 0.32, 0.015), V3(0, -0.035, 0.0)), P.acc);
  add('neck', 'metal', tx(bcyl(0.06, 0.07, 0.1, 0.008, 12), V3(0, 0.02, 0)));
  buildHelmet('servitor', k);
  for (const s of SIDES) {
    const arm = sideBone('arm', s);
    const fore = sideBone('fore', s);
    const leg = sideBone('leg', s);
    const shin = sideBone('shin', s);
    add(arm, 'metal', tx(new THREE.SphereGeometry(0.085, 12, 8), V3(0, 0, 0)));
    add(arm, 'paint', sided(tx(rbox(0.13, 0.12, 0.17, 0.035, 2), V3(0.04, 0.03, 0)), s), P.main);
    add(arm, 'metal', tx(bcyl(0.035, 0.035, 0.28, 0.004, 8), V3(0, -0.17, 0)));
    add(arm, 'paint', sided(tx(rbox(0.07, 0.2, 0.1, 0.02), V3(0.04, -0.17, 0.0)), s), P.trim);
    add(arm, 'metal', sided(tx(bcyl(0.012, 0.012, 0.18, 0.002, 6), V3(0.0, -0.18, -0.06)), s));
    add(fore, 'metal', tx(bcyl(0.05, 0.05, 0.08, 0.006, 12), V3(0, 0, 0), E(0, 0, Math.PI / 2)));
    add(fore, 'paint', tx(rbox(0.11, 0.22, 0.12, 0.03, 2), V3(0, -0.14, 0)), P.main);
    add(fore, 'paint', sided(tx(rbox(0.02, 0.16, 0.08, 0.008), V3(0.06, -0.14, 0)), s), P.acc);
    add(fore, 'metal', tx(bcyl(0.045, 0.05, 0.03, 0.005, 10), V3(0, -0.27, 0)));
    // three-finger claw
    const hand = sideBone('hand', s);
    add(hand, 'dark', tx(rbox(0.07, 0.07, 0.05, 0.015), V3(0, -0.04, 0)));
    for (const [x, z, a] of [[-0.025, -0.02, 0.5], [0.025, -0.02, 0.5], [0, 0.02, -0.4]] as [number, number, number][]) add(hand, 'metal', tx(rbox(0.018, 0.075, 0.018, 0.006), V3(x, -0.1, z), E(a, 0, 0)));
    add(leg, 'metal', tx(new THREE.SphereGeometry(0.075, 12, 8), V3(0, 0, 0)));
    add(leg, 'metal', tx(bcyl(0.04, 0.04, 0.38, 0.004, 8), V3(0, -0.2, 0)));
    add(leg, 'paint', tx(rbox(0.15, 0.28, 0.16, 0.04, 2), V3(0, -0.2, -0.02)), P.main);
    add(leg, 'metal', sided(tx(bcyl(0.013, 0.013, 0.24, 0.002, 6), V3(0.085, -0.22, 0.04)), s));
    add(shin, 'metal', tx(bcyl(0.055, 0.055, 0.1, 0.006, 12), V3(0, 0, 0), E(0, 0, Math.PI / 2)));
    add(shin, 'paint', tx(rbox(0.13, 0.28, 0.14, 0.035, 2), V3(0, -0.2, -0.01)), P.trim);
    add(shin, 'paint', tx(rbox(0.1, 0.2, 0.03, 0.012), V3(0, -0.18, -0.085)), P.acc);
    add(shin, 'paint', tx(rbox(0.1, 0.07, 0.04, 0.015), V3(0, -0.01, -0.07)), P.main);
    glove(k, s, P.main);
    boot(k, s, P.trim, P.main, { cuff: false });
  }
  // power cell pack
  onPack(k, 'paint', tx(rbox(0.3, 0.3, 0.14, 0.03, 2), V3(0, 0, -0.08)), P.trim);
  onPack(k, 'glow', tx(rbox(0.2, 0.02, 0.01, 0.004), V3(0, 0.06, -0.005)), P.glow);
  onPack(k, 'paint', tx(rbox(0.06, 0.24, 0.1, 0.015), V3(0.16, 0, -0.08)), P.main);
  thrusters(k, 0.09, -0.15, -0.08, 0.04);
}

export function buildKit(v: Variant, k: KitCtx): void {
  if (v !== 'servitor') buildHelmet(v, k);
  const f: Record<Variant, (k: KitCtx) => void> = {
    condor: kitCondor,
    lunatic: kitLunatic,
    needle: kitNeedle,
    phantom: kitPhantom,
    blade: kitBlade,
    reactor: kitReactor,
    helios: kitHelios,
    forge: kitForge,
    hive: kitHive,
    servitor: kitServitor,
  };
  f[v](k);
}


void starMesh;
void flipU;
void smooth;
