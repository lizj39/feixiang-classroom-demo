/**
 * 编排器：把「选了谁 + 读到什么参数」变成一棵可渲染的 IR 树。
 *
 * 三条原则：
 *  1. **按 manifest 驱动，不按 skillId 分支**：怎么建节点取决于 `produces[0]`
 *     与声明里的参数，不是 `if (id === 'xxx')`。
 *  2. **Skill 只产节点，不产整页**：page 与文本节点由 composer 统一生成，
 *     否则两个 Skill 各画一个页面。
 *  3. **每个节点带 source**：证据面板要能回答「这个节点是谁放的」。
 *
 * 参数来源必须显式：从需求里读到的值和用默认值兜底的值，在界面上要分得清 ——
 * 老师说了 `y = 3x + 2`，画出来的就必须是它；没读到就老实说「用的是默认值」。
 */

import {
  shouldGenerate,
  type BugMode,
  type Courseware,
  type IrContentNode,
  type IrExerciseNode,
  type IrPageNode,
  type IrPlotNode,
  type IrSliderNode,
  type IrTextNode,
  type Plan,
  type PlotDomain,
  type SkillId,
  type SkillManifest,
} from '../../contracts/index';
import type { SkillRegistry } from '../skills/registry';
import type { Emit } from '../trace/recorder';

/** 图像横向视野。y 视野由渲染器按宽高比反推，保证 x/y 等比（直线不会被拉扁）。 */
export const DEFAULT_DOMAIN: PlotDomain = { xMin: -5, xMax: 5 };

/** 滑块绑定到斜率的理由：这是「拖动后图像明显变化」最直观的参数。 */
const SLIDER_BOUND_PARAM = 'k' as const;

/** 练习题内容目前是模板文案（不接题库）。README 的 Non-goals 里写明。 */
const EXERCISE_TEMPLATE = {
  choice: {
    prompt: '已知一次函数 y = 2x + 1，下列说法正确的是？',
    choices: ['图像经过点 (0, 1)', '图像经过点 (1, 0)', 'y 随 x 增大而减小', '图像与 y 轴交于原点'],
    answer: '图像经过点 (0, 1)',
  },
  input: {
    prompt: '已知一次函数 y = 2x + 1，当 x = 0 时 y = ____',
    answer: '1',
  },
} as const;

export interface ComposeInput {
  readonly plan: Plan;
  readonly registry: SkillRegistry;
  /** 理解层读到的参数（键名与 manifest 的 param name 对齐）。 */
  readonly params?: Readonly<Record<string, number>>;
  /** 写 composer 层 trace。测试里可以省略。 */
  readonly emit?: Emit;
  /**
   * 故障注入（演练用）。刻意做成「编排器的 bug」而不是「假数据」：
   * 产出的 IR 结构本身是合法的，错在它与决策不一致，或绑定指向了不存在的东西。
   */
  readonly bug?: BugMode;
}

interface Resolved {
  readonly value: number;
  readonly from: 'utterance' | 'default';
}

function numberParam(manifest: SkillManifest, name: string, fallback: number): number {
  const param = manifest.params.find((item) => item.name === name);
  return param && param.type === 'number' ? param.default : fallback;
}

function enumParam(manifest: SkillManifest, name: string, fallback: string): string {
  const param = manifest.params.find((item) => item.name === name);
  return param && param.type === 'enum' ? param.default : fallback;
}

/** 需求里读到就用读到的，读不到用 manifest 默认值 —— 并且记下来源。 */
function resolveNumber(
  manifest: SkillManifest,
  name: string,
  extracted: Readonly<Record<string, number>>,
  fallback: number,
): Resolved {
  const raw = extracted[name];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { value: raw, from: 'utterance' };
  }
  return { value: numberParam(manifest, name, fallback), from: 'default' };
}

function nodeId(manifest: SkillManifest, suffix: string): string {
  // 命名空间前缀：两个 Skill 都用 `node-1` 也不会互相覆盖
  return `${manifest.namespace}:${suffix}`;
}

function buildPlot(manifest: SkillManifest, extracted: Readonly<Record<string, number>>) {
  const k = resolveNumber(manifest, 'k', extracted, 2);
  const b = resolveNumber(manifest, 'b', extracted, 1);

  const node: IrPlotNode = {
    kind: 'plot',
    id: nodeId(manifest, 'plot-1'),
    source: manifest.id,
    params: { k: k.value, b: b.value, domain: DEFAULT_DOMAIN },
  };

  return { node, resolved: [['k', k], ['b', b]] as Array<[string, Resolved]> };
}

function buildSlider(manifest: SkillManifest, plot: IrPlotNode): IrSliderNode {
  const current = plot.params[SLIDER_BOUND_PARAM];

  // 范围必须包含当前值：老师说 y=5x 时，[-3,3] 的滑块表达不了 5，
  // 初始值越界会直接被 IR 校验器的 initial-value-matches-plot 拦住
  const min = Math.min(numberParam(manifest, 'rangeMin', -3), current);
  const max = Math.max(numberParam(manifest, 'rangeMax', 3), current);
  const step = numberParam(manifest, 'step', 0.5);

  return {
    kind: 'slider',
    id: nodeId(manifest, 'slider-1'),
    source: manifest.id,
    label: '斜率 k',
    bindTo: { nodeId: plot.id, param: SLIDER_BOUND_PARAM },
    range: { min, max, step, value: current },
  };
}

