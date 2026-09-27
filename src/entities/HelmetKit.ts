import * as THREE from 'three';
import {
  V2, Wrap, StarSurface, V3, E, tx, tint, mirrorX, plate, PlateOpts, outline, ellipse, rrect, flipU, starWrap, starMesh, lathe, bcyl, rbox, extr, hose, band, span, onSurface, polarKeys, ringWrap, strip, hexagon, creased,
  KitCtx, Col, SIDES, bump, smooth,
} from './ArmorKit';

/**
 * Helmets: every helmet is a sculpted core shell (superellipsoid with jaw taper, face "beak" and
 * mouthpiece "snout") dressed with plates laid onto it through azimuthal charts (crown from the
 * top, face from the front, ear pods from the sides), so visors sit recessed between the brow and
 * the cheek guards. Authored at final size in head-bone space (the head bone sits at the neck top).
 */

export interface HelmShape {
  w: number; // half width
  up: number; // top
  dn: number; // chin
  fr: number; // face
  bk: number; // back
  p?: number; // superellipse exponent (boxiness)
  jaw?: number; // lower-face taper
  cy?: number;
  cz?: number;
  /** vertical face ridge (Halo "beak") */
  beak?: number;
  /** lower face pushed forward (mouthpiece / jaw) */
  snout?: number;
  /** flatten the sides (temple planes) */
  flat?: number;
  /** extend the back of the shell down over the neck */
  nape?: number;
}

export function helmSurface(h: HelmShape): StarSurface {
  const p = h.p ?? 2.35;
  const jaw = h.jaw ?? 0.2;
  const beak = h.beak ?? 0;
  return {
    c: V3(0, h.cy ?? 0.1, h.cz ?? 0.004),
    r: (d) => {
      const lower = Math.max(0, -d.y);
      const front = Math.max(0, -d.z);
      const a = h.w * (1 - jaw * Math.pow(Math.min(1, lower * 1.3), 1.4) * (0.45 + 0.55 * front));
      const back = Math.max(0, d.z);
      const b = d.y >= 0 ? h.up : h.dn * (1 + (h.nape ?? 0.22) * back * back);
      let c = d.z <= 0 ? h.fr : h.bk;
      if (beak > 0 && d.z < 0) c *= 1 + beak * Math.exp(-Math.pow(d.x / 0.22, 2)) * front;
      if (h.snout && d.z < 0) c *= 1 + h.snout * smooth(0.0, 0.55, lower) * (1 - smooth(0.55, 0.95, lower)) * front * front * Math.exp(-Math.pow(d.x / 0.5, 2));
      const px = p + (h.flat ?? 0);
      return Math.pow(Math.pow(Math.abs(d.x / a), px) + Math.pow(Math.abs(d.y / b), p) + Math.pow(Math.abs(d.z / c), p), -1 / p);
    },
  };
}

export interface HelmCharts {
  S: StarSurface;
  top: Wrap;
  front: Wrap;
  back: Wrap;
  side: (s: number) => Wrap;
}

export function helmCharts(S: StarSurface, frontTilt = 0): HelmCharts {
  const fa = V3(0, -Math.sin(frontTilt), -Math.cos(frontTilt));
  return {
    S,
    top: starWrap(S, V3(0, 1, 0), V3(1, 0, 0), V3(0, 0, -1), 0.14),
    front: starWrap(S, fa, V3(1, 0, 0), V3(0, 1, 0), 0.15),
    back: starWrap(S, V3(0, 0, 1), V3(-1, 0, 0), V3(0, 1, 0), 0.15),
    side: (s) => starWrap(S, V3(s, 0, 0), V3(0, 0, -1), V3(0, 1, 0), 0.14),
  };
}

/** outline mirrored about u = 0 from right-half corners (u ≥ 0, in order around) */
export function symOutline(half: [number, number, number][], maxLen = 0.04): V2[] {
  const left = half
    .slice()
    .reverse()
    .filter((c) => c[0] > 1e-4)
    .map((c) => [-c[0], c[1], c[2]] as [number, number, number]);
  return outline([...half, ...left], { maxLen });
}

