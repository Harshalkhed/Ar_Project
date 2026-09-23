import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ImageTargetDetector,
  compileImageTarget,
  detectCorners,
  estimateHomography,
  grayscaleFromRgba,
  hammingDistance,
  parseCompiledTarget,
  poseFromHomography,
  projectionFromIntrinsics,
  serializeCompiledTarget,
  solveHomography,
} from '../packages/tracking-image-engine/dist/index.js';
import { applyHomography, multiply3, planeHomography, rotation, sceneWithTarget, seededRandom, texturedImage } from './support/synthetic-images.mjs';

const intrinsics = { fx: 300, fy: 300, cx: 160, cy: 120 };
const FRAME = { frameWidth: 320, frameHeight: 240 };
/** Frontal pose in CV camera axes: target +Y (up) maps to camera -y, target +Z (out of image) faces the camera. */
const FRONTAL = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const poster = texturedImage(240, 180, 7);
const decoy = texturedImage(240, 180, 99);

/** Expected OpenGL/three pose: flip camera y and z of the CV pose, column-major. */
function expectedGlPose(R, t) {
  const F = [1, 0, 0, 0, -1, 0, 0, 0, -1];
  const G = multiply3(F, R);
  const gt = [t[0], -t[1], -t[2]];
  return [G[0], G[3], G[6], 0, G[1], G[4], G[7], 0, G[2], G[5], G[8], 0, gt[0], gt[1], gt[2], 1];
}

function assertClose(actual, expected, tolerance, label) {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance, `${label}[${index}]: ${value} vs ${expected[index]}`));
}

test('grayscale conversion uses luma weights', () => {
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  assert.deepEqual(Array.from(grayscaleFromRgba(rgba, 4, 1).data), [76, 150, 29, 255]);
});

test('corner detector finds the corners of a square and nothing on a flat image', () => {
  const size = 64;
  const data = new Uint8Array(size * size).fill(20);
  for (let y = 20; y < 44; y += 1) for (let x = 20; x < 44; x += 1) data[y * size + x] = 230;
  const corners = detectCorners({ width: size, height: size, data }, { threshold: 40, maxCorners: 50 });
  assert.equal(corners.length, 4);
  for (const [cx, cy] of [[20, 20], [43, 20], [20, 43], [43, 43]]) assert.ok(corners.some((c) => Math.hypot(c.x - cx, c.y - cy) <= 1.5), `corner near ${cx},${cy}`);
  assert.deepEqual(detectCorners({ width: size, height: size, data: new Uint8Array(size * size).fill(90) }, { threshold: 20, maxCorners: 50 }), []);
});

test('hamming distance counts differing bits', () => {
  assert.equal(hammingDistance(new Uint8Array([0b1010, 0xff]), new Uint8Array([0b0110, 0x0f])), 6);
});

test('solves an exact homography from point correspondences', () => {
  const truth = [1.2, 0.1, 30, -0.05, 0.9, 12, 0.0004, -0.0002, 1];
  const src = [[0, 0], [200, 0], [200, 150], [0, 150], [100, 75], [37, 120]];
  const dst = src.map(([x, y]) => applyHomography(truth, x, y));
  const solved = solveHomography(src, dst);
  assertClose(Array.from(solved), truth, 1e-6, 'homography');
});

test('RANSAC recovers the homography despite 40% outliers', () => {
  const truth = [0.8, -0.2, 50, 0.15, 0.85, 20, 0.0003, 0.0001, 1];
  const random = seededRandom(3);
  const src = [], dst = [];
  for (let i = 0; i < 100; i += 1) {
    const p = [random() * 300, random() * 200];
    src.push(p);
    dst.push(i % 5 < 2 ? [random() * 320, random() * 240] : applyHomography(truth, p[0], p[1]));
  }
  const result = estimateHomography(src, dst, { threshold: 2, iterations: 400, seed: 11 });
  assert.ok(result);
  assert.equal(result.inliers.length, 60);
  assert.ok(result.inliers.every((index) => index % 5 >= 2));
  for (const [x, y] of [[0, 0], [300, 200]]) {
    const [ax, ay] = applyHomography(result.homography, x, y);
    const [ex, ey] = applyHomography(truth, x, y);
    assert.ok(Math.hypot(ax - ex, ay - ey) < 0.01);
  }
});

