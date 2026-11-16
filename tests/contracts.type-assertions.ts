/**
 * 反例编译断言（不是运行期测试，只由 `tsc --noEmit` 消费）
 *
 * 每个契约至少一个反例。`@ts-expect-error` 在「本来不该编过的写法却编过了」时会变成
 * unused directive 而报错，所以这个文件同时是：契约没被悄悄放宽的守门员。
 */

import type {
  BindablePlotParam,
  ConflictResolution,
  IrContentNode,
  Plan,
  ScoreBreakdown,
  SkillId,
  SkillManifest,
  SliderBinding,
  TraceEvent,
  VerificationCheck,
  VerifyLayer,
} from '../src/contracts/index';

/** 1. SkillId 是封闭集合，拼错即编译错误（防止字符串散落各处后拼错无人发现）。 */
// @ts-expect-error 'function-plotz' 不在 SKILL_IDS 里
export const badSkillId: SkillId = 'function-plotz';

/** 2. slider 只能绑定数值参数 k / b，不能绑定整个 domain。 */
export const badBinding: SliderBinding = {
  nodeId: 'function-plot:plot-1',
  // @ts-expect-error domain 不是可绑定参数
  param: 'domain',
};

/** 2b. 同上，单独引用可绑定参数类型时也不接受其它字符串。 */
// @ts-expect-error 只有 k / b
export const badBindableParam: BindablePlotParam = 'c';

/** 3. single 形态的 selected 是长度 1 的元组，写两个就编不过。 */
export const badSingle: Plan = {
  type: 'single',
  utterance: '画个图',
  // @ts-expect-error single 只允许一个 Skill（长度 1 的元组）
  selected: ['function-plot', 'interactive-slider'],
  scores: [],
  reason: '故意写错',
  questions: [],
};

/** 4. plot 节点必须带 params，缺失即编译错误（IR 不允许半成品节点）。 */
// @ts-expect-error 缺少 params
export const badPlotNode: IrContentNode = { kind: 'plot', id: 'a', source: 's' };

/** 5. 冲突裁决只有 winner / degrade-to-clarify 两种形态，没有第三种。 */
export const badResolution: ConflictResolution = {
  // @ts-expect-error 未定义的中裁形态
  kind: 'pick-first',
};

/** 6. Trace 的 layer 是封闭集合，不允许自造层名（否则「停在哪一层」无法断言）。 */
export const badTraceLayer: TraceEvent = {
  seq: 1,
  // @ts-expect-error 未定义层
  layer: 'planner',
  at: new Date(0).toISOString(),
  step: 'x',
  input: null,
  output: null,
  decision: 'd',
  reason: 'r',
};

/** 7. 验证状态只有 pass / fail / skipped —— 不允许出现「看起来通过了」的模糊状态。 */
// @ts-expect-error 'ok' 不是合法状态
export const badStatus: VerificationCheck['status'] = 'ok';

/** 7b. 验证层只能是 L1~L4。 */
// @ts-expect-error 'L5'
export const badVerifyLayer: VerifyLayer = 'L5';

/** 8. manifest 的 produces 必须是 IR 内容节点类型，不能自造「story」这类节点。 */
export const badProduces: SkillManifest['produces'] = [
  // @ts-expect-error story 不是 IR 节点
  'story',
];

/** 9. 得分必须是数字，且明细字段不可缺（证据面板要逐行展示）。 */
// @ts-expect-error score 必须是 number
export const badScore: ScoreBreakdown = { skill: 'function-plot', score: '0.9', matchedTokens: [], ignoredTokens: [] };
