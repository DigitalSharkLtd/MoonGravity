import type { HeroId, ModeId, Profile, Settings } from '../../game/Types';
import type { MenuCallbacks } from '../Menu';
import type { Snd } from './widgets';

export type ScreenId =
  | 'hidden'
  | 'main'
  | 'play'
  | 'heroes'
  | 'profile'
  | 'settings'
  | 'credits'
  | 'loading'
  | 'matchmaking'
  | 'heroselect'
  | 'pause'
  | 'end';

export type ProfileTab = 'overview' | 'heroes' | 'history' | 'ribbons';
export type SettingsTab = 'graphics' | 'audio' | 'controls' | 'game' | 'crosshair';

/** UI state that survives screen switches / re-renders */
export interface UiState {
  playMode: ModeId;
  playTab: 'modes' | 'servers';
  serverFilter: ModeId | 'all';
  heroesSel: HeroId;
  profileTab: ProfileTab;
  settingsTab: SettingsTab;
  joinCode: string;
}

export interface ScreenInst {
  el: HTMLElement;
  /** 'front' = main-menu family (top bar, see-through backdrop); 'overlay' = in-match dimmed; 'opaque' = loading */
  layer: 'front' | 'overlay' | 'opaque' | 'float';
  destroy?(): void;
  /** return true if the key was consumed */
  onKey?(e: KeyboardEvent): boolean;
  /** called when settings/profile/portraits/net change without a full rebuild; return false to request rebuild */
  refresh?(what: 'settings' | 'profile' | 'portraits' | 'net'): boolean;
}

export interface MenuCtx {
  readonly cb: MenuCallbacks;
  readonly settings: Settings;
  readonly profile: Profile;
  readonly portraits: Partial<Record<HeroId, string>>;
  readonly net: boolean | null;
  readonly state: UiState;
  readonly inMatch: boolean;
  go(id: ScreenId): void;
  back(): void;
  snd(kind: Snd): void;
  /** apply + persist + notify; rebuild current screen when `rebuild` */
  applySettings(s: Settings, rebuild?: boolean): void;
  applyProfile(p: Profile): void;
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void;
  rerender(): void;
}
