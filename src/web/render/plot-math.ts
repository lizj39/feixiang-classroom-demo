/**
 * 画图用的几何计算。纯函数，不碰 DOM —— 所以「画得对不对」可以用数值断言，
 * 而不是靠人眼看截图。
 *
 * 关键决定：**x 与 y 用同一比例尺**。y 跨度由画布宽高比反推，纵向中心取 `b`
 * （直线与 y 轴的交点）。这样：
 *   - 拖动 k 时视野不缩放，看到的是直线真的在旋转，而不是「图跟着变但看不出方向」；
 *   - 斜率 1 的直线在屏幕上就是 45°，老师不会觉得别扭。
 */

import type { PlotParams } from '../../contracts/index';

export interface PlotViewport {
  readonly width: number;
  readonly height: number;
}

/** 画布尺寸（SVG viewBox 单位）。 */
export const PLOT_VIEW: PlotViewport = { width: 480, height: 300 };

export interface Pixel {
  readonly px: number;
  readonly py: number;
}

export interface Projection {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  toPixel(x: number, y: number): Pixel;
}

export function createProjection(params: PlotParams, view: PlotViewport = PLOT_VIEW): Projection {
  const { xMin, xMax } = params.domain;
  const spanX = xMax - xMin;
  const spanY = spanX * (view.height / view.width);
  const centerY = params.b;
  const yMin = centerY - spanY / 2;
  const yMax = centerY + spanY / 2;

  return {
    xMin,
    xMax,
    yMin,
    yMax,
    toPixel(x: number, y: number): Pixel {
      return {
        // 像素精度到 0.01：既够画图，也让 d 属性与测试断言都不被浮点尾差污染
        px: round(((x - xMin) / spanX) * view.width),
        py: round(((yMax - y) / spanY) * view.height),
      };
    },
  };
}

export function valueAt(params: PlotParams, x: number): number {
  return params.k * x + params.b;
}

/** 直线路径：两个端点取自 x 定义域，超出画布的部分由 SVG 自行裁掉。 */
export function linePath(params: PlotParams, view: PlotViewport = PLOT_VIEW): string {
  const projection = createProjection(params, view);
  const start = projection.toPixel(params.domain.xMin, valueAt(params, params.domain.xMin));
  const end = projection.toPixel(params.domain.xMax, valueAt(params, params.domain.xMax));

  return `M ${start.px} ${start.py} L ${end.px} ${end.py}`;
}

/** 保留两位小数：既能被测试精确比较，也不会让 d 属性过长。 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
