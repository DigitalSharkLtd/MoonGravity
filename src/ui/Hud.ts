import './fonts';
import './theme.css';
import './hud.css';
import {
  HEROES,
  MODES,
  type AbilityId,
  type HeroId,
  type HudEvent,
  type HudState,
  type MapId,
  type ModeId,
  type ScoreRow,
  type Settings,
  type WeaponId,
} from '../game/Types';
import { ClassSlot, TextSlot, clamp, fmtTime, show } from './dom';
import { abilityName, getLang, heroName, keyLabel, onLangChange, passiveDesc, passiveName, ribbonName, setLang, t, weaponName, weaponShort } from './i18n';
import { ABILITY_ICON, HERO_ICON, ribbonSvg, ROLE_ICON, sourceIcon, UI, WEAPON_ICON } from './icons';
import { Crosshair } from './hud/Crosshair';
import { VisorFx } from './hud/Fx';
import { Compass, Minimap } from './hud/Minimap';
import { renderScoreboard, type ScoreInfo } from './hud/Scoreboard';
import type { PassiveId } from '../game/Types';

/** signature passive icons (reuse the UI icon set) */
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

// ---------------------------------------------------------------------------
// tiny DOM helpers (build-time only)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: Element | null, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function icoEl(svg: string, cls: string, parent?: Element | null): HTMLSpanElement {
  const s = el('span', 'mg-ico ' + cls, parent);
  s.innerHTML = svg;
  return s;
}

const SVGNS = 'http://www.w3.org/2000/svg';

function ringSvg(cls: string, r: number, parent: Element, size = 120): SVGCircleElement {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', cls);
  const bg = document.createElementNS(SVGNS, 'circle');
  bg.setAttribute('cx', String(size / 2));
  bg.setAttribute('cy', String(size / 2));
  bg.setAttribute('r', String(r));
  bg.setAttribute('class', 'bg');
  const fg = document.createElementNS(SVGNS, 'circle');
  fg.setAttribute('cx', String(size / 2));
  fg.setAttribute('cy', String(size / 2));
  fg.setAttribute('r', String(r));
  fg.setAttribute('class', 'fg');
  fg.setAttribute('pathLength', '100');
  fg.setAttribute('stroke-dasharray', '0 100');
  fg.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  svg.append(bg, fg);
  parent.appendChild(svg);
  return fg;
}

class DashSlot {
  private v = -1;
  constructor(readonly c: SVGCircleElement) {}
  set(frac: number): void {
    const q = Math.round(clamp(frac, 0, 1) * 200) / 2;
    if (q === this.v) return;
    this.v = q;
    this.c.setAttribute('stroke-dasharray', q + ' 100');
  }
}

class ScaleSlot {
  private v = -1;
  constructor(
    readonly e: HTMLElement,
    readonly axis: 'X' | 'Y' = 'X',
  ) {}
  set(frac: number): void {
    const q = Math.round(clamp(frac, 0, 1) * 500) / 500;
    if (q === this.v) return;
    this.v = q;
    this.e.style.transform = (this.axis === 'X' ? 'scaleX(' : 'scaleY(') + q + ')';
  }
}

interface AbilitySlot {
  root: HTMLDivElement;
  ico: HTMLSpanElement;
  sweep: HTMLDivElement;
  cd: TextSlot;
  pips: HTMLDivElement;
  key: TextSlot;
  id: AbilityId | null;
  maxCd: number;
  cdQ: number;
  charges: number;
  maxCharges: number;
  active: ClassSlot;
  ready: ClassSlot;
  cooling: ClassSlot;
  wasReady: boolean;
}

interface MarkerEl {
  root: HTMLDivElement;
  ico: HTMLSpanElement;
  label: TextSlot;
  dist: TextSlot;
  hp: ScaleSlot;
  hpWrap: HTMLDivElement;
  arrow: HTMLDivElement;
  kind: string;
  team: string;
  x: number;
  y: number;
  on: boolean;
  onScreen: boolean | null;
  angle: number;
}

interface TimedEl {
  el: HTMLElement;
  until: number;
}

const MARKER_ICON: Record<string, string> = {
  ally: '',
  enemy: '',
  pod: UI.pod,
  cp: '',
  objective: '',
  nuke: UI.radiation,
  squad: '',
  turret: ABILITY_ICON.turret,
  shield: ABILITY_ICON.dome,
  station: ABILITY_ICON.medstation,
  mine: ABILITY_ICON.mine,
  sensor: ABILITY_ICON.sensor,
  drone: ABILITY_ICON.huntdrone,
  servitor: ABILITY_ICON.servitor,
  barricade: ABILITY_ICON.barricade,
  strike: UI.target,
  decoy: ABILITY_ICON.decoy,
};

const DEVICE_KINDS = new Set(['turret', 'shield', 'station', 'mine', 'sensor', 'drone', 'servitor', 'barricade', 'strike', 'decoy']);
const PLAYER_KINDS = new Set(['ally', 'enemy', 'pod', 'cp', 'objective', 'nuke', 'squad']);

const SUMMON_ICON: Record<string, string> = {
  servitor: ABILITY_ICON.servitor,
  turret: ABILITY_ICON.turret,
  drone: ABILITY_ICON.huntdrone,
  barricade: ABILITY_ICON.barricade,
};

const STANCE_ICON: Record<string, string> = {
  stand: UI.profile,
  crouch: UI.profile,
  prone: UI.prone,
  slide: UI.slide,
  roll: UI.roll,
};

export class Hud {
  private readonly root: HTMLDivElement;
  private settings: Settings;
  private shown = true;
  private visibleNow = true;
  private time = 0;
  private vs = 1;

  private readonly fx: VisorFx;
  private readonly crosshair: Crosshair;
  private readonly minimap: Minimap;
  private readonly compass: Compass;
  private readonly i18nEls: [HTMLElement, string][] = [];

  // containers
  private readonly chCenter: HTMLDivElement;
  private readonly center: HTMLDivElement;
  private readonly markers: HTMLDivElement;
  private readonly dmgNums: HTMLDivElement;
  private readonly bl: HTMLDivElement;
  private readonly br: HTMLDivElement;
  private readonly bc: HTMLDivElement;
  private readonly tl: HTMLDivElement;
  private readonly tr: HTMLDivElement;
  private readonly top: HTMLDivElement;

  // vitals
  private hero: HeroId | null = null;
  private readonly portrait: HTMLDivElement;
  private readonly portraitIco: HTMLSpanElement;
  private readonly hpCur: TextSlot;
  private readonly hpMax: TextSlot;
  private readonly suitTxt: TextSlot;
  private readonly segHpBox: HTMLDivElement;
  private readonly segSuitBox: HTMLDivElement;
  private segHp: HTMLElement[] = [];
  private segSuit: HTMLElement[] = [];
  private segHpQ: number[] = [];
  private segSuitQ: number[] = [];
  private readonly vit: HTMLDivElement;
  private readonly lowHp: ClassSlot;
  private readonly suitBreach: ClassSlot;
  private readonly o2Box: HTMLDivElement;
  private readonly o2Fill: ScaleSlot;
  private readonly o2Val: TextSlot;
  private readonly o2Low: ClassSlot;
  private readonly o2Drain: ClassSlot;
  private readonly o2Suff: ClassSlot;
  private readonly o2Lbl: TextSlot;
  private readonly jetFill: ScaleSlot;
  private readonly jetOn: ClassSlot;
  private readonly jetLow: ClassSlot;
  private readonly magBox: HTMLDivElement;
  private readonly magTxt: TextSlot;
  private magState = '';
  private readonly breach: HTMLDivElement;
  private readonly breachOn: ClassSlot;
  private readonly breachTitle: TextSlot;
  private readonly breachLeak: TextSlot;
  private readonly breachKey: TextSlot;
  private readonly breachSeal: TextSlot;

  // weapon & abilities
  private readonly abil: AbilitySlot[] = [];
  private readonly ult: HTMLDivElement;
  private readonly ultRing: DashSlot;
  private readonly ultPct: TextSlot;
  private readonly ultIco: HTMLSpanElement;
  private readonly ultKey: TextSlot;
  private readonly ultReady: ClassSlot;
  private readonly ultActive: ClassSlot;
  private ultId: AbilityId | null = null;
  private readonly ultBanner: HTMLDivElement;
  private weaponId: WeaponId | null = null;
  private readonly wIco: HTMLSpanElement;
  private readonly wName: TextSlot;
  private readonly ammo: TextSlot;
  private readonly magSize: TextSlot;
  private readonly reserve: TextSlot;
  private readonly ammoLow: ClassSlot;
  private readonly ammoEmpty: ClassSlot;
  private readonly reloadBar: ScaleSlot;
  private readonly reloading: ClassSlot;
  private readonly chargeBar: ScaleSlot;
  /** charge bar label (charge / heat / weapon-skill cooldown) + passive chip */
  private chargeLbl!: HTMLElement;
  private chargeKindQ = '';
  private passiveEl!: HTMLDivElement;
  private passiveIco!: HTMLElement;
  private passiveOn!: ClassSlot;
  private passiveQ = '';
  private readonly chargeWrap: HTMLDivElement;
  private readonly slot1: HTMLDivElement;
  private readonly slot1Ico: HTMLSpanElement;
  private readonly slot1Key: TextSlot;
  private readonly slot2: HTMLDivElement;
  private readonly slot2Ico: HTMLSpanElement;
  private readonly slot2Ammo: TextSlot;
  private readonly slot2Key: TextSlot;
  private slot2Id: WeaponId | null = null;
  private readonly sealBox: HTMLDivElement;
  private readonly sealN: TextSlot;
  private readonly sealKey: TextSlot;
  private readonly sealFill: ScaleSlot;
  private readonly segFfBox: HTMLDivElement;
  private segFf: HTMLElement[] = [];
  private segFfQ: number[] = [];
  private ffOn = false;
  private readonly stanceBox: HTMLDivElement;
  private readonly stanceIco: HTMLSpanElement;
  private readonly stanceTxt: TextSlot;
  private stance = '';
  private readonly grapple: HTMLDivElement;
  private readonly grappleSweep: HTMLDivElement;
  private readonly grappleCd: TextSlot;
  private readonly grappleKey: TextSlot;
  private grappleQ = -1;
  private grappleOn: boolean | null = null;
  private readonly summonBox: HTMLDivElement;
  private summonEls: { root: HTMLDivElement; kind: string; hp: ScaleSlot; low: ClassSlot }[] = [];
  private grappleReady!: ClassSlot;
  private grappleActive!: ClassSlot;
  private sealEmpty!: ClassSlot;
  private sealActive!: ClassSlot;
  private slot1Active!: ClassSlot;
  private slot2Active!: ClassSlot;
  private scopedSlot!: ClassSlot;
  private sealingOn!: ClassSlot;
  private readonly ddirA: number[] = [];
  private leakQ = -1;
  private empQ = -1;

