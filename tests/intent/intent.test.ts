/**
 * 理解层：归一化 + 规则解析。
 *
 * 这一层最容易被写成「一个 includes 就完事」，但那会把两件事混在一起：
 * 归一化（确定性的文本处理）和意图判定（可能是模型）。这里刻意分开，
 * 因为 P8 换 LLM 时只替换后者，前者还要继续为词表通道服务。
 */

import { describe, expect, it } from 'vitest';

import { findScenario } from '../../src/contracts/index';
import { normalizeForMatching } from '../../src/server/intent/normalize';
import { createRuleIntentParser } from '../../src/server/intent/rule-parser';
import { SKILL_MANIFESTS } from '../../src/server/skills/manifests';
import { createSkillRegistry } from '../../src/server/skills/registry';

const registry = createSkillRegistry(SKILL_MANIFESTS);
const parser = createRuleIntentParser(registry);

describe('归一化', () => {
  it('全角转半角', () => {
    expect(normalizeForMatching('ｙ＝２ｘ＋１')).toBe('y=2x+1');
  });

  it('转小写', () => {
    expect(normalizeForMatching('Y=2X+1 的图像')).toBe('y=2x+1 的图像');
  });

  it('折叠空白并去首尾', () => {
    expect(normalizeForMatching('  画   个图  ')).toBe('画 个图');
  });

  it('幂等：归一化两次结果一致', () => {
    const once = normalizeForMatching('Ｙ＝２Ｘ  ＋  １ ');
    expect(normalizeForMatching(once)).toBe(once);
  });
});

describe('规则解析器', () => {
  it('S1 命中「图像」「y=」「画」三个词', async () => {
    const intent = await parser.parse(findScenario('S1').utterance);
    expect(intent.parser).toBe('rule');
    expect(intent.matchedTokens).toEqual(expect.arrayContaining(['图像', 'y=', '画']));
    // 规则版不该产出能力标签
    expect(intent.capabilities).toEqual([]);
  });

  it('S4 一个词都命中不了', async () => {
    const intent = await parser.parse(findScenario('S4').utterance);
    expect(intent.matchedTokens).toEqual([]);
  });

  it('全角与大小写不会导致漏匹配', async () => {
    const intent = await parser.parse('Ｙ＝２Ｘ＋１ 的图像');
    expect(intent.matchedTokens).toEqual(expect.arrayContaining(['图像', 'y=']));
    expect(intent.utterance).toBe('y=2x+1 的图像');
  });

  it('按原文出现顺序输出；同一位置长词在前', async () => {
    const intent = await parser.parse('选答案还是填答案？出一道一次函数练习题');
    // 「选答案」在句中位置更靠前，所以排在「填答案」之前
    expect(intent.matchedTokens.indexOf('选答案')).toBeLessThan(intent.matchedTokens.indexOf('填答案'));
    // 同一位置：长词在前，与遮蔽规则的取向一致
    expect(intent.matchedTokens.indexOf('选答案')).toBeLessThan(intent.matchedTokens.indexOf('选'));
  });

  it('同时命中长词与它的子串（消歧留给打分器的遮蔽规则）', async () => {
    const intent = await parser.parse(findScenario('S3').utterance);
    expect(intent.matchedTokens).toContain('选答案');
    expect(intent.matchedTokens).toContain('选');
  });
});
