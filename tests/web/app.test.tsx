// @vitest-environment jsdom
/**
 * 界面验收：三栏存在、空输入不请求、点生成能观察到 loading、
 * 请求体正确且只发一次、错误以 code + message 呈现、已注册 Skill 能显示出来。
 *
 * 这里不打真实服务端 —— 组件测试只该验证「组件的行为」；
 * 接口本身的正确性由 tests/server/*.test.ts 用真实 HTTP 覆盖。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONTRACT_VERSION,
  SCENARIOS,
  buildVerificationReport,
  findScenario,
  type GenerateResponse,
  type ParsedIntent,
  type Plan,
  type SkillId,
  type SkillManifest,
  type SkillSlot,
  type Trace,
} from '../../src/contracts/index';
import { App } from '../../src/web/App';
import { setRegistryBug } from '../../src/web/bug-mode';
import { NODE_RENDERERS } from '../../src/web/render/registry';
import { S1_PLAN, S2_PLAN, S3_PLAN, S4_PLAN } from '../fixtures/scenarios';

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function manifestOf(id: SkillId, slot: SkillSlot): SkillManifest {
  return {
    id,
    displayName: id,
    summary: `${id} 的说明`,
    slot,
    priority: 50,
    namespace: id,
    triggers: { primary: ['能力'], synonyms: [], intents: [] },
    produces: ['plot'],
    requires: [],
    conflictsWith: [],
    params: [],
  };
}

const FOUR_SKILLS: readonly SkillManifest[] = [
  manifestOf('function-plot', 'visual'),
  manifestOf('interactive-slider', 'interaction'),
  manifestOf('exercise-choice', 'exercise'),
  manifestOf('exercise-input', 'exercise'),
];

interface MockOptions {
  readonly skills?: () => Promise<Response>;
  readonly generate?: () => Promise<Response>;
}

/** 按 URL 分发请求：App 挂载时会拉一次 /api/skills，不能和 generate 混在一起 mock。 */
function mockFetch(options: MockOptions = {}): void {
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/skills') {
      return options.skills
        ? options.skills()
        : Promise.resolve(jsonResponse({ apiVersion: 1, count: FOUR_SKILLS.length, skills: FOUR_SKILLS }));
    }
    if (url === '/api/generate') {
      return options.generate ? options.generate() : Promise.reject(new Error('本用例不应发生成请求'));
    }
    return Promise.reject(new Error(`未预期的请求：${url}`));
  });
}

function postCalls(): unknown[][] {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
}

const SUCCESS_PAYLOAD: GenerateResponse = {
  apiVersion: 1,
  requestId: 'req_00000000-0000-0000-0000-000000000000',
  receivedAt: '2026-01-01T00:00:00.000Z',
  utterance: '能拖动滑块的一次函数演示',
  intent: null,
  plan: null,
  courseware: null,
  trace: null,
  verification: null,
};

const TRACE: Trace = {
  traceVersion: 1,
  requestId: 'req_00000000-0000-0000-0000-000000000000',
  events: [
    {
      seq: 1,
      layer: 'router',
      at: '2026-01-01T00:00:00.000Z',
      step: 'parse-intent',
      input: { utterance: '能拖动滑块的一次函数演示' },
      output: { matchedTokens: ['拖动', '滑块', '一次函数', '演示'] },
      decision: '用 rule 解析器理解需求',
      reason: '命中 4 个触发词',
    },
    {
      seq: 2,
      layer: 'router',
      at: '2026-01-01T00:00:00.001Z',
      step: 'score-skills',
      input: {},
      output: {},
      decision: '按整数百分制给每个 Skill 打分',
      reason: '最高分 interactive-slider 1.00',
    },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // 故障开关会改模块级注册表，用例失败时也要复原，否则后续用例全被污染
  setRegistryBug(null);
});

function typeAndSubmit(text: string): void {
  fireEvent.change(screen.getByTestId('utterance-input'), { target: { value: text } });
  fireEvent.click(screen.getByTestId('generate-button'));
}

