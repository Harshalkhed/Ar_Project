import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { Mesh, Texture, type Material, type Object3D } from 'three';

/**
 * iOS/iPadOS Safari has no WebXR, so room placement there goes through AR Quick Look, Apple's own
 * native AR viewer (surface detection, placement, pinch-scale and rotate are all built in). This is
 * Apple's documented feature check for it.
 */
export const supportsQuickLook = (): boolean => document.createElement('a').relList?.supports?.('ar') === true;

/**
 * Exports `root` (as currently scaled/oriented) to USDZ bytes. Textures are capped at 1024px so big
 * GLBs stay phone-sized. The same function bakes the pre-built files (scripts/build-assets.mjs), so
 * pre-baked and on-device exports cannot drift apart.
 */
export async function buildUsdzBytes(root: Object3D): Promise<Uint8Array<ArrayBuffer>> {
  root.updateMatrixWorld(true);
  preferJpegTextures(root);
  return new USDZExporter().parseAsync(root, { quickLookCompatible: true, maxTextureSize: 1024 });
}

/**
 * USDZExporter writes a texture as JPEG when it is tagged `image/jpeg`, otherwise as PNG. PNG is only
 * needed where transparency is used (a transparent or alpha-tested material's colour map, or an alpha
 * map); every other texture is tagged JPEG, which makes the file several times smaller.
 */
export function preferJpegTextures(root: Object3D): void {
  const textures = new Map<Texture, boolean>(); // texture → carries alpha somewhere
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of [object.material as Material | Material[]].flat()) {
      for (const [slot, value] of Object.entries(material)) {
        if (!(value instanceof Texture)) continue;
        const carriesAlpha = slot === 'alphaMap' || (slot === 'map' && (material.transparent || material.alphaTest > 0));
        textures.set(value, (textures.get(value) ?? false) || carriesAlpha);
      }
    }
  });
  for (const [texture, carriesAlpha] of textures) texture.userData.mimeType = carriesAlpha ? 'image/png' : 'image/jpeg';
}

/** On-device export to a blob URL: the fallback when a project has no pre-baked USDZ. */
export async function buildUsdzUrl(root: Object3D): Promise<string> {
  return URL.createObjectURL(new Blob([await buildUsdzBytes(root)], { type: 'model/vnd.usdz+zip' }));
}

/** Pre-baked file name, next to the project's project.json. */
export const PREBAKED_USDZ = 'quicklook.usdz';

/**
 * A dev server answers a missing file with its HTML page and a 200, so "exists" means a successful
 * response that is not HTML (Vercel serves .usdz as model/vnd.usdz+zip).
 */
export function isPrebakedUsdzResponse(ok: boolean, contentType: string | null): boolean {
  return ok && !(contentType ?? '').includes('text/html');
}

/** URL of the project's pre-baked USDZ, or null if there is none (or the check itself fails). */
export async function findPrebakedUsdz(projectUrl: URL): Promise<string | null> {
  const url = new URL(PREBAKED_USDZ, projectUrl);
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return isPrebakedUsdzResponse(response.ok, response.headers.get('content-type')) ? url.href : null;
  } catch {
    return null;
  }
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
