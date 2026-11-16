/**
 * LLM 理解层的验收。
 *
 * 全程不联网：注入 fake client，只验证「模型给的输入被怎么处理」。
 * 真实调用放在 `npm run demo:llm` 里，永远不进 `npm test` ——
 * 否则测试就变成「看模型今天心情」。
 */

import { describe, expect, it, vi } from 'vitest';

import { SKILL_IDS, type ParsedIntent } from '../../src/contracts/index';
import {
  chatCompletionsUrl,
  createOpenAiCompatibleClient,
  readLlmConfig,
  type LlmClient,
} from '../../src/server/intent/llm/client';
import { createLlmIntentParser } from '../../src/server/intent/llm/parser';
import { buildSystemPrompt, buildUserPrompt } from '../../src/server/intent/llm/prompt';
import { createParserFactory } from '../../src/server/intent/select';
import { createRuleIntentParser } from '../../src/server/intent/rule-parser';
import { SKILL_MANIFESTS } from '../../src/server/skills/manifests';
import { createSkillRegistry } from '../../src/server/skills/registry';

const registry = createSkillRegistry(SKILL_MANIFESTS);
const rule = createRuleIntentParser(registry);

function fakeClient(content: string | (() => Promise<string>)): LlmClient {
  return {
    complete: typeof content === 'string' ? async () => content : content,
  };
}

function parserWith(client: LlmClient, timeoutMs?: number) {
  return createLlmIntentParser({
    registry,
    client,
    fallback: rule,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe('Prompt', () => {
  it('system prompt 列出了全部已注册能力，模型没有发明新标签的空间', () => {
    const prompt = buildSystemPrompt(registry.all());
    for (const id of SKILL_IDS) {
      expect(prompt).toContain(id);
    }
    expect(prompt).toContain('只返回 JSON');
  });

  it('user prompt 带上原始需求', () => {
    expect(buildUserPrompt('能拖动滑块的一次函数演示')).toContain('能拖动滑块的一次函数演示');
  });
});

describe('成功的解析', () => {
  const client = fakeClient(
    JSON.stringify({
      capabilities: ['function-plot', 'interactive-slider'],
      params: { k: 3, b: 2 },
      normalized: '一次函数图像 + 可拖动滑块，参数 k=3 b=2',
    }),
  );

  it('能力与参数落到 ParsedIntent 上，parser 标成 llm', async () => {
    const intent = await parserWith(client).parse('让学生自己调参数看看');

    expect(intent.parser).toBe('llm');
    expect(intent.capabilities).toEqual(['function-plot', 'interactive-slider']);
    expect(intent.params).toMatchObject({ k: 3, b: 2 });
    expect(intent.normalized).toContain('可拖动滑块');
    expect(intent.degraded).toBeUndefined();
  });

  it('词表证据仍然保留（规则版先跑），两路证据可以并存', async () => {
    const intent = await parserWith(client).parse('画一下 y=2x+1 的图像');
    expect(intent.matchedTokens).toContain('图像');
  });

  it('参数冲突时规则版优先：公式是确定性的，模型可能读错数字', async () => {
    // 原文明明是 y=2x+1，模型却说 k=9
    const lying = fakeClient(JSON.stringify({ capabilities: [], params: { k: 9 } }));
    const intent = await parserWith(lying).parse('画一下 y=2x+1 的图像');
    expect(intent.params.k).toBe(2);
  });

  it('规则读不出的参数由模型补上（中文数字这类）', async () => {
    const chinese = fakeClient(JSON.stringify({ capabilities: [], params: { k: -2, b: 5 } }));
    const intent = await parserWith(chinese).parse('画一条斜率是负二、截距是五的直线');
    expect(intent.params).toMatchObject({ k: -2, b: 5 });
  });
});

describe('降级：任何异常都不能让请求失败', () => {
  const cases: Array<[string, LlmClient]> = [
    ['网络错误', fakeClient(async () => Promise.reject(new Error('ECONNRESET')))],
    ['不是 JSON', fakeClient('我觉得应该画个图')],
    ['JSON 但不是对象', fakeClient('[1,2,3]')],
    ['capabilities 不是数组', fakeClient(JSON.stringify({ capabilities: 'plot' }))],
    ['超时', fakeClient(() => new Promise<string>(() => undefined))],
  ];

  for (const [name, client] of cases) {
    it(`${name} → 退回规则版并写明原因`, async () => {
      const intent = await parserWith(client, 20).parse('画一下 y=3x+2 的图像');

      expect(intent.parser).toBe('rule');
      expect(intent.degraded?.reason).toBeTruthy();
      // 规则版的结果必须完好：不能因为模型挂了就丢了能力与参数
      expect(intent.capabilities).toEqual([]);
      expect(intent.matchedTokens).toContain('图像');
      expect(intent.params).toMatchObject({ k: 3, b: 2 });
    });
  }
});

describe('脏输出只丢脏的那部分', () => {
  it('未知能力被忽略，并在 notes 里说明', async () => {
    const client = fakeClient(
      JSON.stringify({ capabilities: ['function-plot', 'time-travel'], params: {}, normalized: '画图' }),
    );
    const intent = await parserWith(client).parse('画个图');

    expect(intent.capabilities).toEqual(['function-plot']);
    expect(intent.notes?.[0]).toContain('time-travel');
    // 部分可用不算降级：仍然走 LLM
    expect(intent.parser).toBe('llm');
    expect(intent.degraded).toBeUndefined();
  });

  it('非法参数（字符串 / 超限）被丢弃', async () => {
    const client = fakeClient(JSON.stringify({ capabilities: [], params: { k: '三', b: 9999 } }));
    const intent = await parserWith(client).parse('画个图');
    expect(intent.params.k).toBeUndefined();
    expect(intent.params.b).toBeUndefined();
  });
});

describe('解析器工厂', () => {
  const notConfigured = readLlmConfig({});

  it('没配 key：默认走规则版，也允许显式指定规则版', () => {
    const select = createParserFactory({ registry, config: notConfigured });

    const auto = select();
    expect(auto.usedLlm).toBe(false);
    expect(auto.parser.id).toBe('rule');
    expect(auto.reason).toContain('LLM_API_KEY');
  });

  it('没配 key 却要 LLM：降级并给出原因，而不是报错', async () => {
    const select = createParserFactory({ registry, config: notConfigured });
    const forced = select('llm');

    expect(forced.usedLlm).toBe(false);
    expect(forced.reason).toContain('降级');

    const intent = await forced.parser.parse('画个图');
    expect(intent.degraded?.reason).toContain('LLM_API_KEY');
  });

  it('配了 key：默认就用 LLM', () => {
    const select = createParserFactory({
      registry,
      config: { enabled: true, baseUrl: 'https://example.com', model: 'deepseek-flash', apiKey: 'sk-test' },
      client: fakeClient(JSON.stringify({ capabilities: [], params: {} })),
    });

    expect(select().usedLlm).toBe(true);
    expect(select('rule').usedLlm).toBe(false);
  });
});

describe('OpenAI 兼容客户端', () => {
  it('baseUrl 带不带 /v1 都能拼对', () => {
    expect(chatCompletionsUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(chatCompletionsUrl('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    );
    expect(chatCompletionsUrl('https://api.deepseek.com/v1/')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    );
  });

  it('请求体包含模型、JSON 模式与两条消息', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"capabilities":[]}' } }] }),
    })) as unknown as typeof fetch;

    const client = createOpenAiCompatibleClient({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      apiKey: 'sk-secret',
      fetchImpl,
    });

    const content = await client.complete({ system: 'sys', user: 'usr' });
    expect(content).toBe('{"capabilities":[]}');

    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as { model: string; response_format: unknown; messages: unknown[] };
    expect(body.model).toBe('deepseek-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toHaveLength(2);
  });

  it('非 2xx 抛错，且错误信息里不含 API key', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid api key"}',
    })) as unknown as typeof fetch;

    const client = createOpenAiCompatibleClient({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      apiKey: 'sk-secret-do-not-leak',
      fetchImpl,
    });

    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(/HTTP 401/);
    await expect(client.complete({ system: 's', user: 'u' })).rejects.not.toThrow(/sk-secret-do-not-leak/);
  });
});

