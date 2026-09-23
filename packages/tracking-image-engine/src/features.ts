import { blur, resize, type GrayImage } from './image.js';
import { seededRandom } from './random.js';

export interface Corner {
  /** Integer pixel used for description/orientation sampling. */
  readonly x: number;
  readonly y: number;
  /** Sub-pixel refined position (quadratic fit on the score surface), for geometry (homography, pose). */
  readonly subX: number;
  readonly subY: number;
  readonly score: number;
}

/** 1D quadratic peak offset from three samples around a maximum, clamped to a half pixel. */
function subpixelOffset(before: number, center: number, after: number): number {
  const denominator = before - 2 * center + after;
  if (denominator === 0) return 0;
  const offset = (0.5 * (before - after)) / denominator;
  return Math.max(-0.5, Math.min(0.5, offset));
}

export interface CornerOptions {
  /** Minimum intensity difference from the centre pixel. */
  threshold: number;
  maxCorners: number;
  /** Pixels to skip at each border (at least the circle radius, 3). */
  margin?: number;
}

/** Bresenham circle of radius 3 used by FAST, in contiguous order. */
const CIRCLE: readonly (readonly [number, number])[] = [
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
];
const ARC_LENGTH = 9;

/** FAST-9 segment test; returns a score (> 0) for corners, 0 otherwise. */
function fastScore(image: GrayImage, x: number, y: number, threshold: number, offsets: Int32Array): number {
  const { data, width } = image;
  const centre = data[y * width + x];
  const index = y * width + x;
  let brighterRun = 0, darkerRun = 0, bestBrighter = 0, bestDarker = 0;
  // Walk the circle twice so runs that wrap around are counted.
  for (let step = 0; step < 32; step += 1) {
    const value = data[index + offsets[step & 15]];
    if (value > centre + threshold) { brighterRun += 1; darkerRun = 0; }
    else if (value < centre - threshold) { darkerRun += 1; brighterRun = 0; }
    else { brighterRun = 0; darkerRun = 0; }
    if (brighterRun > bestBrighter) bestBrighter = brighterRun;
    if (darkerRun > bestDarker) bestDarker = darkerRun;
  }
  if (bestBrighter < ARC_LENGTH && bestDarker < ARC_LENGTH) return 0;
  const brighter = bestBrighter >= ARC_LENGTH;
  let score = 0;
  for (let k = 0; k < 16; k += 1) {
    const difference = data[index + offsets[k]] - centre;
    if (brighter && difference > threshold) score += difference - threshold;
    else if (!brighter && -difference > threshold) score += -difference - threshold;
  }
  return score;
}

/** FAST-9 corners with 3×3 non-maximum suppression, strongest first. */
export function detectCorners(image: GrayImage, options: CornerOptions): Corner[] {
  const { width, height } = image;
  const margin = Math.max(3, options.margin ?? 3);
  const offsets = new Int32Array(16);
  CIRCLE.forEach(([dx, dy], k) => { offsets[k] = dy * width + dx; });
  const scores = new Float32Array(width * height);
  for (let y = margin; y < height - margin; y += 1) {
    for (let x = margin; x < width - margin; x += 1) scores[y * width + x] = fastScore(image, x, y, options.threshold, offsets);
  }
  const corners: Corner[] = [];
  for (let y = margin; y < height - margin; y += 1) {
    for (let x = margin; x < width - margin; x += 1) {
      const score = scores[y * width + x];
      if (score <= 0) continue;
      let isMaximum = true;
      for (let dy = -1; dy <= 1 && isMaximum; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighbour = scores[(y + dy) * width + x + dx];
          // Ties go to the earlier pixel in scan order so plateaus keep exactly one corner.
          if (neighbour > score || (neighbour === score && (dy < 0 || (dy === 0 && dx < 0)))) { isMaximum = false; break; }
        }
      }
      if (isMaximum) {
        const dx = subpixelOffset(scores[y * width + x - 1], score, scores[y * width + x + 1]);
        const dy = subpixelOffset(scores[(y - 1) * width + x], score, scores[(y + 1) * width + x]);
        corners.push({ x, y, subX: x + dx, subY: y + dy, score });
      }
    }
  }
  corners.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  return corners.slice(0, options.maxCorners);
}

const ORIENTATION_RADIUS = 15;
const PATTERN_RADIUS = 13;
export const DESCRIPTOR_BYTES = 32;
/** Keypoints closer than this to a border cannot be oriented and described. */
export const FEATURE_MARGIN = ORIENTATION_RADIUS + 1;

