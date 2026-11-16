/**
 * 契约 2/5 —— 课件 IR
 *
 * IR 是 Router 与 Renderer 之间唯一的交换格式：Skill 只产出节点（不是整页），
 * 由 Composer 合成一棵 page 树，Renderer 只认节点类型。
 *
 * 设计约束（有意为之）：
 *  - 节点类型封顶 5 种，新增类型必须同时改 `IR_NODE_KINDS`（渲染注册表的覆盖率断言依赖它）；
 *  - 所有引用（如 slider.bindTo）都是「按 id 的软引用」，悬空引用属于 L2 验证要抓的错误；
 *  - 只放渲染必需的字段，不放样式/布局，避免 IR 退化成前端组件的镜像。
 */

/** 全部节点类型。新增节点必须加在这里，`IR_NODE_KINDS` 是注册表覆盖率的唯一事实源。 */
export const IR_NODE_KINDS = ['page', 'plot', 'slider', 'text', 'exercise'] as const;

export type IrNodeKind = (typeof IR_NODE_KINDS)[number];

/** 除 page 之外的节点，即 page.children 的合法成员。 */
export const IR_CONTENT_KINDS = ['plot', 'slider', 'text', 'exercise'] as const;

export type IrContentKind = (typeof IR_CONTENT_KINDS)[number];

/** 可以被 slider 绑定的 plot 参数名。不允许绑定 `domain`，因为它不是可调数值。 */
export const BINDABLE_PLOT_PARAMS = ['k', 'b'] as const;

export type BindablePlotParam = (typeof BINDABLE_PLOT_PARAMS)[number];

export interface IrNodeBase {
  /** 节点类型，判别式联合的判别字段。 */
  readonly kind: IrNodeKind;
  /** 页面内唯一。合并时按 `source + id` 加命名空间前缀，避免两个 Skill 撞 id。 */
  readonly id: string;
  /** 产出者：`composer` 或 SkillId。trace 与证据面板用它说明「这个节点是谁放的」。 */
  readonly source: string;
}

export interface PlotDomain {
  readonly xMin: number;
  readonly xMax: number;
}

/** 一次函数 y = kx + b 的参数。刻意只支持一次函数，保证图像可以被数值断言。 */
export interface PlotParams {
  readonly k: number;
  readonly b: number;
  readonly domain: PlotDomain;
}

export interface IrPlotNode extends IrNodeBase {
  readonly kind: 'plot';
  readonly params: PlotParams;
}

/** slider 对 plot 参数的软引用：nodeId 必须存在，param 必须是 k/b。 */
export interface SliderBinding {
  readonly nodeId: string;
  readonly param: BindablePlotParam;
}

export interface SliderRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** 初始值。必须落在 [min, max] 内（L2 验证项）。 */
  readonly value: number;
}

export interface IrSliderNode extends IrNodeBase {
  readonly kind: 'slider';
  readonly label: string;
  readonly bindTo: SliderBinding;
  readonly range: SliderRange;
}

export interface IrTextNode extends IrNodeBase {
  readonly kind: 'text';
  readonly content: string;
  readonly variant: 'title' | 'body' | 'hint';
}

export interface IrExerciseNode extends IrNodeBase {
  readonly kind: 'exercise';
  /** 同题位互斥的两种作答方式：choice 出选项，input 出输入框，二者不共存。 */
  readonly mode: 'choice' | 'input';
  readonly prompt: string;
  /** mode === 'choice' 时必填且非空；mode === 'input' 时必须缺省（L2 验证项）。 */
  readonly choices?: readonly string[];
  /** 参考答案，用于验证「练习真的可作答」而不是一张图片。 */
  readonly answer: string;
}

export type IrContentNode = IrPlotNode | IrSliderNode | IrTextNode | IrExerciseNode;

export interface IrPageNode extends IrNodeBase {
  readonly kind: 'page';
  readonly title: string;
  readonly children: readonly IrContentNode[];
}

export type IrNode = IrPageNode | IrContentNode;

/** Composer 的完整产物。Renderer 的输入。 */
export interface Courseware {
  readonly irVersion: 1;
  readonly page: IrPageNode;
}

/** 判别式联合的穷尽性守卫：新增节点类型而漏处理时编译期报错。 */
export function assertNeverIrNode(node: never): never {
  throw new Error(`未处理的 IR 节点: ${JSON.stringify(node)}`);
}