describe('三栏骨架', () => {
  it('三个面板都在，且带契约版本标记', () => {
    mockFetch();
    render(<App />);
    expect(screen.getByTestId('request-panel')).toBeTruthy();
    expect(screen.getByTestId('preview-panel')).toBeTruthy();
    expect(screen.getByTestId('evidence-panel')).toBeTruthy();
    expect(screen.getByTestId('contract-version').textContent).toContain(CONTRACT_VERSION);
  });

  it('初始状态是空态：没有 loading、没有回执、没有错误', () => {
    mockFetch();
    render(<App />);
    expect(screen.queryByTestId('loading-indicator')).toBeNull();
    expect(screen.queryByTestId('receipt')).toBeNull();
    expect(screen.queryByTestId('error-banner')).toBeNull();
  });

  it('四个示例场景按钮都在，点一下把文案填进输入框', () => {
    mockFetch();
    render(<App />);
    for (const scenario of SCENARIOS) {
      expect(screen.getByTestId(`scenario-${scenario.id}`)).toBeTruthy();
    }

    fireEvent.click(screen.getByTestId('scenario-S2'));
    const input = screen.getByTestId('utterance-input') as HTMLTextAreaElement;
    expect(input.value).toBe(findScenario('S2').utterance);
  });
});

describe('已注册的 Skill（P2）', () => {
  it('挂载后拉取 /api/skills，并逐个渲染出来', async () => {
    mockFetch();
    render(<App />);

    await screen.findByTestId('skill-function-plot');
    expect(screen.getByTestId('registered-skills').textContent).toContain('4');
    for (const skill of FOUR_SKILLS) {
      expect(screen.getByTestId(`skill-${skill.id}`).textContent).toContain(skill.slot);
    }
  });

  it('清单加载失败时不阻塞生成流程，只提示一块证据缺失', async () => {
    mockFetch({
      skills: async () => jsonResponse({ error: { code: 'INTERNAL', message: '炸了' } }, 500),
      generate: async () => jsonResponse(SUCCESS_PAYLOAD),
    });
    render(<App />);

    const panel = screen.getByTestId('registered-skills');
    await vi.waitFor(() => {
      expect(panel.textContent).toContain('未能加载');
    });

    typeAndSubmit('画个图');
    expect(await screen.findByTestId('receipt')).toBeTruthy();
  });
});

describe('决策与证据（P3）', () => {
  const payloadWith = (plan: GenerateResponse['plan']): GenerateResponse => ({
    ...SUCCESS_PAYLOAD,
    plan,
    trace: TRACE,
  });

  it('预览区显示决策类型、理由与选中的 Skill', async () => {
    mockFetch({ generate: async () => jsonResponse(payloadWith(S2_PLAN)) });
    render(<App />);
    typeAndSubmit('能拖动滑块的一次函数演示');

    expect((await screen.findByTestId('decision-type')).textContent).toBe('组合');
    expect(screen.getByTestId('decision-reason').textContent).toContain('同时达标');
    expect(screen.getByTestId('decision').textContent).toContain('interactive-slider');
    expect(screen.queryByTestId('clarify-questions')).toBeNull();
  });

  it('证据面板逐行展示分数与证据，未入选的 Skill 也在表里', async () => {
    mockFetch({ generate: async () => jsonResponse(payloadWith(S2_PLAN)) });
    render(<App />);
    typeAndSubmit('能拖动滑块的一次函数演示');

    await screen.findByTestId('score-function-plot');
    const plot = screen.getByTestId('score-function-plot');
    expect(plot.textContent).toContain('0.60');
    expect(plot.textContent).toContain('一次函数');
    expect(plot.textContent).toContain('+50');
    expect(plot.className).toContain('is-selected');

    // 0 分的 Skill 也必须出现，否则「为什么没选它」无从回答
    const choice = screen.getByTestId('score-exercise-choice');
    expect(choice.textContent).toContain('0.00');
    expect(choice.className).not.toContain('is-selected');
  });

  it('被遮蔽的词显示为 0，让「为什么没加分」可见', async () => {
    mockFetch({ generate: async () => jsonResponse(payloadWith(S3_PLAN)) });
    render(<App />);
    typeAndSubmit('出一道一次函数练习题');

    const row = await screen.findByTestId('score-exercise-choice');
    expect(row.textContent).toContain('选答案');
    expect(row.textContent).toContain('选');
    // 遮蔽证据带 0 分标记
    expect(row.querySelector('.signal--shadowed')?.textContent).toContain('选');
  });

  it('不生成时把澄清问题摆到老师面前', async () => {
    mockFetch({ generate: async () => jsonResponse(payloadWith(S4_PLAN)) });
    render(<App />);
    typeAndSubmit('帮我准备明天的班会');

    expect((await screen.findByTestId('decision-type')).textContent).toBe('无匹配');
    expect(screen.getByTestId('decision').textContent).toContain('不生成');
    expect(screen.getByTestId('clarify-questions')).toBeTruthy();
  });

  it('执行链路按 trace 事件逐条渲染', async () => {
    mockFetch({ generate: async () => jsonResponse(payloadWith(S2_PLAN)) });
    render(<App />);
    typeAndSubmit('能拖动滑块的一次函数演示');

    await screen.findByTestId('score-function-plot');
    const events = screen.getAllByTestId('trace-event');
    expect(events).toHaveLength(TRACE.events.length);
    expect(events[0]?.textContent).toContain('parse-intent');
    expect(events[1]?.textContent).toContain('score-skills');
  });
});

