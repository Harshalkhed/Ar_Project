import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackingError } from '../packages/tracking/dist/index.js';
import { ImageTrackingProvider, detectImageTrackingEnvironment } from '../packages/tracking-image/dist/index.js';
import { ScriptedImageEngine, supportedEnvironment, domError } from './support/scripted-image-engine.mjs';

const targets = [
  { id: 'trigger-a', type: 'image', sourceUri: 'assets/a.jpg' },
  { id: 'trigger-b', type: 'image', sourceUri: 'assets/b.jpg' },
];

function setup(environment = supportedEnvironment) {
  const engine = new ScriptedImageEngine();
  const provider = new ImageTrackingProvider(engine, environment);
  const events = [];
  provider.onEvent((event) => events.push(event));
  return { engine, provider, events };
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof TrackingError && error.code === code);
}

test('detects secure context and camera API from the browser scope', () => {
  assert.deepEqual(detectImageTrackingEnvironment({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } } }), { isSecureContext: true, hasCamera: true });
  assert.deepEqual(detectImageTrackingEnvironment({ isSecureContext: false, navigator: {} }), { isSecureContext: false, hasCamera: false });
  assert.deepEqual(detectImageTrackingEnvironment({}), { isSecureContext: false, hasCamera: false });
});

test('initialize loads target images in order and emits initialized', async () => {
  const { engine, provider, events } = setup();
  await provider.initialize(targets);
  assert.deepEqual(engine.loadedUris, ['assets/a.jpg', 'assets/b.jpg']);
  assert.deepEqual(events, [{ type: 'initialized' }]);
});

test('initialize fails as unsupported without a secure context or camera', async () => {
  for (const environment of [{ isSecureContext: false, hasCamera: true }, { isSecureContext: true, hasCamera: false }]) {
    const { engine, provider, events } = setup(environment);
    await rejectsWithCode(provider.initialize(targets), 'unsupported');
    assert.equal(events[0].type, 'error');
    assert.equal(events[0].code, 'unsupported');
    assert.deepEqual(engine.loadedUris, []);
  }
});

test('initialize rejects targets the image provider cannot load', async () => {
  for (const bad of [[], [{ id: 'q', type: 'qr', sourceUri: 'q.png' }], [{ id: 'x', type: 'image' }]]) {
    const { provider } = setup();
    await rejectsWithCode(provider.initialize(bad), 'target_load_failed');
  }
});

test('engine target loading failures surface as target_load_failed', async () => {
  const { engine, provider, events } = setup();
  engine.loadError = new Error('bad image');
  await rejectsWithCode(provider.initialize(targets), 'target_load_failed');
  assert.deepEqual(events, [{ type: 'error', code: 'target_load_failed', message: 'bad image' }]);
});

test('start before initialize is rejected', async () => {
  const { provider } = setup();
  await rejectsWithCode(provider.start(), 'provider_failed');
});

const identityPose = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

test('engine pose is forwarded on target_found and pose_updated', async () => {
  const { engine, provider, events } = setup();
  await provider.initialize(targets);
  await provider.start();
  engine.callbacks.targetFound(0, identityPose);
  const moved = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]);
  engine.callbacks.poseUpdated(0, moved);
  engine.callbacks.poseUpdated(0, moved);
  engine.callbacks.poseUpdated(4, moved);
  assert.deepEqual(events.slice(1), [
    { type: 'target_found', targetId: 'trigger-a', pose: identityPose },
    { type: 'pose_updated', targetId: 'trigger-a', pose: moved },
    { type: 'pose_updated', targetId: 'trigger-a', pose: moved },
  ]);
});

test('engine indices map to target ids with duplicate found/lost suppressed', async () => {
  const { engine, provider, events } = setup();
  await provider.initialize(targets);
  await provider.start();
  engine.callbacks.targetFound(1);
  engine.callbacks.targetFound(1);
  engine.callbacks.targetLost(1);
  engine.callbacks.targetLost(1);
  engine.callbacks.targetFound(7);
  assert.deepEqual(events.slice(1), [{ type: 'target_found', targetId: 'trigger-b' }, { type: 'target_lost', targetId: 'trigger-b' }]);
});

test('camera errors from engine start map to structured codes', async () => {
  const cases = [['NotAllowedError', 'permission_denied'], ['SecurityError', 'permission_denied'], ['NotFoundError', 'camera_unavailable'], ['NotReadableError', 'camera_unavailable'], ['OverconstrainedError', 'camera_unavailable'], ['TypeError', 'provider_failed']];
  for (const [name, code] of cases) {
    const { engine, provider, events } = setup();
    await provider.initialize(targets);
    engine.startError = domError(name);
    await rejectsWithCode(provider.start(), code);
    assert.equal(events.at(-1).code, code, name);
  }
});

test('runtime engine failures are emitted as provider_failed errors', async () => {
  const { engine, provider, events } = setup();
  await provider.initialize(targets);
  await provider.start();
  engine.callbacks.failed(new Error('wasm crashed'));
  assert.deepEqual(events.at(-1), { type: 'error', code: 'provider_failed', message: 'wasm crashed' });
});

test('stop releases the engine but keeps listeners so tracking can restart', async () => {
  const { engine, provider, events } = setup();
  await provider.initialize(targets);
  await provider.start();
  engine.callbacks.targetFound(0);
  await provider.stop();
  assert.equal(engine.stopCount, 1);
  await provider.start();
  engine.callbacks.targetFound(0);
  assert.deepEqual(events.filter((event) => event.type === 'target_found').length, 2);
});
