/**
 * L1/L2 服务端校验的验收。
 *
 * 重点不是「正常时全绿」，而是**分层语义**：
 *   - L1 失败时 L2 必须标 skipped（不是 pass）
 *   - 依赖补入的低分 Skill 不能误判成「违反阈值」
 */

import { describe, expect, it } from 'vitest';

import {
  findScenario,
  type Courseware,
  type IrContentNode,
  type Plan,
} from '../../src/contracts/index';
import { composeCourseware } from '../../src/server/composer/compose';
import { createRuleIntentParser } from '../../src/server/intent/rule-parser';
import { route } from '../../src/server/router/route';
import { SKILL_MANIFESTS } from '../../src/server/skills/manifests';
import { createSkillRegistry } from '../../src/server/skills/registry';
import { buildServerChecks } from '../../src/server/verify/checks';

const registry = createSkillRegistry(SKILL_MANIFESTS);
const parser = createRuleIntentParser(registry);

async function scenario(utterance: string): Promise<{ plan: Plan; courseware: Courseware | null }> {
  const { plan, intent } = await route(utterance, { registry, parser, emit: () => {} });
  return { plan, courseware: composeCourseware({ plan, registry, params: intent.params }) };
}

function statusOf(checks: ReturnType<typeof buildServerChecks>, ruleId: string): string | undefined {
  return checks.find((check) => check.ruleId === ruleId)?.status;
}

describe('正常场景', () => {
  it('S2 的 L1/L2 全部通过', async () => {
    const { plan, courseware } = await scenario(findScenario('S2').utterance);
    const checks = buildServerChecks({ plan, courseware, registry });

    expect(checks.map((check) => `${check.ruleId}:${check.status}`)).toEqual([
      'L1.route.selected-match:pass',
      'L1.route.threshold-respected:pass',
      'L1.route.decision-consistency:pass',
      'L2.ir.courseware-present:pass',
      'L2.ir.produces-present:pass',
      'L2.ir.slider-bound:pass',
      'L2.ir.integrity:pass',
    ]);
  });

  it('不生成的场景（S4）也算通过：没课件就是没课件', async () => {
    const { plan, courseware } = await scenario(findScenario('S4').utterance);
    const checks = buildServerChecks({ plan, courseware, registry });
    expect(checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('依赖补入的低分 Skill 不算违反阈值', async () => {
    // 「能拖动滑块看看」只有 slider 达标，plot 是依赖补入的（0 分）
    const { plan, courseware } = await scenario('能拖动滑块看看');
    const plot = plan.scores.find((item) => item.skill === 'function-plot');
    expect(plot?.score).toBe(0);

    const checks = buildServerChecks({ plan, courseware, registry });
    expect(statusOf(checks, 'L1.route.threshold-respected')).toBe('pass');
  });
});

describe('L1 失败时 L2 必须标 skipped', () => {
  it('课件里少了 slider（source 对不上）→ L1 失败，L2 全部 skipped', async () => {
    const { plan, courseware } = await scenario(findScenario('S2').utterance);
    if (!courseware) throw new Error('期望有课件');

    // 模拟「编排丢了节点」：把 slider 从 IR 里删掉
    const broken: Courseware = {
      ...courseware,
      page: {
        ...courseware.page,
        children: courseware.page.children.filter((node) => node.kind !== 'slider'),
      },
    };

    const checks = buildServerChecks({ plan, courseware: broken, registry });

    expect(statusOf(checks, 'L1.route.selected-match')).toBe('fail');
    const l2 = checks.filter((check) => check.layer === 'L2');
    expect(l2).toHaveLength(4);
    expect(l2.every((check) => check.status === 'skipped')).toBe(true);
    expect(l2[0]?.blockedReason).toContain('L1');
  });

  it('「决定不生成」却产出了课件 → decision-consistency 失败', async () => {
    const plan = (await scenario(findScenario('S4').utterance)).plan;
    const { courseware: generated } = await scenario(findScenario('S2').utterance);

    const checks = buildServerChecks({ plan, courseware: generated, registry });
    expect(statusOf(checks, 'L1.route.decision-consistency')).toBe('fail');
  });
});

describe('L2 单独失败的情况', () => {
  it('L1 通过但节点类型缺失 → produces-present 失败', async () => {
    const { plan } = await scenario(findScenario('S1').utterance);

    // source 仍然是 function-plot（L1 通过），但产出的不是 plot 节点
    const wrongKind: IrContentNode = {
      kind: 'exercise',
      id: 'function-plot:exercise-1',
      source: 'function-plot',
      mode: 'input',
      prompt: 'x',
      answer: '1',
    };

    const broken: Courseware = {
      irVersion: 1,
      page: {
        kind: 'page',
        id: 'composer:page',
        source: 'composer',
        title: '一次函数',
        children: [wrongKind],
      },
    };

    const checks = buildServerChecks({ plan, courseware: broken, registry });
    expect(statusOf(checks, 'L1.route.selected-match')).toBe('pass');
    expect(statusOf(checks, 'L2.ir.produces-present')).toBe('fail');
  });

  it('滑块绑定悬空 → slider-bound 与 integrity 同时失败', async () => {
    const { plan, courseware } = await scenario(findScenario('S2').utterance);
    if (!courseware) throw new Error('期望有课件');

    const broken: Courseware = {
      ...courseware,
      page: {
        ...courseware.page,
        children: courseware.page.children.map((node) =>
          node.kind === 'slider' ? { ...node, bindTo: { ...node.bindTo, nodeId: 'missing-plot' } } : node,
        ),
      },
    };

    const checks = buildServerChecks({ plan, courseware: broken, registry });
    expect(statusOf(checks, 'L1.route.selected-match')).toBe('pass');
    expect(statusOf(checks, 'L2.ir.slider-bound')).toBe('fail');
    expect(statusOf(checks, 'L2.ir.integrity')).toBe('fail');
  });
});
