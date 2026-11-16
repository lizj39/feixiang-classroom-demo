/**
 * API 路由。
 *
 * /api/health  —— 骨架自检（同源联通证明）
 * /api/generate —— 生成入口。P1-2 只做信封骨架：校验输入、回 requestId 与回声，
 *                  plan / courseware / trace / verification 一律 null。
 *
 * 为什么现在不返回课件：一旦这里返回写死的内容，后面接真路由时就分不清哪些是编的。
 * 有一条测试专门守着「这四个字段必须为 null」，等 P3 接上真实内容时再改那条断言。
 */

import { randomUUID } from 'node:crypto';

import { Router } from 'express';

import {
  API_VERSION,
  CONTRACT_VERSION,
  readUtterance,
  type GenerateResponse,
  type SkillsResponse,
} from '../contracts/index';
import { getSkillRegistry } from './skills/registry';

export interface HealthPayload {
  readonly ok: true;
  readonly service: string;
  readonly contractVersion: string;
  readonly uptimeSec: number;
  readonly now: string;
}

export const SERVICE_NAME = 'feixiang-classroom-demo';

export function newRequestId(): string {
  return `req_${randomUUID()}`;
}

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

  router.get('/skills', (_req, res) => {
    // 注册表按需创建：万一 manifest 有错，这里会抛 SkillRegistryError，
    // 由 app.ts 的错误中间件转成 500 信封，而不是启动时整个进程挂掉
    const registry = getSkillRegistry();
    const payload: SkillsResponse = {
      apiVersion: API_VERSION,
      count: registry.size,
      skills: registry.all(),
    };
    res.json(payload);
  });

  router.post('/generate', (req, res) => {
    const body = req.body as { utterance?: unknown } | undefined;
    const checked = readUtterance(body?.utterance);

    if (!checked.ok) {
      res.status(400).json({
        error: { code: checked.code, message: checked.message, field: 'utterance' },
      });
      return;
    }

    const response: GenerateResponse = {
      apiVersion: API_VERSION,
      requestId: newRequestId(),
      receivedAt: new Date().toISOString(),
      utterance: checked.utterance,
      // ↓ 这四个字段是后续阶段的填充点，P1-2 阶段保持 null
      plan: null,
      courseware: null,
      trace: null,
      verification: null,
    };
    res.json(response);
  });

  return router;
}
