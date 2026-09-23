/** 8-bit single-channel image, row-major. */
export interface GrayImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** BT.601 luma from RGBA pixels (e.g. `ImageData.data` from a camera frame). */
export function grayscaleFromRgba(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let index = 0; index < data.length; index += 1) {
    const offset = index * 4;
    data[index] = Math.round(0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2]);
  }
  return { width, height, data };
}

/** Separable [1 4 6 4 1] / 16 Gaussian with clamped borders. */
export function blur(image: GrayImage): GrayImage {
  const { width, height, data } = image;
  const horizontal = new Float32Array(width * height);
  const out = new Uint8Array(width * height);
  const clampX = (x: number): number => (x < 0 ? 0 : x >= width ? width - 1 : x);
  const clampY = (y: number): number => (y < 0 ? 0 : y >= height ? height - 1 : y);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = (data[row + clampX(x - 2)] + 4 * data[row + clampX(x - 1)] + 6 * data[row + x] + 4 * data[row + clampX(x + 1)] + data[row + clampX(x + 2)]) / 16;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = (horizontal[clampY(y - 2) * width + x] + 4 * horizontal[clampY(y - 1) * width + x] + 6 * horizontal[y * width + x] + 4 * horizontal[clampY(y + 1) * width + x] + horizontal[clampY(y + 2) * width + x]) / 16;
      out[y * width + x] = Math.round(value);
    }
  }
  return { width, height, data: out };
}

/** Bilinear resize by `scale` (< 1 shrinks), sampling pixel centres. Blur first when shrinking to limit aliasing. */
export function resize(image: GrayImage, scale: number): GrayImage {
  const width = Math.max(1, Math.floor(image.width * scale));
  const height = Math.max(1, Math.floor(image.height * scale));
  const data = new Uint8Array(width * height);
  const source = image.data;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(Math.max((y + 0.5) / scale - 0.5, 0), image.height - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, image.height - 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(Math.max((x + 0.5) / scale - 0.5, 0), image.width - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, image.width - 1);
      const fx = sx - x0;
      const top = source[y0 * image.width + x0] * (1 - fx) + source[y0 * image.width + x1] * fx;
      const bottom = source[y1 * image.width + x0] * (1 - fx) + source[y1 * image.width + x1] * fx;
      data[y * width + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return { width, height, data };
}
