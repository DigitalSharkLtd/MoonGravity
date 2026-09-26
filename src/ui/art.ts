/**
 * Vector illustrations for the UI: cel-shaded hero busts, lunar map vistas and the logo emblem.
 * Everything is generated as SVG strings (works offline, no assets).
 */
import { HEROES, type HeroId, type MapId } from '../game/Types';
import { gearPath, polyPath, starPath } from './icons';

let gid = 0;
const uid = (p: string) => `${p}${++gid}`;

const INK = '#0a0e18';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex: string, k: number): string {
  // k < 0 darker, k > 0 lighter
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (k < 0) {
    r *= 1 + k;
    g *= 1 + k;
    b *= 1 + k;
  } else {
    r += (255 - r) * k;
    g += (255 - g) * k;
    b += (255 - b) * k;
  }
  const h2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return '#' + h2(r) + h2(g) + h2(b);
}

// ---------------------------------------------------------------------------
// hero portraits (viewBox 0 0 300 360, bust facing camera, toon/ink style)

interface Pal {
  c: string; // hero colour
  cd: string; // hero colour dark
  cl: string; // hero colour light
  v: string; // visor
  suit: string;
  suitD: string;
  id: string; // gradient id prefix
}

const ink = (w = 5) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

function visorDefs(p: Pal): string {
  return `<linearGradient id="${p.id}v" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="${shade(p.v, 0.55)}"/><stop offset=".45" stop-color="${p.v}"/><stop offset="1" stop-color="${shade(p.v, -0.55)}"/></linearGradient>
<radialGradient id="${p.id}g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${p.v}" stop-opacity=".9"/><stop offset="1" stop-color="${p.v}" stop-opacity="0"/></radialGradient>
<linearGradient id="${p.id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.cl}"/><stop offset=".5" stop-color="${p.c}"/><stop offset="1" stop-color="${p.cd}"/></linearGradient>
<linearGradient id="${p.id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${shade(p.suit, 0.25)}"/><stop offset=".55" stop-color="${p.suit}"/><stop offset="1" stop-color="${p.suitD}"/></linearGradient>
<filter id="${p.id}f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>`;
}

/** reflective highlight streak on a visor */
const glint = (d: string) => `<path d="${d}" fill="#fff" fill-opacity=".55"/>`;

function condor(p: Pal): string {
  return `
<path d="M22 360C28 296 78 262 150 258C222 262 272 296 278 360Z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M104 294 150 284l46 10-6 66h-80z" fill="${p.suitD}" ${ink(4)}/>
<path d="M116 304 150 297l34 7-4 30h-60z" fill="url(#${p.id}a)" ${ink(3)}/>
<path d="M141 312h18l-9 14z" fill="${INK}" opacity=".6"/>
<path d="M24 334C26 292 58 266 106 262l8 40C80 306 56 320 44 346Z" fill="url(#${p.id}a)" ${ink()}/>
<path d="M276 334C274 292 242 266 194 262l-8 40c34 4 58 18 70 44Z" fill="${p.c}" ${ink()}/>
<path d="M276 334C274 292 242 266 194 262l-4 20c30 4 60 22 80 52Z" fill="${p.cd}" opacity=".55"/>
<path d="M44 300l40-18M50 316l38-16" stroke="${p.cl}" stroke-width="3" opacity=".7"/>
<ellipse cx="150" cy="248" rx="54" ry="15" fill="#3a4458" ${ink(4)}/>
<rect x="60" y="136" width="22" height="50" rx="9" fill="${p.suitD}" ${ink(4)}/>
<rect x="218" y="136" width="22" height="50" rx="9" fill="${p.suitD}" ${ink(4)}/>
<circle cx="150" cy="160" r="80" fill="url(#${p.id}s)" ${ink()}/>
<path d="M150 80a80 80 0 0 1 0 160a66 80 0 0 0 0-160z" fill="${p.suitD}" opacity=".45"/>
<path d="M136 81h28l-3 44h-22z" fill="${p.c}" ${ink(4)}/>
<path d="M84 152c16-28 116-28 132 0l-6 36c-20 18-100 18-120 0z" fill="url(#${p.id}v)" ${ink()}/>
${glint('M98 146c28-14 76-16 104-6l-2 8c-30-9-72-7-100 6z')}
<ellipse cx="150" cy="170" rx="46" ry="16" fill="url(#${p.id}g)" opacity=".55"/>
<path d="M206 106 234 50" ${ink(5)}/><circle cx="235" cy="47" r="7" fill="${p.c}" ${ink(3)}/>
<path d="M88 214h124" stroke="${p.cd}" stroke-width="4" opacity=".5"/>`;
}

function needle(p: Pal): string {
  return `
<path d="M40 360C46 300 90 268 150 264C210 268 254 300 260 360Z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M58 300C110 288 190 288 242 300l-4 22C190 310 110 310 62 322Z" fill="url(#${p.id}a)" ${ink(4)}/>
<path d="M110 322l40 38M190 322l-40 38" stroke="${p.suitD}" stroke-width="5"/>
<path d="M96 264h108l-8-42h-92z" fill="${p.suitD}" ${ink(4)}/>
<path d="M98 96 70 26" ${ink(4)}/><path d="M66 20l8 2-3 10z" fill="${p.c}" ${ink(2)}/>
<ellipse cx="150" cy="152" rx="66" ry="80" fill="url(#${p.id}s)" ${ink()}/>
<path d="M150 72a66 80 0 0 1 0 160a52 80 0 0 0 0-160z" fill="${p.suitD}" opacity=".5"/>
<path d="M92 94c20-18 96-18 116 0l-6 12c-22-14-82-14-104 0z" fill="${p.c}" ${ink(3)}/>
<path d="M90 146h120l-4 26H94z" fill="url(#${p.id}v)" ${ink()}/>
${glint('M98 150h60l-2 5h-58z')}
<rect x="200" y="150" width="46" height="16" rx="4" fill="${p.suitD}" ${ink(4)}/>
<circle cx="186" cy="160" r="24" fill="#1a2233" ${ink()}/>
<circle cx="186" cy="160" r="14" fill="url(#${p.id}v)"/>
<circle cx="186" cy="160" r="22" fill="url(#${p.id}g)" opacity=".7"/>
<path d="M186 148v24M174 160h24" stroke="${INK}" stroke-width="1.6" opacity=".7"/>
<path d="M104 196c16 10 76 10 92 0" stroke="${p.suitD}" stroke-width="4" fill="none"/>`;
}

