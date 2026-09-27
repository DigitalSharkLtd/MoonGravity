/**
 * PWA: service worker registration + install prompt capture.
 * Only in production builds (the dev server serves modules that must not be cached).
 */
let deferredPrompt: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;

export function registerPwa(onInstallable?: () => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('[pwa] sw registration failed', e));
  });
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as typeof deferredPrompt;
    onInstallable?.();
  });
  addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
}

/** true when the browser offered installation and it hasn't been used yet */
export function canInstall(): boolean {
  return !!deferredPrompt;
}

/** show the browser's install dialog (must be called from a user gesture) */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const p = deferredPrompt;
  deferredPrompt = null;
  await p.prompt();
  const choice = await p.userChoice;
  return choice.outcome === 'accepted';
}

/** running as an installed app (standalone / fullscreen / TWA) */
export function isInstalled(): boolean {
  return matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || document.referrer.startsWith('android-app://');
}
