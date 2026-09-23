import test from 'node:test';
import assert from 'node:assert/strict';
import { scaledTransform } from '../apps/preview/dist/transform-utils.js';

const base = { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0.1, y: 0.2, z: 0.3 }, scale: { x: 1, y: 1, z: 1 } };

test('multiplies each scale axis by the factor', () => {
  assert.deepEqual(scaledTransform(base, 2), { ...base, scale: { x: 2, y: 2, z: 2 } });
});

test('supports non-uniform base scale', () => {
  const nonUniform = { ...base, scale: { x: 0.5, y: 2, z: 1 } };
  assert.deepEqual(scaledTransform(nonUniform, 3), { ...nonUniform, scale: { x: 1.5, y: 6, z: 3 } });
});

test('leaves position and rotation untouched', () => {
  const result = scaledTransform(base, 5);
  assert.deepEqual(result.position, base.position);
  assert.deepEqual(result.rotation, base.rotation);
});

test('does not mutate the input', () => {
  scaledTransform(base, 2);
  assert.deepEqual(base.scale, { x: 1, y: 1, z: 1 });
});
