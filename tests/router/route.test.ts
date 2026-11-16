/**
 * 路由的验收：四个场景必须与 fixtures 一致，边界与降级路径单独覆盖。
 *
 * 比对方式刻意只比「语义字段」（类型 / 选中集合 / 每个 Skill 的分数与证据 / 是否生成 /
 * 澄清问题数量），不比 reason 文案 —— 文案是给人看的，改措辞不该让测试变红。
 */

import { describe, expect, it } from 'vitest';

import {
  findScenario,
  shouldGenerate,
  type ConflictPlan,
  type ParsedIntent,
  type Plan,
  type SkillManifest,
} from '../../src/contracts/index';
import { createRuleIntentParser } from '../../src/server/intent/rule-parser';
import { route, SELECTION_THRESHOLD } from '../../src/server/router/route';
import { SKILL_MANIFESTS } from '../../src/server/skills/manifests';
import { createSkillRegistry, type SkillRegistry } from '../../src/server/skills/registry';
import { createTraceRecorder } from '../../src/server/trace/recorder';
import { SCENARIO_CASES } from '../fixtures/scenarios';

const registry = createSkillRegistry(SKILL_MANIFESTS);
const parser = createRuleIntentParser(registry);

async function routeWith(
  utterance: string,
  deps: { registry?: SkillRegistry; parser?: ReturnType<typeof createRuleIntentParser> } = {},
) {
  const recorder = createTraceRecorder();
  const { plan } = await route(utterance, {
    registry: deps.registry ?? registry,
    parser: deps.parser ?? parser,
    emit: recorder.emit,
  });
  return { plan, trace: recorder.toTrace('req_test') };
}

async function planFor(utterance: string): Promise<Plan> {
  return (await routeWith(utterance)).plan;
}

describe('四个场景与 fixtures 一致', () => {
  for (const { id, plan: expected, shouldGenerate: expectedGenerate } of SCENARIO_CASES) {
    it(`${id} 的形态、选中集合与打分明细`, async () => {
      const actual = await planFor(expected.utterance);

      expect(actual.type).toBe(expected.type);
      expect(shouldGenerate(actual)).toBe(expectedGenerate);
      expect([...actual.selected].sort()).toEqual([...expected.selected].sort());

      for (const expectedBreakdown of expected.scores) {
        const actualBreakdown = actual.scores.find((item) => item.skill === expectedBreakdown.skill);
        expect(actualBreakdown, `${id} 缺少 ${expectedBreakdown.skill} 的得分`).toBeDefined();
        if (!actualBreakdown) continue;

        expect(actualBreakdown.score).toBe(expectedBreakdown.score);
        expect(actualBreakdown.signals.map((signal) => signal.token)).toEqual(
          expectedBreakdown.signals.map((signal) => signal.token),
        );
        expect(actualBreakdown.shadowed).toEqual(expectedBreakdown.shadowed);
      }
    });
  }

  it('S1 是单 Skill', async () => {
    const plan = await planFor(findScenario('S1').utterance);
    expect(plan.type).toBe('single');
    expect(plan.questions).toEqual([]);
    expect(plan.reason.length).toBeGreaterThan(0);
  });

  it('S2 是组合，且两个 Skill 都在', async () => {
    const plan = await planFor(findScenario('S2').utterance);
    expect(plan.type).toBe('combo');
    expect(plan.selected).toEqual(expect.arrayContaining(['function-plot', 'interactive-slider']));
  });

  it('S3 的冲突裁决是「平局降级」，并记录两路判定依据', async () => {
    const plan = (await planFor(findScenario('S3').utterance)) as ConflictPlan;

    expect(plan.type).toBe('conflict');
    expect(plan.resolution.kind).toBe('degrade-to-clarify');
    if (plan.resolution.kind !== 'degrade-to-clarify') return;

    expect([...plan.resolution.competitors].sort()).toEqual(['exercise-choice', 'exercise-input']);
    // 显式互斥与同槽位抢占同时成立，两条依据都要记下来
    expect(plan.resolution.by).toEqual(['explicit-conflictsWith', 'shared-slot']);
    expect(plan.questions.length).toBeGreaterThanOrEqual(2);
  });

  it('S4 不生成，并给出可操作的澄清问题', async () => {
    const plan = await planFor(findScenario('S4').utterance);
    expect(plan.type).toBe('no_match');
    expect(plan.selected).toEqual([]);
    expect(shouldGenerate(plan)).toBe(false);
    expect(plan.questions.length).toBeGreaterThanOrEqual(2);
    for (const question of plan.questions) {
      expect(question.question).toContain('？');
    }
  });

  it('被淘汰的 Skill 也在 scores 里（否则「为什么没选它」无从回答）', async () => {
    const plan = await planFor(findScenario('S3').utterance);
    expect(plan.scores).toHaveLength(4);
    expect(plan.scores.find((item) => item.skill === 'interactive-slider')?.score).toBe(0);
  });
});

