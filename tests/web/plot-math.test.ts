/**
 * 画图几何的数值断言。
 *
 * 「拖动后图像变了」不算验证 —— 变错也是变。所以这里断言的是**具体像素**：
 * 给定 y = kx + b，直线必须落在该落的位置，x/y 还必须同比例尺。
 */

import { describe, expect, it } from 'vitest';

import type { PlotParams } from '../../src/contracts/index';
import { createProjection, linePath, PLOT_VIEW, valueAt } from '../../src/web/render/plot-math';

const DOMAIN = { xMin: -5, xMax: 5 };

function paramsOf(k: number, b = 1): PlotParams {
  return { k, b, domain: DOMAIN };
}

describe('视野', () => {
  it('x/y 使用同一比例尺：1 个单位在两个方向上都是 48px', () => {
    const projection = createProjection(paramsOf(2), PLOT_VIEW);
    const origin = projection.toPixel(0, 0);
    const oneUnitRight = projection.toPixel(1, 0);
    const oneUnitUp = projection.toPixel(0, 1);

    expect(oneUnitRight.px - origin.px).toBeCloseTo(48, 5);
    expect(origin.py - oneUnitUp.py).toBeCloseTo(48, 5);
  });

  it('纵向中心取 b：直线与 y 轴的交点始终在画面垂直中央', () => {
    const projection = createProjection(paramsOf(2), PLOT_VIEW);
    // b = 1，x = 0 → 应该在画布正中（240, 150）
    expect(projection.toPixel(0, 1)).toEqual({ px: 240, py: 150 });
  });

  it('拖动 k 时视野不缩放（否则看不出直线在转）', () => {
    const shallow = createProjection(paramsOf(0.5), PLOT_VIEW);
    const steep = createProjection(paramsOf(3), PLOT_VIEW);
    expect(shallow.yMin).toBe(steep.yMin);
    expect(shallow.yMax).toBe(steep.yMax);
  });
});

describe('直线路径', () => {
  it('k=2,b=1 的端点坐标可手算核对', () => {
    // xMin=-5 → y=-9，落在画布下方（py>300）；xMax=5 → y=11，落在画布上方（py<0）
    expect(linePath(paramsOf(2))).toBe('M 0 630 L 480 -330');
  });

  it('k 变化时路径随之变化', () => {
    expect(linePath(paramsOf(2))).not.toBe(linePath(paramsOf(-1)));
  });

  it('k=0 是水平线：两个端点等高', () => {
    const [start, end] = linePath(paramsOf(0)).split(' L ');
    expect(start?.split(' ')[2]).toBe(end?.split(' ')[1]);
  });
});

describe('采样点（行为层断言的基础）', () => {
  it('k=-1,b=1 时，x=2 处的点落在 (336, 246)', () => {
    const projection = createProjection(paramsOf(-1), PLOT_VIEW);
    const y = valueAt(paramsOf(-1), 2);
    expect(y).toBe(-1);
    expect(projection.toPixel(2, y)).toEqual({ px: 336, py: 246 });
  });

  it('valueAt 与一次函数定义一致', () => {
    expect(valueAt(paramsOf(2, 1), 0)).toBe(1);
    expect(valueAt(paramsOf(2, 1), 3)).toBe(7);
    expect(valueAt(paramsOf(-2, 1), 3)).toBe(-5);
  });
});
