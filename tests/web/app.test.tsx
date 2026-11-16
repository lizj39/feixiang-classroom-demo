// @vitest-environment jsdom
/**
 * P1-2 的界面验收：三栏存在、空输入不请求、点生成能观察到 loading、
 * 请求体正确且只发一次、错误以 code + message 呈现。
 *
 * 这里不打真实服务端 —— 组件测试只该验证「组件的行为」；
 * 接口本身的正确性由 tests/server/generate.test.ts 用真实 HTTP 覆盖。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCENARIOS, findScenario, type GenerateResponse } from '../../src/contracts/index';
import { App } from '../../src/web/App';

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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    render(<App />);
    expect(screen.getByTestId('request-panel')).toBeTruthy();
    expect(screen.getByTestId('preview-panel')).toBeTruthy();
    expect(screen.getByTestId('evidence-panel')).toBeTruthy();
    expect(screen.getByTestId('contract-version').textContent).toContain('0.1.0');
  });

  it('初始状态是空态：没有 loading、没有回执、没有错误', () => {
    render(<App />);
    expect(screen.queryByTestId('loading-indicator')).toBeNull();
    expect(screen.queryByTestId('receipt')).toBeNull();
    expect(screen.queryByTestId('error-banner')).toBeNull();
  });

  it('四个演示场景按钮都在，点一下把文案填进输入框', () => {
    render(<App />);
    for (const scenario of SCENARIOS) {
      expect(screen.getByTestId(`scenario-${scenario.id}`)).toBeTruthy();
    }

    fireEvent.click(screen.getByTestId('scenario-S2'));
    const input = screen.getByTestId('utterance-input') as HTMLTextAreaElement;
    expect(input.value).toBe(findScenario('S2').utterance);
  });
});

describe('空输入不发请求', () => {
  it('点生成只给出提示，fetch 一次都不调用', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('generate-button'));

    expect(fetchMock).not.toHaveBeenCalled();
    const banner = screen.getByTestId('error-banner');
    expect(banner.textContent).toContain('EMPTY_UTTERANCE');
  });

  it('只输空格也算空输入', () => {
    render(<App />);
    typeAndSubmit('    ');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('error-banner').textContent).toContain('EMPTY_UTTERANCE');
  });
});

describe('生成流程', () => {
  it('请求中:按钮禁用、出现 loading 文案;响应后显示回执', async () => {
    const gate = deferred<Response>();
    fetchMock.mockReturnValue(gate.promise);

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
    fetchMock.mockResolvedValue(jsonResponse(SUCCESS_PAYLOAD));

    render(<App />);
    typeAndSubmit('  画一下 y=2x+1 的图像  ');
    await screen.findByTestId('receipt');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/generate');
    expect(init.method).toBe('POST');
    // 前端先 trim 再发，避免把首尾空白写到服务端日志里
    expect(JSON.parse(String(init.body))).toEqual({ utterance: '画一下 y=2x+1 的图像' });
  });

  it('服务端返回 400 时,错误条展示 code 与 message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'TOO_LONG', message: '需求最多 200 个字符，当前 201 个' } }, 400),
    );

    render(<App />);
    typeAndSubmit('画');

    const banner = await screen.findByTestId('error-banner');
    expect(banner.textContent).toContain('TOO_LONG');
    expect(banner.textContent).toContain('200');
    expect(screen.queryByTestId('receipt')).toBeNull();
  });

  it('网络异常时仍然给出可读错误,不会白屏', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));

    render(<App />);
    typeAndSubmit('画个图');

    const banner = await screen.findByTestId('error-banner');
    expect(banner.textContent).toContain('Failed to fetch');
  });
});