function lunatic(p: Pal): string {
  const stripes = uid('hz');
  return `
<defs><pattern id="${stripes}" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="18" height="18" fill="#ffd23f"/><rect width="9" height="18" fill="${INK}"/></pattern></defs>
<path d="M234 256 252 176l18 80z" fill="#dfe6f0" ${ink(4)}/><path d="M244 212h16" stroke="${p.c}" stroke-width="5"/>
<path d="M14 360C20 290 70 256 150 252C230 256 280 290 286 360Z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M92 290 150 280l58 10-8 70h-100z" fill="url(#${stripes})" ${ink(4)}/>
<path d="M18 330C22 286 54 262 100 256l10 42C76 302 52 318 40 344Z" fill="url(#${p.id}a)" ${ink()}/>
<path d="M282 330C278 286 246 262 200 256l-10 42c34 4 58 20 70 46Z" fill="${p.c}" ${ink()}/>
<path d="M128 244c-10 20-18 30-30 44M172 244c10 20 18 30 30 44" stroke="#2c3446" stroke-width="10" fill="none" stroke-linecap="round"/>
<path d="M138 76h24l-6-40h-12z" fill="${p.c}" ${ink(4)}/>
<path d="M80 104Q80 76 106 74h88q26 2 26 30l2 96q-2 28-28 30h-88q-26-2-28-30z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M150 74h44q26 2 26 30l2 96q-2 28-28 30h-44z" fill="${p.suitD}" opacity=".35"/>
<path d="M86 108h128" stroke="${p.c}" stroke-width="10"/>
<circle cx="122" cy="160" r="30" fill="#2a3040" ${ink()}/>
<circle cx="178" cy="160" r="30" fill="#2a3040" ${ink()}/>
<circle cx="122" cy="160" r="21" fill="url(#${p.id}v)"/>
<circle cx="178" cy="160" r="21" fill="url(#${p.id}v)"/>
<circle cx="150" cy="160" r="60" fill="url(#${p.id}g)" opacity=".35"/>
${glint('M110 150a14 14 0 0 1 14-8l-2 5a9 9 0 0 0-8 5z')}${glint('M166 150a14 14 0 0 1 14-8l-2 5a9 9 0 0 0-8 5z')}
<rect x="126" y="200" width="48" height="18" rx="6" fill="#2a3040" ${ink(4)}/>
<path d="M134 209h32" stroke="${p.v}" stroke-width="3" stroke-dasharray="4 4"/>`;
}

function phantom(p: Pal): string {
  return `
<path d="M36 360C42 302 88 270 150 266C212 270 258 302 264 360Z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M60 340 110 272l20 10-38 78zM240 340l-50-68-20 10 38 78z" fill="${p.cd}" ${ink(4)}/>
<path d="M150 266v94" stroke="${p.v}" stroke-width="5"/><path d="M150 266v94" stroke="${p.v}" stroke-width="16" opacity=".25" filter="url(#${p.id}f)"/>
<path d="M150 58C216 58 238 118 234 176c-2 36-18 64-36 88H102C84 240 68 212 66 176 62 118 84 58 150 58Z" fill="${p.suitD}" ${ink()}/>
<path d="M150 58C216 58 238 118 234 176c-2 36-18 64-36 88h-24c30-40 44-92 28-140-8-30-24-52-52-66z" fill="#000" opacity=".3"/>
<path d="M150 58C216 58 238 118 234 176" stroke="${p.c}" stroke-width="3" fill="none" opacity=".8"/>
<path d="M150 94c40 0 56 32 54 70-2 34-24 62-54 70-30-8-52-36-54-70-2-38 14-70 54-70Z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M150 94c40 0 56 32 54 70-2 34-24 62-54 70z" fill="#000" opacity=".25"/>
<path d="M104 150l44 20v12l-46-18z" fill="url(#${p.id}v)" ${ink(3)}/>
<path d="M196 150l-44 20v12l46-18z" fill="url(#${p.id}v)" ${ink(3)}/>
<ellipse cx="150" cy="168" rx="56" ry="18" fill="url(#${p.id}g)" opacity=".6"/>
<path d="M150 200v26M138 208l12 18 12-18" stroke="${p.c}" stroke-width="3" fill="none" opacity=".8"/>`;
}

function reactor(p: Pal): string {
  return `
<path d="M4 360C8 280 60 240 150 236C240 240 292 280 296 360Z" fill="url(#${p.id}s)" ${ink()}/>
<circle cx="150" cy="316" r="30" fill="#1a2233" ${ink()}/>
<circle cx="150" cy="316" r="46" fill="url(#${p.id}g)" opacity=".7"/>
<circle cx="150" cy="316" r="18" fill="url(#${p.id}v)"/>
<circle cx="150" cy="316" r="24" fill="none" stroke="${p.v}" stroke-width="2" stroke-dasharray="5 5"/>
<path d="M6 304C10 236 50 202 110 204l10 60C76 264 40 288 28 334Z" fill="url(#${p.id}a)" ${ink()}/>
<path d="M294 304C290 236 250 202 190 204l-10 60c44 0 80 24 92 70Z" fill="${p.c}" ${ink()}/>
<path d="M294 304C290 236 250 202 190 204l-4 24c40 0 82 26 100 76Z" fill="${p.cd}" opacity=".5"/>
<path d="M30 256l60-28M24 280l66-26M270 256l-60-28M276 280l-66-26" stroke="${INK}" stroke-width="4" opacity=".55"/>
<path d="M92 96h116l20 44-6 88H78l-6-88z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M150 96h58l20 44-6 88h-72z" fill="${p.suitD}" opacity=".4"/>
<path d="M98 96h104l12 24H86z" fill="${p.c}" ${ink(4)}/>
<path d="M92 148h116l-4 26H96z" fill="url(#${p.id}v)" ${ink()}/>
<ellipse cx="150" cy="161" rx="60" ry="12" fill="url(#${p.id}g)" opacity=".6"/>
${glint('M100 152h52l-2 5h-50z')}
<path d="M92 190h26M92 202h26M182 190h26M182 202h26" stroke="${INK}" stroke-width="4"/>
<path d="M130 228h40v14h-40z" fill="#2c3446" ${ink(3)}/>`;
}

