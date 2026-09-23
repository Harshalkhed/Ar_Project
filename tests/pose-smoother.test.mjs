import test from 'node:test';
import assert from 'node:assert/strict';
import { PoseSmoother } from '../apps/preview/dist/pose-smoother.js';

/** Column-major 4x4: rotation about Y by `yaw`, then translate by (x, y, z). Matches three.js Matrix4.compose. */
const poseAt = (x, y, z, yaw = 0) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1];
};

const distance = (a, b) => Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]);
/** Where a matrix sends the local +X axis (its first column, for a pure-rotation matrix). */
const localXDirection = (m) => {
  const len = Math.hypot(m[0], m[1], m[2]);
  return [m[0] / len, m[1] / len, m[2] / len];
};

test('rejects an out-of-range alpha', () => {
  for (const alpha of [0, -0.1, 1.5, NaN]) assert.throws(() => new PoseSmoother(alpha), RangeError);
});

test('the first update passes the pose through unsmoothed', () => {
  const smoother = new PoseSmoother(0.3);
  const pose = poseAt(1, 2, 3);
  const out = smoother.update(pose);
  out.forEach((value, index) => assert.ok(Math.abs(value - pose[index]) < 1e-9, `index ${index}`));
});

test('a stable input stays stable (no drift at rest)', () => {
  const smoother = new PoseSmoother(0.3);
  const pose = poseAt(1, 2, 3);
  smoother.update(pose);
  for (let i = 0; i < 10; i += 1) {
    const out = smoother.update(pose);
    out.forEach((value, index) => assert.ok(Math.abs(value - pose[index]) < 1e-9));
  }
});

test('smooths a single noisy jump by less than the raw jump', () => {
  const smoother = new PoseSmoother(0.3);
  smoother.update(poseAt(0, 0, 0));
  const jumped = poseAt(1, 0, 0); // a full 1-unit jitter jump
  const smoothed = smoother.update(jumped);
  const smoothedStep = distance(smoothed, poseAt(0, 0, 0));
  assert.ok(smoothedStep > 0 && smoothedStep < 1, `expected partial step, got ${smoothedStep}`);
});

test('converges toward a sustained step change over repeated updates', () => {
  const smoother = new PoseSmoother(0.3);
  smoother.update(poseAt(0, 0, 0));
  const target = poseAt(5, 0, 0);
  let last;
  for (let i = 0; i < 40; i += 1) last = smoother.update(target);
  assert.ok(distance(last, target) < 0.01, `expected convergence, still off by ${distance(last, target)}`);
});

test('reset makes the next update pass through unsmoothed again', () => {
  const smoother = new PoseSmoother(0.3);
  smoother.update(poseAt(0, 0, 0));
  smoother.update(poseAt(0.1, 0, 0));
  smoother.reset();
  const pose = poseAt(9, 9, 9);
  const out = smoother.update(pose);
  out.forEach((value, index) => assert.ok(Math.abs(value - pose[index]) < 1e-9));
});

test('smooths rotation as well as position', () => {
  const smoother = new PoseSmoother(0.5);
  smoother.update(poseAt(0, 0, 0, 0));
  const halfTurn = poseAt(0, 0, 0, Math.PI);
  const smoothed = smoother.update(halfTurn);
  // A full pass-through would put local +X at (-1,0,0); a half-blended 90-degree turn puts it near (0,0,±1).
  const [x] = localXDirection(smoothed);
  assert.ok(x > -0.99 && x < 0.99, `expected a partial rotation, x=${x}`);
});
