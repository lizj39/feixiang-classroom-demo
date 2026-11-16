import { describe, expect, it } from 'vitest';

import {
  BINDABLE_PLOT_PARAMS,
  CONFLICT_POLICY,
  CONTRACT_VERSION,
  IR_CONTENT_KINDS,
  IR_NODE_KINDS,
  SKILL_IDS,
  VERIFY_LAYER_LABEL,
  VERIFY_LAYERS,
  assertNeverPlan,
  firstFailedLayerOf,
  layerRank,
  scoreFromPoints,
  shouldGenerate,
  totalPoints,
  type Plan,
  type SkillId,
  type VerificationCheck,
  type VerifyLayer,
} from '../src/contracts/index';
import { S2_COURSEWARE, SCENARIO_CASES } from './fixtures/scenarios';

function scoreOf(plan: Plan, skill: SkillId) {
  const found = plan.scores.find((item) => item.skill === skill);
  if (!found) throw new Error(`fixtures 缺少 ${skill} 的得分明细`);
  return found;
}

function chartTitle(plan: Plan): string {
  switch (plan.type) {
    case 'single':
    case 'combo':
    case 'conflict':
      return plan.selected.join(' + ');
    case 'no_match':
      return '未选中任何 Skill';
    default:
      return assertNeverPlan(plan);
  }
}

