/**
 * 规则版意图解析：拿词表在归一化后的原文里做包含匹配。
 *
 * 它只做「命中了哪些词」这一件事，不做取舍也不打分：
 *   - 不做子串消歧（`选` 与 `选答案` 会同时命中）——那是打分器里「遮蔽规则」的职责；
 *   - 不决定分值——同一个词在不同 Skill 里权重可能不同。
 *
 * 词表在构造时从注册表快照一次，长度降序排列，保证输出顺序稳定（便于断言与阅读）。
 */

import type { IntentParser, ParsedIntent } from '../../contracts/index';
import type { SkillRegistry } from '../skills/registry';
import { normalizeForMatching } from './normalize';

export function createRuleIntentParser(registry: SkillRegistry): IntentParser {
  const vocabulary = [
    ...new Set(
      registry
        .all()
        .flatMap((manifest) => registry.tokensOf(manifest.id))
        .map(normalizeForMatching)
        .filter((token) => token.length > 0),
    ),
  ].sort((a, b) => b.length - a.length);

  return {
    id: 'rule',
    async parse(utterance: string): Promise<ParsedIntent> {
      const normalized = normalizeForMatching(utterance);

      // 按原文出现顺序输出：证据读起来应该和老师那句话同序。
      // 同一位置则长词在前（`选答案` 先于 `选`），与遮蔽规则的取向一致。
      const matchedTokens = vocabulary
        .filter((token) => normalized.includes(token))
        .map((token) => ({ token, at: normalized.indexOf(token) }))
        .sort((a, b) => a.at - b.at || b.token.length - a.token.length)
        .map((item) => item.token);

      return {
        utterance: normalized,
        matchedTokens,
        // 规则版永远不产出能力标签：那个字段是给 LLM 用的
        capabilities: [],
        parser: 'rule',
      };
    },
  };
}
