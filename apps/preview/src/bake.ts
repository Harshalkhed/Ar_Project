// Build-time only: scripts/build-assets.mjs loads this in headless Chromium to pre-bake each project's
// AR Quick Look USDZ. It is not one of the site's pages and is not in the production build.
import { placementSurfaceOf, validateProject, type ProjectDocument } from '@internal-webar/project-schema';
import { ThreeRenderer } from '@internal-webar/renderer';
import { buildUsdzBytes } from './quick-look.js';
import { createObjectControl } from './scale-control.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The USDZ webxr.html would export on an iPhone for this project before the person changes anything:
 * first scene, every object visible, real size, upright, at the origin.
 */
export async function bakeUsdz(projectPath: string): Promise<Uint8Array> {
  const url = new URL(projectPath, location.href);
  const project: unknown = JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
  const issues = validateProject(project);
  if (issues.length) throw new Error(`Invalid project ${projectPath}: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  // Asset URIs stay relative: readAsset below resolves them against the project file. (Absolute
  // http://localhost URIs would fail the schema's relative-or-https rule.)
  const document = project as ProjectDocument;
  const sceneId = document.scenes[0]?.id;
  if (!sceneId) throw new Error(`Project ${projectPath} has no scene.`);
  const objectIds = document.scenes[0].objectIds;

  const renderer = new ThreeRenderer(); // Masters only (PNG/JPEG textures), so no KTX2 loader.
  await renderer.loadScene(document, sceneId, (uri) => fetchBytes(new URL(uri, url)));
  for (const objectId of objectIds) renderer.setVisible(objectId, true);
  // Real size: the project's own transform (metres), not auto-fitted. Quick Look's pinch-to-resize is
  // turned off by the link (quickLookHref), so this is the size people see.
  const control = createObjectControl(renderer, objectIds);
  control.resetOrientation();
  renderer.setAnchor(IDENTITY);
  return buildUsdzBytes(renderer.scene, placementSurfaceOf(document));
}
