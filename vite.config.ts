import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const vmAllowedHosts = ['10.65.39.163', 'celvpvm05798.us.oracle.com'];

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: vmAllowedHosts,
    proxy: {
      '/ollama': {
        target: 'http://localhost:11435',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: vmAllowedHosts,
    proxy: {
      '/ollama': {
        target: 'http://localhost:11435',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
