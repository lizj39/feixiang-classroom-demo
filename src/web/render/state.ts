/**
 * 课件里「滑块值 → 图像参数」的状态层。
 *
 * 单独抽出来的理由：这是整个 Demo 里最容易出「假联动」的地方 ——
 * 滑块动了、state 变了、但图像用的是自己的 props，看起来一切正常。
 * 抽成纯函数之后，`resolveParams` 可以被单独断言，P7 的故障也能定位到这一层。
 */

import type { BindablePlotParam, Courseware, IrPlotNode, PlotParams } from '../../contracts/index';

/** plotId → 参数 → 覆盖值。只存被滑块接管的参数，其余沿用 IR 里的初始值。 */
export type ParamOverrides = Readonly<Record<string, Partial<Record<BindablePlotParam, number>>>>;

/** 从 IR 里收集滑块的初始值。换课件时用它重置状态。 */
export function initialOverrides(courseware: Courseware): ParamOverrides {
  const overrides: Record<string, Partial<Record<BindablePlotParam, number>>> = {};

  for (const node of courseware.page.children) {
    if (node.kind !== 'slider') continue;
    const current = overrides[node.bindTo.nodeId] ?? {};
    overrides[node.bindTo.nodeId] = { ...current, [node.bindTo.param]: node.range.value };
  }

  return overrides;
}

/** IR 初始参数 + 滑块覆盖值 → 真正用于绘制的一次函数参数。 */
export function resolveParams(plot: IrPlotNode, overrides: ParamOverrides): PlotParams {
  const patch = overrides[plot.id];
  if (!patch) return plot.params;

  return {
    ...plot.params,
    ...(patch.k === undefined ? {} : { k: patch.k }),
    ...(patch.b === undefined ? {} : { b: patch.b }),
  };
}

/** 只更新某一个 plot 的某一个参数，其余保持不变。 */
export function withParam(
  overrides: ParamOverrides,
  plotId: string,
  param: BindablePlotParam,
  value: number,
): ParamOverrides {
  const current = overrides[plotId] ?? {};
  return { ...overrides, [plotId]: { ...current, [param]: value } };
}
