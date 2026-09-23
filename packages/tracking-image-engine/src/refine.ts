import { solveLinear } from './homography.js';
import type { CameraIntrinsics, CvPose } from './pose.js';

export interface PointCorrespondence {
  /** Target-plane point (Z = 0): origin at the target centre, +X right, +Y up, 1 unit = target width. */
  readonly plane: readonly [number, number];
  /** Observed frame pixel the plane point matched to. */
  readonly image: readonly [number, number];
}

const multiplyMatrixVector = (m: readonly number[], v: readonly number[]): number[] => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

const multiplyMatrixMatrix = (a: readonly number[], b: readonly number[]): number[] => {
  const out = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) for (let k = 0; k < 3; k += 1) out[row * 3 + col] += a[row * 3 + k] * b[k * 3 + col];
  return out;
};

/** Rodrigues' formula: rotation matrix for a small axis-angle vector (row-major 3×3). */
function rodrigues(w: readonly [number, number, number]): number[] {
  const theta = Math.hypot(w[0], w[1], w[2]);
  const cross = [0, -w[2], w[1], w[2], 0, -w[0], -w[1], w[0], 0];
  if (theta < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1].map((value, index) => value + cross[index]);
  const k = w.map((value) => value / theta);
  const K = [0, -k[2], k[1], k[2], 0, -k[0], -k[1], k[0], 0];
  const K2 = multiplyMatrixMatrix(K, K);
  const sinT = Math.sin(theta), cosT = 1 - Math.cos(theta);
  return [1, 0, 0, 0, 1, 0, 0, 0, 1].map((value, index) => value + sinT * K[index] + cosT * K2[index]);
}

/** [v]_x, the skew-symmetric cross-product matrix. */
const skew = (v: readonly number[]): number[] => [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];

export interface RefineOptions { iterations: number; }

/**
 * Gauss-Newton refinement of a rigid pose against 2D point correspondences, minimizing reprojection
 * error directly (the physically correct 6-DOF model) rather than relying on an unconstrained 8-DOF
 * homography fit. The closed-form homography-based pose is normally within its capture range.
 */
export function refinePose(initial: CvPose, correspondences: readonly PointCorrespondence[], intrinsics: CameraIntrinsics, options: RefineOptions): CvPose {
  const { fx, fy, cx, cy } = intrinsics;
  let r = initial.r.slice();
  let t = initial.t.slice();
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const JtJ = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
    const Jtr = new Array<number>(6).fill(0);
    for (const { plane, image } of correspondences) {
      const point = [plane[0], plane[1], 0];
      const camera = multiplyMatrixVector(r, point).map((value, index) => value + t[index]);
      const [xc, yc, zc] = camera;
      if (zc <= 1e-6) continue;
      const predictedU = fx * (xc / zc) + cx, predictedV = fy * (yc / zc) + cy;
      const residualU = predictedU - image[0], residualV = predictedV - image[1];
      // d(Pc)/d(dw) = -R·[P]_x (left-multiplicative rotation perturbation), d(Pc)/d(dt) = I.
      const dPcDw = multiplyMatrixMatrix(r, skew(point)).map((value) => -value);
      const dUdPc = [fx / zc, 0, (-fx * xc) / (zc * zc)];
      const dVdPc = [0, fy / zc, (-fy * yc) / (zc * zc)];
      const rowU = [0, 1, 2].map((k) => dUdPc[0] * dPcDw[k] + dUdPc[1] * dPcDw[3 + k] + dUdPc[2] * dPcDw[6 + k]).concat(dUdPc);
      const rowV = [0, 1, 2].map((k) => dVdPc[0] * dPcDw[k] + dVdPc[1] * dPcDw[3 + k] + dVdPc[2] * dPcDw[6 + k]).concat(dVdPc);
      for (const [row, residual] of [[rowU, residualU], [rowV, residualV]] as const) {
        for (let i = 0; i < 6; i += 1) {
          Jtr[i] += row[i] * residual;
          for (let j = 0; j < 6; j += 1) JtJ[i][j] += row[i] * row[j];
        }
      }
    }
    for (let i = 0; i < 6; i += 1) JtJ[i][i] += 1e-9; // Tiny damping guards against a singular system.
    const delta = solveLinear(JtJ, Jtr.map((value) => -value));
    if (!delta) break;
    // Right-multiplicative update (R' = R·Exp(dw)), matching the Jacobian derived above.
    r = multiplyMatrixMatrix(r, rodrigues(delta.slice(0, 3) as [number, number, number]));
    t = t.map((value, index) => value + delta[3 + index]);
    if (Math.hypot(...delta) < 1e-10) break;
  }
  return { r, t };
}
