/**
 * 前端唯一的网络出口。
 *
 * 把「HTTP 细节」和「错误信封」收敛在一个函数里，组件只处理 Phase。
 * 有一个刻意的选择：响应解析失败（比如代理返回了 HTML）不抛原始语法错误，
 * 而是转成带 code 的 ApiRequestError —— 界面上永远能显示一个有意义的错误码。
 */

import type { ApiErrorPayload, BugMode, GenerateResponse, SkillManifest, SkillsResponse } from '../contracts/index';

export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

export async function requestGenerate(utterance: string, bug?: BugMode | null): Promise<GenerateResponse> {
  // 只有服务端侧的两个故障上送；渲染器缺失是纯前端问题
  const requestBody =
    bug === 'drop-node' || bug === 'break-binding' ? { utterance, flags: { bug } } : { utterance };

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
export async function requestSkills(): Promise<readonly SkillManifest[]> {
  const response = await fetch('/api/skills');
  if (!response.ok) {
    throw new ApiRequestError('INTERNAL', `加载 Skill 清单失败（HTTP ${response.status}）`);
  }
  const payload = (await response.json()) as SkillsResponse;
  return payload.skills;
}
