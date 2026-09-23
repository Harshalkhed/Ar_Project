import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TrackingError } from '../packages/tracking/dist/index.js';
import { RuntimeCore } from '../packages/runtime-core/dist/index.js';
import { ImageTrackingProvider } from '../packages/tracking-image/dist/index.js';
import { ScriptedImageEngine, supportedEnvironment } from './support/scripted-image-engine.mjs';

const loadFixture = async () => JSON.parse(await readFile(new URL('./fixtures/image-glb.project.json', import.meta.url), 'utf8'));

class FakeProvider {
  listeners = new Set();
  initializedWith = undefined;
  initializeError = undefined;
  constructor(type = 'image') { this.type = type; }
  async initialize(targets) {
    if (this.initializeError) throw this.initializeError;
    this.initializedWith = targets;
    this.emit({ type: 'initialized' });
  }
  async start() {}
  async stop() {}
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(event) { for (const listener of this.listeners) listener(event); }
}

function setup(provider = new FakeProvider()) {
  const events = [];
  const runtime = new RuntimeCore(provider, (event) => events.push(event));
  return { runtime, provider, events };
}

test('starts in the created state', () => assert.equal(setup().runtime.state, 'created'));

test('invalid projects fail with invalid_project and never reach the provider', async () => {
  const { runtime, provider, events } = setup();
  await assert.rejects(runtime.start({ schemaVersion: '9.0' }));
  assert.equal(runtime.state, 'error');
  assert.equal(events[0].type, 'runtime_error');
  assert.equal(events[0].code, 'invalid_project');
  assert.equal(provider.initializedWith, undefined);
});

test('rejects a provider that does not match the project tracking type', async () => {
  const { runtime, provider, events } = setup(new FakeProvider('face'));
  await assert.rejects(runtime.start(await loadFixture()));
  assert.equal(runtime.state, 'error');
  assert.deepEqual(events, [{ type: 'runtime_error', code: 'unsupported_tracking_type', message: 'No face provider can run image tracking.' }]);
  assert.equal(provider.initializedWith, undefined);
});

test('fails with no_targets when no trigger matches the tracking type', async () => {
  const fixture = await loadFixture();
  const { runtime, events } = setup();
  await assert.rejects(runtime.start({ ...fixture, triggers: [] }));
  assert.equal(events[0].code, 'no_targets');
});

test('resolves image triggers to provider-neutral targets via asset ids', async () => {
  const { runtime, provider } = setup();
  await runtime.start(await loadFixture());
  assert.deepEqual(provider.initializedWith, [{ id: 'trigger-poster', type: 'image', sourceUri: 'assets/poster.jpg' }]);
});

test('emits lifecycle events and becomes ready', async () => {
  const { runtime, events } = setup();
  await runtime.start(await loadFixture());
  assert.equal(runtime.state, 'ready');
  assert.deepEqual(events, [{ type: 'tracking_initialized' }, { type: 'runtime_initialized' }]);
});

test('provider failures keep their structured tracking error code', async () => {
  const provider = new FakeProvider();
  provider.initializeError = new TrackingError('permission_denied', 'Camera permission was denied.');
  const { runtime, events } = setup(provider);
  await assert.rejects(runtime.start(await loadFixture()));
  assert.equal(runtime.state, 'error');
  assert.deepEqual(events.at(-1), { type: 'runtime_error', code: 'permission_denied', message: 'Camera permission was denied.' });
});

test('unexpected provider exceptions become provider_failed', async () => {
  const provider = new FakeProvider();
  provider.initializeError = new Error('boom');
  const { runtime, events } = setup(provider);
  await assert.rejects(runtime.start(await loadFixture()));
  assert.deepEqual(events.at(-1), { type: 'runtime_error', code: 'provider_failed', message: 'boom' });
});

const identityPose = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

