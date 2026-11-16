/**
 * 打分器：整数百分制、遮蔽、LLM 能力通道、封顶。
 *
 * 这里刻意用「直接构造 ParsedIntent」的方式测，不经过解析器 ——
 * 打分的输入是意图，不是自然语言。这样 LLM 版解析器的输出也能直接喂进来验证。
 */

import { describe, expect, it } from 'vitest';

import { totalPoints, type ParsedIntent, type SkillManifest } from '../../src/contracts/index';
import { scoreAll, scoreSkill, SIGNAL_POINTS } from '../../src/server/router/score';
import { SKILL_MANIFESTS } from '../../src/server/skills/manifests';

function intentOf(overrides: Partial<ParsedIntent> = {}): ParsedIntent {
  return { utterance: 'x', matchedTokens: [], capabilities: [], params: {}, parser: 'rule', ...overrides };
}

function manifestOf(id: SkillManifest['id']): SkillManifest {
  const found = SKILL_MANIFESTS.find((manifest) => manifest.id === id);
  if (!found) throw new Error(`fixture 缺少 ${id}`);
  return found;
}

describe('分值档位', () => {
  it('primary 50 / synonym 20 / intent 10 / capability 60', () => {
    expect(SIGNAL_POINTS).toEqual({ primary: 50, synonym: 20, intent: 10, capability: 60 });
  });
});

describe('词表通道', () => {
  it('S1 的 function-plot 得 0.90，三段证据都在', () => {
    const breakdown = scoreSkill(manifestOf('function-plot'), intentOf({ matchedTokens: ['图像', 'y=', '画'] }));
    expect(breakdown.score).toBe(0.9);
    expect(breakdown.signals.map((signal) => signal.token)).toEqual(['图像', 'y=', '画']);
    expect(breakdown.signals.every((signal) => signal.by === 'lexicon')).toBe(true);
    expect(breakdown.shadowed).toEqual([]);
  });

  it('不属于该 Skill 的词不计分', () => {
    const breakdown = scoreSkill(manifestOf('function-plot'), intentOf({ matchedTokens: ['滑块', '拖动'] }));
    expect(breakdown.score).toBe(0);
    expect(breakdown.signals).toEqual([]);
  });

  it('强信号排在前面，便于界面阅读', () => {
    const breakdown = scoreSkill(manifestOf('function-plot'), intentOf({ matchedTokens: ['演示', '一次函数'] }));
    expect(breakdown.signals.map((signal) => signal.points)).toEqual([50, 10]);
  });
});

describe('遮蔽规则', () => {
  it('短词是长词的子串时不重复加分，并记录被谁遮挡', () => {
    const breakdown = scoreSkill(manifestOf('exercise-choice'), intentOf({ matchedTokens: ['选答案', '选'] }));

    expect(breakdown.signals.map((signal) => signal.token)).toEqual(['选答案']);
    expect(breakdown.shadowed).toEqual([{ token: '选', shadowedBy: '选答案', kind: 'synonym' }]);
    // 只算 50 分（选答案），不是 70 分
    expect(breakdown.score).toBe(0.5);
  });

  it('不是子串关系的词互不影响', () => {
    const breakdown = scoreSkill(manifestOf('exercise-choice'), intentOf({ matchedTokens: ['练习题', '选答案'] }));
    expect(breakdown.shadowed).toEqual([]);
    expect(breakdown.score).toBe(1);
  });
});

describe('LLM 能力通道', () => {
  it('能力标签按 50 分计入，来源标记为 llm', () => {
    const breakdown = scoreSkill(
      manifestOf('interactive-slider'),
      intentOf({ capabilities: ['interactive-slider'], parser: 'llm' }),
    );

    expect(breakdown.signals).toEqual([
      { token: 'interactive-slider', kind: 'capability', points: 60, by: 'llm' },
    ]);
    // 60 分恰好等于阈值：单个能力标签就能让这个 Skill 达标，
    // 否则「接了 LLM 反而比词表更难选中」——这是测试发现的一个真实设计缺陷
    expect(breakdown.score).toBe(0.6);
  });

  it('词表证据与模型证据同时存在时各自保留来源', () => {
    const breakdown = scoreSkill(
      manifestOf('interactive-slider'),
      intentOf({ matchedTokens: ['拖动'], capabilities: ['interactive-slider'], parser: 'llm' }),
    );

    const sources = new Set(breakdown.signals.map((signal) => signal.by));
    expect(sources).toEqual(new Set(['lexicon', 'llm']));
    expect(breakdown.score).toBe(1);
  });
});

describe('封顶', () => {
  it('原始分超过 100 时，展示分数封顶为 1.00', () => {
    const breakdown = scoreSkill(
      manifestOf('function-plot'),
      intentOf({ matchedTokens: ['一次函数', '函数图像', '画图'] }),
    );

    expect(totalPoints(breakdown)).toBe(150);
    expect(breakdown.score).toBe(1);
  });
});

describe('scoreAll', () => {
  it('按分数降序，并覆盖全部 Skill', () => {
    const scores = scoreAll(SKILL_MANIFESTS, intentOf({ matchedTokens: ['滑块', '拖动'] }));
    expect(scores).toHaveLength(4);
    expect(scores[0]?.skill).toBe('interactive-slider');
    expect(scores.map((item) => item.score)).toEqual([...scores.map((item) => item.score)].sort((a, b) => b - a));
  });
});