function buildExercise(manifest: SkillManifest): IrExerciseNode {
  // 作答方式来自 manifest 的 mode 参数，Composer 不做 id 判断
  const mode = enumParam(manifest, 'mode', 'choice');
  const template = mode === 'input' ? EXERCISE_TEMPLATE.input : EXERCISE_TEMPLATE.choice;

  return {
    kind: 'exercise',
    id: nodeId(manifest, 'exercise-1'),
    source: manifest.id,
    mode: mode === 'input' ? 'input' : 'choice',
    prompt: template.prompt,
    answer: template.answer,
    ...(mode === 'input' ? {} : { choices: EXERCISE_TEMPLATE.choice.choices }),
  };
}

function textNode(id: string, variant: IrTextNode['variant'], content: string): IrTextNode {
  return { kind: 'text', id, source: 'composer', variant, content };
}

/** 把「哪些参数是读到的、哪些是默认的」写成人话，直接展示给老师。 */
export function paramsNote(resolved: ReadonlyArray<readonly [string, Resolved]>): string {
  const format = ([name, item]: readonly [string, Resolved]) => `${name} = ${String(item.value)}`;
  const fromUtterance = resolved.filter(([, item]) => item.from === 'utterance');
  const defaults = resolved.filter(([, item]) => item.from === 'default');

  if (defaults.length === 0) {
    return `参数 ${fromUtterance.map(format).join('、')} 来自你的描述。`;
  }
  if (fromUtterance.length === 0) {
    return `参数 ${defaults.map(format).join('、')} 使用默认值（未从需求中识别）。`;
  }
  return `参数 ${fromUtterance.map(format).join('、')} 来自你的描述；${defaults
    .map(format)
    .join('、')} 使用默认值（未从需求中识别）。`;
}

/** 按 requires 拓扑排序，保证 plot 一定在 slider 之前建出来。 */
function orderByRequires(ids: readonly SkillId[], registry: SkillRegistry): SkillManifest[] {
  const ordered: SkillManifest[] = [];
  const visited = new Set<string>();

  const visit = (id: SkillId): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const manifest = registry.get(id);
    if (!manifest) return;
    for (const required of manifest.requires) visit(required);
    ordered.push(manifest);
  };

  for (const id of ids) visit(id);
  return ordered;
}

export function composeCourseware(input: ComposeInput): Courseware | null {
  const { plan, registry, params = {}, emit, bug } = input;

  if (!shouldGenerate(plan)) return null;

  const skillIds =
    plan.type === 'conflict' && plan.resolution.kind === 'winner' ? plan.resolution.kept : plan.selected;

  const manifests = orderByRequires(skillIds, registry);
  const nodes: IrContentNode[] = [];

  let plot: IrPlotNode | null = null;
  let resolvedParams: Array<[string, Resolved]> = [];

  for (const manifest of manifests) {
    const kind = manifest.produces[0];

    if (kind === 'plot') {
      const built = buildPlot(manifest, params);
      plot = built.node;
      resolvedParams = built.resolved;
      nodes.push(built.node);
      continue;
    }

    if (kind === 'slider') {
      // 没有可绑定的图像就不产出滑块：宁可少一个控件，也不要悬空引用
      if (!plot) continue;

      // 故障注入 ①：编排器把滑块丢了。决策与日志都说用了两个 Skill，产物里只有一个。
      if (bug === 'drop-node') continue;

      const slider = buildSlider(manifest, plot);

      // 故障注入 ②：节点都在，但绑定指向了不存在的目标。
      // 这种故障在 IR 层面结构合法，只有 L2 的绑定检查能抓。
      if (bug === 'break-binding') {
        nodes.push({ ...slider, bindTo: { ...slider.bindTo, nodeId: `${slider.bindTo.nodeId}#bug` } });
        continue;
      }

      nodes.push(slider);
      continue;
    }

    if (kind === 'exercise') {
      nodes.push(buildExercise(manifest));
    }
  }

  const hasSlider = nodes.some((node) => node.kind === 'slider');

  const title = manifests.map((manifest) => manifest.displayName).join(' + ');
  const children: IrContentNode[] = [textNode('composer:title', 'title', title), ...nodes];

  if (resolvedParams.length > 0) {
    children.push(textNode('composer:params', 'body', paramsNote(resolvedParams)));
  }

  // 提示语必须与产物一致：没有滑块就不能说「拖动滑块」
  children.push(
    textNode(
      'composer:hint',
      'hint',
      hasSlider
        ? '拖动滑块改变斜率 k，观察直线如何绕它与 y 轴的交点旋转。'
        : '这是一张静态图像。想要能拖动的版本，可以在需求里提到「滑块」或「拖动」二字。',
    ),
  );

  const page: IrPageNode = {
    kind: 'page',
    id: 'composer:page',
    source: 'composer',
    title,
    children,
  };

  emit?.({
    layer: 'composer',
    step: 'resolve-params',
    input: { extracted: params, rejected: [] },
    output: {
      params: Object.fromEntries(resolvedParams.map(([name, item]) => [name, { value: item.value, from: item.from }])),
    },
    decision: resolvedParams.some(([, item]) => item.from === 'default')
      ? '部分参数使用 manifest 默认值'
      : '全部参数来自需求',
    reason: resolvedParams.length > 0 ? paramsNote(resolvedParams) : '这次没有可参数化的节点',
  });

  emit?.({
    layer: 'composer',
    step: 'compose-ir',
    input: { selected: manifests.map((manifest) => manifest.id) },
    output: { childCount: children.length, kinds: children.map((node) => node.kind) },
    decision: '按 manifest 组装单页 IR',
    reason: `节点来自 ${manifests.map((manifest) => manifest.id).join(' + ') || '（无）'}，页面与文本节点由 composer 统一生成`,
  });

  return { irVersion: 1, page };
}
