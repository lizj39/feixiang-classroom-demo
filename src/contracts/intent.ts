/**
 * 理解层契约：把「一句人话」变成「可打分的意图证据」。
 *
 * 为什么要单独抽出这一层：P8 会接 LLM 做理解。如果现在把关键词匹配直接写在
 * 打分函数里，将来换 LLM 就得改打分函数本身 —— 那等于把可解释性和可测试性一起换掉。
 * 抽出 IntentParser 之后，LLM 只是同一接口的另一个实现，下游（打分/阈值/冲突）一行不改。
 *
 * 三档证据来源，必须分得开：
 *   matchedTokens —— 词表在原文里真的匹配到的词（可指给老师看）
 *   capabilities  —— LLM 读出的能力（原文里可能没有对应的词，P8 才会非空）
 *   normalized    —— LLM 对需求的标准化复述（只展示与写 trace，不参与打分）
 */

import type { SkillId } from './skill';

/**
 * 注意：`matchedTokens` 只记词，不记「这个词在某个 Skill 里算强信号还是弱信号」——
 * 同一个词（如「练习题」）可能在一个 Skill 里是 primary、在另一个里也是 primary，
 * 但分值归属必须由打分器按各自 manifest 重新判断，否则解析器就替打分器做了决定。
 */
export interface ParsedIntent {
  /** 归一化后的原文（去空白、全角转半角、小写）。回声与打分的基准。 */
  readonly utterance: string;
  /** 词表在原文里真的匹配到的词（已归一化）。 */
  readonly matchedTokens: readonly string[];
  /** LLM 判定的能力。规则版恒为空数组。 */
  readonly capabilities: readonly SkillId[];
  readonly parser: 'rule' | 'llm';
  /** LLM 的标准化复述，仅用于展示与 trace；不参与打分。 */
  readonly normalized?: string;
  /** LLM 失败后降级到规则版时填这里，让 trace 能解释「为什么这次没有模型参与」。 */
  readonly degraded?: { readonly reason: string };
}

export interface IntentParser {
  readonly id: 'rule' | 'llm';
  parse(utterance: string): Promise<ParsedIntent>;
}

/** 空意图：什么都没命中。S4 这类场景会走到这里。 */
export function emptyIntent(utterance: string, parser: 'rule' | 'llm'): ParsedIntent {
  return { utterance, matchedTokens: [], capabilities: [], parser };
}
