/**
 * 场景 fixtures（契约的期望值，不是实现的产物）
 *
 * 这些对象在 P3 实现 Router 之前就写好，Router 的验收标准是「跑出来的结果等于这里」。
 * 顺序反了就会变成「代码写成什么，测试就断言什么」——那样的测试等于没写。
 *
 * 计分约定（见 docs/SPEC.md）：整数百分制累加，`score = min(总分, 100) / 100`。
 * 用整数而不是 0.5 + 0.1 这类浮点累加，是为了让 60/100 === 0.6 精确成立 ——
 * S2 的 function-plot 正好压在阈值 0.60 上，浮点误差会把「刚好达标」判成「不达标」。
 *
 * 每条证据都带 `by`（lexicon / llm）：P8 接入 LLM 后，会有人命中的证据来自模型判断，
 * 必须能和词表证据分开显示，否则界面上会出现「命中『滑块』」但原文没有这两个字的破绽。
 */

import { findScenario } from '../../src/contracts/index';
import type {
  Courseware,
  Plan,
  ScoreBreakdown,
  ShadowedSignal,
  Signal,
  SignalKind,
  SkillId,
} from '../../src/contracts/index';

function sig(token: string, kind: SignalKind, points: number): Signal {
  return { token, kind, points, by: 'lexicon' };
}

function breakdown(
  skill: SkillId,
  score: number,
  signals: readonly Signal[],
  shadowed: readonly ShadowedSignal[] = [],
): ScoreBreakdown {
  return { skill, score, signals, shadowed };
}

function zero(skill: SkillId): ScoreBreakdown {
  return breakdown(skill, 0, []);
}

/**
 * S1 —— 单 Skill
 * 「画一下 y=2x+1 的图像」
 * 期望：function-plot 0.90（图像 50 + y= 20 + 画 20），其余 0 → single
 */
export const S1_PLAN = {
  type: 'single',
  utterance: findScenario('S1').utterance,
  selected: ['function-plot'],
  scores: [
    breakdown('function-plot', 0.9, [sig('图像', 'primary', 50), sig('y=', 'synonym', 20), sig('画', 'synonym', 20)]),
    zero('interactive-slider'),
    zero('exercise-choice'),
    zero('exercise-input'),
  ],
  reason: '只有 function-plot 达到阈值 0.60（0.90），且没有其它 Skill 竞争，单独使用。',
  questions: [],
} satisfies Plan;

/**
 * S2 —— 组合 Skill（题面原例）
 * 「能拖动滑块的一次函数演示」
 * 期望：interactive-slider 1.00 与 function-plot 0.60 同时达标 → combo
 * 注意 0.60 正好压在阈值上：这条用例同时守护「边界值算达标」。
 */
export const S2_PLAN = {
  type: 'combo',
  utterance: findScenario('S2').utterance,
  selected: ['function-plot', 'interactive-slider'],
  scores: [
    breakdown('interactive-slider', 1.0, [sig('拖动', 'primary', 50), sig('滑块', 'primary', 50)]),
    breakdown('function-plot', 0.6, [sig('一次函数', 'primary', 50), sig('演示', 'intent', 10)]),
    zero('exercise-choice'),
    zero('exercise-input'),
  ],
  reason:
    'interactive-slider 1.00 与 function-plot 0.60 同时达标；两者槽位分别是 interaction / visual，' +
    '不互斥，且 slider 需要 plot 提供绑定目标（requires 已满足），因此组合生成。',
  questions: [],
} satisfies Plan;

/**
 * S3 —— 冲突（题面「如果两者冲突」）
 * 「出一道一次函数练习题，让学生选答案或填答案」
 * 期望：choice 与 input 同分 1.00、同槽位 exercise、且显式互斥 → 平局 → 降级澄清，不生成。
 * function-plot 只有 0.50，低于阈值，被明确排除（拒绝「看起来像答案」的凑数）。
 *
 * 两个练习类 Skill 各有一条被遮蔽的证据：`选` ⊂ `选答案`、`填` ⊂ `填答案`，
 * 同义层不能重复加分。这条正是「遮蔽规则」的真实数据。
 */
