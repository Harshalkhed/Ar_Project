import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { forQuickLook, isPrebakedUsdzResponse, preferJpegTextures, quickLookHref, usdzAnchoring } from '../apps/preview/dist/quick-look.js';

// three is the preview app's dependency; load the same ES module file quick-look.js imports (require()
// would resolve three's CommonJS build instead) so instanceof checks hold.
const threeCjs = createRequire(new URL('../apps/preview/package.json', import.meta.url)).resolve('three');
const { Group, Mesh, MeshStandardMaterial, BoxGeometry, Scene, Texture, Vector3 } = await import(pathToFileURL(join(dirname(threeCjs), 'three.module.js')).href);

test('Quick Look links turn off pinch-to-resize so the object stays at real size', () => {
  assert.equal(quickLookHref('https://ar.example.com/projects/office-chair/quicklook.usdz'), 'https://ar.example.com/projects/office-chair/quicklook.usdz#allowsContentScaling=0');
  assert.equal(quickLookHref('blob:https://ar.example.com/1234'), 'blob:https://ar.example.com/1234#allowsContentScaling=0');
  assert.equal(quickLookHref('https://ar.example.com/a.usdz#old'), 'https://ar.example.com/a.usdz#allowsContentScaling=0');
});

test('Quick Look anchors floor content to horizontal planes and wall content to vertical ones', () => {
  assert.deepEqual(usdzAnchoring('floor'), { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } });
  assert.deepEqual(usdzAnchoring('wall'), { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'vertical' } });
});

test('wall content is exported turned onto Quick Look\'s wall frame: front +Z → +Y (out of wall), up +Y → -Z', () => {
  const scene = new Scene();
  const picture = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  scene.add(picture);
  assert.equal(forQuickLook(scene, 'floor'), scene);
  const exported = forQuickLook(scene, 'wall');
  assert.notEqual(exported, scene);
  assert.equal(scene.children[0], picture, 'the live scene keeps its own object');
  const mount = exported.children[0];
  const front = new Vector3(0, 0, 1).applyQuaternion(mount.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(mount.quaternion);
  for (const [actual, expected, label] of [[front, [0, 1, 0], 'front'], [up, [0, 0, -1], 'up']]) {
    actual.toArray().forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${label}: ${actual.toArray()}`));
  }
  assert.equal(mount.children.length, 1);
  assert.equal(mount.children[0].geometry, picture.geometry, 'geometry is shared, not copied');
});

test('wall-from-floor keeps the piece upright on a floor anchor, lifted to hanging height', () => {
  const scene = new Scene();
  const picture = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  scene.add(picture);
  const exported = forQuickLook(scene, 'wall-from-floor');
  const mount = exported.children[0];
  assert.deepEqual(mount.position.toArray(), [0, 1.45, 0]);
  assert.deepEqual(mount.quaternion.toArray(), [0, 0, 0, 1], 'no rotation: front stays +Z, up stays +Y');
  assert.equal(scene.children[0], picture, 'the live scene keeps its own object');
  assert.deepEqual(usdzAnchoring('wall-from-floor').planeAnchoring, { alignment: 'horizontal' });
});

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
