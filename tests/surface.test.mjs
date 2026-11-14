import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorFor, surfaceOf, wallAnchor } from '../apps/preview/dist/surface.js';

/** Column-major pose with the given X, Y (= surface normal), Z axes and position. */
const pose = (x, y, z, p) => [...x, 0, ...y, 0, ...z, 0, ...p, 1];
const close = (actual, expected, label) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${label}[${i}]: ${v} vs ${expected[i]}`));

const floorHit = pose([1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0, -1]);
// A wall facing +X (its normal points into the room along +X). WebXR picks the in-plane X/Z axes freely.
const wallHit = pose([0, 0, 1], [1, 0, 0], [0, -1, 0], [-2, 1.4, 0.3]);

test('classifies floor, wall and in-between surfaces from the normal', () => {
  assert.equal(surfaceOf(floorHit), 'floor');
  assert.equal(surfaceOf(wallHit), 'wall');
  const slope = Math.SQRT1_2; // 45°: neither
  assert.equal(surfaceOf(pose([1, 0, 0], [0, slope, slope], [0, -slope, slope], [0, 0, 0])), null);
  assert.equal(surfaceOf(pose([1, 0, 0], [0, -1, 0], [0, 0, -1], [0, 2.5, 0])), null); // ceiling
});

test('wall anchor faces out of the wall, stays upright, and sits at the hit point', () => {
  close(wallAnchor(wallHit), pose([0, 0, -1], [0, 1, 0], [1, 0, 0], [-2, 1.4, 0.3]), 'wall facing +X');
});

test('on a slightly leaning wall the anchor lies flat on it with no sideways roll, and is orthonormal', () => {
  const lean = 0.1; // normal tipped 0.1 rad downward
  const n = [Math.cos(lean), -Math.sin(lean), 0];
  const anchor = wallAnchor(pose([0, 0, 1], n, [0, -1, 0], [0, 1, 0]));
  const [x, y, z] = [anchor.slice(0, 3), anchor.slice(4, 7), anchor.slice(8, 11)];
  close(z, n, 'faces along the wall normal');
  // Up leans with the wall (so the picture lies flat on it) but has no component along the wall's
  // horizontal direction (world z here), i.e. no sideways roll; it is the steepest "up" on that wall.
  assert.ok(Math.abs(y[2]) < 1e-9 && y[1] > 0.99, `no sideways roll: ${y}`);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const [a, b, label] of [[x, y, 'x·y'], [y, z, 'y·z'], [x, z, 'x·z']]) assert.ok(Math.abs(dot(a, b)) < 1e-9, label);
  for (const v of [x, y, z]) assert.ok(Math.abs(dot(v, v) - 1) < 1e-9, 'unit length');
});

test('anchorFor only accepts hits on the project surface', () => {
  assert.deepEqual(anchorFor(floorHit, 'floor'), floorHit);
  assert.equal(anchorFor(floorHit, 'wall'), null);
  assert.equal(anchorFor(wallHit, 'floor'), null);
  close(anchorFor(wallHit, 'wall'), wallAnchor(wallHit), 'wall');
});
