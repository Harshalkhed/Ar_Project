// Standalone WebXR capability check: no project, no GLB, just the same test webxr.ts runs before
// doing anything else, so a device's support can be confirmed without loading the full experience.
const result = document.querySelector<HTMLDivElement>('#result');
const detail = document.querySelector<HTMLParagraphElement>('#detail');

function report(state: 'yes' | 'no', message: string, extra = ''): void {
  if (result) {
    result.dataset.state = state;
    result.textContent = state === 'yes' ? '✅ AR is supported on this device.' : '❌ AR is not supported on this device.';
  }
  if (detail) detail.textContent = `${message}${extra ? ` (${extra})` : ''}`;
  console.log(message);
}

// Apple's documented feature check for AR Quick Look (iPhone/iPad Safari), inlined so this tiny page
// does not bundle the USDZ exporter that quick-look.ts pulls in.
const hasQuickLook = (): boolean => document.createElement('a').relList?.supports?.('ar') === true;

async function main(): Promise<void> {
  if (!isSecureContext) return report('no', 'Not a secure context (needs HTTPS or localhost).');
  if (!navigator.xr) {
    if (hasQuickLook()) return report('yes', 'No WebXR here, but AR Quick Look is available, which webxr.html uses automatically on iPhone/iPad.', navigator.userAgent);
    return report('no', 'navigator.xr is not exposed by this browser.', navigator.userAgent);
  }
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (supported) report('yes', 'navigator.xr.isSessionSupported("immersive-ar") returned true.', navigator.userAgent);
    else report('no', 'navigator.xr.isSessionSupported("immersive-ar") returned false.', navigator.userAgent);
  } catch (error) {
    report('no', `isSessionSupported threw: ${error instanceof Error ? error.message : String(error)}`, navigator.userAgent);
  }
}

main();