describe('契约常量：把设计约束钉成可断言的数字', () => {
  it('IR 节点类型封顶 5 种、内容节点 4 种', () => {
    expect(IR_NODE_KINDS).toHaveLength(5);
    expect(IR_CONTENT_KINDS).toHaveLength(4);
    // 内容节点必须是全部节点去掉 page，否则渲染注册表的覆盖率断言会漏 key
    expect([...IR_CONTENT_KINDS, 'page'].sort()).toEqual([...IR_NODE_KINDS].sort());
  });

  it('Skill 集合恰好 4 个（冲突演示需要两个同槽位的练习类 Skill）', () => {
    expect(SKILL_IDS).toHaveLength(4);
    expect(new Set(SKILL_IDS).size).toBe(SKILL_IDS.length);
  });

  it('冲突策略唯一且可断言：同优先级平局一律降级澄清', () => {
    expect(CONFLICT_POLICY.rule).toBe('highest-priority-wins');
    expect(CONFLICT_POLICY.tie).toBe('degrade-to-clarify');
    expect(CONFLICT_POLICY.detect).toContain('explicit-conflictsWith');
    expect(CONFLICT_POLICY.detect).toContain('shared-slot');
  });

  it('可绑定的 plot 参数只允许数值参数，不含 domain', () => {
    expect(BINDABLE_PLOT_PARAMS).toEqual(['k', 'b']);
  });

  it('四层验证的顺序固定为 L1→L4', () => {
    expect(VERIFY_LAYERS).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(layerRank('L1')).toBeLessThan(layerRank('L4'));
    expect(VERIFY_LAYER_LABEL.L3).toContain('DOM');
  });

  it('契约版本独立于应用版本', () => {
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('fixtures：四个场景自己先得是合法的 Plan', () => {
  for (const scenario of SCENARIO_CASES) {
    const { id, plan } = scenario;

    it(`${id} 的得分明细覆盖全部 Skill，且按分数降序`, () => {
      expect(plan.scores).toHaveLength(SKILL_IDS.length);
      expect(plan.scores.map((item) => item.skill).sort()).toEqual([...SKILL_IDS].sort());

      for (const item of plan.scores) {
        expect(item.score).toBeGreaterThanOrEqual(0);
        expect(item.score).toBeLessThanOrEqual(1);
      }

      const values = plan.scores.map((item) => item.score);
      const sorted = [...values].sort((a, b) => b - a);
      expect(values).toEqual(sorted);
    });

    it(`${id} 的 reason 与 questions 与是否生成一致`, () => {
      expect(plan.reason.length).toBeGreaterThan(0);
      expect(shouldGenerate(plan)).toBe(scenario.shouldGenerate);

      if (scenario.shouldGenerate) {
        expect(plan.questions).toHaveLength(0);
      } else {
        // 拒绝生成的同时必须给出可操作的澄清，否则老师无从继续
        expect(plan.questions.length).toBeGreaterThanOrEqual(2);
        expect(new Set(plan.questions.map((q) => q.id)).size).toBe(plan.questions.length);
        for (const question of plan.questions) {
          // 澄清问题必须是个问句，否则老师看不出在等什么信息
          expect(question.question).toContain('？');
        }
      }
    });

    it(`${id} 的 selected 形态与 type 匹配`, () => {
      switch (plan.type) {
        case 'single':
          expect(plan.selected).toHaveLength(1);
          break;
        case 'combo':
          expect(plan.selected.length).toBeGreaterThanOrEqual(2);
          break;
        case 'conflict':
          expect(plan.resolution.competitors.length).toBeGreaterThanOrEqual(2);
          break;
        case 'no_match':
          expect(plan.selected).toHaveLength(0);
          break;
        default:
          assertNeverPlan(plan);
      }
      expect(chartTitle(plan).length).toBeGreaterThan(0);
    });
  }

  it('S2 的 function-plot 恰好压在阈值上，且是整数百分制算出来的', () => {
    // 60/100 在 IEEE754 下精确等于 0.6；如果用 0.5 + 0.1 累加浮点会得到 0.6000000000000001，
    // 那样「刚好达标」会被判成「不达标」。这条断言就是防止实现改回浮点累加。
    expect(scoreOf(SCENARIO_CASES[1].plan, 'function-plot').score).toBe(60 / 100);
    expect(scoreOf(SCENARIO_CASES[1].plan, 'function-plot').score).toBe(0.6);
  });

  it('S3 两个练习类 Skill 同分，才可能触发平局降级', () => {
    const plan = SCENARIO_CASES[2].plan;
    expect(scoreOf(plan, 'exercise-choice').score).toBe(scoreOf(plan, 'exercise-input').score);
  });

  it('S3 的「遮蔽」规则确实被用到：被更强 primary 覆盖的同义词不重复加分', () => {
    const plan = SCENARIO_CASES[2].plan;
    const choice = scoreOf(plan, 'exercise-choice');
    const input = scoreOf(plan, 'exercise-input');

    // '选' ⊂ '选答案'，'填' ⊂ '填答案'：同一含义不能被两层词表各加一次分
    expect(choice.shadowed).toEqual([{ token: '选', shadowedBy: '选答案', kind: 'synonym' }]);
    expect(input.shadowed).toEqual([{ token: '填', shadowedBy: '填答案', kind: 'synonym' }]);

    // 50(练习题) + 50(选答案) = 100 分 → 1.00，被遮蔽的 '选' 没有额外贡献
    expect(totalPoints(choice)).toBe(100);
    expect(choice.score).toBe(100 / 100);
  });

  it('每个得分都能由 signals 的分数复算出来（明细不能与结论脱节）', () => {
    for (const { id, plan } of SCENARIO_CASES) {
      for (const breakdown of plan.scores) {
        expect(breakdown.score, `${id} / ${breakdown.skill}`).toBe(scoreFromPoints(totalPoints(breakdown)));
        expect(breakdown.score).toBeGreaterThanOrEqual(0);
        expect(breakdown.score).toBeLessThanOrEqual(1);
      }
    }
  });

  it('本阶段的全部证据都来自词表，且分值只有 10 / 20 / 50 三档', () => {
    // P8 接入 LLM 后这条会扩展成 by: 'llm' + kind: 'capability'；现在守住「没有模型痕迹」
    for (const { plan } of SCENARIO_CASES) {
      for (const breakdown of plan.scores) {
        for (const signal of breakdown.signals) {
          expect(signal.by).toBe('lexicon');
          expect([10, 20, 50]).toContain(signal.points);
        }
      }
    }
  });

  it('Plan 可无损 JSON 往返（trace 与 API 都依赖这一点）', () => {
    for (const { plan } of SCENARIO_CASES) {
      expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    }
  });
});

describe('S2 的期望 IR：组合是否真的发生，只看绑定关系', () => {
  const page = S2_COURSEWARE.page;

  it('page 下至少有 plot 与 slider 两种节点', () => {
    const kinds = page.children.map((child) => child.kind);
    expect(kinds).toContain('plot');
    expect(kinds).toContain('slider');
  });

  it('节点 id 唯一，且带命名空间前缀', () => {
    const ids = page.children.map((child) => child.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[\w-]+:/);
    }
  });

  it('每个 slider 的 bindTo 都能解析到真实 plot 的合法参数', () => {
    const plots = page.children.filter((child) => child.kind === 'plot');
    const sliders = page.children.filter((child) => child.kind === 'slider');
    expect(sliders.length).toBeGreaterThan(0);

    for (const slider of sliders) {
      const target = plots.find((plot) => plot.id === slider.bindTo.nodeId);
      expect(target, `slider ${slider.id} 的 bindTo 指向了不存在的节点`).toBeDefined();
      if (!target) continue;

      // 只有真正落在 plot.params 上的参数才算「绑定成功」
      expect(Object.keys(target.params)).toContain(slider.bindTo.param);
      expect(BINDABLE_PLOT_PARAMS).toContain(slider.bindTo.param);

      const { min, max, value } = slider.range;
      expect(min).toBeLessThan(max);
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
    }
  });

  it('初始 k 与 plot 的 k 一致，避免「拖了之后才对齐」的假联动', () => {
    const plot = page.children.find((child) => child.kind === 'plot');
    const slider = page.children.find((child) => child.kind === 'slider');
    expect(plot).toBeDefined();
    expect(slider).toBeDefined();
    if (!plot || !slider) return;

    const param = slider.bindTo.param;
    const boundValue = param === 'k' ? plot.params.k : plot.params.b;
    expect(slider.range.value).toBe(boundValue);
  });
});

describe('验证报告：定位到最外层失败', () => {
  const check = (layer: VerifyLayer, status: VerificationCheck['status']): VerificationCheck => ({
    ruleId: `${layer}.demo`,
    layer,
    title: `${layer} 演示`,
    status,
    evidence: { kind: 'ir-path', detail: 'page.children[0]' },
  });

  it('多层失败时只报最外层，后两层算「未执行」而不是「通过」', () => {
    const checks = [
      check('L1', 'pass'),
      check('L2', 'fail'),
      check('L3', 'skipped'),
      check('L4', 'skipped'),
    ];
    expect(firstFailedLayerOf(checks)).toBe('L2');

    const downstream = checks.filter((item) => item.layer === 'L3' || item.layer === 'L4');
    expect(downstream.every((item) => item.status === 'skipped')).toBe(true);
  });

  it('全部通过时返回 null', () => {
    expect(firstFailedLayerOf([check('L1', 'pass'), check('L2', 'pass')])).toBeNull();
  });

  it('只有 L4 失败时也能报出 L4', () => {
    expect(firstFailedLayerOf([check('L1', 'pass'), check('L4', 'fail')])).toBe('L4');
  });
});
