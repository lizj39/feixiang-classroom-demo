/**
 * 前端唯一的网络出口。
 *
 * 把「HTTP 细节」和「错误信封」收敛在一个函数里，组件只处理 Phase。
 * 有一个刻意的选择：响应解析失败（比如代理返回了 HTML）不抛原始语法错误，
 * 而是转成带 code 的 ApiRequestError —— 界面上永远能显示一个有意义的错误码。
 */

import type { ApiErrorPayload, GenerateResponse } from '../contracts/index';

export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

export async function requestGenerate(utterance: string): Promise<GenerateResponse> {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ utterance }),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (payload as ApiErrorPayload | null)?.error;
    throw new ApiRequestError(error?.code ?? 'INTERNAL', error?.message ?? `请求失败（HTTP ${response.status}）`);
  }

  if (payload === null) {
    throw new ApiRequestError('INTERNAL', '服务端返回的不是合法 JSON');
  }

  return payload as GenerateResponse;
}
