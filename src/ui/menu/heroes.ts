import { HERO_ORDER, HEROES, ROLE_PASSIVE, type AbilityDef, type HeroId, type PassiveId } from '../../game/Types';
import { clear, div, fmtDuration, fmtNum, h, ico, ratio, span } from '../dom';
import { abilityDesc, abilityName, bi, getLang, heroBio, heroCallsign, heroName, heroTagline, keyLabel, passiveDesc, passiveName, rolePassiveDesc, rolePassiveName, t, weaponDesc, weaponName, weaponSkill } from '../i18n';
import { ABILITY_ICON, ROLE_COLOR, ROLE_ICON, ROLE_ORDER, UI, WEAPON_ICON } from '../icons';
import { heroMastery, selectedBuild } from '../Storage';
import type { MenuCtx, ScreenInst } from './ctx';
import { buildsEl, gadgetsEl, masteryEl } from './herokit';
import { heroStage } from './stage';
import { btn, header, kbd, portrait, roleTag, sectionTitle, stars, statTile } from './widgets';

/** icons for the signature passives (reuse the UI set) */
const PASSIVE_ICON: Record<PassiveId, string> = {
  afterburner: UI.jet,
  blastproof: UI.shieldPlus,
  spotter: UI.headshot,
  backstab: UI.eyeOff,
  moonstep: UI.moon,
  fusion: ROLE_ICON.tank,
  lifelink: UI.heart,
  fieldrepair: UI.gear,
  dronelink: UI.target,
};