export const S3_PLAN = {
  type: 'conflict',
  utterance: findScenario('S3').utterance,
  selected: ['exercise-choice', 'exercise-input'],
  resolution: {
    kind: 'degrade-to-clarify',
    competitors: ['exercise-choice', 'exercise-input'],
    by: ['explicit-conflictsWith', 'shared-slot'],
    reason:
      '两个 Skill 都命中「练习题」这个题位且互斥（exercise-choice 1.00 / exercise-input 1.00），' +
      'priority 相同无法裁决，按 CONFLICT_POLICY.tie 降级为澄清，不猜。',
  },
  scores: [
    breakdown('exercise-choice', 1.0, [sig('练习题', 'primary', 50), sig('选答案', 'primary', 50)], [
      { token: '选', shadowedBy: '选答案', kind: 'synonym' },
    ]),
    breakdown('exercise-input', 1.0, [sig('练习题', 'primary', 50), sig('填答案', 'primary', 50)], [
      { token: '填', shadowedBy: '填答案', kind: 'synonym' },
    ]),
    breakdown('function-plot', 0.5, [sig('一次函数', 'primary', 50)]),
    zero('interactive-slider'),
  ],
  reason: '练习题题位被两个互斥 Skill 同分抢占，平局不猜，转为澄清提问。',
  questions: [
    {
      id: 'q-exercise-mode',
      question: '这个题位你希望学生「选择答案」还是「填写答案」？两者只能选一种。',
      options: ['选择答案', '填写答案'],
    },
    {
      id: 'q-exercise-count',
      question: '需要几道题？（默认 1 道）',
      options: ['1 道', '3 道'],
    },
  ],
} satisfies Plan;

/**
 * S4 —— 无匹配（题面「如果都不合适」）
 * 「帮我准备明天的班会」
 * 期望：全部 0 分 → no_match，不生成，给出澄清问题。
 */
export const S4_PLAN = {
  type: 'no_match',
  utterance: findScenario('S4').utterance,
  selected: [],
  scores: [zero('function-plot'), zero('interactive-slider'), zero('exercise-choice'), zero('exercise-input')],
  reason: '没有任何 Skill 达到阈值 0.60，当前能力集覆盖不了这个需求，因此不生成课件。',
  questions: [
    {
      id: 'q-topic',
      question: '你希望演示哪个具体的知识点？（例如「一次函数图像」「函数单调性」）',
    },
    {
      id: 'q-style',
      question: '希望是可拖动的互动演示，还是一次随堂练习？',
      options: ['互动演示', '随堂练习'],
    },
  ],
} satisfies Plan;

/**
 * S2 期望的课件 IR。
 *
 * 为什么现在就写：slider.bindTo 指向 plot 节点是「组合真的发生」的唯一硬证据。
 * 如果只断言「两个 Skill 都调用了」，那正是题面第 2 问里被骗的那种情况。
 */
export const S2_COURSEWARE = {
  irVersion: 1,
  page: {
    kind: 'page',
    id: 'composer:page',
    source: 'composer',
    title: '一次函数：拖动滑块观察图像变化',
    children: [
      {
        kind: 'text',
        id: 'composer:title',
        source: 'composer',
        variant: 'title',
        content: '一次函数 y = 2x + 1',
      },
      {
        kind: 'plot',
        id: 'function-plot:plot-1',
        source: 'function-plot',
        params: { k: 2, b: 1, domain: { xMin: -5, xMax: 5 } },
      },
      {
        kind: 'slider',
        id: 'interactive-slider:slider-1',
        source: 'interactive-slider',
        label: '斜率 k',
        bindTo: { nodeId: 'function-plot:plot-1', param: 'k' },
        range: { min: -3, max: 3, step: 0.5, value: 2 },
      },
      {
        kind: 'text',
        id: 'composer:hint',
        source: 'composer',
        variant: 'hint',
        content: '拖动滑块改变 k，观察直线是如何绕点 (0, 1) 旋转的。',
      },
    ],
  },
} satisfies Courseware;

/**
 * 场景用例表：plan + 「该不该生成」。
 * 这里刻意不让 generate 由 plan.type 推导——conflict 在 winner 分支下也可能生成，
 * 用类型映射会把这个区别抹平，测试就守不住「平局该拒答」这条规则。
 */
export const SCENARIO_CASES = [
  { id: 'S1', plan: S1_PLAN, shouldGenerate: true },
  { id: 'S2', plan: S2_PLAN, shouldGenerate: true },
  { id: 'S3', plan: S3_PLAN, shouldGenerate: false },
  { id: 'S4', plan: S4_PLAN, shouldGenerate: false },
] as const;
