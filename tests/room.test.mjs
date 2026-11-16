import test from 'node:test';
import assert from 'node:assert/strict';
import { blocks, checkPlacement, corners, covers, describeVerdict, kindOf, poseFromAnchor, scannedPlane } from '../apps/preview/dist/room.js';

// A 4 × 4 m floor at y = 0 and a 4 m wide, 2.6 m high wall at z = -2 whose normal points into the room (+Z).
const rect = (centre, u, v, hu, hv) => [
  { x: centre.x - u.x * hu - v.x * hv, y: centre.y - u.y * hu - v.y * hv, z: centre.z - u.z * hu - v.z * hv },
  { x: centre.x + u.x * hu - v.x * hv, y: centre.y + u.y * hu - v.y * hv, z: centre.z + u.z * hu - v.z * hv },
  { x: centre.x + u.x * hu + v.x * hv, y: centre.y + u.y * hu + v.y * hv, z: centre.z + u.z * hu + v.z * hv },
  { x: centre.x - u.x * hu + v.x * hv, y: centre.y - u.y * hu + v.y * hv, z: centre.z - u.z * hu + v.z * hv },
];
const floorPlane = (half = 2) => ({ id: 'floor', kind: 'floor', normal: { x: 0, y: 1, z: 0 }, centre: { x: 0, y: 0, z: 0 }, polygon: rect({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, half, half) });
const wall = { id: 'wall', kind: 'wall', normal: { x: 0, y: 0, z: 1 }, centre: { x: 0, y: 1.3, z: -2 }, polygon: rect({ x: 0, y: 1.3, z: -2 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, 2, 1.3) };
// The office chair, roughly.
const chair = { width: 0.68, depth: 0.66, height: 1.16 };
const at = (x, z, yaw = 0, y = 0) => ({ position: { x, y, z }, yaw });

test('kindOf: labels first, then orientation', () => {
  assert.equal(kindOf('vertical', 0, 'wall'), 'wall');
  assert.equal(kindOf('horizontal', 1, 'floor'), 'floor');
  assert.equal(kindOf('horizontal', 1, 'table'), 'table');
  assert.equal(kindOf('vertical', 0), 'wall');
  assert.equal(kindOf('horizontal', 1), 'floor');
  assert.equal(kindOf('horizontal', -1), 'ceiling');
});

test('covers: inside, outside, and within the margin of a polygon', () => {
  const f = floorPlane();
  assert.ok(covers(f, { x: 1.9, y: 0, z: -1.9 }));
  assert.ok(!covers(f, { x: 2.5, y: 0, z: 0 }));
  assert.ok(covers(f, { x: 2.05, y: 0, z: 0 }, 0.1));
  // A wall polygon is tested in its own plane: height counts.
  assert.ok(covers(wall, { x: 0, y: 1, z: -2 }));
  assert.ok(!covers(wall, { x: 0, y: 3, z: -2 }));
});

test('places in open floor', () => {
  assert.deepEqual(checkPlacement(chair, at(0, -0.5), [floorPlane(), wall]), { ok: true });
});

test('no floor, off the floor, and a table top are refused', () => {
  assert.deepEqual(checkPlacement(chair, at(0, 0), [wall]), { ok: false, reason: 'no_floor' });
  assert.deepEqual(checkPlacement(chair, at(3, 0), [floorPlane()]), { ok: false, reason: 'not_on_floor' });
  assert.deepEqual(checkPlacement(chair, at(0, 0, 0, 0.75), [floorPlane()]), { ok: false, reason: 'not_on_floor' });
  // 5 cm past the detected edge is within the grace.
  assert.deepEqual(checkPlacement(chair, at(2.05, 0), [floorPlane()]), { ok: true });
});

test('the back of the chair through the wall is refused; clear of it is fine', () => {
  // Centre 0.2 m from the wall: the back corners (0.33 m behind the centre) are in the wall.
  const verdict = checkPlacement(chair, at(0, -1.8), [floorPlane(), wall]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'intersects');
  assert.equal(verdict.surface.id, 'wall');
  // 0.36 m away clears it (0.33 m + 2 cm clearance).
  assert.deepEqual(checkPlacement(chair, at(0, -1.64), [floorPlane(), wall]), { ok: true });
});

test('turning the chair can push a corner into the wall', () => {
  const yaw = Math.PI / 4; // diagonal half-extent ≈ 0.47 m
  assert.deepEqual(checkPlacement(chair, at(0, -1.5, yaw), [floorPlane(), wall]), { ok: true });
  assert.equal(checkPlacement(chair, at(0, -1.6, yaw), [floorPlane(), wall]).ok, false);
});

test('only the detected part of a wall blocks', () => {
  // 2.5 m to the side, past the 4 m wide detected stretch: nothing known there.
  assert.deepEqual(checkPlacement(chair, at(2.5, -1.9), [floorPlane(5), wall]), { ok: true });
});

test('wall pieces are not checked here', () => {
  assert.deepEqual(checkPlacement(chair, at(0, -1.95), [floorPlane(), wall], 'wall'), { ok: true });
});

test('corners turn with yaw', () => {
  const c = corners({ width: 2, depth: 1, height: 1 }, at(1, 1, Math.PI / 2));
  const expected = [
    { x: 0.5, z: 2 },
    { x: 0.5, z: 0 },
    { x: 1.5, z: 0 },
    { x: 1.5, z: 2 },
  ];
  c.forEach((p, i) => {
    assert.ok(Math.abs(p.x - expected[i].x) < 1e-9 && Math.abs(p.z - expected[i].z) < 1e-9, `corner ${i}: ${JSON.stringify(p)}`);
  });
});

test('scannedPlane: a vertical XRPlane becomes a world-space wall with its outline and normal', () => {
  // Plane space: +Y is the normal. A wall at x = -2 facing +X: columns X = (0,0,-1), Y = (1,0,0) (the
  // normal), Z = (0,1,0) (up the wall), position (-2, 1.3, 0).
  const matrix = [0, 0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 0, -2, 1.3, 0, 1];
  const polygon = [
    { x: -1, y: 0, z: -1.3 },
    { x: 1, y: 0, z: -1.3 },
    { x: 1, y: 0, z: 1.3 },
    { x: -1, y: 0, z: 1.3 },
  ];
  const plane = scannedPlane('w', 'vertical', undefined, matrix, polygon);
  assert.equal(plane.kind, 'wall');
  assert.deepEqual(plane.normal, { x: 1, y: 0, z: 0 });
  assert.ok(Math.abs(plane.centre.x + 2) < 1e-9 && Math.abs(plane.centre.y - 1.3) < 1e-9);
  assert.ok(covers(plane, { x: -2, y: 2, z: 0.5 }) && !covers(plane, { x: -2, y: 3, z: 0.5 }));
  // The floor polygon, from a horizontal plane with an identity pose at the origin.
  const floor = scannedPlane('f', 'horizontal', 'floor', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], polygon);
  assert.equal(floor.kind, 'floor');
  assert.deepEqual(floor.polygon[2], { x: 1, y: 0, z: 1.3 });
});

test('poseFromAnchor: yaw from the anchor, plus the spin, carrying the model centre offset', () => {
  const quarter = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 3, 0, 4, 1]; // Z axis = +X: yaw 90°
  const pose = poseFromAnchor(quarter);
  assert.ok(Math.abs(pose.yaw - Math.PI / 2) < 1e-9);
  assert.deepEqual(pose.position, { x: 3, y: 0, z: 4 });
  // A model whose box centre sits 0.5 m along its own +Z: at yaw 90° that is along world +X.
  const offset = poseFromAnchor(quarter, 0, { x: 0, z: 0.5 });
  assert.ok(Math.abs(offset.position.x - 3.5) < 1e-9 && Math.abs(offset.position.z - 4) < 1e-9);
  assert.ok(Math.abs(poseFromAnchor(quarter, Math.PI / 2).yaw - Math.PI) < 1e-9);
});

test('blocks: an intersection or a spot off the floor stops a tap; a missing floor plane does not', () => {
  assert.ok(blocks({ ok: false, reason: 'intersects', surface: wall }));
  assert.ok(blocks({ ok: false, reason: 'not_on_floor' }));
  assert.ok(!blocks({ ok: false, reason: 'no_floor' }));
  assert.ok(!blocks({ ok: true }));
});

test('verdict text names the reason', () => {
  assert.match(describeVerdict({ ok: false, reason: 'intersects', surface: wall }), /through a wall/);
  assert.match(describeVerdict({ ok: false, reason: 'no_floor' }), /No floor/);
  assert.equal(describeVerdict({ ok: true }), 'Fits here.');
});
