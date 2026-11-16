/**
 * 契约 5/5 —— 验证结果
 *
 * 核心立场：日志说调用了不算数，必须验到产物和行为。四层从路由到行为逐层加深，
 * 任何一层失败就说明「故障在这一层」，下游层标记 skipped（而不是 pass）。
 *
 * L1 路由   —— 选中的 Skill 集合是否等于决策声称的集合
 * L2 编排   —— IR 里是否真有它承诺的节点、引用是否成立、参数是否合法
 * L3 渲染   —— DOM 里是否真有对应控件（如 input[type=range]）
 * L4 行为   —— 控件是否真的改变了产物（拖动后曲线按公式重算）
 */

export const VERIFY_LAYERS = ['L1', 'L2', 'L3', 'L4'] as const;

export type VerifyLayer = (typeof VERIFY_LAYERS)[number];

/** 展示用的人类可读层名，证据面板与 README 共用，避免两处措辞漂移。 */
export const VERIFY_LAYER_LABEL: Record<VerifyLayer, string> = {
  L1: 'L1 路由',
  L2: 'L2 编排 / IR',
  L3: 'L3 渲染 / DOM',
  L4: 'L4 行为',
};

export type VerifyStatus = 'pass' | 'fail' | 'skipped';

/** 证据的种类决定「怎么证明」：分别是读 plan、读 IR 路径、查 DOM、跑行为。 */
export type EvidenceKind = 'plan' | 'ir-path' | 'dom' | 'behavior';

export interface VerificationEvidence {
  readonly kind: EvidenceKind;
  /** 人类可读的定位串，例如 `page.children[1].bindTo.nodeId` 或 `input[type=range]`。 */
  readonly detail: string;
}

export interface VerificationCheck {
  /** 稳定的规则 id（如 `L2.slider-present`），失败时可被测试直接断言。 */
  readonly ruleId: string;
  readonly layer: VerifyLayer;
  readonly title: string;
  readonly status: VerifyStatus;
  readonly evidence: VerificationEvidence;
  readonly expected?: unknown;
  readonly actual?: unknown;
  /** status === 'fail' 时必填：给「下一层为什么没跑」一个解释。 */
  readonly blockedReason?: string;
}

export interface VerificationReport {
  readonly reportVersion: 1;
  readonly requestId: string;
  readonly checks: readonly VerificationCheck[];
  readonly overall: 'pass' | 'fail';
  /** 最外层的失败层。null 表示全部通过。多层失败时必须是数值最小的那一层。 */
  readonly firstFailedLayer: VerifyLayer | null;
  /** 一句话结论，直接贴到证据面板顶部。 */
  readonly summary: string;
}

export function layerRank(layer: VerifyLayer): number {
  return VERIFY_LAYERS.indexOf(layer);
}

/** 取最外层（序号最小）的失败层；没有失败返回 null。 */
export function firstFailedLayerOf(checks: readonly VerificationCheck[]): VerifyLayer | null {
  let found: VerifyLayer | null = null;
  for (const check of checks) {
    if (check.status !== 'fail') continue;
    if (found === null || layerRank(check.layer) < layerRank(found)) {
      found = check.layer;
    }
  }
  return found;
}
