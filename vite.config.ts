import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [preact()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  // ローカル開発時は API（wrangler dev）へ中継する
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { root: '.', include: ['test/**/*.test.ts'] },
});
