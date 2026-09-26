import { HEROES, levelFromXp, type HeroId, type Profile, type Role } from '../../game/Types';
import { heroPortraitSvg } from '../art';
import { h, div, span, ico, type Child } from '../dom';
import { getLang, heroName, t } from '../i18n';
import { levelBadgeSvg, ROLE_COLOR, ROLE_ICON, UI } from '../icons';
import { rankInfo } from '../Storage';

export type Snd = 'click' | 'hover' | 'back' | 'confirm' | 'error';

export interface BtnOpts {
  kind?: 'primary' | 'ghost' | 'danger' | 'accent' | 'plain';
  icon?: string;
  sub?: string;
  snd?: Snd;
  cls?: string;
  disabled?: boolean;
  title?: string;
  big?: boolean;
  kbd?: string;
}

export function btn(label: Child, onClick: (e: MouseEvent) => void, o: BtnOpts = {}): HTMLButtonElement {
  const b = h(
    'button',
    {
      class: `mg-btn mg-btn--${o.kind ?? 'ghost'}${o.big ? ' mg-btn--big' : ''}${o.cls ? ' ' + o.cls : ''}`,
      type: 'button',
      'data-snd': o.snd ?? (o.kind === 'primary' ? 'confirm' : 'click'),
      title: o.title,
      disabled: o.disabled,
    },
    o.icon ? ico(o.icon, 'mg-btn-ico') : null,
    span('mg-btn-txt', span('mg-btn-label', label), o.sub ? span('mg-btn-sub', o.sub) : null),
    o.kbd ? kbd(o.kbd) : null,
  );
  b.addEventListener('click', (e) => {
    if (b.disabled) return;
    onClick(e);
  });
  return b;
}

export function kbd(text: string, cls = ''): HTMLElement {
  return h('kbd', { class: 'mg-kbd' + (cls ? ' ' + cls : '') }, text);
}

export function iconBtn(icon: string, onClick: () => void, title = '', cls = ''): HTMLButtonElement {
  const b = h('button', { class: 'mg-ibtn' + (cls ? ' ' + cls : ''), type: 'button', title, 'aria-label': title, 'data-snd': 'click' }, ico(icon));
  b.addEventListener('click', onClick);
  return b;
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: string;
}

export function tabs<T extends string>(items: TabItem<T>[], active: T, onSelect: (id: T) => void, cls = ''): HTMLElement {
  const wrap = div('mg-tabs' + (cls ? ' ' + cls : ''));
  wrap.setAttribute('role', 'tablist');
  for (const it of items) {
    const b = h(
      'button',
      { class: 'mg-tab' + (it.id === active ? ' is-active' : ''), type: 'button', role: 'tab', 'aria-selected': it.id === active ? 'true' : 'false', 'data-snd': 'click' },
      it.icon ? ico(it.icon) : null,
      span('', it.label),
    );
    b.addEventListener('click', () => {
      if (it.id === active) return;
      onSelect(it.id);
    });
    wrap.appendChild(b);
  }
  return wrap;
}

export function segmented<T extends string>(opts: { id: T; label: string; icon?: string }[], value: T, onChange: (v: T) => void, cls = ''): HTMLElement {
  const wrap = div('mg-seg' + (cls ? ' ' + cls : ''));
  const buttons: HTMLButtonElement[] = [];
  for (const o of opts) {
    const b = h('button', { class: 'mg-seg-opt' + (o.id === value ? ' is-on' : ''), type: 'button', 'data-snd': 'click' }, o.icon ? ico(o.icon) : null, o.label ? span('', o.label) : null);
    b.addEventListener('click', () => {
      for (const x of buttons) x.classList.toggle('is-on', x === b);
      onChange(o.id);
    });
    buttons.push(b);
    wrap.appendChild(b);
  }
  return wrap;
}

