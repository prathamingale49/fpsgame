import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: '../assets/public',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/matchmake': 'http://localhost:2567', '/api': 'http://localhost:2567' } },
});
