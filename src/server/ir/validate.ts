/**
 * 课件 IR 校验：L2 的规则实现。
 *
 * 类型系统只能保证「字段存在、类型对」，保证不了「引用能解析」——
 * `slider.bindTo.nodeId` 指向一个不存在的 plot，照样能通过编译。这类错误只有校验能抓。
 *
 * 五条规则，每条都对应一种「画出来才发现不对」的故障：
 *   ids-unique            id 重复 → React key 冲突，后一个节点覆盖前一个
 *   binding-resolves      bindTo 悬空 → 滑块能拖，但拖的是空气
 *   params-in-range       value 不在 [min,max] → 初始状态就与图像不符
 *   exercise-mode-coherent mode 与 choices 不匹配 → 选择题没选项 / 填空题冒出选项
 *   plot-params-finite    参数是 NaN/Infinity → SVG 路径变成 M NaN NaN
 */

import {
  BINDABLE_PLOT_PARAMS,
  IR_CONTENT_KINDS,
  type Courseware,
  type IrContentNode,
  type IrExerciseNode,
  type IrPlotNode,
  type IrSliderNode,
} from '../../contracts/index';
import type { Violation } from '../validation/violation';

export function validateCourseware(courseware: Courseware): Violation[] {
  const violations: Violation[] = [];
  const push = (path: string, rule: string, message: string) => {
    violations.push({ path, rule, message });
  };

  const page = courseware.page;
  if (page.kind !== 'page') {
    push('page', 'page-kind', `IR 根节点必须是 page，当前是 ${String(page.kind)}`);
    return violations;
  }

  // 1) id 唯一（含 page 自身）
  const seen = new Map<string, string>();
  const register = (id: string, path: string) => {
    const previous = seen.get(id);
    if (previous) {
      push(path, 'ids-unique', `id ${id} 与 ${previous} 重复`);
      return;
    }
    seen.set(id, path);
  };

  register(page.id, 'page.id');

  const plots = new Map<string, IrPlotNode>();

  page.children.forEach((node, index) => {
    const path = `page.children[${index}]`;
    register(node.id, `${path}.id`);

    if (!(IR_CONTENT_KINDS as readonly string[]).includes(node.kind)) {
      push(`${path}.kind`, 'node-kind', `${String(node.kind)} 不是合法的内容节点类型`);
      return;
    }

    if (node.kind === 'plot') {
      plots.set(node.id, node);
      validatePlot(node, path, push);
      return;
    }

    if (node.kind === 'slider') {
      validateSlider(node, path, plots, push);
      return;
    }

    if (node.kind === 'exercise') {
      validateExercise(node, path, push);
      return;
    }

    // text
    if (node.content.trim().length === 0) {
      push(`${path}.content`, 'text-content', '文本节点内容不能为空');
    }
  });

  return violations;
}

type Push = (path: string, rule: string, message: string) => void;

function validatePlot(node: IrPlotNode, path: string, push: Push): void {
  const { k, b, domain } = node.params;

  if (!Number.isFinite(k)) push(`${path}.params.k`, 'plot-params-finite', `k 必须是有限数，当前是 ${String(k)}`);
  if (!Number.isFinite(b)) push(`${path}.params.b`, 'plot-params-finite', `b 必须是有限数，当前是 ${String(b)}`);

  if (!Number.isFinite(domain.xMin) || !Number.isFinite(domain.xMax)) {
    push(`${path}.params.domain`, 'plot-params-finite', 'domain 必须由有限数构成');
    return;
  }
  if (domain.xMin >= domain.xMax) {
    push(`${path}.params.domain`, 'plot-domain', `xMin(${domain.xMin}) 必须小于 xMax(${domain.xMax})`);
  }
}

function validateSlider(node: IrSliderNode, path: string, plots: Map<string, IrPlotNode>, push: Push): void {
  const target = plots.get(node.bindTo.nodeId);

  if (!target) {
    // 悬空引用是最典型的「日志说调用了、页面没反应」
    push(
      `${path}.bindTo.nodeId`,
      'binding-resolves',
      `绑定的节点 ${node.bindTo.nodeId} 不存在（引用必须在同一次合并结果里可解析）`,
    );
  }

  if (!(BINDABLE_PLOT_PARAMS as readonly string[]).includes(node.bindTo.param)) {
    push(
      `${path}.bindTo.param`,
      'binding-param',
      `只能绑定 ${BINDABLE_PLOT_PARAMS.join(' / ')}，当前是 ${String(node.bindTo.param)}`,
    );
  }

  const { min, max, step, value } = node.range;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    push(`${path}.range`, 'range-finite', '滑块的上下界必须是有限数');
    return;
  }
  if (min >= max) {
    push(`${path}.range`, 'range-order', `min(${min}) 必须小于 max(${max})`);
  }
  if (!Number.isFinite(step) || step <= 0) {
    push(`${path}.range.step`, 'range-step', `step 必须为正数，当前是 ${String(step)}`);
  }
  if (value < min || value > max) {
    push(`${path}.range.value`, 'params-in-range', `初始值 ${value} 不在 [${min}, ${max}] 内`);
  }

  // 初始值必须与该 plot 当前的参数一致，否则一进页面就是「滑块和图像对不上」
  if (target) {
    const bound = node.bindTo.param === 'k' ? target.params.k : target.params.b;
    if (bound !== value) {
      push(
        `${path}.range.value`,
        'initial-value-matches-plot',
        `滑块初始值 ${value} 与 ${target.id} 的 ${node.bindTo.param}(${bound}) 不一致`,
      );
    }
  }
}

function validateExercise(node: IrExerciseNode, path: string, push: Push): void {
  if (node.mode === 'choice') {
    if (!node.choices || node.choices.length === 0) {
      push(`${path}.choices`, 'exercise-mode-coherent', '选择题必须给出非空 choices');
    }
    if (node.choices && !node.choices.includes(node.answer)) {
      push(`${path}.answer`, 'exercise-mode-coherent', '选择题的答案必须是选项之一');
    }
  }

  if (node.mode === 'input' && node.choices !== undefined) {
    push(`${path}.choices`, 'exercise-mode-coherent', '填空题不应带 choices');
  }

  if (node.answer.trim().length === 0) {
    push(`${path}.answer`, 'exercise-answer', '练习题必须给出参考答案');
  }
}