function helios(p: Pal): string {
  return `
<path d="M30 360C36 298 84 266 150 262C216 266 264 298 270 360Z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M150 262v98" stroke="${p.suitD}" stroke-width="4" opacity=".6"/>
<path d="M136 298h28v14h14v28h-14v20h-28v-20h-14v-28h14z" fill="${p.c}" ${ink(4)}/>
<rect x="44" y="262" width="30" height="62" rx="12" fill="#e9eef6" ${ink(4)} transform="rotate(-16 59 293)"/>
<rect x="226" y="262" width="30" height="62" rx="12" fill="#cfd8e6" ${ink(4)} transform="rotate(16 241 293)"/>
<path d="M50 280l18-5M232 275l18 5" stroke="${p.c}" stroke-width="4"/>
<ellipse cx="150" cy="248" rx="60" ry="16" fill="#3a4458" ${ink(4)}/>
<ellipse cx="150" cy="60" rx="56" ry="12" fill="none" stroke="${p.v}" stroke-width="12" opacity=".35" filter="url(#${p.id}f)"/>
<ellipse cx="150" cy="60" rx="54" ry="11" fill="none" stroke="${p.c}" stroke-width="5"/>
<path d="M150 98c34 0 50 28 48 64-2 36-22 60-48 62-26-2-46-26-48-62-2-36 14-64 48-64Z" fill="#2a2433" ${ink(4)}/>
<path d="M104 150c0-34 18-54 46-54s46 20 46 54" fill="none" stroke="${p.c}" stroke-width="8"/>
<circle cx="104" cy="160" r="10" fill="${p.c}" ${ink(3)}/>
<path d="M104 170c4 22 18 32 34 34" stroke="${INK}" stroke-width="4" fill="none"/><circle cx="140" cy="204" r="5" fill="${p.v}"/>
<path d="M126 158c6-4 14-4 20 0M154 158c6-4 14-4 20 0" stroke="${p.v}" stroke-width="4" fill="none"/>
<circle cx="150" cy="160" r="86" fill="${p.v}" fill-opacity=".12" ${ink()}/>
<circle cx="150" cy="160" r="86" fill="url(#${p.id}g)" opacity=".25"/>
<path d="M88 112a86 86 0 0 1 52-36" stroke="#fff" stroke-width="7" fill="none" opacity=".8"/>
<path d="M226 190a86 86 0 0 1-22 34" stroke="#fff" stroke-width="5" fill="none" opacity=".45"/>`;
}

function blade(p: Pal): string {
  return `
<path d="M226 252 262 146" stroke="${INK}" stroke-width="16" stroke-linecap="round"/><path d="M226 252 262 146" stroke="#1d2a33" stroke-width="9" stroke-linecap="round"/>
<path d="M231 238 257 160" stroke="${p.cl}" stroke-width="3" stroke-dasharray="6 6" opacity=".8"/>
<ellipse cx="236" cy="226" rx="18" ry="7" transform="rotate(-70 236 226)" fill="${p.c}" ${ink(3)}/>
<path d="M28 360C34 298 84 264 150 260C216 264 266 298 272 360Z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M66 292 234 350l-8 16L58 308Z" fill="${p.c}" ${ink(4)}/>
<path d="M92 312 120 322M140 330l28 10" stroke="${p.cd}" stroke-width="4"/>
<path d="M20 334C22 286 60 258 112 256l10 46C86 306 58 324 44 352Z" fill="url(#${p.id}a)" ${ink()}/>
<path d="M30 302l62-22M36 320l58-20" stroke="${p.cl}" stroke-width="3" opacity=".6"/>
<path d="M282 330c-4-40-30-62-70-68l-6 30c28 4 50 18 62 40Z" fill="${p.suitD}" ${ink(4)}/>
<ellipse cx="150" cy="248" rx="46" ry="13" fill="#24303a" ${ink(4)}/>
<path d="M150 84c50 0 72 36 72 78 0 44-26 76-72 78-46-2-72-34-72-78 0-42 22-78 72-78Z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M150 84c50 0 72 36 72 78 0 44-26 76-72 78 26-18 40-48 40-78 0-40-14-64-40-78Z" fill="#000" opacity=".28"/>
<path d="M150 102c-32-8-52-36-46-66 10 26 28 40 46 44 18-4 36-18 46-44 6 30-14 58-46 66Z" fill="${p.c}" ${ink(4)}/>
<path d="M150 88v16" stroke="${p.cl}" stroke-width="3"/>
<path d="M90 156h120l-8 22H98z" fill="url(#${p.id}v)" ${ink()}/>
<ellipse cx="150" cy="167" rx="66" ry="14" fill="url(#${p.id}g)" opacity=".6"/>
${glint('M100 160h56l-2 4h-55z')}
<path d="M116 204h68M122 216h56M128 228h44" stroke="${p.suitD}" stroke-width="4"/>`;
}

