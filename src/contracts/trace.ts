/**
 * 契约 4/5 —— Trace
 *
 * 「日志显示 Skill 已调用」这类排查，靠的就是这份结构。三个硬要求：
 *  1. 由服务端在实际执行的那一层写入（不是前端事后拼字符串）；
 *  2. 每层一条，layer 有序，能一眼看出「日志停在哪一层」；
 *  3. input/output 是当时的快照，不是引用，否则事后回放看到的全是最终状态。
 */

export const TRACE_LAYERS = ['router', 'composer', 'renderer', 'validator'] as const;

export type TraceLayer = (typeof TRACE_LAYERS)[number];

export interface TraceEvent {
  /** 从 1 开始的全局序号，用于排序与断言「至少 5 条」。 */
  readonly seq: number;
  readonly layer: TraceLayer;
  /** ISO 时间戳。 */
  readonly at: string;
  /** 层内短标签，例如 `score-skills` / `merge-ir` / `resolve-conflict`。 */
  readonly step: string;
  /** 该步的输入快照（可 JSON 序列化）。 */
  readonly input: unknown;
  /** 该步的输出快照。 */
  readonly output: unknown;
  /** 这一步做了什么决定，一句话。 */
  readonly decision: string;
  /** 为什么这么决定。空字符串表示该步没有分支。 */
  readonly reason: string;
}

export interface Trace {
  readonly traceVersion: 1;
  readonly requestId: string;
  readonly events: readonly TraceEvent[];
}

/** 定位辅助：第一个「没有下游证据」的层，就是故障所在层。 */
export function lastTraceLayer(trace: Trace): TraceLayer | null {
  const last = trace.events.at(-1);
  return last ? last.layer : null;
}
