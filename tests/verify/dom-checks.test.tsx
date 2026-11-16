// @vitest-environment jsdom
/**
 * L3/L4 浏览器侧校验的验收。
 *
 * 两个方向都要测：
 *   - 正常渲染时能通过（否则报告永远红，没人信）；
 *   - 人为破坏时能失败（否则校验器等于摆设）。
 *
 * L4 的失败用例刻意用「手写 DOM」而不是 React 组件来构造 ——
 * 那正是「滑块在、但拖动不更新」的样子：控件是真的，绑定是断的。
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Courseware } from '../../src/contracts/index';
import { CoursewareView } from '../../src/web/render/CoursewareView';
import { checkBehavior, checkDomStructure } from '../../src/web/verify/dom-checks';
import { S2_COURSEWARE } from '../fixtures/scenarios';

afterEach(() => {
  cleanup();
});

function statusOf(checks: Awaited<ReturnType<typeof checkBehavior>>, ruleId: string): string | undefined {
  return checks.find((check) => check.ruleId === ruleId)?.status;
}

describe('L3 DOM 结构', () => {
  it('正常渲染的 S2：滑块与节点数量都对得上', () => {
    render(<CoursewareView courseware={S2_COURSEWARE} />);
    const checks = checkDomStructure(S2_COURSEWARE, document.body);
    expect(checks.every((check) => check.status === 'pass')).toBe(true);
  });

  it('IR 里有滑块但 DOM 没有 → range-present 失败', () => {
    render(<CoursewareView courseware={S2_COURSEWARE} />);
    // 模拟「渲染器把滑块丢了」
    document.querySelectorAll('input[type="range"]').forEach((input) => input.remove());

    const checks = checkDomStructure(S2_COURSEWARE, document.body);
    expect(statusOf(checks, 'L3.dom.range-present')).toBe('fail');
  });

  it('没有滑块的课件不该要求滑块', () => {
    const noSlider: Courseware = {
      ...S2_COURSEWARE,
      page: {
        ...S2_COURSEWARE.page,
        children: S2_COURSEWARE.page.children.filter((node) => node.kind !== 'slider'),
      },
    };

    render(<CoursewareView courseware={noSlider} />);
    const checks = checkDomStructure(noSlider, document.body);
    expect(statusOf(checks, 'L3.dom.range-present')).toBe('pass');
  });
});

describe('L4 行为', () => {
  it('拖动后 path 等于用新参数算出的路径', async () => {
    render(<CoursewareView courseware={S2_COURSEWARE} />);

    const checks = await checkBehavior(S2_COURSEWARE, document.body);
    expect(statusOf(checks, 'L4.behavior.slider-updates-plot')).toBe('pass');

    // 验证完成后必须复原，不能把滑块留在系统推过去的位置
    const input = document.querySelector('input[type="range"]') as HTMLInputElement;
    expect(input.value).toBe('2');
  });

  it('控件存在但拖动不更新 → 失败（这正是题面里最难发现的那种故障）', async () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<input type="range" min="-3" max="3" step="0.5" value="2" />',
      '<svg><path data-testid="plot-line" d="M 0 630 L 480 -330"></path></svg>',
    ].join('');

    const checks = await checkBehavior(S2_COURSEWARE, root);
    const result = checks[0];
    expect(result?.status).toBe('fail');
    expect(result?.blockedReason).toContain('没有变化');
  });

  it('没有滑块的课件 → skipped 而不是 pass', async () => {
    const noSlider: Courseware = {
      ...S2_COURSEWARE,
      page: {
        ...S2_COURSEWARE.page,
        children: S2_COURSEWARE.page.children.filter((node) => node.kind !== 'slider'),
      },
    };

    render(<CoursewareView courseware={noSlider} />);
    const checks = await checkBehavior(noSlider, document.body);
    expect(checks[0]?.status).toBe('skipped');
  });
});