describe('验证报告（P6）', () => {
  const report = buildVerificationReport('req_00000000-0000-0000-0000-000000000000', [
    {
      ruleId: 'L1.route.selected-match',
      layer: 'L1',
      title: '课件里出现的 Skill 与决策声称的一致',
      status: 'pass',
      evidence: { kind: 'plan', detail: 'plan.selected' },
    },
    {
      ruleId: 'L2.ir.slider-bound',
      layer: 'L2',
      title: '每个滑块都绑定到真实存在的图像节点',
      status: 'fail',
      evidence: { kind: 'ir-path', detail: 'page.children[2].bindTo.nodeId' },
      expected: 0,
      actual: 1,
      blockedReason: '绑定目标不存在',
    },
    {
      ruleId: 'L4.behavior.slider-updates-plot',
      layer: 'L4',
      title: '拖动滑块后图像按公式重算',
      status: 'skipped',
      evidence: { kind: 'behavior', detail: 'L2 未通过' },
      blockedReason: 'L2 失败，行为验证不再执行',
    },
  ]);

  it('显示汇总、逐条检查与失败项的期望/实际', async () => {
    mockFetch({
      generate: async () =>
        jsonResponse({ ...SUCCESS_PAYLOAD, plan: S2_PLAN, courseware: null, verification: report }),
    });
    render(<App />);
    typeAndSubmit('能拖动滑块的一次函数演示');

    const summary = await screen.findByTestId('verification-summary');
    expect(summary.textContent).toContain('L2');
    expect(summary.textContent).toContain('失败');

    // 顶栏徽标让人不用滚到右栏底部就知道结果
    expect(screen.getByTestId('header-verification').textContent).toContain('L2 失败');

    // 分层状态条：一眼看出哪一层红、哪一层没跑
    expect(screen.getByTestId('layer-chip-L1').textContent).toContain('通过');
    expect(screen.getByTestId('layer-chip-L2').textContent).toContain('失败');
    expect(screen.getByTestId('layer-chip-L4').textContent).toContain('未执行');

    const failed = screen.getByTestId('verify-L2.ir.slider-bound');
    expect(failed.textContent).toContain('fail');
    expect(failed.textContent).toContain('期望');
    expect(failed.textContent).toContain('绑定目标不存在');

    // 下游层必须是 skipped，不能被算成通过
    const downstream = screen.getByTestId('verify-L4.behavior.slider-updates-plot');
    expect(downstream.textContent).toContain('skipped');
    expect(downstream.textContent).toContain('不再执行');
  });
});

