/**
 * 浏览器侧的两层验证：L3 DOM、L4 行为。
 *
 * L4 是整套验证里最要紧的一条：典型故障是「日志显示互动 Skill 已调用，但课件里没有滑块」，
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

/**
 * 让 React 看到值的变化：必须走原生 setter + 派发事件。
 *
 * 两个事件都要派发：range 的 onChange 在 React 里由 `change` 事件驱动，
 * 而某些环境（含 jsdom）只认 `input`。只发一个就会出现「测试过了、真机上不过」
 * 这种最恶心的情况 —— 第一次实现就踩了这个坑（浏览器里 L4 永远红）。
 */
function setNativeValue(input: HTMLInputElement, value: number): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function delay(ms = 0): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 等 DOM 真的更新，最多等约 200ms —— 不赌「一帧就够」，慢机器上也稳。 */
async function waitForPathChange(read: () => string | null, before: string | null): Promise<string | null> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await delay(16);
    const current = read();
    if (current !== before) return current;
  }
  return read();
}

/**
 * 串行队列：行为验证会临时改动 DOM，绝不允许多个实例并发跑。
 *
 * 踩过的坑：React 19 的 StrictMode 在开发模式下会把 effect 跑两遍。
 * 两次并发执行时，B 读到的「原值」是 A 刚设进去的新值，
 * 于是两者互相覆盖、都判失败 —— 表现就是「测试全绿，浏览器里永远红」。
 */
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const queued = chain.then(task, task);
  chain = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

export function checkBehavior(courseware: Courseware, root: ParentNode): Promise<VerificationCheck[]> {
  return enqueue(() => runBehavior(courseware, root));
}

async function runBehavior(courseware: Courseware, root: ParentNode): Promise<VerificationCheck[]> {
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
  const expected = linePath({ ...plot.params, [slider.bindTo.param]: next }, PLOT_VIEW);

  let after: string | null = before;
  let settledValue = String(original);
  try {
    setNativeValue(input, next);
    after = await waitForPathChange(() => path.getAttribute('d'), before);
    settledValue = input.value;
  } finally {
    // 无论成败都复原，绝不把用户看得见的滑块留在系统推过去的位置
    setNativeValue(input, original);
    await delay(0);
  }

  const updated = after !== before;

  // 失败原因要能区分两种完全不同的病灶，否则定位还是靠猜
  const failureReason = updated
    ? undefined
    : settledValue !== String(next)
      ? `滑块值被组件重置回 ${settledValue}：事件没有被接受（事件类型或受控方式有问题）`
      : `滑块值已变成 ${settledValue}，但图像没有重算：绑定没有接到渲染`;

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
        ...(failureReason === undefined ? {} : { blockedReason: failureReason }),
      },
    ),
  ];
}

export function skippedBehavior(reason: string): VerificationCheck[] {
  return [check('L4.behavior.slider-updates-plot', 'L4', '拖动滑块后图像按公式重算', 'skipped', 'L3', { blockedReason: reason })];
}
