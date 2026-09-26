/**
 * Consistent SVG icon set for MOON GRAVITY (strings; inject with innerHTML / ico()).
 * Style: 24×24 grid, 1.8 px round strokes in currentColor, filled glyphs for emblems.
 * Weapons use a 64×24 side-profile silhouette grid.
 */
import type { AbilityId, HeroId, ModeId, RibbonId, Role, WeaponId } from '../game/Types';
import type { RankTier } from './Storage';

const S = (body: string, vb = '0 0 24 24', sw = 1.8) =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const F = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="currentColor" aria-hidden="true">${body}</svg>`;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** n-pointed star path */
export function starPath(cx: number, cy: number, ro: number, ri: number, n: number, rot = -90): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const r = i % 2 === 0 ? ro : ri;
    d += (i === 0 ? 'M' : 'L') + r2(cx + Math.cos(a) * r) + ' ' + r2(cy + Math.sin(a) * r);
  }
  return d + 'Z';
}

/** regular polygon path */
export function polyPath(cx: number, cy: number, r: number, n: number, rot = -90): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = ((rot + (i * 360) / n) * Math.PI) / 180;
    d += (i === 0 ? 'M' : 'L') + r2(cx + Math.cos(a) * r) + ' ' + r2(cy + Math.sin(a) * r);
  }
  return d + 'Z';
}

export function gearPath(cx: number, cy: number, ro: number, ri: number, teeth: number): string {
  let d = '';
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    const pts = [
      [ri, a - step * 0.5],
      [ri, a - step * 0.28],
      [ro, a - step * 0.16],
      [ro, a + step * 0.16],
      [ri, a + step * 0.28],
    ];
    for (let j = 0; j < pts.length; j++) {
      const [r, t] = pts[j];
      d += (i === 0 && j === 0 ? 'M' : 'L') + r2(cx + Math.cos(t) * r) + ' ' + r2(cy + Math.sin(t) * r);
    }
  }
  return d + 'Z';
}

function sector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => r2(cx + Math.cos((a * Math.PI) / 180) * r) + ' ' + r2(cy + Math.sin((a * Math.PI) / 180) * r);
  return `M${p(r0, a0)}L${p(r1, a0)}A${r1} ${r1} 0 0 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
}

function trefoil(cx: number, cy: number, r: number): string {
  const r0 = r * 0.3;
  let d = `M${r2(cx + r * 0.17)} ${cy}A${r2(r * 0.17)} ${r2(r * 0.17)} 0 1 1 ${r2(cx - r * 0.17)} ${cy}A${r2(r * 0.17)} ${r2(r * 0.17)} 0 1 1 ${r2(cx + r * 0.17)} ${cy}Z`;
  for (const a of [-90, 30, 150]) d += sector(cx, cy, r0, r, a - 30, a + 30);
  return d;
}

const rocket = (x: number, y: number, rot: number, s = 1) =>
  `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M-3 -1.4h4.6L4.4 0 1.6 1.4H-3z" fill="currentColor" stroke="none"/><path d="M-3 -1.4-4.6-2.8M-3 1.4-4.6 2.8" stroke-width="1.2"/><path d="M-5.5 0h-2.6" stroke-width="1.2" stroke-dasharray="1 1.1"/></g>`;

// ---------------------------------------------------------------------------
// UI glyphs

