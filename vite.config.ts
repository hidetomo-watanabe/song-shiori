import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [preact()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  // ローカル開発時は API（wrangler dev）へ中継する。
  // 同じサイトへの GET にはブラウザが Origin を付けないので、API の呼び出し元の確認（ALLOWED_ORIGINS）に通るよう中継で付ける
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, headers: { Origin: 'http://localhost:5173' } } } },
  test: { root: '.', include: ['test/**/*.test.ts'] },
});
