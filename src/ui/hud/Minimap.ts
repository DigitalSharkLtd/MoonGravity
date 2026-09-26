import type { Blip, MapId } from '../../game/Types';

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MinimapColors {
  ally: string;
  enemy: string;
  team0: string;
  team1: string;
}

const TAU = Math.PI * 2;

/**
 * Circular canvas minimap. World x/z in metres; heading 0 = −Z (north), clockwise.
 * draw() allocates nothing per call (reuses the canvas context, no closures / arrays).
 */
export class Minimap {
  readonly el: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private image: HTMLCanvasElement | null = null;
  private bounds: MapBounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  private mapId: MapId | null = null;
  private size = 220;
  private dpr = 1;
  /** metres from centre to rim */
  viewRadius = 70;
  private t = 0;
  colors: MinimapColors = { ally: '#4dd8ff', enemy: '#ff5a4d', team0: '#4dd8ff', team1: '#ffa033' };
  private readonly northEl: HTMLDivElement;
  private cone: CanvasGradient | null = null;
  private cpFont = '700 11px Oswald, sans-serif';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'mg-minimap';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mg-minimap-canvas';
    this.el.appendChild(this.canvas);
    const ring = document.createElement('div');
    ring.className = 'mg-minimap-rim';
    this.el.appendChild(ring);
    this.northEl = document.createElement('div');
    this.northEl.className = 'mg-minimap-north';
    this.northEl.textContent = 'N';
    this.el.appendChild(this.northEl);
    this.g = this.canvas.getContext('2d')!;
    this.resize(220);
  }

  setNorthLabel(s: string): void {
    this.northEl.textContent = s;
  }

  /** cssSize: layout size; pixelScale: extra scale applied by CSS transforms (HUD scale) for crisp pixels */
  resize(cssSize: number, pixelScale = 1): void {
    const dpr = Math.min(3, Math.max(0.5, (window.devicePixelRatio || 1) * pixelScale));
    if (cssSize === this.size && Math.abs(dpr - this.dpr) < 0.01 && this.cone) return;
    this.size = cssSize;
    this.dpr = dpr;
    this.cpFont = `700 ${Math.round(11 * dpr)}px Oswald, sans-serif`;
    this.canvas.width = Math.round(cssSize * this.dpr);
    this.canvas.height = Math.round(cssSize * this.dpr);
    this.canvas.style.width = cssSize + 'px';
    this.canvas.style.height = cssSize + 'px';
    const R = (cssSize * this.dpr) / 2;
    this.cone = this.g.createRadialGradient(R, R, 0, R, R, R * 0.9);
    this.cone.addColorStop(0, 'rgba(127,240,255,0.22)');
    this.cone.addColorStop(1, 'rgba(127,240,255,0)');
  }

  setMap(mapId: MapId, image: HTMLCanvasElement | null, bounds: MapBounds): void {
    this.mapId = mapId;
    this.image = image;
    this.bounds = bounds;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
    this.viewRadius = Math.max(40, Math.min(110, span * 0.22));
  }

  get map(): MapId | null {
    return this.mapId;
  }

  draw(px: number, pz: number, heading: number, rotate: boolean, blips: Blip[], dt: number): void {
    this.t += dt;
    const g = this.g;
    const S = this.size * this.dpr;
    const R = S / 2;
    const scale = (R * 0.94) / this.viewRadius; // px per metre
    const rot = rotate ? -heading : 0;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 1, 0, TAU);
    g.clip();
    g.fillStyle = 'rgba(8,14,28,0.78)';
    g.fillRect(0, 0, S, S);

    // map image
    g.save();
    g.translate(R, R);
    g.rotate(rot);
    g.scale(scale, scale);
    g.translate(-px, -pz);
    const b = this.bounds;
    if (this.image) {
      g.globalAlpha = 0.9;
      g.drawImage(this.image, b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
      g.globalAlpha = 1;
    } else {
      // grid fallback
      g.strokeStyle = 'rgba(127,240,255,0.10)';
      g.lineWidth = 1 / scale;
      const step = 20;
      const x0 = Math.floor((px - this.viewRadius * 1.5) / step) * step;
      const z0 = Math.floor((pz - this.viewRadius * 1.5) / step) * step;
      g.beginPath();
      for (let x = x0; x < px + this.viewRadius * 1.5; x += step) {
        g.moveTo(x, pz - this.viewRadius * 1.5);
        g.lineTo(x, pz + this.viewRadius * 1.5);
      }
      for (let z = z0; z < pz + this.viewRadius * 1.5; z += step) {
        g.moveTo(px - this.viewRadius * 1.5, z);
        g.lineTo(px + this.viewRadius * 1.5, z);
      }
      g.stroke();
    }
    // map border
    g.strokeStyle = 'rgba(255,90,77,0.55)';
    g.lineWidth = 2 / scale;
    g.setLineDash([6 / scale, 4 / scale]);
    g.strokeRect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    g.setLineDash([]);
    g.restore();

    // range rings + view cone
    g.strokeStyle = 'rgba(127,240,255,0.10)';
    g.lineWidth = this.dpr;
    g.beginPath();
    g.arc(R, R, R * 0.5, 0, TAU);
    g.stroke();
    const fwd = rotate ? -Math.PI / 2 : heading - Math.PI / 2;
    g.fillStyle = this.cone ?? 'rgba(127,240,255,0.12)';
    g.beginPath();
    g.moveTo(R, R);
    g.arc(R, R, R * 0.9, fwd - 0.55, fwd + 0.55);
    g.closePath();
    g.fill();

    // blips
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
    for (let i = 0; i < blips.length; i++) {
      const bl = blips[i];
      if (bl.kind === 'self') continue;
      const dx = bl.x - px;
      const dz = bl.z - pz;
      let sx = (dx * cr - dz * sr) * scale;
      let sy = (dx * sr + dz * cr) * scale;
      const d = Math.hypot(sx, sy);
      const edge = R * 0.9;
      const clampable = bl.kind === 'cp' || bl.kind === 'pod' || bl.kind === 'objective' || bl.kind === 'nuke' || bl.kind === 'beacon';
      let out = false;
      if (d > edge) {
        if (!clampable) continue;
        sx = (sx / d) * edge;
        sy = (sy / d) * edge;
        out = true;
      }
      const x = R + sx;
      const y = R + sy;
      const k = this.dpr;
      g.globalAlpha = out ? 0.75 : 1;
      switch (bl.kind) {
        case 'ally':
          this.arrow(x, y, bl.rot !== undefined ? bl.rot + rot : null, 6 * k, this.teamColor(bl.team, true));
          break;
        case 'enemy':
          this.arrow(x, y, bl.rot !== undefined ? bl.rot + rot : null, 6 * k, this.teamColor(bl.team, false));
          break;
        case 'spotted':
          g.strokeStyle = this.colors.enemy;
          g.lineWidth = 1.5 * k;
          g.beginPath();
          g.arc(x, y, (7 + pulse * 5) * k, 0, TAU);
          g.globalAlpha = 1 - pulse * 0.7;
          g.stroke();
          g.globalAlpha = 1;
          this.diamond(x, y, 5 * k, this.colors.enemy, '#200');
          break;
        case 'cp':
          this.diamond(x, y, 10 * k, bl.team === 0 ? this.colors.team0 : bl.team === 1 ? this.colors.team1 : '#dfe7f3', '#0b1020');
          if (bl.label) {
            g.fillStyle = '#0b1020';
            g.font = this.cpFont;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(bl.label, x, y + 0.5 * k);
          }
          break;
        case 'pod':
          g.fillStyle = '#ffd166';
          g.strokeStyle = '#1a0f00';
          g.lineWidth = 1.5 * k;
          g.beginPath();
          g.rect(x - 6 * k, y - 6 * k, 12 * k, 12 * k);
          g.fill();
          g.stroke();
          g.fillStyle = '#1a0f00';
          g.fillRect(x - 1 * k, y - 4 * k, 2 * k, 8 * k);
          g.fillRect(x - 4 * k, y - 1 * k, 8 * k, 2 * k);
          break;
        case 'pickup':
          g.fillStyle = '#7ff0ff';
          g.beginPath();
          g.arc(x, y, 3.5 * k, 0, TAU);
          g.fill();
          break;
        case 'nuke':
          g.strokeStyle = '#ff3b3b';
          g.lineWidth = 2 * k;
          g.beginPath();
          g.arc(x, y, (10 + pulse * 8) * k, 0, TAU);
          g.stroke();
          g.fillStyle = '#ffe14d';
          g.beginPath();
          g.arc(x, y, 5 * k, 0, TAU);
          g.fill();
          g.fillStyle = '#200';
          for (let j = 0; j < 3; j++) {
            const a = -Math.PI / 2 + (j * TAU) / 3;
            g.beginPath();
            g.moveTo(x, y);
            g.arc(x, y, 4.5 * k, a - 0.45, a + 0.45);
            g.closePath();
            g.fill();
          }
          break;
        case 'sensor':
          g.strokeStyle = 'rgba(127,240,255,0.7)';
          g.lineWidth = 1.2 * k;
          g.beginPath();
          g.arc(x, y, (4 + ((this.t * 14) % 14)) * k, 0, TAU);
          g.stroke();
          g.fillStyle = '#7ff0ff';
          g.beginPath();
          g.arc(x, y, 3 * k, 0, TAU);
          g.fill();
          break;
        case 'beacon':
          g.fillStyle = '#7ff0ff';
          g.beginPath();
          g.moveTo(x, y - 6 * k);
          g.lineTo(x + 5 * k, y + 4 * k);
          g.lineTo(x - 5 * k, y + 4 * k);
          g.closePath();
          g.fill();
          break;
        case 'objective':
          this.diamond(x, y, 8 * k, '#ffd166', '#1a0f00');
          break;
      }
      if (bl.height !== undefined && (bl.kind === 'ally' || bl.kind === 'enemy' || bl.kind === 'spotted') && Math.abs(bl.height) > 4) {
        g.fillStyle = '#fff';
        g.beginPath();
        const up = bl.height > 0;
        const yy = y + (up ? -10 : 10) * k;
        g.moveTo(x - 3 * k, yy + (up ? 2 : -2) * k);
        g.lineTo(x + 3 * k, yy + (up ? 2 : -2) * k);
        g.lineTo(x, yy + (up ? -2 : 2) * k);
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
    }

    // self arrow
    this.selfArrow(R, R, rotate ? 0 : heading, 8 * this.dpr);
    g.restore();

    // north marker on the rim
    const nAng = rot - Math.PI / 2;
    const nr = this.size / 2 - 1;
    const nx = this.size / 2 + Math.cos(nAng) * nr;
    const ny = this.size / 2 + Math.sin(nAng) * nr;
    this.northEl.style.transform = `translate(${nx.toFixed(1)}px, ${ny.toFixed(1)}px) translate(-50%, -50%)`;
  }

  private teamColor(team: number | undefined, ally: boolean): string {
    if (team === 0) return this.colors.team0;
    if (team === 1) return this.colors.team1;
    return ally ? this.colors.ally : this.colors.enemy;
  }

  private arrow(x: number, y: number, rot: number | null, r: number, color: string): void {
    const g = this.g;
    g.fillStyle = color;
    g.strokeStyle = '#05070e';
    g.lineWidth = 1.5 * this.dpr;
    if (rot === null) {
      g.beginPath();
      g.arc(x, y, r * 0.75, 0, TAU);
      g.fill();
      g.stroke();
      return;
    }
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.beginPath();
    g.moveTo(0, -r * 1.2);
    g.lineTo(r * 0.85, r * 0.9);
    g.lineTo(0, r * 0.45);
    g.lineTo(-r * 0.85, r * 0.9);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  private selfArrow(x: number, y: number, rot: number, r: number): void {
    const g = this.g;
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.shadowColor = 'rgba(127,240,255,0.9)';
    g.shadowBlur = 8 * this.dpr;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -r * 1.25);
    g.lineTo(r * 0.9, r);
    g.lineTo(0, r * 0.45);
    g.lineTo(-r * 0.9, r);
    g.closePath();
    g.fill();
    g.restore();
  }

  private diamond(x: number, y: number, r: number, fill: string, stroke: string): void {
    const g = this.g;
    g.fillStyle = fill;
    g.strokeStyle = stroke;
    g.lineWidth = 1.5 * this.dpr;
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

/** Horizontal compass tape. Built once; update() moves one transform. */
export class Compass {
  readonly el: HTMLDivElement;
  private readonly tape: HTMLDivElement;
  private readonly deg: HTMLDivElement;
  private readonly pxPerDeg = 3.2;
  private last = NaN;

  constructor(labels: string[]) {
    this.el = document.createElement('div');
    this.el.className = 'mg-compass';
    this.tape = document.createElement('div');
    this.tape.className = 'mg-compass-tape';
    this.el.appendChild(this.tape);
    const c = document.createElement('div');
    c.className = 'mg-compass-caret';
    this.el.appendChild(c);
    this.deg = document.createElement('div');
    this.deg.className = 'mg-compass-deg';
    this.el.appendChild(this.deg);
    this.setLabels(labels);
  }

  /** labels: 8 cardinal names starting at north, clockwise */
  setLabels(labels: string[]): void {
    this.tape.textContent = '';
    for (let rep = -1; rep <= 1; rep++) {
      for (let d = 0; d < 360; d += 15) {
        const tick = document.createElement('span');
        const x = (rep * 360 + d) * this.pxPerDeg;
        const major = d % 45 === 0;
        tick.className = 'mg-compass-t' + (major ? ' is-major' : '') + (d === 0 ? ' is-n' : '');
        tick.style.left = x + 'px';
        tick.textContent = major ? labels[d / 45] : String(d);
        this.tape.appendChild(tick);
      }
    }
    this.last = NaN;
  }

  update(heading: number): void {
    let d = ((heading * 180) / Math.PI) % 360;
    if (d < 0) d += 360;
    const q = Math.round(d * 2) / 2;
    if (q === this.last) return;
    this.last = q;
    this.tape.style.transform = `translateX(${(-q * this.pxPerDeg).toFixed(1)}px)`;
    this.deg.textContent = String(Math.round(q) % 360);
  }
}
