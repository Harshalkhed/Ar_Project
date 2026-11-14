import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPrebakedUsdzResponse, preferJpegTextures } from '../apps/preview/dist/quick-look.js';

// three is the preview app's dependency; load the same ES module file quick-look.js imports (require()
// would resolve three's CommonJS build instead) so instanceof checks hold.
const threeCjs = createRequire(new URL('../apps/preview/package.json', import.meta.url)).resolve('three');
const { Group, Mesh, MeshStandardMaterial, BoxGeometry, Texture } = await import(pathToFileURL(join(dirname(threeCjs), 'three.module.js')).href);

test('a pre-baked USDZ exists only for a successful, non-HTML response', () => {
  assert.equal(isPrebakedUsdzResponse(true, 'model/vnd.usdz+zip'), true);
  assert.equal(isPrebakedUsdzResponse(true, null), true); // Vite's dev server sends no type for .usdz.
  assert.equal(isPrebakedUsdzResponse(true, 'text/html; charset=utf-8'), false); // Dev server's fallback page for a missing file.
  assert.equal(isPrebakedUsdzResponse(false, 'model/vnd.usdz+zip'), false);
});

test('only textures that carry alpha stay PNG in the USDZ export; the rest are tagged JPEG', () => {
  const opaqueColour = new Texture();
  const normal = new Texture();
  const cutoutColour = new Texture();
  const shared = new Texture(); // Opaque colour on one mesh, cut-out colour on another: must stay PNG.
  const root = new Group();
  root.add(
    new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: opaqueColour, normalMap: normal })),
    new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: cutoutColour, alphaTest: 0.5 })),
    new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: shared })),
    new Mesh(new BoxGeometry(), new MeshStandardMaterial({ map: shared, transparent: true })),
  );
  preferJpegTextures(root);
  assert.equal(opaqueColour.userData.mimeType, 'image/jpeg');
  assert.equal(normal.userData.mimeType, 'image/jpeg');
  assert.equal(cutoutColour.userData.mimeType, 'image/png');
  assert.equal(shared.userData.mimeType, 'image/png');
});
