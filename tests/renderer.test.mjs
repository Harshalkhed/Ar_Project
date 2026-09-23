import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { RendererError, ThreeRenderer } from '../packages/renderer/dist/index.js';

const loadFixture = async () => JSON.parse(await readFile(new URL('./fixtures/image-glb.project.json', import.meta.url), 'utf8'));
const placeholderGlb = async () => new Uint8Array(await readFile(new URL('./fixtures/assets/placeholder.glb', import.meta.url)));

test('loads the fixture scene from the placeholder GLB, applies transform and visibility, then disposes', async () => {
  const project = await loadFixture();
  const readUris = [];
  const renderer = new ThreeRenderer();
  await renderer.loadScene(project, 'scene-main', async (uri) => {
    readUris.push(uri);
    return placeholderGlb();
  });
  assert.deepEqual(readUris, ['assets/placeholder.glb']);
  const initial = renderer.getObjectState('object-model');
  assert.equal(initial.modelLoaded, true);
  assert.equal(initial.visible, false);
  assert.deepEqual(initial.transform, project.objects[0].transform);

  const transform = {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0.1, y: 0.2, z: 0.3 },
    scale: { x: 2, y: 3, z: 4 },
  };
  renderer.applyTransform('object-model', transform);
  renderer.setVisible('object-model', true);
  const next = renderer.getObjectState('object-model');
  assert.equal(next.visible, true);
  assert.equal(next.modelLoaded, true);
  assert.deepEqual(next.transform, transform);

  renderer.dispose();
  assert.equal(renderer.getObjectState('object-model'), undefined);
  assert.throws(() => renderer.setVisible('object-model', false), (error) => error instanceof RendererError && error.code === 'disposed');
});

test('loader rejects non-GLB bytes with asset_load_failed', async () => {
  const renderer = new ThreeRenderer();
  await assert.rejects(
    renderer.loadScene(await loadFixture(), 'scene-main', async () => new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])),
    (error) => error instanceof RendererError && error.code === 'asset_load_failed' && /magic/i.test(error.message),
  );
  assert.equal(renderer.getObjectState('object-model'), undefined);
});

test('rejects an invalid project or unknown scene before reading asset bytes', async () => {
  const renderer = new ThreeRenderer();
  let reads = 0;
  const readAsset = async () => { reads += 1; return new Uint8Array(); };
  await assert.rejects(renderer.loadScene({ schemaVersion: '9.0' }, 'scene-main', readAsset), (error) => error instanceof RendererError && error.code === 'invalid_project');
  await assert.rejects(renderer.loadScene(await loadFixture(), 'missing-scene', readAsset), (error) => error instanceof RendererError && error.code === 'unknown_scene');
  assert.equal(reads, 0);
});

test('renderer and tracking stay separate packages', async () => {
  const sources = [
    ...(await sourceFiles('packages/renderer')),
    ...(await sourceFiles('packages/tracking')),
    ...(await sourceFiles('packages/tracking-image')),
  ];
  const rendererSources = sources.filter((file) => file.path.startsWith('packages/renderer'));
  const trackingSources = sources.filter((file) => file.path.startsWith('packages/tracking'));
  assert.equal(rendererSources.some((file) => /tracking-image|@internal-webar\/tracking/.test(file.text)), false);
  assert.equal(trackingSources.some((file) => /@internal-webar\/renderer|packages\/renderer/.test(file.text)), false);
});

async function sourceFiles(directory) {
  const entries = await readdir(directory, { recursive: true });
  const files = [];
  for (const entry of entries) {
    const path = `${directory}/${entry}`.replaceAll('\\', '/');
    if (path.includes('/node_modules/') || path.includes('/dist/')) continue;
    if (!path.endsWith('.ts') && !path.endsWith('.json')) continue;
    files.push({ path, text: await readFile(path, 'utf8') });
  }
  return files;
}

test('exposes the loaded scene graph so a host can draw it', async () => {
  const renderer = new ThreeRenderer();
  await renderer.loadScene(await loadFixture(), 'scene-main', placeholderGlb);
  const node = renderer.scene.getObjectByName('object-model');
  assert.ok(node, 'object node is part of the exposed scene');
  assert.equal(node.children.length, 1);
});

test('anchors the scene root to a target pose and hides it when the anchor is cleared', async () => {
  const renderer = new ThreeRenderer();
  await renderer.loadScene(await loadFixture(), 'scene-main', placeholderGlb);
  const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
  renderer.setAnchor(pose);
  assert.equal(renderer.scene.visible, true);
  assert.equal(renderer.scene.matrixAutoUpdate, false);
  assert.deepEqual(Array.from(renderer.scene.matrix.elements), pose);
  renderer.setAnchor(null);
  assert.equal(renderer.scene.visible, false);
  assert.throws(() => renderer.setAnchor([1, 2, 3]), (error) => error instanceof RendererError && error.code === 'invalid_anchor');
});
