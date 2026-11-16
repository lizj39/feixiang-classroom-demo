import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * 前端产物落在 dist/web，与 Node 服务端的 dist 分开。
 * 开发时不走这个配置：dev 由 Express 以 middlewareMode 挂载 Vite，
 * 这样一个端口就能同时给出页面与 /api，省掉 proxy 与 CORS。
 */
export default defineConfig({
  root: fileURLToPath(new URL('./src/web', import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    // 交付物要能排查问题，保留 sourcemap 但不开到最小体积
    sourcemap: true,
  },
});
