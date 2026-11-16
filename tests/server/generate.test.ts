/**
 * POST /api/generate 的 P1-2 验收。
 *
 * 除了「正常返回」，这里还有一条刻意的守门断言：
 * plan / courseware / trace / verification 必须全是 null。
 * 一旦有人为了「界面好看」在这四个字段里塞写死的数据，这条测试会立刻失败 ——
 * 到 P3 接上真实路由时再改它，改的时候你会想起为什么当初要拦。
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAX_UTTERANCE_LENGTH, type GenerateResponse } from '../../src/contracts/index';
import { createApiApp } from '../../src/server/app';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApiApp().listen(0);
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function postJson(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/generate 正常路径', () => {
  it('返回信封：requestId、回声、收到时间', async () => {
    const res = await postJson({ utterance: '能拖动滑块的一次函数演示' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as GenerateResponse;
    expect(body.apiVersion).toBe(1);
    expect(body.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(body.utterance).toBe('能拖动滑块的一次函数演示');
    expect(Number.isNaN(Date.parse(body.receivedAt))).toBe(false);
  });

  it('S2 返回真实课件：IR 里有 slider，且绑定到 plot', async () => {
    const res = await postJson({ utterance: '能拖动滑块的一次函数演示' });
    const body = (await res.json()) as GenerateResponse;

    expect(body.plan?.type).toBe('combo');
    expect(body.plan?.scores).toHaveLength(4);
    expect(body.courseware).not.toBeNull();

    const children = body.courseware?.page.children ?? [];
    const plot = children.find((node) => node.kind === 'plot');
    const slider = children.find((node) => node.kind === 'slider');
    expect(plot).toBeDefined();
    expect(slider).toBeDefined();

    if (slider?.kind === 'slider' && plot?.kind === 'plot') {
      expect(slider.bindTo.nodeId).toBe(plot.id);
      expect(slider.range.value).toBe(plot.params.k);
    }

    // 服务端只能验 L1/L2，L3/L4 必须由浏览器执行
    expect(body.verification).not.toBeNull();
    expect(body.verification?.checks.some((check) => check.layer === 'L1')).toBe(true);
    expect(body.verification?.checks.some((check) => check.layer === 'L2')).toBe(true);
    expect(body.verification?.pendingLayers).toEqual(['L3', 'L4']);
  });

  it('不生成时 courseware 为 null（拒绝也是决策的一部分）', async () => {
    const res = await postJson({ utterance: '帮我准备明天的班会' });
    const body = (await res.json()) as GenerateResponse;

    expect(body.plan?.type).toBe('no_match');
    expect(body.courseware).toBeNull();
    // 不生成时要说明「不适用」，而不是含糊的「待执行」
    expect(body.verification?.summary).toContain('不生成');
    expect(body.verification?.checks.filter((check) => check.layer === 'L3').every((check) => check.status === 'skipped')).toBe(
      true,
    );
  });

  it('trace 由服务端写入：序号连续、分为 router / composer 两层、与 requestId 绑定', async () => {
    const res = await postJson({ utterance: '能拖动滑块的一次函数演示' });
    const body = (await res.json()) as GenerateResponse;

    const events = body.trace?.events ?? [];
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    expect(new Set(events.map((event) => event.layer))).toEqual(new Set(['router', 'composer', 'validator']));
    expect(body.trace?.requestId).toBe(body.requestId);

    // 层顺序必须单调：先决策，再编排，最后验证
    const order = ['router', 'composer', 'renderer', 'validator'];
    const ranks = events.map((event) => order.indexOf(event.layer));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    for (const event of events) {
      expect(event.decision.length).toBeGreaterThan(0);
      expect(event.reason.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(event.at))).toBe(false);
    }
  });

  it('连续两次请求的 requestId 不同', async () => {
    const [a, b] = await Promise.all([postJson({ utterance: '一' }), postJson({ utterance: '二' })]);
    const bodyA = (await a.json()) as GenerateResponse;
    const bodyB = (await b.json()) as GenerateResponse;
    expect(bodyA.requestId).not.toBe(bodyB.requestId);
  });

  it('首尾空白被折叠，回声是规范化后的文本', async () => {
    const res = await postJson({ utterance: '  画   个图  ' });
    const body = (await res.json()) as GenerateResponse;
    expect(body.utterance).toBe('画 个图');
  });
});

describe('POST /api/generate 输入校验', () => {
  it('空对象 → 400 EMPTY_UTTERANCE', async () => {
    const res = await postJson({});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('EMPTY_UTTERANCE');
    expect(body.error.field).toBe('utterance');
  });

  it('纯空白 → 400 EMPTY_UTTERANCE（不能被「看起来有内容」绕过）', async () => {
    const res = await postJson({ utterance: '   \n\t  ' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('EMPTY_UTTERANCE');
  });

  it('超过上限 → 400 TOO_LONG，且错误信息里带实际长度', async () => {
    const res = await postJson({ utterance: '画'.repeat(MAX_UTTERANCE_LENGTH + 1) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('TOO_LONG');
    expect(body.error.message).toContain(String(MAX_UTTERANCE_LENGTH + 1));
  });

  it('恰好等于上限 → 通过', async () => {
    const res = await postJson({ utterance: '画'.repeat(MAX_UTTERANCE_LENGTH) });
    expect(res.status).toBe(200);
  });

  it('非字符串 → 400 INVALID_BODY', async () => {
    const res = await postJson({ utterance: 123 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_BODY');
  });

  it('非法 JSON → 400 且仍然是 JSON 信封，不是 Express 的 HTML 错误页', async () => {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"utterance": ',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_BODY');
  });
});
