import type { CrosshairSettings } from '../../game/Types';

/**
 * Dynamic crosshair (cross / dot / circle / chevron). DOM is built once; setGap() only writes
 * transforms when the quantised gap changes, so it is safe to call every frame.
 */
export class Crosshair {
  readonly el: HTMLDivElement;
  private readonly arms: HTMLElement[] = [];
  private readonly ring: SVGCircleElement;
  private readonly chev: SVGSVGElement;
  private style: CrosshairSettings['style'] = 'cross';
  private size = 1;
  private gap = -1;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'mg-ch';
    for (const k of ['t', 'b', 'l', 'r']) {
      const a = document.createElement('i');
      a.className = 'mg-ch-arm mg-ch-' + k;
      this.el.appendChild(a);
      this.arms.push(a);
    }
    const dot = document.createElement('i');
    dot.className = 'mg-ch-dot';
    this.el.appendChild(dot);
    const NS = 'http://www.w3.org/2000/svg';
    const ringSvg = document.createElementNS(NS, 'svg');
    ringSvg.setAttribute('class', 'mg-ch-ring');
    ringSvg.setAttribute('viewBox', '-50 -50 100 100');
    this.ring = document.createElementNS(NS, 'circle');
    this.ring.setAttribute('r', '14');
    ringSvg.appendChild(this.ring);
    this.el.appendChild(ringSvg);
    this.chev = document.createElementNS(NS, 'svg');
    this.chev.setAttribute('class', 'mg-ch-chev');
    this.chev.setAttribute('viewBox', '-12 -12 24 24');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M-8 6 0 -2 8 6');
    this.chev.appendChild(p);
    this.el.appendChild(this.chev);
  }

  configure(cs: CrosshairSettings): void {
    this.style = cs.style;
    this.size = cs.size;
    this.el.setAttribute('data-style', cs.style);
    this.el.style.setProperty('--ch-color', cs.color);
    this.el.style.setProperty('--ch-op', String(cs.opacity));
    this.el.style.setProperty('--ch-size', String(cs.size));
    const g = this.gap;
    this.gap = -1;
    this.setGap(g < 0 ? 6 : g);
  }

  /** gap in CSS px (already scaled for the viewport) */
  setGap(px: number): void {
    const g = Math.round(Math.max(0, px) * 2) / 2;
    if (g === this.gap) return;
    this.gap = g;
    const s = this.size;
    if (this.style === 'cross') {
      const off = g + 1 * s;
      this.arms[0].style.transform = `translate(-50%, calc(-100% - ${off}px))`;
      this.arms[1].style.transform = `translate(-50%, ${off}px)`;
      this.arms[2].style.transform = `translate(calc(-100% - ${off}px), -50%)`;
      this.arms[3].style.transform = `translate(${off}px, -50%)`;
    } else if (this.style === 'circle') {
      this.ring.setAttribute('r', (12 + g * 0.8).toFixed(1));
    } else if (this.style === 'chevron') {
      this.chev.style.transform = `translate(-50%, calc(-10% + ${(g * 0.6).toFixed(1)}px))`;
    }
  }
}

/** small static SVG preview of a crosshair style (for the settings picker) */
export function crosshairStyleIcon(style: CrosshairSettings['style']): string {
  const body =
    style === 'cross'
      ? '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>'
      : style === 'dot'
        ? '<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>'
        : style === 'circle'
          ? '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>'
          : '<path d="M5.5 16 12 9.5l6.5 6.5"/><circle cx="12" cy="6" r="1.3" fill="currentColor" stroke="none"/>';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
