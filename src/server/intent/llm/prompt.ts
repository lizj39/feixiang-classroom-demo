/**
 * Prompt 与输出解析。
 *
 * 输出被约束成**封闭结构**：能力只能是已注册的 SkillId，参数只能是数字。
 * 这样模型的产物可以直接落到 ParsedIntent 上，而不是一段需要再猜的散文。
 *
 * 为什么不让模型直接给分数或直接选 Skill：
 * 那样分数就不可复现了，trace 也没法断言。模型只负责「这句话要什么」，
 * 「给多少分、够不够阈值、要不要拒答」仍然由规则决定 —— 这是本项目的底线。
 */

import { BUG_MODES, MAX_UTTERANCE_LENGTH, SKILL_IDS, type SkillId, type SkillManifest } from '../../../contracts/index';
import { MAX_PARAM_ABS } from '../extract-params';

export function buildSystemPrompt(manifests: readonly SkillManifest[]): string {
  const catalogue = manifests
    .map(
      (manifest) =>
        `- ${manifest.id}（${manifest.displayName}）：${manifest.summary}` +
        `\n  可调参数：${manifest.params.map((param) => param.name).join(' / ') || '无'}`,
    )
    .join('\n');

  return [
    '你是一个课堂课件需求解析器。把老师的一句话读成结构化意图。',
    '',
    '可用的能力（只能从这里选，不要发明新的）：',
    catalogue,
    '',
    '输出要求：只返回 JSON，不要任何解释或代码块标记，结构如下：',
    '{',
    '  "capabilities": ["<能力 id>", ...],',
    '  "params": { "<参数名>": <数字>, ... },',
    '  "normalized": "<用标准说法复述需求，一句话>"',
    '}',
    '',
    '规则：',
    `1. capabilities 只能取上面列出的 id，没有匹配就给空数组 []。`,
    '2. params 只能给数字。能读出的函数参数用 k（斜率）与 b（截距），例如「y=3x+2」→ {"k":3,"b":2}。',
    `3. 参数绝对值不要超过 ${MAX_PARAM_ABS}；读不到就不要给这个键。`,
    '4. 中文数字要转成阿拉伯数字（「负二」→ -2）。',
    '5. 否定要尊重：「不要动画」不能推出需要动画能力。',
    '6. 不要臆测：老师没提到的能力不要放进 capabilities。',
  ].join('\n');
}

export function buildUserPrompt(utterance: string): string {
  return `老师的原话：${utterance.slice(0, MAX_UTTERANCE_LENGTH)}`;
}

export interface LlmIntentPayload {
  readonly capabilities: readonly SkillId[];
  readonly params: Readonly<Record<string, number>>;
  readonly normalized?: string;
  /** 被丢弃的非法能力标签，用于在 trace 里说明「模型说了但不算数」。 */
  readonly ignoredCapabilities: readonly string[];
}

const KNOWN_IDS = new Set<string>(SKILL_IDS);

/** 去掉模型可能加上的 ```json 围栏。 */
function stripFence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/**
 * 解析模型输出。任何「连 JSON 都不是」或「关键字段类型不对」都抛错，
 * 由上层降级到规则版 —— 绝不能把半个结果当成完整意图用。
 */
export function parseLlmIntent(content: string): LlmIntentPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(content));
  } catch {
    throw new Error('输出不是合法 JSON');
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('输出必须是 JSON 对象');
  }

  const record = raw as Record<string, unknown>;

  const capabilities: SkillId[] = [];
  const ignoredCapabilities: string[] = [];

  if (record.capabilities !== undefined) {
    if (!Array.isArray(record.capabilities)) {
      throw new Error('capabilities 必须是数组');
    }
    for (const item of record.capabilities) {
      if (typeof item !== 'string') continue;
      if (KNOWN_IDS.has(item)) {
        if (!capabilities.includes(item as SkillId)) capabilities.push(item as SkillId);
      } else {
        ignoredCapabilities.push(item);
      }
    }
  }

  const params: Record<string, number> = {};
  if (record.params !== undefined) {
    if (typeof record.params !== 'object' || record.params === null || Array.isArray(record.params)) {
      throw new Error('params 必须是对象');
    }
    for (const [key, value] of Object.entries(record.params as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (Math.abs(value) > MAX_PARAM_ABS) continue;
      params[key] = value;
    }
  }

  const normalized = typeof record.normalized === 'string' ? record.normalized.trim() : undefined;

  return {
    capabilities,
    params,
    ignoredCapabilities,
    ...(normalized === undefined || normalized.length === 0 ? {} : { normalized }),
  };
}

/** 供演示脚本与文档引用：让「模型不应该做的事」也有个常量。 */
export const LLM_FORBIDDEN_SIGNALS = ['直接给分数', '直接决定是否生成', ...BUG_MODES];
