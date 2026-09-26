import { HEROES, type HeroId } from '../../game/Types';
import { div, h } from '../dom';
import type { MenuCtx } from './ctx';
import { portrait } from './widgets';

/**
 * Hero showcase: glowing pedestal + cel-shaded bust. When the game supplies requestHeroPreview,
 * a canvas is layered on top and handed to the game to render the 3D model.
 */
export function heroStage(ctx: MenuCtx, hero: HeroId, cls = '', usePreview = true): { el: HTMLElement; destroy(): void } {
  const el = div('mg-stage' + (cls ? ' ' + cls : ''));
  el.style.setProperty('--hc', HEROES[hero].color);
  el.style.setProperty('--hv', HEROES[hero].visor);
  const particles = div('mg-stage-motes');
  for (let i = 0; i < 14; i++) {
    const m = div('mg-mote');
    m.style.setProperty('--x', (5 + ((i * 37) % 90)).toFixed(0) + '%');
    m.style.setProperty('--d', (6 + ((i * 7) % 9)).toFixed(1) + 's');
    m.style.setProperty('--delay', (-(i * 1.3) % 9).toFixed(1) + 's');
    m.style.setProperty('--s', (0.5 + ((i * 13) % 10) / 10).toFixed(2));
    particles.appendChild(m);
  }
  el.append(div('mg-stage-glow'), div('mg-stage-ring'), div('mg-stage-ring mg-stage-ring--2'), particles, div('mg-stage-floor'));
  const art = portrait(hero, ctx.portraits, false, 'mg-stage-art', 'xMidYMax meet');
  el.appendChild(art);

  let canvas: HTMLCanvasElement | null = null;
  let ro: ResizeObserver | null = null;
  let alive = true;
  const req = usePreview ? ctx.cb.requestHeroPreview : undefined;
  if (req) {
    const c = h('canvas', { class: 'mg-stage-canvas' });
    canvas = c;
    el.appendChild(c);
    el.classList.add('has-canvas');
    const fit = () => {
      const r = c.getBoundingClientRect();
      const d = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * d));
      const hh = Math.max(1, Math.round(r.height * d));
      if (c.width !== w) c.width = w;
      if (c.height !== hh) c.height = hh;
    };
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(fit);
      ro.observe(c);
    }
    requestAnimationFrame(() => {
      if (!alive) return;
      fit();
      req(c, hero);
    });
  }
  return {
    el,
    destroy() {
      alive = false;
      ro?.disconnect();
      if (canvas && req) req(canvas, null);
    },
  };
}
