/**
 * 最小编排器：把「选了谁」变成一棵可渲染的 IR 树。
 *
 * 现在只覆盖单 Skill 与组合（含冲突胜者）。P5 会补上依赖排序的完整处理、
 * 命名空间冲突改名与跨 Skill 参数绑定的通用化；这里先把「能画出东西」打通。
 *
 * 三条原则：
 *  1. **按 manifest 驱动，不按 skillId 分支**：怎么建节点取决于 `produces[0]`
 *     和声明里的参数默认值，不是 `if (id === 'xxx')`。
 *  2. **Skill 只产节点，不产整页**：page 与文本节点由 composer 统一生成，
 *     否则两个 Skill 各画一个页面。
 *  3. **每个节点带 source**：证据面板要能回答「这个节点是谁放的」，
 *     少了它，P7 的「节点被丢」故障就查不出是 composer 还是 renderer 的问题。
 */

import {
  shouldGenerate,
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

/** 图像横向视野。y 视野由渲染器按宽高比反推，保证 x/y 等比（直线不会被拉扁）。 */
export const DEFAULT_DOMAIN: PlotDomain = { xMin: -5, xMax: 5 };

/** 滑块绑定到斜率的理由：这是「拖动后图像明显变化」最直观的参数。 */
const SLIDER_BOUND_PARAM = 'k';

/** 练习题内容目前是模板文案（不接题库）。这一点在 README 的 Non-goals 里写明。 */
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

function numberParam(manifest: SkillManifest, name: string, fallback: number): number {
  const param = manifest.params.find((item) => item.name === name);
  return param && param.type === 'number' ? param.default : fallback;
}

function enumParam(manifest: SkillManifest, name: string, fallback: string): string {
  const param = manifest.params.find((item) => item.name === name);
  return param && param.type === 'enum' ? param.default : fallback;
}

function nodeId(manifest: SkillManifest, suffix: string): string {
  // 命名空间前缀：两个 Skill 都用 `node-1` 也不会互相覆盖
  return `${manifest.namespace}:${suffix}`;
}

function buildPlot(manifest: SkillManifest): IrPlotNode {
  return {
    kind: 'plot',
    id: nodeId(manifest, 'plot-1'),
    source: manifest.id,
    params: {
      k: numberParam(manifest, 'k', 2),
      b: numberParam(manifest, 'b', 1),
      domain: DEFAULT_DOMAIN,
    },
  };
}

function buildSlider(manifest: SkillManifest, plot: IrPlotNode): IrSliderNode {
  const min = numberParam(manifest, 'rangeMin', -3);
  const max = numberParam(manifest, 'rangeMax', 3);
  const step = numberParam(manifest, 'step', 0.5);
  const current = SLIDER_BOUND_PARAM === 'k' ? plot.params.k : plot.params.b;

  return {
    kind: 'slider',
    id: nodeId(manifest, 'slider-1'),
    source: manifest.id,
    label: '斜率 k',
    bindTo: { nodeId: plot.id, param: SLIDER_BOUND_PARAM },
    range: {
      min,
      max,
      step,
      value: Math.min(Math.max(current, min), max),
    },
  };
}

function buildExercise(manifest: SkillManifest): IrExerciseNode {
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

export function composeCourseware(plan: Plan, registry: SkillRegistry): Courseware | null {
  if (!shouldGenerate(plan)) return null;

  const skillIds =
    plan.type === 'conflict' && plan.resolution.kind === 'winner' ? plan.resolution.kept : plan.selected;

  const manifests = orderByRequires(skillIds, registry);
  const nodes: IrContentNode[] = [];

  let plot: IrPlotNode | null = null;

  for (const manifest of manifests) {
    const kind = manifest.produces[0];

    if (kind === 'plot') {
      const node = buildPlot(manifest);
      plot = node;
      nodes.push(node);
      continue;
    }

    if (kind === 'slider') {
      // 没有可绑定的图像就不产出滑块：宁可少一个控件，也不要悬空引用
      if (plot) nodes.push(buildSlider(manifest, plot));
      continue;
    }

    if (kind === 'exercise') {
      nodes.push(buildExercise(manifest));
    }
  }

  const title = manifests.map((manifest) => manifest.displayName).join(' + ');
  const hint = plot
    ? '拖动滑块改变斜率 k，观察直线如何绕它与 y 轴的交点旋转。'
    : '这个课件暂时没有可交互的图像。';

  const page: IrPageNode = {
    kind: 'page',
    id: 'composer:page',
    source: 'composer',
    title,
    children: [
      textNode('composer:title', 'title', title),
      ...nodes,
      textNode('composer:hint', 'hint', hint),
    ],
  };

  return { irVersion: 1, page };
}