/** visor reflection gradient: dark sky above, bright horizon below, a thin glint near the top */
export function visorGrad(g: THREE.BufferGeometry, lo = 0.05, hi = 0.14, glint = 0.8): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = smooth(lo, hi, y);
    const k = 1.0 - t * 0.72 + glint * Math.exp(-Math.pow((y - (hi - (hi - lo) * 0.25)) / 0.006, 2));
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** polar crown keys (top chart): symmetric edge from brow (front) to nape (back) */
function crownKeys(front: number, temple: number, side: number, back0: number): [number, number][] {
  const back = back0 + 0.045;
  const mid = (side + back) / 2 + (back - side) * 0.12;
  return [
    [0, side],
    [35, side - (side - temple) * 0.6],
    [62, temple],
    [90, front],
    [118, temple],
    [145, side - (side - temple) * 0.6],
    [180, side],
    [222, mid],
    [270, back],
    [318, mid],
  ];
}

/** recessed shell tone: the helmet colour pushed toward the dark trim */
const recess = (k: KitCtx, c: Col, f = 0.3) => k.pal.trim.clone().lerp(new THREE.Color(c), f);

function core(k: KitCtx, shape: HelmShape, col: Col, tilt = 0, seg: [number, number] = [20, 12]): HelmCharts {
  const S = helmSurface(shape);
  k.add('head', 'paint', starMesh(S, seg[0], seg[1]), col);
  return helmCharts(S, tilt);
}

function visor(k: KitCtx, W: Wrap, ol: V2[], o: { lo?: number; hi?: number; glint?: number; t?: number; h0?: number; rings?: number } = {}): void {
  k.add('head', 'visor', visorGrad(plate(W, ol, { t: o.t ?? 0.008, h0: o.h0 ?? 0.001, bevel: 0.004, sink: 0.008, edge: 1, rings: o.rings ?? 2 }), o.lo, o.hi, o.glint));
}

function crown(k: KitCtx, H: HelmCharts, keys: [number, number][], col: Col, o: PlateOpts = {}, n = 40): void {
  k.add('head', 'paint', plate(H.top, polarKeys(keys, n), { t: 0.02, h0: 0.006, bevel: 0.008, rings: 3, ...o }), col);
}

const onHead = (k: KitCtx, mat: 'paint' | 'metal' | 'dark' | 'glow' | 'visor', g: THREE.BufferGeometry, col?: Col) => k.add('head', mat, g, col);

// ---------------------------------------------------------------------------

/** Condor — Spartan trooper: gold wraparound visor, brow ridge, crest, beaked mouthpiece */
function helmCondor(k: KitCtx): void {
  const P = k.pal;
  const H = core(k, { w: 0.132, up: 0.132, dn: 0.14, fr: 0.148, bk: 0.155, p: 2.6, jaw: 0.3, beak: 0.07, snout: 0.22, flat: 0.8 }, recess(k, P.main));
  visor(
    k,
    H.front,
    outline(
      [
        [-0.168, 0.006, 0.02],
        [-0.13, 0.036, 0.02],
        [0.13, 0.036, 0.02],
        [0.168, 0.006, 0.02],
        [0.08, -0.026, 0.03],
        [0, -0.044, 0.03],
        [-0.08, -0.026, 0.03],
      ],
      { maxLen: 0.035 },
    ),
    { rings: 3 },
  );
  const brow = (u: number, v: number) => 0.012 * smooth(0.1, 0.16, v) * (1 - smooth(0.09, 0.15, Math.abs(u)));
  crown(k, H, crownKeys(0.166, 0.172, 0.232, 0.31), P.main, { rings: 4, lift: brow }, 44);
  onHead(k, 'paint', plate(H.top, rrect(0, -0.04, 0.036, 0.3, 0.016), { t: 0.008, h0: 0.026, bevel: 0.004, rings: 1, lift: brow }), P.sec);
  // nape guard
  onHead(k, 'paint', plate(H.back, symOutline([[0, -0.035, 0.01], [0.1, -0.045, 0.03], [0.13, -0.11, 0.03], [0.07, -0.16, 0.03], [0, -0.165, 0.01]]), { t: 0.016, h0: 0.005, bevel: 0.007, rings: 2 }), P.main);
  // cheek guards
  const cheek = outline(
    [
      [0.036, -0.05, 0.008],
      [0.176, -0.014, 0.016],
      [0.208, -0.062, 0.02],
      [0.13, -0.118, 0.02],
      [0.05, -0.132, 0.01],
    ],
    { maxLen: 0.04 },
  );
  for (const s of SIDES) onHead(k, 'paint', plate(H.front, s > 0 ? cheek : flipU(cheek), { t: 0.017, h0: 0.006, bevel: 0.007, rings: 2 }), P.main);
  // breather / mouthpiece with vents
  onHead(k, 'paint', plate(H.front, symOutline([[0, -0.05, 0.005], [0.04, -0.05, 0.01], [0.03, -0.142, 0.02], [0, -0.142, 0.005]]), { t: 0.024, h0: 0.004, bevel: 0.007, rings: 2 }), P.trim);
  for (let i = 0; i < 3; i++) onHead(k, 'metal', plate(H.front, rrect(0, -0.074 - i * 0.02, 0.044, 0.007, 0.003), { t: 0.004, h0: 0.028, bevel: 0.002, sink: 0.006, rings: 1, soft: false }));
  // ear pods
  for (const s of SIDES) {
    const W = H.side(s);
    onHead(k, 'paint', plate(W, ellipse(0.036, 0.044, 16, 0.016, -0.03), { t: 0.022, h0: 0.014, bevel: 0.008, rings: 2 }), P.sec);
    onHead(k, 'metal', onSurface(W, 0.016, -0.03, 0.036, bcyl(0.018, 0.022, 0.01, 0.004, 12)));
  }
  onHead(k, 'glow', onSurface(H.side(-1), 0.016, -0.03, 0.042, bcyl(0.01, 0.01, 0.006, 0.002, 10)), P.glow);
  onHead(k, 'metal', tx(bcyl(0.003, 0.005, 0.24, 0.001, 6), V3(-0.16, 0.24, 0.07), E(-0.28, 0, 0.12)));
  onHead(k, 'glow', tx(new THREE.SphereGeometry(0.009, 8, 6), V3(-0.174, 0.355, 0.104)), P.glow);
}

