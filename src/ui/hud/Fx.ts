import { t } from '../i18n';

/**
 * Full-screen helmet-visor effects: frame, suit cracks, O₂ frost + tunnel vignette,
 * cloak / invulnerability tints, damage flash and scope overlays (rail / nuke / designator).
 * All state changes are opacity/class writes guarded by caches.
 */

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

/** jagged radiating cracks around an impact point (viewBox 1600×900) */
function crackSet(cx: number, cy: number, seed: number, arms: number, len: number): string {
  const r = rng(seed);
  let d = '';
  let ring = '';
  const branch = (x: number, y: number, a: number, l: number, depth: number) => {
    let px = x;
    let py = y;
    let seg = `M${px.toFixed(0)} ${py.toFixed(0)}`;
    const steps = 4 + Math.floor(r() * 5);
    for (let i = 0; i < steps; i++) {
      a += (r() - 0.5) * 0.7;
      const sl = (l / steps) * (0.6 + r() * 0.8);
      px += Math.cos(a) * sl;
      py += Math.sin(a) * sl;
      seg += `L${px.toFixed(0)} ${py.toFixed(0)}`;
      if (depth < 2 && r() < 0.28) branch(px, py, a + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), l * 0.45, depth + 1);
    }
    d += seg;
  };
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + r() * 0.5;
    branch(cx, cy, a, len * (0.5 + r() * 0.7), 0);
  }
  // concentric shatter ring
  const rr = len * 0.16;
  let first = true;
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const k = rr * (0.8 + r() * 0.45);
    ring += `${first ? 'M' : 'L'}${(cx + Math.cos(a) * k).toFixed(0)} ${(cy + Math.sin(a) * k).toFixed(0)}`;
    first = false;
  }
  return `<path d="${d}${ring}" class="c"/><path d="${d}${ring}" class="h"/><circle cx="${cx}" cy="${cy}" r="${(len * 0.1).toFixed(0)}" class="i"/>`;
}

const CRACK_LEVELS = [
  crackSet(260, 700, 11, 7, 330),
  crackSet(1370, 170, 23, 8, 300),
  crackSet(1330, 760, 37, 6, 260) + crackSet(170, 150, 41, 6, 240),
  crackSet(820, 300, 53, 10, 420) + crackSet(560, 830, 59, 5, 220),
];

function scopeRail(): string {
  let ticks = '';
  for (let i = -8; i <= 8; i++) {
    if (i === 0) continue;
    const L = i % 4 === 0 ? 16 : 8;
    ticks += `<path d="M${i * 22} ${-L / 2}v${L}M${-L / 2} ${i * 22}h${L}"/>`;
  }
  let nums = '';
  for (const [i, n] of [
    [2, 100],
    [4, 200],
    [6, 300],
  ] as const)
    nums += `<text x="10" y="${i * 22 + 4}">${n}</text>`;
  return `<svg viewBox="-260 -260 520 520" class="mg-scope-svg">
<circle r="250" class="lens"/><circle r="252" class="rim"/>
<g class="lines"><path d="M-250 0H-40M40 0H250M0 -250V-40M0 40V250"/><path d="M-250 0H-120M120 0H250M0 120V250" class="thick"/>${ticks}</g>
<g class="nums">${nums}</g>
<path d="M-7 10 0 2 7 10" class="chev"/>
<circle r="232" class="charge-bg"/><circle r="232" class="charge" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90)"/>
<text x="0" y="-205" class="lbl" text-anchor="middle">${t('scope.rail')}</text>
</svg>`;
}

