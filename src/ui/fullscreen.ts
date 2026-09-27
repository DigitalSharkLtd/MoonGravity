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

export function enterFullscreen(): void {
  if (isFullscreen()) return;
  const de = document.documentElement as FsElement;
  if (de.requestFullscreen) void de.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  else de.webkitRequestFullscreen?.();
}

export function exitFullscreen(): void {
  if (!isFullscreen()) return;
  const d = document as FsDocument;
  if (document.exitFullscreen) void document.exitFullscreen().catch(() => undefined);
  else d.webkitExitFullscreen?.();
}

export function toggleFullscreen(): void {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
}
