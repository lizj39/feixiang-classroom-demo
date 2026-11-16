/**
 * Trace 记录器：给每条事件补上序号与时间戳。
 *
 * 为什么服务端负责这件事：「日志显示互动 Skill 已调用」这类记录，
 * 可信的前提是日志由真正执行的那一层产生。前端拼出来的字符串，只能证明前端想让你看到什么。
 *
 * 序号从 1 连续递增，前端与测试可以直接断言「至少有 5 条」「layer 顺序是 router→composer→...」。
 */

import type { Trace, TraceEvent } from '../../contracts/index';

/** 交给各层的事件：不含 seq / at，由记录器统一分配。 */
export type TraceDraft = Omit<TraceEvent, 'seq' | 'at'>;

export type Emit = (draft: TraceDraft) => void;

export interface TraceRecorder {
  readonly emit: Emit;
  toTrace(requestId: string): Trace;
}

export function createTraceRecorder(clock: () => Date = () => new Date()): TraceRecorder {
  const events: TraceEvent[] = [];

  const emit: Emit = (draft) => {
    events.push({ ...draft, seq: events.length + 1, at: clock().toISOString() });
  };

  return {
    emit,
    toTrace: (requestId) => ({ traceVersion: 1, requestId, events: [...events] }),
  };
}
