import './fonts';
import './theme.css';
import { HEROES, MODES, levelFromXp, type HeroId, type MatchResult, type ModeId, type Profile, type Settings } from '../game/Types';
import { logoEmblemSvg } from './art';
import { clear, div, h, ico, span } from './dom';
import { bi, getLang, heroName, heroTagline, mapName, modeName, onLangChange, setLang, t } from './i18n';
import { ROLE_COLOR, ROLE_ICON, UI } from './icons';
import type { MenuCtx, ScreenId, ScreenInst, UiState } from './menu/ctx';
import { buildEnd, buildHeroSelect, buildLoading, buildMatchmaking, buildPause, type HeroSelectOpts, type PauseInfo } from './menu/match';
import { buildHeroes } from './menu/heroes';
import { buildPlay } from './menu/play';
import { buildProfile } from './menu/profile';
import { buildSettings } from './menu/settings';
import { heroStage } from './menu/stage';
import { btn, kbd, levelBadge, xpBar, type Snd } from './menu/widgets';
import { heroMastery, rankInfo, saveProfile, saveSettings, selectedBuild } from './Storage';

export interface RoomInfo {
  roomId: string;
  mode: string;
  name: string;
  players: number;
  capacity: number;
}

export interface MenuCallbacks {
  /** build = selected (unlocked) talent path id for the hero */
  onPlay(req: { mode: ModeId; online: boolean; hero: HeroId; build?: string }): void;
  onJoinRoom(roomId: string, hero: HeroId): void;
  onCreateRoom(mode: ModeId, hero: HeroId): void;
  onSettingsChanged(s: Settings): void;
  onProfileChanged(p: Profile): void;
  onHeroPicked(hero: HeroId, build?: string): void;
  onResume(): void;
  onLeaveMatch(): void;
  onUiSound(kind: 'click' | 'hover' | 'back' | 'confirm' | 'error'): void;
  listRooms(mode?: ModeId): Promise<RoomInfo[]>;
  requestHeroPreview?(canvas: HTMLCanvasElement, hero: HeroId | null): void;
  /** PWA: the browser offered installation (show the "install app" entry) */
  canInstall?(): boolean;
  installApp?(): void;
}

const BUILD = '0.1 · S1';

/** relabels the main menu's full-screen item when the browser enters / leaves full screen (F11, Esc…) */
let fsLabelSync: (() => void) | null = null;
if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', () => fsLabelSync?.());

export class MenuSystem {
  private readonly root: HTMLElement;
  private readonly host: HTMLElement;
  private readonly topbar: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly toastsEl: HTMLElement;
  private _visible = false;
  private _screen: ScreenId = 'hidden';
  private cur: ScreenInst | null = null;
  private stack: ScreenId[] = [];
  private settings: Settings;
  private profile: Profile;
  private portraits: Partial<Record<HeroId, string>> = {};
  private net: boolean | null = null;
  private installItem: () => HTMLElement | null = () => null;
  private inMatch = false;
  private pauseInfo: PauseInfo | null = null;
  private heroSelOpts: HeroSelectOpts | null = null;
  private heroSelCtl: { update(o: HeroSelectOpts): void } | null = null;
  private loadingCtl: { update(title: string, progress: number, tip?: string): void } | null = null;
  private mmCtl: { update(status: string, onCancel: () => void): void } | null = null;
  private lastHover: Element | null = null;
  private lastHoverT = 0;
  private readonly state: UiState;
  private readonly ctx: MenuCtx;

