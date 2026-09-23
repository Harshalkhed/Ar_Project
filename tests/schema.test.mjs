import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject } from '../dist/packages/project-schema/src/validation.js';

const base = { schemaVersion: '1.0', id: 'demo', name: 'Demo', tracking: { type: 'image' }, triggers: [{ id: 'trigger-1', type: 'image', label: 'Poster', sceneIds: ['scene-1'], config: {} }], scenes: [{ id: 'scene-1', name: 'Main', objectIds: [], interactions: [] }], objects: [], assets: [], deployment: { experienceId: 'demo', version: 1, status: 'draft', runtimeVersion: '0.1.0' } };

test('accepts a valid multi-trigger-capable project', () => assert.deepEqual(validateProject(base), []));
test('reports references to unknown scenes', () => assert.match(validateProject({ ...base, triggers: [{ ...base.triggers[0], sceneIds: ['missing'] }] })[0].message, /Unknown scene/));
test('reports unsupported schema versions', () => assert.match(validateProject({ ...base, schemaVersion: '9.0' })[0].message, /Unsupported/));