/**
 * 256 point pairs for the binary test, drawn once from an isotropic Gaussian with a fixed seed.
 * This is our own pattern (not a published learned pattern); changing it invalidates compiled targets,
 * so it is versioned together with the compiled-target format.
 */
const PATTERN: Int8Array = (() => {
  const random = seededRandom(0x1a9e7);
  const sigma = 31 / 5;
  const gaussian = (): number => {
    for (;;) {
      const u = 1 - random();
      const v = random();
      const value = Math.round(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma);
      if (Math.abs(value) <= PATTERN_RADIUS) return value;
    }
  };
  const pattern = new Int8Array(DESCRIPTOR_BYTES * 8 * 4);
  for (let index = 0; index < pattern.length; index += 2) {
    let x: number, y: number;
    do { x = gaussian(); y = gaussian(); } while (x * x + y * y > PATTERN_RADIUS * PATTERN_RADIUS);
    pattern[index] = x;
    pattern[index + 1] = y;
  }
  return pattern;
})();

const ROW_EXTENT: Int32Array = (() => {
  const extent = new Int32Array(ORIENTATION_RADIUS + 1);
  for (let dy = 0; dy <= ORIENTATION_RADIUS; dy += 1) extent[dy] = Math.floor(Math.sqrt(ORIENTATION_RADIUS * ORIENTATION_RADIUS - dy * dy));
  return extent;
})();

/** Intensity-centroid orientation over a disc of radius 15, in radians. */
function orientation(image: GrayImage, x: number, y: number): number {
  const { data, width } = image;
  let m10 = 0, m01 = 0;
  for (let dy = -ORIENTATION_RADIUS; dy <= ORIENTATION_RADIUS; dy += 1) {
    const extent = ROW_EXTENT[Math.abs(dy)];
    const row = (y + dy) * width + x;
    for (let dx = -extent; dx <= extent; dx += 1) {
      const value = data[row + dx];
      m10 += dx * value;
      m01 += dy * value;
    }
  }
  return Math.atan2(m01, m10);
}

/** Steered binary descriptor: pattern rotated by the keypoint angle, sampled on a smoothed image. */
function describe(smoothed: GrayImage, x: number, y: number, angle: number): Uint8Array {
  const { data, width } = smoothed;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const descriptor = new Uint8Array(DESCRIPTOR_BYTES);
  for (let bit = 0; bit < DESCRIPTOR_BYTES * 8; bit += 1) {
    const p = bit * 4;
    const ax = Math.round(PATTERN[p] * cos - PATTERN[p + 1] * sin), ay = Math.round(PATTERN[p] * sin + PATTERN[p + 1] * cos);
    const bx = Math.round(PATTERN[p + 2] * cos - PATTERN[p + 3] * sin), by = Math.round(PATTERN[p + 2] * sin + PATTERN[p + 3] * cos);
    if (data[(y + ay) * width + x + ax] < data[(y + by) * width + x + bx]) descriptor[bit >> 3] |= 1 << (bit & 7);
  }
  return descriptor;
}

export interface Feature {
  /** Continuous level-0 pixel coordinates (pixel centres at +0.5). */
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly level: number;
  readonly descriptor: Uint8Array;
}

export interface FeatureOptions {
  maxFeatures: number;
  levels: number;
  /** Size ratio between consecutive pyramid levels. */
  scaleFactor: number;
  threshold: number;
}

/** Detects, orients and describes features over an image pyramid. */
export function extractFeatures(image: GrayImage, options: FeatureOptions): Feature[] {
  const scales = Array.from({ length: options.levels }, (_, level) => options.scaleFactor ** level);
  const totalArea = scales.reduce((sum, scale) => sum + scale * scale, 0);
  const features: Feature[] = [];
  let levelImage = image;
  for (let index = 0; index < scales.length; index += 1) {
    const scale = scales[index];
    if (levelImage.width <= 2 * FEATURE_MARGIN || levelImage.height <= 2 * FEATURE_MARGIN) break;
    const budget = Math.max(1, Math.round((options.maxFeatures * scale * scale) / totalArea));
    const corners = detectCorners(levelImage, { threshold: options.threshold, maxCorners: budget, margin: FEATURE_MARGIN });
    const smoothed = blur(blur(levelImage));
    for (const corner of corners) {
      const angle = orientation(levelImage, corner.x, corner.y);
      features.push({ x: (corner.subX + 0.5) / scale, y: (corner.subY + 0.5) / scale, angle, level: index, descriptor: describe(smoothed, corner.x, corner.y, angle) });
    }
    // resize() maps coordinates by the exact factor, so level k is exactly scaleFactor^k of level 0.
    if (index + 1 < scales.length) levelImage = resize(blur(levelImage), options.scaleFactor);
  }
  return features;
}