test('forwards an optional target pose on found and pose_updated without changing tracking state', async () => {
  const { runtime, provider, events } = setup();
  await runtime.start(await loadFixture());
  provider.emit({ type: 'target_found', targetId: 'trigger-poster', pose: identityPose });
  assert.equal(runtime.state, 'tracking');
  const moved = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.25, 0, 0, 1]);
  provider.emit({ type: 'pose_updated', targetId: 'trigger-poster', pose: moved });
  assert.equal(runtime.state, 'tracking');
  provider.emit({ type: 'pose_updated', targetId: 'trigger-poster', pose: [1, 2, 3] });
  assert.deepEqual(events.slice(2), [
    { type: 'target_found', targetId: 'trigger-poster', pose: identityPose },
    { type: 'pose_updated', targetId: 'trigger-poster', pose: moved },
  ]);
});

test('tracks while any target is found and returns to ready when all are lost', async () => {
  const { runtime, provider, events } = setup();
  await runtime.start(await loadFixture());
  provider.emit({ type: 'target_found', targetId: 'trigger-poster' });
  assert.equal(runtime.state, 'tracking');
  provider.emit({ type: 'target_lost', targetId: 'trigger-poster' });
  assert.equal(runtime.state, 'ready');
  assert.deepEqual(events.slice(2), [{ type: 'target_found', targetId: 'trigger-poster' }, { type: 'target_lost', targetId: 'trigger-poster' }]);
});

test('provider error events move the runtime to the error state', async () => {
  const { runtime, provider, events } = setup();
  await runtime.start(await loadFixture());
  provider.emit({ type: 'error', code: 'provider_failed', message: 'lost camera' });
  assert.equal(runtime.state, 'error');
  assert.deepEqual(events.at(-1), { type: 'runtime_error', code: 'provider_failed', message: 'lost camera' });
});

test('rejects a second start while running', async () => {
  const { runtime } = setup();
  const fixture = await loadFixture();
  await runtime.start(fixture);
  await assert.rejects(runtime.start(fixture), /already/);
});

test('stop unsubscribes from provider events and allows a restart', async () => {
  const { runtime, provider, events } = setup();
  const fixture = await loadFixture();
  await runtime.start(fixture);
  await runtime.stop();
  assert.equal(runtime.state, 'stopped');
  provider.emit({ type: 'target_found', targetId: 'trigger-poster' });
  assert.equal(events.some((event) => event.type === 'target_found'), false);
  await runtime.start(fixture);
  assert.equal(runtime.state, 'ready');
  assert.equal(provider.listeners.size, 1);
});

test('fixture runs end to end through the image provider seam', async () => {
  const engine = new ScriptedImageEngine();
  const { runtime, events } = setup(new ImageTrackingProvider(engine, supportedEnvironment));
  await runtime.start(await loadFixture());
  assert.deepEqual(engine.loadedUris, ['assets/poster.jpg']);
  engine.callbacks.targetFound(0);
  assert.equal(runtime.state, 'tracking');
  assert.deepEqual(events.at(-1), { type: 'target_found', targetId: 'trigger-poster' });
});

test('forwards the camera projection alongside target poses', async () => {
  const { runtime, provider, events } = setup();
  await runtime.start(await loadFixture());
  const projection = Object.freeze([1.5, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, -1, 0, 0, -2, 0]);
  provider.emit({ type: 'target_found', targetId: 'trigger-poster', pose: identityPose, projection });
  provider.emit({ type: 'pose_updated', targetId: 'trigger-poster', pose: identityPose, projection });
  provider.emit({ type: 'pose_updated', targetId: 'trigger-poster', pose: identityPose, projection: [0] });
  assert.deepEqual(events.slice(2), [
    { type: 'target_found', targetId: 'trigger-poster', pose: identityPose, projection },
    { type: 'pose_updated', targetId: 'trigger-poster', pose: identityPose, projection },
    { type: 'pose_updated', targetId: 'trigger-poster', pose: identityPose },
  ]);
});
