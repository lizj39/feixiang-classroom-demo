// @vitest-environment jsdom
/**
 * P1-2 / P2 的界面验收：三栏存在、空输入不请求、点生成能观察到 loading、
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
  findScenario,
  type GenerateResponse,
  type SkillId,
  type SkillManifest,
  type SkillSlot,
  type Trace,
} from '../../src/contracts/index';
import { App } from '../../src/web/App';
import { S2_PLAN, S3_PLAN, S4_PLAN } from '../fixtures/scenarios';

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

  it('四个演示场景按钮都在，点一下把文案填进输入框', () => {
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

    // 1) 立刻能观察到 loading —— 这条是 P1-2 的核心验收判据
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
