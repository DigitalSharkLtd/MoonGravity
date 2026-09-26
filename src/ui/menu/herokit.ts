import { HEROES, type HeroId, type Profile, type Settings } from '../../game/Types';
import { div, fmtNum, h, ico, span } from '../dom';
import { bi, keyLabel, t } from '../i18n';
import { ABILITY_ICON, UI } from '../icons';
import { heroMastery, selectedBuild } from '../Storage';
import { kbd } from './widgets';

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** hero mastery: level hex + progress bar */
export function masteryEl(p: Profile, hero: HeroId, compact = false): HTMLElement {
  const m = heroMastery(p, hero);
  const fill = div('mg-mastery-fill');
  fill.style.transform = `scaleX(${Math.min(1, m.into / m.need)})`;
  const el = div(
    'mg-mastery' + (compact ? ' is-compact' : ''),
    div('mg-mastery-hex', span('', String(m.level))),
    div(
      'mg-mastery-body',
      div('mg-mastery-top', span('mg-mastery-k', t('mastery.title')), span('mg-mastery-lv', t('mastery.level', { n: m.level }))),
      div('mg-mastery-bar', fill),
      compact ? null : div('mg-mastery-xp', t('mastery.xp', { into: fmtNum(m.into), need: fmtNum(m.need) })),
    ),
  );
  el.style.setProperty('--hc', HEROES[hero].color);
  return el;
}

/**
 * Build (talent path) picker. Locked builds are greyed out with "Lv. N".
 * onPick fires only for unlocked builds; onLocked for locked ones.
 */
export function buildsEl(p: Profile, hero: HeroId, current: string | null, onPick: (id: string) => void, onLocked: (lvl: number) => void, compact = false): HTMLElement {
  const def = HEROES[hero];
  const lvl = heroMastery(p, hero).level;
  const sel = current ?? selectedBuild(p, hero);
  const wrap = div('mg-builds' + (compact ? ' is-compact' : ''));
  wrap.style.setProperty('--hc', def.color);
  const items: HTMLButtonElement[] = [];
  def.builds.forEach((b, i) => {
    const locked = b.unlock > lvl;
    const btn = h(
      'button',
      { class: 'mg-build' + (b.id === sel ? ' is-sel' : '') + (locked ? ' is-locked' : ''), type: 'button', 'data-snd': locked ? 'error' : 'click', title: locked ? t('build.lockedHint', { n: b.unlock }) : '' },
      span('mg-build-idx', ROMAN[i] ?? String(i + 1)),
      div('mg-build-body', div('mg-build-name', bi(b.name)), compact ? null : div('mg-build-desc', bi(b.desc))),
      span('mg-build-state', locked ? span('mg-build-lock', ico(UI.lock), t('build.locked', { n: b.unlock })) : b.id === sel ? ico(UI.check) : null),
    ) as HTMLButtonElement;
    if (compact && !locked) btn.title = bi(b.desc);
    btn.addEventListener('click', () => {
      if (locked) {
        btn.classList.remove('is-shake');
        void btn.offsetWidth;
        btn.classList.add('is-shake');
        onLocked(b.unlock);
        return;
      }
      for (const x of items) {
        x.classList.toggle('is-sel', x === btn);
        const st = x.querySelector('.mg-build-state');
        if (st && !x.classList.contains('is-locked')) st.innerHTML = x === btn ? `<span class="mg-ico">${UI.check}</span>` : '';
      }
      onPick(b.id);
    });
    items.push(btn);
    wrap.appendChild(btn);
  });
  return wrap;
}

/** universal moves & gadgets every fighter has */
export function gadgetsEl(s: Settings): HTMLElement {
  const k = s.keys;
  const items: [string, string, string, string][] = [
    [ABILITY_ICON.grapple, 'gadget.grapple', keyLabel(k.grapple), ''],
    [UI.fist, 'gadget.melee', keyLabel(k.melee), ''],
    [UI.roll, 'gadget.roll', keyLabel(k.roll), ''],
    [UI.prone, 'gadget.prone', keyLabel(k.prone), ''],
    [UI.slide, 'gadget.slide', keyLabel(k.crouch), '+'],
    [UI.mantle, 'gadget.mantle', t('gadget.auto'), 'auto'],
    [UI.jet, 'gadget.jet', keyLabel(k.jump), 'hold'],
    [UI.magnet, 'gadget.mag', keyLabel(k.mag), ''],
    [UI.sealant, 'gadget.sealant', keyLabel(k.sealant), ''],
  ];
  return div(
    'mg-gadgets',
    ...items.map(([icon, key, keyLbl, mod]) =>
      div(
        'mg-gadget mg-hover',
        span('mg-gadget-ico', ico(icon)),
        div('mg-gadget-body', div('mg-gadget-n', span('', t(key)), mod === 'auto' ? span('mg-gadget-auto', keyLbl) : kbd(mod === 'hold' ? keyLbl + ' · ' + t('gadget.hold') : keyLbl)), div('mg-gadget-d', t(key + '.d'))),
      ),
    ),
  );
}