function forge(p: Pal): string {
  const robe = shade(p.c, -0.55);
  const robeD = shade(p.c, -0.72);
  return `
<path d="${gearPath(150, 150, 118, 100, 14)}" fill="none" stroke="${p.c}" stroke-width="7" opacity=".5"/>
<path d="${gearPath(150, 150, 118, 100, 14)}" fill="none" stroke="${INK}" stroke-width="2" opacity=".5"/>
<path d="M12 360C18 290 70 254 150 250C230 254 282 290 288 360Z" fill="${robe}" ${ink()}/>
<path d="M150 250v110" stroke="${robeD}" stroke-width="10"/>
<path d="M110 280h80l-6 80h-68z" fill="#3c4454" ${ink(4)}/>
<path d="${gearPath(150, 312, 22, 16, 8)}" fill="${p.c}" ${ink(3)}/><circle cx="150" cy="312" r="7" fill="${INK}"/>
<path d="M212 268 262 216l16 14-48 52Z" fill="#4a5265" ${ink(4)}/><circle cx="268" cy="222" r="14" fill="${p.c}" ${ink(3)}/><circle cx="268" cy="222" r="5" fill="${INK}"/>
<path d="M270 206 286 180M282 214l18-10" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
<path d="M150 66c64 0 88 58 84 116-2 38-18 64-36 80H102c-18-16-34-42-36-80-4-58 20-116 84-116Z" fill="${robe}" ${ink()}/>
<path d="M150 66c64 0 88 58 84 116-2 38-18 64-36 80h-20c26-30 36-70 28-110-6-34-26-66-56-86Z" fill="#000" opacity=".3"/>
<path d="M150 106c36 0 50 26 48 60-2 34-22 58-48 62-26-4-46-28-48-62-2-34 12-60 48-60Z" fill="#3a4250" ${ink(4)}/>
<path d="M150 106c36 0 50 26 48 60-2 34-22 58-48 62 18-14 26-36 26-62 0-30-10-50-26-60Z" fill="#000" opacity=".25"/>
<circle cx="128" cy="158" r="15" fill="#1b2029" ${ink(3)}/><circle cx="128" cy="158" r="10" fill="url(#${p.id}v)"/>
<circle cx="176" cy="156" r="10" fill="#1b2029" ${ink(3)}/><circle cx="176" cy="156" r="6" fill="url(#${p.id}v)"/>
<circle cx="178" cy="180" r="5" fill="url(#${p.id}v)"/>
<circle cx="140" cy="165" r="40" fill="url(#${p.id}g)" opacity=".35"/>
<rect x="126" y="192" width="48" height="24" rx="7" fill="#222833" ${ink(3)}/>
<path d="M134 198v12M142 198v12M150 198v12M158 198v12M166 198v12" stroke="${p.c}" stroke-width="2.5" opacity=".8"/>
<path d="M132 216c-6 20-18 34-30 44M168 216c6 20 18 34 30 44" stroke="#2c3240" stroke-width="7" fill="none" stroke-linecap="round"/>`;
}

function drone(x: number, y: number, s: number, p: Pal): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">
<ellipse cx="-22" cy="-8" rx="15" ry="4" fill="#fff" opacity=".25"/><ellipse cx="22" cy="-8" rx="15" ry="4" fill="#fff" opacity=".25"/>
<path d="M-22 -8 -8 0M22 -8 8 0" stroke="${INK}" stroke-width="5"/>
<rect x="-12" y="-6" width="24" height="16" rx="6" fill="${p.c}" ${ink(3)}/>
<circle cx="0" cy="3" r="5" fill="url(#${p.id}v)" ${ink(2)}/>
<circle cx="0" cy="3" r="12" fill="url(#${p.id}g)" opacity=".5"/></g>`;
}

function hive(p: Pal): string {
  let hex = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) hex += `<path d="${polyPath(100 + c * 20 + (r % 2) * 10, 150 + r * 12, 7, 6, 0)}"/>`;
  return `
${drone(56, 92, 1, p)}${drone(250, 70, 0.8, p)}
<path d="M34 360C40 300 86 266 150 262C214 266 260 300 266 360Z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M92 282h116l-8 78h-100z" fill="${p.suitD}" ${ink(4)}/>
<path d="M104 296h92M104 312h92" stroke="${p.c}" stroke-width="5" stroke-dasharray="14 8"/>
<rect x="196" y="270" width="54" height="34" rx="8" fill="#3a4250" ${ink(4)} transform="rotate(12 223 287)"/>
<path d="M206 282l32 6" stroke="url(#${p.id}v)" stroke-width="6"/>
<ellipse cx="150" cy="250" rx="52" ry="14" fill="#3a4458" ${ink(4)}/>
<path d="M88 110 64 60M212 110l24-50" stroke="${INK}" stroke-width="5"/><circle cx="62" cy="56" r="7" fill="${p.c}" ${ink(3)}/><circle cx="238" cy="56" r="7" fill="${p.c}" ${ink(3)}/>
<path d="M150 82c54 0 76 38 76 80 0 44-28 76-76 78-48-2-76-34-76-78 0-42 22-80 76-80Z" fill="url(#${p.id}s)" ${ink()}/>
<path d="M150 82c54 0 76 38 76 80 0 44-28 76-76 78 28-18 42-48 42-78 0-40-16-66-42-80Z" fill="#000" opacity=".22"/>
<path d="M112 90c20-12 56-12 76 0l-4 12c-20-10-48-10-68 0z" fill="${p.c}" ${ink(3)}/>
<path d="M86 140c12-18 116-18 128 0l-4 48c-26 20-94 20-120 0z" fill="url(#${p.id}v)" ${ink()}/>
<g fill="none" stroke="${INK}" stroke-width="1.5" opacity=".35">${hex}</g>
${glint('M98 142c30-12 72-12 100-2l-2 7c-30-10-68-10-96 2z')}
<ellipse cx="150" cy="166" rx="60" ry="22" fill="url(#${p.id}g)" opacity=".5"/>`;
}

const BUST: Record<HeroId, (p: Pal) => string> = { condor, needle, lunatic, phantom, reactor, helios, blade, forge, hive };

const SUIT: Record<HeroId, [string, string]> = {
  condor: ['#e6ebf3', '#98a4b8'],
  needle: ['#5d6d88', '#2c3750'],
  lunatic: ['#c9cfd9', '#7d8698'],
  phantom: ['#3a3050', '#1b1528'],
  reactor: ['#aeb7c6', '#5f6a7e'],
  helios: ['#f1f5fb', '#a9b6c9'],
  blade: ['#3d4c58', '#1c2630'],
  forge: ['#5b6272', '#343a48'],
  hive: ['#d9dee8', '#8f99ad'],
};

/**
 * Cel-shaded hero bust. `bg` adds a coloured backdrop with rays (for cards); without it the SVG is transparent.
 */
export function heroPortraitSvg(id: HeroId, bg = true, par = 'xMidYMax slice'): string {
  const h = HEROES[id];
  const pid = uid('hp');
  const p: Pal = { c: h.color, cd: shade(h.color, -0.45), cl: shade(h.color, 0.35), v: h.visor, suit: SUIT[id][0], suitD: SUIT[id][1], id: pid };
  let back = '';
  if (bg) {
    let rays = '';
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      const a1 = a0 + Math.PI / 24;
      rays += `M150 160L${(150 + Math.cos(a0) * 420).toFixed(1)} ${(160 + Math.sin(a0) * 420).toFixed(1)}L${(150 + Math.cos(a1) * 420).toFixed(1)} ${(160 + Math.sin(a1) * 420).toFixed(1)}Z`;
    }
    back = `<defs><radialGradient id="${pid}b" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="${shade(h.color, -0.1)}"/><stop offset=".6" stop-color="${shade(h.color, -0.62)}"/><stop offset="1" stop-color="${shade(h.color, -0.85)}"/></radialGradient></defs>