/** Lunatic — scrappy demolitions helmet: round visor, welder goggles on a strap, punk bolts, respirator */
function helmLunatic(k: KitCtx): void {
  const P = k.pal;
  const shape: HelmShape = { w: 0.136, up: 0.136, dn: 0.135, fr: 0.15, bk: 0.152, p: 2.2, jaw: 0.18, snout: 0.1 };
  const H = core(k, shape, recess(k, P.main));
  visor(k, H.front, outline([[-0.13, -0.05, 0.035], [0.13, -0.05, 0.035], [0.125, 0.042, 0.03], [-0.125, 0.042, 0.03]], { maxLen: 0.04 }), { lo: 0.03, hi: 0.15 });
  crown(k, H, crownKeys(0.178, 0.182, 0.238, 0.3), P.main);
  // scrap patch (left) with rivets
  onHead(k, 'metal', plate(H.top, outline([[-0.16, -0.02, 0.01], [-0.07, -0.05, 0.012], [-0.06, -0.14, 0.01], [-0.15, -0.12, 0.012]], { maxLen: 0.05 }), { t: 0.006, h0: 0.026, bevel: 0.003, rings: 2 }), P.sec);
  for (const [u, v] of [[-0.145, -0.035], [-0.078, -0.06], [-0.075, -0.125], [-0.14, -0.108]] as [number, number][]) onHead(k, 'metal', onSurface(H.top, u, v, 0.03, bcyl(0.006, 0.007, 0.006, 0.002, 6)));
  // punk bolt row along the crown
  for (const v of [0.07, -0.01, -0.09]) onHead(k, 'metal', onSurface(H.top, 0.0, v, 0.024, lathe([[0.016, 0], [0.014, 0.012], [0.004, 0.04], [0.001, 0.042]], 8)));
  // goggle strap + welder goggles pushed up on the brow
  const strapW = ringWrap(H.S, V3(0, 1, 0.15), V3(0, 0, -1), 0.15, 0.35);
  onHead(k, 'paint', band(strapW, span(0, Math.PI * 2 * 0.15, 41).slice(0, 40), [[-0.013, 0.016], [-0.011, 0.031], [0.011, 0.031], [0.013, 0.016]], true), P.trim);
  for (const s of SIDES) {
    const cup = lathe([[0.03, -0.004], [0.036, 0.004], [0.036, 0.026], [0.03, 0.034], [0.024, 0.03]], 14);
    onHead(k, 'dark', onSurface(strapW, s * 0.046, 0.0, 0.028, cup), 0xffffff);
    onHead(k, 'glow', onSurface(strapW, s * 0.046, 0.0, 0.058, bcyl(0.024, 0.024, 0.004, 0.001, 14)), P.glow);
  }
  // right cheek plate (scrap), left respirator canister
  onHead(k, 'paint', plate(H.front, outline([[0.03, -0.058, 0.01], [0.16, -0.05, 0.02], [0.17, -0.1, 0.02], [0.05, -0.14, 0.02]], { maxLen: 0.05 }), { t: 0.016, h0: 0.006, bevel: 0.006, rings: 2 }), P.sec);
  onHead(k, 'paint', plate(H.front, symOutline([[0, -0.056, 0.005], [0.03, -0.056, 0.01], [0.026, -0.13, 0.015], [0, -0.13, 0.005]]), { t: 0.02, h0: 0.004, bevel: 0.006, rings: 1 }), P.main);
  const can = bcyl(0.026, 0.03, 0.06, 0.006, 12);
  onHead(k, 'metal', onSurface(H.front, -0.095, -0.1, 0.024, can, 0, 0));
  onHead(k, 'paint', onSurface(H.front, -0.095, -0.1, 0.034, bcyl(0.032, 0.032, 0.014, 0.004, 12, true)), P.acc);
  onHead(k, 'dark', hose([V3(-0.13, 0.03, -0.1), V3(-0.16, 0.0, -0.02), V3(-0.14, -0.02, 0.08)], 0.009, 8, 6), 0xffffff);
}