describe('阈值边界', () => {
  it('恰好 0.60 算达标', async () => {
    // 一次函数 50 + 演示 10 = 60
    const plan = await planFor('一次函数演示');
    expect(plan.type).toBe('single');
    expect(plan.selected).toEqual(['function-plot']);
    expect(plan.scores[0]?.score).toBe(SELECTION_THRESHOLD);
  });

  it('低于阈值一律不选，哪怕它是最高分', async () => {
    // 只命中「画」，20 分
    const plan = await planFor('画一下');
    expect(plan.type).toBe('no_match');
    expect(plan.selected).toEqual([]);
    expect(plan.scores[0]?.score).toBeLessThan(SELECTION_THRESHOLD);
  });

  it('全角/大写输入也能达标', async () => {
    const plan = await planFor('Ｙ＝２Ｘ＋１ 的图像');
    expect(plan.type).toBe('single');
    expect(plan.selected).toEqual(['function-plot']);
  });
});

describe('依赖闭包', () => {
  it('只想要滑块时，自动补入它依赖的图像 Skill，并写进 trace', async () => {
    const { plan, trace } = await routeWith('能拖动滑块看看');

    expect(plan.type).toBe('combo');
    expect([...plan.selected].sort()).toEqual(['function-plot', 'interactive-slider']);
    expect(plan.reason).toContain('组合');

    const closeStep = trace.events.find((event) => event.step === 'close-dependencies');
    expect(closeStep).toBeDefined();
    expect(JSON.stringify(closeStep?.output)).toContain('function-plot');
  });
});

describe('冲突的另一种结局：能分出胜负时继续生成', () => {
  it('把选择题的优先级调到 70 后，冲突有胜者，不再澄清', async () => {
    const manifests: SkillManifest[] = SKILL_MANIFESTS.map((manifest) =>
      manifest.id === 'exercise-choice' ? { ...manifest, priority: 70 } : manifest,
    );
    const customRegistry = createSkillRegistry(manifests);
    const customParser = createRuleIntentParser(customRegistry);

    const { plan } = await routeWith(findScenario('S3').utterance, {
      registry: customRegistry,
      parser: customParser,
    });

    expect(plan.type).toBe('conflict');
    const resolution = (plan as ConflictPlan).resolution;
    expect(resolution.kind).toBe('winner');
    if (resolution.kind !== 'winner') return;

    expect(resolution.kept).toContain('exercise-choice');
    expect(resolution.dropped).toEqual(['exercise-input']);
    expect(shouldGenerate(plan)).toBe(true);
    expect(plan.questions).toEqual([]);
  });
});

describe('trace 记录', () => {
  it('每次路由都留下可回查的链路，序号连续、每步都有决定与理由', async () => {
    const { trace } = await routeWith(findScenario('S2').utterance);

    expect(trace.events.map((event) => event.step)).toEqual([
      'parse-intent',
      'score-skills',
      'apply-threshold',
      'detect-conflicts',
    ]);
    expect(trace.events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);

    for (const event of trace.events) {
      expect(event.layer).toBe('router');
      expect(event.decision.length).toBeGreaterThan(0);
      expect(event.reason.length).toBeGreaterThan(0);
    }
  });

  it('冲突场景会多出一条 resolve-conflict', async () => {
    const { trace } = await routeWith(findScenario('S3').utterance);
    const steps = trace.events.map((event) => event.step);
    expect(steps).toContain('resolve-conflict');
    expect(steps).not.toContain('detect-conflicts');
  });

  it('打分明细被写进 trace，故障时可以对照', async () => {
    const { trace } = await routeWith(findScenario('S1').utterance);
    const scoreStep = trace.events.find((event) => event.step === 'score-skills');
    expect(JSON.stringify(scoreStep?.output)).toContain('function-plot');
    expect(JSON.stringify(scoreStep?.output)).toContain('图像+50');
  });
});

describe('LLM 能力通道接进路由', () => {
  it('只给能力标签、不给原文词，也能走到正确的组合', async () => {
    // 模拟 P8 的 LLM 解析器输出
    const fakeLlmParser = {
      id: 'llm' as const,
      parse: async (utterance: string): Promise<ParsedIntent> => ({
        utterance,
        matchedTokens: [],
        capabilities: ['function-plot', 'interactive-slider'],
        params: {},
        parser: 'llm',
        normalized: '一次函数图像 + 可拖动滑块',
      }),
    };

    const { plan } = await routeWith('让学生自己调参数看看', { parser: fakeLlmParser });
    expect(plan.type).toBe('combo');
    expect([...plan.selected].sort()).toEqual(['function-plot', 'interactive-slider']);

    // 证据来源必须标成 llm，不能冒充词表命中
    const plot = plan.scores.find((item) => item.skill === 'function-plot');
    expect(plot?.signals.every((signal) => signal.by === 'llm')).toBe(true);
  });
});
