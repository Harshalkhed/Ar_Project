import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { validateProject } from '../packages/project-schema/dist/index.js';

const base = { schemaVersion: '1.0', id: 'demo', name: 'Demo', tracking: { type: 'image' }, triggers: [{ id: 'trigger-1', type: 'image', label: 'Poster', sceneIds: ['scene-1'], config: { imageAssetId: 'asset-image' } }], scenes: [{ id: 'scene-1', name: 'Main', objectIds: [], interactions: [] }], objects: [], assets: [{ id: 'asset-image', kind: 'image', uri: 'assets/poster.jpg' }], deployment: { experienceId: 'demo', version: 1, status: 'draft', runtimeVersion: '0.1.0' } };
const messages = (input) => validateProject(input).map((issue) => `${issue.path}: ${issue.message}`);
const withAsset = (asset) => ({ ...base, assets: [...base.assets, asset] });

test('accepts a valid multi-trigger-capable project', () => assert.deepEqual(validateProject(base), []));
test('reports references to unknown scenes', () => assert.match(validateProject({ ...base, triggers: [{ ...base.triggers[0], sceneIds: ['missing'] }] })[0].message, /Unknown scene/));
test('reports unsupported schema versions', () => assert.match(validateProject({ ...base, schemaVersion: '9.0' })[0].message, /Unsupported/));

test('reports non-object input instead of throwing', () => {
  for (const input of [null, undefined, 'project', 42, []]) assert.deepEqual(messages(input), [': Project document must be an object.']);
});

test('reports missing collections instead of throwing', () => {
  const { assets, scenes, ...partial } = base;
  assert.deepEqual(messages(partial), ['scenes: Must be an array.', 'assets: Must be an array.']);
});

test('reports duplicate ids within a collection', () => {
  const issues = messages({ ...base, scenes: [base.scenes[0], base.scenes[0]] });
  assert.deepEqual(issues, ['scenes.scene-1: Duplicate scene id.']);
});

test('reports scene object references that do not exist', () => {
  assert.deepEqual(messages({ ...base, scenes: [{ ...base.scenes[0], objectIds: ['ghost'] }] }), ['scenes.scene-1.objectIds: Unknown object id: ghost.']);
});

test('reports interaction targets that do not exist', () => {
  const interactions = [{ id: 'i-1', event: 'object_click', action: 'show_object', targetId: 'ghost' }, { id: 'i-2', event: 'button_click', action: 'change_scene', sceneId: 'nowhere' }];
  assert.deepEqual(messages({ ...base, scenes: [{ ...base.scenes[0], interactions }] }), [
    'scenes.scene-1.interactions.i-1.targetId: Unknown object id: ghost.',
    'scenes.scene-1.interactions.i-2.sceneId: Unknown scene id: nowhere.',
  ]);
});

test('requires image triggers to reference an image asset', () => {
  const expected = ['triggers.trigger-1.config.imageAssetId: Image triggers must reference an image asset.'];
  const withConfig = (project, config) => ({ ...project, triggers: [{ ...base.triggers[0], config }] });
  assert.deepEqual(messages(withConfig(base, {})), expected);
  assert.deepEqual(messages(withConfig(withAsset({ id: 'asset-model', kind: 'model', uri: 'm.glb' }), { imageAssetId: 'asset-model' })), expected);
});

test('requires model assets to be GLB files', () => {
  assert.deepEqual(validateProject(withAsset({ id: 'asset-model', kind: 'model', uri: 'models/Chair.GLB?v=2' })), []);
  assert.deepEqual(messages(withAsset({ id: 'asset-model', kind: 'model', uri: 'models/chair.fbx' })), ['assets.asset-model.uri: Model assets must be .glb files.']);
});

test('rejects asset URIs that are not relative paths or https URLs', () => {
  for (const uri of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://cdn.example.com/a.jpg', '//cdn.example.com/a.jpg', '']) {
    assert.deepEqual(messages(withAsset({ id: 'asset-x', kind: 'image', uri })), ['assets.asset-x.uri: Asset URI must be a relative path or an https URL.'], uri);
  }
  assert.deepEqual(validateProject(withAsset({ id: 'asset-x', kind: 'image', uri: 'https://cdn.example.com/a.jpg' })), []);
});

test('image + GLB fixture is a valid project', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/image-glb.project.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateProject(fixture), []);
  const object = fixture.objects.find((candidate) => candidate.id === 'object-model');
  assert.equal(fixture.assets.find((asset) => asset.id === object.assetId).uri, 'assets/placeholder.glb');
});

test('published preview projects are valid and ship their model files', async () => {
  const projectsDir = new URL('../apps/preview/public/projects/', import.meta.url);
  const names = (await readdir(projectsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.ok(names.includes('office-chair'));
  for (const name of names) {
    const projectUrl = new URL(`${name}/project.json`, projectsDir);
    const project = JSON.parse(await readFile(projectUrl, 'utf8'));
    assert.deepEqual(validateProject(project), [], name);
    for (const asset of project.assets.filter((entry) => entry.kind === 'model')) {
      await access(new URL(asset.uri, projectUrl)).catch(() => assert.fail(`${name}: missing model file ${asset.uri}`));
    }
  }
});
