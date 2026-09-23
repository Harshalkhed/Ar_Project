import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveImageTracker, compileImageTarget } from '../packages/tracking-image-engine/dist/index.js';
import { multiply3, rotation, sceneWithTarget, texturedImage } from './support/synthetic-images.mjs';

const intrinsics = { fx: 300, fy: 300, cx: 160, cy: 120, width: 320, height: 240 };
const FRONTAL = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const posterA = texturedImage(240, 180, 7);
const posterB = texturedImage(240, 180, 42);
const frontalPose = { R: multiply3(rotation(0.05, 0.03, 0), FRONTAL), t: [0, 0, 1.6] };

function frameFor(target, pose = frontalPose) {
  return sceneWithTarget({ target, intrinsics: intrinsics, frameWidth: intrinsics.width, frameHeight: intrinsics.height, rotationCv: pose.R, translationCv: pose.t }).frame;
}

const blankFrame = { width: intrinsics.width, height: intrinsics.height, data: new Uint8Array(intrinsics.width * intrinsics.height).fill(90) };

test('reports found on first detection, then pose updates while the same target stays visible', () => {
  const tracker = new LiveImageTracker([compileImageTarget(posterA)]);
  const frame = frameFor(posterA);
  const first = tracker.processFrame(frame, intrinsics);
  assert.equal(first.length, 1);
  assert.equal(first[0].type, 'found');
  assert.equal(first[0].index, 0);
  assert.equal(first[0].pose.length, 16);
  assert.equal(first[0].projection.length, 16);
  const second = tracker.processFrame(frame, intrinsics);
  assert.deepEqual(second.map((e) => e.type), ['pose']);
});

test('absorbs a single missed frame without reporting lost', () => {
  const tracker = new LiveImageTracker([compileImageTarget(posterA)], { lostAfterMisses: 3 });
  tracker.processFrame(frameFor(posterA), intrinsics);
  const missed = tracker.processFrame(blankFrame, intrinsics);
  assert.deepEqual(missed, []);
  const recovered = tracker.processFrame(frameFor(posterA), intrinsics);
  assert.deepEqual(recovered.map((e) => e.type), ['pose']);
});

test('reports lost after consecutive missed frames reach the threshold', () => {
  const tracker = new LiveImageTracker([compileImageTarget(posterA)], { lostAfterMisses: 3 });
  tracker.processFrame(frameFor(posterA), intrinsics);
  assert.deepEqual(tracker.processFrame(blankFrame, intrinsics), []);
  assert.deepEqual(tracker.processFrame(blankFrame, intrinsics), []);
  const third = tracker.processFrame(blankFrame, intrinsics);
  assert.deepEqual(third.map((e) => e.type), ['lost']);
  assert.equal(third[0].index, 0);
  // Once lost, further missed frames report nothing more.
  assert.deepEqual(tracker.processFrame(blankFrame, intrinsics), []);
});

test('switching targets in one frame reports lost for the old and found for the new', () => {
  const tracker = new LiveImageTracker([compileImageTarget(posterA), compileImageTarget(posterB)]);
  tracker.processFrame(frameFor(posterA), intrinsics);
  const switched = tracker.processFrame(frameFor(posterB), intrinsics);
  assert.deepEqual(switched.map((e) => [e.type, e.index]), [
    ['lost', 0],
    ['found', 1],
  ]);
});

test('reset forgets the current target so the next detection is reported as found again', () => {
  const tracker = new LiveImageTracker([compileImageTarget(posterA)]);
  tracker.processFrame(frameFor(posterA), intrinsics);
  tracker.reset();
  const after = tracker.processFrame(frameFor(posterA), intrinsics);
  assert.deepEqual(after.map((e) => e.type), ['found']);
});
