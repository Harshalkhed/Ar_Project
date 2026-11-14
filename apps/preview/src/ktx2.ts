import type { WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

/**
 * KTX2 textures transcode to whatever compressed format this GPU supports, so support is detected on
 * the page's own WebGL context. With no transcoder path set, three's loader finds its Basis transcoder
 * (JS + WASM) next to itself via `import.meta.url`, which Vite bundles and serves; it is only fetched
 * when a KTX2 texture is actually loaded.
 */
export function createKtx2Loader(gl: WebGLRenderer): KTX2Loader {
  return new KTX2Loader().detectSupport(gl);
}
