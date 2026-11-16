/**
 * 参数抽取的验收。
 *
 * 这一层的价值是「老师说什么函数，就画什么函数」，所以用例都是真实可能的说法，
 * 不是构造出来的语法。抽不到时返回空对象 —— 由 Composer 用默认值并标注，不假装听懂。
 */

import { describe, expect, it } from 'vitest';

import { findScenario } from '../../src/contracts/index';
import { extractParams, MAX_PARAM_ABS } from '../../src/server/intent/extract-params';

describe('标准写法', () => {
  it('y=2x+1', () => {
    expect(extractParams('画一下 y=2x+1 的图像').values).toEqual({ k: 2, b: 1 });
  });

  it('带空格：y = 2x + 1', () => {
    expect(extractParams('y = 2x + 1').values).toEqual({ k: 2, b: 1 });
  });

  it('负斜率：y=-3x+2', () => {
    expect(extractParams('画 y=-3x+2').values).toEqual({ k: -3, b: 2 });
  });

  it('负截距：y=2x-5', () => {
    expect(extractParams('y=2x-5').values).toEqual({ k: 2, b: -5 });
  });

  it('小数：y=0.5x-1.5', () => {
    expect(extractParams('y=0.5x-1.5').values).toEqual({ k: 0.5, b: -1.5 });
  });

  it('系数省略：y=x → k=1, b=0', () => {
    expect(extractParams('y=x').values).toEqual({ k: 1, b: 0 });
  });

  it('只有负号：y=-x → k=-1, b=0', () => {
    expect(extractParams('y=-x').values).toEqual({ k: -1, b: 0 });
  });

  it('没有截距项：y=3x → b=0（不能落到默认的 1）', () => {
    expect(extractParams('y=3x').values).toEqual({ k: 3, b: 0 });
  });

  it('全角与大小写：Ｙ＝３Ｘ＋２', () => {
    expect(extractParams('Ｙ＝３Ｘ＋２').values).toEqual({ k: 3, b: 2 });
  });
});

describe('口语写法', () => {
  it('斜率为 -2', () => {
    expect(extractParams('画个斜率为-2的直线').values).toEqual({ k: -2 });
  });

  it('截距是 5', () => {
    expect(extractParams('截距是5').values).toEqual({ b: 5 });
  });

  it('同时说斜率与截距', () => {
    expect(extractParams('斜率是 3，截距是 -1').values).toEqual({ k: 3, b: -1 });
  });

  it('口语比公式优先（更明确）', () => {
    expect(extractParams('y=2x+1，不过斜率改成 4').values).toEqual({ k: 4, b: 1 });
  });
});

describe('抽不到时不瞎猜', () => {
  it('没有数值信息 → 空对象', () => {
    expect(extractParams('画个一次函数的图像').values).toEqual({});
  });

  it('四个示例场景的默认输入都不带参数（fixtures 不受影响）', () => {
    for (const id of ['S1', 'S2', 'S3', 'S4'] as const) {
      const utterance = findScenario(id).utterance;
      // S1 的句子里带 y=2x+1，正好等于 manifest 默认值；其余为空
      const values = extractParams(utterance).values;
      if (id === 'S1') expect(values).toEqual({ k: 2, b: 1 });
      else expect(values).toEqual({});
    }
  });

  it('离谱的值被拒绝并记录原因（不静默丢弃）', () => {
    const extraction = extractParams(`y=${MAX_PARAM_ABS + 1}x`);
    expect(extraction.values).toEqual({});
    expect(extraction.rejected[0]?.name).toBe('k');
    expect(extraction.rejected[0]?.reason).toContain(String(MAX_PARAM_ABS));
  });

  it('不规则写法不会被误读', () => {
    expect(extractParams('y = 2 x 的图像').values).toEqual({ k: 2, b: 0 });
    expect(extractParams('画2条直线').values).toEqual({});
  });
});
