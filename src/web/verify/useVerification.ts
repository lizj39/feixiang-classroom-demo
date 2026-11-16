/**
 * 在浏览器里补完 L3/L4，并把四层结果合并成一份报告。
 *
 * 为什么合并放在前端：L1/L2 的结论来自服务端（那边才有 plan 与 IR），
 * L3/L4 只有在页面挂载后才能验。两边各出「半份报告」，由同一份
 * `buildVerificationReport` 汇总 —— 保证服务端与前端的判定口径不会漂移。
 */

import { useEffect, useState } from 'react';

import { buildVerificationReport, type Courseware, type VerificationCheck, type VerificationReport } from '../../contracts/index';
import { checkBehavior, checkDomStructure, skippedBehavior } from './dom-checks';

/** 上游失败时把 L3 整体标成 skipped。 */
function skippedDom(reason: string): VerificationCheck[] {
  return [
    {
      ruleId: 'L3.dom.range-present',
      layer: 'L3',
      title: 'DOM 里的滑块数量与 IR 一致',
      status: 'skipped',
      evidence: { kind: 'dom', detail: 'L3 未执行' },
      blockedReason: reason,
    },
    {
      ruleId: 'L3.dom.controls-match-ir',
      layer: 'L3',
      title: '渲染出的节点数量与 IR 一致',
      status: 'skipped',
      evidence: { kind: 'dom', detail: 'L3 未执行' },
      blockedReason: reason,
    },
  ];
}

export interface UseVerificationInput {
  readonly serverReport: VerificationReport | null;
  readonly courseware: Courseware | null;
  readonly container: React.RefObject<HTMLElement | null>;
}

export function useVerification({ serverReport, courseware, container }: UseVerificationInput): VerificationReport | null {
  const [report, setReport] = useState<VerificationReport | null>(serverReport);

  // 换了一次请求，先退回服务端给的那半份
  useEffect(() => {
    setReport(serverReport);
  }, [serverReport]);

  useEffect(() => {
    const root = container.current;
    if (!serverReport || !courseware || !root) return;

    let cancelled = false;

    void (async () => {
      const serverChecks = serverReport.checks.filter((check) => check.layer === 'L1' || check.layer === 'L2');

      // 上游已经失败时，浏览器这两层不该再跑：故障在更外层，再验下去只会产生
      // 一堆下游噪声，掩盖真正的原因
      const upstreamFailed = serverReport.firstFailedLayer !== null;

      const l3: VerificationCheck[] = upstreamFailed
        ? skippedDom('L1/L2 未通过：故障在更外层，DOM 验证不再执行')
        : checkDomStructure(courseware, root);

      const l4: VerificationCheck[] = upstreamFailed
        ? skippedBehavior('L1/L2 未通过：行为验证不再执行')
        : l3.some((check) => check.status === 'fail')
          ? skippedBehavior('L3 未通过：DOM 结构与 IR 不一致，行为验证没有意义')
          : await checkBehavior(courseware, root);

      if (cancelled) return;
      setReport(buildVerificationReport(serverReport.requestId, [...serverChecks, ...l3, ...l4]));
    })();

    return () => {
      cancelled = true;
    };
  }, [serverReport, courseware, container]);

  return report;
}