describe('环境配置', () => {
  it('没有 key 就是未启用', () => {
    expect(readLlmConfig({}).enabled).toBe(false);
    expect(readLlmConfig({ LLM_API_KEY: '   ' }).enabled).toBe(false);
  });

  it('有 key 时启用，并用默认模型 deepseek-flash', () => {
    const config = readLlmConfig({ LLM_API_KEY: 'sk-x' });
    expect(config.enabled).toBe(true);
    expect(config.model).toBe('deepseek-flash');
    expect(config.baseUrl).toBe('https://api.deepseek.com');
  });
});

describe('端到端：LLM 能力接进路由', () => {
  it('模型说需要两个能力，路由就把它们组合起来，证据标成 llm', async () => {
    const { route } = await import('../../src/server/router/route');
    const client = fakeClient(JSON.stringify({ capabilities: ['function-plot', 'interactive-slider'] }));

    const outcome = await route('让学生自己调参数看看', {
      registry,
      parser: parserWith(client),
      emit: () => {},
    });

    expect(outcome.intent.parser).toBe('llm');
    expect(outcome.plan.type).toBe('combo');
    const plot = outcome.plan.scores.find((item: { skill: string }) => item.skill === 'function-plot');
    expect(plot?.signals.every((signal: { by: string }) => signal.by === 'llm')).toBe(true);
  });
});

/** 类型层面确认：ParsedIntent 的 notes 是可选字段，不传也合法。 */
export const WITHOUT_NOTES: ParsedIntent = {
  utterance: 'x',
  matchedTokens: [],
  capabilities: [],
  params: {},
  parser: 'rule',
};
