/**
 * IR 校验器的验收。
 *
 * 每条规则都对应一种「画出来才发现不对」的故障，所以断言的是 rule 名（稳定），
 * 不是错误文案（会改）。
 */

import { describe, expect, it } from 'vitest';

import type { Courseware, IrContentNode, IrPlotNode, IrSliderNode } from '../../src/contracts/index';
import { validateCourseware } from '../../src/server/ir/validate';

const PLOT: IrPlotNode = {
  kind: 'plot',
  id: 'function-plot:plot-1',
  source: 'function-plot',
  params: { k: 2, b: 1, domain: { xMin: -5, xMax: 5 } },
};

const SLIDER: IrSliderNode = {
  kind: 'slider',
  id: 'interactive-slider:slider-1',
  source: 'interactive-slider',
  label: '斜率 k',
  bindTo: { nodeId: PLOT.id, param: 'k' },
  range: { min: -3, max: 3, step: 0.5, value: 2 },
};

function coursewareOf(children: IrContentNode[]): Courseware {
  return {
    irVersion: 1,
    page: { kind: 'page', id: 'composer:page', source: 'composer', title: '一次函数', children },
  };
}

function rules(courseware: Courseware): string[] {
  return validateCourseware(courseware).map((violation) => violation.rule);
}

describe('合法 IR', () => {
  it('plot + slider + text 的组合没有任何违规', () => {
    const courseware = coursewareOf([
      { kind: 'text', id: 'composer:title', source: 'composer', variant: 'title', content: '一次函数' },
      PLOT,
      SLIDER,
    ]);
    expect(validateCourseware(courseware)).toEqual([]);
  });
});

describe('结构规则', () => {
  it('id 重复 → ids-unique', () => {
    const duplicated = { ...PLOT, id: 'same' } as IrPlotNode;
    const another = { ...PLOT, id: 'same' } as IrPlotNode;
    expect(rules(coursewareOf([duplicated, another]))).toContain('ids-unique');
  });

  it('文本节点内容为空 → text-content', () => {
    const emptyText: IrContentNode = { kind: 'text', id: 't', source: 'composer', variant: 'body', content: '   ' };
    expect(rules(coursewareOf([emptyText]))).toContain('text-content');
  });

  it('非内容节点混进 children → node-kind', () => {
    const page = { kind: 'page', id: 'inner', source: 'composer', title: 'x', children: [] } as unknown as IrContentNode;
    expect(rules(coursewareOf([page]))).toContain('node-kind');
  });
});

describe('绑定规则（最典型的「滑块在，但拖的是空气」）', () => {
  it('bindTo 指向不存在的节点 → binding-resolves', () => {
    const dangling = { ...SLIDER, bindTo: { nodeId: 'nope', param: 'k' as const } };
    expect(rules(coursewareOf([PLOT, dangling]))).toContain('binding-resolves');
  });

  it('绑定不可绑定的参数 → binding-param', () => {
    const bad = { ...SLIDER, bindTo: { nodeId: PLOT.id, param: 'domain' as unknown as 'k' } };
    expect(rules(coursewareOf([PLOT, bad]))).toContain('binding-param');
  });

  it('初始值越界 → params-in-range', () => {
    const outOfRange = { ...SLIDER, range: { ...SLIDER.range, value: 99 } };
    expect(rules(coursewareOf([PLOT, outOfRange]))).toContain('params-in-range');
  });

  it('初始值与图像参数不一致 → initial-value-matches-plot（进页面就对不上）', () => {
    const mismatched = { ...SLIDER, range: { ...SLIDER.range, value: -1 } };
    expect(rules(coursewareOf([PLOT, mismatched]))).toContain('initial-value-matches-plot');
  });

  it('滑块区间非法 → range-order / range-step', () => {
    const badRange = { ...SLIDER, range: { min: 3, max: -3, step: 0, value: 0 } };
    const found = rules(coursewareOf([PLOT, badRange]));
    expect(found).toContain('range-order');
    expect(found).toContain('range-step');
  });
});

describe('图像参数', () => {
  it('NaN 参数 → plot-params-finite（会画出 M NaN NaN）', () => {
    const nanPlot = { ...PLOT, params: { ...PLOT.params, k: Number.NaN } };
    expect(rules(coursewareOf([nanPlot]))).toContain('plot-params-finite');
  });

  it('domain 反向 → plot-domain', () => {
    const badDomain = { ...PLOT, params: { ...PLOT.params, domain: { xMin: 5, xMax: -5 } } };
    expect(rules(coursewareOf([badDomain]))).toContain('plot-domain');
  });

  it('k = 0 是合法的水平直线，不能被拒', () => {
    const flat = { ...PLOT, params: { ...PLOT.params, k: 0 } };
    expect(validateCourseware(coursewareOf([flat]))).toEqual([]);
  });
});

describe('练习题一致性', () => {
  const base = {
    kind: 'exercise' as const,
    id: 'exercise-choice:exercise-1',
    source: 'exercise-choice',
    prompt: '选出正确选项',
    answer: 'A',
  };

  it('选择题缺选项 → exercise-mode-coherent', () => {
    expect(rules(coursewareOf([{ ...base, mode: 'choice' }]))).toContain('exercise-mode-coherent');
  });

  it('选择题答案不在选项里 → exercise-mode-coherent', () => {
    const bad = { ...base, mode: 'choice' as const, choices: ['B', 'C'] };
    expect(rules(coursewareOf([bad]))).toContain('exercise-mode-coherent');
  });

  it('填空题带选项 → exercise-mode-coherent', () => {
    const bad = { ...base, mode: 'input' as const, choices: ['A', 'B'] };
    expect(rules(coursewareOf([bad]))).toContain('exercise-mode-coherent');
  });

  it('合法的选择题没有违规', () => {
    const good = { ...base, mode: 'choice' as const, choices: ['A', 'B'] };
    expect(validateCourseware(coursewareOf([good]))).toEqual([]);
  });
});

describe('错误聚合', () => {
  it('一次返回全部问题，不是遇到第一个就停', () => {
    const broken = coursewareOf([
      { kind: 'text', id: 't', source: 'composer', variant: 'body', content: '' },
      { ...PLOT, params: { ...PLOT.params, k: Number.NaN } },
      { ...SLIDER, bindTo: { nodeId: 'nope', param: 'k' as const } },
    ]);

    const found = validateCourseware(broken);
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found.map((violation) => violation.path)).toContain('page.children[1].params.k');
  });
});