<rect width="300" height="360" fill="url(#${pid}b)"/><path d="${rays}" fill="#fff" opacity=".06"/>
<circle cx="150" cy="160" r="120" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="18"/>`;
  }
  return `<svg viewBox="0 0 300 360" preserveAspectRatio="${par}" aria-hidden="true"><defs>${visorDefs(p)}</defs>${back}${BUST[id](p)}</svg>`;
}

// ---------------------------------------------------------------------------
// map vistas (viewBox 0 0 1600 900)

function starfield(seed: number, n: number, maxY: number): string {
  const r = rng(seed);
  let d = '';
  let big = '';
  for (let i = 0; i < n; i++) {
    const x = (r() * 1600).toFixed(0);
    const y = (r() * maxY).toFixed(0);
    const s = r();
    if (s > 0.97) big += `<path d="${starPath(+x, +y, 5 + r() * 4, 0.9, 4, 0)}" fill="#fff" opacity="${(0.5 + r() * 0.5).toFixed(2)}"/>`;
    else d += `M${x} ${y}h${(0.8 + s * 1.8).toFixed(1)}`;
  }
  return `<path d="${d}" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".75"/>${big}`;
}

function earth(cx: number, cy: number, r: number, lightAngle = -35): string {
  const g = uid('ea');
  const s = uid('es');
  const clip = uid('ec');
  const rr = rng(cx + cy);
  let clouds = '';
  for (let i = 0; i < 9; i++) {
    const x = cx - r + rr() * r * 2;
    const y = cy - r + rr() * r * 2;
    clouds += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(r * (0.2 + rr() * 0.35)).toFixed(0)}" ry="${(r * (0.05 + rr() * 0.08)).toFixed(0)}" fill="#fff" opacity="${(0.35 + rr() * 0.4).toFixed(2)}" transform="rotate(${(-20 + rr() * 40).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`;
  }
  const la = (lightAngle * Math.PI) / 180;
  return `<defs><radialGradient id="${g}" cx="${(0.5 + Math.cos(la) * 0.25).toFixed(2)}" cy="${(0.5 + Math.sin(la) * 0.25).toFixed(2)}" r=".75"><stop offset="0" stop-color="#8fd3ff"/><stop offset=".45" stop-color="#2f7cf6"/><stop offset="1" stop-color="#0a1f5c"/></radialGradient>
<radialGradient id="${s}" cx="${(0.5 - Math.cos(la) * 0.55).toFixed(2)}" cy="${(0.5 - Math.sin(la) * 0.55).toFixed(2)}" r=".85"><stop offset=".55" stop-color="#01030a" stop-opacity=".96"/><stop offset=".78" stop-color="#01030a" stop-opacity=".2"/><stop offset="1" stop-color="#01030a" stop-opacity="0"/></radialGradient>
<clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
<radialGradient id="${g}h"><stop offset=".8" stop-color="#4dd8ff" stop-opacity=".45"/><stop offset=".86" stop-color="#4dd8ff" stop-opacity=".16"/><stop offset="1" stop-color="#4dd8ff" stop-opacity="0"/></radialGradient>
<circle cx="${cx}" cy="${cy}" r="${r * 1.25}" fill="url(#${g}h)"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${g})"/>
<g clip-path="url(#${clip})"><path d="M${cx - r * 0.6} ${cy - r * 0.2}c${r * 0.3} ${-r * 0.3} ${r * 0.5} ${-r * 0.1} ${r * 0.7} ${r * 0.2}s${-r * 0.1} ${r * 0.5} ${-r * 0.4} ${r * 0.4}z" fill="#3fa36b" opacity=".75"/><path d="M${cx + r * 0.2} ${cy + r * 0.3}c${r * 0.2} ${-r * 0.1} ${r * 0.5} 0 ${r * 0.5} ${r * 0.25}s${-r * 0.3} ${r * 0.3} ${-r * 0.5} ${r * 0.1}z" fill="#5bb36e" opacity=".6"/>${clouds}
<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${s})"/></g>`;
}

function skyDefs(id: string, top: string, bottom: string): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#${id})"/>`;
}

function ridge(seed: number, baseY: number, amp: number, color: string, stroke = '', opacity = 1): string {
  const r = rng(seed);
  let d = `M0 900L0 ${baseY}`;
  let x = 0;
  while (x < 1600) {
    const w = 60 + r() * 140;
    const peak = baseY - r() * amp;
    d += `Q${(x + w / 2).toFixed(0)} ${peak.toFixed(0)} ${(x + w).toFixed(0)} ${(baseY - r() * amp * 0.3).toFixed(0)}`;
    x += w;
  }
  d += 'L1600 900Z';
  return `<path d="${d}" fill="${color}" opacity="${opacity}"${stroke ? ` stroke="${stroke}" stroke-width="2.5" stroke-opacity=".7"` : ''}/>`;
}

