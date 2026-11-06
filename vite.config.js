import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5199, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