  // center
  private readonly hit: HTMLDivElement;
  private hitQ = -1;
  private hitKind = '';
  private readonly reloadRing: DashSlot;
  private readonly reloadRingEl: HTMLElement;
  private readonly chargeArc: DashSlot;
  private readonly chargeArcEl: HTMLElement;
  private readonly ddirs: HTMLDivElement[] = [];
  private readonly ddirQ: number[] = [];
  private readonly prompt: HTMLDivElement;
  private readonly promptTxt: TextSlot;
  private readonly promptKey: TextSlot;
  private readonly lowAmmo: HTMLDivElement;
  private readonly lowAmmoTxt: TextSlot;
  private readonly lowAmmoKey: TextSlot;
  private readonly sealing: HTMLDivElement;
  private readonly sealingFill: ScaleSlot;
  private readonly xpFeed: HTMLDivElement;
  private readonly xpTotal: HTMLDivElement;
  private xpItems: (TimedEl & { amount: number })[] = [];
  private readonly elim: HTMLDivElement;
  private elimUntil = 0;

  // objective
  private objMode: ModeId | null = null;
  private objLocalTeam = -2;
  private readonly obj: HTMLDivElement;
  private objAllyScore: TextSlot | null = null;
  private objEnemyScore: TextSlot | null = null;
  private objAllyFill: ScaleSlot | null = null;
  private objEnemyFill: ScaleSlot | null = null;
  private objTimer: TextSlot | null = null;
  private objLimit: TextSlot | null = null;
  private objRank: TextSlot | null = null;
  private objTimeLow: ClassSlot | null = null;
  private cps: { root: HTMLDivElement; ring: DashSlot; owner: number; cls: string; contested: ClassSlot; inside: ClassSlot; capT: number }[] = [];
  private cpMarkers: { root: HTMLDivElement; dist: TextSlot; ring: DashSlot; owner: number; vis: boolean; x: number; y: number; contested: boolean }[] = [];

  // feeds
  private readonly killfeed: HTMLDivElement;
  private kills: TimedEl[] = [];
  private readonly toasts: HTMLDivElement;
  private toastItems: TimedEl[] = [];
  private readonly bigBox: HTMLDivElement;
  private bigQueue: { title: string; sub?: string; kind: string }[] = [];
  private bigUntil = 0;
  private readonly ribbonBox: HTMLDivElement;
  private ribbonQueue: HudEvent[] = [];
  private ribbonUntil = 0;
  private readonly dmgPool: HTMLDivElement[] = [];
  private dmgIdx = 0;
  private readonly markerPool: MarkerEl[] = [];

  // chat
  private readonly chat: HTMLDivElement;
  private readonly chatLog: HTMLDivElement;
  private readonly chatInputWrap: HTMLDivElement;
  private readonly chatInput: HTMLInputElement;
  private chatLines: TimedEl[] = [];
  private chatSend: ((text: string) => void) | null = null;
  private _chatOpen = false;

  // overlays
  private readonly oob: HTMLDivElement;
  private readonly oobT: TextSlot;
  private readonly death: HTMLDivElement;
  private readonly deathCard: HTMLDivElement;
  private readonly respawnT: TextSlot;
  private readonly respawnRing: DashSlot;
  private readonly respawnLbl: TextSlot;
  private readonly deathHint: HTMLDivElement;
  private readonly deathHintKey: TextSlot;
  private respawnMax = 0;
  private killerSig = '';
  private readonly sb: HTMLDivElement;
  private sbLast = 0;
  private sbSig = '';
  private readonly stats: HTMLDivElement;
  private readonly fpsT: TextSlot;
  private readonly pingT: TextSlot;
  private readonly spectate: HTMLDivElement;
  private readonly spectateT: TextSlot;

  private prevHealth = -1;
  private prevAlive = true;
  private mmAcc = 0;
  private c = {
    alive: null as boolean | null,
    visible: null as boolean | null,
    cloak: null as boolean | null,
    invuln: null as boolean | null,
    scope: '',
    teams: null as boolean | null,
    ffaRank: -1,
    oob: null as boolean | null,
    interact: null as string | null,
    lowAmmo: '',
    fps: -1,
    ping: -1,
    spect: null as string | null,
    onWall: null as boolean | null,
  };

