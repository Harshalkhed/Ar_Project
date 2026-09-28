// Standalone WebXR capability check: no project, no GLB, just the same test webxr.ts runs before
// doing anything else, so a device's support can be confirmed without loading the full experience.
const result = document.querySelector<HTMLDivElement>('#result');
const detail = document.querySelector<HTMLParagraphElement>('#detail');

function report(state: 'yes' | 'no', message: string, extra = ''): void {
  if (result) {
    result.dataset.state = state;
    result.textContent = state === 'yes' ? '✅ WebXR AR is supported on this device.' : '❌ WebXR AR is not supported on this device.';
  }
  if (detail) detail.textContent = `${message}${extra ? ` (${extra})` : ''}`;
  console.log(message);
}

async function main(): Promise<void> {
  if (!isSecureContext) return report('no', 'Not a secure context (needs HTTPS or localhost).');
  if (!navigator.xr) return report('no', 'navigator.xr is not exposed by this browser.', navigator.userAgent);
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (supported) report('yes', 'navigator.xr.isSessionSupported("immersive-ar") returned true.', navigator.userAgent);
    else report('no', 'navigator.xr.isSessionSupported("immersive-ar") returned false.', navigator.userAgent);
  } catch (error) {
    report('no', `isSessionSupported threw: ${error instanceof Error ? error.message : String(error)}`, navigator.userAgent);
  }
}

main();
