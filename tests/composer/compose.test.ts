/**
 * 最小编排器的验收：IR 结构对不对、绑定能不能解析、不生成时是否真的没有课件。
 *
 * 每个产物都过一遍 `validateCourseware` —— 编排器自己说「我拼好了」不算数，
 * 得由校验器确认这份 IR 是可渲染的。
 */

import { describe, expect, it } from 'vitest';

import {
  findScenario,
  type Courseware,
  type IrContentNode,
  type IrExerciseNode,
  type IrPlotNode,
  type IrSliderNode,
  type Plan,
  type SkillManifest,
} from '../../src/contracts/index';
import { composeCourseware } from '../../src/server/composer/compose';
import { validateCourseware } from '../../src/server/ir/validate';
import { createRuleIntentParser } from '../../src/server/intent/rule-parser';
import { route } from '../../src/server/router/route';
import { SKILL_MANIFESTS } from '../../src/server/skills/manifests';
import { createSkillRegistry, type SkillRegistry } from '../../src/server/skills/registry';

const registry = createSkillRegistry(SKILL_MANIFESTS);
const parser = createRuleIntentParser(registry);

async function composeFor(utterance: string, customRegistry: SkillRegistry = registry): Promise<Courseware | null> {
  const customParser = customRegistry === registry ? parser : createRuleIntentParser(customRegistry);
  const plan = await route(utterance, { registry: customRegistry, parser: customParser, emit: () => {} });
  return composeCourseware(plan, customRegistry);
}

function childrenOf(courseware: Courseware): readonly IrContentNode[] {
  return courseware.page.children;
}

function only<T extends IrContentNode>(courseware: Courseware, kind: T['kind']): T {
  const found = childrenOf(courseware).filter((node) => node.kind === kind);
  expect(found, `期望恰好一个 ${kind} 节点`).toHaveLength(1);
  return found[0] as T;
}

describe('单 Skill（S1）', () => {
  it('只产出一个 plot，加上 composer 自己的标题与提示', async () => {
    const courseware = await composeFor(findScenario('S1').utterance);
    expect(courseware).not.toBeNull();
    if (!courseware) return;

    expect(validateCourseware(courseware)).toEqual([]);

    const kinds = childrenOf(courseware).map((node) => node.kind);
    expect(kinds).toEqual(['text', 'plot', 'text']);

    const plot = only<IrPlotNode>(courseware, 'plot');
    expect(plot.id).toBe('function-plot:plot-1');
    expect(plot.source).toBe('function-plot');
    expect(plot.params.k).toBe(2);
    expect(plot.params.b).toBe(1);
  });
});

describe('组合（S2）', () => {
  it('plot 与 slider 都在，且 slider 真的绑定到 plot', async () => {
    const courseware = await composeFor(findScenario('S2').utterance);
    expect(courseware).not.toBeNull();
    if (!courseware) return;

    expect(validateCourseware(courseware)).toEqual([]);

    const plot = only<IrPlotNode>(courseware, 'plot');
    const slider = only<IrSliderNode>(courseware, 'slider');

    expect(slider.bindTo.nodeId).toBe(plot.id);
    expect(slider.bindTo.param).toBe('k');
    // 初始值必须等于 plot 的 k，否则一进页面滑块和图像就对不上
    expect(slider.range.value).toBe(plot.params.k);
    expect(slider.id).toMatch(/^interactive-slider:/);
  });

  it('节点 id 都带命名空间前缀，不会互相覆盖', async () => {
    const courseware = await composeFor(findScenario('S2').utterance);
    if (!courseware) throw new Error('期望有课件');

    const ids = childrenOf(courseware).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z-]+:/);
    }
  });

  it('每个节点都标了 source（证据面板要靠它回答「谁放的」）', async () => {
    const courseware = await composeFor(findScenario('S2').utterance);
    if (!courseware) throw new Error('期望有课件');

    const sources = new Set(childrenOf(courseware).map((node) => node.source));
    expect(sources).toEqual(new Set(['composer', 'function-plot', 'interactive-slider']));
  });
});

describe('不生成时不产出课件', () => {
  it('S3（冲突平局）→ null', async () => {
    expect(await composeFor(findScenario('S3').utterance)).toBeNull();
  });

  it('S4（无匹配）→ null', async () => {
    expect(await composeFor(findScenario('S4').utterance)).toBeNull();
  });

  it('冲突有胜者时，只产出胜者的节点', async () => {
    const manifests: SkillManifest[] = SKILL_MANIFESTS.map((manifest) =>
      manifest.id === 'exercise-choice' ? { ...manifest, priority: 70 } : manifest,
    );
    const customRegistry = createSkillRegistry(manifests);

    const courseware = await composeFor(findScenario('S3').utterance, customRegistry);
    expect(courseware).not.toBeNull();
    if (!courseware) return;

    expect(validateCourseware(courseware)).toEqual([]);

    const exercise = only<IrExerciseNode>(courseware, 'exercise');
    expect(exercise.source).toBe('exercise-choice');
    expect(exercise.mode).toBe('choice');
    expect(exercise.choices?.length).toBeGreaterThan(0);
  });
});

describe('按 manifest 驱动，不按 skillId 分支', () => {
  it('作答方式来自 manifest 的 mode 参数', async () => {
    // 把填空题的优先级调高，胜者变成填空题 → 产出 input 模式
    const manifests: SkillManifest[] = SKILL_MANIFESTS.map((manifest) =>
      manifest.id === 'exercise-input' ? { ...manifest, priority: 80 } : manifest,
    );
    const customRegistry = createSkillRegistry(manifests);

    const courseware = await composeFor(findScenario('S3').utterance, customRegistry);
    if (!courseware) throw new Error('期望有课件');

    const exercise = only<IrExerciseNode>(courseware, 'exercise');
    expect(exercise.source).toBe('exercise-input');
    expect(exercise.mode).toBe('input');
    expect(exercise.choices).toBeUndefined();
  });
});

describe('课时课件可序列化', () => {
  it('IR 能无损 JSON 往返（要经 HTTP 传给前端）', async () => {
    const courseware = await composeFor(findScenario('S2').utterance);
    if (!courseware) throw new Error('期望有课件');
    expect(JSON.parse(JSON.stringify(courseware))).toEqual(courseware);
  });

  it('同一份 plan 两次编排结果一致（编排是纯函数）', async () => {
    const plan = (await route(findScenario('S2').utterance, { registry, parser, emit: () => {} })) as Plan;
    expect(composeCourseware(plan, registry)).toEqual(composeCourseware(plan, registry));
  });
});