  constructor(root: HTMLElement, settings: Settings) {
    this.settings = settings;
    setLang(settings.language);
    const R = el('div', 'mg-hud mg-ui');
    this.root = R;
    root.appendChild(R);

    this.fx = new VisorFx();
    R.appendChild(this.fx.el);
    this.markers = el('div', 'mg-markers', R);
    this.dmgNums = el('div', 'mg-dmgnums', R);

    // ---------------------------------------------------------------- center
    this.chCenter = el('div', 'mg-chc', R);
    this.crosshair = new Crosshair();
    this.chCenter.appendChild(this.crosshair.el);
    this.hit = el('div', 'mg-hit', this.chCenter);
    for (let i = 0; i < 4; i++) el('i', '', this.hit);
    this.reloadRing = new DashSlot(ringSvg('mg-reload', 26, this.chCenter, 64));
    this.reloadRingEl = this.chCenter.lastElementChild as HTMLElement;
    this.chargeArc = new DashSlot(ringSvg('mg-chargearc', 34, this.chCenter, 80));
    this.chargeArcEl = this.chCenter.lastElementChild as HTMLElement;

    this.center = el('div', 'mg-center', R);
    const dd = el('div', 'mg-ddirs', this.center);
    for (let i = 0; i < 8; i++) {
      const d = el('div', 'mg-ddir', dd);
      d.innerHTML = '<svg viewBox="-100 -100 200 200"><path d="M-62 -150A165 165 0 0 1 62 -150" /></svg>';
      d.style.opacity = '0';
      this.ddirs.push(d);
      this.ddirQ.push(-1);
    }
    this.elim = el('div', 'mg-elim', this.center);
    this.xpFeed = el('div', 'mg-xpfeed', this.center);
    this.xpTotal = el('div', 'mg-xptotal', this.xpFeed);
    this.lowAmmo = el('div', 'mg-lowammo', this.center);
    this.lowAmmoKey = new TextSlot(el('kbd', 'mg-kbd', this.lowAmmo));
    this.lowAmmoTxt = new TextSlot(el('span', '', this.lowAmmo));
    this.prompt = el('div', 'mg-prompt', this.center);
    this.promptKey = new TextSlot(el('kbd', 'mg-kbd', this.prompt));
    this.promptTxt = new TextSlot(el('span', '', this.prompt));
    this.sealing = el('div', 'mg-sealing', this.center);
    const sl = el('span', 'mg-sealing-l', this.sealing);
    this.i18nEls.push([sl, 'hud.sealing']);
    const sb = el('div', 'mg-sealing-bar', this.sealing);
    this.sealingFill = new ScaleSlot(el('i', '', sb));

    // ---------------------------------------------------------------- top-left: minimap + compass
    this.tl = el('div', 'mg-hud-tl', R);
    this.minimap = new Minimap();
    this.tl.appendChild(this.minimap.el);
    this.compass = new Compass(t('compass').split(','));
    this.tl.appendChild(this.compass.el);

    // ---------------------------------------------------------------- top: objective
    this.top = el('div', 'mg-hud-top', R);
    this.obj = el('div', 'mg-obj', this.top);
    this.toasts = el('div', 'mg-hud-toasts', this.top);
    this.spectate = el('div', 'mg-spectate', this.top);
    icoEl(UI.eyeOff.replace('<path d="M4 20 20 4"/>', ''), '', this.spectate);
    this.spectateT = new TextSlot(el('span', '', this.spectate));

    // ---------------------------------------------------------------- top-right: kill feed
    this.tr = el('div', 'mg-hud-tr', R);
    this.stats = el('div', 'mg-hud-stats', this.tr);
    el('span', 'k', this.stats, 'FPS');
    this.fpsT = new TextSlot(el('span', 'v', this.stats));
    el('span', 'k', this.stats, 'PING');
    this.pingT = new TextSlot(el('span', 'v', this.stats));
    this.killfeed = el('div', 'mg-killfeed', this.tr);

    // ---------------------------------------------------------------- bottom-left: vitals
    this.bl = el('div', 'mg-hud-bl', R);
    this.chat = el('div', 'mg-chat', this.bl);
    this.chatLog = el('div', 'mg-chat-log', this.chat);
    this.chatInputWrap = el('div', 'mg-chat-in', this.chat);
    this.chatInput = el('input', 'mg-chat-input', this.chatInputWrap);
    this.chatInput.type = 'text';
    this.chatInput.maxLength = 120;
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = this.chatInput.value.trim();
        const f = this.chatSend;
        this.setChat(false);
        if (v && f) f(v);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.setChat(false);
      }
    });

    this.breach = el('div', 'mg-breach', this.bl);
    icoEl(UI.warning, 'mg-breach-ico', this.breach);
    const bbody = el('div', 'mg-breach-body', this.breach);
    this.breachTitle = new TextSlot(el('div', 'mg-breach-t', bbody));
    this.breachLeak = new TextSlot(el('div', 'mg-breach-leak', bbody));
    const bseal = el('div', 'mg-breach-seal', this.breach);
    this.breachKey = new TextSlot(el('kbd', 'mg-kbd', bseal));
    const bsl = el('span', '', bseal);
    this.i18nEls.push([bsl, 'hud.sealHint']);
    this.breachSeal = new TextSlot(el('b', '', bseal));
    this.breachOn = new ClassSlot(this.breach, 'is-on');

    this.vit = el('div', 'mg-vit', this.bl);
    this.portrait = el('div', 'mg-vit-portrait', this.vit);
    this.portraitIco = icoEl('', 'mg-vit-portrait-ico', this.portrait);
    const vm = el('div', 'mg-vit-main', this.vit);
    const hpRow = el('div', 'mg-vit-hp', vm);
    this.hpCur = new TextSlot(el('span', 'cur', hpRow));
    this.hpMax = new TextSlot(el('span', 'max', hpRow));
    const suitTag = el('span', 'mg-vit-suit', hpRow);
    icoEl(UI.suit, '', suitTag);
    this.suitTxt = new TextSlot(el('span', '', suitTag));
    const bars = el('div', 'mg-vit-bars', vm);
    this.segHpBox = el('div', 'mg-hpsegs mg-hpsegs--hp', bars);
    this.segSuitBox = el('div', 'mg-hpsegs mg-hpsegs--suit', bars);
    this.segFfBox = el('div', 'mg-hpsegs mg-hpsegs--ff', bars);
    this.segFfBox.style.display = 'none';
    for (let i = 0; i < 4; i++) {
      const sg = el('span', 'mg-hpseg', this.segFfBox);
      this.segFf.push(el('i', '', sg));
      this.segFfQ.push(-1);
    }
    this.segFfBox.style.flexGrow = '4';
    this.lowHp = new ClassSlot(this.vit, 'is-low');
    this.suitBreach = new ClassSlot(this.vit, 'is-breached');
    const row = el('div', 'mg-vit-row', vm);
    this.o2Box = el('div', 'mg-o2', row);
    icoEl(UI.o2, 'mg-o2-ico', this.o2Box);
    const o2bar = el('div', 'mg-o2-bar', this.o2Box);
    this.o2Fill = new ScaleSlot(el('i', '', o2bar));
    el('b', 'mg-o2-drain', o2bar);
    this.o2Val = new TextSlot(el('span', 'mg-o2-v', this.o2Box));
    this.o2Lbl = new TextSlot(el('span', 'mg-o2-l', this.o2Box));
    this.o2Low = new ClassSlot(this.o2Box, 'is-low');
    this.o2Drain = new ClassSlot(this.o2Box, 'is-drain');
    this.o2Suff = new ClassSlot(this.o2Box, 'is-suff');
    const jet = el('div', 'mg-jet', row);
    icoEl(UI.jet, 'mg-jet-ico', jet);
    const jbar = el('div', 'mg-jet-bar', jet);
    this.jetFill = new ScaleSlot(el('i', '', jbar));
    this.jetOn = new ClassSlot(jet, 'is-on');
    this.jetLow = new ClassSlot(jet, 'is-low');
    this.magBox = el('div', 'mg-magb', row);
    icoEl(UI.magnet, 'mg-magb-ico', this.magBox);
    this.magTxt = new TextSlot(el('span', 'mg-magb-t', this.magBox));
    this.stanceBox = el('div', 'mg-stance', row);
    this.stanceIco = icoEl(UI.profile, 'mg-stance-ico', this.stanceBox);
    this.stanceTxt = new TextSlot(el('span', 'mg-stance-t', this.stanceBox));
    this.stanceBox.style.display = 'none';
    const sealKeyRow = el('div', 'mg-vit-seal', row);
    this.sealBox = sealKeyRow;
    icoEl(UI.sealant, 'mg-seal-ico', sealKeyRow);
    this.sealN = new TextSlot(el('span', 'mg-seal-n', sealKeyRow));
    this.sealKey = new TextSlot(el('kbd', 'mg-kbd', sealKeyRow));
    const sfb = el('div', 'mg-seal-bar', sealKeyRow);
    this.sealFill = new ScaleSlot(el('i', '', sfb));

    // ---------------------------------------------------------------- bottom-center: ult
    this.bc = el('div', 'mg-hud-bc', R);
    this.ultBanner = el('div', 'mg-ult-banner', this.bc);
    this.i18nEls.push([this.ultBanner, 'hud.ultReady']);
    this.ult = el('div', 'mg-ult', this.bc);
    const ultGlow = el('div', 'mg-ult-glow', this.ult);
    void ultGlow;
    this.ultRing = new DashSlot(ringSvg('mg-ult-ring', 52, this.ult, 120));
    el('div', 'mg-ult-spin', this.ult);
    const ultIn = el('div', 'mg-ult-in', this.ult);
    this.ultPct = new TextSlot(el('span', 'mg-ult-pct', ultIn));
    this.ultIco = icoEl('', 'mg-ult-ico', ultIn);
    this.ultKey = new TextSlot(el('kbd', 'mg-kbd mg-ult-key', this.ult));
    this.ultReady = new ClassSlot(this.ult, 'is-ready');
    this.ultActive = new ClassSlot(this.ult, 'is-active');

    // ---------------------------------------------------------------- bottom-right: abilities + weapon
    this.br = el('div', 'mg-hud-br', R);
    this.summonBox = el('div', 'mg-summons', this.br);
    const abRow = el('div', 'mg-abils', this.br);
    // signature passive chip (lit while the passive is doing its thing)
    this.passiveEl = el('div', 'mg-grap mg-passive', abRow);
    this.passiveIco = icoEl('', 'mg-grap-ico', el('div', 'mg-grap-box', this.passiveEl));
    this.passiveEl.style.display = 'none';
    this.passiveOn = new ClassSlot(this.passiveEl, 'is-ready');
    this.grapple = el('div', 'mg-grap', abRow);
    const gbox = el('div', 'mg-grap-box', this.grapple);
    icoEl(ABILITY_ICON.grapple, 'mg-grap-ico', gbox);
    this.grappleSweep = el('div', 'mg-ab-sweep', gbox);
    this.grappleCd = new TextSlot(el('span', 'mg-grap-cd', gbox));
    this.grappleKey = new TextSlot(el('kbd', 'mg-kbd mg-grap-key', this.grapple));
    this.grapple.style.display = 'none';
    for (let i = 0; i < 2; i++) {
      const root2 = el('div', 'mg-ab', abRow);
      const box = el('div', 'mg-ab-box', root2);
      const ico = icoEl('', 'mg-ab-ico', box);
      const sweep = el('div', 'mg-ab-sweep', box);
      const cd = new TextSlot(el('span', 'mg-ab-cd', box));
      const pips = el('div', 'mg-ab-pips', root2);
      const key = new TextSlot(el('kbd', 'mg-kbd mg-ab-key', root2));
      this.abil.push({ root: root2, ico, sweep, cd, pips, key, id: null, maxCd: 1, cdQ: -1, charges: -1, maxCharges: -1, active: new ClassSlot(root2, 'is-active'), ready: new ClassSlot(root2, 'is-ready'), cooling: new ClassSlot(root2, 'is-cooling'), wasReady: true });
    }
    const wpn = el('div', 'mg-wpn', this.br);
    const wTop = el('div', 'mg-wpn-top', wpn);
    this.wName = new TextSlot(el('span', 'mg-wpn-name', wTop));
    this.wIco = icoEl('', 'mg-wpn-ico', wTop);
    const ammoRow = el('div', 'mg-ammo', wpn);
    this.ammo = new TextSlot(el('span', 'mg-ammo-cur', ammoRow));
    el('span', 'mg-ammo-sep', ammoRow, '/');
    this.magSize = new TextSlot(el('span', 'mg-ammo-mag', ammoRow));
    this.ammoLow = new ClassSlot(ammoRow, 'is-low');
    this.ammoEmpty = new ClassSlot(ammoRow, 'is-empty');
    const sub = el('div', 'mg-ammo-sub', wpn);
    icoEl(UI.bullet, 'mg-ammo-res-ico', sub);
    this.reserve = new TextSlot(el('span', 'mg-ammo-res', sub));
    const rb = el('div', 'mg-reload-bar', sub);
    this.reloadBar = new ScaleSlot(el('i', '', rb));
    this.reloading = new ClassSlot(wpn, 'is-reloading');
    this.chargeWrap = el('div', 'mg-charge', wpn);
    const cl = el('span', 'mg-charge-l', this.chargeWrap);
    this.chargeLbl = cl;
    const cb = el('div', 'mg-charge-bar', this.chargeWrap);
    this.chargeBar = new ScaleSlot(el('i', '', cb));
    const slots = el('div', 'mg-slots', this.br);
    this.slot1 = el('div', 'mg-slot', slots);
    this.slot1Key = new TextSlot(el('kbd', 'mg-kbd', this.slot1));
    this.slot1Ico = icoEl('', 'mg-slot-ico', this.slot1);
    this.slot2 = el('div', 'mg-slot mg-slot--super', slots);
    this.slot2Key = new TextSlot(el('kbd', 'mg-kbd', this.slot2));
    this.slot2Ico = icoEl('', 'mg-slot-ico', this.slot2);
    this.slot2Ammo = new TextSlot(el('span', 'mg-slot-ammo', this.slot2));

    // ---------------------------------------------------------------- messages / overlays
    this.bigBox = el('div', 'mg-big', R);
    this.ribbonBox = el('div', 'mg-ribpop', R);
    this.oob = el('div', 'mg-oob', R);
    icoEl(UI.warning, 'mg-oob-ico', this.oob);
    const oobT = el('div', 'mg-oob-t', this.oob);
    this.i18nEls.push([oobT, 'hud.oob']);
    const oobS = el('div', 'mg-oob-s', this.oob);
    this.i18nEls.push([oobS, 'hud.oobSub']);
    this.oobT = new TextSlot(el('div', 'mg-oob-n', this.oob));

    this.death = el('div', 'mg-death', R);
    this.deathCard = el('div', 'mg-death-card', this.death);
    const resp = el('div', 'mg-respawn', this.death);
    this.respawnRing = new DashSlot(ringSvg('mg-respawn-ring', 44, resp, 100));
    this.respawnT = new TextSlot(el('div', 'mg-respawn-n', resp));
    this.respawnLbl = new TextSlot(el('div', 'mg-respawn-l', this.death));
    this.deathHint = el('div', 'mg-death-hint', this.death);
    this.deathHintKey = new TextSlot(el('kbd', 'mg-kbd', this.deathHint));
    const dh = el('span', '', this.deathHint);
    this.i18nEls.push([dh, 'hud.changeHero']);

    this.sb = el('div', 'mg-hsb', R);
    this.sb.style.display = 'none';

    for (let i = 0; i < 24; i++) {
      const d = el('div', 'mg-dnum', this.dmgNums);
      d.style.opacity = '0';
      this.dmgPool.push(d);
    }

    this.grappleReady = new ClassSlot(this.grapple, 'is-ready');
    this.grappleActive = new ClassSlot(this.grapple, 'is-active');
    this.sealEmpty = new ClassSlot(this.sealBox, 'is-empty');
    this.sealActive = new ClassSlot(this.sealBox, 'is-sealing');
    this.slot1Active = new ClassSlot(this.slot1, 'is-active');
    this.slot2Active = new ClassSlot(this.slot2, 'is-active');
    this.scopedSlot = new ClassSlot(this.chCenter, 'is-scoped');
    this.sealingOn = new ClassSlot(this.sealing, 'is-on');
    for (let i = 0; i < this.ddirs.length; i++) this.ddirA.push(NaN);

    this.relabel();
    this.applySettings();
    this.onResize();
    window.addEventListener('resize', this.onResize);
    onLangChange(() => {
      this.relabel();
      this.compass.setLabels(t('compass').split(','));
      this.fx.relabel();
      this.resetCaches();
    });
    show(this.oob, false);
    show(this.death, false);
    show(this.breach, true);
  }

  // =========================================================================
  // public API

  get chatOpen(): boolean {
    return this._chatOpen;
  }

  show(v: boolean): void {
    this.shown = v;
    this.syncVisible(this.visibleNow);
  }

  setSettings(s: Settings): void {
    const langChanged = s.language !== this.settings.language;
    this.settings = s;
    if (langChanged) setLang(s.language);
    this.applySettings();
    this.resetCaches();
  }

  setMinimap(mapId: MapId, image: HTMLCanvasElement | null, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    this.minimap.setMap(mapId, image, bounds);
  }

  setChat(open: boolean, onSend?: (text: string) => void): void {
    this._chatOpen = open;
    if (onSend) this.chatSend = onSend;
    this.chat.classList.toggle('is-open', open);
    if (open) {
      this.chatInput.placeholder = t('hud.chat.placeholder');
      this.chatInput.value = '';
      window.setTimeout(() => this.chatInput.focus(), 0);
    } else {
      this.chatInput.blur();
    }
  }

  setScoreboard(rows: ScoreRow[] | null, info: ScoreInfo): void {
    if (!rows) {
      if (this.sb.style.display !== 'none') {
        this.sb.style.display = 'none';
        this.sbSig = '';
      }
      return;
    }
    const now = performance.now();
    const sig = rows.length + ':' + info.mode + ':' + info.localTeam;
    const wasHidden = this.sb.style.display === 'none';
    if (!wasHidden && sig === this.sbSig && now - this.sbLast < 250) return;
    this.sbLast = now;
    this.sbSig = sig;
    renderScoreboard(this.sb, rows, info);
    if (wasHidden) this.sb.style.display = '';
  }

  event(e: HudEvent): void {
    switch (e.type) {
      case 'kill':
        this.addKill(e);
        break;
      case 'ultReady':
        this.ult.classList.remove('is-flash');
        this.ult.animate([{ transform: 'scale(1.35)', filter: 'brightness(2.2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' });
        this.ultBanner.classList.remove('is-on');
        void this.ultBanner.offsetWidth;
        this.ultBanner.classList.add('is-on');
        break;
      case 'xp':
        this.addXp(e.amount, e.label);
        break;
      case 'ribbon':
        this.ribbonQueue.push(e);
        break;
      case 'toast':
        this.addToast(e.text, e.kind);
        break;
      case 'big':
        this.bigQueue.push({ title: e.title, sub: e.sub, kind: e.kind ?? 'info' });
        if (this.bigQueue.length > 4) this.bigQueue.shift();
        break;
      case 'damage':
        this.addDamage(e.amount, e.x, e.y, e.head);
        break;
      case 'capture': {
        const mine = e.team === this.objLocalTeam;
        const txt = mine ? t('hud.captured', { id: e.id }) : this.objLocalTeam >= 0 ? t('hud.enemyCaptured', { id: e.id }) : t('hud.lost', { id: e.id });
        this.addToast(txt, mine ? 'good' : 'bad', 'cap');
        const cp = this.cps[e.id === 'A' ? 0 : e.id === 'B' ? 1 : 2];
        cp?.root.animate([{ transform: 'rotate(45deg) scale(1.6)', filter: 'brightness(2.5)' }, { transform: 'rotate(45deg) scale(1)', filter: 'brightness(1)' }], { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
        break;
      }
      case 'chat':
        this.addChat(e.from, e.team, e.text);
        break;
    }
  }

  update(s: HudState, dt: number): void {
    this.time += dt;
    const vis = s.visible;
    if (vis !== this.c.visible) {
      this.c.visible = vis;
      this.syncVisible(vis);
    }
    if (!vis || !this.shown) return;
    const now = this.time;

    // ---- alive / death
    if (s.alive !== this.c.alive) {
      this.c.alive = s.alive;
      this.root.classList.toggle('is-dead', !s.alive);
      show(this.death, !s.alive);
      if (!s.alive) {
        this.respawnMax = Math.max(1, s.respawnIn);
        this.killerSig = '';
      }
    }
    if (!s.alive) this.updateDeath(s);

    // ---- hero change
    if (s.hero !== this.hero) this.setHero(s.hero);

    // ---- vitals
    const hd = HEROES[s.hero];
    const hpAbs = (clamp(s.health, 0, 100) / 100) * hd.health;
    const suitAbs = (clamp(s.suit, 0, 100) / 100) * hd.suit;
    this.hpCur.set(Math.ceil(hpAbs));
    this.suitTxt.num(Math.round(s.suit), '', '%');
    this.setSegs(this.segHp, this.segHpQ, hpAbs);
    this.setSegs(this.segSuit, this.segSuitQ, suitAbs);
    this.lowHp.set(s.alive && s.health < 35);
    this.suitBreach.set(s.breached || s.suit < 50);
    if (this.prevHealth >= 0 && s.health < this.prevHealth - 0.5 && s.alive) this.fx.hit((this.prevHealth - s.health) / 60);
    this.prevHealth = s.health;

    this.o2Fill.set(s.oxygen / 100);
    this.o2Val.set(Math.round(s.oxygen));
    this.o2Low.set(s.oxygen < 30);
    this.o2Drain.set(s.breached && !s.suffocating);
    this.o2Suff.set(s.suffocating);
    this.o2Lbl.set(s.suffocating ? t('hud.suffocating') : '');
    this.breachOn.set(s.alive && (s.breached || s.suffocating));
    if (s.breached || s.suffocating) {
      this.breachTitle.set(s.suffocating ? t('hud.suffocating') : t('hud.breach'));
      const lq = Math.round(s.leakRate * 10) / 10;
      if (lq !== this.leakQ) {
        this.leakQ = lq;
        this.breachLeak.set(t('hud.leak', { r: lq.toFixed(1) }));
      }
      this.breachSeal.num(s.sealants, '×');
    }

    this.jetFill.set(s.jetFuel);
    this.jetOn.set(s.jetting);
    this.jetLow.set(s.jetFuel < 0.2);
    const magKey = s.magDisabled > 0 ? 'emp' : s.mag;
    const empQ = s.magDisabled > 0 ? Math.ceil(s.magDisabled * 10) / 10 : 0;
    if (magKey !== this.magState) {
      this.magState = magKey;
      this.magBox.setAttribute('data-state', magKey);
      if (magKey !== 'emp') this.magTxt.set(t('hud.mag.' + s.mag));
    }
    if (magKey === 'emp' && empQ !== this.empQ) this.magTxt.set(t('hud.mag.emp') + ' ' + empQ.toFixed(1));
    this.empQ = empQ;
    if (s.onWall !== this.c.onWall) {
      this.c.onWall = s.onWall;
      this.root.classList.toggle('is-onwall', s.onWall);
    }
    this.sealN.num(s.sealants, '×');
    this.sealEmpty.set(s.sealants <= 0);
    this.sealActive.set(s.sealing >= 0);
    this.sealFill.set(s.sealing >= 0 ? s.sealing : 0);
    this.updateExtras(s);

    // ---- abilities
    for (let i = 0; i < this.abil.length; i++) this.updateAbility(this.abil[i], s.abilities[i], s.hero);

    // ---- ult
    if (s.ult.id !== this.ultId) {
      this.ultId = s.ult.id;
      this.ultIco.innerHTML = ABILITY_ICON[s.ult.id] ?? '';
      this.ult.title = abilityName(s.ult.id);
    }
    this.ultRing.set(s.ult.charge);
    if (s.ult.ready) this.ultPct.set('');
    else this.ultPct.num(Math.floor(clamp(s.ult.charge, 0, 1) * 100), '', '%');
    this.ultReady.set(s.ult.ready);
    this.ultActive.set(s.ult.active);

    // ---- weapon
    if (s.weaponId !== this.weaponId) {
      this.weaponId = s.weaponId;
      this.wIco.innerHTML = WEAPON_ICON[s.weaponId] ?? '';
      this.wName.set(weaponShort(s.weaponId));
      this.wIco.title = weaponName(s.weaponId);
    }
    this.ammo.set(s.ammo);
    this.magSize.set(s.magSize);
    this.reserve.set(s.reserve);
    const low = s.magSize >= 4 && s.ammo <= Math.max(1, Math.floor(s.magSize * 0.25));
    this.ammoLow.set(low && s.ammo > 0);
    this.ammoEmpty.set(s.ammo <= 0);
    const rl = s.reload >= 0;
    this.reloading.set(rl);
    this.reloadBar.set(rl ? s.reload : 0);
    const ck = s.chargeKind ?? 'charge';
    const railish = s.weaponId === 'rail' || s.charge > 0 || ck === 'heat' || ck === 'alt';
    show(this.chargeWrap, railish);
    if (railish) this.chargeBar.set(s.charge);
    const ckq = ck + getLang();
    if (ckq !== this.chargeKindQ) {
      this.chargeKindQ = ckq;
      this.chargeLbl.textContent = t(ck === 'heat' ? 'hud.heat' : ck === 'alt' ? 'hud.alt' : 'hud.charge');
      this.chargeWrap.dataset.kind = ck;
    }
    if (ck === 'heat') this.reserve.set('∞');
    // passive chip
    const pv = s.passive;
    if (pv) {
      const pq = pv.id + getLang();
      if (pq !== this.passiveQ) {
        this.passiveQ = pq;
        this.passiveIco.innerHTML = PASSIVE_ICON[pv.id] ?? UI.star;
        this.passiveEl.title = passiveName(pv.id) + ' — ' + passiveDesc(pv.id);
        this.passiveEl.style.display = '';
      }
      this.passiveOn.set(pv.active);
      this.passiveEl.style.opacity = pv.active ? '1' : '0.45';
    }
    // slots
    const sl1 = s.slots[0];
    if (sl1 && sl1.id) {
      if (this.slot1Ico.dataset.id !== sl1.id) {
        this.slot1Ico.dataset.id = sl1.id;
        this.slot1Ico.innerHTML = WEAPON_ICON[sl1.id] ?? '';
      }
      this.slot1Active.set(sl1.active);
    }
    const sw = s.superWeapon;
    if ((sw?.id ?? null) !== this.slot2Id) {
      this.slot2Id = sw?.id ?? null;
      this.slot2Ico.innerHTML = sw ? WEAPON_ICON[sw.id] ?? '' : '';
      this.slot2.classList.toggle('is-empty', !sw);
      if (sw) this.slot2.animate([{ transform: 'scale(1.5)', filter: 'brightness(2.5)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    if (sw) this.slot2Ammo.num(sw.ammo, '×');
    const s2 = s.slots[1];
    this.slot2Active.set(!!s2?.active && !!sw);

    // ---- crosshair / hitmarker / reload ring
    const scoped = s.scope !== 'none' && s.ads > 0.5;
    this.scopedSlot.set(scoped);
    this.crosshair.setGap(s.spread * (1 - s.ads * 0.6));
    const hm = this.settings.hitMarkers ? Math.round(clamp(s.hitmarker, 0, 1) * 20) / 20 : 0;
    if (hm !== this.hitQ) {
      this.hitQ = hm;
      this.hit.style.opacity = String(hm);
      this.hit.style.transform = `translate(-50%,-50%) scale(${(1 + (1 - hm) * 0.35).toFixed(3)})`;
    }
    const hk = s.hitKill ? 'kill' : s.hitHead ? 'head' : '';
    if (hk !== this.hitKind) {
      this.hitKind = hk;
      this.hit.setAttribute('data-kind', hk);
    }
    show(this.reloadRingEl, rl);
    if (rl) this.reloadRing.set(s.reload);
    const showArc = s.weaponId === 'rail' && s.charge > 0 && !scoped;
    show(this.chargeArcEl, showArc);
    if (showArc) this.chargeArc.set(s.charge);

    // prompts
    let la = '';
    if (s.alive && s.reload < 0) {
      if (s.ammo <= 0 && s.reserve <= 0) la = 'empty';
      else if (low) la = 'low';
    }
    if (la !== this.c.lowAmmo) {
      this.c.lowAmmo = la;
      this.lowAmmo.className = 'mg-lowammo' + (la ? ' is-on is-' + la : '');
      if (la === 'empty') this.lowAmmoTxt.set(t('hud.noAmmo'));
      else if (la === 'low') this.lowAmmoTxt.set(t('hud.lowAmmo'));
      show(this.lowAmmo.firstElementChild as HTMLElement, la === 'low');
    }
    if (s.interact !== this.c.interact) {
      this.c.interact = s.interact;
      this.prompt.classList.toggle('is-on', !!s.interact);
      if (s.interact) this.promptTxt.set(t(s.interact));
    }
    this.sealingOn.set(s.sealing >= 0);
    if (s.sealing >= 0) this.sealingFill.set(s.sealing);

    // ---- damage directions
    for (let i = 0; i < this.ddirs.length; i++) {
      const d = s.damageDirs[i];
      const a = d ? Math.round(clamp(d.alpha, 0, 1) * 30) / 30 : 0;
      const e = this.ddirs[i];
      if (a !== this.ddirQ[i]) {
        this.ddirQ[i] = a;
        e.style.opacity = String(a);
      }
      if (d && a > 0) {
        const aq = Math.round(d.angle * 100) / 100;
        if (aq !== this.ddirA[i]) {
          this.ddirA[i] = aq;
          e.style.transform = 'rotate(' + aq + 'rad)';
        }
      }
    }

    // ---- fx
    if (s.cloaked !== this.c.cloak) {
      this.c.cloak = s.cloaked;
      this.root.classList.toggle('is-cloaked', s.cloaked);
    }
    if (s.invulnerable !== this.c.invuln) {
      this.c.invuln = s.invulnerable;
      this.root.classList.toggle('is-invuln', s.invulnerable);
    }
    if (s.scope !== this.c.scope) {
      this.c.scope = s.scope;
      this.root.setAttribute('data-scope', s.scope);
    }
    this.fx.update(dt, s.suit, s.oxygen, s.suffocating, s.cloaked, s.invulnerable, s.alive, s.ads, s.scope, s.charge);

    // ---- objective
    this.updateObjective(s);

    // ---- minimap (30 Hz)
    this.mmAcc += dt;
    if (this.mmAcc >= 1 / 30) {
      this.minimap.draw(s.pos.x, s.pos.z, s.heading, this.settings.minimapRotate, s.blips, this.mmAcc);
      this.mmAcc = 0;
    }
    this.compass.update(s.heading);

    // ---- markers
    this.updateMarkers(s);

    // ---- OOB
    const oob = s.outOfBounds > 0 && s.alive;
    if (oob !== this.c.oob) {
      this.c.oob = oob;
      show(this.oob, oob);
    }
    if (oob) this.oobT.num(Math.round(s.outOfBounds * 10) / 10, '', '', 1);

    // ---- stats / spectate
    if (this.settings.showFps) {
      const f = Math.round(s.fps);
      if (f !== this.c.fps) {
        this.c.fps = f;
        this.fpsT.set(f);
      }
      const p = Math.round(s.ping);
      if (p !== this.c.ping) {
        this.c.ping = p;
        this.pingT.num(p, '', 'ms');
      }
    }
    if (s.spectating !== this.c.spect) {
      this.c.spect = s.spectating;
      this.spectate.classList.toggle('is-on', !!s.spectating);
      if (s.spectating) this.spectateT.set(t('hud.spectating') + ': ' + s.spectating);
    }

    // ---- timed feeds
    this.tickFeeds(now);
  }

  // =========================================================================
  // internals

  private onResize = (): void => {
    const w = window.innerWidth || 1920;
    const h = window.innerHeight || 1080;
    this.vs = clamp(Math.min(w / 1920, h / 1080), 0.74, 1.6);
    this.applyScale();
  };

  private applyScale(): void {
    const k = this.vs * this.settings.hudScale;
    this.root.style.setProperty('--vs', this.vs.toFixed(4));
    this.root.style.setProperty('--k', k.toFixed(4));
    this.minimap.resize(220, k);
  }

  private applySettings(): void {
    const s = this.settings;
    this.crosshair.configure(s.crosshair);
    this.root.classList.toggle('no-hitmarkers', !s.hitMarkers);
    this.stats.style.display = s.showFps ? '' : 'none';
    const k = s.keys;
    this.abil[0].key.set(keyLabel(k.ability1));
    this.abil[1].key.set(keyLabel(k.ability2));
    this.ultKey.set(keyLabel(k.ultimate));
    this.sealKey.set(keyLabel(k.sealant));
    this.breachKey.set(keyLabel(k.sealant));
    this.slot1Key.set(keyLabel(k.weapon1));
    this.grappleKey.set(keyLabel(k.grapple));
    this.slot2Key.set(keyLabel(k.weapon2));
    this.promptKey.set(keyLabel(k.interact));
    this.lowAmmoKey.set(keyLabel(k.reload));
    this.deathHintKey.set(keyLabel(k.interact));
    this.applyScale();
  }

  private relabel(): void {
    for (const [e, key] of this.i18nEls) e.textContent = t(key);
    this.minimap.setNorthLabel(getLang() === 'ru' ? 'С' : 'N');
    this.hpMax.set('/ ' + (this.hero ? HEROES[this.hero].health : 0));
    this.objMode = null; // rebuild objective with new labels
    this.killerSig = '';
  }

  private resetCaches(): void {
    this.leakQ = -1;
    this.empQ = -1;
    this.c.lowAmmo = '#';
    this.c.interact = '#';
    this.c.spect = '#';
    this.magState = '';
    this.weaponId = null;
    this.ultId = null;
    this.killerSig = '';
    this.objMode = null;
    for (const a of this.abil) {
      a.id = null;
      a.cdQ = -1;
      a.charges = -1;
    }
  }

  private syncVisible(stateVisible: boolean): void {
    this.visibleNow = stateVisible;
    this.root.style.display = this.shown && stateVisible ? '' : 'none';
  }

  private setHero(h: HeroId): void {
    this.hero = h;
    const d = HEROES[h];
    this.root.style.setProperty('--hc', d.color);
    this.root.style.setProperty('--hv', d.visor);
    this.portraitIco.innerHTML = HERO_ICON[h];
    this.portrait.title = heroName(h);
    this.hpMax.set('/ ' + d.health);
    const per = 25;
    const buildSegs = (box: HTMLDivElement, n: number) => {
      box.textContent = '';
      const arr: HTMLElement[] = [];
      for (let i = 0; i < n; i++) {
        const sg = el('span', 'mg-hpseg', box);
        arr.push(el('i', '', sg));
      }
      return arr;
    };
    this.segHp = buildSegs(this.segHpBox, Math.max(1, Math.round(d.health / per)));
    this.segSuit = buildSegs(this.segSuitBox, Math.max(1, Math.round(d.suit / per)));
    this.segHpQ = this.segHp.map(() => -1);
    this.segSuitQ = this.segSuit.map(() => -1);
    this.segHpBox.style.flexGrow = String(this.segHp.length);
    this.segSuitBox.style.flexGrow = String(this.segSuit.length);
    for (const a of this.abil) a.id = null;
  }

  private setSegs(fills: HTMLElement[], q: number[], value: number): void {
    const per = 25;
    for (let i = 0; i < fills.length; i++) {
      const f = Math.round(clamp((value - i * per) / per, 0, 1) * 40) / 40;
      if (f !== q[i]) {
        q[i] = f;
        fills[i].style.transform = 'scaleX(' + f + ')';
      }
    }
  }

  private updateAbility(a: AbilitySlot, st: HudState['abilities'][number] | undefined, hero: HeroId): void {
    if (!st) {
      a.root.style.display = 'none';
      return;
    }
    if (st.id !== a.id) {
      a.root.style.display = '';
      a.id = st.id;
      a.ico.innerHTML = ABILITY_ICON[st.id] ?? '';
      a.root.title = abilityName(st.id);
      const d = HEROES[hero];
      const def = d.ability1.id === st.id ? d.ability1 : d.ability2.id === st.id ? d.ability2 : null;
      a.maxCd = Math.max(0.1, def?.cooldown ?? (st.cooldown || 1));
      a.cdQ = -1;
      a.charges = -1;
    }
    const frac = clamp(st.cooldown / a.maxCd, 0, 1);
    const q = Math.round(frac * 200) / 200;
    if (q !== a.cdQ) {
      a.cdQ = q;
      a.sweep.style.setProperty('--p', String(q));
    }
    const cooling = st.cooldown > 0.05 && (st.maxCharges <= 1 || st.charges === 0);
    a.cooling.set(cooling);
    if (st.cooldown > 0.05) {
      if (st.cooldown < 1) a.cd.num(Math.round(st.cooldown * 10) / 10, '', '', 1);
      else a.cd.num(Math.ceil(st.cooldown));
    } else a.cd.set('');
    a.active.set(st.active);
    const ready = !cooling;
    a.ready.set(ready);
    if (ready && !a.wasReady) a.root.animate([{ transform: 'scale(1.18)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }], { duration: 380, easing: 'ease-out' });
    a.wasReady = ready;
    if (st.maxCharges !== a.maxCharges || st.charges !== a.charges) {
      a.maxCharges = st.maxCharges;
      a.charges = st.charges;
      a.pips.textContent = '';
      if (st.maxCharges > 1) for (let i = 0; i < st.maxCharges; i++) el('i', i < st.charges ? 'on' : '', a.pips);
    }
  }

  // ---------------------------------------------------------------- optional extras (grapple / stance / summons / force field)

  private updateExtras(s: HudState): void {
    const ff = s.forceField ?? 0;
    const ffOn = ff > 0.001;
    if (ffOn !== this.ffOn) {
      this.ffOn = ffOn;
      this.segFfBox.style.display = ffOn ? '' : 'none';
    }
    if (ffOn) this.setSegs(this.segFf, this.segFfQ, ff * 100);

    const stc = s.stance ?? '';
    if (stc !== this.stance) {
      this.stance = stc;
      this.stanceBox.style.display = stc && stc !== 'stand' ? '' : 'none';
      if (stc) {
        this.stanceIco.innerHTML = STANCE_ICON[stc] ?? UI.profile;
        this.stanceTxt.set(t('hud.stance.' + stc));
        this.stanceBox.setAttribute('data-stance', stc);
      }
    }

    const g = s.grapple;
    const gOn = !!g;
    if (gOn !== this.grappleOn) {
      this.grappleOn = gOn;
      this.grapple.style.display = gOn ? '' : 'none';
    }
    if (g) {
      const max = 8;
      const q = g.ready ? 0 : Math.round(clamp(g.cooldown / max, 0, 1) * 100) / 100;
      if (q !== this.grappleQ) {
        this.grappleQ = q;
        this.grappleSweep.style.setProperty('--p', String(q));
      }
      if (!g.ready && g.cooldown > 0.05) this.grappleCd.num(Math.ceil(g.cooldown));
      else this.grappleCd.set('');
      this.grappleReady.set(g.ready);
      this.grappleActive.set(g.active);
    }

    const sm = s.summons ?? [];
    let changed = sm.length !== this.summonEls.length;
    for (let i = 0; !changed && i < sm.length; i++) if (sm[i].kind !== this.summonEls[i].kind) changed = true;
    if (changed) {
      this.summonBox.textContent = '';
      this.summonEls = sm.map((x) => {
        const root = el('div', 'mg-summon', this.summonBox);
        root.setAttribute('data-kind', x.kind);
        icoEl(SUMMON_ICON[x.kind] ?? UI.gear, '', root);
        const bar = el('div', 'mg-summon-hp', root);
        return { root, kind: x.kind, hp: new ScaleSlot(el('i', '', bar)), low: new ClassSlot(root, 'is-low') };
      });
    }
    for (let i = 0; i < sm.length; i++) {
      this.summonEls[i].hp.set(sm[i].hp);
      this.summonEls[i].low.set(sm[i].hp < 0.3);
    }
  }

  // ---------------------------------------------------------------- objective

  private buildObjective(s: HudState): void {
    const o = this.obj;
    o.textContent = '';
    this.cps = [];
    this.objMode = s.mode;
    this.objLocalTeam = s.localTeam;
    const teams = s.teams;
    this.c.teams = teams;
    this.objRank = null;
    o.className = 'mg-obj' + (teams ? '' : ' mg-obj--ffa');
    const ally = s.localTeam === 1 ? 1 : 0;
    const enemy = 1 - ally;
    if (teams) {
      const side = (team: number, cls: string) => {
        const w = el('div', 'mg-obj-team ' + cls + ' t' + team, o);
        const top = el('div', 'mg-obj-team-top', w);
        el('span', 'mg-obj-team-n', top, t('team.' + team));
        const sc = new TextSlot(el('span', 'mg-obj-team-s', top));
        const bar = el('div', 'mg-obj-bar', w);
        const fill = new ScaleSlot(el('i', '', bar));
        return { sc, fill };
      };
      const a = side(ally, 'is-ally');
      const mid = el('div', 'mg-obj-mid', o);
      this.objTimer = new TextSlot(el('div', 'mg-obj-timer', mid));
      this.objLimit = new TextSlot(el('div', 'mg-obj-limit', mid));
      this.objTimeLow = new ClassSlot(mid, 'is-low');
      const b = side(enemy, 'is-enemy');
      this.objAllyScore = a.sc;
      this.objAllyFill = a.fill;
      this.objEnemyScore = b.sc;
      this.objEnemyFill = b.fill;
      this.objLimit.set(t('hud.limit', { n: s.scoreLimit }));
      if (s.controlPoints.length) {
        const row = el('div', 'mg-cps', this.obj);
        for (const cp of s.controlPoints) {
          const root = el('div', 'mg-cp', row);
          const dia = el('div', 'mg-cp-dia', root);
          const ring = new DashSlot(ringSvg('mg-cp-ring', 22, dia, 56));
          el('span', 'mg-cp-l', dia, cp.id);
          this.cps.push({ root: dia, ring, owner: -2, cls: '', contested: new ClassSlot(root, 'is-contested'), inside: new ClassSlot(root, 'is-inside'), capT: -1 });
        }
      }
    } else {
      const me = el('div', 'mg-obj-ffa-me', o);
      el('span', 'k', me, t('hud.ffa.you'));
      this.objAllyScore = new TextSlot(el('span', 'v', me));
      const mid = el('div', 'mg-obj-mid', o);
      this.objTimer = new TextSlot(el('div', 'mg-obj-timer', mid));
      this.objLimit = new TextSlot(el('div', 'mg-obj-limit', mid));
      this.objTimeLow = new ClassSlot(mid, 'is-low');
      const lead = el('div', 'mg-obj-ffa-lead', o);
      el('span', 'k', lead, t('hud.ffa.leader'));
      this.objEnemyScore = new TextSlot(el('span', 'v', lead));
      const rank = el('div', 'mg-obj-ffa-rank', o);
      el('span', 'k', rank, t('hud.ffa.rank'));
      this.objRank = new TextSlot(el('span', 'v', rank));
      this.objAllyFill = null;
      this.objEnemyFill = null;
      this.objLimit.set(t('hud.limit', { n: s.scoreLimit }));
    }
    // colour vars: ally/enemy
    const R = this.root.style;
    if (teams) {
      R.setProperty('--ally', `var(--team${ally})`);
      R.setProperty('--ally-hi', `var(--team${ally}-hi)`);
      R.setProperty('--enemy', `var(--team${enemy})`);
      R.setProperty('--enemy-hi', `var(--team${enemy}-hi)`);
      this.minimap.colors.ally = ally === 0 ? '#4dd8ff' : '#ffa033';
      this.minimap.colors.enemy = ally === 0 ? '#ffa033' : '#4dd8ff';
    } else {
      R.setProperty('--ally', 'var(--team0)');
      R.setProperty('--ally-hi', 'var(--team0-hi)');
      R.setProperty('--enemy', '#e0303f');
      R.setProperty('--enemy-hi', '#ff5a6a');
      this.minimap.colors.ally = '#4dd8ff';
      this.minimap.colors.enemy = '#ff5a6a';
    }
    this.cpMarkers.forEach((m) => m.root.remove());
    this.cpMarkers = [];
    for (const cp of s.controlPoints) {
      const root = el('div', 'mg-cpm', this.markers);
      const dia = el('div', 'mg-cpm-dia', root);
      const ring = new DashSlot(ringSvg('mg-cp-ring', 22, dia, 56));
      el('span', 'mg-cp-l', dia, cp.id);
      const dist = new TextSlot(el('div', 'mg-cpm-d', root));
      root.style.display = 'none';
      this.cpMarkers.push({ root, dist, ring, owner: -2, vis: false, x: -1, y: -1, contested: false });
    }
  }

  private cpClass(owner: number): string {
    return owner < 0 ? 'o-n' : owner === this.objLocalTeam ? 'o-a' : 'o-e';
  }

  private updateObjective(s: HudState): void {
    if (s.mode !== this.objMode || s.localTeam !== this.objLocalTeam || s.teams !== this.c.teams || (s.teams && this.cps.length !== s.controlPoints.length)) this.buildObjective(s);
    const ally = s.localTeam === 1 ? 1 : 0;
    if (s.teams) {
      const as = s.teamScores[ally] ?? 0;
      const es = s.teamScores[1 - ally] ?? 0;
      this.objAllyScore?.set(as);
      this.objEnemyScore?.set(es);
      this.objAllyFill?.set(as / Math.max(1, s.scoreLimit));
      this.objEnemyFill?.set(es / Math.max(1, s.scoreLimit));
    } else {
      this.objAllyScore?.set(s.teamScores[0] ?? 0);
      this.objEnemyScore?.set(s.teamScores[1] ?? 0);
      this.objRank?.set('#' + s.ffaRank);
    }
    this.objTimer?.time(s.timeLeft);
    this.objTimeLow?.set(s.timeLeft <= 30);
    for (let i = 0; i < this.cps.length; i++) {
      const cp = s.controlPoints[i];
      const u = this.cps[i];
      if (!cp) continue;
      const cls = this.cpClass(cp.owner);
      if (cls !== u.cls) {
        u.cls = cls;
        u.root.parentElement!.setAttribute('data-o', cls);
      }
      const capTeam = cp.progress < 0 ? 0 : 1;
      const capCls = Math.abs(cp.progress) < 0.001 ? '' : capTeam === this.objLocalTeam ? 'c-a' : 'c-e';
      const pr = u.root.parentElement!;
      if (pr.getAttribute('data-c') !== capCls) pr.setAttribute('data-c', capCls);
      u.ring.set(Math.abs(cp.progress));
      u.contested.set(cp.contested);
      u.inside.set(cp.inside);
      // world marker
      const m = this.cpMarkers[i];
      if (m) {
        const sc = cp.screen;
        const vis = !!sc && sc.visible;
        if (vis !== m.vis) {
          m.vis = vis;
          m.root.style.display = vis ? '' : 'none';
        }
        if (vis && sc) {
          const x = Math.round(sc.x);
          const y = Math.round(sc.y);
          if (x !== m.x || y !== m.y) {
            m.x = x;
            m.y = y;
            m.root.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
          }
          m.dist.num(Math.round(sc.dist), '', getLang() === 'ru' ? ' м' : ' m');
          if (m.root.getAttribute('data-o') !== cls) m.root.setAttribute('data-o', cls);
          if (m.root.getAttribute('data-c') !== capCls) m.root.setAttribute('data-c', capCls);
          m.ring.set(Math.abs(cp.progress));
          if (cp.contested !== m.contested) {
            m.contested = cp.contested;
            m.root.classList.toggle('is-contested', cp.contested);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- markers

  private getMarker(i: number): MarkerEl {
    let m = this.markerPool[i];
    if (m) return m;
    const root = el('div', 'mg-mk', this.markers);
    const arrow = el('div', 'mg-mk-arrow', root);
    const ico = el('span', 'mg-mk-ico mg-ico', root);
    const label = new TextSlot(el('div', 'mg-mk-label', root));
    const hpWrap = el('div', 'mg-mk-hp', root);
    const hp = new ScaleSlot(el('i', '', hpWrap));
    const dist = new TextSlot(el('div', 'mg-mk-dist', root));
    m = { root, ico, label, dist, hp, hpWrap, arrow, kind: '', team: '#', x: -1, y: -1, on: false, onScreen: null, angle: NaN };
    this.markerPool.push(m);
    return m;
  }

  private updateMarkers(s: HudState): void {
    const list = s.markers;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const unit = getLang() === 'ru' ? ' м' : ' m';
    for (let i = 0; i < list.length && i < 48; i++) {
      const mk = list[i];
      const m = this.getMarker(i);
      if (!m.on) {
        m.on = true;
        m.root.style.display = '';
      }
      if (mk.kind !== m.kind) {
        m.kind = mk.kind;
        m.root.setAttribute('data-kind', mk.kind);
        m.ico.innerHTML = MARKER_ICON[mk.kind] ?? '';
        m.root.classList.toggle('is-device', DEVICE_KINDS.has(mk.kind));
        m.root.classList.toggle('is-generic', !DEVICE_KINDS.has(mk.kind) && !PLAYER_KINDS.has(mk.kind));
      }
      const tm = mk.team === undefined ? '' : mk.team === this.objLocalTeam ? 'a' : 'e';
      if (tm !== m.team) {
        m.team = tm;
        m.root.setAttribute('data-team', tm);
      }
      const x = Math.round(clamp(mk.x, 36, W - 36));
      const y = Math.round(clamp(mk.y, 36, H - 36));
      if (x !== m.x || y !== m.y) {
        m.x = x;
        m.y = y;
        m.root.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      }
      if (mk.onScreen !== m.onScreen) {
        m.onScreen = mk.onScreen;
        m.root.classList.toggle('is-off', !mk.onScreen);
      }
      if (!mk.onScreen && mk.angle !== undefined) {
        const a = Math.round(mk.angle * 50) / 50;
        if (a !== m.angle) {
          m.angle = a;
          m.arrow.style.transform = 'rotate(' + a + 'rad)';
        }
      }
      m.label.set(mk.label ?? '');
      if (mk.dist !== undefined && (mk.kind !== 'ally' || !mk.onScreen)) m.dist.num(Math.round(mk.dist), '', unit);
      else m.dist.set('');
      if (mk.health !== undefined) {
        m.hpWrap.style.display = '';
        m.hp.set(mk.health);
      } else if (m.hpWrap.style.display !== 'none') m.hpWrap.style.display = 'none';
    }
    for (let i = list.length; i < this.markerPool.length; i++) {
      const m = this.markerPool[i];
      if (m.on) {
        m.on = false;
        m.root.style.display = 'none';
      }
    }
  }

  // ---------------------------------------------------------------- death

  private updateDeath(s: HudState): void {
    const k = s.killer;
    const sig = k ? k.name + '|' + k.hero + '|' + k.weapon + '|' + Math.round(k.distance) + '|' + Math.round(k.health * 20) : 'none';
    if (sig !== this.killerSig) {
      this.killerSig = sig;
      const c = this.deathCard;
      c.textContent = '';
      if (!k || k.weapon === 'suffocation' || k.weapon === 'fall' || k.weapon === 'self') {
        const w = k?.weapon ?? 'self';
        const env = w === 'suffocation' ? 'hud.env.suffocation' : w === 'fall' ? 'hud.env.fall' : 'hud.env.self';
        c.className = 'mg-death-card is-env';
        const ic = sourceIcon(w);
        icoEl(ic.svg, 'mg-death-env-ico', c);
        el('div', 'mg-death-k', c, t(k ? env : 'hud.killed'));
        if (k && w !== 'self' && k.name) el('div', 'mg-death-sub', c, k.name);
      } else {
        c.className = 'mg-death-card';
        const hc = HEROES[k.hero]?.color ?? '#fff';
        c.style.setProperty('--kc', hc);
        el('div', 'mg-death-k', c, t('hud.eliminatedBy'));
        const row = el('div', 'mg-death-row', c);
        const pic = el('div', 'mg-death-pic', row);
        icoEl(HERO_ICON[k.hero], '', pic);
        const info = el('div', 'mg-death-info', row);
        el('div', 'mg-death-name t' + k.team, info, k.name);
        el('div', 'mg-death-hero', info, heroName(k.hero));
        const wrow = el('div', 'mg-death-wpn', info);
        const src = sourceIcon(k.weapon);
        icoEl(src.svg, src.wide ? 'is-wide' : '', wrow);
        el('span', '', wrow, (k.weapon in WEAPON_ICON ? weaponShort(k.weapon as WeaponId) : abilityName(k.weapon as AbilityId)) + ' · ' + t('common.m', { n: Math.round(k.distance) }));
        const hp = el('div', 'mg-death-hp', c);
        el('span', 'mg-death-hp-l', hp, t('hud.killerHp'));
        const bar = el('div', 'mg-death-hp-bar', hp);
        const f = el('i', '', bar);
        f.style.transform = `scaleX(${clamp(k.health, 0, 1)})`;
        el('span', 'mg-death-hp-v', hp, Math.round(clamp(k.health, 0, 1) * 100) + '%');
      }
    }
    const r = Math.max(0, s.respawnIn);
    if (r > this.respawnMax) this.respawnMax = r;
    if (r > 0) this.respawnT.num(Math.ceil(r));
    else this.respawnT.set('');
    this.respawnRing.set(this.respawnMax > 0 ? 1 - r / this.respawnMax : 1);
    this.respawnLbl.set(r > 0 ? t('hud.respawnIn') : t('hud.respawning'));
    this.deathHint.classList.toggle('is-on', s.heroSelect);
  }

  // ---------------------------------------------------------------- feeds

  private addKill(e: Extract<HudEvent, { type: 'kill' }>): void {
    const row = el('div', 'mg-kf' + (e.local !== 'none' ? ' is-local is-' + e.local : ''));
    const env = e.weapon === 'suffocation' || e.weapon === 'fall' || e.weapon === 'self' || e.killer === e.victim;
    const tcls = (team: number, isLocal: boolean) => (team === 0 || team === 1 ? (team === this.objLocalTeam ? 'is-ally' : 'is-enemy') : isLocal ? 'is-ally' : 'is-enemy');
    if (!env) {
      const k = el('div', 'mg-kf-side ' + tcls(e.killerTeam, e.local === 'killer'), row);
      el('span', 'mg-kf-n', k, e.killer);
      const kh = icoEl(HERO_ICON[e.killerHero], 'mg-kf-h', k);
      kh.style.setProperty('--hc', HEROES[e.killerHero]?.color ?? '#fff');
    }
    const mid = el('div', 'mg-kf-mid', row);
    const src = sourceIcon(e.weapon);
    icoEl(src.svg, 'mg-kf-w' + (src.wide ? ' is-wide' : ''), mid);
    if (e.headshot) icoEl(UI.headshot, 'mg-kf-badge is-hs', mid);
    if (e.wall) icoEl(UI.wall, 'mg-kf-badge is-wall', mid);
    const v = el('div', 'mg-kf-side is-victim ' + tcls(e.victimTeam, e.local === 'victim'), row);
    const vh = icoEl(HERO_ICON[e.victimHero], 'mg-kf-h', v);
    vh.style.setProperty('--hc', HEROES[e.victimHero]?.color ?? '#fff');
    el('span', 'mg-kf-n', v, e.victim);
    this.killfeed.appendChild(row);
    this.kills.push({ el: row, until: this.time + 6.5 });
    while (this.kills.length > 6) this.kills.shift()!.el.remove();
    if (e.local === 'killer') {
      this.elim.textContent = '';
      icoEl(UI.skull, '', this.elim);
      el('span', 'k', this.elim, t('hud.elim'));
      el('span', 'v', this.elim, e.victim);
      this.elim.className = 'mg-elim is-on';
      this.elim.animate([{ opacity: 0, transform: 'translateX(-50%) scale(1.25)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], { duration: 220, easing: 'ease-out' });
      this.elimUntil = this.time + 1.8;
    } else if (e.local === 'assist') {
      this.elim.textContent = '';
      el('span', 'k', this.elim, t('hud.assist'));
      el('span', 'v', this.elim, e.victim);
      this.elim.className = 'mg-elim is-on is-assist';
      this.elimUntil = this.time + 1.5;
    }
  }

  private addXp(amount: number, label: string): void {
    const row = el('div', 'mg-xp');
    el('span', 'v', row, '+' + amount);
    el('span', 'l', row, label);
    this.xpFeed.appendChild(row);
    row.animate([{ opacity: 0, transform: 'translateY(-0.6rem) scale(1.15)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    this.xpItems.push({ el: row, until: this.time + 2.6, amount });
    while (this.xpItems.length > 5) this.xpItems.shift()!.el.remove();
    const total = this.xpItems.reduce((a, x) => a + x.amount, 0);
    this.xpTotal.textContent = '+' + total + ' XP';
    this.xpTotal.classList.toggle('is-on', this.xpItems.length > 1);
    if (this.xpItems.length > 1) this.xpTotal.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 200 });
  }

  private addToast(text: string, kind: string, extra = ''): void {
    const row = el('div', 'mg-htoast is-' + kind + (extra ? ' is-' + extra : ''));
    icoEl(kind === 'good' ? UI.check : kind === 'bad' || kind === 'warn' ? UI.warning : extra === 'cap' ? UI.flag : UI.info, '', row);
    el('span', '', row, text);
    this.toasts.appendChild(row);
    this.toastItems.push({ el: row, until: this.time + 3.4 });
    while (this.toastItems.length > 3) this.toastItems.shift()!.el.remove();
  }

  private addChat(from: string, team: number, text: string): void {
    const row = el('div', 'mg-chat-line');
    el('span', 'n' + (team === this.objLocalTeam ? ' is-ally' : team >= 0 ? ' is-enemy' : ''), row, from + ':');
    el('span', 't', row, ' ' + text);
    this.chatLog.appendChild(row);
    this.chatLines.push({ el: row, until: this.time + 10 });
    while (this.chatLines.length > 8) this.chatLines.shift()!.el.remove();
  }

  private addDamage(amount: number, x: number, y: number, head: boolean): void {
    if (!this.settings.damageNumbers) return;
    const d = this.dmgPool[this.dmgIdx];
    this.dmgIdx = (this.dmgIdx + 1) % this.dmgPool.length;
    d.textContent = String(Math.round(amount));
    d.className = 'mg-dnum' + (head ? ' is-head' : '');
    const jx = (Math.random() - 0.5) * 30;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.animate(
      [
        { opacity: 0, transform: `translate(-50%,-50%) translate(${jx}px, 0) scale(${head ? 1.6 : 1.3})` },
        { opacity: 1, transform: `translate(-50%,-50%) translate(${jx}px, -14px) scale(1)`, offset: 0.15 },
        { opacity: 0, transform: `translate(-50%,-50%) translate(${jx * 1.5}px, -54px) scale(0.9)` },
      ],
      { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
  }

  private showRibbon(e: Extract<HudEvent, { type: 'ribbon' }>): void {
    const b = this.ribbonBox;
    b.textContent = '';
    const m = el('div', 'mg-ribpop-medal', b);
    m.innerHTML = ribbonSvg(e.id);
    el('div', 'mg-ribpop-t', b, ribbonName(e.id));
    b.className = 'mg-ribpop is-on';
    b.animate(
      [
        { opacity: 0, transform: 'translateX(-50%) scale(0.5)' },
        { opacity: 1, transform: 'translateX(-50%) scale(1.12)', offset: 0.25 },
        { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.35 },
        { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.85 },
        { opacity: 0, transform: 'translateX(-50%) scale(0.9) translateY(-1rem)' },
      ],
      { duration: 2400, easing: 'ease-out', fill: 'forwards' },
    );
  }

  private showBig(m: { title: string; sub?: string; kind: string }): void {
    const b = this.bigBox;
    b.textContent = '';
    el('div', 'mg-big-t', b, m.title);
    if (m.sub) el('div', 'mg-big-s', b, m.sub);
    b.className = 'mg-big is-on is-' + m.kind;
    b.animate(
      [
        { opacity: 0, transform: 'translateX(-50%) scale(1.4)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'translateX(-50%) scale(1)', filter: 'blur(0)', offset: 0.1 },
        { opacity: 1, transform: 'translateX(-50%) scale(1)', filter: 'blur(0)', offset: 0.85 },
        { opacity: 0, transform: 'translateX(-50%) scale(0.96)', filter: 'blur(2px)' },
      ],
      { duration: 2800, easing: 'ease-out', fill: 'forwards' },
    );
  }

  private tickFeeds(now: number): void {
    if (this.kills.length && this.kills[0].until < now) {
      const k = this.kills.shift()!;
      k.el.classList.add('is-out');
      window.setTimeout(() => k.el.remove(), 300);
    }
    if (this.xpItems.length && this.xpItems[0].until < now) {
      const x = this.xpItems.shift()!;
      x.el.classList.add('is-out');
      window.setTimeout(() => x.el.remove(), 300);
      if (this.xpItems.length <= 1) this.xpTotal.classList.remove('is-on');
    }
    if (this.toastItems.length && this.toastItems[0].until < now) {
      const x = this.toastItems.shift()!;
      x.el.classList.add('is-out');
      window.setTimeout(() => x.el.remove(), 300);
    }
    if (this.chatLines.length && this.chatLines[0].until < now && !this._chatOpen) {
      const x = this.chatLines[0];
      if (!x.el.classList.contains('is-faded')) x.el.classList.add('is-faded');
      this.chatLines.shift();
    }
    if (this.elimUntil && this.elimUntil < now) {
      this.elimUntil = 0;
      this.elim.classList.remove('is-on');
    }
    if (now >= this.bigUntil && this.bigQueue.length) {
      this.showBig(this.bigQueue.shift()!);
      this.bigUntil = now + 2.7;
    }
    if (now >= this.ribbonUntil && this.ribbonQueue.length) {
      const r = this.ribbonQueue.shift()!;
      if (r.type === 'ribbon') this.showRibbon(r);
      this.ribbonUntil = now + 2.2;
    }
  }
}
