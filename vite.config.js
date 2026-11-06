import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  server: { port: 5199, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), widget: resolve(import.meta.dirname, 'widget.html') },
    },
  },
});