/** Needle — sleek recon helmet: horizontal slit visor, scope monocle, white face mask, tall antenna */
function helmNeedle(k: KitCtx): void {
  const P = k.pal;
  const H = core(k, { w: 0.124, up: 0.128, dn: 0.135, fr: 0.152, bk: 0.172, p: 2.5, jaw: 0.3, snout: 0.12, flat: 0.5, beak: 0.05 }, recess(k, P.main));
  visor(k, H.front, outline([[-0.155, -0.012, 0.01], [0.155, -0.012, 0.01], [0.16, 0.02, 0.012], [-0.16, 0.02, 0.012]], { maxLen: 0.035 }), { lo: 0.085, hi: 0.125, glint: 0.5, rings: 1 });
  crown(k, H, crownKeys(0.196, 0.198, 0.235, 0.34), P.main, { rings: 3, lift: (u, v) => 0.008 * smooth(0.12, 0.19, v) * (1 - smooth(0.1, 0.16, Math.abs(u))) });
  for (const s of SIDES) onHead(k, 'paint', plate(H.top, strip(s * 0.032, 0.15, s * 0.032, -0.22, 0.014), { t: 0.005, h0: 0.026, bevel: 0.003, rings: 1 }), P.sec);
  // white face mask + vents
  onHead(k, 'paint', plate(H.front, symOutline([[0, -0.018, 0.005], [0.16, -0.018, 0.012], [0.18, -0.062, 0.02], [0.09, -0.13, 0.03], [0, -0.148, 0.01]]), { t: 0.016, h0: 0.006, bevel: 0.007, rings: 2 }), P.sec);
  for (const s of SIDES) onHead(k, 'paint', plate(H.front, strip(s * 0.03, -0.09, s * 0.075, -0.075, 0.012), { t: 0.004, h0: 0.022, bevel: 0.002, sink: 0.006, rings: 1, soft: false }), P.trim);
  // scope monocle over the right eye
  onHead(k, 'metal', onSurface(H.front, 0.052, 0.004, 0.006, bcyl(0.024, 0.027, 0.062, 0.005, 14)));
  onHead(k, 'paint', onSurface(H.front, 0.052, 0.004, 0.05, bcyl(0.029, 0.029, 0.018, 0.004, 14)), P.main);
  onHead(k, 'glow', onSurface(H.front, 0.052, 0.004, 0.068, bcyl(0.019, 0.019, 0.004, 0.001, 14)), P.glow);
  onHead(k, 'metal', onSurface(H.side(1), 0.04, 0.004, 0.012, rbox(0.03, 0.02, 0.07, 0.006)));
  // ear housings + tall antenna (left)
  for (const s of SIDES) onHead(k, 'paint', plate(H.side(s), rrect(0.0, -0.02, 0.06, 0.07, 0.02), { t: 0.02, h0: 0.012, bevel: 0.007, rings: 1 }), P.trim);
  onHead(k, 'metal', tx(bcyl(0.003, 0.006, 0.5, 0.001, 6), V3(-0.15, 0.33, 0.08), E(-0.14, 0, 0.06)));
  onHead(k, 'glow', tx(new THREE.SphereGeometry(0.01, 8, 6), V3(-0.165, 0.58, 0.115)), P.glow);
}

