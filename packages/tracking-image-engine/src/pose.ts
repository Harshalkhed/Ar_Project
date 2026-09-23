import type { Matrix3 } from './homography.js';

/** Pinhole camera intrinsics in pixels (continuous coordinates, pixel centres at +0.5). */
export interface CameraIntrinsics { readonly fx: number; readonly fy: number; readonly cx: number; readonly cy: number; }

const cross = (a: readonly number[], b: readonly number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Nearest rotation to a 3×3 (row-major) matrix via Newton polar iteration: R ← (R + R⁻ᵀ) / 2. */
function orthonormalise(m: number[]): number[] {
  let r = m.slice();
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const [a, b, c, d, e, f, g, h, i] = r;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const determinant = a * A + b * B + c * C;
    // Inverse-transpose equals the cofactor matrix divided by the determinant.
    const inverseTranspose = [A, B, C, -(b * i - c * h), a * i - c * g, -(a * h - b * g), b * f - c * e, -(a * f - c * d), a * e - b * d].map((value) => value / determinant);
    const next = r.map((value, index) => (value + inverseTranspose[index]) / 2);
    const change = next.reduce((sum, value, index) => sum + Math.abs(value - r[index]), 0);
    r = next;
    if (change < 1e-15) break;
  }
  return r;
}

/**
 * A rigid pose in computer-vision camera axes (X right, Y down, Z forward): row-major rotation
 * plus translation, such that a target-plane point P projects to camera space as R·P + t.
 */
export interface CvPose { readonly r: readonly number[]; readonly t: readonly number[]; }

/**
 * Closed-form target pose from a plane-to-image homography, in computer-vision camera axes.
 * The homography maps target-plane coordinates (origin at the target centre, +X right, +Y up,
 * 1 unit = target width) to image pixels. This is a good initial estimate; {@link refinePose}
 * improves it using the actual point correspondences.
 */
export function cvPoseFromHomography(planeToImage: Matrix3, intrinsics: CameraIntrinsics): CvPose {
  const { fx, fy, cx, cy } = intrinsics;
  const kInverse = [1 / fx, 0, -cx / fx, 0, 1 / fy, -cy / fy, 0, 0, 1];
  const column = (index: number): number[] => {
    const v = [planeToImage[index], planeToImage[3 + index], planeToImage[6 + index]];
    return [kInverse[0] * v[0] + kInverse[1] * v[1] + kInverse[2] * v[2], kInverse[3] * v[0] + kInverse[4] * v[1] + kInverse[5] * v[2], v[2]];
  };
  const a1 = column(0), a2 = column(1), a3 = column(2);
  let scale = 2 / (Math.hypot(...a1) + Math.hypot(...a2));
  // The target must be in front of the camera (positive depth in computer-vision axes).
  if (a3[2] * scale < 0) scale = -scale;
  const r1 = a1.map((value) => value * scale), r2 = a2.map((value) => value * scale), t = a3.map((value) => value * scale);
  const r3 = cross(r1, r2);
  const r = orthonormalise([r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]]);
  return { r, t };
}

/** Converts a computer-vision pose to a column-major OpenGL/Three.js model-view matrix (Y up, Z backward). */
export function glPoseFromCv({ r, t }: CvPose): Float64Array {
  return Float64Array.from([
    r[0], -r[3], -r[6], 0,
    r[1], -r[4], -r[7], 0,
    r[2], -r[5], -r[8], 0,
    t[0], -t[1], -t[2], 1,
  ]);
}

/**
 * Target pose from a plane-to-image homography, as a column-major 4×4 OpenGL/Three.js model-view
 * matrix (camera looks down −Z, +Y up), ready to use as a scene anchor. This is the closed-form
 * estimate only; {@link ImageTargetDetector} additionally refines it against the matched points.
 */
export function poseFromHomography(planeToImage: Matrix3, intrinsics: CameraIntrinsics): Float64Array {
  return glPoseFromCv(cvPoseFromHomography(planeToImage, intrinsics));
}

/** Column-major OpenGL projection for a pinhole camera; image y grows downward, principal point may be off-centre. */
export function projectionFromIntrinsics(camera: CameraIntrinsics & { readonly width: number; readonly height: number }, near: number, far: number): Float64Array {
  const left = (-camera.cx * near) / camera.fx;
  const right = ((camera.width - camera.cx) * near) / camera.fx;
  const top = (camera.cy * near) / camera.fy;
  const bottom = (-(camera.height - camera.cy) * near) / camera.fy;
  return Float64Array.from([
    (2 * near) / (right - left), 0, 0, 0,
    0, (2 * near) / (top - bottom), 0, 0,
    (right + left) / (right - left), (top + bottom) / (top - bottom), -(far + near) / (far - near), -1,
    0, 0, (-2 * far * near) / (far - near), 0,
  ]);
}
