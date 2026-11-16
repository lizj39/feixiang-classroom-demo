/**
 * 前端唯一的网络出口。
 *
 * 把「HTTP 细节」和「错误信封」收敛在一个函数里，组件只处理 Phase。
 * 有一个刻意的选择：响应解析失败（比如代理返回了 HTML）不抛原始语法错误，
 * 而是转成带 code 的 ApiRequestError —— 界面上永远能显示一个有意义的错误码。
 */

import type { ApiErrorPayload, BugMode, GenerateResponse, ParserMode, SkillsResponse } from '../contracts/index';

export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

export interface GenerateOptions {
  readonly bug?: BugMode | null;
  readonly parser?: ParserMode | null;
}

export async function requestGenerate(
  utterance: string,
  options: GenerateOptions = {},
): Promise<GenerateResponse> {
  // 只有服务端侧的两个故障上送；渲染器缺失是纯前端问题
  const serverBug = options.bug === 'drop-node' || options.bug === 'break-binding' ? options.bug : undefined;
  const parser = options.parser ?? undefined;

  const flags = {
    ...(serverBug === undefined ? {} : { bug: serverBug }),
    ...(parser === undefined ? {} : { parser }),
  };

  const requestBody = Object.keys(flags).length > 0 ? { utterance, flags } : { utterance };

  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
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

/**
 * 拉取已注册的 Skill 清单。
 * 失败时抛错由调用方决定怎么显示 —— 这块信息是「解释性」的，
 * 拿不到不应该阻塞主流程（生成课件仍然可用）。
 */
export async function requestSkills(): Promise<SkillsResponse> {
  const response = await fetch('/api/skills');
  if (!response.ok) {
    throw new ApiRequestError('INTERNAL', `加载 Skill 清单失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as SkillsResponse;
}