/** Phantom — featureless stealth faceplate with a glowing V, dark crown, central fin */
function helmPhantom(k: KitCtx): void {
  const P = k.pal;
  const H = core(k, { w: 0.126, up: 0.14, dn: 0.14, fr: 0.155, bk: 0.16, p: 2.15, jaw: 0.26, snout: 0.07 }, recess(k, P.sec, 0.6));
  onHead(k, 'paint', plate(H.front, symOutline([[0, 0.078, 0.01], [0.12, 0.062, 0.04], [0.178, -0.02, 0.04], [0.11, -0.122, 0.04], [0, -0.152, 0.02]]), { t: 0.014, h0: 0.004, bevel: 0.007, rings: 3 }), P.sec);
  // V visor lines
  for (const s of SIDES) onHead(k, 'glow', plate(H.front, strip(s * 0.135, 0.03, s * 0.012, -0.032, 0.01), { t: 0.004, h0: 0.016, bevel: 0.002, sink: 0.008, rings: 1, soft: false }), P.glow);
  crown(k, H, crownKeys(0.142, 0.17, 0.232, 0.31), P.sec, { rings: 3 });
  onHead(k, 'paint', plate(H.top, strip(0, 0.13, 0, -0.24, 0.024, 0.01), { t: 0.016, h0: 0.024, bevel: 0.006, rings: 1, lift: (u) => 0.006 * (1 - Math.abs(u) / 0.012) }), P.main);
  for (const s of SIDES) onHead(k, 'glow', plate(H.side(s), strip(0.05, -0.05, -0.05, -0.02, 0.006), { t: 0.003, h0: 0.026, bevel: 0.001, sink: 0.008, rings: 1, soft: false }), P.glow);
}

/** Blade — kabuto: ribbed bowl, flared shikoro neck guard, fukigaeshi, V maedate, lacquered menpo */
function helmBlade(k: KitCtx): void {
  const P = k.pal;
  const H = core(k, { w: 0.13, up: 0.13, dn: 0.14, fr: 0.15, bk: 0.15, p: 2.3, jaw: 0.28, snout: 0.16 }, recess(k, P.main));
  visor(k, H.front, outline([[-0.125, -0.012, 0.008], [0.125, -0.012, 0.008], [0.13, 0.016, 0.01], [-0.13, 0.016, 0.01]], { maxLen: 0.035 }), { lo: 0.085, hi: 0.12, glint: 0.4, rings: 1 });
  // ribbed bowl (suji-bachi)
  const ribs = (u: number, v: number) => {
    const r = Math.hypot(u, v);
    return 0.004 * (0.5 + 0.5 * Math.cos(Math.atan2(v, u) * 12)) * smooth(0.03, 0.09, r);
  };
  crown(k, H, crownKeys(0.188, 0.19, 0.215, 0.24), P.main, { rings: 4, lift: (u, v) => ribs(u, v) + 0.01 * smooth(0.13, 0.18, v) * (1 - smooth(0.1, 0.16, Math.abs(u))) }, 48);
  onHead(k, 'metal', onSurface(H.top, 0, 0, 0.026, lathe([[0.024, 0], [0.024, 0.006], [0.012, 0.016], [0.001, 0.018]], 12)), 0xd8b25a);
  // menpo (face mask) with mouth slit
  onHead(k, 'paint', plate(H.front, symOutline([[0, -0.018, 0.005], [0.132, -0.018, 0.01], [0.165, -0.064, 0.02], [0.07, -0.142, 0.03], [0, -0.152, 0.01]]), { t: 0.02, h0: 0.006, bevel: 0.008, rings: 2, lift: (u, v) => 0.006 * bump(u / 0.05, (v + 0.06) / 0.04) }), P.sec);
  onHead(k, 'glow', plate(H.front, strip(-0.028, -0.104, 0.028, -0.104, 0.006), { t: 0.003, h0: 0.026, bevel: 0.001, sink: 0.008, rings: 1, soft: false }), P.glow);
  // shikoro: three flared lames around the back and sides
  for (let i = 0; i < 3; i++) {
    const yT = 0.05 - i * 0.03;
    const rT = 0.148 + i * 0.02;
    const g = lathe(
      [
        [rT - 0.012, yT + 0.004],
        [rT, yT],
        [rT + 0.034, yT - 0.042],
        [rT + 0.026, yT - 0.048],
        [rT - 0.008, yT - 0.006],
      ],
      18,
      -2.05,
      4.1,
    );
    tx(g, V3(0, 0, 0.012), E(), V3(0.95, 1, 1.02));
    onHead(k, 'paint', tint(g, 0xffffff), i === 2 ? P.acc : P.main);
  }
  // fukigaeshi (turned-back wings) + V maedate crest
  for (const s of SIDES) {
    const wing = extr(outline([[0, -0.03, 0.008], [0.06, -0.035, 0.012], [0.075, 0.04, 0.016], [0.01, 0.045, 0.01]], { maxLen: 0.2 }), 0.012, 0.004, 1, 2);
    tx(wing, V3(0, 0, 0), E(0, -Math.PI / 2, 0));
    tx(wing, V3(s * 0.158, 0.085, -0.075), E(0.15, s * 0.55, 0));
    onHead(k, 'paint', s > 0 ? wing : mirrorX(wing), P.main);
    const horn = extr(outline([[0, 0, 0.004], [0.026, 0.006, 0.01], [0.055, 0.1, 0.03], [0.095, 0.205, 0.004], [0.03, 0.11, 0.03], [0.002, 0.03, 0.006]], { maxLen: 0.3 }), 0.009, 0.003, 1, 3);
    tx(horn, V3(0.004, 0.2, -0.14), E(-0.32, 0, 0));
    onHead(k, 'metal', s > 0 ? horn : mirrorX(horn), 0xe0b85a);
  }
  onHead(k, 'glow', onSurface(H.front, 0, 0.045, 0.018, bcyl(0.014, 0.014, 0.006, 0.002, 12), 0, 0), P.glow);
}

