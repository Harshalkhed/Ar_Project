import type { ProjectDocument } from '@internal-webar/project-schema';

/**
 * Resolves every asset `uri` to an absolute URL against `base` (the project file's own location).
 * The schema and runtime pass `asset.uri` through unresolved by design (see `AssetReader`'s "the
 * host resolves paths" comment): the renderer's own `readAsset` callback resolves per call against
 * whatever base the host chooses, but `ImageTrackingEngine.loadTargets` just does a bare `fetch(uri)`
 * with no base at all — it resolves against the *page's* location, not the project's, silently
 * breaking (a 404) whenever a project is not served from the same directory as the page that runs it.
 */
export function withAbsoluteAssetUris(document: ProjectDocument, base: URL): ProjectDocument {
  return { ...document, assets: document.assets.map((asset) => ({ ...asset, uri: new URL(asset.uri, base).href })) };
}
