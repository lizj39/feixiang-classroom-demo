/**
 * 接口层验收：不经过 Vite、不占用固定端口，直接对 API 层断言。
 *
 * 用 listen(0) 拿随机空闲端口，避免和开发服务器抢 5173 —— 测试不应该要求
 * 「先关掉 dev server」才能跑。
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../../src/server/app';
import { SERVICE_NAME } from '../../src/server/api';

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

describe('GET /api/health', () => {
  it('返回 200 与 JSON 结构', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.service).toBe(SERVICE_NAME);
    // 版本号来自契约模块而不是硬编码，改契约时这里会立刻反映
    expect(body.contractVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof body.uptimeSec).toBe('number');
    expect(Number.isNaN(Date.parse(String(body.now)))).toBe(false);
  });

  it('Content-Type 是 JSON，前端可以统一按 JSON 解析', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('不暴露 X-Powered-By', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});

describe('API 层与前端解耦', () => {
  it('未知接口返回 JSON 404，而不是 Express 的 HTML 错误页', async () => {
    const res = await fetch(`${baseUrl}/api/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('NOT_FOUND');
    expect(body.error?.message).toContain('/api/nope');
  });

  it('createApiApp 不挂前端中间件：根路径此时是 404', async () => {
    // 这条断言守的是「测试不依赖 Vite」——如果哪天有人把前端中间件塞进 createApiApp，
    // 单元测试就会变慢、变脆，这里会先失败
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(404);
  });
});
