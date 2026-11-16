// @vitest-environment jsdom
/**
 * 课件渲染的验收。
 *
 * 两条最关键的断言：
 *  1. `input[type=range]` 真的存在 —— 这是 L3 验证要用的稳定选择器；
 *  2. 拖动后 `path.d` 等于用新参数算出来的路径 —— 不是「变了」，而是「变对了」。
 *
 * 顺带把「注册表覆盖不全」这个故障面也测了：拿掉一个渲染器，页面必须给出
 * 显式占位符，而不是白屏或抛错。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { IR_CONTENT_KINDS, type Courseware, type PlotParams } from '../../src/contracts/index';
import { CoursewareView, REGISTERED_KINDS } from '../../src/web/render/CoursewareView';
import { linePath } from '../../src/web/render/plot-math';
import { NODE_RENDERERS } from '../../src/web/render/registry';
import { S2_COURSEWARE } from '../fixtures/scenarios';

const DOMAIN = { xMin: -5, xMax: 5 };

function expectedPath(k: number, b = 1): string {
  const params: PlotParams = { k, b, domain: DOMAIN };
  return linePath(params);
}

afterEach(() => {
  cleanup();
});

describe('渲染注册表', () => {
  it('覆盖全部 IR 内容节点类型（少一个就是 P7 的「有 IR 没控件」故障）', () => {
    expect(REGISTERED_KINDS).toEqual([...IR_CONTENT_KINDS].sort());
  });
});

describe('S2 课件', () => {
  it('画出图像与滑块，且初始直线与 IR 参数一致', () => {
    render(<CoursewareView courseware={S2_COURSEWARE} />);

    expect(screen.getByTestId('plot')).toBeTruthy();
    expect(screen.getByTestId('slider')).toBeTruthy();
    expect(document.querySelector('input[type="range"]')).not.toBeNull();

    expect(screen.getByTestId('plot-line').getAttribute('d')).toBe(expectedPath(2));
    expect(screen.getByTestId('slider-value').textContent).toBe('2');
  });

  it('拖动滑块后，直线变成用新参数算出的路径（不是「看起来变了」）', () => {
    render(<CoursewareView courseware={S2_COURSEWARE} />);
    const input = screen.getByTestId('slider-input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '1' } });

    expect(screen.getByTestId('slider-value').textContent).toBe('1');
    expect(screen.getByTestId('plot-line').getAttribute('d')).toBe(expectedPath(1));
    expect(screen.getByTestId('plot-line').getAttribute('d')).not.toBe(expectedPath(2));
  });

  it('公式文字跟着参数更新，学生看到的就是他拖出来的那条线', () => {
    render(<CoursewareView courseware={S2_COURSEWARE} />);
    fireEvent.change(screen.getByTestId('slider-input'), { target: { value: '-1' } });
    expect(screen.getByTestId('plot-equation').textContent).toContain('-1');
  });

  it('换成另一份课件时，滑块状态被重置（否则上一次的拖动会污染新图）', () => {
    const { rerender } = render(<CoursewareView courseware={S2_COURSEWARE} />);
    fireEvent.change(screen.getByTestId('slider-input'), { target: { value: '-2' } });
    expect(screen.getByTestId('slider-value').textContent).toBe('-2');

    const another: Courseware = {
      ...S2_COURSEWARE,
      page: { ...S2_COURSEWARE.page, id: 'composer:page#2' },
    };
    rerender(<CoursewareView courseware={another} />);

    expect(screen.getByTestId('slider-value').textContent).toBe('2');
    expect(screen.getByTestId('plot-line').getAttribute('d')).toBe(expectedPath(2));
  });
});

describe('注册表缺项时的表现', () => {
  it('未注册的节点类型渲染显式占位符，而不是白屏或抛错', () => {
    const mutable = NODE_RENDERERS as unknown as Record<string, unknown>;
    const saved = mutable.text;
    mutable.text = undefined;

    try {
      render(<CoursewareView courseware={S2_COURSEWARE} />);
      // S2 课件里有两个文本节点（标题 + 提示），两个都该显示占位符
      const placeholders = screen.getAllByTestId('missing-renderer');
      expect(placeholders).toHaveLength(2);
      expect(placeholders[0]?.textContent).toContain('text');
      // 其他节点仍然正常渲染 —— 一个类型缺失不该拖垮整页
      expect(screen.getByTestId('plot')).toBeTruthy();
    } finally {
      mutable.text = saved;
    }
  });
});
