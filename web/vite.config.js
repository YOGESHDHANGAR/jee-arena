import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/media': 'http://localhost:4000',
      '/ads.txt': 'http://localhost:4000',
      '/robots.txt': 'http://localhost:4000',
      '^/sitemap.*\\.xml$': 'http://localhost:4000',
    },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: { katex: ['katex'], react: ['react', 'react-dom', 'react-router-dom'] } },
    },
  },
});
