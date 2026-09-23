#!/usr/bin/env node
// Generates a printable image-tracking target: a deterministic, high-contrast, asymmetric pattern
// (feature-rich, no rotational symmetry so orientation is unambiguous) as a standalone PNG encoder
// using only Node's built-in zlib — no image library dependency for a build-time asset.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function renderTarget(width, height, seed) {
  const rgb = new Uint8Array(width * height * 3).fill(255);
  const setPixel = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 3;
    rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
  };
  const fillRect = (x0, y0, w, h, color) => { for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) setPixel(x, y, color); };
  const fillDisc = (cx, cy, r, color) => { for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) if (x * x + y * y <= r * r) setPixel(cx + x, cy + y, color); };

  // Border, so a printed target has a clean edge and margin (recommended for detector robustness).
  const border = Math.round(Math.min(width, height) * 0.03);
  fillRect(0, 0, width, height, [20, 20, 24]);
  fillRect(border, border, width - 2 * border, height - 2 * border, [246, 244, 238]);

  const random = seededRandom(seed);
  const palette = [[20, 20, 24], [178, 34, 52], [24, 92, 156], [230, 168, 30], [40, 40, 40]];
  const innerX = border * 2, innerY = border * 2, innerW = width - 4 * border, innerH = height - 4 * border;
  for (let i = 0; i < 90; i += 1) {
    const color = palette[Math.floor(random() * palette.length)];
    const cx = innerX + random() * innerW, cy = innerY + random() * innerH;
    const size = 6 + random() * Math.min(innerW, innerH) * 0.11;
    if (random() < 0.4) fillDisc(Math.round(cx), Math.round(cy), Math.round(size), color);
    else fillRect(Math.round(cx - size), Math.round(cy - size * (0.4 + random())), Math.round(size * 2 * (0.5 + random())), Math.round(size * (0.6 + random())), color);
  }

  // Corner marks break any residual symmetry so orientation is always recoverable.
  fillRect(border, border, border * 2, border * 2, [178, 34, 52]);
  fillRect(width - border * 3, height - border * 3, border * 2, border * 2, [24, 92, 156]);
  return rgb;
}

function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0; // filter type: none
    rgb.copy?.(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const [, , outPath, widthArg, heightArg, seedArg] = process.argv;
if (!outPath) {
  console.error('Usage: node scripts/generate-target-image.mjs <out.png> [width=900] [height=1200] [seed=1]');
  process.exit(1);
}
const width = Number(widthArg) || 900;
const height = Number(heightArg) || 1200;
const seed = Number(seedArg) || 1;
const rgb = renderTarget(width, height, seed);
writeFileSync(outPath, encodePng(width, height, Buffer.from(rgb)));
console.log(`Wrote ${outPath} (${width}x${height})`);
