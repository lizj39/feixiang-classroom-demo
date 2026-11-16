/**
 * 解析器选择：一处分叉，三个输入。
 *
 *   flags.parser = 'rule' → 强制规则版
 *   flags.parser = 'llm'  → 要 LLM；没配置就降级并在 trace 里写明原因
 *   flags.parser 缺省     → auto：配了 key 用 LLM，没配用规则
 *
 * 这样「面试官没配 key」与「配了 key 但服务挂了」都不影响演示 ——
 * 只是降级，不是失败。
 */

import type { IntentParser, ParsedIntent, ParserMode } from '../../contracts/index';
import type { SkillRegistry } from '../skills/registry';
import { createRuleIntentParser } from './rule-parser';
import {
  createOpenAiCompatibleClient,
  type LlmClient,
  type LlmConfig,
} from './llm/client';
import { createLlmIntentParser } from './llm/parser';

export interface ParserFactoryOptions {
  readonly registry: SkillRegistry;
  readonly config: LlmConfig;
  /** 测试注入用；生产走全局 fetch。 */
  readonly client?: LlmClient;
  readonly timeoutMs?: number;
}

export interface ParserSelection {
  readonly parser: IntentParser;
  /** 这次是否会真的调用模型。界面与 trace 都用它来避免「以为在用 LLM」。 */
  readonly usedLlm: boolean;
  /** 想看 LLM 但条件不具备时，给出原因。 */
  readonly reason?: string;
}

export function createParserFactory(options: ParserFactoryOptions) {
  const { registry, config, timeoutMs } = options;
  const rule = createRuleIntentParser(registry);

  const llmClient =
    options.client ??
    (config.enabled
      ? createOpenAiCompatibleClient({ baseUrl: config.baseUrl, model: config.model, apiKey: config.apiKey })
      : null);

  const llm =
    llmClient === null ? null : createLlmIntentParser({ registry, client: llmClient, fallback: rule, ...(timeoutMs === undefined ? {} : { timeoutMs }) });

  return (mode?: ParserMode): ParserSelection => {
    if (mode === 'rule') {
      return { parser: rule, usedLlm: false };
    }

    if (llm !== null) {
      return { parser: llm, usedLlm: true };
    }

    // 想要 LLM 但没有可用客户端：退回规则版，并且不留悬念地说明原因
    const reason = '未配置 LLM_API_KEY，已降级到规则版';
    const degradedRule: IntentParser = {
      id: 'rule',
      parse: async (utterance: string): Promise<ParsedIntent> => ({
        ...(await rule.parse(utterance)),
        degraded: { reason },
      }),
    };

    return mode === 'llm'
      ? { parser: degradedRule, usedLlm: false, reason }
      : { parser: rule, usedLlm: false, reason };
  };
}
