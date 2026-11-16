/**
 * GET /api/skills 的验收：注册表的成果必须能从接口看到，
 * 否则它只是测试里的一个概念，界面上无从证明「系统认识哪些能力」。
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SKILL_IDS, type SkillsResponse } from '../../src/contracts/index';
import { createApiApp } from '../../src/server/app';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApiApp().listen(0);
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('GET /api/skills', () => {
  it('返回 4 个 Skill 的完整声明', async () => {
    const res = await fetch(`${baseUrl}/api/skills`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SkillsResponse;
    expect(body.apiVersion).toBe(1);
    expect(body.count).toBe(4);
    expect(body.skills).toHaveLength(4);
    expect(body.skills.map((skill) => skill.id).sort()).toEqual([...SKILL_IDS].sort());
  });

  it('每条声明都带编排需要的字段（槽位 / 优先级 / 产出 / 依赖 / 互斥）', async () => {
    const body = (await (await fetch(`${baseUrl}/api/skills`)).json()) as SkillsResponse;

    for (const skill of body.skills) {
      expect(skill.slot).toBeTruthy();
      expect(Number.isInteger(skill.priority)).toBe(true);
      expect(skill.namespace).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(skill.produces.length).toBeGreaterThan(0);
      expect(Array.isArray(skill.requires)).toBe(true);
      expect(Array.isArray(skill.conflictsWith)).toBe(true);
      expect(skill.triggers.primary.length).toBeGreaterThan(0);
    }
  });

  it('返回纯 JSON：没有函数或 undefined 被静默丢掉', async () => {
    const raw = await (await fetch(`${baseUrl}/api/skills`)).text();
    const parsed: unknown = JSON.parse(raw);
    // 若响应里混入函数或 undefined，stringify 会丢掉它们，往返结果就对不上
    expect(JSON.stringify(parsed)).toBe(raw);
  });
});
