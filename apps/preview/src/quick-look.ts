import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import type { PlacementSurface } from '@internal-webar/project-schema';
import { Group, Mesh, Scene, Texture, type Material, type Object3D } from 'three';

/**
 * iOS/iPadOS Safari has no WebXR, so room placement there goes through AR Quick Look, Apple's own
 * native AR viewer (surface detection, placement, pinch-scale and rotate are all built in). This is
 * Apple's documented feature check for it.
 */
export { supportsQuickLook } from './quick-look-support.js';

/**
 * How a USDZ is anchored in Quick Look: on the floor, on a wall, or a wall piece mounted from the floor.
 * The last is the fallback for walls the phone cannot detect (plain, light-coloured or dimly lit walls give
 * camera-based detection almost nothing to track, while floors usually have texture): the piece is
 * anchored to the floor, lifted to hanging height, and the person drags it back against the wall.
 */
export type QuickLookMount = PlacementSurface | 'wall-from-floor';

/** Centre height for floor-mounted wall pieces: 1.45 m (57 in), the usual gallery hanging height. */
export const WALL_HANGING_CENTRE_M = 1.45;

/**
 * Exports `root` (as currently scaled/oriented) to USDZ bytes. Textures are capped at 1024px so big
 * GLBs stay phone-sized. The same function bakes the pre-built files (scripts/build-assets.mjs), so
 * pre-baked and on-device exports cannot drift apart.
 */
export async function buildUsdzBytes(root: Scene, mount: QuickLookMount = 'floor'): Promise<Uint8Array<ArrayBuffer>> {
  root.updateMatrixWorld(true);
  preferJpegTextures(root);
  return new USDZExporter().parseAsync(forQuickLook(root, mount), { quickLookCompatible: true, maxTextureSize: 1024, ar: usdzAnchoring(mount) });
}

/**
 * The scene to export for a mount. Wall: Quick Look's wall anchor is a horizontal plane turned onto the
 * wall (Apple's ARKit docs): +Y points out of the wall and -Z up it, confirmed on an iPhone 2026-11-14
 * (a +Z-facing picture stuck out like a shelf, face down). Our wall convention is +Z out, +Y up, so wall
 * content goes inside a group turned -90° about X (+Z → +Y, +Y → -Z). Wall from floor: content stays
 * upright on a floor anchor, lifted so its centre (the origin, by the wall convention) hangs at
 * {@link WALL_HANGING_CENTRE_M}. The exporter writes only the scene's children, so both work on a cheap
 * clone (geometry and materials shared) and leave the live preview alone.
 */
export function forQuickLook(root: Scene, mount: QuickLookMount): Scene {
  if (mount === 'floor') return root;
  const holder = new Group();
  if (mount === 'wall') {
    holder.name = 'WallMount';
    holder.rotation.x = -Math.PI / 2;
  } else {
    holder.name = 'FloorWallMount';
    holder.position.y = WALL_HANGING_CENTRE_M;
  }
  holder.add(...root.clone().children);
  const scene = new Scene();
  scene.add(holder);
  scene.updateMatrixWorld(true);
  return scene;
}

/** Quick Look anchors wall content to vertical planes and everything else to horizontal ones. */
export function usdzAnchoring(mount: QuickLookMount): { anchoring: { type: 'plane' }; planeAnchoring: { alignment: 'horizontal' | 'vertical' } } {
  return { anchoring: { type: 'plane' }, planeAnchoring: { alignment: mount === 'wall' ? 'vertical' : 'horizontal' } };
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
export async function buildUsdzUrl(root: Scene, mount: QuickLookMount = 'floor'): Promise<string> {
  return URL.createObjectURL(new Blob([await buildUsdzBytes(root, mount)], { type: 'model/vnd.usdz+zip' }));
}

/** Pre-baked file names, next to the project's project.json. */
export const PREBAKED_USDZ = 'quicklook.usdz';
export const PREBAKED_WALL_FROM_FLOOR_USDZ = 'quicklook-floor.usdz';
export const prebakedUsdzName = (mount: QuickLookMount): string => (mount === 'wall-from-floor' ? PREBAKED_WALL_FROM_FLOOR_USDZ : PREBAKED_USDZ);

/**
 * A dev server answers a missing file with its HTML page and a 200, so "exists" means a successful
 * response that is not HTML (Vercel serves .usdz as model/vnd.usdz+zip).
 */
export function isPrebakedUsdzResponse(ok: boolean, contentType: string | null): boolean {
  return ok && !(contentType ?? '').includes('text/html');
}

/** URL of the project's pre-baked USDZ for a mount, or null if there is none (or the check itself fails). */
export async function findPrebakedUsdz(projectUrl: URL, mount: QuickLookMount = 'floor'): Promise<string | null> {
  const url = new URL(prebakedUsdzName(mount), projectUrl);
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return isPrebakedUsdzResponse(response.ok, response.headers.get('content-type')) ? url.href : null;
  } catch {
    return null;
  }
}

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');

/** The button is an SVG image (Quick Look needs an <img> inside the link): filled for the main action, outlined for a secondary one. */
function buttonSvg(label: string, secondary: boolean): string {
  const width = 300;
  const fill = secondary ? 'fill="#14161b" stroke="#8a8f99" stroke-width="1.5"' : 'fill="#2a6df4"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="52"><rect x="1" y="1" width="${width - 2}" height="50" rx="10" ${fill}/><text x="${width / 2}" y="32" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="${secondary ? 15 : 18}" font-weight="600" fill="#fff" text-anchor="middle">${escapeXml(label)}</text></svg>`;
}

/**
 * Apple's documented Quick Look URL option `allowsContentScaling=0` turns off pinch-to-resize, so the
 * object stays at real size; moving and turning it still work. Any existing #fragment is replaced.
 */
export function quickLookHref(usdzUrl: string): string {
  return `${usdzUrl.split('#')[0]}#allowsContentScaling=0`;
}

/**
 * Quick Look only opens from a real `<a rel="ar">` that contains a single `<img>`, tapped by the
 * person -- Safari will not honour a programmatic click after the seconds-long async export, so the
 * export and the launch are two separate taps. The visible button is the image itself.
 */
export function createQuickLookLink(usdzUrl: string, label = 'View in your room (AR)', secondary = false): HTMLAnchorElement {
  const link = document.createElement('a');
  link.rel = 'ar';
  link.href = quickLookHref(usdzUrl);
  const image = document.createElement('img');
  image.src = `data:image/svg+xml;utf8,${encodeURIComponent(buttonSvg(label, secondary))}`;
  image.alt = label;
  link.appendChild(image);
  return link;
}