  constructor(
    root: HTMLElement,
    private readonly cb: MenuCallbacks,
    settings: Settings,
    profile: Profile,
  ) {
    this.host = root;
    this.settings = settings;
    this.profile = profile;
    setLang(settings.language);
    this.state = {
      playMode: 'war4v4',
      playTab: 'modes',
      serverFilter: 'all',
      heroesSel: profile.selectedHero,
      profileTab: 'overview',
      settingsTab: 'graphics',
      joinCode: '',
    };
    this.root = div('mg-menu mg-ui');
    this.root.setAttribute('data-screen', 'hidden');
    this.topbar = div('mg-topbar');
    this.stageEl = div('mg-screen-host');
    this.toastsEl = div('mg-toasts');
    this.root.append(div('mg-backdrop'), div('mg-scanlines'), this.stageEl, this.topbar, this.toastsEl);
    root.appendChild(this.root);

    const self = this;
    this.ctx = {
      cb,
      get settings() {
        return self.settings;
      },
      get profile() {
        return self.profile;
      },
      get portraits() {
        return self.portraits;
      },
      get net() {
        return self.net;
      },
      get inMatch() {
        return self.inMatch;
      },
      state: this.state,
      go: (id) => this.go(id),
      back: () => this.back(),
      snd: (k) => this.snd(k),
      applySettings: (s, rebuild) => this.applySettings(s, rebuild),
      applyProfile: (p) => this.applyProfile(p),
      toast: (text, kind) => this.toast(text, kind),
      rerender: () => this.rerender(),
    };

    this.root.addEventListener('pointerover', this.onPointerOver);
    this.root.addEventListener('click', this.onClickSound, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    onLangChange(() => {
      this.renderTopbar();
      this.rerender();
    });
    this.renderTopbar();
    this.syncVisibility();
  }

  get visible(): boolean {
    return this._visible;
  }

  get screen(): string {
    return this._screen;
  }

  // -------------------------------------------------------------------------
  // public API

  showMain(): void {
    this.inMatch = false;
    this.pauseInfo = null;
    this.stack = [];
    this.mount('main');
  }

  showLoading(title: string, progress: number, tip?: string): void {
    if (this._screen === 'loading' && this.loadingCtl) {
      this.loadingCtl.update(title, progress, tip);
      return;
    }
    this.stack = [];
    const r = buildLoading(this.ctx, title, progress, tip);
    this.mountInst('loading', r.inst);
    this.loadingCtl = r.ctl;
  }

  showMatchmaking(status: string, onCancel: () => void): void {
    if (this._screen === 'matchmaking' && this.mmCtl) {
      this.mmCtl.update(status, onCancel);
      return;
    }
    const r = buildMatchmaking(this.ctx, status, onCancel);
    this.mountInst('matchmaking', r.inst);
    this.mmCtl = r.ctl;
  }

  showHeroSelect(opts: HeroSelectOpts): void {
    this.inMatch = true;
    this.heroSelOpts = opts;
    if (this._screen === 'heroselect' && this.heroSelCtl) {
      this.heroSelCtl.update(opts);
      return;
    }
    this.stack = [];
    const r = buildHeroSelect(this.ctx, opts, (hero, build) => {
      this.setSelectedHero(hero, build);
      this.cb.onHeroPicked(hero, build);
      this.hide();
    }, () => {
      this.hide();
      this.cb.onResume();
    });
    this.mountInst('heroselect', r.inst);
    this.heroSelCtl = r.ctl;
  }

  showPause(info: PauseInfo): void {
    this.inMatch = true;
    this.pauseInfo = info;
    this.stack = [];
    this.mount('pause');
  }

  showEndOfMatch(result: MatchResult, before: Profile, after: Profile, onContinue: () => void): void {
    this.inMatch = false;
    this.stack = [];
    const inst = buildEnd(this.ctx, result, before, after, () => {
      onContinue();
    });
    this.mountInst('end', inst);
  }

  hide(): void {
    this.unmount();
    this._screen = 'hidden';
    this._visible = false;
    this.syncVisibility();
  }

  setProfile(p: Profile): void {
    if (JSON.stringify(p) === JSON.stringify(this.profile)) return;
    this.profile = p;
    this.renderTopbar();
    this.refreshOrRebuild('profile', ['main', 'play', 'heroes', 'profile']);
  }

  setSettings(s: Settings): void {
    if (JSON.stringify(s) === JSON.stringify(this.settings)) return;
    this.settings = s;
    if (s.language !== getLang()) setLang(s.language); // triggers full rerender
    else this.refreshOrRebuild('settings', ['settings', 'play']);
  }

  setHeroPortraits(p: Partial<Record<HeroId, string>>): void {
    this.portraits = { ...this.portraits, ...p };
    this.refreshOrRebuild('portraits', ['main', 'play', 'heroes', 'profile', 'heroselect', 'end']);
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const icon = kind === 'good' ? UI.check : kind === 'bad' ? UI.warning : UI.info;
    const el = div('mg-toast mg-toast--' + kind, ico(icon), span('', text));
    this.toastsEl.appendChild(el);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstElementChild?.remove();
    if (kind === 'bad') this.cb.onUiSound('error');
    window.setTimeout(() => {
      el.classList.add('is-out');
      window.setTimeout(() => el.remove(), 320);
    }, 3400);
  }

  setNetStatus(s: { lobby: boolean }): void {
    if (this.net === s.lobby) return;
    this.net = s.lobby;
    this.renderTopbar();
    this.refreshOrRebuild('net', ['main', 'play']);
  }

  // -------------------------------------------------------------------------
  // navigation

  private go(id: ScreenId): void {
    if (id === this._screen) return;
    if (this._screen !== 'hidden' && this._screen !== 'loading' && this._screen !== 'matchmaking' && this._screen !== 'end') this.stack.push(this._screen);
    this.mount(id);
  }

  private back(): void {
    const prev = this.stack.pop();
    if (prev) this.mount(prev);
    else if (this.inMatch && this.pauseInfo) this.mount('pause');
    else this.mount('main');
  }

  private mount(id: ScreenId): void {
    let inst: ScreenInst | null = null;
    switch (id) {
      case 'main':
        inst = this.buildMain();
        break;
      case 'play':
        inst = buildPlay(this.ctx);
        break;
      case 'heroes':
        inst = buildHeroes(this.ctx);
        break;
      case 'profile':
        inst = buildProfile(this.ctx);
        break;
      case 'settings':
        inst = buildSettings(this.ctx);
        break;
      case 'credits':
        inst = this.buildCredits();
        break;
      case 'pause':
        inst = this.pauseInfo
          ? buildPause(this.ctx, this.pauseInfo, {
              resume: () => {
                this.hide();
                this.cb.onResume();
              },
              leave: () => {
                this.inMatch = false;
                this.cb.onLeaveMatch();
              },
            })
          : null;
        break;
      case 'heroselect':
        if (this.heroSelOpts) {
          this.showHeroSelect(this.heroSelOpts);
          return;
        }
        break;
      default:
        break;
    }
    if (inst) this.mountInst(id, inst);
  }

  private mountInst(id: ScreenId, inst: ScreenInst): void {
    this.unmount();
    this.cur = inst;
    this._screen = id;
    this._visible = true;
    this.root.setAttribute('data-screen', id);
    this.root.setAttribute('data-layer', inst.layer);
    inst.el.classList.add('mg-screen', 'mg-enter');
    this.stageEl.appendChild(inst.el);
    window.setTimeout(() => inst.el.classList.remove('mg-enter'), 600);
    this.topbar.classList.toggle('is-hidden', inst.layer !== 'front' || this.inMatch);
    this.syncVisibility();
    // focus first focusable for keyboard users (without scrolling)
    const f = inst.el.querySelector<HTMLElement>('[data-autofocus]');
    f?.focus({ preventScroll: true });
  }

  private unmount(): void {
    if (this.cur) {
      try {
        this.cur.destroy?.();
      } catch (e) {
        console.error(e);
      }
      this.cur.el.remove();
      this.cur = null;
    }
    this.loadingCtl = null;
    this.mmCtl = null;
    this.heroSelCtl = null;
  }

  private rerender(): void {
    const id = this._screen;
    if (id === 'hidden' || id === 'loading' || id === 'matchmaking' || id === 'end') {
      // those rebuild on next show call; keep their live state
      return;
    }
    if (id === 'heroselect') {
      if (this.heroSelOpts) {
        this.heroSelCtl = null;
        this._screen = 'hidden';
        this.showHeroSelect(this.heroSelOpts);
      }
      return;
    }
    const scroll = this.cur?.el.querySelector('.mg-scroll')?.scrollTop ?? 0;
    this.mount(id);
    const sc = this.cur?.el.querySelector('.mg-scroll');
    if (sc) sc.scrollTop = scroll;
  }

  private refreshOrRebuild(what: 'settings' | 'profile' | 'portraits' | 'net', screens: ScreenId[]): void {
    if (!this.cur) return;
    if (this.cur.refresh && this.cur.refresh(what)) return;
    if (screens.includes(this._screen)) this.rerender();
  }

  private syncVisibility(): void {
    this.root.classList.toggle('is-visible', this._visible);
  }

  private setSelectedHero(hero: HeroId, build?: string): void {
    const sameBuild = !build || this.profile.builds?.[hero] === build;
    if (this.profile.selectedHero === hero && sameBuild) return;
    this.applyProfile({ ...this.profile, selectedHero: hero, builds: build ? { ...(this.profile.builds ?? {}), [hero]: build } : this.profile.builds });
  }

  private applySettings(s: Settings, rebuild = false): void {
    const langChanged = s.language !== this.settings.language;
    this.settings = s;
    saveSettings(s);
    this.cb.onSettingsChanged(s);
    if (langChanged) setLang(s.language);
    else if (rebuild) this.rerender();
  }

  private applyProfile(p: Profile): void {
    this.profile = p;
    saveProfile(p);
    this.cb.onProfileChanged(p);
    this.renderTopbar();
  }

  private snd(k: Snd): void {
    this.cb.onUiSound(k);
  }

  // -------------------------------------------------------------------------
  // input

  private onPointerOver = (e: PointerEvent): void => {
    const target = (e.target as Element | null)?.closest?.('button, .mg-hover, input[type=range], a');
    if (!target) {
      this.lastHover = null;
      return;
    }
    if (target === this.lastHover) return;
    this.lastHover = target;
    if ((target as HTMLButtonElement).disabled) return;
    const now = performance.now();
    if (now - this.lastHoverT < 45) return;
    this.lastHoverT = now;
    this.cb.onUiSound('hover');
  };

  private onClickSound = (e: MouseEvent): void => {
    const el = (e.target as Element | null)?.closest?.('[data-snd]') as HTMLElement | null;
    if (!el) return;
    if ((el as HTMLButtonElement).disabled) {
      this.cb.onUiSound('error');
      return;
    }
    const k = (el.getAttribute('data-snd') || 'click') as Snd;
    this.cb.onUiSound(k);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this._visible || !this.cur) return;
    if (this.cur.onKey && this.cur.onKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const tgt = e.target as HTMLElement | null;
    const typing = !!tgt && (tgt.tagName === 'TEXTAREA' || (tgt.tagName === 'INPUT' && (tgt as HTMLInputElement).type !== 'range' && (tgt as HTMLInputElement).type !== 'checkbox'));
    if (e.key === 'Escape') {
      if (typing) {
        tgt!.blur();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const s = this._screen;
      let handled = true;
      if (s === 'play' || s === 'heroes' || s === 'profile' || s === 'settings' || s === 'credits') {
        this.snd('back');
        this.back();
      } else if (s === 'pause') {
        this.snd('back');
        this.hide();
        this.cb.onResume();
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (typing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (tgt && tgt.tagName === 'INPUT') return;
      const list = Array.from(this.cur.el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([type=range]), [tabindex="0"]')).filter((x) => x.offsetParent !== null);
      if (!list.length) return;
      const i = tgt ? list.indexOf(tgt) : -1;
      const n = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[i < 0 ? 0 : n].focus();
      this.snd('hover');
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // -------------------------------------------------------------------------
  // top bar

  private renderTopbar(): void {
    const tb = this.topbar;
    clear(tb);
    const lv = levelFromXp(this.profile.xp);
    const rank = rankInfo(lv.level, getLang());
    const netCls = this.net === null ? 'is-checking' : this.net ? 'is-online' : 'is-offline';
    const netLbl = this.net === null ? t('net.checking') : this.net ? t('net.online') : t('net.offline');
    const net = div('mg-net ' + netCls, span('mg-net-dot'), ico(this.net === false ? UI.wifiOff : UI.wifi), span('', netLbl));
    if (this.net === false) net.title = t('net.offlineHint');

    const lang = h('button', { class: 'mg-langsw', type: 'button', 'data-snd': 'click', title: t('set.language') }, span(getLang() === 'ru' ? 'on' : '', 'RU'), span(getLang() === 'en' ? 'on' : '', 'EN'));
    lang.addEventListener('click', () => this.applySettings({ ...this.settings, language: getLang() === 'ru' ? 'en' : 'ru' }));

    const card = h(
      'button',
      { class: 'mg-pcard', type: 'button', 'data-snd': 'click', title: t('nav.profile') },
      levelBadge(lv.level, 'mg-pcard-badge'),
      div(
        'mg-pcard-info',
        div('mg-pcard-name', this.profile.name),
        div('mg-pcard-rank mg-tier-text--' + rank.tier, rank.title, span('mg-pcard-lv', ` · ${t('player.level')} ${lv.level}`)),
        div('mg-pcard-xp', xpBar(lv.into, lv.need), span('mg-pcard-xpt', t('player.xp', { into: lv.into, need: lv.need }))),
      ),
    );
    card.addEventListener('click', () => {
      if (this._screen !== 'profile' && !this.inMatch) this.go('profile');
    });
    const pd = div('mg-top-pd', ico(UI.pd), span('', 'Pd-46'));
    tb.append(div('mg-top-left', pd), div('mg-top-right', net, lang, card));
  }

  // -------------------------------------------------------------------------
  // main menu

  private buildMain(): ScreenInst {
    const ctx = this.ctx;
    const hero = this.profile.selectedHero;
    const hd = HEROES[hero];
    const el = div('mg-page mg-main');
    el.style.setProperty('--hc', hd.color);

    const emblem = div('mg-logo-emblem');
    emblem.innerHTML = logoEmblemSvg();
    const logo = div(
      'mg-logo',
      emblem,
      div('mg-logo-text', span('mg-logo-w1', 'MOON'), span('mg-logo-w2', 'GRAVITY')),
      div('mg-logo-sub', span('', getLang() === 'ru' ? 'Война за палладий' : 'The palladium war'), span('mg-logo-pd', 'Pd · 46')),
    );

    this.installItem = () => {
      if (!this.cb.canInstall?.()) return null;
      const b = h(
        'button',
        { class: 'mg-nav-item is-small', type: 'button', 'data-snd': 'click' },
        span('mg-nav-bar'),
        ico(UI.plus, 'mg-nav-ico'),
        span('mg-nav-txt', span('mg-nav-label', t('nav.install'))),
      );
      b.addEventListener('click', () => this.cb.installApp?.());
      return b;
    };
    // full screen toggle (browser full screen; F11 also works)
    const fsItem = (() => {
      const de = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      if (!document.fullscreenEnabled && !de.webkitRequestFullscreen) return null;
      const label = span('mg-nav-label', '');
      const b = h('button', { class: 'mg-nav-item is-small', type: 'button', 'data-snd': 'click' }, span('mg-nav-bar'), ico(UI.monitor, 'mg-nav-ico'), span('mg-nav-txt', label));
      const sync = () => {
        label.textContent = t(document.fullscreenElement ? 'nav.windowed' : 'nav.fullscreen');
      };
      sync();
      fsLabelSync = sync;
      b.addEventListener('click', () => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else if (de.requestFullscreen) void de.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
        else de.webkitRequestFullscreen?.();
      });
      return b;
    })();
    const navItem = (id: ScreenId, label: string, sub: string, icon: string, cls = '') => {
      const b = h(
        'button',
        { class: 'mg-nav-item ' + cls, type: 'button', 'data-snd': 'click' },
        span('mg-nav-bar'),
        ico(icon, 'mg-nav-ico'),
        span('mg-nav-txt', span('mg-nav-label', label), sub ? span('mg-nav-sub', sub) : null),
      );
      b.addEventListener('click', () => this.go(id));
      return b;
    };
    const play = navItem('play', t('nav.play'), t('nav.play.sub'), UI.play, 'is-primary');
    play.setAttribute('data-autofocus', '');
    const nav = h(
      'nav',
      { class: 'mg-nav' },
      play,
      navItem('heroes', t('nav.heroes'), t('nav.heroes.sub'), UI.helmet),
      navItem('profile', t('nav.profile'), t('nav.profile.sub'), UI.profile),
      navItem('settings', t('nav.settings'), t('nav.settings.sub'), UI.gear),
      navItem('credits', t('nav.credits'), '', UI.star, 'is-small'),
      fsItem,
      this.installItem(),
    );

    const news = div(
      'mg-news',
      div('mg-news-h', ico(UI.moon), span('', t('main.news'))),
      div(
        'mg-news-list',
        ...[1, 2, 3].map((i) =>
          div('mg-news-card mg-hover', span('mg-news-n', '0' + i), div('mg-news-body', div('mg-news-t', t(`main.news${i}.t`)), div('mg-news-d', t(`main.news${i}.d`)))),
        ),
      ),
    );

    const stage = heroStage(ctx, hero, 'mg-main-stage');
    const change = btn(t('main.changeHero'), () => this.go('heroes'), { kind: 'ghost', icon: UI.helmet });
    const info = div(
      'mg-main-hero',
      div('mg-main-hero-k', t('main.selectedHero')),
      div('mg-main-hero-name', heroName(hero)),
      div('mg-main-hero-role', ico(ROLE_ICON[hd.role]), span('', t('role.' + hd.role)), span('mg-dot'), span('mg-main-hero-build', bi(hd.builds.find((b) => b.id === selectedBuild(this.profile, hero))?.name)), span('mg-dot'), span('', t('mastery.level', { n: heroMastery(this.profile, hero).level }))),
      div('mg-main-hero-tag', heroTagline(hero)),
      change,
    );

    const mode = this.state.playMode;
    const online = this.net !== false;
    const cta = btn(
      online ? t('main.quick') : t('play.bots'),
      () => this.cb.onPlay({ mode, online: this.net !== false, hero: this.profile.selectedHero, build: selectedBuild(this.profile, this.profile.selectedHero) }),
      { kind: 'primary', big: true, icon: UI.play, sub: `${modeName(mode)} · ${mapName(MODES[mode].map)}`, cls: 'mg-main-cta' },
    );

    const foot = div('mg-main-foot', span('mg-buildver', t('main.version', { v: BUILD })), span('mg-foot-keys', kbd('↑↓'), span('', getLang() === 'ru' ? 'навигация' : 'navigate'), kbd('Enter'), span('', getLang() === 'ru' ? 'выбор' : 'select')));

    el.append(div('mg-main-left', logo, nav), div('mg-main-right', stage.el, info), news, cta, foot);
    return {
      el,
      layer: 'front',
      destroy: () => stage.destroy(),
      refresh: (what) => {
        if (what === 'net') {
          const o = this.net !== false;
          const lbl = cta.querySelector('.mg-btn-label');
          if (lbl) lbl.textContent = o ? t('main.quick') : t('play.bots');
          return true;
        }
        return false;
      },
    };
  }

  private buildCredits(): ScreenInst {
    const el = div('mg-page mg-credits');
    const logo = div('mg-credits-logo');
    logo.innerHTML = logoEmblemSvg();
    const row = (k: string, v: string) => div('mg-credits-row', div('mg-credits-k', k), div('mg-credits-v', v));
    const back = h('button', { class: 'mg-back', type: 'button', 'data-snd': 'back' }, ico(UI.back), kbd('Esc'));
    back.addEventListener('click', () => this.back());
    el.append(
      h('header', { class: 'mg-head' }, back, h('h1', { class: 'mg-title' }, t('credits.title'))),
      div(
        'mg-credits-card mg-panel',
        logo,
        div('mg-credits-title', span('mg-logo-w1', 'MOON'), span('mg-logo-w2', 'GRAVITY')),
        div('mg-credits-tag', t('credits.tagline')),
        row(t('credits.design'), t('credits.team')),
        row(t('credits.tech'), 'three.js · TypeScript · Vite · WebRTC'),
        row(t('credits.fonts'), 'Russo One · Exo 2 · Oswald — SIL OFL'),
        div('mg-credits-thanks', ico(UI.moon), span('', t('credits.thanks'))),
      ),
    );
    return { el, layer: 'front' };
  }
}
