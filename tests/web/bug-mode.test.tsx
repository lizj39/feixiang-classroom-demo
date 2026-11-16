// @vitest-environment jsdom
/**
 * 前端故障开关的验收：URL 参数解析、注册表注入、上送策略。
 *
 * 重点：`unregistered-renderer` 是纯前端故障，**不能**上送服务端 ——
 * 否则服务端 trace 里会出现一条与它无关的 flags，定位时反而误导。
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { IR_CONTENT_KINDS, type Courseware } from '../../src/contracts/index';
import { applyRegistryBug, readBugMode, serverBugFlag } from '../../src/web/bug-mode';
import { CoursewareView } from '../../src/web/render/CoursewareView';
import { NODE_RENDERERS } from '../../src/web/render/registry';
import { checkDomStructure } from '../../src/web/verify/dom-checks';
import { S2_COURSEWARE } from '../fixtures/scenarios';

const SAVED_SLIDER = NODE_RENDERERS.slider;

afterEach(() => {
  cleanup();
  // 注册表是模块级状态，必须复原，否则同文件后续用例会被污染
  const mutable = NODE_RENDERERS as Partial<Record<string, unknown>>;
  if (!mutable.slider) mutable.slider = SAVED_SLIDER;
});

function registeredKinds(): string[] {
  return Object.keys(NODE_RENDERERS).sort();
}

describe('URL 参数', () => {
  it('识别三种合法模式', () => {
    expect(readBugMode('?bug=drop-node')).toBe('drop-node');
    expect(readBugMode('?bug=break-binding')).toBe('break-binding');
    expect(readBugMode('?bug=unregistered-renderer')).toBe('unregistered-renderer');
  });

  it('没有参数或拼错时当作没开', () => {
    expect(readBugMode('')).toBeNull();
    expect(readBugMode('?bug=')).toBeNull();
    expect(readBugMode('?bug=oops')).toBeNull();
  });

  it('只有服务端侧的两个模式上送后端', () => {
    expect(serverBugFlag('drop-node')).toBe('drop-node');
    expect(serverBugFlag('break-binding')).toBe('break-binding');
    expect(serverBugFlag('unregistered-renderer')).toBeNull();
    expect(serverBugFlag(null)).toBeNull();
  });
});

describe('注册表注入', () => {
  it('unregistered-renderer 会把 slider 拿掉，其他模式不动注册表', () => {
    applyRegistryBug('drop-node');
    expect(registeredKinds()).toEqual([...IR_CONTENT_KINDS].sort());

    applyRegistryBug('unregistered-renderer');
    expect(registeredKinds()).not.toContain('slider');
  });
});

describe('前端故障停在哪一层', () => {
  it('渲染器缺项时 IR 仍然完整，但 DOM 里没有滑块 → L3 失败', () => {
    applyRegistryBug('unregistered-renderer');
    render(<CoursewareView courseware={S2_COURSEWARE} />);

    const checks = checkDomStructure(S2_COURSEWARE, document.body);
    const rangeCheck = checks.find((check) => check.ruleId === 'L3.dom.range-present');

    expect(rangeCheck?.status).toBe('fail');
    expect(rangeCheck?.expected).toBe(1);
    expect(rangeCheck?.actual).toBe(0);

    // IR 本身没问题：它确实有 slider 节点 —— 这正是「服务端全绿、页面却没有」的样子
    const courseware: Courseware = S2_COURSEWARE;
    expect(courseware.page.children.filter((node) => node.kind === 'slider')).toHaveLength(1);
    // 页面上有个显眼占位符，故障能被看见而不是白屏
    expect(document.querySelector('[data-testid="missing-renderer"]')).not.toBeNull();
  });
});
