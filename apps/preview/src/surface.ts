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
export function floorMountedWallAnchor(hit: ArrayLike<number>, viewer: { x: number; y: number; z: number }, height: number): number[] {
  const [px, py, pz] = [hit[12], hit[13], hit[14]];
  let fx = viewer.x - px;
  let fz = viewer.z - pz;
  const length = Math.hypot(fx, fz);
  if (length < 1e-6) [fx, fz] = [0, 1]; // Viewer straight above: any facing will do.
  else [fx, fz] = [fx / length, fz / length];
  // z = facing (towards the viewer, horizontal), y = up, x = y × z.
  return [fz, 0, -fx, 0, 0, 1, 0, 0, fx, 0, fz, 0, px, py + height, pz, 1];
}

/** The anchor to place at for this hit, or null when the hit is not on the project's surface. */
export function anchorFor(hit: ArrayLike<number>, surface: PlacementSurface): number[] | null {
  if (surfaceOf(hit) !== surface) return null;
  return surface === 'wall' ? wallAnchor(hit) : Array.from(hit);
}