/** Reactor — heavy boxy helmet: narrow slot visor, thick brow, armoured jaw with vents, ear blocks */
function helmReactor(k: KitCtx): void {
  const P = k.pal;
  const H = core(k, { w: 0.14, up: 0.12, dn: 0.14, fr: 0.148, bk: 0.15, p: 3.0, jaw: 0.1, snout: 0.14, flat: 1.0, cy: 0.09 }, recess(k, P.main));
  visor(k, H.front, outline([[-0.1, -0.006, 0.006], [0.1, -0.006, 0.006], [0.105, 0.018, 0.008], [-0.105, 0.018, 0.008]], { maxLen: 0.035 }), { lo: 0.075, hi: 0.11, glint: 0.4, rings: 1 });
  const brow = (u: number, v: number) => 0.016 * smooth(0.14, 0.19, v) * (1 - smooth(0.1, 0.15, Math.abs(u)));
  crown(k, H, crownKeys(0.198, 0.2, 0.232, 0.3), P.main, { t: 0.028, rings: 3, lift: brow });
  onHead(k, 'paint', plate(H.top, strip(0, 0.15, 0, -0.2, 0.05, 0.015), { t: 0.012, h0: 0.034, bevel: 0.005, rings: 1, lift: brow }), P.trim);
  // armoured jaw with vent slats
  onHead(k, 'paint', plate(H.front, symOutline([[0, -0.012, 0.005], [0.15, -0.01, 0.015], [0.2, -0.07, 0.03], [0.12, -0.142, 0.03], [0, -0.16, 0.02]]), { t: 0.03, h0: 0.006, bevel: 0.009, rings: 2 }), P.sec);
  for (let i = 0; i < 4; i++) onHead(k, 'metal', plate(H.front, rrect(0, -0.052 - i * 0.02, 0.07 - i * 0.008, 0.008, 0.003), { t: 0.005, h0: 0.035, bevel: 0.002, sink: 0.008, rings: 1, soft: false }));
  for (const s of SIDES) {
    onHead(k, 'paint', onSurface(H.side(s), 0.01, -0.02, 0.012, rbox(0.1, 0.03, 0.09, 0.012, 2)), P.main);
    onHead(k, 'glow', onSurface(H.side(s), 0.035, -0.02, 0.042, rbox(0.012, 0.004, 0.04, 0.002)), P.glow);
  }
}

