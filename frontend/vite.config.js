import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/Elena/',
  build: {
    outDir: '../docs',
    emptyOutDir: true
  }
});
