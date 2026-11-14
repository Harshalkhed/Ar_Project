#!/usr/bin/env node
// Placeholder wall-art model for testing wall placement: a framed picture, built as a GLB by hand
// (no dependencies). Real-size, in metres: 62 × 82 cm frame, 56 × 76 cm canvas, 3 cm deep.
// Wall convention (see PlacementSurface in packages/project-schema): the picture faces +Z, +Y is up,
// and the origin is the centre of its back, so it hangs flat against the wall at the anchor point.
// The artwork is our own generated abstract image (scripts/generate-target-image.mjs).
//
//   node scripts/generate-wall-art.mjs [out.glb]   (default: assets-src/projects/wall-art/assets/wall_art.glb)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? join(root, 'assets-src', 'projects', 'wall-art', 'assets', 'wall_art.glb');

const FRAME_W = 0.62, FRAME_H = 0.82, DEPTH = 0.03, BORDER = 0.03, CANVAS_Z = 0.02;

/** Axis-aligned box as 6 separate faces (flat normals). */
function box([x0, y0, z0], [x1, y1, z1], mesh) {
  const faces = [
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]],
    [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
  ];
  for (const [a, b, c, d, normal] of faces) quad([a, b, c, d], normal, mesh);
}

/** Counter-clockwise quad (seen from the side its normal points to). */
function quad(corners, normal, mesh, uvs = [[0, 1], [1, 1], [1, 0], [0, 0]]) {
  const start = mesh.positions.length / 3;
  corners.forEach((corner, i) => {
    mesh.positions.push(...corner);
    mesh.normals.push(...normal);
    mesh.uvs.push(...uvs[i]);
  });
  mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

const newMesh = () => ({ positions: [], normals: [], uvs: [], indices: [] });
const frame = newMesh();
const [hw, hh] = [FRAME_W / 2, FRAME_H / 2];
box([-hw, hh - BORDER, 0], [hw, hh, DEPTH], frame); // top
box([-hw, -hh, 0], [hw, -hh + BORDER, DEPTH], frame); // bottom
box([-hw, -hh + BORDER, 0], [-hw + BORDER, hh - BORDER, DEPTH], frame); // left
box([hw - BORDER, -hh + BORDER, 0], [hw, hh - BORDER, DEPTH], frame); // right
box([-hw + BORDER, -hh + BORDER, 0], [hw - BORDER, hh - BORDER, 0.004], frame); // backing board
const canvas = newMesh();
const [cw, ch] = [hw - BORDER, hh - BORDER];
quad([[-cw, -ch, CANVAS_Z], [cw, -ch, CANVAS_Z], [cw, ch, CANVAS_Z], [-cw, ch, CANVAS_Z]], [0, 0, 1], canvas);

// Artwork PNG at the canvas's aspect ratio (56 × 76 cm), from our own generator.
const work = mkdtempSync(join(tmpdir(), 'wall-art-'));
let png;
try {
  execFileSync(process.execPath, [join(root, 'scripts', 'generate-target-image.mjs'), join(work, 'art.png'), '560', '760', '11']);
  png = readFileSync(join(work, 'art.png'));
} finally {
  rmSync(work, { recursive: true, force: true });
}

// --- GLB assembly ---
const chunks = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];
function addView(bytes, target) {
  const padding = (4 - (byteLength % 4)) % 4;
  if (padding) chunks.push(Buffer.alloc(padding));
  byteLength += padding;
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}) });
  chunks.push(bytes);
  byteLength += bytes.length;
  return bufferViews.length - 1;
}
function addAccessor(values, type, componentType, target, withBounds = false) {
  const array = componentType === 5126 ? new Float32Array(values) : new Uint16Array(values);
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
  const accessor = { bufferView: addView(Buffer.from(array.buffer), target), componentType, count: values.length / size, type };
  if (withBounds) {
    accessor.min = [0, 1, 2].map((axis) => Math.min(...values.filter((_, i) => i % 3 === axis)));
    accessor.max = [0, 1, 2].map((axis) => Math.max(...values.filter((_, i) => i % 3 === axis)));
  }
  accessors.push(accessor);
  return accessors.length - 1;
}
const primitive = (mesh, material) => ({
  attributes: {
    POSITION: addAccessor(mesh.positions, 'VEC3', 5126, 34962, true),
    NORMAL: addAccessor(mesh.normals, 'VEC3', 5126, 34962),
    TEXCOORD_0: addAccessor(mesh.uvs, 'VEC2', 5126, 34962),
  },
  indices: addAccessor(mesh.indices, 'SCALAR', 5123, 34963),
  material,
});
const primitives = [primitive(frame, 0), primitive(canvas, 1)];
const imageView = addView(png);

const gltf = {
  asset: { version: '2.0', generator: 'internal-webar scripts/generate-wall-art.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'WallArt', mesh: 0 }],
  meshes: [{ name: 'WallArt', primitives }],
  materials: [
    { name: 'Frame', pbrMetallicRoughness: { baseColorFactor: [0.09, 0.07, 0.06, 1], metallicFactor: 0, roughnessFactor: 0.55 } },
    { name: 'Canvas', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 } },
  ],
  textures: [{ source: 0, sampler: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  images: [{ bufferView: imageView, mimeType: 'image/png' }],
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};

const pad = (buffer, fill) => Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4, fill)]);
const json = pad(Buffer.from(JSON.stringify(gltf)), 0x20);
const bin = pad(Buffer.concat(chunks), 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const chunkHeader = (length, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(length, 0);
  h.writeUInt32LE(type, 4);
  return h;
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, chunkHeader(json.length, 0x4e4f534a), json, chunkHeader(bin.length, 0x004e4942), bin]));
console.log(`Wrote ${out} (${(12 + 16 + json.length + bin.length).toLocaleString()} bytes)`);
