/**
 * 服务端能验的两层：L1 路由、L2 编排。
 *
 * 分工的硬理由：L1/L2 的输入（plan 与 IR）只存在于服务端，而 L3/L4 的输入
 * （DOM 与交互行为）只存在于浏览器。强扭在一起就只能靠「服务端假装知道 DOM」，
 * 那正是题面第 2 问里被骗的那种做法。
 *
 * 顺序语义：L1 有失败就不再执行 L2，L2 标 skipped 并写明原因 ——
 * 「没跑」和「通过」不是一回事，报告里必须分得开。
 */

import {
  shouldGenerate,
  type Courseware,
  type Plan,
  type SkillId,
  type VerificationCheck,
  type VerificationEvidence,
  type VerifyLayer,
  type VerifyStatus,
} from '../../contracts/index';
import { SELECTION_THRESHOLD } from '../router/route';
import { validateCourseware } from '../ir/validate';
import type { SkillRegistry } from '../skills/registry';

export interface VerifyInput {
  readonly plan: Plan;
  readonly courseware: Courseware | null;
  readonly registry: SkillRegistry;
}

interface Extra {
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly blockedReason?: string;
}

function make(
  ruleId: string,
  layer: VerifyLayer,
  title: string,
  status: VerifyStatus,
  evidence: VerificationEvidence,
  extra: Extra = {},
): VerificationCheck {
  return {
    ruleId,
    layer,
    title,
    status,
    evidence,
    ...(extra.expected === undefined ? {} : { expected: extra.expected }),
    ...(extra.actual === undefined ? {} : { actual: extra.actual }),
    ...(extra.blockedReason === undefined ? {} : { blockedReason: extra.blockedReason }),
  };
}

function skipped(ruleId: string, layer: VerifyLayer, title: string, reason: string): VerificationCheck {
  return make(ruleId, layer, title, 'skipped', { kind: 'plan', detail: `${layer} 未执行` }, { blockedReason: reason });
}

/** 这次真正要被渲染出来的 Skill（冲突已裁决的情况下是 winner）。 */
export function generatedSkillIds(plan: Plan): readonly SkillId[] {
  if (!shouldGenerate(plan)) return [];
  if (plan.type === 'conflict' && plan.resolution.kind === 'winner') return plan.resolution.kept;
  return plan.selected;
}

export function buildServerChecks(input: VerifyInput): VerificationCheck[] {
  const { plan, courseware, registry } = input;

  const expectedIds = generatedSkillIds(plan);
  const actualIds = courseware
    ? [...new Set(courseware.page.children.map((node) => node.source).filter((source) => source !== 'composer'))]
    : [];

  const selectionMatches =
    expectedIds.length === actualIds.length && expectedIds.every((id) => actualIds.includes(id));

  const l1: VerificationCheck[] = [
    make(
      'L1.route.selected-match',
      'L1',
      '课件里出现的 Skill 与决策声称的一致',
      selectionMatches ? 'pass' : 'fail',
      { kind: 'plan', detail: 'plan.selected ↔ courseware.page.children[].source' },
      { expected: expectedIds, actual: actualIds },
    ),
    thresholdCheck(plan, registry),
    make(
      'L1.route.decision-consistency',
      'L1',
      '「是否生成」与是否真的产出课件一致',
      shouldGenerate(plan) === (courseware !== null) ? 'pass' : 'fail',
      { kind: 'plan', detail: 'shouldGenerate(plan) ↔ courseware !== null' },
      { expected: shouldGenerate(plan), actual: courseware !== null },
    ),
  ];

  const l1Failed = l1.some((check) => check.status === 'fail');
  if (l1Failed) {
    const reason = 'L1 已有失败，L2 不再执行（问题在更外层）';
    return [
      ...l1,
      skipped('L2.ir.courseware-present', 'L2', '应当生成时确实产出了 IR', reason),
      skipped('L2.ir.produces-present', 'L2', '每个入选 Skill 的产出节点都在 IR 里', reason),
      skipped('L2.ir.slider-bound', 'L2', '滑块绑定可解析', reason),
      skipped('L2.ir.integrity', 'L2', 'IR 结构与参数合法', reason),
    ];
  }

  return [...l1, ...buildL2Checks(input)];
}

