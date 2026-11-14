import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetectionHandler } from '../packages/tracking-image/dist/index.js';
import { multiply3, rotation, sceneWithTarget, texturedImage } from './support/synthetic-images.mjs';

const intrinsics = { fx: 300, fy: 300, cx: 160, cy: 120, width: 320, height: 240 };
const FRONTAL = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const poster = texturedImage(240, 180, 7);

/** The worker receives RGBA camera pixels, so expand a synthetic grayscale frame to RGBA. */
function rgbaFrame() {
  const { frame } = sceneWithTarget({ target: poster, intrinsics, frameWidth: 320, frameHeight: 240, rotationCv: multiply3(rotation(0.05, 0.03, 0), FRONTAL), translationCv: [0, 0, 1.6] });
  const rgba = new Uint8ClampedArray(frame.width * frame.height * 4);
  frame.data.forEach((value, i) => rgba.set([value, value, value, 255], i * 4));
  return rgba;
}

const loadPoster = async (uri) => {
  if (uri !== 'poster.png') throw new Error(`unexpected ${uri}`);
  return poster;
};

test('loads targets, then detects a frame and tags the reply with its session', async () => {
  const handle = createDetectionHandler(loadPoster);
  assert.deepEqual(await handle({ type: 'load', uris: ['poster.png'] }), { type: 'loaded' });
  const reply = await handle({ type: 'frame', session: 7, rgba: rgbaFrame(), intrinsics });
  assert.equal(reply.type, 'events');
  assert.equal(reply.session, 7);
  assert.deepEqual(reply.events.map((event) => [event.type, event.index]), [['found', 0]]);
  assert.equal(reply.events[0].pose.length, 16);
});

test('reset makes the next detection a fresh "found" instead of a pose update', async () => {
  const handle = createDetectionHandler(loadPoster);
  await handle({ type: 'load', uris: ['poster.png'] });
  await handle({ type: 'frame', session: 1, rgba: rgbaFrame(), intrinsics });
  assert.equal((await handle({ type: 'frame', session: 1, rgba: rgbaFrame(), intrinsics })).events[0].type, 'pose');
  assert.equal(await handle({ type: 'reset' }), undefined);
  assert.equal((await handle({ type: 'frame', session: 2, rgba: rgbaFrame(), intrinsics })).events[0].type, 'found');
});

test('reports errors as replies instead of throwing out of the worker', async () => {
  const handle = createDetectionHandler(loadPoster);
  assert.equal((await handle({ type: 'frame', session: 1, rgba: rgbaFrame(), intrinsics })).type, 'error');
  assert.deepEqual(await handle({ type: 'load', uris: ['missing.png'] }), { type: 'error', message: 'unexpected missing.png' });
});
