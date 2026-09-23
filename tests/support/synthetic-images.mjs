// Deterministic synthetic images for engine tests. A textured "poster" is rendered, then
// projected into a camera frame through a known pose so tests can check what the detector recovers.

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** High-contrast random rectangles and discs: corner-rich like a real poster. */
export function texturedImage(width, height, seed, shapes = 140) {
  const random = seededRandom(seed);
  const data = new Uint8Array(width * height).fill(128);
  for (let index = 0; index < shapes; index += 1) {
    const value = Math.floor(random() * 256);
    const cx = random() * width;
    const cy = random() * height;
    const size = 4 + random() * Math.min(width, height) * 0.18;
    const isDisc = random() < 0.35;
    const aspect = 0.4 + random() * 1.2;
    for (let y = Math.max(0, Math.floor(cy - size)); y < Math.min(height, Math.ceil(cy + size)); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - size * aspect)); x < Math.min(width, Math.ceil(cx + size * aspect)); x += 1) {
        const dx = (x - cx) / aspect;
        const dy = y - cy;
        if (isDisc && dx * dx + dy * dy > size * size) continue;
        data[y * width + x] = value;
      }
    }
  }
  return { width, height, data };
}

export function smoothBackground(width, height) {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data[y * width + x] = 90 + Math.round((40 * x) / width + (20 * y) / height);
  return { width, height, data };
}

/** 3x3 row-major multiply. */
export function multiply3(a, b) {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) for (let k = 0; k < 3; k += 1) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export function applyHomography(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Rotation (row-major 3x3) from Euler angles in radians, applied X then Y then Z. */
export function rotation(rx, ry, rz) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  const X = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Y = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Z = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return multiply3(Z, multiply3(Y, X));
}

/**
 * Plane-to-image homography for a pose in computer-vision camera axes (x right, y down, z forward).
 * Target plane coordinates: origin at centre, +X right, +Y up, 1 unit = target width.
 */
export function planeHomography(intrinsics, rotationCv, translationCv) {
  const { fx, fy, cx, cy } = intrinsics;
  const K = [fx, 0, cx, 0, fy, cy, 0, 0, 1];
  const R = rotationCv;
  const Rt = [R[0], R[1], translationCv[0], R[3], R[4], translationCv[1], R[6], R[7], translationCv[2]];
  return multiply3(K, Rt);
}

/** Maps target plane coordinates to target pixel coordinates (v grows downward). */
export function planeToTargetPixels(target) {
  return [target.width, 0, target.width / 2, 0, -target.width, target.height / 2, 0, 0, 1];
}

/** Renders `target` into a copy of `background` through `targetPixelsToFrame` (bilinear, inverse mapping). */
export function warpInto(background, target, targetPixelsToFrame) {
  const out = { width: background.width, height: background.height, data: Uint8Array.from(background.data) };
  const inverse = invert3(targetPixelsToFrame);
  for (let y = 0; y < out.height; y += 1) {
    for (let x = 0; x < out.width; x += 1) {
      const [u, v] = applyHomography(inverse, x + 0.5, y + 0.5);
      const su = u - 0.5, sv = v - 0.5;
      if (su < 0 || sv < 0 || su > target.width - 1 || sv > target.height - 1) continue;
      const x0 = Math.floor(su), y0 = Math.floor(sv), x1 = Math.min(x0 + 1, target.width - 1), y1 = Math.min(y0 + 1, target.height - 1);
      const fx = su - x0, fy = sv - y0;
      const p = (xx, yy) => target.data[yy * target.width + xx];
      const value = (1 - fy) * ((1 - fx) * p(x0, y0) + fx * p(x1, y0)) + fy * ((1 - fx) * p(x0, y1) + fx * p(x1, y1));
      out.data[y * out.width + x] = Math.round(value);
    }
  }
  return out;
}

/** Builds a frame showing `target` at a known CV-axes pose; returns the frame and ground truth. */
export function sceneWithTarget({ target, intrinsics, frameWidth, frameHeight, rotationCv, translationCv }) {
  const plane = planeHomography(intrinsics, rotationCv, translationCv);
  const targetPixelsToFrame = multiply3(plane, invert3(planeToTargetPixels(target)));
  const frame = warpInto(smoothBackground(frameWidth, frameHeight), target, targetPixelsToFrame);
  return { frame, planeToFrame: plane, targetPixelsToFrame };
}
