/**
 * 骨架阶段唯一真实的接口。
 *
 * 它存在的意义不是「健康检查」这个功能本身，而是证明三件事：
 *  1. 页面和 API 同源同端口（前端可以直接 fetch 相对路径，不需要 CORS 配置）；
 *  2. 服务端能读到契约版本（contracts 是唯一事实源，不是硬编码的字符串）；
 *  3. 集成测试可以不起真实端口地验证路由（createApiApp 不绑定端口）。
 */

import { Router } from 'express';

import { CONTRACT_VERSION } from '../contracts/index';

export interface HealthPayload {
  readonly ok: true;
  readonly service: string;
  readonly contractVersion: string;
  readonly uptimeSec: number;
  readonly now: string;
}

export const SERVICE_NAME = 'feixiang-classroom-demo';

export function createApiRouter(): Router {
  const router = Router();
  const startedAt = Date.now();

  router.get('/health', (_req, res) => {
    const payload: HealthPayload = {
      ok: true,
      service: SERVICE_NAME,
      contractVersion: CONTRACT_VERSION,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      now: new Date().toISOString(),
    };
    res.json(payload);
  });

  return router;
}
