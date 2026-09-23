import test from 'node:test';
import assert from 'node:assert/strict';
import { withAbsoluteAssetUris } from '../apps/preview/dist/resolve-assets.js';

const base = { id: 'p', name: 'P', assets: [{ id: 'a', kind: 'image', uri: 'assets/target.png' }, { id: 'b', kind: 'model', uri: 'assets/chair.glb' }] };

test('resolves relative asset uris against the project file location, not the page location', () => {
  // Regression: the project file and the page that runs it can live in different directories
  // (e.g. /projects/office-chair/project.json vs /ar.html); a bare fetch(uri) resolves against the
  // *page*, so packages/tracking-image's loadTargets(imageUris) 404'd until callers resolved first.
  const projectUrl = new URL('https://example.com/projects/office-chair/project.json');
  const resolved = withAbsoluteAssetUris(base, projectUrl);
  assert.deepEqual(resolved.assets.map((asset) => asset.uri), [
    'https://example.com/projects/office-chair/assets/target.png',
    'https://example.com/projects/office-chair/assets/chair.glb',
  ]);
});

test('leaves an already-absolute asset uri unchanged', () => {
  const withAbsolute = { ...base, assets: [{ id: 'a', kind: 'image', uri: 'https://cdn.example.com/target.png' }] };
  const resolved = withAbsoluteAssetUris(withAbsolute, new URL('https://example.com/projects/x/project.json'));
  assert.equal(resolved.assets[0].uri, 'https://cdn.example.com/target.png');
});

test('does not mutate the original document', () => {
  const projectUrl = new URL('https://example.com/projects/office-chair/project.json');
  withAbsoluteAssetUris(base, projectUrl);
  assert.equal(base.assets[0].uri, 'assets/target.png');
});
