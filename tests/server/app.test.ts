/**
 * 生产模式装配的验收：静态托管、SPA 回退、API 优先级。
 *
 * 用临时目录造一个「构建产物」，而不是依赖真实的 dist/web ——
 * 这样测试不要求先 npm run build，也不会因为构建产物的 hash 变化而失败。
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp, mountStatic } from '../../src/server/app';

const INDEX_HTML = '<!doctype html><html><body><div id="root">stub</div></body></html>';
const ASSET_JS = 'console.log("asset");';

let staticDir: string;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  staticDir = mkdtempSync(path.join(tmpdir(), 'feixiang-dist-'));
  writeFileSync(path.join(staticDir, 'index.html'), INDEX_HTML, 'utf8');
  mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
  writeFileSync(path.join(staticDir, 'assets', 'app.js'), ASSET_JS, 'utf8');

  server = createApp({ staticDir }).listen(0);
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
  rmSync(staticDir, { recursive: true, force: true });
});

describe('生产模式：静态产物托管', () => {
  it('根路径返回 index.html', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('id="root"');
  });

  it('静态资源按原路径取到，Content-Type 正确', async () => {
    const res = await fetch(`${baseUrl}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toBe(ASSET_JS);
  });

  it('前端路由回退到 index.html，而不是 404', async () => {
    const res = await fetch(`${baseUrl}/courseware/42`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });
});

describe('生产模式：API 优先级不能被 SPA 回退吞掉', () => {
  it('/api/health 仍然走 JSON', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('不存在的接口返回 JSON 404，绝不能回退成 200 + HTML', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('非 GET 请求不回退成 index.html', async () => {
    const res = await fetch(`${baseUrl}/courseware/42`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('mountStatic 的防御', () => {
  it('产物目录没有 index.html 时直接报错，而不是悄悄返回 404', async () => {
    const emptyDir = mkdtempSync(path.join(tmpdir(), 'feixiang-empty-'));
    try {
      const app = createApp();
      expect(() => mountStatic(app, emptyDir)).toThrow(/index\.html/);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