export function buildHeroes(ctx: MenuCtx): ScreenInst {
  const st = ctx.state;
  if (!HEROES[st.heroesSel]) st.heroesSel = ctx.profile.selectedHero;
  const el = div('mg-page mg-heroes');
  const roster = div('mg-roster mg-scroll');
  const stageBox = div('mg-heroes-stage');
  const detail = div('mg-hd mg-panel');
  el.append(header(t('heroes.title'), () => ctx.back()), div('mg-heroes-body', roster, stageBox, detail));

  const tiles = new Map<HeroId, HTMLElement>();
  for (const role of ROLE_ORDER) {
    const ids = HERO_ORDER.filter((id) => HEROES[id].role === role);
    if (!ids.length) continue;
    const row = div('mg-roster-row');
    row.style.setProperty('--rc', ROLE_COLOR[role]);
    const lab = div('mg-roster-role', ico(ROLE_ICON[role]), span('mg-roster-role-t', t('role.' + role)));
    lab.title = t('role.' + role);
    const grid = div('mg-roster-grid');
    for (const id of ids) {
      const lvl = heroMastery(ctx.profile, id).level;
      const tile = h(
        'button',
        { class: 'mg-htile', type: 'button', 'data-snd': 'click', title: heroName(id) },
        portrait(id, ctx.portraits, true, 'mg-htile-pic'),
        span('mg-htile-name', heroName(id)),
        span('mg-htile-lv', String(lvl)),
        span('mg-htile-sel', ico(UI.check)),
      );
      tile.style.setProperty('--hc', HEROES[id].color);
      tile.addEventListener('click', () => select(id));
      tile.addEventListener('dblclick', () => pick(id));
      tiles.set(id, tile);
      grid.appendChild(tile);
    }
    row.append(lab, grid);
    roster.appendChild(row);
  }

  let stage: { el: HTMLElement; destroy(): void } | null = null;

  const pick = (id: HeroId) => {
    if (ctx.profile.selectedHero !== id) {
      ctx.applyProfile({ ...ctx.profile, selectedHero: id });
      ctx.toast(t('heroes.picked', { h: heroName(id) }), 'good');
    }
    syncTiles();
    renderDetail();
  };

  const syncTiles = () => {
    for (const [id, tile] of tiles) {
      tile.classList.toggle('is-active', id === st.heroesSel);
      tile.classList.toggle('is-picked', id === ctx.profile.selectedHero);
    }
  };

  const renderStage = () => {
    stage?.destroy();
    clear(stageBox);
    const id = st.heroesSel;
    stage = heroStage(ctx, id, 'mg-heroes-stagebox');
    const watermark = div('mg-heroes-wm', heroName(id));
    stageBox.append(watermark, stage.el);
    stageBox.style.setProperty('--hc', HEROES[id].color);
  };

  const abilityRow = (a: AbilityDef, key: string, ult: boolean, ultCost = 0) => {
    const meta: string[] = [];
    if (!ult && a.cooldown > 0) meta.push(t('heroes.cooldown', { s: a.cooldown }));
    if (a.duration > 0) meta.push(t('heroes.duration', { s: a.duration }));
    if (a.charges > 1) meta.push(t('heroes.charges', { n: a.charges }));
    if (ult) meta.push(t('heroes.ultCost', { n: fmtNum(ultCost) }));
    return div(
      'mg-abil' + (ult ? ' is-ult' : ''),
      div('mg-abil-ico', ico(ABILITY_ICON[a.id] ?? UI.star), kbd(keyLabel(key), 'mg-abil-key')),
      div('mg-abil-body', div('mg-abil-name', abilityName(a.id), ult ? span('mg-abil-ult', t('heroes.ult')) : null), div('mg-abil-meta', meta.map((m) => span('', m))), div('mg-abil-desc', abilityDesc(a.id))),
    );
  };

  const renderDetail = () => {
    const id = st.heroesSel;
    const hd = HEROES[id];
    detail.style.setProperty('--hc', hd.color);
    const scrollTop = detail.querySelector('.mg-hd-scroll')?.scrollTop ?? 0;
    clear(detail);
    const keys = ctx.settings.keys;
    const mine = ctx.profile.heroes[id];
    const picked = ctx.profile.selectedHero === id;

    const bars = div('mg-hd-bars');
    const mk = (label: string, val: string, k: number, icon: string) => {
      const fill = div('mg-hbar-fill');
      fill.style.transform = `scaleX(${Math.max(0.04, Math.min(1, k))})`;
      bars.appendChild(div('mg-hbar', ico(icon), span('mg-hbar-l', label), div('mg-hbar-track', fill), span('mg-hbar-v', val)));
    };
    mk(t('heroes.health'), String(hd.health), hd.health / 300, UI.heart);
    mk(t('heroes.suit'), String(hd.suit), hd.suit / 200, UI.suit);
    mk(t('heroes.speed'), t('heroes.speedVal', { n: hd.speed.toFixed(1) }), (hd.speed - 4.4) / 1.5, UI.speed);

    const wIco = div('mg-hd-weapon-ico');
    wIco.innerHTML = WEAPON_ICON[hd.weapon] ?? '';
    const skill = weaponSkill(hd.weapon);
    const weapon = div(
      'mg-hd-weapon',
      wIco,
      div('mg-hd-weapon-body', div('mg-k', t('heroes.weapon')), div('mg-hd-weapon-name', weaponName(hd.weapon)), div('mg-hd-weapon-desc', weaponDesc(hd.weapon)), skill ? div('mg-hd-weapon-desc', span('mg-k', t('heroes.skill') + ': '), skill) : null),
    );

    const abil = div(
      'mg-hd-abils',
      abilityRow(hd.ability1, keys.ability1, false),
      abilityRow(hd.ability2, keys.ability2, false),
      abilityRow(hd.ultimate, keys.ultimate, true, hd.ultCost),
      div('mg-abil is-kit', div('mg-abil-ico', ico(PASSIVE_ICON[hd.passive] ?? UI.star)), div('mg-abil-body', div('mg-abil-name', passiveName(hd.passive), span('mg-abil-ult', t('heroes.signature'))), div('mg-abil-desc', passiveDesc(hd.passive)))),
      div('mg-abil is-kit', div('mg-abil-ico', ico(ROLE_ICON[hd.role])), div('mg-abil-body', div('mg-abil-name', rolePassiveName(ROLE_PASSIVE[hd.role]), span('mg-abil-ult', t('heroes.rolePerk'))), div('mg-abil-desc', rolePassiveDesc(ROLE_PASSIVE[hd.role])))),
      div('mg-abil is-kit', div('mg-abil-ico', ico(UI.sealant), kbd(keyLabel(keys.sealant), 'mg-abil-key')), div('mg-abil-body', div('mg-abil-name', t('heroes.passive')), div('mg-abil-desc', t('heroes.sealants', { n: hd.sealants })))),
    );

    const builds = buildsEl(
      ctx.profile,
      id,
      selectedBuild(ctx.profile, id),
      (b) => {
        ctx.applyProfile({ ...ctx.profile, builds: { ...(ctx.profile.builds ?? {}), [id]: b } });
        const def = hd.builds.find((x) => x.id === b);
        ctx.toast(t('build.picked', { b: bi(def?.name) }), 'good');
      },
      (lvl) => ctx.toast(t('build.lockedHint', { n: lvl }), 'bad'),
    );

    let mineEl: HTMLElement;
    if (mine && mine.matches > 0) {
      mineEl = div(
        'mg-hd-mine-grid',
        statTile(t('stat.matches'), fmtNum(mine.matches)),
        statTile(t('stat.winrate'), Math.round((mine.wins / Math.max(1, mine.matches)) * 100) + '%'),
        statTile(t('stat.kd'), ratio(mine.kills, mine.deaths)),
        statTile(t('stat.time'), fmtDuration(mine.time, getLang())),
        statTile(t('stat.damage'), fmtNum(mine.damage)),
        hd.role === 'support' ? statTile(t('stat.healing'), fmtNum(mine.healing)) : statTile(t('stat.kills'), fmtNum(mine.kills)),
      );
    } else mineEl = div('mg-hd-empty', ico(UI.chart), span('', t('heroes.noStats')));

    const cta = picked
      ? btn(t('heroes.selected'), () => {}, { kind: 'ghost', icon: UI.check, cls: 'mg-hd-cta is-picked', disabled: true })
      : btn(t('heroes.select'), () => pick(id), { kind: 'primary', big: true, icon: UI.check, cls: 'mg-hd-cta' });

    const scroll = div(
      'mg-hd-scroll mg-scroll',
      div('mg-hd-top', div('mg-hd-roleline', roleTag(hd.role), span('mg-hd-diff', span('mg-k', t('heroes.difficulty')), stars(hd.difficulty))), div('mg-hd-name', heroName(id)), div('mg-hd-callsign', heroCallsign(id)), div('mg-hd-tag', '«' + heroTagline(id) + '»'), h('p', { class: 'mg-hd-bio' }, heroBio(id))),
      masteryEl(ctx.profile, id),
      bars,
      weapon,
      sectionTitle(t('heroes.abilities'), UI.gear),
      abil,
      sectionTitle(t('build.title'), UI.sliders),
      builds,
      sectionTitle(t('gadgets.title'), ABILITY_ICON.grapple),
      gadgetsEl(ctx.settings),
      sectionTitle(t('heroes.yourStats'), UI.chart),
      mineEl,
    );
    detail.append(scroll, div('mg-hd-foot', cta));
    scroll.scrollTop = scrollTop;
  };

  const select = (id: HeroId) => {
    if (st.heroesSel === id) return;
    st.heroesSel = id;
    syncTiles();
    renderStage();
    const sc = detail.querySelector('.mg-hd-scroll');
    if (sc) sc.scrollTop = 0;
    renderDetail();
    detail.querySelector('.mg-hd-scroll')?.scrollTo({ top: 0 });
  };

  syncTiles();
  renderStage();
  renderDetail();
  tiles.get(st.heroesSel)?.setAttribute('data-autofocus', '');

  return {
    el,
    layer: 'front',
    destroy: () => stage?.destroy(),
    onKey: (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = HERO_ORDER.indexOf(st.heroesSel);
        const n = HERO_ORDER[(i + (e.key === 'ArrowRight' ? 1 : -1) + HERO_ORDER.length) % HERO_ORDER.length];
        select(n);
        tiles.get(n)?.focus();
        ctx.snd('hover');
        return true;
      }
      if (e.key === 'Enter' && (e.target as HTMLElement | null)?.classList?.contains('mg-htile')) {
        pick(st.heroesSel);
        ctx.snd('confirm');
        return true;
      }
      return false;
    },
    refresh: (what) => {
      if (what === 'profile') {
        syncTiles();
        renderDetail();
        return true;
      }
      return what === 'net';
    },
  };
}
