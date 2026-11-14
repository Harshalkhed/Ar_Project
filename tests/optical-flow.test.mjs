import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPyramid, compileImageTarget, LiveImageTracker, trackPoints } from '../packages/tracking-image-engine/dist/index.js';
import { multiply3, rotation, sceneWithTarget, texturedImage } from './support/synthetic-images.mjs';

const FRONTAL = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const intrinsics = { fx: 300, fy: 300, cx: 160, cy: 120, width: 320, height: 240 };
const poster = texturedImage(240, 180, 7);

/** Expected OpenGL/three pose: flip camera y and z of the CV pose, column-major (same as image-engine.test.mjs). */
function expectedGlPose(R, t) {
  const G = multiply3(FRONTAL, R);
  return [G[0], G[3], G[6], 0, G[1], G[4], G[7], 0, G[2], G[5], G[8], 0, t[0], -t[1], -t[2], 1];
}

function assertClose(actual, expected, tolerance, label) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance, `${label}[${index}]: ${value} vs ${expected[index]}`));
}

/** `image` moved by a whole-pixel offset: shifted(x, y) = image(x - dx, y - dy), edges clamped. */
function shifted(image, dx, dy) {
  const data = new Uint8Array(image.width * image.height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const sx = Math.min(Math.max(x - dx, 0), image.width - 1);
      const sy = Math.min(Math.max(y - dy, 0), image.height - 1);
      data[y * image.width + x] = image.data[sy * image.width + sx];
    }
  }
  return { width: image.width, height: image.height, data };
}

function frameAt(R, t) {
  return sceneWithTarget({ target: poster, intrinsics, frameWidth: 320, frameHeight: 240, rotationCv: multiply3(R, FRONTAL), translationCv: t }).frame;
}

test('trackPoints recovers a known shift larger than its window, via the pyramid', () => {
  const image = texturedImage(200, 150, 7);
  const [dx, dy] = [11, -6]; // The matching window is only ±7 px, so the coarse levels must find this.
  const from = buildPyramid(image, 3);
  const to = buildPyramid(shifted(image, dx, dy), 3);
  const points = [];
  for (let y = 30; y <= 120; y += 15) for (let x = 30; x <= 170; x += 15) points.push([x, y]);
  const tracked = trackPoints(from, to, points);
  const kept = tracked.map((point, i) => [points[i], point]).filter(([, point]) => point);
  // Grid points, not corners: some sit on flat or ambiguous patches and are rightly rejected
  // (measured: 47/70 kept, and 19 of the 23 rejected would have tracked to the wrong place).
  assert.ok(kept.length >= points.length / 2, `only ${kept.length}/${points.length} points tracked`);
  for (const [[x, y], [nx, ny]] of kept) {
    assert.ok(Math.abs(nx - (x + dx)) < 0.1 && Math.abs(ny - (y + dy)) < 0.1, `(${x},${y}) → (${nx},${ny})`);
  }
});

test('trackPoints drops points on flat patches and points that leave the frame', () => {
  const flat = { width: 100, height: 100, data: new Uint8Array(100 * 100).fill(120) };
  assert.deepEqual(trackPoints(buildPyramid(flat, 3), buildPyramid(flat, 3), [[50, 50]]), [null]);
  const image = texturedImage(200, 150, 7);
  const tracked = trackPoints(buildPyramid(image, 3), buildPyramid(shifted(image, 20, 0), 3), [[190, 75]]);
  assert.deepEqual(tracked, [null]);
});

test('after a detection, the next frame is tracked by optical flow and matches the true pose', () => {
  const tracker = new LiveImageTracker([compileImageTarget(poster)]);
  const first = tracker.processFrame(frameAt(rotation(0.05, 0.03, 0), [0, 0, 1.6]), intrinsics);
  assert.deepEqual(first.map((e) => [e.type, e.source]), [['found', 'detection']]);

  // A small hand movement between frames: a little rotation and a few centimetres of translation.
  const R = rotation(0.08, 0.0, 0.03);
  const t = [0.03, -0.02, 1.55];
  const second = tracker.processFrame(frameAt(R, t), intrinsics);
  assert.deepEqual(second.map((e) => [e.type, e.source]), [['pose', 'flow']]);
  const pose = Array.from(second[0].pose);
  const expected = expectedGlPose(multiply3(R, FRONTAL), t);
  assertClose(pose.slice(0, 12), expected.slice(0, 12), 0.05, 'rotation');
  assertClose(pose.slice(12), expected.slice(12), 0.05 * t[2], 'translation');
});

test('full detection runs again every redetectEvery frames, and flow can be turned off', () => {
  const frames = [0, 1, 2, 3].map((i) => frameAt(rotation(0.05 + i * 0.01, 0.03, 0), [0.01 * i, 0, 1.6]));
  const withFlow = new LiveImageTracker([compileImageTarget(poster)], { redetectEvery: 2 });
  assert.deepEqual(frames.map((frame) => withFlow.processFrame(frame, intrinsics)[0]?.source), ['detection', 'flow', 'detection', 'flow']);
  const withoutFlow = new LiveImageTracker([compileImageTarget(poster)], { flow: false });
  assert.deepEqual(frames.map((frame) => withoutFlow.processFrame(frame, intrinsics)[0]?.source), ['detection', 'detection', 'detection', 'detection']);
});

test('when flow loses the target, it falls back to detection and counts misses only when both fail', () => {
  const tracker = new LiveImageTracker([compileImageTarget(poster)], { lostAfterMisses: 2 });
  const blank = { width: 320, height: 240, data: new Uint8Array(320 * 240).fill(90) };
  tracker.processFrame(frameAt(rotation(0.05, 0.03, 0), [0, 0, 1.6]), intrinsics);
  assert.deepEqual(tracker.processFrame(blank, intrinsics), []);
  assert.deepEqual(tracker.processFrame(blank, intrinsics).map((e) => e.type), ['lost']);
  assert.deepEqual(tracker.processFrame(frameAt(rotation(0.05, 0.03, 0), [0, 0, 1.6]), intrinsics).map((e) => [e.type, e.source]), [['found', 'detection']]);
});