export const UI = {
  play: F('<path d="M7 4.3c0-.8.9-1.3 1.6-.9l11 6.9c.7.4.7 1.4 0 1.8l-11 6.9c-.7.4-1.6-.1-1.6-.9z"/>'),
  helmet: S('<path d="M4.5 14a7.5 7.5 0 0 1 15 0v3.2c0 1.5-1.2 2.8-2.8 2.8H7.3a2.8 2.8 0 0 1-2.8-2.8z"/><path d="M7 11.5h10l-.9 4.2H7.9z" fill="currentColor" fill-opacity=".35"/><path d="M15.5 7.2 17.5 3.5"/>'),
  profile: S('<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.2c.9-3.9 3.8-6 7.2-6s6.3 2.1 7.2 6"/>'),
  gear: S(`<path d="${gearPath(12, 12, 9.5, 7.2, 8)}"/><circle cx="12" cy="12" r="3"/>`),
  star: F(`<path d="${starPath(12, 12.5, 9.5, 4.1, 5)}"/>`),
  starO: S(`<path d="${starPath(12, 12.5, 9.2, 4, 5)}"/>`, '0 0 24 24', 1.6),
  back: S('<path d="M14.5 5.5 8 12l6.5 6.5"/>', '0 0 24 24', 2.4),
  chevR: S('<path d="M9.5 5.5 16 12l-6.5 6.5"/>', '0 0 24 24', 2.4),
  chevL: S('<path d="M14.5 5.5 8 12l6.5 6.5"/>', '0 0 24 24', 2.4),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>', '0 0 24 24', 2.2),
  refresh: S('<path d="M19.5 10.5A7.8 7.8 0 0 0 5.6 7.4L4 9"/><path d="M4 4.5V9h4.5"/><path d="M4.5 13.5a7.8 7.8 0 0 0 13.9 3.1L20 15"/><path d="M20 19.5V15h-4.5"/>'),
  link: S('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
  copy: S('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>', '0 0 24 24', 2.6),
  lock: S('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2" fill="currentColor"/>'),
  users: S('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8"/><path d="M17.5 14.6c1.8.6 3 2.3 3.5 4.9"/>'),
  bot: S('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1.3" fill="currentColor"/><circle cx="9.3" cy="13" r="1.5" fill="currentColor" stroke="none"/><circle cx="14.7" cy="13" r="1.5" fill="currentColor" stroke="none"/><path d="M2.8 12v3.5M21.2 12v3.5"/>'),
  crown: F('<path d="M3 7.5l4.6 3.8L12 4.5l4.4 6.8L21 7.5l-1.8 10.2H4.8z"/><rect x="4.8" y="18.8" width="14.4" height="2" rx=".6"/>'),
  skull: F(
    '<path fill-rule="evenodd" d="M12 2.8c-4.8 0-8.2 3.3-8.2 7.8 0 2.7 1.2 4.6 3 5.6V19c0 1 .8 1.8 1.8 1.8h1v-2h1.3v2h2.2v-2h1.3v2h1c1 0 1.8-.8 1.8-1.8v-2.8c1.8-1 3-2.9 3-5.6 0-4.5-3.4-7.8-8.2-7.8zM8.7 9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zm6.6 0a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zM12 13.8l-1.3 2.3h2.6z"/>',
  ),
  clock: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  wifi: S('<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.3a9.5 9.5 0 0 1 13 0"/><path d="M8.6 15.5a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>'),
  wifiOff: S('<path d="M2.5 9a14 14 0 0 1 5-3.2M12 5a14 14 0 0 1 9.5 4"/><path d="M5.5 12.3a9.5 9.5 0 0 1 4-2.2M15.5 10.7a9.5 9.5 0 0 1 3 1.6"/><path d="M8.6 15.5a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/><path d="M4 3.5 20 20.5"/>'),
  globe: S('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.5 2.6 3.6 5.5 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.5-3.6-8.5S9.5 6.1 12 3.5z"/>'),
  trophy: S('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11"/><path d="M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5"/><path d="M12 14v3.5"/><path d="M8 20.5h8l-1-3H9z"/>'),
  target: S('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>'),
  chart: S('<path d="M4 20h16"/><path d="M7.5 16.5v-5M12 16.5V6.5M16.5 16.5v-8"/>', '0 0 24 24', 2.6),
  edit: S('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  pd: S('<path d="M12 2.5l6.8 4.8v9.4L12 21.5l-6.8-4.8V7.3z" fill="currentColor" fill-opacity=".18"/><path d="M12 2.5v19M5.2 7.3 12 12l6.8-4.7M12 12l-6.8 4.7M12 12l6.8 4.7" stroke-opacity=".55"/>'),
  earth: S('<circle cx="12" cy="12" r="8.5"/><path d="M5.5 7c1.5.5 2 1.8 3.5 2s2.5-1.5 4-.8.5 2.3 2 3 3-.2 3.5 1"/><path d="M5 15c1.4-.4 2.6.4 3.2 1.6s.6 2.6 1.6 3.3"/>'),
  warning: S('<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".7" fill="currentColor"/>', '0 0 24 24', 2),
  o2: S('<circle cx="9.3" cy="12" r="5.6" stroke-width="2.4"/><path d="M15.8 14c0-1 .7-1.7 1.7-1.7s1.7.7 1.7 1.5c0 1.4-3.4 2.6-3.4 4.4h3.5" stroke-width="1.7"/>'),
  suit: S('<circle cx="12" cy="7.5" r="4.6"/><path d="M9.2 7.4h5.6" stroke-width="2.2"/><path d="M4.5 21v-3.5a4.5 4.5 0 0 1 4.5-4.5h6a4.5 4.5 0 0 1 4.5 4.5V21"/><path d="M9.5 16.8h5"/>'),
  jet: S('<rect x="5.5" y="3.5" width="5.5" height="11" rx="2.2"/><rect x="13" y="3.5" width="5.5" height="11" rx="2.2"/><path d="M7 14.5l1.2 2.2 1.3-2.2M14.5 14.5l1.2 2.2 1.3-2.2"/><path d="M8.2 18.5v2.5M15.7 18.5v2.5" stroke-dasharray="1.2 1.2"/>'),
  magnet: S('<path d="M5.5 3.5h4.5v8a2 2 0 0 0 4 0v-8h4.5v8a6.5 6.5 0 0 1-13 0z"/><path d="M5.5 7.8H10M14 7.8h4.5"/>'),
  boot: S('<path d="M7 3h5.5v8.5l6 2.5c1 .4 1.5 1.3 1.5 2.3V19H5.5l1.5-6z"/><path d="M4 21.5h16.5" stroke-width="2.4"/>'),
  sealant: S('<rect x="6.5" y="8" width="9" height="13" rx="2"/><path d="M8.5 8V5.5h5V8"/><path d="M13.5 5.5h3l2.2-1.7"/><path d="M19.7 7.2l1.6-.4M19.6 9.7l1.4.7"/><path d="M6.5 13h9"/>'),
  keyboard: S('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/>', '0 0 24 24', 2),
  mouse: S('<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 7v3"/>'),
  volume: S('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  monitor: S('<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 17v3.5"/>'),
  sliders: S('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  crosshair: S('<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>'),
  search: S('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20.5 20.5"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>', '0 0 24 24', 2.4),
  minus: S('<path d="M5 12h14"/>', '0 0 24 24', 2.4),
  headshot: S('<circle cx="12" cy="9.5" r="5"/><path d="M6.5 21c.7-2.6 2.8-4 5.5-4s4.8 1.4 5.5 4"/><path d="M12 1.8v3.4M12 13.8v1.6M4 9.5h3.2M16.8 9.5H20"/><circle cx="12" cy="9.5" r="1" fill="currentColor"/>'),
  wall: S('<path d="M4 2.5v19" stroke-width="2.6"/><path d="M8 5h4.5a3 3 0 0 1 3 3v1.5a2 2 0 0 1-2 2H8zM8 13h3.5a2.5 2.5 0 0 1 0 5H8z" fill="currentColor" fill-opacity=".3"/><path d="M18 8.5l2.5-1.5M18 12h3M18 15.5l2.5 1.5" stroke-width="1.4"/>'),
  bullet: S('<path d="M9 21V10c0-3 1.3-5.7 3-7.5 1.7 1.8 3 4.5 3 7.5v11z"/><path d="M9 17h6"/>'),
  pod: S('<path d="M12 2.5c3 1.8 4.6 4.7 4.6 8.5v5.5H7.4V11c0-3.8 1.6-6.7 4.6-8.5z" fill="currentColor" fill-opacity=".2"/><path d="M7.4 11.5h9.2"/><path d="M9 16.5 7.5 21M15 16.5l1.5 4.5M12 16.5V21" stroke-dasharray="1.6 1.4"/>'),
  radiation: F(`<path d="${trefoil(12, 12, 10)}"/>`),
  flag: S('<path d="M5 21V3.5"/><path d="M5 4.5h12.5l-2.8 4 2.8 4H5" fill="currentColor" fill-opacity=".25"/>'),
  fall: S('<path d="M12 3v12"/><path d="M7 10.5 12 15.5l5-5"/><path d="M4.5 20.5h15"/>', '0 0 24 24', 2.2),
  suffocation: S('<circle cx="9.3" cy="12" r="5.3" stroke-width="2.2"/><path d="M15.8 14c0-1 .7-1.7 1.7-1.7s1.7.7 1.7 1.5c0 1.4-3.4 2.6-3.4 4.4h3.5" stroke-width="1.6"/><path d="M3 3l18 18" stroke-width="2.2"/>'),
  eyeOff: S('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20 20 4"/>'),
  info: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".8" fill="currentColor"/>', '0 0 24 24', 2),
  leave: S('<path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4"/><path d="M10 16.5 5.5 12 10 7.5"/><path d="M5.5 12H15"/>', '0 0 24 24', 2),
  map: S('<path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  chat: S('<path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z"/>'),
  medal: S(`<path d="M8 2.5h8l-2 6h-4z"/><circle cx="12" cy="15" r="6"/><path d="${starPath(12, 15.3, 3.4, 1.5, 5)}" fill="currentColor"/>`),
  ping: S('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  swords: S('<path d="M4 4l10 10M20 4 10 14"/><path d="M4 4h3.5M4 4v3.5M20 4h-3.5M20 4v3.5"/><path d="M12.5 16.5l2 2M11.5 16.5l-2 2"/><path d="M15.5 17.5l3 3M8.5 17.5l-3 3"/>'),
  enter: S('<path d="M19 5v7a3 3 0 0 1-3 3H6"/><path d="M9.5 11.5 6 15l3.5 3.5"/>', '0 0 24 24', 2),
  grid: S('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  list: S('<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.5" cy="6.5" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="17.5" r="1" fill="currentColor"/>'),
  history: S('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>'),
  heart: F('<path d="M12 20.5s-8.5-5.1-8.5-11A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.5 2.9c0 5.9-8.5 11-8.5 11z"/>'),
  shieldPlus: S('<path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10.5-4.6-1.9-8-5.5-8-10.5v-6z"/><path d="M12 8.5v7M8.5 12h7"/>'),
  speed: S('<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 13l4-4.5"/><circle cx="12" cy="13.5" r="1.4" fill="currentColor"/>'),
  moon: F('<path d="M15.5 3.2A9 9 0 1 0 20.8 15 7.2 7.2 0 1 1 15.5 3.2z"/>'),
  fist: S('<path d="M7 11V7.6a1.5 1.5 0 0 1 3 0V11M10 10V6a1.5 1.5 0 0 1 3 0v4M13 10V6.5a1.5 1.5 0 0 1 3 0V11M16 10.5V8.6a1.5 1.5 0 0 1 3 0V14c0 4-2.5 6.5-6.5 6.5S6 18 6 15v-3a1.5 1.5 0 0 1 3 0"/>'),
  prone: S('<circle cx="19" cy="12.5" r="2.3"/><path d="M3 17.5h13.5l1.6-2.6"/><path d="M6 17.5l2.6-3.1h5"/><path d="M2 20.5h20" stroke-opacity=".45"/>'),
  roll: S('<path d="M20 12a8 8 0 1 1-3.2-6.4"/><path d="M20.5 3.5v4h-4"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/>'),
  slide: S('<circle cx="16.5" cy="6" r="2.3"/><path d="M4 18.5h11l3-4-3.5-3.5-4.5 2"/><path d="M2 21h20" stroke-opacity=".45"/><path d="M3 14h4M2 11h3" stroke-opacity=".6"/>'),
  mantle: S('<path d="M3 21v-9h9v9" fill="currentColor" fill-opacity=".15"/><circle cx="15.5" cy="5" r="2.2"/><path d="M12 12l3.2-3.6 3.3 2.6M15.2 8.4 13.8 4.6M18.5 11l2 3.5"/>'),
};

// ---------------------------------------------------------------------------
// roles

export const ROLE_ICON: Record<Role, string> = {
  tank: F('<path d="M12 2.2l8.3 3.1v6.1c0 5.2-3.5 8.9-8.3 10.8-4.8-1.9-8.3-5.6-8.3-10.8V5.3z"/><path d="M12 5.5v13.5c-3-1.6-5.2-4.3-5.2-7.8V7.4z" fill-opacity=".35" fill="#000"/>'),
  ranged: F('<path d="M4.4 20.5v-9c0-2.1.8-3.8 2.1-5 1.3 1.2 2.1 2.9 2.1 5v9zM9.9 20.5V8c0-2.5.8-4.5 2.1-5.8 1.3 1.3 2.1 3.3 2.1 5.8v12.5zM15.4 20.5v-9c0-2.1.8-3.8 2.1-5 1.3 1.2 2.1 2.9 2.1 5v9z"/>'),
  melee: F('<path d="M20.2 2.3l1.5 1.5L10.4 15.1l-2.5.9.9-2.5z"/><path d="M5.6 12.6l5.8 5.8-1.5 1.5-1.8-1.8-2.7 2.7a1 1 0 0 1-1.4 0l-.3-.3a1 1 0 0 1 0-1.4l2.7-2.7-1.8-1.8z"/>'),
  scout: F('<path fill-rule="evenodd" d="M12 5C6.6 5 2.7 9.3 1.5 12c1.2 2.7 5.1 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.4 5 12 5zm0 3.1a3.9 3.9 0 1 1 0 7.8 3.9 3.9 0 0 1 0-7.8z"/><circle cx="12" cy="12" r="1.8"/>'),
  support: F('<path d="M9.2 2.8h5.6v6.4h6.4v5.6h-6.4v6.4H9.2v-6.4H2.8V9.2h6.4z"/>'),
  engineer: F(`<path fill-rule="evenodd" d="${gearPath(12, 12, 10.5, 8, 8)}M12 7.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8z"/><path d="M12 9.6l2.1 2.4-2.1 2.4-2.1-2.4z"/>`),
};

/** display order of roles in galleries */
export const ROLE_ORDER: Role[] = ['tank', 'ranged', 'melee', 'scout', 'support', 'engineer'];

export const ROLE_COLOR: Record<Role, string> = {
  tank: '#7fc4ff',
  ranged: '#ff8a7a',
  melee: '#4df0b8',
  scout: '#c9a2ff',
  support: '#8dff9e',
  engineer: '#ffb86b',
};

// ---------------------------------------------------------------------------
// hero emblems (filled glyphs used in kill feed, chips, scoreboard)

export const HERO_ICON: Record<HeroId, string> = {
  condor: F(
    '<path d="M12 6.8c.9 0 1.6.6 1.9 1.4l.6 1.7 7-3.3c.5-.2 1 .3.7.8L18.1 13l-4 1.5-.8 5.1c-.1.7-.6 1.2-1.3 1.2s-1.2-.5-1.3-1.2l-.8-5.1-4-1.5-4.1-5.6c-.3-.5.2-1 .7-.8l7 3.3.6-1.7c.3-.8 1-1.4 1.9-1.4z"/>',
  ),
  needle: S('<circle cx="12" cy="12" r="6.3"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><path d="M5.2 18.8 18.8 5.2" stroke-width="2.6"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>'),
  lunatic: F(`<path d="M13.2 3.4A8.8 8.8 0 1 0 20.6 16 7 7 0 1 1 13.2 3.4z"/><path d="${starPath(18.2, 6.2, 4.3, 1.7, 7)}"/>`),
  phantom: F(
    '<path fill-rule="evenodd" d="M12 2.8c4.6 0 7.8 2.6 7.8 6.8 0 5.3-3.8 10.1-7.8 11.6-4-1.5-7.8-6.3-7.8-11.6 0-4.2 3.2-6.8 7.8-6.8zM6.6 9.6l4.4 2v1.5L6.4 11.4zm10.8 0L13 11.6v1.5l4.6-1.7z"/>',
  ),
  reactor: S('<ellipse cx="12" cy="12" rx="9.2" ry="3.6"/><ellipse cx="12" cy="12" rx="9.2" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.2" ry="3.6" transform="rotate(-60 12 12)"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/>', '0 0 24 24', 1.7),
  blade: F(
    '<path d="M13.2 2.6A9.4 9.4 0 1 0 21.4 12.8 7.5 7.5 0 1 1 13.2 2.6z" fill-opacity=".4"/><path d="M20.6 2.4l1 1L7.9 17.1l-2.3.8.8-2.3z"/><path d="M4.3 15.9l3.8 3.8-1.2 1.2-1.2-1.2-2 2-1.2-1.2 2-2-1.2-1.2z"/>',
  ),
  forge: S(`<path d="${gearPath(12, 12, 10.2, 7.8, 8)}"/><path d="M8.5 9.8l2.6-2.6 2.8 2.8-2.6 2.6z" fill="currentColor"/><path d="M11.8 11.3 16.8 16.3" stroke-width="2.4"/>`, '0 0 24 24', 1.7),
  hive: F(`<path d="${polyPath(12, 6.9, 4.6, 6, 0)}"/><path d="${polyPath(7.4, 14.9, 4.6, 6, 0)}" fill-opacity=".75"/><path d="${polyPath(16.6, 14.9, 4.6, 6, 0)}" fill-opacity=".55"/>`),
  helios: F(
    `<path d="${starPath(12, 12, 11, 7.2, 12, -90)}" fill-opacity=".55"/><path fill-rule="evenodd" d="M12 5.8a6.2 6.2 0 1 1 0 12.4 6.2 6.2 0 0 1 0-12.4zM10.8 8.6v2.2H8.6v2.4h2.2v2.2h2.4v-2.2h2.2v-2.4h-2.2V8.6z"/>`,
  ),
};

// ---------------------------------------------------------------------------
// abilities

export const ABILITY_ICON: Record<AbilityId, string> = {
  dash: S('<path d="M9.5 5.5 16 12l-6.5 6.5" stroke-width="2.6"/><path d="M14 5.5 20.5 12 14 18.5" stroke-opacity=".5" stroke-width="2"/><path d="M2.5 9h4M1.8 12h5.2M2.5 15h4"/>'),
  frag: S('<circle cx="11" cy="14" r="6.5"/><path d="M8.5 7.5h5v-2h-5z" fill="currentColor"/><path d="M13.5 5.5 16.5 3l2.5 1.2"/><path d="M6.5 12.5h9M6.5 15.8h9M11 7.8v12.5" stroke-opacity=".45"/>'),
  swarm: S(rocket(15.5, 7, -40, 1) + rocket(9, 12.5, -40, 1) + rocket(16, 16, -40, 0.9)),
  decoy: S('<circle cx="8" cy="7" r="2.6"/><path d="M3.5 20.5v-3a4.5 4.5 0 0 1 9 0v3"/><circle cx="16.5" cy="7" r="2.6" stroke-dasharray="2 1.6"/><path d="M12 20.5v-3a4.5 4.5 0 0 1 9 0v3" stroke-dasharray="2.2 1.8"/>'),
  lunge: S('<path d="M5 19 19.5 4.5" stroke-width="2.6"/><path d="M15 4.5h4.5V9"/><path d="M2.5 13h4.5M4.5 16.5h3.5M2 9.5h3.5" stroke-opacity=".6"/>'),
  deflect: S('<path d="M7.5 3c4 2.2 6 5.2 6 9s-2 6.8-6 9" stroke-width="2.6"/><path d="M21.5 6.5 15.5 12l6 5.5"/><path d="M21.5 6.5h-3.8M21.5 6.5v3.8" /><path d="M2.5 12h5" stroke-dasharray="1.6 1.6" stroke-opacity=".6"/>'),
  moonblade: S(`<path d="M3.5 18.5c6-1 10.5-5.5 11.5-12.5" stroke-width="2.6"/><path d="M8.5 20.8c6.5-1 11.5-6 12.5-13.5" stroke-opacity=".55"/><path d="M2.5 21.5 6 18"/><path d="${starPath(19, 4.5, 3, 1, 4)}" fill="currentColor" stroke="none"/>`),
  servitor: S('<rect x="8" y="2.8" width="8" height="6" rx="1.6"/><path d="M10.3 5.8h.01M13.7 5.8h.01" stroke-width="2.4"/><path d="M7 10.8h10v6.4H7z" fill="currentColor" fill-opacity=".2"/><path d="M4.8 11.5v5.5M19.2 11.5v5.5M9.6 17.2v4.3M14.4 17.2v4.3"/>'),
  turret: S('<rect x="6.5" y="6.5" width="9.5" height="6.5" rx="1.6" fill="currentColor" fill-opacity=".2"/><path d="M16 9.7h5.5" stroke-width="2.2"/><path d="M11.2 13v3M6.5 21.2l4.7-5.2 4.7 5.2M11.2 16v5.2"/><circle cx="9.5" cy="9.7" r="1.1" fill="currentColor"/>'),
  forcefield: S(`<path d="${polyPath(12, 12, 9.8, 6, -90)}" stroke-dasharray="3.2 2"/><circle cx="12" cy="9.6" r="2.4"/><path d="M7.8 17.2c.6-2.4 2.1-3.5 4.2-3.5s3.6 1.1 4.2 3.5"/>`),
  barricade: S('<path d="M2.5 19.5h19"/><path d="M4.5 19.5V8.5h15v11" fill="currentColor" fill-opacity=".18"/><path d="M4.5 13.5h15M9 8.5v5M15 8.5v5M12 13.5v6"/>'),
  huntdrone: S('<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><path d="M7.2 7.4 10 9.6M16.8 7.4 14 9.6"/><rect x="9" y="9.4" width="6" height="5" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M12 14.4v3.2M9.8 20.8l2.2-3 2.2 3"/>'),
  spotdrone: S('<circle cx="5" cy="5.5" r="2.3"/><circle cx="19" cy="5.5" r="2.3"/><path d="M7 6.8l3 2.1M17 6.8l-3 2.1"/><circle cx="12" cy="10.8" r="2.7"/><circle cx="12" cy="10.8" r=".9" fill="currentColor"/><path d="M7.5 21.5 12 13.5l4.5 8" stroke-dasharray="1.8 1.6"/>'),
  kamikaze: S(`<path d="M3 3.5l4.6 1.8-2.4 2.5zM10.2 2.5l4 2.4-3 1.6zM17.4 4l3.4 3.1-3.2.8z" fill="currentColor"/><path d="${starPath(12, 16, 6.3, 2.6, 8)}" fill="currentColor" fill-opacity=".3"/>`),
  grapple: S('<path d="M12 2.5v13"/><path d="M12 15.5c0 3-2.4 4.6-5 4.1-2-.4-3-2-3-3.6"/><path d="M12 15.5c0 3 2.4 4.6 5 4.1 2-.4 3-2 3-3.6"/><path d="M4 16l-1.6-1.6M20 16l1.6-1.6"/><circle cx="12" cy="3" r="1.4" fill="currentColor"/>'),
  sensor: S('<circle cx="12" cy="15.5" r="2.2" fill="currentColor"/><path d="M8.3 12a5 5 0 0 1 7.4 0M5.8 9.4a8.6 8.6 0 0 1 12.4 0M3.3 6.8a12.2 12.2 0 0 1 17.4 0"/><path d="M12 17.8v3.7M9 21.5h6"/>'),
  overcharge: F('<path d="M13.6 1.8 4.6 13.6h6.2L9.3 22.2l10.1-12.8h-6.5z"/>'),
  dome: S('<path d="M2.5 19h19"/><path d="M4.5 19a7.5 7.5 0 0 1 15 0" fill="currentColor" fill-opacity=".2"/><path d="M8.3 19a3.7 7.5 0 0 1 7.4 0M4.5 19c1-2 4-3.3 7.5-3.3s6.5 1.3 7.5 3.3" stroke-opacity=".55"/><path d="M12 11.5v7.5" stroke-opacity=".55"/>'),
  slam: S('<path d="M12 2.5v9.5"/><path d="M7.8 8.2 12 12.4l4.2-4.2"/><path d="M2.5 20.5h19" stroke-width="2.4"/><path d="M5.5 17.5 3 15.5M18.5 17.5l2.5-2M8.5 16.8l-.8-2.3M15.5 16.8l.8-2.3"/>'),
  blackhole: S('<circle cx="12" cy="12" r="2.4" fill="currentColor"/><path d="M12 4.2a7.8 7.8 0 0 1 7.8 7.8 5.6 5.6 0 0 1-5.6 5.6 3.9 3.9 0 0 1-3.9-3.9"/><path d="M12 19.8A7.8 7.8 0 0 1 4.2 12a5.6 5.6 0 0 1 5.6-5.6 3.9 3.9 0 0 1 3.9 3.9"/>'),
  o2burst: S('<circle cx="10.3" cy="12" r="3.6" stroke-width="2.2"/><path d="M14.6 13.5c0-.7.5-1.2 1.2-1.2s1.2.5 1.2 1.1c0 1-2.4 1.8-2.4 3h2.5" stroke-width="1.4"/><path d="M12 1.8v2.4M12 19.8v2.4M1.8 12h2.4M19.8 12h2.4M4.8 4.8l1.7 1.7M17.5 17.5l1.7 1.7M4.8 19.2l1.7-1.7M17.5 6.5l1.7-1.7"/>'),
  medstation: S('<rect x="3.5" y="9" width="17" height="11.5" rx="2" fill="currentColor" fill-opacity=".18"/><path d="M12 11.5v6.5M8.8 14.8h6.4" stroke-width="2.4"/><path d="M8 9V6h8v3"/><path d="M12 6V3"/>'),
  lifebubble: S('<circle cx="12" cy="12" r="9.3"/><circle cx="12" cy="10" r="2.4"/><path d="M7.8 17.3c.6-2.2 2.1-3.3 4.2-3.3s3.6 1.1 4.2 3.3"/><path d="M6.2 8a6.8 6.8 0 0 1 3.4-3.1" stroke-opacity=".6"/>'),
  rocketjump: S('<path d="M12 2c2.3 1.7 3.4 4.2 3.4 7.3v4.4H8.6V9.3C8.6 6.2 9.7 3.7 12 2z" fill="currentColor" fill-opacity=".2"/><path d="M8.6 10.5 6.3 13v2.6h2.3M15.4 10.5l2.3 2.5v2.6h-2.3"/><path d="M10.3 16.5 12 21l1.7-4.5"/><path d="M5 20.5l2-1.5M19 20.5l-2-1.5" stroke-opacity=".6"/>'),
  mine: S('<circle cx="12" cy="13" r="5.2" fill="currentColor" fill-opacity=".2"/><path d="M12 3.5v3.3M12 19.3v2M4.2 13H2.5M21.5 13h-1.7M6.3 7.3l1.5 1.5M17.7 7.3l-1.5 1.5"/><circle cx="12" cy="13" r="1.6" fill="currentColor"/>'),
  tacnuke: F(`<path d="${trefoil(12, 12, 10.5)}"/>`),
  blink: S(`<path d="M3.5 18c2-6 7.5-9.5 13.5-8.8" stroke-dasharray="2.2 2.6"/><path d="M14.3 6.3 17.8 9.3l-3.2 3"/><circle cx="4" cy="18.3" r="1.9" fill="currentColor"/><path d="${starPath(19.5, 16.5, 3.2, 1, 4, -90)}" fill="currentColor" stroke="none"/>`),
  cloak: S('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke-dasharray="3 2"/><circle cx="12" cy="12" r="3"/><path d="M4 20 20 4"/>'),
  empnova: S('<circle cx="12" cy="12" r="9.3" stroke-dasharray="3 2.3"/><path d="M13.2 5.3 7.8 13h4l-1 5.7L16.2 11h-4z" fill="currentColor" stroke="none"/>'),
};

// ---------------------------------------------------------------------------
// weapons (64×24 side profiles)

const W = (body: string) => `<svg viewBox="0 0 64 24" fill="currentColor" aria-hidden="true">${body}</svg>`;

export const WEAPON_ICON: Record<WeaponId, string> = {
  pulse: W(
    '<path d="M3 10.2 13 8.6l1.6 3.2-1 4.4L4 17.2l-1-2z"/><path d="M12.5 8h25.5l2 1.5v4.5H33l-1.2 1H13z"/><rect x="20" y="4.6" width="12" height="2.4" rx="1"/><path d="M22 7h2v1h-2zM28 7h2v1h-2z"/><path d="M38 8.4h13v4.8H38z"/><path d="M50 9.6h8v2.4h-8z"/><path d="M57 8.6h4.2v4.4H57z"/><path d="M26.2 14.5h5.3l2.3 6.8-5.3.8z"/><path d="M16.5 14.5h4.2l-2.4 6.2h-4.1z"/><path d="M40 13.2h1.4v1.6H40zM43.5 13.2h1.4v1.6h-1.4zM47 13.2h1.4v1.6H47z" opacity=".6"/>',
  ),
  rail: W(
    '<path d="M2 11 10 9.8l1.3 5.2-8.3 1.4z"/><path d="M10 9h22l2 1.4v3.8H10z"/><rect x="13" y="5" width="15" height="3" rx="1.2"/><circle cx="28.5" cy="6.5" r="1.8" opacity=".7"/><path d="M31 7.8h31v1.5H31zM31 12.7h31v1.5H31z"/><path d="M34.5 6.6h3v9h-3zM42.5 6.6h3v9h-3zM50.5 6.6h3v9h-3z"/><path d="M36 10.2h26v1.6H36z" opacity=".45"/><path d="M14 14.2h4.2l-2.2 6H12z"/>',
  ),
  plasma: W(
    '<path d="M3 10 11 8.6l1.2 6.2L4 16.2z"/><path d="M11 7h26a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H11z"/><circle cx="24" cy="11.5" r="3.3" opacity=".55"/><path d="M38.5 6.2 50 4.8l2.2 2.6v8.4L50 18.2l-11.5-1.4z"/><path d="M52 7.2h3v8.6h-3z" opacity=".7"/><path d="M29 16h14v2.8H29z"/><path d="M15 16h4.2l-2.2 5.4H13z"/>',
  ),
  glauncher: W(
    '<path d="M3 10 10 8.8l1 5.2-7 1.2z"/><path d="M10 8h20v5H10z"/><circle cx="23" cy="14" r="5.6"/><circle cx="23" cy="14" r="2" opacity=".35" fill="#000"/><path d="M30 6.8h22.5a1.5 1.5 0 0 1 1.5 1.5v3.2a1.5 1.5 0 0 1-1.5 1.5H30z"/><path d="M53 5.8h4v8.2h-4z"/><path d="M34 3.6h4.5v3.2H34z"/><path d="M13.5 13h4.2l-2.2 6H11.5z"/>',
  ),
  sealer: W(
    '<rect x="5" y="4.5" width="17" height="8" rx="4"/><path d="M8 6.5h11" stroke="#000" stroke-opacity=".3" stroke-width="1.2"/><path d="M13 11h27v5.5H13z"/><path d="M40 10.8 51 11.8l4-2.2 3.2 1.4v5L55 17.4l-4-2.2-11 1.2z"/><path d="M22 8.5c6 0 9 1 12 2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M21 16.5h4.3l-2.2 5.5H19z"/><circle cx="60.5" cy="9" r="1.2" opacity=".6"/><circle cx="62" cy="13.5" r="1" opacity=".5"/>',
  ),
  twinarc: W(
    '<g opacity=".55"><path d="M9 4h24l1.5 1.2v4.3H9z"/><path d="M34 5.6h9.5v2.4H34z"/><path d="M19 9.5h3.3l1 5.3h-3.3z"/><path d="M12 9.5h3.5l-1.8 4.5h-3.3z"/></g><path d="M15 10.5h25l1.6 1.3v4.6H15z"/><path d="M41 12h10.5v2.6H41z"/><path d="M51 11.2h2.4v4.2H51z"/><path d="M26 16.4h3.5l1.2 6h-3.6z"/><path d="M18.2 16.4H22l-2 4.8h-3.6z"/><path d="M55 10.5l2.5 2.3-2 .8 3 2.2" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  ),
  blade: W(
    '<path d="M3 13.6C14 12.2 30 10.6 45 10.1l.7 3.1C31 14.1 15 14.9 3 13.6z"/><path d="M6 13.2c12-.9 25-1.9 38.5-2.3" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".7"/><ellipse cx="46.8" cy="11.7" rx="1.7" ry="4.4"/><path d="M48.2 10.3h13.4a1.6 1.6 0 0 1 0 3.2H48.2z"/><path d="M50.5 10.3l2 3.2M53.5 10.3l2 3.2M56.5 10.3l2 3.2" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1"/>',
  ),
  riveter: W(
    '<path d="M3 10.5 6.5 10v5.5L3 15z"/><path d="M6.5 9h26v7.5h-26z"/><path d="M32.5 10h12l3 1.6v3.3l-3 1.6h-12z"/><path d="M47.5 11.6h6.5v2.3h-6.5z"/><path d="M10.5 9V5.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2V9h-3.2V6.6H13.7V9z"/><path d="M14.5 16.5h4.6l-2.1 6h-4.6z"/><circle cx="24" cy="19.4" r="1.5"/><circle cx="27.6" cy="19.8" r="1.5"/><circle cx="31.2" cy="19.8" r="1.5"/><circle cx="56.5" cy="12.8" r="1.2" opacity=".6"/>',
  ),
  burst: W(
    '<path d="M4 11.2l8.2-1.6 1.2 4.6L5 16.2z"/><path d="M12.2 8.4h30.3l2 1.6v4.2H12.2z"/><path d="M44.5 10.4h14v2.5h-14z"/><path d="M57.5 9.7h3.6v3.9h-3.6z"/><rect x="22" y="4.8" width="11.5" height="2.8" rx="1"/><path d="M18 14.2h4.2l-1.9 6.1h-4.2z"/><path d="M28.5 14.2h4.6l1.3 5.6h-4.3z"/><path d="M36 10.3h2v2.1h-2zM39.2 10.3h2v2.1h-2zM42.4 10.3h1.6v2.1h-1.6z" opacity=".5"/>',
  ),
  nuke: W(
    '<rect x="4" y="7" width="46" height="9" rx="2.5"/><path d="M50 6h5.5l7 5.5-7 5.5H50z"/><circle cx="15" cy="11.5" r="3.3" fill="#000" opacity=".35"/><path d="M15 11.5 13.6 8.8a3 3 0 0 1 2.8 0zM15 11.5l2.8-.1a3 3 0 0 1-1.4 2.5zM15 11.5l-1.4 2.4a3 3 0 0 1-1.4-2.5z" opacity=".9"/><path d="M26 2.8h8.5v4.2H26z"/><path d="M20 16h4.2l-2.2 5.5H18z"/><path d="M33 16h3.2l-.6 3.8h-3.2z"/>',
  ),
  singularity: W(
    '<path d="M4 10 11 8.8l1 5.8-7 1.2z"/><path d="M11 8h25v8H11z"/><path d="M36 6.2 50 3.8l1.5 2.4-13 4.2zM36 17.8l14 2.4 1.5-2.4-13-4.2z"/><circle cx="46" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".6"/><circle cx="46" cy="12" r="3.3"/><path d="M15.5 16h4.2l-2.2 5.4h-4z"/><path d="M20 6.2h9v1.8h-9z"/>',
  ),
  helios: W(
    '<path d="M10 7.2h24a2 2 0 0 1 2 2v4.6a2 2 0 0 1-2 2H10z"/><circle cx="38.5" cy="11.5" r="4.6"/><circle cx="38.5" cy="11.5" r="2" fill="#000" opacity=".35"/><path d="M13.5 7.2 10 2.2" stroke="currentColor" stroke-width="1.6"/><circle cx="9.6" cy="1.9" r="1.2"/><path d="M44 11h18v1H44z" opacity=".75"/><path d="M47 9.5h1.4v4H47zM52 9.5h1.4v4H52zM57 9.5h1.4v4H57z" opacity=".45"/><path d="M17 15.8h4.2l-2.2 5.5H15z"/><path d="M5 9.5h5v4H5z"/>',
  ),
};

/** kill-feed icon for any damage source */
export function sourceIcon(w: WeaponId | AbilityId | 'suffocation' | 'fall' | 'self'): { svg: string; wide: boolean } {
  if (w === 'suffocation') return { svg: UI.suffocation, wide: false };
  if (w === 'fall') return { svg: UI.fall, wide: false };
  if (w === 'self') return { svg: UI.skull, wide: false };
  if (w in WEAPON_ICON) return { svg: WEAPON_ICON[w as WeaponId], wide: true };
  if (w in ABILITY_ICON) return { svg: ABILITY_ICON[w as AbilityId], wide: false };
  return { svg: UI.skull, wide: false };
}

// ---------------------------------------------------------------------------
// modes

export const MODE_ICON: Record<ModeId, string> = {
  duel2v2: S('<circle cx="5.5" cy="8" r="2.3"/><circle cx="8.5" cy="15.5" r="2.3"/><circle cx="18.5" cy="8" r="2.3"/><circle cx="15.5" cy="15.5" r="2.3"/><path d="M12 3.5v17" stroke-dasharray="2 2"/>'),
  ffa: S(`<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M5.3 18.7l2.8-2.8M15.9 8.1l2.8-2.8"/>`),
  war4v4: S('<path d="M4.5 21V3.5"/><path d="M4.5 4h12l-2.6 3.8 2.6 3.8h-12" fill="currentColor" fill-opacity=".25"/><circle cx="14" cy="18.5" r="1.4" fill="currentColor"/><circle cx="18" cy="18.5" r="1.4" fill="currentColor"/><circle cx="10" cy="18.5" r="1.4" fill="currentColor"/>'),
};

// ---------------------------------------------------------------------------
// ribbons (medal badges) and level badges

let gid = 0;
const uid = (p: string) => `${p}${++gid}`;

const RIBBON_STYLE: Record<RibbonId, { c1: string; c2: string; glyph: string; text?: string }> = {
  ace: { c1: '#ffe27a', c2: '#c77a12', glyph: UI.crown },
  multikill: { c1: '#ffb35c', c2: '#d4460f', glyph: '', text: '×3' },
  killstreak5: { c1: '#ff8a6b', c2: '#b8202c', glyph: '', text: '5' },
  killstreak10: { c1: '#ff6b9a', c2: '#8a0f3c', glyph: '', text: '10' },
  headhunter: { c1: '#ff7373', c2: '#8f1722', glyph: UI.headshot },
  ult: { c1: '#f59cff', c2: '#7b22c7', glyph: ABILITY_ICON.overcharge },
  nuclear: { c1: '#f2ff6b', c2: '#6b8f0d', glyph: UI.radiation },
  ceiling: { c1: '#c1a3ff', c2: '#4b2bb3', glyph: UI.boot },
  breach: { c1: '#9ff6ff', c2: '#12799b', glyph: UI.o2 },
  capture: { c1: '#8cc3ff', c2: '#1f4fc2', glyph: UI.flag },
  medic: { c1: '#9dffb0', c2: '#17864a', glyph: ROLE_ICON.support },
  survivor: { c1: '#f2f6ff', c2: '#6b7a93', glyph: UI.shieldPlus },
};

/** Hexagonal medal SVG for a ribbon (viewBox 64×72). locked = desaturated silhouette. */
export function ribbonSvg(id: RibbonId, locked = false): string {
  const st = RIBBON_STYLE[id] ?? RIBBON_STYLE.ace;
  const g = uid('rb');
  const c1 = locked ? '#4a5468' : st.c1;
  const c2 = locked ? '#1c2230' : st.c2;
  const hex = polyPath(32, 40, 25, 6, -90);
  const hexIn = polyPath(32, 40, 19.5, 6, -90);
  const col = locked ? '#8591a8' : '#fff';
  const glyphWrap = st.text
    ? `<text x="32" y="${st.text.length > 1 ? 47.5 : 48.5}" text-anchor="middle" font-family="Oswald, 'Russo One', sans-serif" font-weight="700" font-style="italic" font-size="${st.text.length > 1 ? 18 : 22}" fill="${col}">${st.text}</text>`
    : `<svg x="20" y="28" width="24" height="24" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" color="${col}">${inner(st.glyph)}</svg>`;
  return `<svg viewBox="0 0 64 72" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><linearGradient id="${g}r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c2}"/><stop offset=".5" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<path d="M18 2h10l6 14h-10zM46 2H36l-6 14h10z" fill="url(#${g}r)" opacity="${locked ? 0.5 : 0.95}"/>
<path d="${hex}" fill="url(#${g})" stroke="${locked ? '#2b3345' : '#fff'}" stroke-opacity="${locked ? 1 : 0.7}" stroke-width="2"/>
<path d="${hexIn}" fill="#000" fill-opacity=".22" stroke="#fff" stroke-opacity=".25" stroke-width="1"/>
<path d="M13 30 32 19l19 11" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/>
${glyphWrap}</svg>`;
}

function inner(svg: string): string {
  // extract inner markup of a single-root <svg> string and keep its root-level fill/stroke defaults
  const m = svg.match(/^<svg([^>]*)>([\s\S]*)<\/svg>$/);
  if (!m) return svg;
  const attrs = m[1];
  const fill = /fill="currentColor"/.test(attrs) ? 'currentColor' : 'none';
  const sw = (attrs.match(/stroke-width="([\d.]+)"/) ?? [])[1];
  const stroke = /stroke="currentColor"/.test(attrs) ? 'currentColor' : 'none';
  return `<g fill="${fill}" stroke="${stroke}"${sw ? ` stroke-width="${sw}"` : ''}>${m[2]}</g>`;
}

export const TIER_GRAD: Record<RankTier, [string, string, string]> = {
  bronze: ['#f3c08e', '#b56a36', '#5a2e14'],
  silver: ['#ffffff', '#aab6c8', '#4d5a6e'],
  gold: ['#fff1a8', '#f0b429', '#7a4a06'],
  platinum: ['#dafff8', '#5fd4c4', '#1c6b64'],
  diamond: ['#e0ecff', '#6e93ff', '#26379c'],
  master: ['#ffe0ff', '#c46bff', '#4d148c'],
};

/** hexagonal level badge (viewBox 48×52) with rank tier colours and pips */
export function levelBadgeSvg(level: number, tier: RankTier, pips = 0): string {
  const g = uid('lv');
  const [a, b, c] = TIER_GRAD[tier];
  const outer = polyPath(24, 25, 23, 6, -90);
  const mid = polyPath(24, 25, 19, 6, -90);
  const txt = String(level);
  const fs = txt.length >= 3 ? 14 : 17;
  let pipSvg = '';
  const np = Math.min(3, pips);
  for (let i = 0; i < np; i++) pipSvg += `<path d="M${18 + i * 6} 44.5l3-2 3 2" fill="none" stroke="${a}" stroke-width="1.6"/>`;
  return `<svg viewBox="0 0 48 52" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient><radialGradient id="${g}i" cx=".5" cy=".3" r=".8"><stop offset="0" stop-color="#1d2740"/><stop offset="1" stop-color="#070b16"/></radialGradient></defs>
<path d="${outer}" fill="url(#${g})"/><path d="${mid}" fill="url(#${g}i)" stroke="${a}" stroke-opacity=".5" stroke-width="1"/>
<path d="M8 17 24 8l16 9" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="1"/>
<text x="24" y="${fs === 17 ? 31.5 : 30.5}" text-anchor="middle" font-family="Oswald, 'Russo One', sans-serif" font-weight="700" font-style="italic" font-size="${fs}" fill="#fff">${txt}</text>${pipSvg}</svg>`;
}

/** Palladium crystal emblem with glow (for logo / decorations) */
export function pdCrystalSvg(): string {
  const g = uid('pd');
  return `<svg viewBox="0 0 40 48" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8ffff"/><stop offset=".5" stop-color="#7ff0ff"/><stop offset="1" stop-color="#1d8fb8"/></linearGradient></defs><path d="M20 2l14 10v24L20 46 6 36V12z" fill="url(#${g})"/><path d="M20 2v44M6 12l14 10 14-10M20 22 6 36M20 22l14 14" stroke="#fff" stroke-opacity=".55" stroke-width="1" fill="none"/></svg>`;
}