function sun(x: number, y: number, r: number): string {
  const g = uid('sun');
  return `<defs><radialGradient id="${g}"><stop offset="0" stop-color="#ffffff"/><stop offset=".18" stop-color="#fff6d8"/><stop offset=".4" stop-color="#ffe7a8" stop-opacity=".35"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient></defs>
<circle cx="${x}" cy="${y}" r="${r * 7}" fill="url(#${g})" opacity=".55"/><circle cx="${x}" cy="${y}" r="${r}" fill="#fffdf4"/>
<path d="M${x - r * 9} ${y}H${x + r * 9}M${x} ${y - r * 5}V${y + r * 5}" stroke="#fff" stroke-width="2" opacity=".35"/>
<circle cx="${x + r * 6}" cy="${y + r * 3.4}" r="${r * 0.5}" fill="#7ff0ff" opacity=".18"/><circle cx="${x + r * 9}" cy="${y + r * 5.2}" r="${r * 0.9}" fill="none" stroke="#7ff0ff" stroke-width="2" opacity=".15"/>`;
}

function ground(y: number, top: string, bottom: string): string {
  const g = uid('gr');
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2=".25" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect y="${y}" width="1600" height="${900 - y}" fill="url(#${g})"/><path d="M0 ${y}H1600" stroke="#c9cfdc" stroke-width="2" opacity=".35"/>`;
}

function craters(seed: number, n: number, y0: number, y1: number, fill: string): string {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = r() * 1600;
    const y = y0 + r() * (y1 - y0);
    const rx = 14 + r() * 50 * ((y - y0) / (y1 - y0) + 0.4);
    s += `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${(rx * 0.26).toFixed(0)}" fill="${fill}" opacity=".5"/><path d="M${(x - rx).toFixed(0)} ${y.toFixed(0)}a${rx.toFixed(0)} ${(rx * 0.26).toFixed(0)} 0 0 0 ${(rx * 2).toFixed(0)} 0" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/>`;
  }
  return s;
}

function pit(cx: number, cy: number, rx: number, ry: number, rings: number, seed: number, glow = true): string {
  let s = '';
  const r = rng(seed);
  for (let i = 0; i < rings; i++) {
    const k = 1 - i / rings;
    const a = rx * k;
    const b = ry * k;
    const oy = i * ry * 0.09;
    const light = 150 - i * (105 / rings);
    s += `<ellipse cx="${cx}" cy="${cy + oy}" rx="${a.toFixed(0)}" ry="${b.toFixed(0)}" fill="rgb(${(light * 0.8).toFixed(0)},${(light * 0.82).toFixed(0)},${(light * 0.92).toFixed(0)})"/><path d="M${(cx - a).toFixed(0)} ${(cy + oy).toFixed(0)}a${a.toFixed(0)} ${b.toFixed(0)} 0 0 0 ${(a * 2).toFixed(0)} 0" fill="none" stroke="rgb(${(light + 60).toFixed(0)},${(light + 62).toFixed(0)},${(light + 72).toFixed(0)})" stroke-width="3" opacity=".8"/><path d="M${(cx - a).toFixed(0)} ${(cy + oy).toFixed(0)}a${a.toFixed(0)} ${b.toFixed(0)} 0 0 1 ${(a * 2).toFixed(0)} 0" fill="none" stroke="#0a0e18" stroke-width="2" opacity=".35"/>`;
  }
  s += `<ellipse cx="${cx}" cy="${cy + rings * ry * 0.09}" rx="${(rx / rings).toFixed(0)}" ry="${(ry / rings).toFixed(0)}" fill="#0d1018"/>`;
  if (glow) {
    for (let i = 0; i < 16; i++) {
      const t = r() * Math.PI * 2;
      const k = 0.25 + r() * 0.65;
      const x = cx + Math.cos(t) * rx * k;
      const y = cy + Math.sin(t) * ry * k + ry * 0.2 * (1 - k);
      const rr = 3 + r() * 5;
      s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(rr * 3).toFixed(0)}" fill="#7ff0ff" opacity=".18"/><path d="${polyish(x, y, rr)}" fill="#bffbff"/>`;
    }
  }
  return s;
}

function polyish(x: number, y: number, r: number): string {
  return `M${x.toFixed(0)} ${(y - r * 1.4).toFixed(0)}L${(x + r).toFixed(0)} ${y.toFixed(0)}L${x.toFixed(0)} ${(y + r * 0.8).toFixed(0)}L${(x - r).toFixed(0)} ${y.toFixed(0)}Z`;
}

function lights(x: number, y: number, w: number, n: number, color: string): string {
  let s = '';
  for (let i = 0; i < n; i++) {
    const lx = x + (w / Math.max(1, n - 1)) * i;
    s += `<rect x="${lx.toFixed(0)}" y="${y}" width="10" height="5" fill="${color}"/>`;
  }
  return `<g>${s}</g><rect x="${x - 10}" y="${y - 8}" width="${w + 30}" height="20" fill="${color}" opacity=".15"/>`;
}

function outpost(x: number, y: number, s: number, color: string, flip = false): string {
  const tr = `translate(${x} ${y}) scale(${flip ? -s : s} ${s})`;
  return `<g transform="${tr}">
<rect x="-10" y="-8" width="240" height="14" fill="#1b2130"/>
<path d="M0 -8v-70h120v70z" fill="#5a6376" stroke="${INK}" stroke-width="4"/>
<path d="M60 -78v70h60v-70z" fill="#3b4254"/>
<path d="M120 -8v-44h90v44z" fill="#4a5265" stroke="${INK}" stroke-width="4"/>
<path d="M130 -52a40 40 0 0 1 70 0" fill="#687186" stroke="${INK}" stroke-width="4"/>
<path d="M20 -78l10-60M30 -138l30 6" stroke="${INK}" stroke-width="5" fill="none"/>
<circle cx="30" cy="-140" r="6" fill="${color}"/><circle cx="30" cy="-140" r="18" fill="${color}" opacity=".25"/>
${lights(12, -52, 90, 5, color)}${lights(132, -30, 60, 3, color)}
<rect x="0" y="-86" width="120" height="8" fill="${color}"/>
</g>`;
}

