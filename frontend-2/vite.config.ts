import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/upload':  'http://localhost:8080',
      '/stream':  'http://localhost:8080',
      '/session': 'http://localhost:8080',
      '/health':  'http://localhost:8080',
    },
  },
  build: {
    outDir: '../backend/static_v2',
    emptyOutDir: true,
  },
});
