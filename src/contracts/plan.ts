/**
 * 契约 3/5（衍生）—— 路由决策 Plan
 *
 * 为什么 Plan 单独成契约：题面第 1 问「怎么选」的答案就是这个对象。它必须同时携带
 * 结果（选了谁）和理由（为什么是它、为什么不是别人），否则页面上的解释只能靠文案编。
 *
 * 四种形态刻意不合并：
 *  - no_match：一个都没达到阈值 → 不该生成；
 *  - conflict：有多个达到阈值但互斥 → 可能降级保留其中一个，也可能平局后不生成。
 * 把两者合成一个 clarify，就丢掉了「冲突」和「没命中」的区别——而这正是面试要问的。
 */

import type { ConflictResolution, SkillId } from './skill.js';

/** 计分上限（整数百分制）。score = min(总分, 100) / 100。 */
export const MAX_SCORE_POINTS = 100;

/** 一个信号来自哪一层理解。 */
export type SignalSource = 'lexicon' | 'llm';

/** 信号类型：词表三类 + LLM 给出的能力标签。 */
export type SignalKind = 'primary' | 'synonym' | 'intent' | 'capability';

/**
 * 一条计分证据。
 *
 * 为什么不是 `string[]`：接了 LLM 之后会有人命中的证据是「原文里根本没有的词」——
 * 比如老师说的是「让学生自己调参数看看」，LLM 读出「滑块」。界面若显示
 * 「命中『滑块』+50」，而原文没有这两个字，就是能被一眼看穿的破绽。
 * 所以每条证据都必须带上「来源」与「分值」，让规则证据和模型证据分得开。
 */
export interface Signal {
  /** 命中的词；`by === 'llm'` 时是能力名（如 `slider`）。 */
  readonly token: string;
  readonly kind: SignalKind;
  /** 实际计入的分值。primary 50 / synonym 20 / intent 10 / capability 60。 */
  readonly points: number;
  readonly by: SignalSource;
}

/**
 * 命中了但没计分的词。典型场景：`选` ⊂ `选答案`，两层词表不能各加一次分。
 * 记下被谁遮挡，才能回答「为什么这个词没加分」。
 */
export interface ShadowedSignal {
  readonly token: string;
  readonly shadowedBy: string;
  readonly kind: SignalKind;
}

/** 单个 Skill 的得分明细。证据面板逐行展示，面试时可以直接指着数字说话。 */
export interface ScoreBreakdown {
  readonly skill: SkillId;
  /** 0-1，保留两位小数。等于 `min(totalPoints, 100) / 100`。 */
  readonly score: number;
  /** 计入分数的证据，按加入顺序（primary 在前）。 */
  readonly signals: readonly Signal[];
  readonly shadowed: readonly ShadowedSignal[];
}

/** 原始得分（未封顶）。score 用的是封顶后的值。 */
export function totalPoints(breakdown: ScoreBreakdown): number {
  return breakdown.signals.reduce((sum, signal) => sum + signal.points, 0);
}

/** 由原始分值算出展示用分数，保证「怎么算出来的」只有一处实现。 */
export function scoreFromPoints(points: number): number {
  return Math.min(points, MAX_SCORE_POINTS) / 100;
}

export interface ClarifyingQuestion {
  readonly id: string;
  readonly question: string;
  readonly options?: readonly string[];
}

interface PlanBase {
  readonly utterance: string;
  /** 全部候选的得分，按 score 降序。必须包含所有 Skill，不能只留命中项。 */
  readonly scores: readonly ScoreBreakdown[];
  /** 决策理由，一句话，直接展示给老师。 */
  readonly reason: string;
  /** 非空表示「需要老师补充信息才能继续」，与是否生成无关。 */
  readonly questions: readonly ClarifyingQuestion[];
}

export interface SingleSkillPlan extends PlanBase {
  readonly type: 'single';
  readonly selected: readonly [SkillId];
}

export interface ComboSkillPlan extends PlanBase {
  readonly type: 'combo';
  /** 长度 ≥ 2。顺序为 Composer 的拓扑顺序，不是得分顺序。 */
  readonly selected: readonly SkillId[];
}

export interface ConflictPlan extends PlanBase {
  readonly type: 'conflict';
  readonly selected: readonly SkillId[];
  readonly resolution: ConflictResolution;
}

export interface NoMatchPlan extends PlanBase {
  readonly type: 'no_match';
  readonly selected: readonly [];
}

export type Plan = SingleSkillPlan | ComboSkillPlan | ConflictPlan | NoMatchPlan;

export type PlanType = Plan['type'];

/** 只有这几种情况才允许进入 Composer。Renderer 拿不到 IR 就是「不生成」。 */
export function shouldGenerate(plan: Plan): boolean {
  switch (plan.type) {
    case 'single':
    case 'combo':
      return true;
    case 'conflict':
      return plan.resolution.kind === 'winner';
    case 'no_match':
      return false;
  }
}

export function assertNeverPlan(plan: never): never {
  throw new Error(`未处理的 Plan 类型: ${JSON.stringify(plan)}`);
}
