// A room model from the surfaces the phone has detected, and the check that decides whether a piece of
// furniture can stand at a spot. Pure functions, no WebXR types: `webxr.ts` turns XRPlanes into
// `ScannedPlane`s. The same rules as the native iPhone checker (apps/ios-placement, PlacementCore).
//
// What this knows is only what the phone reported: a wall it has not looked at, or an object plane
// detection cannot see (WebXR on phones has no mesh), is unknown, not clear. The page says so.
import type { PlacementSurface } from '@internal-webar/project-schema';

export type Vec3 = { x: number; y: number; z: number };
export type SurfaceKind = 'floor' | 'wall' | 'ceiling' | 'table' | 'other';

/**
 * A detected flat surface: its outline as world-space points (an XRPlane polygon transformed by its
 * pose), the outward normal and the centre. A wall plane only covers the part of the wall the phone has
 * seen, so "outside the polygon" means unknown, not free.
 */
export type ScannedPlane = { id: string; kind: SurfaceKind; normal: Vec3; centre: Vec3; polygon: Vec3[] };

/** A piece's bounding box on the floor (`width` across its x, `depth` across its z) and its `height`. */
export type Footprint = { width: number; depth: number; height: number };

/** Where it stands: `position` is the bottom centre, `yaw` the turn about the vertical in radians. */
export type PlacementPose = { position: Vec3; yaw: number };

export type Verdict =
  | { ok: true }
  | { ok: false; reason: 'no_floor' | 'not_on_floor' }
  | { ok: false; reason: 'intersects'; surface: ScannedPlane };

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const rotateY = (v: Vec3, yaw: number): Vec3 => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
};

/** Floor, wall or other, from a plane's orientation and (where Chrome gives one) its semantic label. */
export function kindOf(orientation: 'horizontal' | 'vertical', normalY: number, semanticLabel?: string): SurfaceKind {
  const label = semanticLabel?.toLowerCase() ?? '';
  if (label.includes('wall')) return 'wall';
  if (label.includes('floor')) return 'floor';
  if (label.includes('ceiling')) return 'ceiling';
  if (label.includes('table') || label.includes('desk')) return 'table';
  if (orientation === 'vertical') return 'wall';
  return normalY > 0 ? 'floor' : 'ceiling'; // An unlabelled horizontal plane facing up is taken as floor.
}

/**
 * A detected plane as the room model sees it. `matrix` is the plane's pose (column-major, +Y the normal,
 * as WebXR gives it) and `polygon` its outline in that space (y = 0), both from an XRPlane.
 */
export function scannedPlane(
  id: string,
  orientation: 'horizontal' | 'vertical',
  semanticLabel: string | undefined,
  matrix: ArrayLike<number>,
  polygon: readonly Vec3[],
): ScannedPlane {
  const m = matrix;
  const world = (p: Vec3): Vec3 => ({
    x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
    y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
    z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14],
  });
  const length = Math.hypot(m[4], m[5], m[6]) || 1;
  const normal = { x: m[4] / length, y: m[5] / length, z: m[6] / length };
  const points = polygon.map(world);
  const centre = points.length
    ? points.reduce((acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length, z: acc.z + p.z / points.length }), { x: 0, y: 0, z: 0 })
    : { x: m[12], y: m[13], z: m[14] };
  return { id, kind: kindOf(orientation, normal.y, semanticLabel), normal, centre, polygon: points };
}

/**
 * The footprint pose for an upright anchor matrix (`floorAnchor` output): its turn about the vertical
 * plus `extraYaw` (the drag-to-turn spin applied inside the anchor), and the model's bounding-box centre
 * offset (`centre`, in model space) carried along, since a model's origin need not be its centre.
 */
export function poseFromAnchor(anchor: ArrayLike<number>, extraYaw = 0, centre: { x: number; z: number } = { x: 0, z: 0 }): PlacementPose {
  const yaw = Math.atan2(anchor[8], anchor[10]) + extraYaw;
  const offset = rotateY({ x: centre.x, y: 0, z: centre.z }, yaw);
  return { position: { x: anchor[12] + offset.x, y: anchor[13], z: anchor[14] + offset.z }, yaw };
}

/** A verdict that should stop a tap: not a missing floor plane (hit-testing has its own floor estimate). */
export const blocks = (verdict: Verdict): boolean => !verdict.ok && verdict.reason !== 'no_floor';

