import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/fonts': 'http://localhost:3001',
      '/renderer.html': 'http://localhost:3001',
      '/pixi.min.js':   'http://localhost:3001',
      '/gsap.min.js':   'http://localhost:3001',
      '/timeline-runtime.js': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true }
    }
  }
});