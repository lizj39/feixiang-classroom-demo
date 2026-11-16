/**
 * LLM 版意图解析器：在规则版之上加一层「模型读意图」。
 *
 * 三个不可动摇的约束：
 *  1. **规则版永远先跑**。它的产物既提供词表证据，也是模型失败时的退路；
 *  2. **模型只产出 capabilities / params / normalized**，不产出分数、不决定是否生成；
 *  3. **任何异常都降级**：超时、HTTP 错误、非 JSON、字段类型不对 —— 一律回到规则结果，
 *     并把原因写进 `degraded`，让 trace 与界面都能看到「这次没有模型参与」。
 *
 * 参数冲突时规则版优先：公式解析是确定性的，模型反而可能把数字读错；
 * 模型的价值在于补上规则读不出的部分（「负二」这类中文数字、隐含条件）。
 */

import type { IntentParser, ParsedIntent } from '../../../contracts/index';
import type { SkillRegistry } from '../../skills/registry';
import type { LlmClient } from './client';
import { buildSystemPrompt, buildUserPrompt, parseLlmIntent } from './prompt';

export interface LlmParserOptions {
  readonly registry: SkillRegistry;
  readonly client: LlmClient;
  /** 规则版：提供词表证据，也作为失败退路。 */
  readonly fallback: IntentParser;
  readonly timeoutMs?: number;
}

export const DEFAULT_LLM_TIMEOUT_MS = 8000;

async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`超过 ${ms}ms 未返回`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createLlmIntentParser(options: LlmParserOptions): IntentParser {
  const { registry, client, fallback, timeoutMs = DEFAULT_LLM_TIMEOUT_MS } = options;

  return {
    id: 'llm',
    async parse(utterance: string): Promise<ParsedIntent> {
      // 先跑规则版：词表证据不受影响，且失败时直接拿它当结果
      const base = await fallback.parse(utterance);

      try {
        const content = await withTimeout(
          client.complete({
            system: buildSystemPrompt(registry.all()),
            user: buildUserPrompt(utterance),
          }),
          timeoutMs,
        );

        const parsed = parseLlmIntent(content);

        const merged: ParsedIntent = {
          ...base,
          capabilities: parsed.capabilities,
          // 规则版在冲突时优先（见文件头注释）
          params: { ...parsed.params, ...base.params },
          parser: 'llm',
          ...(parsed.normalized === undefined ? {} : { normalized: parsed.normalized }),
          ...(parsed.ignoredCapabilities.length === 0
            ? {}
            : { notes: [`模型给出了未注册的能力，已忽略：${parsed.ignoredCapabilities.join('、')}`] }),
        };

        return merged;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          ...base,
          degraded: { reason: `LLM 解析失败，降级到规则版：${reason}` },
        };
      }
    },
  };
}