/** Helios — rounded friendly medic helmet: big oval visor, white shell, crest stripe, halo ring */
function helmHelios(k: KitCtx): void {
  const P = k.pal;
  const H = core(k, { w: 0.132, up: 0.14, dn: 0.13, fr: 0.15, bk: 0.152, p: 2.1, jaw: 0.16, snout: 0.05 }, recess(k, P.sec, 0.45));
  visor(k, H.front, outline([[-0.125, -0.058, 0.045], [0.125, -0.058, 0.045], [0.13, 0.05, 0.04], [-0.13, 0.05, 0.04]], { maxLen: 0.04 }), { lo: 0.03, hi: 0.16, rings: 3 });
  crown(k, H, crownKeys(0.165, 0.17, 0.228, 0.3), P.sec, { rings: 3 });
  onHead(k, 'paint', plate(H.top, strip(0, 0.14, 0, -0.24, 0.05, 0.02), { t: 0.008, h0: 0.026, bevel: 0.004, rings: 1 }), P.main);
  onHead(k, 'paint', plate(H.front, symOutline([[0, -0.064, 0.005], [0.1, -0.064, 0.02], [0.07, -0.122, 0.03], [0, -0.132, 0.01]]), { t: 0.016, h0: 0.006, bevel: 0.007, rings: 2 }), P.sec);
  for (const s of SIDES) {
    onHead(k, 'paint', plate(H.side(s), ellipse(0.04, 0.046, 16, 0.012, -0.03), { t: 0.022, h0: 0.012, bevel: 0.008, rings: 2 }), P.main);
    onHead(k, 'glow', onSurface(H.side(s), 0.012, -0.03, 0.035, lathe([[0.022, 0], [0.024, 0.003], [0.018, 0.005]], 14)), P.glow);
  }
  // floating halo
  onHead(k, 'glow', tx(new THREE.TorusGeometry(0.12, 0.007, 6, 36), V3(0, 0.33, 0.03), E(Math.PI / 2 - 0.22)), P.glow);
  // forehead cross
  onHead(k, 'glow', plate(H.top, strip(0, 0.1, 0, 0.14, 0.012), { t: 0.004, h0: 0.034, bevel: 0.001, rings: 1 }), P.glow);
  onHead(k, 'glow', plate(H.top, strip(-0.02, 0.12, 0.02, 0.12, 0.012), { t: 0.004, h0: 0.034, bevel: 0.001, rings: 1 }), P.glow);
}

/** Forge — welder helmet: stand-off faceplate with a recessed slit window, hinges, headlamp */
function helmForge(k: KitCtx): void {
  const P = k.pal;
  const H = core(k, { w: 0.136, up: 0.134, dn: 0.14, fr: 0.15, bk: 0.155, p: 2.3, jaw: 0.14, snout: 0.08 }, recess(k, P.main));
  const ribs = (u: number) => 0.005 * Math.max(0, 1 - Math.abs(Math.abs(u) - 0.05) / 0.012) + 0.006 * Math.max(0, 1 - Math.abs(u) / 0.014);
  crown(k, H, crownKeys(0.162, 0.17, 0.232, 0.3), P.main, { rings: 3, lift: (u) => ribs(u) }, 44);
  // faceplate frame with window + recessed slit visor
  const face = symOutline([[0, 0.072, 0.01], [0.13, 0.062, 0.02], [0.165, -0.02, 0.025], [0.13, -0.12, 0.03], [0, -0.142, 0.02]], 0.03);
  const win = rrect(0, 0.014, 0.19, 0.04, 0.008, 0.03);
  onHead(k, 'paint', plate(H.front, face, { t: 0.02, h0: 0.016, bevel: 0.008, hole: win, rings: 2 }), P.sec);
  visor(k, H.front, rrect(0, 0.014, 0.2, 0.046, 0.008, 0.035), { lo: 0.09, hi: 0.13, glint: 0.4, rings: 1, h0: 0.006 });
  for (let i = 0; i < 3; i++) onHead(k, 'paint', plate(H.front, rrect(0, -0.06 - i * 0.022, 0.07, 0.009, 0.004), { t: 0.004, h0: 0.036, bevel: 0.002, sink: 0.008, rings: 1, soft: false }), P.trim);
  for (const s of SIDES) onHead(k, 'metal', onSurface(H.side(s), 0.03, 0.0, 0.008, bcyl(0.024, 0.024, 0.028, 0.005, 12)));
  // headlamp (right)
  onHead(k, 'paint', onSurface(H.top, 0.075, 0.035, 0.022, bcyl(0.03, 0.034, 0.04, 0.006, 12), 0, -0.9), P.trim);
  onHead(k, 'glow', onSurface(H.top, 0.075, 0.035, 0.022, tx(bcyl(0.024, 0.024, 0.004, 0.001, 12), V3(0, 0.022, -0.0)), 0, -0.9), 0xfff4d6);
}

