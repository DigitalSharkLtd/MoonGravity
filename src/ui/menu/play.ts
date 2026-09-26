import { HEROES, MODES, type ModeId } from '../../game/Types';
import { mapArtSvg } from '../art';
import { clear, div, h, ico, span } from '../dom';
import { bi, botName, heroName, mapName, modeDesc, modeName, t } from '../i18n';
import { MODE_ICON, ROLE_ICON, UI } from '../icons';
import type { RoomInfo } from '../Menu';
import { heroMastery, selectedBuild } from '../Storage';
import type { MenuCtx, ScreenInst } from './ctx';
import { btn, header, iconBtn, portrait, segmented, tabs } from './widgets';

const MODE_LIST: ModeId[] = ['duel2v2', 'ffa', 'war4v4'];

export function parseRoomCode(s: string): string | null {
  const v = s.trim();
  const m = v.match(/[#&?]join=([A-Za-z0-9]{8})\b/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]{8}$/.test(v)) return v;
  return null;
}

export function buildPlay(ctx: MenuCtx): ScreenInst {
  const st = ctx.state;
  const el = div('mg-page mg-play');
  const tabBar = tabs(
    [
      { id: 'modes', label: t('play.tab.modes'), icon: UI.grid },
      { id: 'servers', label: t('play.tab.servers'), icon: UI.list },
    ],
    st.playTab,
    (id) => {
      st.playTab = id;
      ctx.rerender();
    },
  );
  const body = div('mg-play-body');
  el.append(header(t('play.title'), () => ctx.back(), tabBar), body);

  let cleanup: (() => void) | null = null;
  if (st.playTab === 'modes') body.appendChild(buildModes(ctx));
  else {
    const s = buildServers(ctx);
    body.appendChild(s.el);
    cleanup = s.destroy;
  }
  return {
    el,
    layer: 'front',
    destroy: () => cleanup?.(),
    refresh: (what) => what === 'settings',
  };
}

function modeMeta(m: ModeId): HTMLElement {
  const mi = MODES[m];
  return div(
    'mg-mode-meta',
    span('', ico(UI.users), t(`mode.${m}.players`)),
    span('', ico(UI.clock), t('common.min', { n: Math.round(mi.timeLimit / 60) })),
    span('', ico(UI.target), t(`mode.${m}.goal`)),
  );
}

function buildModes(ctx: MenuCtx): HTMLElement {
  const st = ctx.state;
  const wrap = div('mg-modes-wrap');
  const cards = div('mg-modes');
  const cardEls: HTMLElement[] = [];
  for (const m of MODE_LIST) {
    const mi = MODES[m];
    const art = div('mg-mode-art');
    art.innerHTML = mapArtSvg(mi.map, true);
    const card = h(
      'button',
      { class: 'mg-mode-card' + (st.playMode === m ? ' is-sel' : ''), type: 'button', 'data-snd': 'click', 'data-mode': m },
      art,
      div('mg-mode-shade'),
      div('mg-mode-top', span('mg-mode-badge', ico(MODE_ICON[m]), span('', t(`mode.${m}.players`))), span('mg-mode-kind', mi.teams ? t('mode.teams') : t('mode.solo'))),
      div('mg-mode-info', div('mg-mode-name', modeName(m)), div('mg-mode-map', ico(UI.map), span('', mapName(mi.map))), div('mg-mode-desc', modeDesc(m)), modeMeta(m)),
      div('mg-mode-check', ico(UI.check)),
      div('mg-mode-edge'),
    );
    if (st.playMode === m) card.setAttribute('data-autofocus', '');
    card.addEventListener('click', () => {
      st.playMode = m;
      for (const c of cardEls) c.classList.toggle('is-sel', c === card);
    });
    card.addEventListener('dblclick', () => quick());
    cardEls.push(card);
    cards.appendChild(card);
  }

  const hero = ctx.profile.selectedHero;
  const hd = HEROES[hero];
  const heroMini = div(
    'mg-heromini mg-panel',
    portrait(hero, ctx.portraits, true, 'mg-heromini-pic'),
    div(
      'mg-heromini-info',
      div('mg-k', t('play.hero')),
      div('mg-heromini-name', heroName(hero)),
      div('mg-heromini-role', ico(ROLE_ICON[hd.role]), span('', t('role.' + hd.role)), span('mg-dot'), span('mg-heromini-build', bi(hd.builds.find((b) => b.id === selectedBuild(ctx.profile, hero))?.name)), span('mg-heromini-lv', t('mastery.level', { n: heroMastery(ctx.profile, hero).level }))),
    ),
    btn(t('play.change'), () => ctx.go('heroes'), { kind: 'plain', icon: UI.helmet, cls: 'mg-btn--sm' }),
  );

  const diff = segmented(
    (['easy', 'normal', 'hard', 'veteran'] as const).map((d) => ({ id: d, label: botName(d) })),
    ctx.settings.botDifficulty,
    (v) => ctx.applySettings({ ...ctx.settings, botDifficulty: v }),
    'mg-seg--diff',
  );
  const bots = div('mg-botdiff mg-panel', div('mg-k', ico(UI.bot), span('', t('play.botDifficulty'))), diff);

  const offline = ctx.net === false;
  const quick = () => {
    if (offline) {
      ctx.toast(t('servers.error'), 'bad');
      return;
    }
    ctx.cb.onPlay({ mode: st.playMode, online: true, hero: ctx.profile.selectedHero, build: selectedBuild(ctx.profile, ctx.profile.selectedHero) });
  };
  const bQuick = btn(t('play.quick'), quick, { kind: 'primary', big: true, icon: UI.play, sub: offline ? t('play.offline') : t('play.quick.sub'), disabled: offline, cls: 'mg-play-quick' });
  const bBots = btn(t('play.bots'), () => ctx.cb.onPlay({ mode: st.playMode, online: false, hero: ctx.profile.selectedHero, build: selectedBuild(ctx.profile, ctx.profile.selectedHero) }), { kind: 'accent', icon: UI.bot, sub: t('play.bots.sub'), snd: 'confirm' });
  const bRoom = btn(t('play.create'), () => ctx.cb.onCreateRoom(st.playMode, ctx.profile.selectedHero), { kind: 'ghost', icon: UI.link, sub: t('play.create.sub'), disabled: offline, snd: 'confirm' });

  const actions = div('mg-play-actions', heroMini, bots, div('mg-play-btns', bBots, bRoom, bQuick));
  wrap.append(cards, actions);
  return wrap;
}

function buildServers(ctx: MenuCtx): { el: HTMLElement; destroy(): void } {
  const st = ctx.state;
  const el = div('mg-servers');
  const list = div('mg-srv-list mg-scroll');
  const count = span('mg-srv-count', '');
  let reqId = 0;
  let alive = true;

  const filter = segmented<ModeId | 'all'>(
    [{ id: 'all', label: t('servers.all') }, ...MODE_LIST.map((m) => ({ id: m, label: modeName(m), icon: MODE_ICON[m] }))],
    st.serverFilter,
    (v) => {
      st.serverFilter = v;
      load();
    },
    'mg-seg--filter',
  );
  const refreshBtn = iconBtn(UI.refresh, () => load(), t('servers.refresh'), 'mg-srv-refresh');

  const renderState = (kind: 'loading' | 'error' | 'empty') => {
    clear(list);
    if (kind === 'loading') {
      list.appendChild(div('mg-srv-state', div('mg-radar-mini', div('mg-radar-sweep')), div('mg-srv-state-t', t('servers.loading'))));
    } else if (kind === 'error') {
      list.appendChild(
        div(
          'mg-srv-state is-error',
          ico(UI.wifiOff, 'mg-srv-state-ico'),
          div('mg-srv-state-t', t('servers.error')),
          div('mg-srv-state-d', t('servers.errorHint')),
          div('mg-srv-state-btns', btn(t('servers.refresh'), () => load(), { kind: 'ghost', icon: UI.refresh }), btn(t('play.bots'), () => ctx.cb.onPlay({ mode: st.playMode, online: false, hero: ctx.profile.selectedHero, build: selectedBuild(ctx.profile, ctx.profile.selectedHero) }), { kind: 'accent', icon: UI.bot })),
        ),
      );
    } else {
      const m = st.serverFilter === 'all' ? st.playMode : st.serverFilter;
      list.appendChild(
        div(
          'mg-srv-state',
          ico(UI.globe, 'mg-srv-state-ico'),
          div('mg-srv-state-t', t('servers.empty')),
          div('mg-srv-state-btns', btn(t('play.create'), () => ctx.cb.onCreateRoom(m, ctx.profile.selectedHero), { kind: 'primary', icon: UI.link })),
        ),
      );
    }
  };

  const row = (r: RoomInfo) => {
    const mode = (MODE_LIST as string[]).includes(r.mode) ? (r.mode as ModeId) : null;
    const full = r.players >= r.capacity;
    const pips = div('mg-srv-pips');
    for (let i = 0; i < r.capacity; i++) pips.appendChild(span(i < r.players ? 'on' : ''));
    const join = btn(full ? t('servers.full') : t('servers.join'), () => ctx.cb.onJoinRoom(r.roomId, ctx.profile.selectedHero), { kind: full ? 'ghost' : 'primary', disabled: full, cls: 'mg-btn--sm', icon: full ? UI.lock : UI.enter });
    const tr = div(
      'mg-srv-row mg-hover' + (full ? ' is-full' : ''),
      div('mg-srv-name', span('mg-srv-name-t', r.name || r.roomId), span('mg-srv-id', '#' + r.roomId)),
      div('mg-srv-mode', mode ? ico(MODE_ICON[mode]) : null, span('', mode ? modeName(mode) : r.mode)),
      div('mg-srv-map', mode ? mapName(MODES[mode].map) : '—'),
      div('mg-srv-players', span('mg-srv-pl', `${r.players}/${r.capacity}`), pips),
      div('mg-srv-join', join),
    );
    tr.addEventListener('dblclick', () => {
      if (!full) ctx.cb.onJoinRoom(r.roomId, ctx.profile.selectedHero);
    });
    return tr;
  };

  const load = (silent = false) => {
    const id = ++reqId;
    refreshBtn.classList.add('is-spin');
    if (!silent) {
      renderState('loading');
      count.textContent = '';
    }
    const mode = st.serverFilter === 'all' ? undefined : st.serverFilter;
    let p: Promise<RoomInfo[]>;
    try {
      p = ctx.cb.listRooms(mode);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (rooms) => {
        if (!alive || id !== reqId) return;
        refreshBtn.classList.remove('is-spin');
        const rs = rooms.filter((r) => !mode || r.mode === mode).sort((a, b) => Number(a.players >= a.capacity) - Number(b.players >= b.capacity) || b.players - a.players);
        count.textContent = t('servers.count', { n: rs.length });
        if (!rs.length) return renderState('empty');
        clear(list);
        rs.forEach((r) => list.appendChild(row(r)));
      },
      () => {
        if (!alive || id !== reqId) return;
        refreshBtn.classList.remove('is-spin');
        count.textContent = '';
        renderState('error');
      },
    );
  };

  const head = div('mg-srv-row mg-srv-headrow', div('', t('servers.col.name')), div('', t('servers.col.mode')), div('', t('servers.col.map')), div('', t('servers.col.players')), div(''));
  const input = h('input', { class: 'mg-input', type: 'text', placeholder: t('servers.paste'), value: st.joinCode, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const connect = () => {
    const code = parseRoomCode(input.value);
    if (!code) {
      input.classList.add('is-bad');
      window.setTimeout(() => input.classList.remove('is-bad'), 600);
      ctx.toast(t('servers.badCode'), 'bad');
      return;
    }
    ctx.cb.onJoinRoom(code, ctx.profile.selectedHero);
  };
  input.addEventListener('input', () => (st.joinCode = input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ctx.snd('confirm');
      connect();
    }
  });
  const joinBox = div('mg-joinbox mg-panel', div('mg-k', ico(UI.link), span('', t('servers.byLink'))), div('mg-joinbox-row', input, btn(t('servers.connect'), connect, { kind: 'primary', icon: UI.enter })));

  el.append(div('mg-srv-toolbar', filter, div('mg-srv-tools', count, refreshBtn)), div('mg-srv-table mg-panel', head, list), joinBox);
  load();
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') load(true);
  }, 15000);
  return {
    el,
    destroy() {
      alive = false;
      window.clearInterval(timer);
    },
  };
}