/** The four floor corners of a footprint at a pose, in world space. */
export function corners(footprint: Footprint, pose: PlacementPose): Vec3[] {
  const hw = footprint.width / 2;
  const hd = footprint.depth / 2;
  return [
    { x: -hw, y: 0, z: -hd },
    { x: hw, y: 0, z: -hd },
    { x: hw, y: 0, z: hd },
    { x: -hw, y: 0, z: hd },
  ].map((c) => {
    const r = rotateY(c, pose.yaw);
    return { x: r.x + pose.position.x, y: r.y + pose.position.y, z: r.z + pose.position.z };
  });
}

/**
 * Whether a point, projected onto the plane, lies inside its outline (grown by `margin`). The outline is
 * flattened to two in-plane axes and tested with the even-odd rule; the margin is applied as a distance
 * from the edge, which is enough for the convex-ish outlines plane detection produces.
 */
export function covers(plane: ScannedPlane, point: Vec3, margin = 0): boolean {
  if (plane.polygon.length < 3) return false;
  const n = plane.normal;
  // In-plane axes: u is any direction perpendicular to the normal, v = n × u.
  const seed = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const uRaw = cross(seed, n);
  const uLen = Math.hypot(uRaw.x, uRaw.y, uRaw.z);
  const u = { x: uRaw.x / uLen, y: uRaw.y / uLen, z: uRaw.z / uLen };
  const v = cross(n, u);
  const to2 = (p: Vec3): [number, number] => {
    const d = sub(p, plane.centre);
    return [dot(d, u), dot(d, v)];
  };
  const [px, py] = to2(point);
  const poly = plane.polygon.map(to2);
  let inside = false;
  let nearest = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[j];
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
    // Distance from the point to this edge, for the margin.
    const ex = bx - ax;
    const ey = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)));
    nearest = Math.min(nearest, Math.hypot(px - (ax + t * ex), py - (ay + t * ey)));
  }
  return inside || nearest <= margin;
}

export const CLEARANCE_M = 0.02; // closer than this to a wall counts as touching it
const FLOOR_TOLERANCE_M = 0.05; // how far above or below the floor plane still counts as on it
const FLOOR_EDGE_GRACE_M = 0.1; // the detected floor usually stops short of the real one

/**
 * Can `footprint` stand at `pose`? The spot must be on a detected floor, and no corner of the footprint
 * may be on or behind a wall plane within the part of the wall that was detected (checked at the floor
 * and at half the piece's height, since a wall outline only covers what the phone has seen).
 * `surface` is the project's own placement surface; wall pieces are not checked here (they hang at a
 * wall hit by construction), so they always get `ok`.
 */
export function checkPlacement(footprint: Footprint, pose: PlacementPose, planes: readonly ScannedPlane[], surface: PlacementSurface = 'floor'): Verdict {
  if (surface !== 'floor') return { ok: true };
  const floors = planes.filter((p) => p.kind === 'floor');
  if (!floors.length) return { ok: false, reason: 'no_floor' };
  const p = pose.position;
  const onFloor = floors.some((f) => Math.abs(dot(sub(p, f.centre), f.normal)) <= FLOOR_TOLERANCE_M && covers(f, p, FLOOR_EDGE_GRACE_M));
  if (!onFloor) return { ok: false, reason: 'not_on_floor' };
  const floorCorners = corners(footprint, pose);
  for (const wall of planes) {
    if (wall.kind !== 'wall') continue;
    for (const corner of floorCorners) {
      if (dot(sub(corner, wall.centre), wall.normal) >= CLEARANCE_M) continue; // in front of the wall
      const mid = { x: corner.x, y: corner.y + footprint.height / 2, z: corner.z };
      if (covers(wall, corner, CLEARANCE_M) || covers(wall, mid, CLEARANCE_M)) return { ok: false, reason: 'intersects', surface: wall };
    }
    // ponytail: corners only; a footprint wider than a short detected wall segment could straddle it.
  }
  return { ok: true };
}

/** One line for the status bar. */
export function describeVerdict(verdict: Verdict): string {
  if (verdict.ok) return 'Fits here.';
  switch (verdict.reason) {
    case 'no_floor':
      return 'No floor detected yet: move the phone slowly over the floor.';
    case 'not_on_floor':
      return "That spot isn't on the detected floor. Try nearer the middle of the room, or scan more floor.";
    case 'intersects':
      return `It would go through a ${verdict.surface.kind === 'wall' ? 'wall' : verdict.surface.kind}. Tap a spot further out, or turn it.`;
  }
}