/** Hive — compound-eye hex visor, bee-striped crown, feeler antennae */
function helmHive(k: KitCtx): void {
  const P = k.pal;
  const H = core(k, { w: 0.13, up: 0.14, dn: 0.135, fr: 0.155, bk: 0.155, p: 2.3, jaw: 0.24, snout: 0.06 }, recess(k, P.main));
  // eye frame + hex cells
  onHead(k, 'paint', plate(H.front, symOutline([[0, 0.066, 0.01], [0.12, 0.058, 0.03], [0.15, 0.0, 0.03], [0.1, -0.058, 0.03], [0, -0.066, 0.01]]), { t: 0.01, h0: 0.004, bevel: 0.005, rings: 2 }), P.sec);
  const R = 0.0242;
  const cells: [number, number][] = [];
  for (const u of [-0.084, -0.042, 0, 0.042, 0.084]) cells.push([u, 0]);
  for (const u of [-0.063, -0.021, 0.021, 0.063]) cells.push([u, 0.036], [u, -0.036]);
  cells.push([0.105, 0.036], [-0.105, 0.036], [0.105, -0.036], [-0.105, -0.036]);
    for (const [u, v] of cells) {
    const g = plate(H.front, hexagon(u, v, R * 0.86, Math.PI / 6, 0), { t: 0.006, h0: 0.013, bevel: 0.003, sink: 0.006, edge: 1, rings: 1, soft: false });
    onHead(k, 'visor', visorGrad(g, 0.05, 0.16, 0.3));
  }
  crown(k, H, crownKeys(0.16, 0.172, 0.228, 0.3), P.main, { rings: 3 });
  for (const v of [-0.04, -0.12]) onHead(k, 'paint', plate(H.top, strip(-0.2, v, 0.2, v, 0.035, 0.012), { t: 0.006, h0: 0.026, bevel: 0.003, rings: 1 }), P.sec);
  onHead(k, 'paint', plate(H.front, symOutline([[0, -0.07, 0.005], [0.07, -0.072, 0.02], [0.05, -0.13, 0.03], [0, -0.14, 0.01]]), { t: 0.018, h0: 0.004, bevel: 0.007, rings: 2 }), P.main);
  for (const s of SIDES) {
    const base = V3(s * 0.05, 0.225, -0.06);
    onHead(k, 'metal', onSurface(H.top, s * 0.05, 0.075, 0.024, bcyl(0.012, 0.014, 0.012, 0.003, 10)));
    onHead(k, 'metal', hose([base, V3(s * 0.08, 0.31, -0.08), V3(s * 0.13, 0.36, -0.14)], 0.0045, 10, 5));
    onHead(k, 'glow', tx(new THREE.SphereGeometry(0.013, 8, 6), V3(s * 0.135, 0.365, -0.148)), P.glow);
  }
}

/** Servitor — industrial robot head: armoured box, single optic, sensor fin */
function headServitor(k: KitCtx): void {
  const P = k.pal;
  onHead(k, 'paint', tint(tx(rbox(0.22, 0.17, 0.22, 0.04, 2), V3(0, 0.1, 0.01)), 0xffffff), P.main);
  onHead(k, 'paint', tint(tx(rbox(0.18, 0.12, 0.05, 0.02, 1), V3(0, 0.09, -0.1)), 0xffffff), P.trim);
  onHead(k, 'metal', tx(lathe([[0.05, 0], [0.056, 0.01], [0.052, 0.035], [0.042, 0.04]], 16), V3(0, 0.095, -0.12), E(-Math.PI / 2)));
  onHead(k, 'glow', tx(bcyl(0.036, 0.036, 0.006, 0.002, 16), V3(0, 0.095, -0.16), E(Math.PI / 2)), P.glow);
  onHead(k, 'paint', tint(tx(rbox(0.02, 0.07, 0.14, 0.008), V3(0, 0.2, 0.02)), 0xffffff), P.acc);
  for (const s of SIDES) onHead(k, 'metal', tx(bcyl(0.04, 0.044, 0.02, 0.005, 12), V3(s * 0.118, 0.1, 0.01), E(0, 0, Math.PI / 2)));
  onHead(k, 'metal', tx(bcyl(0.003, 0.005, 0.2, 0.001, 6), V3(0.07, 0.27, 0.06), E(-0.2)));
}

export function buildHelmet(v: string, k: KitCtx): void {
  const f: Record<string, (k: KitCtx) => void> = {
    condor: helmCondor,
    lunatic: helmLunatic,
    needle: helmNeedle,
    phantom: helmPhantom,
    blade: helmBlade,
    reactor: helmReactor,
    helios: helmHelios,
    forge: helmForge,
    hive: helmHive,
    servitor: headServitor,
  };
  (f[v] ?? helmCondor)(k);
}

void creased;
