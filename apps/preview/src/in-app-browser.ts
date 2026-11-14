// In-app browsers (the web views inside Instagram, Facebook, WhatsApp, LinkedIn…) are where most QR
// and social links open, and they often block the camera, WebXR and AR Quick Look. PROJECT.md asks for a
// clear "Open in browser" step there instead of a broken AR page.

export type Platform = 'ios' | 'android' | 'other';

export interface InAppBrowser {
  /** The app's name when it identifies itself in the user agent; null for an unnamed Android web view. */
  readonly app: string | null;
  readonly platform: Platform;
}

/** User-agent tokens apps add to their web views. Order matters: Messenger's UA also has Facebook's tokens. */
const APP_TOKENS: readonly (readonly [RegExp, string])[] = [
  [/Instagram/, 'Instagram'],
  [/FBAN\/Messenger|MessengerForiOS|FB_IAB\/Orca|MessengerLite/, 'Messenger'],
  [/FBAN\/|FBAV\/|FB_IAB\//, 'Facebook'],
  [/LinkedInApp/, 'LinkedIn'],
  [/WhatsApp/, 'WhatsApp'],
  [/Snapchat/, 'Snapchat'],
  [/musical_ly|BytedanceWebview|TikTok/, 'TikTok'],
  [/MicroMessenger/, 'WeChat'],
  [/\bLine\//, 'LINE'],
  [/Pinterest/, 'Pinterest'],
  [/Twitter/, 'X'],
];

/**
 * Detects an in-app browser from its user agent. Only apps that name themselves are matched, plus
 * Android's generic web-view marker (`; wv)`); Chrome Custom Tabs and Safari View Controller are the
 * real browser engines and are deliberately not flagged.
 */
export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  const platform: Platform = /iPhone|iPad|iPod/.test(userAgent) ? 'ios' : /Android/.test(userAgent) ? 'android' : 'other';
  const app = APP_TOKENS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (app) return { app, platform };
  if (platform === 'android' && /; wv\)/.test(userAgent)) return { app: null, platform };
  return null;
}

/**
 * An Android intent link that opens `href` in Chrome (WebXR needs Chrome), or the page itself if Chrome
 * is not installed. The page's own #fragment is dropped: the intent syntax uses the fragment itself.
 */
export function chromeIntentUrl(href: string): string {
  const url = new URL(href);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.href)};end`;
}

const BUTTON = 'display:block;width:100%;min-height:48px;margin:10px 0 0;padding:12px 16px;border-radius:10px;font:600 16px/1.3 system-ui,sans-serif;cursor:pointer';

/**
 * Full-screen step shown before the camera or AR starts. Resolves when the person chooses to continue
 * in the in-app browser anyway (detection can be wrong, and some apps do allow the camera).
 */
export function showOpenInBrowserScreen(detected: InAppBrowser, href: string = location.href): Promise<void> {
  const where = detected.app ?? 'This app';
  const browser = detected.platform === 'android' ? 'Chrome' : detected.platform === 'ios' ? 'Safari' : 'your browser';
  const screen = document.createElement('div');
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-modal', 'true');
  screen.setAttribute('aria-labelledby', 'open-in-browser-title');
  screen.style.cssText =
    'position:fixed;inset:0;z-index:10;overflow:auto;background:#111;color:#f2f2f2;font:16px/1.5 system-ui,sans-serif;' +
    'padding:calc(24px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left));' +
    'display:flex;flex-direction:column;justify-content:center;box-sizing:border-box';

  const box = document.createElement('div');
  box.style.cssText = 'max-width:420px;width:100%;margin:0 auto';
  const title = document.createElement('h1');
  title.id = 'open-in-browser-title';
  title.textContent = `Open in ${browser} to see this in AR`;
  title.style.cssText = 'font-size:22px;line-height:1.3;margin:0 0 12px';
  const reason = document.createElement('p');
  reason.textContent = `${where} opened this link in its own built-in browser, which usually blocks the camera and AR.`;
  reason.style.cssText = 'margin:0 0 16px;color:#cfcfcf';
  box.append(title, reason);

  if (detected.platform === 'android') {
    const open = document.createElement('a');
    open.href = chromeIntentUrl(href);
    open.textContent = 'Open in Chrome';
    open.style.cssText = `${BUTTON};background:#2a6df4;color:#fff;text-align:center;text-decoration:none;box-sizing:border-box`;
    box.append(open);
  } else {
    const steps = document.createElement('p');
    steps.textContent = `In ${where}, tap the ⋯ menu or the share icon and choose “Open in ${browser}” or “Open in browser”. Or copy the link below and paste it into ${browser}.`;
    steps.style.cssText = 'margin:0 0 4px';
    box.append(steps);
  }

  // The link is always visible and selectable, because clipboard access is often blocked in web views.
  const link = document.createElement('input');
  link.type = 'text';
  link.readOnly = true;
  link.value = href;
  link.setAttribute('aria-label', 'Link to this page');
  link.style.cssText = 'display:block;width:100%;box-sizing:border-box;min-height:44px;margin:14px 0 0;padding:10px 12px;border-radius:8px;border:1px solid #444;background:#1d1d1d;color:#f2f2f2;font:14px/1.3 ui-monospace,monospace';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy link';
  copy.style.cssText = `${BUTTON};background:${detected.platform === 'android' ? '#2b2b2b' : '#2a6df4'};color:#fff;border:none`;
  copy.addEventListener('click', async () => {
    link.select();
    try {
      await navigator.clipboard.writeText(href);
      copy.textContent = 'Link copied';
    } catch {
      copy.textContent = 'Link selected: copy it from the box above';
    }
  });

  const stay = document.createElement('button');
  stay.type = 'button';
  stay.textContent = 'Continue here anyway';
  stay.style.cssText = `${BUTTON};background:transparent;color:#cfcfcf;border:1px solid #555`;
  box.append(link, copy, stay);
  screen.append(box);
  document.body.append(screen);
  title.tabIndex = -1;
  title.focus();

  return new Promise((resolve) => {
    stay.addEventListener('click', () => {
      screen.remove();
      resolve();
    });
  });
}

/** Shows the screen when the page is running in an in-app browser; resolves at once otherwise. */
export async function offerOpenInBrowser(userAgent: string = navigator.userAgent): Promise<void> {
  const detected = detectInAppBrowser(userAgent);
  if (detected) await showOpenInBrowserScreen(detected);
}