describe('故障注入（P7）', () => {
  it('页面上的故障按钮可以切换模式，切回正常会复原注册表', () => {
    mockFetch();
    render(<App />);

    fireEvent.click(screen.getByTestId('bug-unregistered-renderer'));
    expect(screen.getByTestId('bug-banner').textContent).toContain('unregistered-renderer');
    expect(window.location.search).toContain('bug=unregistered-renderer');
    // 纯前端故障：注册表里确实少了 slider
    expect(Object.keys(NODE_RENDERERS)).not.toContain('slider');

    fireEvent.click(screen.getByTestId('bug-none'));
    expect(screen.queryByTestId('bug-banner')).toBeNull();
    expect(window.location.search).not.toContain('bug=');
    // 关掉开关必须真的复原，否则页面会一直缺滑块
    expect(Object.keys(NODE_RENDERERS)).toContain('slider');
  });

  it('开启故障时显示横幅，并把 flags 上送服务端', async () => {
    mockFetch({ generate: async () => jsonResponse(SUCCESS_PAYLOAD) });
    render(<App initialBugMode="drop-node" />);

    expect(screen.getByTestId('bug-banner').textContent).toContain('drop-node');

    typeAndSubmit('能拖动滑块的一次函数演示');
    await screen.findByTestId('receipt');

    const [, init] = postCalls()[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      utterance: '能拖动滑块的一次函数演示',
      flags: { bug: 'drop-node' },
    });
  });

  it('纯前端故障不上送（否则服务端 trace 会被无关 flags 干扰）', async () => {
    mockFetch({ generate: async () => jsonResponse(SUCCESS_PAYLOAD) });
    render(<App initialBugMode="unregistered-renderer" />);

    typeAndSubmit('画个图');
    await screen.findByTestId('receipt');

    const [, init] = postCalls()[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ utterance: '画个图' });
  });

  it('没有故障参数时不显示横幅', () => {
    mockFetch();
    render(<App />);
    expect(screen.queryByTestId('bug-banner')).toBeNull();
  });
});

describe('理解结果（P8）', () => {
  const intent: ParsedIntent = {
    utterance: '让学生自己调参数看看',
    matchedTokens: ['画'],
    capabilities: ['function-plot', 'interactive-slider'],
    params: { k: -2, b: 5 },
    parser: 'llm',
    normalized: '画出斜率 -2、截距 5 的一次函数图像，并提供滑块让学生自行调参',
  };

  it('显示解析器、标准化复述、两路证据与读出的参数', async () => {
    mockFetch({ generate: async () => jsonResponse({ ...SUCCESS_PAYLOAD, intent, plan: S2_PLAN }) });
    render(<App />);
    typeAndSubmit('让学生自己调参数看看');
    await screen.findByTestId('intent-parser');

    expect(screen.getByTestId('intent-parser').textContent).toContain('LLM');
    const block = screen.getByTestId('evidence-intent').textContent ?? '';
    expect(block).toContain('斜率 -2');
    expect(block).toContain('interactive-slider');
    expect(block).toContain('"k":-2');
  });

  it('降级时把原因摆在明面上', async () => {
    const degraded: ParsedIntent = {
      ...intent,
      parser: 'rule',
      capabilities: [],
      degraded: { reason: 'LLM 解析失败，降级到规则版：超过 8000ms 未返回' },
    };
    mockFetch({ generate: async () => jsonResponse({ ...SUCCESS_PAYLOAD, intent: degraded, plan: S1_PLAN }) });
    render(<App />);
    typeAndSubmit('画个图');

    const banner = await screen.findByTestId('intent-degraded');
    expect(banner.textContent).toContain('降级');
    expect(banner.textContent).toContain('8000ms');
    expect(screen.getByTestId('intent-parser').textContent).toContain('规则');
  });

  it('证据合计超过 100 分时标出原始分，否则 1.00 看起来像算错了', async () => {
    const capped: Plan = {
      type: 'single',
      utterance: '画一下一次函数的图像',
      selected: ['function-plot'],
      scores: [
        {
          skill: 'function-plot',
          score: 1,
          signals: [
            { token: '图像', kind: 'primary', points: 50, by: 'lexicon' },
            { token: '一次函数', kind: 'primary', points: 50, by: 'lexicon' },
            { token: 'function-plot', kind: 'capability', points: 60, by: 'llm' },
          ],
          shadowed: [],
        },
      ],
      reason: '只有 function-plot 达标',
      questions: [],
    };

    mockFetch({ generate: async () => jsonResponse({ ...SUCCESS_PAYLOAD, intent, plan: capped }) });
    render(<App />);
    typeAndSubmit('画一下一次函数的图像');

    const row = await screen.findByTestId('score-function-plot');
    expect(row.textContent).toContain('1.00');
    expect(row.textContent).toContain('原始 160');
  });
});