function scopeNuke(): string {
  let drops = '';
  for (let i = 1; i <= 5; i++) drops += `<path d="M${-14 - i * 4} ${i * 34}h${28 + i * 8}"/><text x="${22 + i * 4}" y="${i * 34 + 4}">${i * 100}</text>`;
  return `<svg viewBox="-260 -260 520 520" class="mg-scope-svg">
<circle r="250" class="lens"/><circle r="252" class="rim"/>
<g class="lines"><path d="M-180 -120v-60h60M180 -120v-60h-60M-180 120v60h60M180 120v60h-60"/><path d="M-250 0H-60M60 0H250M0 -250V-60"/>${drops}</g>
<g class="trefoil" transform="translate(0 -150) scale(1.4)"><circle r="3.5"/><path d="M0 -6 5 -15A17 17 0 0 0 -5 -15ZM5.2 3 15.6 7.5A17 17 0 0 0 10.6 -1.2ZM-5.2 3-10.6-1.2A17 17 0 0 0-15.6 7.5Z"/></g>
<circle r="10" class="dot"/>
<text x="0" y="215" class="lbl" text-anchor="middle">${t('scope.nuke')}</text>
</svg>`;
}

function scopeDesignator(): string {
  return `<svg viewBox="-400 -225 800 450" class="mg-scope-svg mg-scope-svg--wide" preserveAspectRatio="xMidYMid meet">
<g class="lines"><path d="M-380 -150v-60h80M380 -150v-60h-80M-380 150v60h80M380 150v60h-80"/>
<rect x="-46" y="-46" width="92" height="92" class="box"/><path d="M-120 0h60M60 0h60M0 -120v60M0 60v60"/>
<path d="M-300 -190h140M160 -190h140" class="thin"/></g>
<text x="0" y="-78" class="lbl" text-anchor="middle">${t('scope.des')}</text><text x="0" y="-62" class="lbl lbl--sm" text-anchor="middle">${t('scope.uplink')}</text>
<text x="0" y="74" class="lbl" text-anchor="middle">${t('scope.lock')}</text>
</svg>`;
}

