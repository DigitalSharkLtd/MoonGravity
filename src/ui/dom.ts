/** Tiny DOM helpers for the UI layer (no framework). */

export type Child = Node | string | number | null | undefined | false | Child[];
export type Attrs = Record<string, unknown>;

function append(parent: Node, c: Child): void {
  if (c === null || c === undefined || c === false) return;
  if (Array.isArray(c)) {
    for (const x of c) append(parent, x);
    return;
  }
  parent.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
}

/**
 * h('div', { class: 'x', onclick: fn, 'data-id': 3, html: '<svg…>' }, child, …)
 * Special keys: class, style (string), html (innerHTML), text, on* (listeners), dataset via data-*.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) append(el, c);
  return el;
}

/** div shortcut with class */
export function div(cls: string, ...children: Child[]): HTMLDivElement {
  return h('div', { class: cls }, ...children);
}

export function span(cls: string, ...children: Child[]): HTMLSpanElement {
  return h('span', { class: cls }, ...children);
}

const tpl = typeof document !== 'undefined' ? document.createElement('template') : null;

/** Parse an HTML/SVG string into a single element. */
export function frag(html: string): Element {
  tpl!.innerHTML = html.trim();
  return tpl!.content.firstElementChild as Element;
}

/** span containing an svg string (icon) */
export function ico(svg: string, cls = ''): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'mg-ico' + (cls ? ' ' + cls : '');
  s.innerHTML = svg;
  return s;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

export function fmtDuration(sec: number, lang: 'ru' | 'en'): string {
  const s = Math.max(0, Math.round(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  if (hh > 0) return lang === 'ru' ? `${hh} ч ${mm} мин` : `${hh}h ${mm}m`;
  if (mm > 0) return lang === 'ru' ? `${mm} мин` : `${mm}m`;
  return lang === 'ru' ? `${s} с` : `${s}s`;
}

export function fmtNum(n: number): string {
  const v = Math.round(n);
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function ratio(a: number, b: number): string {
  if (b <= 0) return a.toFixed(2);
  return (a / b).toFixed(2);
}

export function pct(a: number, b: number): string {
  if (b <= 0) return '0%';
  return Math.round((a / b) * 100) + '%';
}

/**
 * Cached text/style writers for per-frame HUD updates: they only touch the DOM when the value changed.
 */
export class TextSlot {
  private v: string | number | null = null;
  private nv = NaN;
  private np: string | null = null;
  private ns: string | null = null;
  constructor(readonly el: HTMLElement | SVGElement) {}
  set(v: string | number): void {
    this.nv = NaN;
    if (v === this.v) return;
    this.v = v;
    this.el.textContent = typeof v === 'number' ? String(v) : v;
  }
  /** number with constant prefix/suffix; formats (allocates) only when the value changes */
  num(v: number, prefix = '', suffix = '', digits = 0): void {
    if (v === this.nv && prefix === this.np && suffix === this.ns) return;
    this.nv = v;
    this.np = prefix;
    this.ns = suffix;
    this.v = null;
    this.el.textContent = prefix + (digits > 0 ? v.toFixed(digits) : String(v)) + suffix;
  }
  /** m:ss countdown, updates once per second */
  time(sec: number): void {
    const s = Math.max(0, Math.ceil(sec));
    if (s === this.nv && this.np === ':') return;
    this.nv = s;
    this.np = ':';
    this.ns = null;
    this.v = null;
    const m = Math.floor(s / 60);
    const r = s % 60;
    this.el.textContent = m + (r < 10 ? ':0' : ':') + r;
  }
}

export class ClassSlot {
  private on: boolean | null = null;
  constructor(readonly el: Element, readonly cls: string) {}
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle(this.cls, on);
  }
}

/** writes a transform string built from a quantised number */
export class NumStyleSlot {
  private v = NaN;
  constructor(
    readonly el: HTMLElement | SVGElement,
    readonly write: (el: HTMLElement | SVGElement, v: number) => void,
    readonly quantum = 0.001,
  ) {}
  set(v: number): void {
    const q = Math.round(v / this.quantum) * this.quantum;
    if (q === this.v) return;
    this.v = q;
    this.write(this.el, q);
  }
}

export const scaleX = (el: HTMLElement | SVGElement, v: number) => {
  (el as HTMLElement).style.transform = 'scaleX(' + v + ')';
};
export const opacityW = (el: HTMLElement | SVGElement, v: number) => {
  (el as HTMLElement).style.opacity = String(v);
};

export function show(el: HTMLElement, v: boolean): void {
  const d = v ? '' : 'none';
  if (el.style.display !== d) el.style.display = d;
}
