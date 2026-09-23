import { defineConfig } from 'vite';

// Relative base so the static build works on any host path (Vercel root, subfolders, file previews).
export default defineConfig({
  base: './',
  build: { outDir: 'site', emptyOutDir: true, target: 'es2022' },
  server: { port: 5173 },
});
