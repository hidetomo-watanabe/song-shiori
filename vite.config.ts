import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [preact()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  // ローカル開発時は API（wrangler dev）へ中継する。API_PROXY で中継先を変えられる（例：本番の API で確かめるとき）
  server: { proxy: { '/api': { target: process.env.API_PROXY ?? 'http://127.0.0.1:8787', changeOrigin: true } } },
  test: { root: '.', include: ['test/**/*.test.ts'] },
});
