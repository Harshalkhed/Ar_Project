import test from 'node:test';
import assert from 'node:assert/strict';
import { scaledTransform } from '../apps/preview/dist/transform-utils.js';

const base = { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0.1, y: 0.2, z: 0.3 }, scale: { x: 1, y: 1, z: 1 } };

test('multiplies each scale axis by the factor', () => {
  assert.deepEqual(scaledTransform(base, 2).scale, { x: 2, y: 2, z: 2 });
});

test('supports non-uniform base scale', () => {
  const nonUniform = { ...base, scale: { x: 0.5, y: 2, z: 1 } };
  assert.deepEqual(scaledTransform(nonUniform, 3).scale, { x: 1.5, y: 6, z: 3 });
});

test('also scales position by the same factor, so resizing pivots around the anchor', () => {
  // A non-zero authored position often encodes a pivot offset (e.g. recentering a model on its
  // anchor). Scaling only `scale` and not `position` drifts that offset away from the anchor as
  // soon as factor != 1 -- confirmed on a real device with a floor-plan project.
  assert.deepEqual(scaledTransform(base, 2).position, { x: 2, y: 4, z: 6 });
});

test('leaves rotation untouched (scaling does not affect angles)', () => {
  assert.deepEqual(scaledTransform(base, 5).rotation, base.rotation);
});

test('a zero position (the common case) stays zero regardless of factor', () => {
  const zeroed = { ...base, position: { x: 0, y: 0, z: 0 } };
  assert.deepEqual(scaledTransform(zeroed, 7).position, { x: 0, y: 0, z: 0 });
});

test('does not mutate the input', () => {
  scaledTransform(base, 2);
  assert.deepEqual(base.position, { x: 1, y: 2, z: 3 });
  assert.deepEqual(base.scale, { x: 1, y: 1, z: 1 });
});
