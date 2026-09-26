import { HEROES, MODES, type MapId, type ModeId, type ScoreRow } from '../../game/Types';
import { esc, fmtNum, fmtTime } from '../dom';
import { heroName, mapName, modeName, t } from '../i18n';
import { HERO_ICON, MODE_ICON, UI } from '../icons';

export interface ScoreInfo {
  mode: ModeId;
  teamScores: number[];
  timeLeft: number;
  localTeam: number;
  mapId: MapId;
}

/** OW-style Tab scoreboard. Rebuilt from rows (event-driven, throttled by the HUD). */
export function renderScoreboard(el: HTMLElement, rows: ScoreRow[], info: ScoreInfo): void {
  const teams = MODES[info.mode]?.teams ?? true;
  const head = `<div class="mg-hsbr mg-hsbr--head"><div></div><div>${esc(t('col.player'))}</div><div>${esc(t('col.e'))}</div><div>${esc(t('col.a'))}</div><div>${esc(t('col.d'))}</div><div>${esc(t('col.score'))}</div><div>${esc(t('col.damage'))}</div><div>${esc(t('col.healing'))}</div><div>${esc(t('col.ping'))}</div></div>`;
  const row = (r: ScoreRow, place?: number) => {
    const hc = HEROES[r.hero]?.color ?? '#fff';
    return `<div class="mg-hsbr${r.isLocal ? ' is-local' : ''}${r.alive ? '' : ' is-dead'}">
<div class="mg-hsbr-hero">${place !== undefined ? `<span class="mg-hsbr-place">${place}</span>` : ''}<span class="mg-hsbr-ico" style="--hc:${hc}" title="${esc(heroName(r.hero))}"><span class="mg-ico">${HERO_ICON[r.hero] ?? ''}</span></span></div>
<div class="mg-hsbr-name"><span class="n">${esc(r.name)}</span>${r.isBot ? `<span class="mg-tag-bot">${esc(t('common.bot'))}</span>` : ''}${r.alive ? '' : `<span class="mg-hsbr-dead mg-ico">${UI.skull}</span>`}</div>
<div class="k">${r.kills}</div><div>${r.assists}</div><div>${r.deaths}</div><div class="s">${fmtNum(r.score)}</div><div>${fmtNum(r.damage)}</div><div>${fmtNum(r.healing)}</div><div class="p">${r.isBot ? '—' : r.ping > 0 ? r.ping : '—'}</div></div>`;
  };
  let body = '';
  if (teams) {
    const order = [info.localTeam === 1 ? 1 : 0, info.localTeam === 1 ? 0 : 1];
    for (const tm of order) {
      const rs = rows.filter((r) => r.team === tm).sort((a, b) => b.score - a.score);
      body += `<div class="mg-hsbt t${tm}${tm === info.localTeam ? ' is-ally' : ' is-enemy'}"><div class="mg-hsbt-h"><span class="n">${esc(t('team.' + tm))}</span><span class="s">${info.teamScores[tm] ?? 0}</span></div>${rs.map((r) => row(r)).join('')}</div>`;
    }
  } else {
    const rs = [...rows].sort((a, b) => b.score - a.score);
    body = `<div class="mg-hsbt is-ffa">${rs.map((r, i) => row(r, i + 1)).join('')}</div>`;
  }
  const scores = teams
    ? `<div class="mg-hsb-score"><span class="a t${info.localTeam === 1 ? 1 : 0}">${info.teamScores[info.localTeam === 1 ? 1 : 0] ?? 0}</span><span class="c">:</span><span class="b t${info.localTeam === 1 ? 0 : 1}">${info.teamScores[info.localTeam === 1 ? 0 : 1] ?? 0}</span></div>`
    : `<div class="mg-hsb-score"><span class="c">${esc(t('hud.limit', { n: MODES[info.mode].scoreLimit }))}</span></div>`;
  el.innerHTML = `<div class="mg-hsb-panel"><div class="mg-hsb-top"><div class="mg-hsb-mode"><span class="mg-ico">${MODE_ICON[info.mode] ?? ''}</span><span>${esc(modeName(info.mode))}</span><span class="mg-hsb-map">${esc(mapName(info.mapId))}</span></div>${scores}<div class="mg-hsb-time"><span class="mg-ico">${UI.clock}</span><span>${fmtTime(info.timeLeft)}</span></div></div>${head}${body}</div>`;
}
