import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DEMOS, demoById, demoLinks, roomProjectFor } from '../apps/preview/dist/demos.js';
import { placementSurfaceOf, validateProject } from '../packages/project-schema/dist/index.js';

const published = new URL('../apps/preview/public/', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, published), 'utf8'));

test('a scan project links to the room project beside it; other projects do not', () => {
  assert.equal(roomProjectFor('projects/seahorn/scan.json'), 'projects/seahorn/project.json');
  assert.equal(roomProjectFor('projects/seahorn/scan.json?x=1'), 'projects/seahorn/project.json');
  assert.equal(roomProjectFor('projects/office-chair/project.json'), null);
  assert.equal(roomProjectFor('projects/x/myscan.json'), null);
  assert.equal(roomProjectFor(null), null);
});

test('every demo ships a valid scan project, room project and scan image', () => {
  assert.equal(DEMOS.length, 3);
  for (const demo of DEMOS) {
    const links = demoLinks(demo);
    assert.equal(demoById(demo.id), demo);
    const scan = read(`${demo.folder}/scan.json`);
    const room = read(`${demo.folder}/project.json`);
    assert.deepEqual(validateProject(scan), [], `${demo.id} scan.json`);
    assert.deepEqual(validateProject(room), [], `${demo.id} project.json`);
    assert.equal(scan.tracking.type, 'image', `${demo.id} scan.json tracks the brochure image`);
    assert.ok(existsSync(new URL(links.target, published)), `${demo.id} scan image`);
    assert.ok(existsSync(new URL(`${demo.folder}/quicklook.usdz`, published)), `${demo.id} pre-baked Quick Look file`);
    // The same model in both: scanning and room placement show the same piece.
    const model = (project) => new URL(project.assets.find((a) => a.kind === 'model').uri, new URL(`${demo.folder}/`, 'https://x/')).pathname;
    assert.equal(model(scan), model(room), `${demo.id} uses one model`);
  }
  assert.equal(placementSurfaceOf(read('projects/wall-art/project.json')), 'wall');
});