describe('空输入不发请求', () => {
  it('点生成只给出提示，不发 POST', () => {
    mockFetch();
    render(<App />);
    fireEvent.click(screen.getByTestId('generate-button'));

    expect(postCalls()).toHaveLength(0);
    expect(screen.getByTestId('error-banner').textContent).toContain('EMPTY_UTTERANCE');
  });

  it('只输空格也算空输入', () => {
    mockFetch();
    render(<App />);
    typeAndSubmit('    ');
    expect(postCalls()).toHaveLength(0);
    expect(screen.getByTestId('error-banner').textContent).toContain('EMPTY_UTTERANCE');
  });
});

describe('生成流程', () => {
  it('请求中:按钮禁用、出现 loading 文案;响应后显示回执', async () => {
    const gate = deferred<Response>();
    mockFetch({ generate: () => gate.promise });

    render(<App />);
    typeAndSubmit('能拖动滑块的一次函数演示');

    // 1) 立刻能观察到 loading —— 这条是关键验收判据
    expect(screen.getByTestId('loading-indicator')).toBeTruthy();
    const button = screen.getByTestId('generate-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('生成中');

    // 2) 放行响应
    gate.resolve(jsonResponse(SUCCESS_PAYLOAD));

    const receipt = await screen.findByTestId('receipt');
    expect(receipt.textContent).toContain(SUCCESS_PAYLOAD.requestId);
    expect(screen.getByTestId('receipt-utterance').textContent).toBe('能拖动滑块的一次函数演示');
    expect(screen.queryByTestId('loading-indicator')).toBeNull();
    expect((screen.getByTestId('generate-button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('请求体是 { utterance }，且只发一次 POST', async () => {
    mockFetch({ generate: async () => jsonResponse(SUCCESS_PAYLOAD) });

    render(<App />);
    typeAndSubmit('  画一下 y=2x+1 的图像  ');
    await screen.findByTestId('receipt');

    const posts = postCalls();
    expect(posts).toHaveLength(1);
    const [url, init] = posts[0] as [string, RequestInit];
    expect(url).toBe('/api/generate');
    // 前端先 trim 再发，避免把首尾空白写到服务端日志里
    expect(JSON.parse(String(init.body))).toEqual({ utterance: '画一下 y=2x+1 的图像' });
  });

  it('服务端返回 400 时,错误条展示 code 与 message', async () => {
    mockFetch({
      generate: async () => jsonResponse({ error: { code: 'TOO_LONG', message: '需求最多 200 个字符，当前 201 个' } }, 400),
    });

    render(<App />);
    typeAndSubmit('画');

    const banner = await screen.findByTestId('error-banner');
    expect(banner.textContent).toContain('TOO_LONG');
    expect(banner.textContent).toContain('200');
    expect(screen.queryByTestId('receipt')).toBeNull();
  });

  it('网络异常时仍然给出可读错误,不会白屏', async () => {
    mockFetch({ generate: async () => Promise.reject(new Error('Failed to fetch')) });

    render(<App />);
    typeAndSubmit('画个图');

    const banner = await screen.findByTestId('error-banner');
    expect(banner.textContent).toContain('Failed to fetch');
  });
});
