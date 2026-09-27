import type { Lang } from './Types';

/** In-game announcer / popup strings (menus have their own i18n in src/ui). */
const S: Record<string, { ru: string; en: string }> = {
  elimination: { ru: 'УСТРАНЕНИЕ', en: 'ELIMINATION' },
  assist: { ru: 'ПОМОЩЬ', en: 'ASSIST' },
  headshot: { ru: 'В ГОЛОВУ', en: 'HEADSHOT' },
  wallkill: { ru: 'С ПОТОЛКА', en: 'CEILING KILL' },
  suffocated: { ru: 'ЗАДОХНУЛСЯ', en: 'SUFFOCATED' },
  xpCapture: { ru: 'ЗАХВАТ ТОЧКИ', en: 'POINT CAPTURED' },
  xpHeal: { ru: 'ЛЕЧЕНИЕ', en: 'HEALING' },
  xpPod: { ru: 'КАПСУЛА СНАБЖЕНИЯ', en: 'SUPPLY POD' },
  podIncoming: { ru: 'СБРОС СНАБЖЕНИЯ', en: 'SUPPLY DROP INBOUND' },
  podIncomingSub: { ru: 'Супероружие приземляется — отметка на карте', en: 'Super weapon landing — marked on the map' },
  podTaken: { ru: '{name} забирает {weapon}', en: '{name} grabbed {weapon}' },
  nukeReady: { ru: 'ТАКТИЧЕСКАЯ ЯДЕРНАЯ ГОТОВА', en: 'TACTICAL NUKE ARMED' },
  nukeIncoming: { ru: 'ЯДЕРНЫЙ УДАР!', en: 'NUCLEAR LAUNCH DETECTED' },
  orbital: { ru: 'ОРБИТАЛЬНЫЙ УДАР «ГЕЛИОС»', en: 'HELIOS ORBITAL STRIKE' },
  breach: { ru: 'РАЗГЕРМЕТИЗАЦИЯ СКАФАНДРА', en: 'SUIT BREACH' },
  breachSub: { ru: 'Нажмите {key}, чтобы заделать', en: 'Press {key} to seal' },
  captured: { ru: 'ТОЧКА {id} ЗАХВАЧЕНА', en: 'POINT {id} CAPTURED' },
  lost: { ru: 'ТОЧКА {id} ПОТЕРЯНА', en: 'POINT {id} LOST' },
  victory: { ru: 'ПОБЕДА', en: 'VICTORY' },
  defeat: { ru: 'ПОРАЖЕНИЕ', en: 'DEFEAT' },
  draw: { ru: 'НИЧЬЯ', en: 'DRAW' },
  ultReady: { ru: 'УЛЬТА ГОТОВА', en: 'ULTIMATE READY' },
  streak: { ru: 'СЕРИЯ ×{n}', en: '{n} KILL STREAK' },
  multikill: { ru: 'МУЛЬТИКИЛЛ ×{n}', en: 'MULTIKILL ×{n}' },
  outOfBounds: { ru: 'ВЫ ПОКИДАЕТЕ ЗОНУ БОЯ', en: 'LEAVING THE COMBAT ZONE' },
  matchStart: { ru: 'БОЙ НАЧАЛСЯ', en: 'FIGHT!' },
  deployTurret: { ru: 'ТУРЕЛЬ РАЗВЁРНУТА', en: 'TURRET DEPLOYED' },
  joined: { ru: '{name} присоединился', en: '{name} joined' },
  left: { ru: '{name} покинул бой', en: '{name} left' },
  hostLost: { ru: 'Связь с хостом потеряна', en: 'Lost connection to host' },
  overheat: { ru: 'ПЕРЕГРЕВ — СБРОС ТЕПЛА', en: 'OVERHEATED — VENTING' },
  salvage: { ru: 'УТИЛИЗАЦИЯ: +40 HP', en: 'SALVAGE: +40 HP' },
  pk_o2: { ru: 'КИСЛОРОДНЫЙ БАЛЛОН', en: 'O₂ CANISTER' },
  pk_armor: { ru: 'БРОНЕКОМПЛЕКТ', en: 'ARMOUR PACK' },
  pk_ammo: { ru: 'ЭНЕРГОЯЧЕЙКА', en: 'POWER CELL' },
  pk_grenade: { ru: 'НАБОР СНАРЯЖЕНИЯ', en: 'GADGET KIT' },
  hpShort: { ru: 'ОЗ', en: 'HP' },
  suitShort: { ru: 'скафандр', en: 'suit' },
  ultShort: { ru: 'ульта', en: 'ult' },
};

let lang: Lang = 'en';
export function setGameLang(l: Lang): void {
  lang = l;
}
export function gameLang(): Lang {
  return lang;
}
export function gs(key: string, vars?: Record<string, string | number>): string {
  const e = S[key];
  let s = e ? e[lang] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace('{' + k + '}', String(v));
  return s;
}
