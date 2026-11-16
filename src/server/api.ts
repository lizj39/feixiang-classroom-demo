/**
 * API 路由。
 *
 * /api/health  —— 骨架自检（同源联通证明）
 * /api/generate —— 生成入口：校验输入、回 requestId 与回声，
 *                  plan / courseware / trace / verification 一律 null。
 *
 * 为什么现在不返回课件：一旦这里返回写死的内容，后面接真路由时就分不清哪些是编的。
 * 有条测试守着「还没有产出的字段必须是 null」，防止提前塞写死的数据。
 */

import { randomUUID } from 'node:crypto';

import { Router } from 'express';

import {
  API_VERSION,
  BUG_MODES,
  CONTRACT_VERSION,
  PARSER_MODES,
  buildVerificationReport,
  isBugMode,
  isParserMode,
  readUtterance,
  type GenerateResponse,
  type SkillsResponse,
} from '../contracts/index';
import { composeCourseware } from './composer/compose';
import { readLlmConfig } from './intent/llm/client';
import { createParserFactory } from './intent/select';

import { route } from './router/route';
import { getSkillRegistry } from './skills/registry';
import { createTraceRecorder } from './trace/recorder';
import { browserOnlyChecks, buildServerChecks } from './verify/checks';

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
    const llm = readLlmConfig(process.env);
    const payload: SkillsResponse = {
      apiVersion: API_VERSION,
      count: registry.size,
      skills: registry.all(),
      llm: { configured: llm.enabled, model: llm.enabled ? llm.model : null },
    };
    res.json(payload);
  });

  router.post('/generate', async (req, res, next) => {
    const body = req.body as {
      utterance?: unknown;
      flags?: { bug?: unknown; parser?: unknown };
    } | undefined;
    const checked = readUtterance(body?.utterance);

    if (!checked.ok) {
      res.status(400).json({
        error: { code: checked.code, message: checked.message, field: 'utterance' },
      });
      return;
    }

    const rawParser = body?.flags?.parser;
    if (rawParser !== undefined && !isParserMode(rawParser)) {
      res.status(400).json({
        error: {
          code: 'BAD_FLAG',
          message: `未知的理解方式：${String(rawParser)}（可选：${PARSER_MODES.join(' / ')}）`,
          field: 'flags.parser',
        },
      });
      return;
    }

    // 故障注入开关：只接受封闭集合里的值，拼错就 400，避免「以为开了其实没开」
    const rawBug = body?.flags?.bug;
    if (rawBug !== undefined && !isBugMode(rawBug)) {
      res.status(400).json({
        error: {
          code: 'BAD_FLAG',
          message: `未知的故障模式：${String(rawBug)}（可选：${BUG_MODES.join(' / ')}）`,
          field: 'flags.bug',
        },
      });
      return;
    }
    const bug = rawBug;

    const requestId = newRequestId();
    const receivedAt = new Date().toISOString();

    try {
      const registry = getSkillRegistry();
      const recorder = createTraceRecorder();

      // 理解方式：rule / llm / 缺省（auto）。没配 key 时自动降级，不影响使用
      const selection = createParserFactory({ registry, config: readLlmConfig(process.env) })(rawParser);
      const { plan, intent } = await route(checked.utterance, {
        registry,
        parser: selection.parser,
        emit: recorder.emit,
      });
      const courseware = composeCourseware({
        plan,
        registry,
        // 参数从意图里取：老师说了 y=3x+2，画出来就必须是它
        params: intent.params,
        emit: recorder.emit,
        ...(bug === undefined ? {} : { bug }),
      });

      // 坏 IR 不再直接 500 —— 现在有验证报告可以承载它。
      // 让问题以「L2 失败 + 具体路径」的形式出现在界面上，比一个 500 更有用：
      // 前者能被定位和修复，后者只能知道「炸了」。

      // 服务端能验 L1/L2；L3/L4 的输入只存在于浏览器
      const checks = [
        ...buildServerChecks({ plan, courseware, registry }),
        ...browserOnlyChecks(
          courseware === null
            ? '本次不生成课件，没有 DOM 与交互可验'
            : '需要浏览器执行：DOM 结构与拖动行为只能在客户端验证',
        ),
      ];
      const verification = buildVerificationReport(
        requestId,
        checks,
        courseware === null ? '本次按规则不生成课件，L3/L4 无需执行' : undefined,
      );

      recorder.emit({
        layer: 'validator',
        step: 'verify-l1-l2',
        input: { planType: plan.type, courseware: courseware !== null },
        output: {
          overall: verification.overall,
          firstFailedLayer: verification.firstFailedLayer,
          pendingLayers: verification.pendingLayers,
          failed: checks.filter((check) => check.status === 'fail').map((check) => check.ruleId),
        },
        decision: verification.summary,
        reason:
          verification.firstFailedLayer === null
            ? '服务端能验的两层均通过'
            : `${verification.firstFailedLayer} 失败，下游层标记为待执行`,
      });

      const response: GenerateResponse = {
        apiVersion: API_VERSION,
        requestId,
        receivedAt,
        utterance: checked.utterance,
        intent,
        plan,
        courseware,
        trace: recorder.toTrace(requestId),
        verification,
      };
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
