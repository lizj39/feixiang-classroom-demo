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

/** 单个 Skill 的得分明细。证据面板逐行展示，面试时可以直接指着数字说话。 */
export interface ScoreBreakdown {
  readonly skill: SkillId;
  /** 0-1，保留两位小数。 */
  readonly score: number;
  /** 命中的原始词，用于解释这一分是怎么来的。 */
  readonly matchedTokens: readonly string[];
  /** 命中了但没算分的词（如同义反复），用于自证没有「碰巧命中」。 */
  readonly ignoredTokens: readonly string[];
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
