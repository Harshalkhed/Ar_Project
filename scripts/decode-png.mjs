// Minimal PNG decoder (8-bit, non-interlaced, truecolor/truecolor+alpha/grayscale) using only
// Node's built-in zlib. Used by check-target-trackability.mjs; not part of the shipped runtime.
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(path) {
  const buffer = readFileSync(path);
  let offset = 8;
  let width = 0, height = 0, channels = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`Only 8-bit PNGs are supported (got bit depth ${data[8]}).`);
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported.');
      channels = CHANNELS[data[9]];
      if (!channels) throw new Error(`Unsupported PNG color type ${data[9]}.`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * channels);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowStart + 1 + x];
      const a = x >= channels ? row[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0;
      row[x] = (value + predictor) & 0xff;
    }
    pixels.set(row, y * stride);
    previous = row;
  }
  return { width, height, channels, pixels };
}
