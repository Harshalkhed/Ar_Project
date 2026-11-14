// AR Quick Look detection, kept apart from quick-look.ts so check.html can use it without bundling
// the USDZ exporter.

/**
 * Every iOS browser is WebKit, and Quick Look opens from Chrome, Edge and Firefox there too, but their
 * web views answer Apple's `relList.supports('ar')` check with false. So on iOS (an iPhone/iPad/iPod UA,
 * or the desktop-style UA iPadOS can send), those browsers' own tokens count as support as well.
 * In-app browsers (Instagram etc.) are not listed: the Open-in-browser screen handles them first.
 */
export function isQuickLookBrowser(userAgent: string, relListSupportsAr: boolean): boolean {
  if (relListSupportsAr) return true;
  const isIos = /iPhone|iPad|iPod|Macintosh/.test(userAgent) && !/Android/.test(userAgent);
  return isIos && /\b(CriOS|EdgiOS|FxiOS)\//.test(userAgent);
}

/** Whether this browser can open AR Quick Look (iPhone/iPad). */
export const supportsQuickLook = (): boolean => isQuickLookBrowser(navigator.userAgent, document.createElement('a').relList?.supports?.('ar') === true);
