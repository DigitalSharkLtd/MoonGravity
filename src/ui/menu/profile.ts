import { HERO_ORDER, HEROES, levelFromXp, MODES, type HeroId, type Profile } from '../../game/Types';
import { clear, div, fmtDuration, fmtNum, h, ico, pct, ratio, span } from '../dom';
import { fmtDate, fmtDateTime, getLang, heroName, mapName, modeName, RIBBON_ORDER, ribbonDesc, ribbonName, t } from '../i18n';
import { MODE_ICON, ribbonSvg, ROLE_ICON, UI } from '../icons';
import { heroMastery, rankInfo } from '../Storage';
import type { MenuCtx, ProfileTab, ScreenInst } from './ctx';
import { btn, header, iconBtn, levelBadge, portrait, sectionTitle, statTile, tabs, xpBar } from './widgets';
import { masteryEl } from './herokit';

function favoriteHero(p: Profile): HeroId {
  let best: HeroId = p.selectedHero;
  let bt = -1;
  for (const id of HERO_ORDER) {
    const x = p.heroes[id];
    if (x && x.time > bt) {
      bt = x.time;
      best = id;
    }
  }
  return best;
}

function donut(wins: number, losses: number, draws: number): HTMLElement {
  const total = Math.max(1, wins + losses + draws);
  const r = 42;
  const c = 2 * Math.PI * r;
  const seg = (v: number, off: number, cls: string) =>
    `<circle class="${cls}" cx="50" cy="50" r="${r}" fill="none" stroke-width="10" stroke-dasharray="${((v / total) * c).toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-off * c).toFixed(2)}" transform="rotate(-90 50 50)"/>`;
  const el = div('mg-donut');
  el.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="none" stroke-width="10" class="bg"/>${seg(wins, 0, 'w')}${seg(losses, wins / total, 'l')}${seg(draws, (wins + losses) / total, 'd')}</svg>`;
  el.appendChild(div('mg-donut-c', div('mg-donut-v', wins + losses + draws > 0 ? Math.round((wins / total) * 100) + '%' : '—'), div('mg-donut-l', t('stat.winrate'))));
  return el;
}

function topRibbons(p: Profile): HTMLElement {
  const top = RIBBON_ORDER.filter((id) => (p.ribbons[id] ?? 0) > 0)
    .sort((a, b) => (p.ribbons[b] ?? 0) - (p.ribbons[a] ?? 0))
    .slice(0, 4);
  if (!top.length) return div('mg-id-sub is-empty');
  return div(
    'mg-id-sub',
    span('mg-k', t('profile.tab.ribbons')),
    div(
      'mg-id-ribs',
      ...top.map((id) => {
        const m = div('mg-id-rib-medal');
        m.innerHTML = ribbonSvg(id);
        const el = div('mg-id-rib', m, span('mg-id-rib-n', '×' + fmtNum(p.ribbons[id] ?? 0)));
        el.title = ribbonName(id);
        return el;
      }),
    ),
  );
}

export function buildProfile(ctx: MenuCtx): ScreenInst {
  const st = ctx.state;
  const el = div('mg-page mg-profile');
  const tabBar = tabs<ProfileTab>(
    [
      { id: 'overview', label: t('profile.tab.overview'), icon: UI.chart },
      { id: 'heroes', label: t('profile.tab.heroes'), icon: UI.helmet },
      { id: 'history', label: t('profile.tab.history'), icon: UI.history },
      { id: 'ribbons', label: t('profile.tab.ribbons'), icon: UI.medal },
    ],
    st.profileTab,
    (id) => {
      st.profileTab = id;
      renderTab();
      // re-mark tabs
      tabBar.querySelectorAll('.mg-tab').forEach((b, i) => b.classList.toggle('is-active', ['overview', 'heroes', 'history', 'ribbons'][i] === id));
    },
  );
  const idcard = div('mg-idcard mg-panel');
  const main = div('mg-prof-main mg-scroll');
  el.append(header(t('profile.title'), () => ctx.back(), tabBar), div('mg-prof-body', idcard, main));

  const renderId = () => {
    const p = ctx.profile;
    clear(idcard);
    const lv = levelFromXp(p.xp);
    const rank = rankInfo(lv.level, getLang());
    const fav = favoriteHero(p);
    const banner = div('mg-id-banner', portrait(fav, ctx.portraits, true, 'mg-id-banner-pic', 'xMidYMid slice'));
    banner.style.setProperty('--hc', HEROES[fav].color);

    const nameBox = div('mg-id-name');
    const showName = () => {
      clear(nameBox);
      const edit = iconBtn(UI.edit, () => editName(), t('profile.edit'), 'mg-id-edit');
      nameBox.append(span('mg-id-name-t', p.name), edit);
    };
    const editName = () => {
      clear(nameBox);
      const input = h('input', { class: 'mg-input mg-id-input', type: 'text', value: p.name, maxlength: 16, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
      const save = () => {
        const v = input.value.replace(/\s+/g, ' ').trim();
        if (v.length < 2 || v.length > 16) {
          input.classList.add('is-bad');
          ctx.toast(t('profile.nameInvalid'), 'bad');
          return;
        }
        if (v !== ctx.profile.name) {
          ctx.applyProfile({ ...ctx.profile, name: v });
          if (ctx.settings.playerName !== v) ctx.applySettings({ ...ctx.settings, playerName: v });
          ctx.toast(t('profile.nameSaved'), 'good');
        }
        renderId();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          ctx.snd('confirm');
          save();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          renderId();
        }
      });
      nameBox.append(input, btn(t('profile.save'), save, { kind: 'primary', cls: 'mg-btn--sm', icon: UI.check }));
      input.focus();
      input.select();
    };
    showName();

    const s = p.stats;
    idcard.append(
      banner,
      div('mg-id-badge', levelBadge(lv.level)),
      nameBox,
      div('mg-id-rank mg-tier-text--' + rank.tier, span('', rank.title), span('mg-id-lv', `${t('player.level')} ${lv.level}`)),
      div('mg-id-xp', xpBar(lv.into, lv.need, 'mg-xpbar--lg'), div('mg-id-xp-row', span('', t('player.xp', { into: fmtNum(lv.into), need: fmtNum(lv.need) })), span('', t('profile.nextLevel', { n: lv.level + 1, x: fmtNum(lv.need - lv.into) })))),
      div('mg-id-quick', statTile(t('stat.matches'), fmtNum(s.matches)), statTile(t('stat.winrate'), pct(s.wins, s.matches)), statTile(t('stat.kd'), ratio(s.kills, s.deaths))),
      div('mg-id-sub', span('mg-k', t('profile.favorite')), masteryEl(p, fav, true)),
      topRibbons(p),
      div('mg-id-foot', div('mg-id-row', span('mg-k', t('profile.totalXp')), span('', fmtNum(p.xp) + ' XP')), div('mg-id-row', span('mg-k', t('profile.favorite')), span('mg-id-fav', ico(ROLE_ICON[HEROES[fav].role]), heroName(fav))), div('mg-id-since', ico(UI.clock), span('', t('profile.since', { date: fmtDate(p.createdAt) })))),
    );
  };

  const renderOverview = () => {
    const s = ctx.profile.stats;
    const draws = Math.max(0, s.matches - s.wins - s.losses);
    const acc = s.shotsFired > 0 ? Math.round((s.shotsHit / s.shotsFired) * 100) + '%' : '—';
    const hsr = s.kills > 0 ? Math.round((s.headshots / s.kills) * 100) + '%' : '—';
    const top = div(
      'mg-ov-top mg-panel',
      donut(s.wins, s.losses, draws),
      div('mg-ov-legend', div('w', span('sw'), t('stat.wins'), span('v', fmtNum(s.wins))), div('l', span('sw'), t('stat.losses'), span('v', fmtNum(s.losses))), div('d', span('sw'), t('result.draw'), span('v', fmtNum(draws)))),
      div('mg-ov-big', statTile(t('stat.kills'), fmtNum(s.kills), UI.skull, 'is-big'), statTile(t('stat.kd'), ratio(s.kills, s.deaths), UI.swords, 'is-big'), statTile(t('stat.time'), fmtDuration(s.timePlayed, getLang()), UI.clock, 'is-big')),
    );
    const grid = (items: HTMLElement[]) => div('mg-stat-grid', ...items);
    main.append(
      top,
      sectionTitle(t('profile.sec.combat'), UI.swords),
      grid([statTile(t('stat.deaths'), fmtNum(s.deaths)), statTile(t('stat.assists'), fmtNum(s.assists)), statTile(t('stat.damage'), fmtNum(s.damageDealt)), statTile(t('stat.bestStreak'), fmtNum(s.bestStreak)), statTile(t('stat.matches'), fmtNum(s.matches))]),
      sectionTitle(t('profile.sec.precision'), UI.target),
      grid([statTile(t('stat.accuracy'), acc), statTile(t('stat.headshots'), fmtNum(s.headshots)), statTile(t('stat.hsRate'), hsr), statTile(t('stat.longestKill'), t('common.m', { n: Math.round(s.longestKill) })), statTile(t('stat.shots'), fmtNum(s.shotsFired))]),
      sectionTitle(t('profile.sec.lunar'), UI.moon),
      grid([
        statTile(t('stat.captures'), fmtNum(s.captures), UI.flag),
        statTile(t('stat.wallKills'), fmtNum(s.wallKills), UI.boot),
        statTile(t('stat.suffocations'), fmtNum(s.suffocations), UI.o2),
        statTile(t('stat.nukes'), fmtNum(s.nukes), UI.radiation),
      ]),
    );
  };

  const renderHeroes = () => {
    const p = ctx.profile;
    const ids = [...HERO_ORDER].sort((a, b) => (p.heroes[b]?.time ?? -1) - (p.heroes[a]?.time ?? -1));
    const maxT = Math.max(1, ...ids.map((id) => p.heroes[id]?.time ?? 0));
    const table = div('mg-htable mg-panel');
    table.appendChild(div('mg-htr mg-htr--head', div('', t('profile.col.hero')), div('', t('mastery.short')), div('', t('profile.col.time')), div('', t('stat.matches')), div('', t('stat.winrate')), div('', t('stat.kd')), div('', t('stat.damage')), div('', t('stat.healing'))));
    for (const id of ids) {
      const x = p.heroes[id];
      const fill = div('mg-htr-fill');
      fill.style.transform = `scaleX(${x ? Math.max(0.02, x.time / maxT) : 0})`;
      const ms = heroMastery(p, id);
      const mfill = div('mg-htr-mfill');
      mfill.style.transform = `scaleX(${Math.min(1, ms.into / ms.need)})`;
      const row = div(
        'mg-htr mg-hover' + (x ? '' : ' is-empty'),
        div('mg-htr-hero', portrait(id, ctx.portraits, true, 'mg-htr-pic'), div('', div('mg-htr-name', heroName(id)), div('mg-htr-role', ico(ROLE_ICON[HEROES[id].role]), t('role.' + HEROES[id].role)))),
        div('mg-htr-mastery', span('mg-htr-mlv', String(ms.level)), div('mg-htr-mbar', mfill)),
        div('mg-htr-time', div('mg-htr-bar', fill), span('', x ? fmtDuration(x.time, getLang()) : '—')),
        div('', x ? fmtNum(x.matches) : '—'),
        div('', x ? pct(x.wins, x.matches) : '—'),
        div('', x ? ratio(x.kills, x.deaths) : '—'),
        div('', x ? fmtNum(x.damage) : '—'),
        div('', x ? fmtNum(x.healing) : '—'),
      );
      row.style.setProperty('--hc', HEROES[id].color);
      table.appendChild(row);
    }
    main.appendChild(table);
  };

  const renderHistory = () => {
    const hist = ctx.profile.history;
    if (!hist.length) {
      main.appendChild(div('mg-empty mg-panel', ico(UI.history), span('', t('profile.noHistory'))));
      return;
    }
    const list = div('mg-hist');
    list.appendChild(div('mg-hist-row mg-hist-row--head', div('', t('profile.col.result')), div('', t('profile.col.mode')), div('', t('profile.col.date')), div('', t('profile.col.kda')), div('', t('profile.col.score')), div('', t('profile.col.xp'))));
    for (const m of hist) {
      const team = MODES[m.mode]?.teams ?? true;
      const res = m.won === true ? 'win' : m.won === false ? 'loss' : 'draw';
      const label = !team ? t('result.place', { n: m.placement }) : t('result.' + res);
      const cls = !team ? (m.placement <= 3 ? 'win' : 'loss') : res;
      list.appendChild(
        div(
          'mg-hist-row mg-hover is-' + cls,
          div('mg-hist-res', span('mg-hist-stripe'), span('', label)),
          div('mg-hist-mode', ico(MODE_ICON[m.mode] ?? UI.flag), div('', div('mg-hist-mode-n', modeName(m.mode)), div('mg-hist-map', mapName(m.map)))),
          div('mg-hist-date', fmtDateTime(m.t)),
          div('mg-hist-kda', span('k', String(m.kills)), span('s', '/'), span('d', String(m.deaths)), span('s', '/'), span('a', String(m.assists))),
          div('mg-hist-score', fmtNum(m.score)),
          div('mg-hist-xp', '+' + fmtNum(m.xp)),
        ),
      );
    }
    main.appendChild(div('mg-panel mg-hist-wrap', list));
  };

  const renderRibbons = () => {
    const rb = ctx.profile.ribbons;
    const got = RIBBON_ORDER.filter((id) => (rb[id] ?? 0) > 0).length;
    const grid = div('mg-rib-grid');
    for (const id of RIBBON_ORDER) {
      const n = rb[id] ?? 0;
      const medal = div('mg-rib-medal');
      medal.innerHTML = ribbonSvg(id, n === 0);
      grid.appendChild(div('mg-rib mg-hover' + (n ? '' : ' is-locked'), medal, div('mg-rib-name', ribbonName(id)), div('mg-rib-desc', ribbonDesc(id)), div('mg-rib-count', n ? '×' + fmtNum(n) : span('', ico(UI.lock), t('profile.locked')))));
    }
    const prog = div('mg-rib-prog-bar', div('mg-rib-prog-fill'));
    (prog.firstElementChild as HTMLElement).style.transform = `scaleX(${got / RIBBON_ORDER.length})`;
    main.append(div('mg-rib-head', span('', t('profile.ribbonsCount', { n: got, m: RIBBON_ORDER.length })), prog), grid);
  };

  const renderTab = () => {
    clear(main);
    main.scrollTop = 0;
    main.setAttribute('data-tab', st.profileTab);
    if (st.profileTab === 'overview') renderOverview();
    else if (st.profileTab === 'heroes') renderHeroes();
    else if (st.profileTab === 'history') renderHistory();
    else renderRibbons();
  };

  renderId();
  renderTab();
  return {
    el,
    layer: 'front',
    refresh: (what) => {
      if (what === 'profile' || what === 'portraits') {
        renderId();
        renderTab();
        return true;
      }
      return what === 'net' || what === 'settings';
    },
  };
}
