import { HERO_ORDER, HEROES, levelFromXp, MODES, type HeroId, type MapId, type MatchResult, type ModeId, type Profile, type ScoreRow } from '../../game/Types';
import { mapArtSvg } from '../art';
import { clear, div, fmtNum, fmtTime, h, ico, span } from '../dom';
import { abilityDesc, abilityName, bi, getLang, heroName, heroTagline, keyLabel, mapName, modeName, ribbonDesc, ribbonName, t, tip, tipCount, weaponName } from '../i18n';
import { ABILITY_ICON, HERO_ICON, MODE_ICON, ribbonSvg, ROLE_COLOR, ROLE_ICON, ROLE_ORDER, UI, WEAPON_ICON } from '../icons';
import { heroMastery, rankInfo, selectedBuild } from '../Storage';
import { buildsEl, masteryEl } from './herokit';
import type { MenuCtx, ScreenInst } from './ctx';
import { heroStage } from './stage';
import { btn, kbd, levelBadge, portrait, roleTag } from './widgets';

export interface HeroSelectOpts {
  mode: ModeId;
  team: number;
  allies: { name: string; hero: HeroId; isBot: boolean }[];
  current: HeroId;
  timeLeft?: number;
  canClose: boolean;
}

export interface PauseInfo {
  mode: ModeId;
  roomLink?: string;
  isHost: boolean;
  players: number;
  capacity: number;
}

const teamName = (team: number) => (team === 0 || team === 1 ? t('team.' + team) : '');
const teamVar = (team: number) => (team === 1 ? 'var(--team1)' : 'var(--team0)');

// ---------------------------------------------------------------------------
// loading

function guessMap(title: string, fallback: MapId): MapId {
  const low = title.toLowerCase();
  for (const id of ['duel', 'quarry', 'front'] as MapId[]) {
    if (low.includes(id)) return id;
  }
  const cur = getLang();
  const names: Record<MapId, string[]> = { duel: ['шахта-7', 'mine-7'], quarry: ['палладиевый карьер', 'palladium quarry', 'карьер'], front: ['фронт тихо', 'tycho front', 'тихо', 'tycho'] };
  void cur;
  for (const id of Object.keys(names) as MapId[]) if (names[id].some((n) => low.includes(n))) return id;
  return fallback;
}

const MAP_IDS: MapId[] = ['duel', 'quarry', 'front'];
/** a bare map id as title → localized map name */
const shownTitle = (title: string) => ((MAP_IDS as string[]).includes(title) ? mapName(title as MapId) : title);

