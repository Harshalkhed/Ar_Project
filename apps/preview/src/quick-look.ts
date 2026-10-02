import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import type { Object3D } from 'three';

/**
 * iOS/iPadOS Safari has no WebXR, so room placement there goes through AR Quick Look, Apple's own
 * native AR viewer (surface detection, placement, pinch-scale and rotate are all built in). This is
 * Apple's documented feature check for it.
 */
export const supportsQuickLook = (): boolean => document.createElement('a').relList?.supports?.('ar') === true;

/** Exports `root` (as currently scaled/oriented) to a USDZ blob URL. Textures are capped at 1024px so big GLBs stay phone-sized. */
export async function buildUsdzUrl(root: Object3D): Promise<string> {
  root.updateMatrixWorld(true);
  const bytes = await new USDZExporter().parseAsync(root, { quickLookCompatible: true, maxTextureSize: 1024 });
  return URL.createObjectURL(new Blob([bytes], { type: 'model/vnd.usdz+zip' }));
}

const BUTTON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="56"><rect width="260" height="56" rx="10" fill="#2a6df4"/><text x="130" y="35" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="18" font-weight="600" fill="#fff" text-anchor="middle">View in your room (AR)</text></svg>`;

/**
 * Quick Look only opens from a real `<a rel="ar">` that contains a single `<img>`, tapped by the
 * person -- Safari will not honour a programmatic click after the seconds-long async export, so the
 * export and the launch are two separate taps. The visible button is the image itself.
 */
export function createQuickLookLink(usdzUrl: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.rel = 'ar';
  link.href = usdzUrl;
  const image = document.createElement('img');
  image.src = `data:image/svg+xml;utf8,${encodeURIComponent(BUTTON_SVG)}`;
  image.alt = 'View in your room (AR)';
  link.appendChild(image);
  return link;
}
