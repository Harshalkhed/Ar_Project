import { seededRandom } from './random.js';

/** Row-major 3×3 matrix. */
export type Matrix3 = readonly number[];
export type Point = readonly [number, number];

export function multiply3(a: Matrix3, b: Matrix3): number[] {
  const out = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let k = 0; k < 3; k += 1) out[row * 3 + column] += a[row * 3 + k] * b[k * 3 + column];
    }
  }
  return out;
}

export function invert3(m: Matrix3): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const determinant = a * A + b * B + c * C;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  return [
    A / determinant, -(b * i - c * h) / determinant, (b * f - c * e) / determinant,
    B / determinant, (a * i - c * g) / determinant, -(a * f - c * d) / determinant,
    C / determinant, -(a * h - b * g) / determinant, (a * e - b * d) / determinant,
  ];
}

export function applyHomography(h: Matrix3, x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Similarity transform moving the centroid to 0 and the mean distance to √2 (Hartley normalisation). */
function normalisation(points: readonly Point[]): number[] | null {
  let cx = 0, cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  cx /= points.length;
  cy /= points.length;
  let mean = 0;
  for (const [x, y] of points) mean += Math.hypot(x - cx, y - cy);
  mean /= points.length;
  if (mean < 1e-12) return null;
  const s = Math.SQRT2 / mean;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

/** Solves `n` linear equations in place with partial pivoting; returns null when singular. */
export function solveLinear(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    if (Math.abs(matrix[pivot][column]) < 1e-12) return null;
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    [vector[column], vector[pivot]] = [vector[pivot], vector[column]];
    for (let row = column + 1; row < n; row += 1) {
      const factor = matrix[row][column] / matrix[column][column];
      for (let k = column; k < n; k += 1) matrix[row][k] -= factor * matrix[column][k];
      vector[row] -= factor * vector[column];
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = vector[row];
    for (let k = row + 1; k < n; k += 1) sum -= matrix[row][k] * solution[k];
    solution[row] = sum / matrix[row][row];
  }
  return solution;
}

/** Least-squares homography mapping `source` to `destination` (≥ 4 pairs), normalised DLT with h33 = 1. */
export function solveHomography(source: readonly Point[], destination: readonly Point[]): number[] | null {
  if (source.length < 4 || source.length !== destination.length) return null;
  const ts = normalisation(source), td = normalisation(destination);
  if (!ts || !td) return null;
  const normal = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const rhs = new Array<number>(8).fill(0);
  const accumulate = (row: readonly number[], value: number): void => {
    for (let i = 0; i < 8; i += 1) {
      rhs[i] += row[i] * value;
      for (let j = 0; j < 8; j += 1) normal[i][j] += row[i] * row[j];
    }
  };
  for (let index = 0; index < source.length; index += 1) {
    const [x, y] = applyHomography(ts, source[index][0], source[index][1]);
    const [u, v] = applyHomography(td, destination[index][0], destination[index][1]);
    accumulate([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    accumulate([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solveLinear(normal, rhs);
  if (!h) return null;
  const tdInverse = invert3(td);
  if (!tdInverse) return null;
  const result = multiply3(multiply3(tdInverse, [...h, 1]), ts);
  if (Math.abs(result[8]) < 1e-12 || !result.every(Number.isFinite)) return null;
  return result.map((value) => value / result[8]);
}

export interface RansacOptions {
  /** Maximum reprojection error, in destination pixels, for an inlier. */
  threshold: number;
  iterations: number;
  seed: number;
  /**
   * Final model fit uses only matches within this error (default threshold / 2), so loosely localised
   * features (e.g. from coarse pyramid levels) do not drag the model. Inliers are still counted at `threshold`.
   */
  refineThreshold?: number;
}

export interface HomographyEstimate { readonly homography: number[]; readonly inliers: number[]; }

function inliersOf(h: Matrix3, source: readonly Point[], destination: readonly Point[], threshold: number): number[] {
  const limit = threshold * threshold;
  const inliers: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const [x, y] = applyHomography(h, source[index][0], source[index][1]);
    const dx = x - destination[index][0], dy = y - destination[index][1];
    if (dx * dx + dy * dy <= limit) inliers.push(index);
  }
  return inliers;
}

/** RANSAC over minimal 4-point samples, then a least-squares refit on the consensus set. */
export function estimateHomography(source: readonly Point[], destination: readonly Point[], options: RansacOptions): HomographyEstimate | null {
  if (source.length < 4) return null;
  const random = seededRandom(options.seed);
  let best: number[] = [];
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const sample = new Set<number>();
    while (sample.size < 4) sample.add(Math.floor(random() * source.length));
    const indices = [...sample];
    const h = solveHomography(indices.map((i) => source[i]), indices.map((i) => destination[i]));
    if (!h) continue;
    const inliers = inliersOf(h, source, destination, options.threshold);
    if (inliers.length > best.length) best = inliers;
  }
  if (best.length < 4) return null;
  let homography = solveHomography(best.map((i) => source[i]), best.map((i) => destination[i]));
  if (!homography) return null;
  // Refit on progressively tighter consensus sets; keep a refit only if enough matches support it.
  const refineThreshold = options.refineThreshold ?? options.threshold / 2;
  for (const limit of [options.threshold, refineThreshold, refineThreshold]) {
    const support = inliersOf(homography, source, destination, limit);
    if (support.length < Math.max(8, best.length / 3)) break;
    const refined = solveHomography(support.map((i) => source[i]), support.map((i) => destination[i]));
    if (!refined) break;
    homography = refined;
  }
  const inliers = inliersOf(homography, source, destination, options.threshold);
  return inliers.length >= 4 ? { homography, inliers } : null;
}