/** OW-style arrow selector ‹ value › */
export function arrowSelect<T extends string>(opts: { id: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  let i = Math.max(0, opts.findIndex((o) => o.id === value));
  const label = span('mg-asel-val', opts[i]?.label ?? '');
  const pips = div('mg-asel-pips', ...opts.map((_, k) => span(k === i ? 'on' : '')));
  const set = (k: number) => {
    i = (k + opts.length) % opts.length;
    label.textContent = opts[i].label;
    Array.from(pips.children).forEach((p, k2) => p.classList.toggle('on', k2 === i));
    onChange(opts[i].id);
  };
  const l = h('button', { class: 'mg-asel-arrow', type: 'button', 'data-snd': 'click', 'aria-label': '<' }, ico(UI.chevL));
  const r = h('button', { class: 'mg-asel-arrow', type: 'button', 'data-snd': 'click', 'aria-label': '>' }, ico(UI.chevR));
  l.addEventListener('click', () => set(i - 1));
  r.addEventListener('click', () => set(i + 1));
  return div('mg-asel', l, div('mg-asel-mid', label, pips), r);
}

export function toggle(value: boolean, onChange: (v: boolean) => void): HTMLElement {
  let v = value;
  const txt = span('mg-tgl-txt', v ? t('common.on') : t('common.off'));
  const b = h('button', { class: 'mg-tgl' + (v ? ' is-on' : ''), type: 'button', role: 'switch', 'aria-checked': v ? 'true' : 'false', 'data-snd': 'click' }, span('mg-tgl-track', span('mg-tgl-knob')), txt);
  b.addEventListener('click', () => {
    v = !v;
    b.classList.toggle('is-on', v);
    b.setAttribute('aria-checked', v ? 'true' : 'false');
    txt.textContent = v ? t('common.on') : t('common.off');
    onChange(v);
  });
  return b;
}

export interface SliderOpts {
  min: number;
  max: number;
  step: number;
  value: number;
  fmt?: (v: number) => string;
  onInput: (v: number) => void;
  /** called when the user releases (for persisting); defaults to onInput */
  onCommit?: (v: number) => void;
}

export function slider(o: SliderOpts): HTMLElement {
  const fmt = o.fmt ?? ((v: number) => String(v));
  const input = h('input', { class: 'mg-range', type: 'range', min: o.min, max: o.max, step: o.step, value: o.value }) as HTMLInputElement;
  const out = span('mg-range-val', fmt(o.value));
  const wrap = div('mg-slider', input, out);
  const paint = () => {
    const k = (Number(input.value) - o.min) / (o.max - o.min);
    wrap.style.setProperty('--k', String(Math.max(0, Math.min(1, k))));
  };
  paint();
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    paint();
    o.onInput(v);
  });
  input.addEventListener('change', () => (o.onCommit ?? o.onInput)(Number(input.value)));
  return wrap;
}

export function stars(n: number, max = 3): HTMLElement {
  const w = span('mg-stars');
  for (let i = 0; i < max; i++) w.appendChild(ico(i < n ? UI.star : UI.starO, i < n ? 'on' : ''));
  return w;
}

export function roleTag(role: Role): HTMLElement {
  const el = span('mg-role mg-role--' + role, ico(ROLE_ICON[role]), span('', t('role.' + role)));
  el.style.color = ROLE_COLOR[role];
  return el;
}

export function levelBadge(level: number, cls = ''): HTMLElement {
  const r = rankInfo(level, getLang());
  const el = span('mg-lvl mg-tier--' + r.tier + (cls ? ' ' + cls : ''));
  el.innerHTML = levelBadgeSvg(level, r.tier, ((r.index - 1) % 3) + 1);
  el.title = r.title;
  return el;
}

export function xpBar(into: number, need: number, cls = ''): HTMLElement {
  const k = need > 0 ? Math.min(1, into / need) : 0;
  const fill = div('mg-xpbar-fill');
  fill.style.transform = `scaleX(${k})`;
  return div('mg-xpbar' + (cls ? ' ' + cls : ''), fill, div('mg-xpbar-ticks'));
}

/** hero portrait element: provided data-URL image, else cel-shaded SVG bust */
export function portrait(hero: HeroId, portraits: Partial<Record<HeroId, string>>, bg = true, cls = '', par = 'xMidYMax slice'): HTMLElement {
  const wrap = div('mg-portrait' + (cls ? ' ' + cls : ''));
  wrap.style.setProperty('--hc', HEROES[hero].color);
  const url = portraits[hero];
  if (url) wrap.appendChild(h('img', { src: url, alt: heroName(hero), draggable: 'false' }));
  else wrap.innerHTML = heroPortraitSvg(hero, bg, par);
  return wrap;
}

export function header(title: string, onBack: () => void, right?: Child): HTMLElement {
  const back = h('button', { class: 'mg-back', type: 'button', 'data-snd': 'back', 'aria-label': t('common.back') }, ico(UI.back), kbd('Esc'));
  back.addEventListener('click', onBack);
  return h('header', { class: 'mg-head' }, back, h('h1', { class: 'mg-title' }, title), right ? div('mg-head-right', right) : null);
}

export function statTile(label: string, value: string, icon?: string, cls = ''): HTMLElement {
  return div('mg-stat' + (cls ? ' ' + cls : ''), icon ? ico(icon, 'mg-stat-ico') : null, div('mg-stat-val', value), div('mg-stat-lbl', label));
}

export function playerLevel(p: Profile): { level: number; into: number; need: number } {
  return levelFromXp(p.xp);
}

export function sectionTitle(text: string, icon?: string): HTMLElement {
  return h('h3', { class: 'mg-sec' }, icon ? ico(icon) : null, span('', text));
}
