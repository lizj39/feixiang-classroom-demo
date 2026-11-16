/**
 * 契约 1/5 —— Skill Manifest
 * 契约 5/5 —— 冲突策略
 *
 * Manifest 是「Skill 能干什么」的唯一声明：Router 靠 triggers 打分，Composer 靠
 * produces/requires/namespace 编排，冲突检测靠 conflictsWith + slot。代码里不允许
 * 出现针对某个 SkillId 的 if 分支——所有差异化行为都必须先落到 manifest 字段上。
 */

import type { BindablePlotParam, IrContentKind } from './ir.js';

/** 4 个 Skill 的封闭集合。id 用字面量联合而不是 string，拼错即编译错误。 */
export const SKILL_IDS = [
  'function-plot',
  'interactive-slider',
  'exercise-choice',
  'exercise-input',
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

/**
 * 题位槽位：一个槽位在最终课件里只能被一个 Skill 占据。
 * 这是「结构冲突」的判定依据，与 conflictsWith（显式声明）互为补充。
 */
export const SKILL_SLOTS = ['visual', 'interaction', 'exercise'] as const;

export type SkillSlot = (typeof SKILL_SLOTS)[number];

export type ParamSpec =
  | {
      readonly name: string;
      readonly type: 'number';
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly description: string;
    }
  | {
      readonly name: string;
      readonly type: 'string';
      readonly default: string;
      readonly description: string;
    }
  | {
      readonly name: string;
      readonly type: 'enum';
      readonly default: string;
      readonly values: readonly string[];
      readonly description: string;
    }
  | {
      readonly name: string;
      readonly type: 'boolean';
      readonly default: boolean;
      readonly description: string;
    };

export interface SkillTriggers {
  /** 强信号：命中即 +0.5。应当是老师真会说的词，不是技术术语。 */
  readonly primary: readonly string[];
  /** 弱信号：命中 +0.2。用于「说得含糊但意图明显」的表达。 */
  readonly synonyms: readonly string[];
  /** 意图信号：命中 +0.1。例如「演示」「练习」这类泛化诉求。 */
  readonly intents: readonly string[];
}

export interface SkillManifest {
  readonly id: SkillId;
  readonly displayName: string;
  /** 一句话说明，直接展示在证据面板的「选择理由」里。 */
  readonly summary: string;
  readonly slot: SkillSlot;
  /** 0-100。冲突时高者胜；相同则平局，按 CONFLICT_POLICY 处理。 */
  readonly priority: number;
  /** IR 命名空间前缀，保证合并后 id 不互相覆盖。 */
  readonly namespace: string;
  readonly triggers: SkillTriggers;
  /** 本 Skill 产出的 IR 节点类型。必须是 IR_CONTENT_KINDS 的子集（测试守门）。 */
  readonly produces: readonly IrContentKind[];
  /** 前置依赖：必须在最终选择集里同时存在，Composer 负责拓扑排序。 */
  readonly requires: readonly SkillId[];
  /** 显式互斥。必须对称声明（测试守门）。 */
  readonly conflictsWith: readonly SkillId[];
  /** 可调参数，用于 slider 绑定与「练习真的可作答」的验证。 */
  readonly params: readonly ParamSpec[];
}

/** 可被 slider 绑定的参数名必须是 plot 可绑定参数（契约级约束，避免运行期才发现）。 */
export type SliderBindableParam = BindablePlotParam;

/**
 * 契约 5：冲突策略。是常量而不是可配置项——Demo 里策略必须唯一且可被断言。
 * 判定顺序：显式 conflictsWith → 同 slot 抢占 → priority 高者胜 → 平局降级澄清。
 */
export const CONFLICT_POLICY = {
  rule: 'highest-priority-wins',
  tie: 'degrade-to-clarify',
  detect: ['explicit-conflictsWith', 'shared-slot'],
  /** 平局时向老师提出的澄清问题的模板，保证 S3 的输出可断言。 */
  clarifyQuestion: '这个题位你希望学生「选择答案」还是「填写答案」？两者只能选一种。',
} as const;

export type ConflictRule = (typeof CONFLICT_POLICY.detect)[number];

export type ConflictResolution =
  | {
      readonly kind: 'winner';
      readonly kept: readonly SkillId[];
      readonly dropped: readonly SkillId[];
      /** 触发本次冲突的规则，指向 trace 里可回查的一层。 */
      readonly by: readonly ConflictRule[];
      readonly reason: string;
    }
  | {
      readonly kind: 'degrade-to-clarify';
      readonly competitors: readonly SkillId[];
      readonly by: readonly ConflictRule[];
      readonly reason: string;
    };
