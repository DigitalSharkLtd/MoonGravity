/** Browser full screen helpers (must be called from a user gesture: click / key press). */
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type FsDocument = Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element | null };

export function fullscreenSupported(): boolean {
  const de = document.documentElement as FsElement;
  return !!(document.fullscreenEnabled || de.webkitRequestFullscreen);
}

export function isFullscreen(): boolean {
  const d = document as FsDocument;
  return !!(document.fullscreenElement || d.webkitFullscreenElement);
}

type KbLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };
const keyboard = (): KbLock | undefined => (navigator as Navigator & { keyboard?: KbLock }).keyboard;

export function enterFullscreen(): void {
  if (isFullscreen()) return;
  const de = document.documentElement as FsElement;
  if (de.requestFullscreen)
    void de
      .requestFullscreen({ navigationUI: 'hide' })
      // Keyboard Lock (Chrome / Edge): Esc goes to the game (pause) instead of leaving full screen;
      // the browser then asks to press and hold Esc to exit. F10 toggles full screen.
      .then(() => keyboard()?.lock?.(['Escape']))
      .catch(() => undefined);
  else de.webkitRequestFullscreen?.();
}

export function exitFullscreen(): void {
  keyboard()?.unlock?.();
  if (!isFullscreen()) return;
  const d = document as FsDocument;
  if (document.exitFullscreen) void document.exitFullscreen().catch(() => undefined);
  else d.webkitExitFullscreen?.();
}

export function toggleFullscreen(): void {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
}
