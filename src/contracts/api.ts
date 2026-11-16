/**
 * 传输层契约：请求 / 响应信封。
 *
 * 为什么单独成文件：plan / ir / trace / verification 四个契约只描述「内容」，
 * 没有一个对象把它们串起来。前后端共用这个信封，接口改字段时两边同时编译报错，
 * 不会出现「前端改了后端没改」这种只能靠跑起来才发现的问题。
 *
 * 信封一旦定下就保持稳定：P1 阶段 plan/courseware/trace/verification 全是 null，
 * 到 P3/P4/P6 逐个填上，前端不需要改结构。
 */

import type { Courseware } from './ir';
import type { Plan } from './plan';
import type { Trace } from './trace';
import type { VerificationReport } from './verification';

export const API_VERSION = 1 as const;

/** 单条需求的长度上限。前后端共用，避免前端放行、后端 400 的错配。 */
export const MAX_UTTERANCE_LENGTH = 200;

export interface GenerateRequest {
  readonly utterance: string;
}

/**
 * 错误码是封闭集合：前端可以按 code 分支，而不是靠匹配文案。
 * `field` 只在能定位到具体字段时出现，便于前端把错误挂到输入框上。
 */
export type ApiErrorCode = 'EMPTY_UTTERANCE' | 'TOO_LONG' | 'INVALID_BODY' | 'NOT_FOUND' | 'INTERNAL';

export interface ApiErrorPayload {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly field?: string;
  };
}

export interface GenerateResponse {
  readonly apiVersion: typeof API_VERSION;
  /** 服务端生成，贯穿 trace 与验证报告，用于把一次请求的日志串起来。 */
  readonly requestId: string;
  readonly receivedAt: string;
  /** 归一化后的需求回声。前端据此确认「服务端读到的就是我输入的」。 */
  readonly utterance: string;
  readonly plan: Plan | null;
  readonly courseware: Courseware | null;
  readonly trace: Trace | null;
  readonly verification: VerificationReport | null;
}

export type UtteranceCheck =
  | { readonly ok: true; readonly utterance: string }
  | { readonly ok: false; readonly code: ApiErrorCode; readonly message: string };

/**
 * 需求文本的读取与规范化。纯函数，前后端都能用：
 *  - 折叠连续空白，避免「看起来是空」的输入绕过校验；
 *  - 长度按规范化后的字符数算，而不是原始长度。
 */
export function readUtterance(raw: unknown): UtteranceCheck {
  // 字段缺失和空字符串是同一件事：老师没说要什么。分开报错只会让前端多写一个分支。
  if (raw === undefined) {
    return { ok: false, code: 'EMPTY_UTTERANCE', message: '请先输入需求' };
  }
  // 传了别的东西（数字、对象、null）才是类型错误，这是客户端的 bug，要能区分出来
  if (typeof raw !== 'string') {
    return { ok: false, code: 'INVALID_BODY', message: 'utterance 必须是字符串' };
  }

  const collapsed = raw.trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0) {
    return { ok: false, code: 'EMPTY_UTTERANCE', message: '请先输入需求' };
  }
  if (collapsed.length > MAX_UTTERANCE_LENGTH) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `需求最多 ${MAX_UTTERANCE_LENGTH} 个字符，当前 ${collapsed.length} 个`,
    };
  }
  return { ok: true, utterance: collapsed };
}
