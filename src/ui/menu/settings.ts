import { DEFAULT_KEYS, DEFAULT_SETTINGS, type Action, type Settings } from '../../game/Types';
import { enterFullscreen, exitFullscreen } from '../fullscreen';
import { mapArtSvg } from '../art';
import { div, h, ico, span } from '../dom';
import { actionName, botName, keyLabel, t } from '../i18n';
import { UI } from '../icons';
import { Crosshair, crosshairStyleIcon } from '../hud/Crosshair';
import { qualityPreset } from '../Storage';
import type { MenuCtx, ScreenInst, SettingsTab } from './ctx';
import { btn, header, segmented, slider, tabs, toggle } from './widgets';

const TAB_ICON: Record<SettingsTab, string> = {
  graphics: UI.monitor,
  audio: UI.volume,
  controls: UI.keyboard,
  game: UI.sliders,
  crosshair: UI.crosshair,
};

const KEY_GROUPS_BASE: { title: string; actions: Action[] }[] = [
  { title: 'settings.group.move', actions: ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch', 'prone', 'roll', 'mag', 'grapple'] },
  { title: 'settings.group.combat', actions: ['fire', 'aim', 'reload', 'melee', 'weapon1', 'weapon2', 'ability1', 'ability2', 'ultimate', 'sealant'] },
  { title: 'settings.group.other', actions: ['interact', 'ping', 'view', 'scoreboard', 'map', 'chat'] },
];

/** every Action from DEFAULT_KEYS is listed; unknown/new actions fall into "other" */
function keyGroups(): { title: string; actions: Action[] }[] {
  const all = Object.keys(DEFAULT_KEYS) as Action[];
  const known = new Set<Action>();
  const groups = KEY_GROUPS_BASE.map((g) => {
    const actions = g.actions.filter((a) => all.includes(a));
    actions.forEach((a) => known.add(a));
    return { title: g.title, actions };
  });
  const rest = all.filter((a) => !known.has(a));
  if (rest.length) groups[groups.length - 1].actions.push(...rest);
  return groups;
}

type Perf = 'heavy' | 'medium' | 'light';

const SWATCHES = ['#7ff0ff', '#ffffff', '#5fe36a', '#ffe14d', '#ff4dd2', '#ff4d5e', '#ffa033', '#4d8bff'];

const pctFmt = (v: number) => Math.round(v * 100) + '%';

export function buildSettings(ctx: MenuCtx): ScreenInst {
  const st = ctx.state;
  const el = div('mg-page mg-settings');
  const tabBar = tabs<SettingsTab>(
    (['graphics', 'audio', 'controls', 'game', 'crosshair'] as SettingsTab[]).map((id) => ({ id, label: t('settings.tab.' + id), icon: TAB_ICON[id] })),
    st.settingsTab,
    (id) => {
      st.settingsTab = id;
      ctx.rerender();
    },
  );
  const list = div('mg-set-list mg-scroll');
  const infoT = div('mg-set-info-t', t('settings.tab.' + st.settingsTab));
  const infoD = div('mg-set-info-d', '');
  const info = div(
    'mg-set-info mg-panel',
    div('mg-set-info-ico', ico(TAB_ICON[st.settingsTab])),
    infoT,
    infoD,
    div(
      'mg-set-info-foot',
      btn(t('settings.reset'), () => resetTab(), { kind: 'ghost', icon: UI.refresh, snd: 'back' }),
    ),
  );
  el.append(header(t('settings.title'), () => ctx.back(), tabBar), div('mg-set-body', list, info));

  const cur = () => ctx.settings;
  const commit = (patch: Partial<Settings>, rebuild = false) => ctx.applySettings({ ...cur(), ...patch }, rebuild);

  const describe = (title: string, desc: string) => {
    infoT.textContent = title;
    infoD.textContent = desc;
  };

  const perfBadge = (p: Perf) => span('mg-perf mg-perf--' + p, span('mg-perf-bars', h('i'), h('i'), h('i')), span('', t('perf.' + p)));
  const row = (labelKey: string, descKey: string, control: HTMLElement, cls = '', perf?: Perf, note?: string) => {
    const r = div('mg-set-row' + (cls ? ' ' + cls : ''), div('mg-set-lbl', span('mg-set-lbl-t', t(labelKey)), perf ? perfBadge(perf) : null, note ? span('mg-set-note', note) : null), div('mg-set-ctl', control));
    const d = () => describe(t(labelKey), t(descKey) + (perf ? '  ·  ' + t('perf.' + perf) : ''));
    r.addEventListener('mouseenter', d);
    r.addEventListener('focusin', d);
    return r;
  };
  const group = (titleKey: string, ...rows: HTMLElement[]) => div('mg-set-group', h('h3', { class: 'mg-sec' }, span('', t(titleKey))), ...rows);

  let rebindCleanup: (() => void) | null = null;
  let listening: Action | null = null;
  const keyBtns = new Map<Action, HTMLButtonElement>();
  let crosshair: Crosshair | null = null;
  let chTimer = 0;

  const resetTab = () => {
    const d = DEFAULT_SETTINGS;
    const s = cur();
    let patch: Partial<Settings> = {};
    switch (st.settingsTab) {
      case 'graphics':
        patch = {
          quality: d.quality,
          renderScale: d.renderScale,
          fov: d.fov,
          outlines: d.outlines,
          ambientOcclusion: d.ambientOcclusion,
          bloom: d.bloom,
          shadows: d.shadows,
          filmGrain: d.filmGrain,
          motionBlur: d.motionBlur,
          showFps: d.showFps,
          antialias: d.antialias,
          lensFlare: d.lensFlare,
          particles: d.particles,
          textureQuality: d.textureQuality,
          terrainDetail: d.terrainDetail,
          reflections: d.reflections,
        };
        break;
      case 'audio':
        patch = { masterVolume: d.masterVolume, sfxVolume: d.sfxVolume, musicVolume: d.musicVolume, uiVolume: d.uiVolume };
        break;
      case 'controls':
        patch = { sensitivity: d.sensitivity, adsSensitivity: d.adsSensitivity, invertY: d.invertY, toggleAim: d.toggleAim, toggleCrouch: d.toggleCrouch, keys: { ...DEFAULT_KEYS } };
        break;
      case 'game':
        patch = { botDifficulty: d.botDifficulty, hudScale: d.hudScale, hitMarkers: d.hitMarkers, damageNumbers: d.damageNumbers, minimapRotate: d.minimapRotate };
        break;
      case 'crosshair':
        patch = { crosshair: { ...d.crosshair } };
        break;
    }
    ctx.applySettings({ ...s, ...patch }, true);
    ctx.toast(t('settings.resetDone'), 'info');
  };

  // ---------------------------------------------------------------- tabs
  const s = cur();
  if (st.settingsTab === 'graphics') {
    describe(t('set.quality'), t('setd.quality'));
    const lvl3 = <T extends string>(v: T, set: (x: T) => void) =>
      segmented(
        (['low', 'medium', 'high'] as const).map((q) => ({ id: q as unknown as T, label: t('lvl.' + q) })),
        v,
        set,
      );
    list.append(
      group(
        'settings.group.main',
        row(
          'set.quality',
          'setd.quality',
          segmented(
            (['low', 'medium', 'high', 'ultra'] as const).map((q) => ({ id: q, label: t('quality.' + q) })),
            s.quality,
            (q) => commit({ quality: q, ...qualityPreset(q) }, true),
            'mg-seg--wide',
          ),
        ),
        row('set.renderScale', 'setd.renderScale', slider({ min: 0.5, max: 1.5, step: 0.05, value: s.renderScale, fmt: pctFmt, onInput: (v) => commit({ renderScale: v }) }), '', 'heavy'),
        row('set.fov', 'setd.fov', slider({ min: 60, max: 110, step: 1, value: s.fov, fmt: (v) => v + '°', onInput: (v) => commit({ fov: v }) })),
        row('set.showFps', 'setd.showFps', toggle(s.showFps, (v) => commit({ showFps: v }))),
        row(
          'set.fullscreen',
          'setd.fullscreen',
          toggle(s.fullscreen, (v) => {
            commit({ fullscreen: v });
            if (v) enterFullscreen();
            else exitFullscreen();
          }),
        ),
      ),
      group(
        'settings.group.heavy',
        row(
          'set.shadows',
          'setd.shadows',
          segmented(
            (['off', 'low', 'high'] as const).map((q) => ({ id: q, label: t('shadows.' + q) })),
            s.shadows,
            (v) => commit({ shadows: v }),
          ),
          '',
          'heavy',
        ),
        row('set.ao', 'setd.ao', toggle(s.ambientOcclusion, (v) => commit({ ambientOcclusion: v })), '', 'heavy'),
        row('set.antialias', 'setd.antialias', toggle(s.antialias, (v) => commit({ antialias: v })), '', 'heavy'),
        row('set.reflections', 'setd.reflections', toggle(s.reflections, (v) => commit({ reflections: v })), '', 'heavy'),
        row('set.textureQuality', 'setd.textureQuality', lvl3(s.textureQuality, (v) => commit({ textureQuality: v })), '', 'heavy', t('setd.restart')),
      ),
      group(
        'settings.group.medium',
        row('set.bloom', 'setd.bloom', toggle(s.bloom, (v) => commit({ bloom: v })), '', 'medium'),
        row('set.lensFlare', 'setd.lensFlare', toggle(s.lensFlare, (v) => commit({ lensFlare: v })), '', 'medium'),
        row('set.particles', 'setd.particles', lvl3(s.particles, (v) => commit({ particles: v })), '', 'medium'),
        row('set.terrainDetail', 'setd.terrainDetail', toggle(s.terrainDetail, (v) => commit({ terrainDetail: v })), '', 'medium'),
        row('set.motionBlur', 'setd.motionBlur', toggle(s.motionBlur, (v) => commit({ motionBlur: v })), '', 'medium'),
      ),
      group(
        'settings.group.light',
        row('set.outlines', 'setd.outlines', toggle(s.outlines, (v) => commit({ outlines: v })), '', 'light'),
        row('set.filmGrain', 'setd.filmGrain', toggle(s.filmGrain, (v) => commit({ filmGrain: v })), '', 'light'),
      ),
    );
  } else if (st.settingsTab === 'audio') {
    describe(t('set.master'), t('setd.volume'));
    const vol = (key: 'masterVolume' | 'sfxVolume' | 'musicVolume' | 'uiVolume', label: string) =>
      row(
        label,
        'setd.volume',
        slider({
          min: 0,
          max: 1,
          step: 0.01,
          value: s[key],
          fmt: pctFmt,
          onInput: (v) => commit({ [key]: v } as Partial<Settings>),
          onCommit: (v) => {
            commit({ [key]: v } as Partial<Settings>);
            ctx.snd('click');
          },
        }),
        'mg-set-row--vol',
      );
    list.append(group('settings.group.volume', vol('masterVolume', 'set.master'), vol('sfxVolume', 'set.sfx'), vol('musicVolume', 'set.music'), vol('uiVolume', 'set.ui')));
  } else if (st.settingsTab === 'controls') {
    describe(t('set.keys'), t('setd.keys'));
    const keyGroupEls = keyGroups().map((g) =>
      group(
        g.title,
        ...g.actions.map((a) => {
          const b = h('button', { class: 'mg-keycap', type: 'button', 'data-snd': 'click' }, keyLabel(s.keys[a])) as HTMLButtonElement;
          b.addEventListener('click', () => startListen(a));
          keyBtns.set(a, b);
          const r = row('act.' + a, 'setd.keys', b, 'mg-set-row--key');
          r.setAttribute('data-action', a);
          return r;
        }),
      ),
    );
    list.append(
      group(
        'settings.group.mouse',
        row('set.sensitivity', 'setd.sensitivity', slider({ min: 0.1, max: 5, step: 0.05, value: s.sensitivity, fmt: (v) => v.toFixed(2), onInput: (v) => commit({ sensitivity: v }) })),
        row('set.ads', 'setd.ads', slider({ min: 0.2, max: 1.5, step: 0.05, value: s.adsSensitivity, fmt: (v) => '×' + v.toFixed(2), onInput: (v) => commit({ adsSensitivity: v }) })),
        row('set.invertY', 'setd.invertY', toggle(s.invertY, (v) => commit({ invertY: v }))),
        row('set.toggleAim', 'setd.toggleAim', toggle(s.toggleAim, (v) => commit({ toggleAim: v }))),
        row('set.toggleCrouch', 'setd.toggleCrouch', toggle(s.toggleCrouch, (v) => commit({ toggleCrouch: v }))),
      ),
      div('mg-set-keyhead', h('h3', { class: 'mg-sec' }, ico(UI.keyboard), span('', t('set.keys'))), btn(t('set.resetKeys'), () => resetKeys(), { kind: 'plain', icon: UI.refresh, cls: 'mg-btn--sm', snd: 'back' })),
      div('mg-set-keys', ...keyGroupEls),
    );
  } else if (st.settingsTab === 'game') {
    describe(t('set.botDifficulty'), t('setd.botDifficulty'));
    list.append(
      group(
        'settings.group.bots',
        row(
          'set.botDifficulty',
          'setd.botDifficulty',
          segmented(
            (['easy', 'normal', 'hard', 'veteran'] as const).map((d) => ({ id: d, label: botName(d) })),
            s.botDifficulty,
            (v) => commit({ botDifficulty: v }),
            'mg-seg--wide',
          ),
        ),
      ),
      group(
        'settings.group.hud',
        row('set.hudScale', 'setd.hudScale', slider({ min: 0.75, max: 1.25, step: 0.05, value: s.hudScale, fmt: pctFmt, onInput: (v) => commit({ hudScale: v }) })),
        row('set.hitMarkers', 'setd.hitMarkers', toggle(s.hitMarkers, (v) => commit({ hitMarkers: v }))),
        row('set.damageNumbers', 'setd.damageNumbers', toggle(s.damageNumbers, (v) => commit({ damageNumbers: v }))),
        row('set.minimapRotate', 'setd.minimapRotate', toggle(s.minimapRotate, (v) => commit({ minimapRotate: v }))),
      ),
      group(
        'settings.group.lang',
        row(
          'set.language',
          'setd.language',
          segmented(
            [
              { id: 'ru', label: 'Русский' },
              { id: 'en', label: 'English' },
            ],
            s.language,
            (v) => commit({ language: v as Settings['language'] }),
          ),
        ),
      ),
    );
  } else {
    describe(t('settings.tab.crosshair'), t('setd.crosshair'));
    const ch = new Crosshair();
    crosshair = ch;
    ch.configure(s.crosshair);
    const art = div('mg-chp-art');
    art.innerHTML = mapArtSvg('front');
    const target = div('mg-chp-target');
    const preview = div('mg-chp mg-panel', art, div('mg-chp-vignette'), target, div('mg-chp-center', ch.el), div('mg-chp-label', ico(UI.crosshair), span('', t('set.ch.preview'))));
    // animate spread to show the dynamic gap
    let tt = 0;
    chTimer = window.setInterval(() => {
      tt += 0.05;
      ch.setGap(5 + Math.max(0, Math.sin(tt * 2.2)) * 14);
    }, 50);

    const setCh = (patch: Partial<Settings['crosshair']>) => {
      const c = { ...cur().crosshair, ...patch };
      commit({ crosshair: c });
      ch.configure(c);
    };
    const swWrap = div('mg-swatches');
    const swBtns: HTMLButtonElement[] = [];
    const colorInput = h('input', { type: 'color', class: 'mg-color', value: /^#[0-9a-f]{6}$/i.test(s.crosshair.color) ? s.crosshair.color : '#7ff0ff', title: t('set.ch.custom') }) as HTMLInputElement;
    const markSw = (c: string) => swBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.c === c.toLowerCase()));
    for (const c of SWATCHES) {
      const b = h('button', { class: 'mg-swatch', type: 'button', 'data-snd': 'click', 'data-c': c.toLowerCase(), style: `--c:${c}`, title: c }) as HTMLButtonElement;
      b.addEventListener('click', () => {
        setCh({ color: c });
        markSw(c);
        colorInput.value = c;
      });
      swBtns.push(b);
      swWrap.appendChild(b);
    }
    colorInput.addEventListener('input', () => {
      setCh({ color: colorInput.value });
      markSw(colorInput.value);
    });
    swWrap.appendChild(h('label', { class: 'mg-swatch mg-swatch--custom', title: t('set.ch.custom') }, colorInput, ico(UI.plus)));
    markSw(s.crosshair.color);

    list.append(
      div(
        'mg-chp-wrap',
        preview,
        div(
          'mg-chp-ctl',
          group(
            'settings.tab.crosshair',
            row(
              'set.ch.style',
              'setd.crosshair',
              segmented(
                (['cross', 'dot', 'circle', 'chevron'] as const).map((k) => ({ id: k, label: t('ch.' + k), icon: crosshairStyleIcon(k) })),
                s.crosshair.style,
                (v) => setCh({ style: v }),
                'mg-seg--icons',
              ),
            ),
            row('set.ch.color', 'setd.crosshair', swWrap),
            row('set.ch.size', 'setd.crosshair', slider({ min: 0.5, max: 2, step: 0.05, value: s.crosshair.size, fmt: (v) => '×' + v.toFixed(2), onInput: (v) => setCh({ size: v }) })),
            row('set.ch.opacity', 'setd.crosshair', slider({ min: 0.1, max: 1, step: 0.05, value: s.crosshair.opacity, fmt: pctFmt, onInput: (v) => setCh({ opacity: v }) })),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- key rebinding
  const refreshKeys = (flash: Action[] = []) => {
    const k = cur().keys;
    for (const [a, b] of keyBtns) {
      b.textContent = keyLabel(k[a]);
      b.classList.remove('is-listening');
      const r = b.closest('.mg-set-row');
      if (r && flash.includes(a)) {
        r.classList.remove('is-flash');
        void (r as HTMLElement).offsetWidth;
        r.classList.add('is-flash');
      }
    }
  };

  const stopListen = () => {
    listening = null;
    rebindCleanup?.();
    rebindCleanup = null;
    el.classList.remove('is-rebinding');
    refreshKeys();
  };

  const bind = (a: Action, code: string) => {
    const keys = { ...cur().keys };
    const old = keys[a];
    const changed: Action[] = [a];
    if (old !== code) {
      const other = (Object.keys(keys) as Action[]).find((x) => x !== a && keys[x] === code);
      keys[a] = code;
      if (other) {
        keys[other] = old;
        changed.push(other);
        ctx.toast(t('set.swapped', { a: actionName(other), k: keyLabel(old) }), 'info');
      }
      commit({ keys });
    }
    listening = null;
    rebindCleanup?.();
    rebindCleanup = null;
    el.classList.remove('is-rebinding');
    refreshKeys(changed);
    ctx.snd('confirm');
  };

  const startListen = (a: Action) => {
    if (listening) stopListen();
    listening = a;
    el.classList.add('is-rebinding');
    const b = keyBtns.get(a);
    if (b) {
      b.textContent = t('set.pressKey');
      b.classList.add('is-listening');
    }
    describe(actionName(a), t('set.pressKey') + ' ' + t('set.pressKeyHint'));
    // mouse buttons: arm on next frame so the click that started listening is not captured
    let armed = false;
    const arm = window.setTimeout(() => (armed = true), 120);
    const onMouse = (e: MouseEvent) => {
      if (!armed || !listening) return;
      e.preventDefault();
      e.stopPropagation();
      bind(listening, 'Mouse' + e.button);
    };
    const onCtx = (e: Event) => e.preventDefault();
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('contextmenu', onCtx, true);
    rebindCleanup = () => {
      window.clearTimeout(arm);
      window.removeEventListener('mousedown', onMouse, true);
      // contextmenu fires after mouseup; remove slightly later
      window.setTimeout(() => window.removeEventListener('contextmenu', onCtx, true), 400);
    };
  };

  const resetKeys = () => {
    commit({ keys: { ...DEFAULT_KEYS } });
    refreshKeys(Object.keys(DEFAULT_KEYS) as Action[]);
    ctx.toast(t('set.keysReset'), 'info');
  };

  return {
    el,
    layer: 'front',
    destroy: () => {
      if (listening) stopListen();
      window.clearInterval(chTimer);
      crosshair = null;
    },
    onKey: (e) => {
      if (!listening) return false;
      if (e.code === 'Escape' || e.key === 'Escape') {
        stopListen();
        ctx.snd('back');
        return true;
      }
      if (!e.code) return true;
      bind(listening, e.code);
      return true;
    },
    refresh: (what) => {
      if (what === 'net' || what === 'profile' || what === 'portraits') return true;
      return false;
    },
  };
}