test('pose from homography recovers a known camera pose in OpenGL convention', () => {
  const R = multiply3(rotation(0.3, -0.2, 0.5), FRONTAL);
  const t = [0.12, -0.07, 2.3];
  const pose = poseFromHomography(planeHomography(intrinsics, R, t), intrinsics);
  assertClose(Array.from(pose), expectedGlPose(R, t), 1e-9, 'pose');
});

test('projection from intrinsics matches the off-axis OpenGL frustum', () => {
  const projection = projectionFromIntrinsics({ ...intrinsics, width: 320, height: 240 }, 0.1, 100);
  assertClose(Array.from(projection), [
    2 * 300 / 320, 0, 0, 0,
    0, 2 * 300 / 240, 0, 0,
    0, 0, -(100 + 0.1) / (100 - 0.1), -1,
    0, 0, -(2 * 100 * 0.1) / (100 - 0.1), 0,
  ], 1e-9, 'projection');
});

test('target compilation is deterministic and round-trips through its serialized form', () => {
  const compiled = compileImageTarget(poster);
  assert.ok(compiled.features.length >= 150, `features: ${compiled.features.length}`);
  const serialized = serializeCompiledTarget(compiled);
  assert.deepEqual(serializeCompiledTarget(compileImageTarget(poster)), serialized);
  assert.deepEqual(serializeCompiledTarget(parseCompiledTarget(JSON.parse(JSON.stringify(serialized)))), serialized);
});

test('compiled targets from untrusted JSON are validated', () => {
  const good = serializeCompiledTarget(compileImageTarget(poster));
  assert.throws(() => parseCompiledTarget(null), /object/);
  assert.throws(() => parseCompiledTarget({ ...good, format: 'other' }), /format/);
  assert.throws(() => parseCompiledTarget({ ...good, version: 99 }), /version/);
  assert.throws(() => parseCompiledTarget({ ...good, features: [{ ...good.features[0], descriptor: 'zz' }] }), /descriptor/);
  assert.throws(() => parseCompiledTarget({ ...good, width: -5 }), /width/);
});

const poses = [
  { label: 'near-frontal', R: multiply3(rotation(0.05, 0.04, 0.02), FRONTAL), t: [0.05, -0.03, 1.6] },
  { label: 'rotated, tilted and farther', R: multiply3(rotation(0.35, -0.25, 0.6), FRONTAL), t: [-0.1, 0.05, 2.2] },
];

for (const { label, R, t } of poses) {
  test(`detects the target and recovers its pose: ${label}`, () => {
    const { frame, targetPixelsToFrame } = sceneWithTarget({ target: poster, intrinsics, ...FRAME, rotationCv: R, translationCv: t });
    const detector = new ImageTargetDetector([compileImageTarget(poster)]);
    const detection = detector.detect(frame, intrinsics);
    assert.ok(detection, 'target detected');
    assert.equal(detection.targetIndex, 0);
    assert.ok(detection.inlierCount >= 20, `inliers: ${detection.inlierCount}`);
    const truthCorners = [[0, 0], [poster.width, 0], [poster.width, poster.height], [0, poster.height]].map(([u, v]) => applyHomography(targetPixelsToFrame, u, v));
    detection.corners.forEach(([x, y], index) => assert.ok(Math.hypot(x - truthCorners[index][0], y - truthCorners[index][1]) < 3, `corner ${index} off by ${Math.hypot(x - truthCorners[index][0], y - truthCorners[index][1])}`));
    const expected = expectedGlPose(R, t);
    assertClose(Array.from(detection.pose).slice(0, 12), expected.slice(0, 12), 0.05, 'rotation');
    assertClose(Array.from(detection.pose).slice(12), expected.slice(12), 0.05 * t[2], 'translation');
  });
}

test('does not report a target that is not in the frame', () => {
  const { frame } = sceneWithTarget({ target: decoy, intrinsics, ...FRAME, rotationCv: poses[0].R, translationCv: poses[0].t });
  assert.equal(new ImageTargetDetector([compileImageTarget(poster)]).detect(frame, intrinsics), null);
});

test('identifies which of several targets is visible', () => {
  const { frame } = sceneWithTarget({ target: poster, intrinsics, ...FRAME, rotationCv: poses[0].R, translationCv: poses[0].t });
  const detection = new ImageTargetDetector([compileImageTarget(decoy), compileImageTarget(poster)]).detect(frame, intrinsics);
  assert.equal(detection?.targetIndex, 1);
});