export class VisorFx {
  readonly el: HTMLDivElement;
  private readonly cracks: SVGGElement[] = [];
  private readonly frost: HTMLDivElement;
  private readonly tunnel: HTMLDivElement;
  private readonly cloak: HTMLDivElement;
  private readonly invuln: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly ads: HTMLDivElement;
  private readonly scopes: Record<'rail' | 'nuke' | 'designator', HTMLDivElement>;
  private railCharge: SVGCircleElement | null;
  private readonly dead: HTMLDivElement;
  private c = { crack: -1, frost: -1, tunnel: -1, cloak: false, inv: false, ads: -1, scope: '', scopeA: -1, charge: -1, suffo: false, dead: false };
  private flashA = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'mg-fx';
    const mk = (cls: string) => {
      const d = document.createElement('div');
      d.className = cls;
      this.el.appendChild(d);
      return d;
    };
    this.ads = mk('mg-fx-ads');
    this.cloak = mk('mg-fx-cloak');
    this.invuln = mk('mg-fx-invuln');
    this.frost = mk('mg-fx-frost');
    this.frost.style.backgroundImage = `url(${noiseUrl()})`;
    this.tunnel = mk('mg-fx-tunnel');
    const crackWrap = mk('mg-fx-cracks');
    crackWrap.innerHTML = `<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">${CRACK_LEVELS.map((c) => `<g style="opacity:0">${c}</g>`).join('')}</svg>`;
    crackWrap.querySelectorAll('g').forEach((g) => {
      if (g.parentElement?.tagName.toLowerCase() === 'svg') this.cracks.push(g as SVGGElement);
    });
    this.flash = mk('mg-fx-flash');
    this.dead = mk('mg-fx-dead');
    mk('mg-fx-visor');
    const rail = mk('mg-scope mg-scope--rail');
    rail.innerHTML = scopeRail();
    const nuke = mk('mg-scope mg-scope--nuke');
    nuke.innerHTML = scopeNuke();
    const des = mk('mg-scope mg-scope--designator');
    des.innerHTML = scopeDesignator();
    this.scopes = { rail, nuke, designator: des };
    this.railCharge = rail.querySelector('circle.charge');
  }

  /** re-render translated scope labels */
  relabel(): void {
    this.scopes.rail.innerHTML = scopeRail();
    this.scopes.nuke.innerHTML = scopeNuke();
    this.scopes.designator.innerHTML = scopeDesignator();
    this.railCharge = this.scopes.rail.querySelector('circle.charge');
    this.c.charge = -1;
  }

  /** red edge flash when taking damage (amount 0..1) */
  hit(amount: number): void {
    this.flashA = Math.min(1, this.flashA + 0.35 + amount);
  }

  update(dt: number, suit: number, oxygen: number, suffocating: boolean, cloaked: boolean, invulnerable: boolean, alive: boolean, ads: number, scope: string, charge: number): void {
    const c = this.c;
    // cracks by suit integrity
    const lvl = !alive ? 0 : suit >= 50 ? 0 : suit >= 35 ? 1 : suit >= 20 ? 2 : suit >= 8 ? 3 : 4;
    if (lvl !== c.crack) {
      c.crack = lvl;
      for (let i = 0; i < this.cracks.length; i++) this.cracks[i].style.opacity = i < lvl ? '1' : '0';
      this.el.classList.toggle('is-cracked', lvl > 0);
    }
    const low = alive ? Math.max(0, Math.min(1, (45 - oxygen) / 45)) : 0;
    const fq = Math.round(low * 50) / 50;
    if (fq !== c.frost) {
      c.frost = fq;
      this.frost.style.opacity = String(fq * 0.9);
      this.tunnel.style.opacity = String(Math.min(1, fq * 1.15));
    }
    if (suffocating !== c.suffo) {
      c.suffo = suffocating;
      this.tunnel.classList.toggle('is-suffocating', suffocating);
    }
    if (cloaked !== c.cloak) {
      c.cloak = cloaked;
      this.cloak.classList.toggle('is-on', cloaked);
    }
    if (invulnerable !== c.inv) {
      c.inv = invulnerable;
      this.invuln.classList.toggle('is-on', invulnerable);
    }
    if (!alive !== c.dead) {
      c.dead = !alive;
      this.dead.classList.toggle('is-on', !alive);
    }
    // scopes
    const sc = alive ? scope : 'none';
    const scopeA = sc === 'none' ? 0 : Math.round(Math.max(0, Math.min(1, (ads - 0.35) / 0.55)) * 40) / 40;
    if (sc !== c.scope) {
      for (const k of ['rail', 'nuke', 'designator'] as const) this.scopes[k].style.display = k === sc ? 'block' : 'none';
      c.scope = sc;
      c.scopeA = -1;
    }
    if (sc !== 'none' && scopeA !== c.scopeA) {
      c.scopeA = scopeA;
      const el = this.scopes[sc as 'rail' | 'nuke' | 'designator'];
      if (el) {
        el.style.opacity = String(scopeA);
        el.style.transform = `scale(${(1.08 - scopeA * 0.08).toFixed(3)})`;
      }
    }
    const adsV = sc === 'none' ? Math.round(ads * 20) / 20 : 0;
    if (adsV !== c.ads) {
      c.ads = adsV;
      this.ads.style.opacity = String(adsV * 0.8);
    }
    if (sc === 'rail' && this.railCharge) {
      const q = Math.round(charge * 100);
      if (q !== c.charge) {
        c.charge = q;
        this.railCharge.setAttribute('stroke-dasharray', `${q} 100`);
        this.scopes.rail.classList.toggle('is-full', q >= 100);
      }
    }
    // damage flash decay
    if (this.flashA > 0.001 || this.flash.style.opacity !== '0') {
      this.flashA = Math.max(0, this.flashA - dt * 2.2);
      this.flash.style.opacity = this.flashA > 0.001 ? this.flashA.toFixed(3) : '0';
    }
  }
}

let noiseCache = '';
function noiseUrl(): string {
  if (noiseCache) return noiseCache;
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(160, 160);
  const r = rng(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = r();
    const frosty = v > 0.72 ? 255 : 0;
    img.data[i] = 220;
    img.data[i + 1] = 240;
    img.data[i + 2] = 255;
    img.data[i + 3] = frosty ? Math.floor(40 + r() * 90) : 0;
  }
  g.putImageData(img, 0, 0);
  try {
    noiseCache = c.toDataURL('image/png');
  } catch {
    noiseCache = '';
  }
  return noiseCache;
}