function truss(x0: number, y0: number, x1: number, y1: number, h: number, color = '#2a3142', lightColor = '#7ff0ff'): string {
  const n = Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) / 60));
  let d = `M${x0} ${y0}L${x1} ${y1}M${x0} ${y0 + h}L${x1} ${y1 + h}`;
  let lamps = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    d += `M${x.toFixed(0)} ${y.toFixed(0)}l0 ${h}`;
    if (i < n) {
      const xn = x0 + (x1 - x0) * ((i + 1) / n);
      const yn = y0 + (y1 - y0) * ((i + 1) / n);
      d += `M${x.toFixed(0)} ${(y + h).toFixed(0)}L${xn.toFixed(0)} ${yn.toFixed(0)}`;
    }
    if (i % 2 === 0) lamps += `<circle cx="${x.toFixed(0)}" cy="${(y - 2).toFixed(0)}" r="3" fill="${lightColor}"/><circle cx="${x.toFixed(0)}" cy="${(y - 2).toFixed(0)}" r="10" fill="${lightColor}" opacity=".22"/>`;
  }
  return `<path d="${d}" stroke="${INK}" stroke-width="9" fill="none" stroke-linecap="round"/><path d="${d}" stroke="${color}" stroke-width="4" fill="none" stroke-linecap="round"/>${lamps}`;
}

function silo(x: number, y: number, w: number, h: number): string {
  return `<g><rect x="${x}" y="${y - h}" width="${w}" height="${h}" fill="#626b7e" stroke="${INK}" stroke-width="4"/><rect x="${x + w * 0.55}" y="${y - h}" width="${w * 0.45}" height="${h}" fill="#474f62"/>
<ellipse cx="${x + w / 2}" cy="${y - h}" rx="${w / 2}" ry="${w * 0.16}" fill="#8a93a6" stroke="${INK}" stroke-width="4"/>
<path d="M${x} ${y - h * 0.35}h${w}M${x} ${y - h * 0.7}h${w}" stroke="${INK}" stroke-width="3" opacity=".5"/>
<rect x="${x + w * 0.2}" y="${y - h * 0.52}" width="${w * 0.6}" height="6" fill="#7ff0ff" opacity=".9"/></g>`;
}

function beacon(x: number, y: number, letter: string, color: string): string {
  return `<g><path d="M${x - 16} ${y}L${x} ${y - 400}L${x + 16} ${y}Z" fill="${color}" opacity=".12"/><rect x="${x - 2}" y="${y - 400}" width="4" height="400" fill="${color}" opacity=".35"/>
<path d="M${x} ${y - 70}l26 26-26 26-26-26z" fill="#0b1020" stroke="${color}" stroke-width="4"/>
<text x="${x}" y="${y - 35}" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="700" font-size="28" fill="${color}">${letter}</text></g>`;
}

function drillRig(x: number, y: number, s: number): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">
<path d="M-60 0L0 -260L60 0M-45 -65h90M-30 -130h60M-15 -195h30M-45 -65L30 -130M45 -65 -30 -130M-30 -130 15 -195M30 -130-15 -195" stroke="${INK}" stroke-width="10" fill="none"/>
<path d="M-60 0L0 -260L60 0M-45 -65h90M-30 -130h60M-15 -195h30M-45 -65L30 -130M45 -65 -30 -130M-30 -130 15 -195M30 -130-15 -195" stroke="#ffc21a" stroke-width="4" fill="none"/>
<rect x="-6" y="-250" width="12" height="260" fill="#39414f"/>
<circle cx="0" cy="-268" r="9" fill="#ff5a4d"/><circle cx="0" cy="-268" r="26" fill="#ff5a4d" opacity=".25"/>
<rect x="-80" y="-20" width="160" height="26" fill="#4a5265" stroke="${INK}" stroke-width="4"/></g>`;
}

function refinery(x: number, y: number, s: number): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">
<rect x="0" y="-160" width="70" height="160" fill="#5c6578" stroke="${INK}" stroke-width="4"/>
<rect x="70" y="-110" width="120" height="110" fill="#4a5265" stroke="${INK}" stroke-width="4"/>
<rect x="190" y="-220" width="36" height="220" fill="#6a7387" stroke="${INK}" stroke-width="4"/>
<rect x="236" y="-190" width="26" height="190" fill="#5c6578" stroke="${INK}" stroke-width="4"/>
<circle cx="130" cy="-140" r="40" fill="#39414f" stroke="${INK}" stroke-width="4"/><circle cx="130" cy="-140" r="22" fill="#7ff0ff"/><circle cx="130" cy="-140" r="60" fill="#7ff0ff" opacity=".2"/>
<path d="M70 -60h120M26 -160v-30h40M208 -220v-20" stroke="${INK}" stroke-width="6" fill="none"/>
${lights(10, -130, 50, 3, '#7ff0ff')}${lights(84, -70, 90, 5, '#ffa033')}
<path d="M208 -244c10-30 30-40 60-50" stroke="#c8d0dc" stroke-width="10" opacity=".25" fill="none"/></g>`;
}

