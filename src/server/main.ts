/**
 * 单进程入口：一个 Express 端口同时提供页面与 API。
 *
 *   npm run dev    → Vite 以 middlewareMode 挂在 Express 后面：HMR 正常、端口只有一个、
 *                    前端 fetch('/api/...') 是同源请求，不需要 proxy 也不需要 CORS
 *   npm start      → 托管 npm run build 的产物，完全不加载 Vite
 *
 * 装配逻辑在 app.ts，这里只负责「选模式 + 监听端口」。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApiApp, createApp } from './app';
import { loadDotEnv } from './env';

// 显式 --production 参数优先：Windows 下 `NODE_ENV=production npm start` 这种写法不成立，
// 用参数就不用引入 cross-env 之类只为跨平台服务的依赖
const isProduction = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 5173);

// src/server/main.ts → 项目根
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const webRoot = path.join(projectRoot, 'src', 'web');
const webDist = path.join(projectRoot, 'dist', 'web');

async function main(): Promise<void> {
  // 先读 .env：LLM 是否启用取决于 LLM_API_KEY 是否存在（缺失就不启用，功能不受影响）
  loadDotEnv();

  let app = isProduction ? createApp({ staticDir: webDist }) : createApiApp();

  if (!isProduction) {
    // 动态 import：生产模式完全不加载 Vite（也不会因为它是 devDependency 而出问题）
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: webRoot,
      appType: 'spa',
      server: { middlewareMode: true },
    });
    app.use(vite.middlewares);
  }

  app.listen(port, () => {
    const mode = isProduction ? 'production' : 'development';
    console.log(`[server] ${mode}  http://localhost:${port}`);
    console.log(`[server] health  http://localhost:${port}/api/health`);
  });
}

main().catch((error: unknown) => {
  console.error('[server] 启动失败:', error);
  process.exitCode = 1;
});
