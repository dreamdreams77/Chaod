/**
 * Device features that are optional extras: installing the game as an app, a fullscreen switch, a
 * landscape lock for phones and a download of the offline copy. Everything here degrades quietly
 * where the browser has no support (iPhones, file:// pages, desktop browsers without install).
 */

/** The install prompt Chrome-family browsers hand us (kept until the player asks for it). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallPromptEvent | null = null;
let installed = false;

export function watchInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
  });
}

export function isStandalone(): boolean {
  try {
    return installed || window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
}

export type InstallState = 'installed' | 'prompt' | 'ios' | 'manual';

/** What the INSTALL AS APP row should say and do, from three facts about the browser. */
export function installInfo(f: { standalone: boolean; hasPrompt: boolean; ios: boolean }): { state: InstallState; value: string; help: string } {
  if (f.standalone) return { state: 'installed', value: 'INSTALLED', help: 'CHAOS.exe is running as an installed app.' };
  if (f.hasPrompt) return { state: 'prompt', value: 'INSTALL', help: 'Adds CHAOS.exe to your home screen or desktop. It runs full screen and works offline.' };
  if (f.ios) return { state: 'ios', value: 'HOW?', help: 'On iPhone and iPad: tap the Share button, then "Add to Home Screen".' };
  return { state: 'manual', value: 'HOW?', help: 'Open your browser menu and choose "Install app" or "Add to Home Screen".' };
}

export function installState(): ReturnType<typeof installInfo> {
  return installInfo({ standalone: isStandalone(), hasPrompt: deferred !== null, ios: isIOS() });
}

/** Shows the browser's install dialog when there is one; returns true if the player accepted. */
export async function promptInstall(): Promise<boolean> {
  const d = deferred;
  if (!d) return false;
  deferred = null;
  try {
    await d.prompt();
    const choice = await d.userChoice;
    installed = choice.outcome === 'accepted';
    return installed;
  } catch {
    return false;
  }
}

export function fullscreenSupported(): boolean {
  return typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
}
export function isFullscreen(): boolean {
  return document.fullscreenElement !== null && document.fullscreenElement !== undefined;
}
export async function setFullscreen(on: boolean): Promise<boolean> {
  try {
    if (on && !isFullscreen()) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    else if (!on && isFullscreen()) await document.exitFullscreen();
    return true;
  } catch {
    return false;
  }
}

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

export function orientationLockSupported(): boolean {
  return typeof (screen.orientation as LockableOrientation | undefined)?.lock === 'function';
}

/**
 * Asks the phone to stay in landscape (or to follow the sensor again). Chrome on Android only honours the
 * lock in fullscreen or an installed app, so landscape goes fullscreen first. Returns false when unsupported.
 */
export async function setRotation(mode: 'auto' | 'landscape'): Promise<boolean> {
  const o = screen.orientation as LockableOrientation | undefined;
  if (!o) return false;
  try {
    if (mode === 'auto') {
      o.unlock?.();
      return true;
    }
    if (typeof o.lock !== 'function') return false;
    if (fullscreenSupported() && !isFullscreen() && !isStandalone()) await setFullscreen(true);
    await o.lock('landscape');
    return true;
  } catch {
    return false;
  }
}

/** Downloads this page as one self-contained file that runs offline (the game is a single HTML file). */
export async function downloadOfflineCopy(): Promise<boolean> {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
  try {
    const res = await fetch(location.href.split('#')[0].split('?')[0], { cache: 'no-cache' });
    if (!res.ok) return false;
    const html = await res.text();
    if (!html.includes('CHAOS.exe')) return false;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = 'chaos-exe.html';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(a.href);
    }, 2000);
    return true;
  } catch {
    return false;
  }
}

/** Registers the service worker that makes the game installable and playable offline. */
export function registerOffline(): void {
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1')) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* no service worker (blocked, private mode): the game still works online */
    });
  });
}