function baseFort(x: number, y: number, s: number, color: string, flip: boolean): string {
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
<path d="M0 0v-60l30-20h260l30 20v60z" fill="#4c5467" stroke="${INK}" stroke-width="5"/>
<path d="M40 -80a70 70 0 0 1 140 0" fill="#6b7489" stroke="${INK}" stroke-width="5"/>
<path d="M200 -80v-90h40v90" fill="#5a6376" stroke="${INK}" stroke-width="5"/>
<path d="M220 -170v-60" stroke="${INK}" stroke-width="5"/><path d="M220 -230h46l-10 14 10 14h-46" fill="${color}" stroke="${INK}" stroke-width="3"/>
${lights(20, -45, 260, 12, color)}
<rect x="40" y="-86" width="140" height="6" fill="${color}"/>
<circle cx="110" cy="-120" r="8" fill="${color}"/><circle cx="110" cy="-120" r="30" fill="${color}" opacity=".2"/></g>`;
}

const MAP_ART: Record<MapId, () => string> = {
  duel: () => `
${skyDefs(uid('sk'), '#02030a', '#101b34')}
${starfield(7, 240, 470)}
${sun(230, 120, 26)}
${earth(1300, 170, 100, -40)}
${ridge(3, 450, 90, '#353b4b', '#6b7286')}
${ridge(4, 500, 50, '#4b5264', '#7e869a')}
${ground(530, '#9aa1b2', '#3e4250')}
${craters(11, 16, 560, 890, '#5e6474')}
${pit(800, 700, 640, 170, 7, 5)}
${truss(380, 600, 1220, 600, 28, '#3a4256', '#7ff0ff')}
${outpost(90, 610, 1.15, '#4dd8ff')}
${outpost(1510, 610, 1.15, '#ffa033', true)}`,
  quarry: () => `
${skyDefs(uid('sk'), '#010208', '#121c36')}
${starfield(19, 220, 360)}
${sun(1390, 100, 24)}
${earth(250, 140, 66, -20)}
${ridge(21, 380, 70, '#343a49', '#6b7286')}
${ground(400, '#a0a7b8', '#4a4f5e')}
${pit(800, 800, 1000, 400, 11, 17)}
${silo(80, 500, 84, 170)}${silo(186, 510, 74, 136)}${silo(282, 505, 62, 104)}
${refinery(1200, 500, 1.05)}
${truss(100, 560, 1500, 640, 24, '#3a4256', '#ffa033')}
${truss(240, 720, 1360, 700, 20, '#3a4256', '#7ff0ff')}`,
  front: () => `
${skyDefs(uid('sk'), '#02030b', '#152040')}
${starfield(31, 240, 480)}
${sun(1420, 90, 22)}
${earth(800, 160, 112, -60)}
${ridge(33, 500, 80, '#2f3544', '#636a7e')}
${ridge(34, 545, 40, '#454b5c', '#79819a')}
${ground(570, '#9ba2b3', '#434856')}
${craters(37, 18, 600, 880, '#60667a')}
${pit(800, 690, 280, 76, 5, 29)}
${drillRig(800, 690, 0.95)}
${baseFort(40, 700, 1.05, '#4dd8ff', false)}
${baseFort(1560, 700, 1.05, '#ffa033', true)}
${beacon(480, 690, 'A', '#7ff0ff')}${beacon(800, 600, 'B', '#7ff0ff')}${beacon(1120, 690, 'C', '#7ff0ff')}`,
};

const CARD_VIEW: Record<MapId, string> = {
  duel: '80 170 1440 730',
  quarry: '60 60 1480 790',
  front: '60 40 1480 800',
};

/** Full-bleed map illustration (16:9, slice-fitted). `card` crops to the most interesting region for tall cards. */
export function mapArtSvg(id: MapId, card = false): string {
  const f = MAP_ART[id] ?? MAP_ART.front;
  const vb = card ? CARD_VIEW[id] ?? '0 0 1600 900' : '0 0 1600 900';
  return `<svg viewBox="${vb}" preserveAspectRatio="${card ? 'xMidYMax slice' : 'xMidYMid slice'}" aria-hidden="true">${f()}</svg>`;
}

/** Background vista used behind menus in the preview harness (moon horizon + earth). */
export function menuBackdropSvg(): string {
  return `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
${skyDefs(uid('sk'), '#010207', '#0d1830')}
${starfield(77, 420, 700)}
${earth(1180, 250, 150, -50)}
${ridge(78, 640, 110, '#252a38', '#4b5164')}
${ridge(79, 700, 60, '#363c4c', '#5d6478')}
${ground(740, '#7b8193', '#3a3e4b')}
${craters(80, 12, 760, 890, '#4a4f5f')}
${outpost(980, 760, 0.8, '#ffa033')}
${truss(200, 700, 700, 735, 16, '#394155', '#4dd8ff')}
</svg>`;
}

/** Logo emblem: cratered moon with an orbit ring and a palladium crystal satellite. */
export function logoEmblemSvg(): string {
  const g = uid('lg');
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><defs>
<radialGradient id="${g}m" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#c9ced9"/><stop offset="1" stop-color="#5d6477"/></radialGradient>
<linearGradient id="${g}o" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7ff0ff" stop-opacity="0"/><stop offset=".5" stop-color="#7ff0ff"/><stop offset="1" stop-color="#7ff0ff" stop-opacity=".1"/></linearGradient>
<linearGradient id="${g}p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8ffff"/><stop offset=".5" stop-color="#7ff0ff"/><stop offset="1" stop-color="#1d8fb8"/></linearGradient></defs>
<path d="M14 72a48 16 -18 0 1 92 -30" fill="none" stroke="url(#${g}o)" stroke-width="3"/>
<circle cx="60" cy="60" r="38" fill="url(#${g}m)" stroke="${INK}" stroke-width="4"/>
<path d="M60 22a38 38 0 0 1 0 76a30 38 0 0 0 0-76z" fill="#1b2130" opacity=".35"/>
<circle cx="47" cy="48" r="8" fill="#9aa1b1" stroke="${INK}" stroke-width="2.5"/><circle cx="70" cy="70" r="11" fill="#9aa1b1" stroke="${INK}" stroke-width="2.5"/><circle cx="72" cy="42" r="4.5" fill="#9aa1b1" stroke="${INK}" stroke-width="2"/><circle cx="45" cy="76" r="4" fill="#9aa1b1" stroke="${INK}" stroke-width="2"/>
<path d="M106 42a48 16 -18 0 1 -92 30" fill="none" stroke="#7ff0ff" stroke-width="3" stroke-opacity=".9"/>
<g transform="translate(98 30)"><circle r="14" fill="#7ff0ff" opacity=".25"/><path d="M0 -10 7 -4v8L0 10-7 4v-8z" fill="url(#${g}p)" stroke="${INK}" stroke-width="2"/></g></svg>`;
}
