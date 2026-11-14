import type { Point } from './homography.js';
import { blur, resize, type GrayImage } from './image.js';

export interface FlowOptions {
  /** Half-size of the square matching window, in pixels at each pyramid level. */
  windowRadius: number;
  /** Gauss-Newton iterations per pyramid level. */
  iterations: number;
  /** Smallest eigenvalue of the window's gradient matrix, per pixel; below it the patch is too flat to track. */
  minEigenvalue: number;
  /** A point must track forward and then back to within this many pixels of where it started. */
  maxForwardBackwardError: number;
}

export const DEFAULT_FLOW_OPTIONS: FlowOptions = { windowRadius: 7, iterations: 10, minEigenvalue: 4, maxForwardBackwardError: 1 };

/** Level 0 is the image itself; each further level is blurred and halved. */
export function buildPyramid(image: GrayImage, levels: number): GrayImage[] {
  const pyramid = [image];
  while (pyramid.length < levels) {
    const previous = pyramid[pyramid.length - 1];
    if (Math.min(previous.width, previous.height) < 16) break;
    pyramid.push(resize(blur(previous), 0.5));
  }
  return pyramid;
}

function sample({ width, height, data }: GrayImage, x: number, y: number): number {
  const cx = x < 0 ? 0 : x > width - 1 ? width - 1 : x;
  const cy = y < 0 ? 0 : y > height - 1 ? height - 1 : y;
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const fx = cx - x0, fy = cy - y0;
  const top = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx;
  const bottom = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** One point, coarse to fine (Bouguet's pyramidal Lucas-Kanade). Returns its position in `to`, or null if lost. */
function trackPoint(from: readonly GrayImage[], to: readonly GrayImage[], [px, py]: Point, options: FlowOptions): Point | null {
  const r = options.windowRadius;
  const count = (2 * r + 1) ** 2;
  let gx = 0, gy = 0; // Displacement guess carried down from coarser levels.
  for (let level = from.length - 1; level >= 0; level -= 1) {
    const prev = from[level], next = to[level];
    const scale = 2 ** -level;
    const x = px * scale, y = py * scale;
    // Window gradients and template are fixed for this level; only the displacement iterates.
    const ix = new Float64Array(count), iy = new Float64Array(count), template = new Float64Array(count);
    let gxx = 0, gxy = 0, gyy = 0, k = 0;
    for (let wy = -r; wy <= r; wy += 1) {
      for (let wx = -r; wx <= r; wx += 1, k += 1) {
        const sx = x + wx, sy = y + wy;
        ix[k] = (sample(prev, sx + 1, sy) - sample(prev, sx - 1, sy)) / 2;
        iy[k] = (sample(prev, sx, sy + 1) - sample(prev, sx, sy - 1)) / 2;
        template[k] = sample(prev, sx, sy);
        gxx += ix[k] * ix[k];
        gxy += ix[k] * iy[k];
        gyy += iy[k] * iy[k];
      }
    }
    const det = gxx * gyy - gxy * gxy;
    const minEigen = (gxx + gyy - Math.sqrt((gxx - gyy) ** 2 + 4 * gxy * gxy)) / 2 / count;
    if (minEigen < options.minEigenvalue || det <= 0) return null;
    let vx = 0, vy = 0;
    for (let iteration = 0; iteration < options.iterations; iteration += 1) {
      let bx = 0, by = 0;
      k = 0;
      for (let wy = -r; wy <= r; wy += 1) {
        for (let wx = -r; wx <= r; wx += 1, k += 1) {
          const diff = template[k] - sample(next, x + wx + gx + vx, y + wy + gy + vy);
          bx += diff * ix[k];
          by += diff * iy[k];
        }
      }
      const dx = (gyy * bx - gxy * by) / det, dy = (gxx * by - gxy * bx) / det;
      vx += dx;
      vy += dy;
      if (dx * dx + dy * dy < 1e-4) break;
    }
    gx += vx;
    gy += vy;
    if (level > 0) {
      gx *= 2;
      gy *= 2;
    }
  }
  const nx = px + gx, ny = py + gy;
  const { width, height } = to[0];
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < 0 || ny < 0 || nx > width - 1 || ny > height - 1) return null;
  return [nx, ny];
}

/**
 * Tracks points from one frame to the next. Each point is also tracked back to the first frame and
 * dropped if it does not return close to where it started, which rejects occlusions and drift.
 */
export function trackPoints(from: readonly GrayImage[], to: readonly GrayImage[], points: readonly Point[], options: Partial<FlowOptions> = {}): (Point | null)[] {
  const resolved = { ...DEFAULT_FLOW_OPTIONS, ...options };
  const limit = resolved.maxForwardBackwardError ** 2;
  return points.map((point) => {
    const forward = trackPoint(from, to, point, resolved);
    if (!forward) return null;
    const back = trackPoint(to, from, forward, resolved);
    if (!back || (back[0] - point[0]) ** 2 + (back[1] - point[1]) ** 2 > limit) return null;
    return forward;
  });
}
