/**
 * 浏览器侧的两层验证：L3 DOM、L4 行为。
 *
 * L4 是这份作业最要紧的一条：题面说「日志显示互动 Skill 已调用，但课件里没有滑块」，
 * 而这里要抓的更进一步 —— **滑块在，但拖了不更新**。
 * 所以 L4 不比对「path 变了没有」，而是比对「拖完之后 path 是否等于用新参数算出的路径」。
 *
 * 实现上真的去驱动 DOM（设置 value + 派发 input 事件），因为只有这样才能覆盖
 * 「组件没接上 onChange」这类问题；代价是会短暂改变界面，所以读完立刻复原。
 */

import type { Courseware, IrPlotNode, IrSliderNode, VerificationCheck } from '../../contracts/index';
import { linePath, PLOT_VIEW } from '../render/plot-math';

function check(
  ruleId: string,
  layer: 'L3' | 'L4',
  title: string,
  status: VerificationCheck['status'],
  detail: string,
  extra: { expected?: unknown; actual?: unknown; blockedReason?: string } = {},
): VerificationCheck {
  return {
    ruleId,
    layer,
    title,
    status,
    evidence: { kind: layer === 'L3' ? 'dom' : 'behavior', detail },
    ...(extra.expected === undefined ? {} : { expected: extra.expected }),
    ...(extra.actual === undefined ? {} : { actual: extra.actual }),
    ...(extra.blockedReason === undefined ? {} : { blockedReason: extra.blockedReason }),
  };
}

function slidersOf(courseware: Courseware): IrSliderNode[] {
  return courseware.page.children.filter((node): node is IrSliderNode => node.kind === 'slider');
}

function plotsOf(courseware: Courseware): IrPlotNode[] {
  return courseware.page.children.filter((node): node is IrPlotNode => node.kind === 'plot');
}

export function checkDomStructure(courseware: Courseware, root: ParentNode): VerificationCheck[] {
  const expectedSliders = slidersOf(courseware).length;
  const expectedPlots = plotsOf(courseware).length;

  const rangeInputs = root.querySelectorAll('input[type="range"]');
  const plotPaths = root.querySelectorAll('[data-testid="plot-line"]');
  const renderedNodes = root.querySelectorAll('[data-kind]');

  return [
    check(
      'L3.dom.range-present',
      'L3',
      'DOM 里的滑块数量与 IR 一致',
      rangeInputs.length === expectedSliders ? 'pass' : 'fail',
      'input[type="range"]',
      { expected: expectedSliders, actual: rangeInputs.length },
    ),
    check(
      'L3.dom.controls-match-ir',
      'L3',
      '渲染出的节点数量与 IR 一致',
      renderedNodes.length === courseware.page.children.length && plotPaths.length === expectedPlots ? 'pass' : 'fail',
      '[data-kind] ↔ page.children',
      {
        expected: { nodes: courseware.page.children.length, plots: expectedPlots },
        actual: { nodes: renderedNodes.length, plots: plotPaths.length },
      },
    ),
  ];
}

/** 让 React 看到值的变化：必须走原生 setter + 派发 input 事件。 */
function setNativeValue(input: HTMLInputElement, value: number): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function checkBehavior(courseware: Courseware, root: ParentNode): Promise<VerificationCheck[]> {
  const sliders = slidersOf(courseware);

  if (sliders.length === 0) {
    return [
      check('L4.behavior.slider-updates-plot', 'L4', '拖动滑块后图像按公式重算', 'skipped', '（本次课件没有滑块）', {
        blockedReason: '没有可交互的控件，行为验证不适用',
      }),
    ];
  }

  const slider = sliders[0];
  if (!slider) {
    return [
      check('L4.behavior.slider-updates-plot', 'L4', '拖动滑块后图像按公式重算', 'skipped', '（本次课件没有滑块）', {
        blockedReason: '没有可交互的控件，行为验证不适用',
      }),
    ];
  }

  const plot = plotsOf(courseware).find((node) => node.id === slider.bindTo.nodeId);
  const input = root.querySelector('input[type="range"]') as HTMLInputElement | null;
  const path = root.querySelector('[data-testid="plot-line"]');

  if (!plot || !input || !path) {
    return [
      check('L4.behavior.slider-updates-plot', 'L4', '拖动滑块后图像按公式重算', 'fail', 'input[type="range"] / plot-line', {
        blockedReason: '缺少滑块或图像，无法验证行为',
      }),
    ];
  }

  const original = Number(input.value);
  const next = original + slider.range.step <= slider.range.max ? original + slider.range.step : original - slider.range.step;

  if (next === original) {
    return [
      check('L4.behavior.slider-updates-plot', 'L4', '拖动滑块后图像按公式重算', 'skipped', `${slider.id}.range`, {
        blockedReason: '滑块区间没有可移动的余量',
      }),
    ];
  }

  const before = path.getAttribute('d');

  setNativeValue(input, next);
  await nextTick();
  const after = path.getAttribute('d');

  // 立刻复原，避免用户看到滑块被系统偷偷推了一下
  setNativeValue(input, original);
  await nextTick();

  const expected = linePath({ ...plot.params, [slider.bindTo.param]: next }, PLOT_VIEW);
  const updated = after !== before;

  return [
    check(
      'L4.behavior.slider-updates-plot',
      'L4',
      '拖动滑块后图像按公式重算',
      updated && after === expected ? 'pass' : 'fail',
      `input[type="range"].value=${next} → ${plot.id}.path.d`,
      {
        expected,
        actual: after,
        ...(updated ? {} : { blockedReason: '拖动后图像没有变化，说明滑块没有接上绑定' }),
      },
    ),
  ];
}

export function skippedBehavior(reason: string): VerificationCheck[] {
  return [check('L4.behavior.slider-updates-plot', 'L4', '拖动滑块后图像按公式重算', 'skipped', 'L3', { blockedReason: reason })];
}