function thresholdCheck(plan: Plan, registry: SkillRegistry): VerificationCheck {
  const selected = generatedSkillIds(plan);
  const offenders = selected.filter((id) => {
    const score = plan.scores.find((item) => item.skill === id)?.score ?? 0;
    if (score >= SELECTION_THRESHOLD) return false;

    // 依赖补入的 Skill 允许低分入选：滑块必须有可绑定的图像，
    // 否则「只想要滑块」这种需求永远无法满足
    return !selected.some((other) => registry.get(other)?.requires.includes(id));
  });

  return make(
    'L1.route.threshold-respected',
    'L1',
    '入选的 Skill 要么过了阈值，要么是被依赖补入的',
    offenders.length === 0 ? 'pass' : 'fail',
    { kind: 'plan', detail: 'plan.scores ↔ plan.selected' },
    { expected: [], actual: offenders },
  );
}

function buildL2Checks(input: VerifyInput): VerificationCheck[] {
  const { plan, courseware, registry } = input;
  const should = shouldGenerate(plan);

  const present = should ? courseware !== null : courseware === null;

  const expectedKinds: string[] = [];
  for (const id of generatedSkillIds(plan)) {
    const manifest = registry.get(id);
    if (manifest) expectedKinds.push(...manifest.produces);
  }
  const actualKinds = courseware ? courseware.page.children.map((node) => node.kind) : [];
  const missingKinds = expectedKinds.filter((kind) => !actualKinds.includes(kind as never));

  const sliders = courseware ? courseware.page.children.filter((node) => node.kind === 'slider') : [];
  const plotIds = new Set(
    courseware ? courseware.page.children.filter((node) => node.kind === 'plot').map((node) => node.id) : [],
  );
  const danglingSliders = sliders.filter((slider) => !plotIds.has(slider.bindTo.nodeId));

  const violations = courseware ? validateCourseware(courseware) : [];

  return [
    make(
      'L2.ir.courseware-present',
      'L2',
      '应当生成时确实产出了 IR，不生成时确实为 null',
      present ? 'pass' : 'fail',
      { kind: 'ir-path', detail: 'courseware' },
      { expected: should ? '有 IR' : '无 IR', actual: courseware ? '有 IR' : '无 IR' },
    ),
    make(
      'L2.ir.produces-present',
      'L2',
      '每个入选 Skill 声明产出的节点类型都在 IR 里',
      missingKinds.length === 0 ? 'pass' : 'fail',
      { kind: 'ir-path', detail: 'page.children[].kind ↔ manifest.produces' },
      { expected: expectedKinds, actual: actualKinds },
    ),
    make(
      'L2.ir.slider-bound',
      'L2',
      '每个滑块都绑定到真实存在的图像节点',
      danglingSliders.length === 0 ? 'pass' : 'fail',
      {
        kind: 'ir-path',
        detail: sliders.map((slider) => `${slider.id}.bindTo.nodeId`).join(', ') || '（无滑块）',
      },
      { expected: 0, actual: danglingSliders.length },
    ),
    make(
      'L2.ir.integrity',
      'L2',
      'IR 结构与参数合法（id 唯一、区间有序、初始值一致）',
      violations.length === 0 ? 'pass' : 'fail',
      {
        kind: 'ir-path',
        detail: violations.map((violation) => violation.path).join(', ') || '全部规则通过',
      },
      { expected: [], actual: violations.map((violation) => `${violation.path} ${violation.message}`) },
    ),
  ];
}

/** L3/L4 只能由浏览器执行，服务端把它们标成 skipped。 */
export function browserOnlyChecks(reason: string): VerificationCheck[] {
  return [
    skipped('L3.dom.range-present', 'L3', 'DOM 里存在滑块控件', reason),
    skipped('L3.dom.controls-match-ir', 'L3', 'DOM 控件数量与 IR 一致', reason),
    skipped('L4.behavior.slider-updates-plot', 'L4', '拖动滑块后图像按公式重算', reason),
  ];
}
