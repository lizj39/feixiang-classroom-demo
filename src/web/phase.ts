/**
 * 页面的状态机。单独成文件是为了让 panels.tsx 与 App.tsx 都能引用它，
 * 而不产生组件之间的循环依赖。
 *
 * 四个状态是穷尽的：idle / loading / success / error。
 * 没有「loading 且已有旧结果」这种中间态——一次只关心一个请求，
 * 失败就明确进入 error，不做「静默保留上一次结果」的模糊处理。
 */

import type { GenerateResponse } from '../contracts/index';

export type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly utterance: string }
  | { readonly kind: 'success'; readonly response: GenerateResponse }
  | { readonly kind: 'error'; readonly code: string | null; readonly message: string };

export function isBusy(phase: Phase): boolean {
  return phase.kind === 'loading';
}
