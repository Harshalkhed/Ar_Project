import type { PlacementSurface } from '@internal-webar/project-schema';

// WebXR hit-test and plane poses are column-major 4×4 matrices whose +Y axis is the surface normal
// (WebXR Plane Detection and Hit Test modules). Columns: X = [0..2], Y = [4..6], Z = [8..10], position = [12..14].

/** Normal within ~37° of straight up counts as floor (tables too); within ~17° of horizontal, as a wall. */
const FLOOR_MIN_UP = 0.8;
const WALL_MAX_UP = 0.3;

/** What kind of surface a hit landed on, or null for a slope, ceiling or anything in between. */
export function surfaceOf(hit: ArrayLike<number>): PlacementSurface | null {
  const up = hit[5] / Math.hypot(hit[4], hit[5], hit[6]);
  if (up >= FLOOR_MIN_UP) return 'floor';
  if (Math.abs(up) <= WALL_MAX_UP) return 'wall';
  return null;
}

/**
 * Anchor pose for wall-placed content (which faces +Z with +Y up): +Z along the wall's normal, +Y as
 * close to world-up as the wall allows, so a picture hangs upright even if the detected wall leans a
 * little. Position is the hit point.
 */
export function wallAnchor(hit: ArrayLike<number>): number[] {
  const length = Math.hypot(hit[4], hit[5], hit[6]);
  const z = [hit[4] / length, hit[5] / length, hit[6] / length];
  // World up with its component along the normal removed, then normalised.
  const y = [-z[1] * z[0], 1 - z[1] * z[1], -z[1] * z[2]];
  const yLength = Math.hypot(y[0], y[1], y[2]);
  for (let i = 0; i < 3; i += 1) y[i] /= yLength;
  const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]]; // y × z
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, hit[12], hit[13], hit[14], 1];
}

/**
 * Fallback for walls the phone cannot detect: an anchor for a wall piece placed from a floor hit. It is
 * lifted to `height` (the piece's centre, its origin by the wall convention) and turned about the vertical
 * to face `viewer` (the camera position), so the person can place it on the floor right in front of the
 * wall. Upright, no tilt.
 */
export function floorMountedWallAnchor(hit: ArrayLike<number>, viewer: Point, height: number): number[] {
  return uprightPose(hit[12], hit[13] + height, hit[14], viewer.x - hit[12], viewer.z - hit[14]);
}

/**
 * Anchor for floor-placed content: at the hit point and always upright (+Y = world up), even where the
 * detected surface tilts (up to ~37° still counts as floor), so furniture never leans. It keeps the
 * turn about the vertical that the hit pose has (WebXR leaves a hit's X/Z axes to the device), so on a
 * level floor the anchor equals the hit pose.
 */
export function floorAnchor(hit: ArrayLike<number>): number[] {
  return uprightPose(hit[12], hit[13], hit[14], hit[8], hit[10]);
}

type Point = { x: number; y: number; z: number };

/** Upright pose at (px, py, pz) whose +Z faces the horizontal direction (fx, fz). */
function uprightPose(px: number, py: number, pz: number, fx: number, fz: number): number[] {
  const length = Math.hypot(fx, fz);
  if (length < 1e-6) [fx, fz] = [0, 1]; // No horizontal direction (straight up or down): any facing will do.
  else [fx, fz] = [fx / length, fz / length];
  // z = facing (horizontal), y = up, x = y × z.
  return [fz, 0, -fx, 0, 0, 1, 0, 0, fx, 0, fz, 0, px, py, pz, 1];
}

/** The anchor to place at for this hit, or null when the hit is not on the project's surface. */
export function anchorFor(hit: ArrayLike<number>, surface: PlacementSurface): number[] | null {
  if (surfaceOf(hit) !== surface) return null;
  return surface === 'wall' ? wallAnchor(hit) : floorAnchor(hit);
}

const distanceTo = (hit: ArrayLike<number>, from: Point): number => Math.hypot(hit[12] - from.x, hit[13] - from.y, hit[14] - from.z);

/**
 * The hit a ray really lands on: the nearest one. Anything farther along the ray is behind that surface,
 * e.g. a floor estimate that runs on past a wall; placing there put a chair into the wall. WebXR sorts a
 * hit-test source's results by distance (Hit Test spec, "compute hit test results"); `from` (the viewer,
 * which is where screen rays start) re-checks that, since transient-input results are not stated to be sorted.
 */
export function nearestHit<T extends ArrayLike<number>>(hits: readonly T[], from?: Point): T | undefined {
  if (!from) return hits[0];
  let nearest: T | undefined;
  for (const hit of hits) if (!nearest || distanceTo(hit, from) < distanceTo(nearest, from)) nearest = hit;
  return nearest;
}

/**
 * Where a ray places the content: the nearest hit, if it is on the project's surface; otherwise nothing
 * (never a farther hit behind it). `wallFromFloor` is the wall-piece fallback for undetectable walls: a
 * floor hit then hangs the piece at that height, facing the viewer.
 */
export function placementFor(
  hits: readonly ArrayLike<number>[],
  surface: PlacementSurface,
  viewer?: Point,
  wallFromFloor?: { height: number },
): { anchor: number[]; hit: ArrayLike<number> } | null {
  const hit = nearestHit(hits, viewer);
  if (!hit) return null;
  let anchor = anchorFor(hit, surface);
  if (!anchor && surface === 'wall' && wallFromFloor && viewer && surfaceOf(hit) === 'floor') anchor = floorMountedWallAnchor(hit, viewer, wallFromFloor.height);
  return anchor ? { anchor, hit } : null;
}

/** For the `?debug` readout: what a ray's hits look like, and whether the old any-hit rule would have looked behind the nearest one. */
export function describeHits(hits: readonly ArrayLike<number>[], surface: PlacementSurface, viewer?: Point): string {
  const hit = nearestHit(hits, viewer);
  if (!hit) return 'no hit';
  const up = hit[5] / Math.hypot(hit[4], hit[5], hit[6]);
  const tilt = (Math.acos(Math.min(1, Math.max(-1, up))) * 180) / Math.PI;
  const behind = hits.filter((h) => h !== hit && surfaceOf(h) === surface).length;
  const distance = viewer ? ` ${distanceTo(hit, viewer).toFixed(2)} m` : '';
  return `${hits.length} hit(s), nearest ${surfaceOf(hit) ?? 'other'} ${tilt.toFixed(0)}° from up${distance}, y ${hit[13].toFixed(2)}` + (behind ? ` · ${behind} ${surface} hit(s) behind it` : '');
}
