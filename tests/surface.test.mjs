import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorFor, describeHits, floorAnchor, floorMountedWallAnchor, placementFor, surfaceOf, wallAnchor } from '../apps/preview/dist/surface.js';

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

test('floor-mounted wall anchor: lifted to hanging height, upright, facing the viewer', () => {
  // Floor hit at (1, 0, -2); viewer standing at (1, 1.6, 0), i.e. straight along +Z from the hit.
  close(floorMountedWallAnchor(floorHit.map((v, i) => (i === 12 ? 1 : i === 14 ? -2 : v)), { x: 1, y: 1.6, z: 0 }, 1.45), pose([1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1.45, -2]), 'viewer along +Z');
  // Viewer off to the +X side: the piece turns to face +X, still upright.
  close(floorMountedWallAnchor(floorHit, { x: 5.5, y: 1.6, z: -1 }, 1.45), pose([0, 0, -1], [0, 1, 0], [1, 0, 0], [0.5, 1.45, -1]), 'viewer along +X');
});

test('floor anchor stays upright on a tilted floor hit, keeping the hit point and its turn', () => {
  // Floor estimate tilted 20° about X (normal leaning towards +Z), hit Z axis turned 90° (facing +X).
  const t = (20 * Math.PI) / 180;
  const tilted = pose([0, Math.sin(t), -Math.cos(t)],[0, Math.cos(t), Math.sin(t)], [1, 0, 0], [0.3, 0.02, -1.5]);
  assert.equal(surfaceOf(tilted), 'floor');
  close(floorAnchor(tilted), pose([0, 0, -1], [0, 1, 0], [1, 0, 0], [0.3, 0.02, -1.5]), 'upright, facing +X');
  // On a level floor nothing changes.
  close(floorAnchor(floorHit), floorHit, 'level');
});

test('only the nearest hit places: a floor hit behind a wall is not used', () => {
  const viewer = { x: 0, y: 1.5, z: 0 };
  // The ray meets a wall at 1 m, and a floor estimate that runs on past the wall at 3 m.
  const wallInFront = pose([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, 1.2, -1]);
  const floorBehind = pose([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -3]);
  assert.equal(placementFor([wallInFront, floorBehind], 'floor', viewer), null);
  // Out of order: the nearest is still found from the viewer.
  assert.equal(placementFor([floorBehind, wallInFront], 'floor', viewer), null);
  // With nothing in front, the floor hit places, upright.
  close(placementFor([floorBehind], 'floor', viewer).anchor, floorBehind, 'floor');
  // A wall piece takes the wall in front.
  close(placementFor([wallInFront, floorBehind], 'wall', viewer).anchor, wallAnchor(wallInFront), 'wall');
  assert.equal(placementFor([], 'floor', viewer), null);
  assert.match(describeHits([wallInFront, floorBehind], 'floor', viewer), /nearest wall .* 1 floor hit\(s\) behind it/);
});

test('wall pieces take a floor hit only once the floor fallback is on', () => {
  const viewer = { x: 0.5, y: 1.6, z: 1 };
  assert.equal(placementFor([floorHit], 'wall', viewer), null);
  close(placementFor([floorHit], 'wall', viewer, { height: 1.45 }).anchor, floorMountedWallAnchor(floorHit, viewer, 1.45), 'from floor');
  assert.equal(placementFor([floorHit], 'floor', viewer, { height: 1.45 }).anchor[13], 0, 'floor pieces ignore it');
});

test('anchorFor only accepts hits on the project surface', () => {
  close(anchorFor(floorHit, 'floor'), floorHit, 'floor');
  assert.equal(anchorFor(floorHit, 'wall'), null);
  assert.equal(anchorFor(wallHit, 'floor'), null);
  close(anchorFor(wallHit, 'wall'), wallAnchor(wallHit), 'wall');
});
