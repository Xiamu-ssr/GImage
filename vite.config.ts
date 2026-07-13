import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  css: {
    // PostCSS 配置不与 Vite 的 frontend root 同级，显式指定避免 Tailwind 工具类被遗漏。
    postcss: './postcss.config.cjs',
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
