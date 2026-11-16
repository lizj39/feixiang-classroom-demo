/**
 * 四个节点渲染器。都对 IR 负责，不知道「谁产出了这个节点」——
 * 渲染器里出现 `if (source === 'interactive-slider')` 就是设计出问题的信号。
 *
 * 选择原生 `input[type=range]` 而不是自绘拖拽条：
 *   1. 键盘可操作、无障碍属性天然具备；
 *   2. L3 验证可以用一个稳定的选择器 `input[type=range]` 断言「控件真的存在」，
 *      而不依赖某个 class 名。
 */

import type { IrExerciseNode, IrPlotNode, IrSliderNode, IrTextNode, PlotParams } from '../../contracts/index';
import { createProjection, linePath, PLOT_VIEW } from './plot-math';

export function PlotNodeView({ node, params }: { readonly node: IrPlotNode; readonly params: PlotParams }) {
  const projection = createProjection(params, PLOT_VIEW);
  const origin = projection.toPixel(0, 0);
  const equation = `y = ${formatNumber(params.k)}x ${params.b < 0 ? '-' : '+'} ${formatNumber(Math.abs(params.b))}`;

  return (
    <figure className="plot" data-testid="plot" data-node-id={node.id} data-kind="plot">
      <svg
        className="plot__svg"
        viewBox={`0 0 ${PLOT_VIEW.width} ${PLOT_VIEW.height}`}
        role="img"
        aria-label={`函数图像 ${equation}`}
      >
        {/* 坐标轴：x 轴在 y=0，y 轴在 x=0 */}
        <line className="plot__axis" x1={0} y1={origin.py} x2={PLOT_VIEW.width} y2={origin.py} />
        <line className="plot__axis" x1={origin.px} y1={0} x2={origin.px} y2={PLOT_VIEW.height} />
        {/* 直线：d 属性是「图像真的跟着参数变」的唯一证据 */}
        <path className="plot__line" data-testid="plot-line" d={linePath(params, PLOT_VIEW)} />
      </svg>
      <figcaption className="plot__caption mono" data-testid="plot-equation">
        {equation}
      </figcaption>
    </figure>
  );
}

export function SliderNodeView({
  node,
  value,
  onChange,
}: {
  readonly node: IrSliderNode;
  readonly value: number;
  readonly onChange: (next: number) => void;
}) {
  return (
    <div className="slider" data-testid="slider" data-node-id={node.id} data-kind="slider">
      <label className="slider__label">
        <span>{node.label}</span>
        <output className="slider__value mono" data-testid="slider-value">
          {formatNumber(value)}
        </output>
      </label>
      <input
        className="slider__input"
        data-testid="slider-input"
        type="range"
        min={node.range.min}
        max={node.range.max}
        step={node.range.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="slider__scale mono">
        <span>{formatNumber(node.range.min)}</span>
        <span>{formatNumber(node.range.max)}</span>
      </div>
    </div>
  );
}

export function TextNodeView({ node }: { readonly node: IrTextNode }) {
  if (node.variant === 'title') {
    return (
      <h2 className="cw__title" data-testid="text-node" data-node-id={node.id} data-kind="text">
        {node.content}
      </h2>
    );
  }
  if (node.variant === 'hint') {
    return (
      <p className="cw__hint" data-testid="text-node" data-node-id={node.id} data-kind="text">
        {node.content}
      </p>
    );
  }
  return (
    <p className="cw__body" data-testid="text-node" data-node-id={node.id} data-kind="text">
      {node.content}
    </p>
  );
}

export function ExerciseNodeView({ node }: { readonly node: IrExerciseNode }) {
  return (
    <div className="exercise" data-testid="exercise" data-node-id={node.id} data-kind="exercise">
      <p className="exercise__prompt">{node.prompt}</p>

      {node.mode === 'choice' ? (
        <ul className="exercise__choices">
          {(node.choices ?? []).map((choice) => (
            <li key={choice}>
              <label>
                <input type="radio" name={node.id} value={choice} /> {choice}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <input className="exercise__blank" type="text" placeholder="填写答案" aria-label="填空答案" />
      )}
    </div>
  );
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
