/**
 * 故障演示的验收：三个模式必须停在三个不同的层。
 *
 * 这是题面第 2 问的正面回答 ——
 * 「日志说调用了、页面却没有」不是一种故障，而是三种，各自该在哪一层被发现：
 *   drop-node            决策与产物不一致 → L1
 *   break-binding        结构合法但引用断了 → L2
 *   unregistered-renderer 服务端全对，浏览器渲染缺项 → L3
 *
 * 最后一条尤其重要：它证明「服务端验证通过」不等于「用户能看到」。
 */

import { describe, expect, it } from 'vitest';

import { findScenario, type BugMode, type Courseware, type Plan } from '../../src/contracts/index';
import { composeCourseware } from '../../src/server/composer/compose';
import { createRuleIntentParser } from '../../src/server/intent/rule-parser';
import { route } from '../../src/server/router/route';
import { SKILL_MANIFESTS } from '../../src/server/skills/manifests';
import { createSkillRegistry } from '../../src/server/skills/registry';
import { buildServerChecks } from '../../src/server/verify/checks';

const registry = createSkillRegistry(SKILL_MANIFESTS);
const parser = createRuleIntentParser(registry);

async function run(bug?: BugMode): Promise<{ plan: Plan; courseware: Courseware | null }> {
  const { plan, intent } = await route(findScenario('S2').utterance, { registry, parser, emit: () => {} });
  const courseware = composeCourseware({
    plan,
    registry,
    params: intent.params,
    ...(bug === undefined ? {} : { bug }),
  });
  return { plan, courseware };
}

function failedRules(checks: ReturnType<typeof buildServerChecks>): string[] {
  return checks.filter((check) => check.status === 'fail').map((check) => check.ruleId);
}

describe('没有故障时全绿（回归基线）', () => {
  it('S2 的 L1/L2 全部通过', async () => {
    const { plan, courseware } = await run();
    expect(failedRules(buildServerChecks({ plan, courseware, registry }))).toEqual([]);
  });
});

describe('drop-node：编排把滑块丢了', () => {
  it('课件里确实没有 slider', async () => {
    const { courseware } = await run('drop-node');
    if (!courseware) throw new Error('期望有课件');
    expect(courseware.page.children.some((node) => node.kind === 'slider')).toBe(false);
  });

  it('停在 L1：决策说用了两个 Skill，产物里只有一个', async () => {
    const { plan, courseware } = await run('drop-node');
    const checks = buildServerChecks({ plan, courseware, registry });

    expect(failedRules(checks)).toEqual(['L1.route.selected-match']);

    const failed = checks.find((check) => check.ruleId === 'L1.route.selected-match');
    expect(failed?.evidence.detail).toContain('source');
    // 期望有 slider 的来源，实际只有 plot 的来源
    expect(JSON.stringify(failed?.expected)).toContain('interactive-slider');
    expect(JSON.stringify(failed?.actual)).not.toContain('interactive-slider');
  });

  it('L2 被标成 skipped 而不是 pass（下游没跑 ≠ 通过）', async () => {
    const { plan, courseware } = await run('drop-node');
    const checks = buildServerChecks({ plan, courseware, registry });
    const l2 = checks.filter((check) => check.layer === 'L2');
    expect(l2.every((check) => check.status === 'skipped')).toBe(true);
  });
});

describe('break-binding：节点都在，绑定指错了', () => {
  it('课件里 slider 与 plot 都在，但绑定目标不存在', async () => {
    const { courseware } = await run('break-binding');
    if (!courseware) throw new Error('期望有课件');

    const slider = courseware.page.children.find((node) => node.kind === 'slider');
    const plotIds = courseware.page.children.filter((node) => node.kind === 'plot').map((node) => node.id);
    expect(slider).toBeDefined();
    expect(plotIds.length).toBeGreaterThan(0);
    if (slider?.kind === 'slider') {
      expect(plotIds).not.toContain(slider.bindTo.nodeId);
    }
  });

  it('停在 L2：L1 仍然通过（两个来源都在）', async () => {
    const { plan, courseware } = await run('break-binding');
    const checks = buildServerChecks({ plan, courseware, registry });

    expect(checks.find((check) => check.ruleId === 'L1.route.selected-match')?.status).toBe('pass');
    expect(failedRules(checks)).toEqual(expect.arrayContaining(['L2.ir.slider-bound', 'L2.ir.integrity']));
  });
});

describe('unregistered-renderer：服务端无从发现', () => {
  it('服务端报告全绿 —— 故障在浏览器那一层，本来就该由 L3 抓', async () => {
    const { plan, courseware } = await run('unregistered-renderer');
    expect(failedRules(buildServerChecks({ plan, courseware, registry }))).toEqual([]);
  });
});
