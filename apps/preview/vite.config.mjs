import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Relative base so the static build works on any host path (Vercel root, subfolders, file previews).
export default defineConfig({
  base: './',
  build: {
    outDir: 'site',
    emptyOutDir: true,
    target: 'es2022',
    // Multi-page build: 3D viewer, image-tracking AR test, WebXR room-placement test.
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ar: fileURLToPath(new URL('./ar.html', import.meta.url)),
        webxr: fileURLToPath(new URL('./webxr.html', import.meta.url)),
      },
    },
  },
  server: { port: 5173 },
});
