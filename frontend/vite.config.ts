import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = Number(process.env.BACKEND_PORT) || 3001;
const backendOrigin = process.env.BACKEND_ORIGIN || `http://localhost:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': backendOrigin,
      '/uploads': backendOrigin,
      '/renderer.html': backendOrigin,
      '/pixi.min.js': backendOrigin,
      '/gsap.min.js': backendOrigin,
      '/timeline-runtime.js': backendOrigin,
      '/ws': { target: backendOrigin.replace('http://', 'ws://').replace('https://', 'wss://'), ws: true }
    }
  }
});