export function buildLoading(ctx: MenuCtx, title: string, progress: number, tipText?: string): { inst: ScreenInst; ctl: { update(title: string, progress: number, tip?: string): void } } {
  const el = div('mg-page mg-loading');
  const art = div('mg-load-art');
  let map = guessMap(title, MODES[ctx.state.playMode].map);
  art.innerHTML = mapArtSvg(map);
  let rawTitle = title;
  const titleEl = div('mg-load-title', shownTitle(title));
  const modeFor = (m: MapId) => (Object.keys(MODES) as ModeId[]).find((k) => MODES[k].map === m) ?? ctx.state.playMode;
  const modeEl = div('mg-load-mode', ico(MODE_ICON[modeFor(map)]), span('', modeName(modeFor(map))));
  const fill = div('mg-load-fill');
  const pctEl = span('mg-load-pct', '0%');
  const tipTxt = div('mg-load-tip-t', '');
  let tipIdx = Math.floor(Math.random() * tipCount());
  let fixedTip = tipText ?? null;
  const setTip = (txt: string) => {
    tipTxt.classList.remove('is-in');
    void tipTxt.offsetWidth;
    tipTxt.textContent = txt;
    tipTxt.classList.add('is-in');
  };
  setTip(fixedTip ?? tip(tipIdx));
  const timer = window.setInterval(() => {
    if (fixedTip) return;
    tipIdx++;
    setTip(tip(tipIdx));
  }, 6500);
  const spinner = div('mg-load-spin');
  spinner.innerHTML = `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" class="a"/><circle cx="24" cy="24" r="14" class="b"/><path d="M24 14l6 4v8l-6 4-6-4v-8z" class="c"/></svg>`;
  el.append(
    art,
    div('mg-load-shade'),
    div('mg-load-main', div('mg-load-k', span('mg-load-dot'), span('', t('loading.deploy'))), titleEl, modeEl),
    div('mg-load-tip mg-panel', div('mg-load-tip-k', ico(UI.info), span('', t('loading.tip'))), tipTxt),
    div('mg-load-bottom', spinner, div('mg-load-bar', fill, div('mg-load-bar-glow')), pctEl),
  );
  const setP = (p: number) => {
    const k = Math.max(0, Math.min(1, p));
    fill.style.transform = `scaleX(${k})`;
    pctEl.textContent = Math.round(k * 100) + '%';
  };
  setP(progress);
  return {
    inst: { el, layer: 'opaque', destroy: () => window.clearInterval(timer) },
    ctl: {
      update(ti, p, tp) {
        if (ti !== rawTitle) {
          rawTitle = ti;
          titleEl.textContent = shownTitle(ti);
          const m = guessMap(ti, map);
          if (m !== map) {
            map = m;
            art.innerHTML = mapArtSvg(map);
            clear(modeEl);
            modeEl.append(ico(MODE_ICON[modeFor(map)]), span('', modeName(modeFor(map))));
          }
        }
        if (tp && tp !== fixedTip) {
          fixedTip = tp;
          setTip(tp);
        }
        setP(p);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// matchmaking

/** localise lobby status codes ('searching', 'joining:<room>', 'hosting', …); unknown text passes through */
export function mmStatusText(s: string): string {
  if (s.startsWith('joining:')) return t('mm.st.joiningTo', { name: s.slice(8) });
  const k = 'mm.st.' + s;
  const v = t(k);
  return v === k ? s : v;
}

export function buildMatchmaking(ctx: MenuCtx, status: string, onCancel: () => void): { inst: ScreenInst; ctl: { update(status: string, onCancel: () => void): void } } {
  let cancel = onCancel;
  const el = div('mg-page mg-mm');
  const radar = div('mg-mm-radar');
  radar.append(div('mg-mm-ring r1'), div('mg-mm-ring r2'), div('mg-mm-ring r3'), div('mg-mm-cross'), div('mg-mm-sweep'));
  for (let i = 0; i < 6; i++) {
    const b = div('mg-mm-blip');
    const a = (i * 137.5 * Math.PI) / 180;
    const r = 18 + ((i * 23) % 26);
    b.style.left = 50 + Math.cos(a) * r + '%';
    b.style.top = 50 + Math.sin(a) * r + '%';
    b.style.animationDelay = (-i * 0.45).toFixed(2) + 's';
    radar.appendChild(b);
  }
  const emblem = div('mg-mm-emblem', ico(MODE_ICON[ctx.state.playMode]));
  radar.appendChild(emblem);
  const statusEl = div('mg-mm-status', mmStatusText(status));
  const timeEl = div('mg-mm-time', '0:00');
  const t0 = performance.now();
  const timer = window.setInterval(() => (timeEl.textContent = fmtTime((performance.now() - t0) / 1000)), 250);
  const m = ctx.state.playMode;
  const cancelBtn = btn(t('mm.cancel'), () => cancel(), { kind: 'ghost', icon: UI.close, snd: 'back', kbd: 'Esc' });
  el.append(
    div(
      'mg-mm-card mg-panel',
      radar,
      div('mg-mm-title', t('mm.title')),
      statusEl,
      div('mg-mm-meta', div('mg-mm-mode', ico(MODE_ICON[m]), span('', `${modeName(m)} · ${mapName(MODES[m].map)}`)), div('mg-mm-elapsed', span('mg-k', t('mm.elapsed')), timeEl)),
      div('mg-mm-dots', span(''), span(''), span('')),
      cancelBtn,
    ),
  );
  return {
    inst: {
      el,
      layer: 'float',
      destroy: () => window.clearInterval(timer),
      onKey: (e) => {
        if (e.key === 'Escape') {
          ctx.snd('back');
          cancel();
          return true;
        }
        return false;
      },
    },
    ctl: {
      update(s, c) {
        cancel = c;
        const txt = mmStatusText(s);
        if (statusEl.textContent !== txt) {
          statusEl.textContent = txt;
          statusEl.classList.remove('is-pop');
          void statusEl.offsetWidth;
          statusEl.classList.add('is-pop');
        }
      },
    },
  };
}

// ---------------------------------------------------------------------------
// in-match hero select

export function buildHeroSelect(
  ctx: MenuCtx,
  opts0: HeroSelectOpts,
  onConfirm: (h: HeroId, build?: string) => void,
  onClose: () => void,
): { inst: ScreenInst; ctl: { update(o: HeroSelectOpts): void } } {
  let opts = opts0;
  let sel: HeroId = opts.current;
  const buildSel = new Map<HeroId, string>();
  const buildOf = (h: HeroId) => buildSel.get(h) ?? selectedBuild(ctx.profile, h);
  const el = div('mg-page mg-hs');
  el.style.setProperty('--tc', teamVar(opts.team));
  const bg = div('mg-hs-bg');
  const timerV = div('mg-hs-timer-v', '');
  const timer = div('mg-hs-timer', div('mg-k', t('hs.time')), timerV);
  const teamLbl = opts.team >= 0 ? teamName(opts.team) : t('hs.ffa');
  const top = h(
    'header',
    { class: 'mg-hs-top' },
    div('mg-hs-title', div('mg-hs-sub', ico(MODE_ICON[opts.mode]), span('', `${modeName(opts.mode)} · ${mapName(MODES[opts.mode].map)}`), span('mg-hs-team', teamLbl)), h('h1', null, t('hs.title'))),
    timer,
  );
  const allies = div('mg-hs-allies mg-panel');
  const stageBox = div('mg-hs-stage');
  const kit = div('mg-hs-kit mg-panel');
  const roster = div('mg-hs-roster');
  const tiles = new Map<HeroId, HTMLElement>();
  let stage: { el: HTMLElement; destroy(): void } | null = null;

  for (const role of ROLE_ORDER) {
    const ids = HERO_ORDER.filter((x) => HEROES[x].role === role);
    if (!ids.length) continue;
    const gh = div('mg-hs-group-h', ico(ROLE_ICON[role]));
    gh.title = t('role.' + role);
    gh.style.color = ROLE_COLOR[role];
    const g = div('mg-hs-group', gh);
    const row = div('mg-hs-tiles');
    for (const id of ids) {
      const tile = h('button', { class: 'mg-hs-tile', type: 'button', 'data-snd': 'click', title: heroName(id) }, portrait(id, ctx.portraits, true, 'mg-hs-tile-pic'), span('mg-hs-tile-n', heroName(id)));
      tile.style.setProperty('--hc', HEROES[id].color);
      tile.addEventListener('click', () => select(id));
      tile.addEventListener('dblclick', () => confirm());
      tiles.set(id, tile);
      row.appendChild(tile);
    }
    g.appendChild(row);
    roster.appendChild(g);
  }

  const confirmBtn = btn(t('hs.confirm'), () => confirm(), { kind: 'primary', big: true, icon: UI.check, kbd: 'Enter', cls: 'mg-hs-confirm' });
  const closeBtn = btn(t('common.close'), () => onClose(), { kind: 'ghost', icon: UI.close, snd: 'back', kbd: 'Esc', cls: 'mg-hs-close' });

  el.append(bg, top, div('mg-hs-mid', allies, stageBox, kit), div('mg-hs-bottom', roster, div('mg-hs-actions', confirmBtn, opts.canClose ? closeBtn : null)));

  const renderAllies = () => {
    clear(allies);
    allies.appendChild(div('mg-hs-allies-h', ico(UI.users), span('', opts.team >= 0 ? t('hs.allies') : t('hs.ffa'))));
    for (const a of opts.allies) {
      const hic = span('mg-hs-ally-ico', ico(HERO_ICON[a.hero]));
      hic.style.setProperty('--hc', HEROES[a.hero].color);
      const rl = span('mg-hs-ally-role', ico(ROLE_ICON[HEROES[a.hero].role]));
      rl.style.color = ROLE_COLOR[HEROES[a.hero].role];
      allies.appendChild(div('mg-hs-ally', hic, div('mg-hs-ally-body', div('mg-hs-ally-name', a.name, a.isBot ? span('mg-tag-bot', t('common.bot')) : null), div('mg-hs-ally-hero', heroName(a.hero), rl))));
    }
    if (!opts.allies.length) allies.appendChild(div('mg-hs-ally is-empty', span('', '—')));
  };

  const renderTimer = () => {
    const tl = opts.timeLeft;
    timer.style.display = tl === undefined ? 'none' : '';
    if (tl !== undefined) {
      timerV.textContent = fmtTime(tl);
      timer.classList.toggle('is-urgent', tl <= 5);
    }
  };

  const renderSel = () => {
    const hd = HEROES[sel];
    el.style.setProperty('--hc', hd.color);
    for (const [id, tile] of tiles) {
      tile.classList.toggle('is-active', id === sel);
      tile.classList.toggle('is-current', id === opts.current);
    }
    stage?.destroy();
    clear(stageBox);
    stage = heroStage(ctx, sel, 'mg-hs-stagebox', false);
    stageBox.append(stage.el, div('mg-hs-name', div('mg-hs-name-t', heroName(sel)), div('mg-hs-name-r', roleTag(hd.role), span('mg-hs-tagline', heroTagline(sel)))));
    clear(kit);
    const wi = div('mg-hs-weapon-ico');
    wi.innerHTML = WEAPON_ICON[hd.weapon];
    const keys = ctx.settings.keys;
    const ab = (id: typeof hd.ability1.id, key: string, ult = false) =>
      div('mg-hs-ab' + (ult ? ' is-ult' : ''), div('mg-hs-ab-ico', ico(ABILITY_ICON[id])), div('mg-hs-ab-body', div('mg-hs-ab-n', kbd(keyLabel(key)), span('', abilityName(id))), div('mg-hs-ab-d', abilityDesc(id))));
    const hero = sel;
    kit.append(
      div('mg-hs-weapon', wi, div('', div('mg-k', t('heroes.weapon')), div('mg-hs-weapon-n', weaponName(hd.weapon)))),
      ab(hd.ability1.id, keys.ability1),
      ab(hd.ability2.id, keys.ability2),
      ab(hd.ultimate.id, keys.ultimate, true),
      div('mg-hs-builds-h', span('mg-k', t('build.title'))),
      masteryEl(ctx.profile, hero, true),
      buildsEl(
        ctx.profile,
        hero,
        buildOf(hero),
        (b) => buildSel.set(hero, b),
        (lvl) => ctx.toast(t('build.lockedHint', { n: lvl }), 'bad'),
        true,
      ),
    );
  };

  const select = (id: HeroId) => {
    if (id === sel) return;
    sel = id;
    renderSel();
  };
  const confirm = () => {
    ctx.snd('confirm');
    onConfirm(sel, buildOf(sel));
  };

  renderAllies();
  renderTimer();
  renderSel();
  tiles.get(sel)?.setAttribute('data-autofocus', '');

  return {
    inst: {
      el,
      layer: 'overlay',
      destroy: () => stage?.destroy(),
      onKey: (e) => {
        if (e.key === 'Enter') {
          confirm();
          return true;
        }
        if (e.key === 'Escape') {
          if (opts.canClose) {
            ctx.snd('back');
            onClose();
          }
          return true;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const i = HERO_ORDER.indexOf(sel);
          select(HERO_ORDER[(i + (e.key === 'ArrowRight' ? 1 : -1) + HERO_ORDER.length) % HERO_ORDER.length]);
          ctx.snd('hover');
          return true;
        }
        const n = Number(e.key);
        if (n >= 1 && n <= HERO_ORDER.length && !e.ctrlKey && !e.altKey) {
          select(HERO_ORDER[n - 1]);
          ctx.snd('click');
          return true;
        }
        return false;
      },
      refresh: (what) => {
        if (what === 'settings') {
          renderSel();
          return true;
        }
        return what !== 'portraits';
      },
    },
    ctl: {
      update(o) {
        const alliesChanged = JSON.stringify(o.allies) !== JSON.stringify(opts.allies);
        const closeChanged = o.canClose !== opts.canClose;
        opts = o;
        el.style.setProperty('--tc', teamVar(o.team));
        if (alliesChanged) renderAllies();
        renderTimer();
        if (closeChanged) {
          if (o.canClose && !closeBtn.isConnected) confirmBtn.after(closeBtn);
          if (!o.canClose) closeBtn.remove();
        }
        for (const [id, tile] of tiles) tile.classList.toggle('is-current', id === o.current);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// pause

export function buildPause(ctx: MenuCtx, info: PauseInfo, act: { resume(): void; leave(): void }): ScreenInst {
  const el = div('mg-page mg-pause');
  const m = info.mode;
  const resume = btn(t('pause.resume'), () => act.resume(), { kind: 'primary', big: true, icon: UI.play, kbd: 'Esc' });
  resume.setAttribute('data-autofocus', '');
  const settings = btn(t('pause.settings'), () => ctx.go('settings'), { kind: 'ghost', icon: UI.gear, big: true });
  const leaveWrap = div('mg-pause-leave');
  const renderLeave = (confirming: boolean) => {
    clear(leaveWrap);
    if (!confirming) {
      leaveWrap.appendChild(btn(t('pause.leave'), () => renderLeave(true), { kind: 'danger', icon: UI.leave, big: true }));
    } else {
      leaveWrap.append(
        div('mg-pause-confirm-q', ico(UI.warning), span('', t('pause.leaveConfirm'))),
        div('mg-pause-warn', info.isHost ? t('pause.hostWarn') : ''),
        div('mg-pause-confirm-btns', btn(t('common.yes'), () => act.leave(), { kind: 'danger', icon: UI.leave }), btn(t('common.no'), () => renderLeave(false), { kind: 'ghost', snd: 'back' })),
      );
    }
  };
  renderLeave(false);

  const pips = div('mg-pause-pips');
  for (let i = 0; i < info.capacity; i++) pips.appendChild(span(i < info.players ? 'on' : ''));
  const side = div(
    'mg-pause-side',
    div('mg-pause-h', div('mg-pause-k', ico(MODE_ICON[m]), span('', `${modeName(m)} · ${mapName(MODES[m].map)}`)), h('h1', null, t('pause.title'))),
    h('nav', { class: 'mg-pause-nav' }, resume, settings, leaveWrap),
    div('mg-pause-info', div('mg-pause-row', ico(UI.users), span('', t('pause.players')), span('mg-pause-num', `${info.players}/${info.capacity}`), pips), info.isHost ? div('mg-pause-host', ico(UI.crown), span('', t('pause.host'))) : null),
  );
  el.appendChild(side);

  if (info.roomLink) {
    const link = info.roomLink;
    const input = h('input', { class: 'mg-input mg-pause-link', type: 'text', value: link, readonly: true, spellcheck: 'false' }) as HTMLInputElement;
    input.addEventListener('focus', () => input.select());
    const copy = () => {
      const ok = () => ctx.toast(t('pause.copied'), 'good');
      const fallback = () => {
        input.focus();
        input.select();
        let done = false;
        try {
          done = document.execCommand('copy');
        } catch {
          done = false;
        }
        if (done) ok();
        else ctx.toast(t('pause.copyFail'), 'bad');
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(ok, fallback);
      else fallback();
    };
    const code = (link.match(/join=([A-Za-z0-9]+)/) ?? [])[1] ?? '';
    el.appendChild(
      div(
        'mg-pause-invite mg-panel',
        div('mg-pause-invite-h', ico(UI.link), span('', t('pause.invite'))),
        code ? div('mg-pause-code', span('mg-k', t('pause.code')), span('mg-pause-code-v', code)) : null,
        input,
        btn(t('pause.copyLink'), copy, { kind: 'accent', icon: UI.copy, snd: 'confirm' }),
      ),
    );
  }
  return { el, layer: 'overlay' };
}

// ---------------------------------------------------------------------------
// end of match

export function buildEnd(ctx: MenuCtx, r: MatchResult, before: Profile, after: Profile, onContinue: () => void): ScreenInst {
  const teams = MODES[r.mode]?.teams ?? r.teamScores.length === 2;
  let outcome: 'victory' | 'defeat' | 'draw' | 'place';
  if (teams) outcome = r.won === true ? 'victory' : r.won === false ? 'defeat' : 'draw';
  else outcome = 'place';
  const el = div('mg-page mg-end is-' + outcome + (!teams && r.placement === 1 ? ' is-first' : ''));
  const timers: number[] = [];
  let raf = 0;
  const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));

  // ---- banner
  const bigText = outcome === 'victory' ? t('end.victory') : outcome === 'defeat' ? t('end.defeat') : outcome === 'draw' ? t('end.draw') : t('end.place', { n: r.placement });
  const letters = div('mg-end-big');
  Array.from(bigText).forEach((ch, i) => {
    const s = span('mg-end-ch', ch === ' ' ? ' ' : ch);
    s.style.animationDelay = (0.05 + i * 0.045).toFixed(3) + 's';
    letters.appendChild(s);
  });
  let scores: HTMLElement;
  if (teams) {
    const side = (team: number) =>
      div('mg-end-team t' + team + (team === r.localTeam ? ' is-mine' : ''), div('mg-end-team-n', teamName(team), team === r.localTeam ? span('mg-end-you', t('common.you')) : null), div('mg-end-team-s', String(r.teamScores[team] ?? 0)));
    scores = div('mg-end-scores', side(0), div('mg-end-vs', ':'), side(1));
  } else {
    const me = r.rows.find((x) => x.isLocal);
    scores = div('mg-end-scores is-ffa', div('mg-end-team is-mine', div('mg-end-team-n', t('hud.ffa.you')), div('mg-end-team-s', String(me?.kills ?? 0))), div('mg-end-vs', '/'), div('mg-end-team', div('mg-end-team-n', t('hud.ffa.leader')), div('mg-end-team-s', String(r.teamScores[0] ?? 0))), div('mg-end-of', t('end.of', { n: r.rows.length })));
  }
  const banner = div(
    'mg-end-banner',
    div('mg-end-flare'),
    letters,
    scores,
    div('mg-end-meta', ico(MODE_ICON[r.mode]), span('', modeName(r.mode)), span('mg-dot'), span('', mapName(r.map)), span('mg-dot'), ico(UI.clock), span('', fmtTime(r.duration))),
  );

  // ---- scoreboard
  const board = div('mg-end-board mg-panel');
  const head = div('mg-sb-row mg-sb-head', div('mg-sb-hero', ''), div('mg-sb-name', t('col.player')), div('', t('col.e')), div('', t('col.a')), div('', t('col.d')), div('', t('col.score')), div('', t('col.damage')), div('', t('col.healing')));
  board.appendChild(head);
  const rowEl = (x: ScoreRow, i: number) => {
    const hic = span('mg-sb-ico', ico(HERO_ICON[x.hero]));
    hic.style.setProperty('--hc', HEROES[x.hero].color);
    const e = div(
      'mg-sb-row' + (x.isLocal ? ' is-local' : '') + (x.id === r.mvpId ? ' is-mvp' : '') + (teams ? ' t' + x.team : ''),
      div('mg-sb-hero', hic),
      div('mg-sb-name', x.id === r.mvpId ? span('mg-sb-mvp', ico(UI.crown), t('end.mvp')) : null, span('mg-sb-n', x.name), x.isBot ? span('mg-tag-bot', t('common.bot')) : null),
      div('mg-sb-k', String(x.kills)),
      div('', String(x.assists)),
      div('', String(x.deaths)),
      div('mg-sb-score', fmtNum(x.score)),
      div('', fmtNum(x.damage)),
      div('', fmtNum(x.healing)),
    );
    e.style.animationDelay = (0.5 + i * 0.05).toFixed(2) + 's';
    return e;
  };
  if (teams) {
    const order = [r.localTeam === 1 ? 1 : 0, r.localTeam === 1 ? 0 : 1];
    let i = 0;
    for (const tm of order) {
      const rows = r.rows.filter((x) => x.team === tm).sort((a, b) => b.score - a.score);
      board.appendChild(div('mg-sb-teamh t' + tm, span('', teamName(tm)), span('mg-sb-teams', String(r.teamScores[tm] ?? 0))));
      for (const x of rows) board.appendChild(rowEl(x, i++));
    }
  } else {
    [...r.rows].sort((a, b) => b.score - a.score).forEach((x, i) => {
      const e = rowEl(x, i);
      e.querySelector('.mg-sb-hero')?.prepend(span('mg-sb-place', String(i + 1)));
      board.appendChild(e);
    });
  }

  // ---- xp
  const lb = levelFromXp(before.xp);
  const la = levelFromXp(after.xp);
  const badgeBox = div('mg-end-badge');
  badgeBox.appendChild(levelBadge(lb.level));
  const lvlNum = div('mg-end-lvl-n', `${t('player.level')} ${lb.level}`);
  const rankEl = div('mg-end-rank', rankInfo(lb.level, getLang()).title);
  const barFill = div('mg-xpbar-fill');
  const barGain = div('mg-xpbar-gain');
  const bar = div('mg-xpbar mg-xpbar--lg', barGain, barFill, div('mg-xpbar-ticks'));
  const xpTxt = div('mg-end-xpt', '');
  const levelUp = div('mg-end-levelup', ico(UI.chevR), span('', t('end.levelUp')));
  const lines = div('mg-end-lines');
  const total = r.xp.reduce((a, x) => a + x.amount, 0);
  const totalEl = div('mg-end-line is-total', span('mg-end-line-l', t('end.total')), span('mg-end-line-v', '+0'));
  const xpPanel = div(
    'mg-end-xp mg-panel',
    div('mg-end-xp-h', ico(UI.chart), span('', t('end.xp'))),
    lines,
    totalEl,
    div('mg-end-lvl', badgeBox, div('mg-end-lvl-body', div('mg-end-lvl-top', lvlNum, rankEl), bar, xpTxt), levelUp),
  );

  // ---- hero mastery gain (the hero is derived from the profile diff made by applyMatch)
  let mHero: HeroId | null = null;
  let mGain = 0;
  for (const id of HERO_ORDER) {
    const d = (after.heroXp?.[id] ?? 0) - (before.heroXp?.[id] ?? 0);
    if (d > mGain) {
      mGain = d;
      mHero = id;
    }
  }
  let playMastery: (() => void) | null = null;
  if (mHero) {
    const hero = mHero;
    const mb = heroMastery(before, hero);
    const ma = heroMastery(after, hero);
    const mEl = masteryEl(before, hero, true);
    mEl.classList.add('mg-end-mast');
    const mk = mEl.querySelector('.mg-mastery-k');
    if (mk) mk.textContent = t('end.mastery', { h: heroName(hero) });
    const mLv = mEl.querySelector<HTMLElement>('.mg-mastery-lv');
    if (mLv) mLv.textContent = '+' + fmtNum(mGain) + ' XP';
    const mHex = mEl.querySelector<HTMLElement>('.mg-mastery-hex > span');
    const mFill = mEl.querySelector<HTMLElement>('.mg-mastery-fill');
    const unlocked = HEROES[hero].builds.filter((b) => b.unlock > mb.level && b.unlock <= ma.level);
    const note = unlocked.length ? div('mg-end-mast-unlock', ico(UI.star), span('', unlocked.map((b) => t('end.buildUnlocked', { b: bi(b.name) })).join(' · '))) : null;
    xpPanel.append(mEl);
    playMastery = () => {
      const dur = Math.min(2000, 800 + (ma.level - mb.level) * 500);
      const t0 = performance.now();
      let lvl = mb.level;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        const x = mb.xp + (ma.xp - mb.xp) * e;
        const m = heroMastery({ ...after, heroXp: { ...(after.heroXp ?? {}), [hero]: x } }, hero);
        if (m.level !== lvl) {
          lvl = m.level;
          if (mHex) mHex.textContent = String(lvl);
          mEl.classList.remove('is-up');
          void mEl.offsetWidth;
          mEl.classList.add('is-up');
          ctx.snd('confirm');
        }
        if (mFill) mFill.style.transform = `scaleX(${Math.min(1, m.into / m.need)})`;
        if (k < 1) raf = requestAnimationFrame(step);
        else if (note) {
          mEl.after(note);
          ctx.snd('confirm');
        }
      };
      raf = requestAnimationFrame(step);
    };
  }
  const setBar = (into: number, need: number, gainFrom = -1) => {
    barFill.style.transform = `scaleX(${Math.min(1, into / need)})`;
    if (gainFrom >= 0) barGain.style.transform = `scaleX(${Math.min(1, gainFrom / need)})`;
    xpTxt.textContent = t('player.xp', { into: fmtNum(into), need: fmtNum(need) });
  };
  setBar(lb.into, lb.need, lb.into);

  // ---- ribbons
  const ribBox = div('mg-end-ribs');
  const ribPanel = div('mg-end-rib-panel mg-panel', div('mg-end-xp-h', ico(UI.medal), span('', t('end.ribbons'))), ribBox);
  if (!r.ribbons.length) ribBox.appendChild(div('mg-end-norib', t('end.noRibbons')));

  const cont = btn(t('end.continue'), () => onContinue(), { kind: 'primary', big: true, icon: UI.chevR, kbd: 'Enter' });
  cont.setAttribute('data-autofocus', '');
  el.append(banner, div('mg-end-body', board, div('mg-end-side', xpPanel, ribPanel)), div('mg-end-foot', cont));

  // ---- choreography
  let acc = 0;
  const lineDelay = 900;
  r.xp.forEach((x, i) => {
    later(lineDelay + i * 320, () => {
      acc += x.amount;
      const v = span('mg-end-line-v', '+' + fmtNum(x.amount));
      lines.appendChild(div('mg-end-line is-in', span('mg-end-line-l', x.label), v));
      (totalEl.lastElementChild as HTMLElement).textContent = '+' + fmtNum(acc);
      ctx.snd('hover');
    });
  });
  const barStart = lineDelay + r.xp.length * 320 + 250;
  later(barStart, () => {
    totalEl.classList.add('is-in');
    const from = before.xp;
    const to = after.xp;
    const dur = Math.min(2600, 900 + (la.level - lb.level) * 700);
    const t0 = performance.now();
    let shownLevel = lb.level;
    let levelStartXp = from;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = from + (to - from) * e;
      const L = levelFromXp(v);
      if (L.level !== shownLevel) {
        shownLevel = L.level;
        levelStartXp = v - L.into;
        clear(badgeBox);
        badgeBox.appendChild(levelBadge(L.level, 'is-pop'));
        lvlNum.textContent = `${t('player.level')} ${L.level}`;
        rankEl.textContent = rankInfo(L.level, getLang()).title;
        xpPanel.classList.remove('is-levelup');
        void xpPanel.offsetWidth;
        xpPanel.classList.add('is-levelup');
        ctx.snd('confirm');
      }
      const gainFrom = shownLevel === lb.level ? lb.into : 0;
      void levelStartXp;
      setBar(L.into, L.need, gainFrom);
      if (k < 1) raf = requestAnimationFrame(step);
      else playMastery?.();
    };
    raf = requestAnimationFrame(step);
  });
  r.ribbons.forEach((id, i) => {
    later(barStart + 400 + i * 380, () => {
      const medal = div('mg-rib-medal');
      medal.innerHTML = ribbonSvg(id);
      ribBox.appendChild(div('mg-end-rib is-in', medal, div('mg-end-rib-body', div('mg-rib-name', ribbonName(id)), div('mg-rib-desc', ribbonDesc(id)))));
      ctx.snd('confirm');
    });
  });
  void total;

  return {
    el,
    layer: 'overlay',
    destroy: () => {
      timers.forEach((x) => window.clearTimeout(x));
      cancelAnimationFrame(raf);
    },
    onKey: (e) => {
      if (e.key === 'Enter') {
        ctx.snd('confirm');
        onContinue();
        return true;
      }
      return false;
    },
  };
}
