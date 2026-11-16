/**
 * 应用组装层。刻意分成两个函数：
 *
 *  - createApiApp()：只有 API。不碰文件系统、不依赖 Vite，测试可以毫秒级起停；
 *  - createApp({ staticDir })：API + 静态托管 + SPA 回退，用于生产模式。
 *
 * 为什么不把这段写在 main.ts 里：入口文件一旦混入装配逻辑，就只能靠「起服务再手点」
 * 来验证；抽出来之后，静态托管、SPA 回退、API 优先级都能用 HTTP 断言覆盖。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { ApiErrorCode } from '../contracts/index';
import { createApiRouter } from './api';

export interface AppOptions {
  /** 前端构建产物目录。给了就挂静态托管 + SPA 回退。 */
  readonly staticDir?: string;
}

export function createApiApp(): Express {
  const app = express();

  // 不暴露 Express 指纹：这是交付给外部看的服务，少一条可被扫描的信息
  app.disable('x-powered-by');

  // /api/generate 只收一个小 JSON，32kb 足够，顺便挡住明显的超大请求
  app.use(express.json({ limit: '32kb' }));

  app.use('/api', createApiRouter());

  // 已知路由之后仍然落到 /api 的请求，说明接口不存在。
  // 返回 JSON 而不是 HTML：前端统一按 JSON 解析错误，不用为 404 单独写分支。
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `未知接口 ${req.method} ${req.originalUrl}`,
      },
    });
  });

  // express.json() 抛出的一切错误（非法 JSON、超体积）都要转成统一信封。
  // 不加这层的话 Express 会返回 HTML 错误页，前端 JSON.parse 得到的是语法错误，
  // 真正的原因（比如请求体损坏）就被掩盖了。
  app.use('/api', (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = httpStatusOf(error);
    const code: ApiErrorCode = status === 413 ? 'TOO_LONG' : status === 400 ? 'INVALID_BODY' : 'INTERNAL';
    if (status >= 500) {
      console.error('[api] 未处理的服务端错误:', error);
    }
    res.status(status).json({
      error: {
        code,
        message: messageOf(error, status),
      },
    });
  });

  return app;
}

export function createApp(options: AppOptions = {}): Express {
  const app = createApiApp();
  if (options.staticDir) {
    mountStatic(app, options.staticDir);
  }
  return app;
}

/** 静态托管 + SPA 回退。API 已在上游处理完，这里只接非 /api 的 GET。 */
export function mountStatic(app: Express, staticDir: string): void {
  const indexHtml = path.join(staticDir, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`静态目录中没有 index.html：${indexHtml}（请先执行 npm run build）`);
  }

  app.use(express.static(staticDir));

  app.use((req, res, next) => {
    // 只回退 GET，且不吞 API 路径：否则一个拼错的接口会返回 200 + 首页 HTML，
    // 前端拿到 HTML 去 JSON.parse 会得到一个莫名其妙的语法错误
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(indexHtml);
  });
}

function httpStatusOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    if (Number.isInteger(status) && status >= 400 && status < 600) {
      return status;
    }
  }
  return 500;
}

function messageOf(error: unknown, status: number): string {
  if (status === 413) return '请求体过大';
  if (status === 400) return '请求体不是合法的 JSON';
  if (error instanceof Error) return error.message;
  return '服务端内部错误';
}
