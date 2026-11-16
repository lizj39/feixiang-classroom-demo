/**
 * 渲染注册表：`IR 节点类型 → 渲染器` 的唯一映射。
 *
 * 为什么必须是显式的 `Record<IrContentKind, ...>` 而不是一堆 if：
 *  - 类型会强制覆盖全部节点类型，新增节点忘了注册就编译不过；
 *  - 运行时还能用 `Object.keys` 断言覆盖率（见测试），
 *    这条断言就是 P7「IR 有 slider 但页面没有滑块」故障的守门员。
 *
 * 取不到渲染器时不抛错，而是渲染一个显眼的占位符：
 * 故障要能被**看见并定位**，而不是把整个页面炸掉、什么都查不到。
 */

import type { ComponentType } from 'react';
import type { IrContentNode, IrContentKind } from '../../contracts/index';
import { ExerciseNodeView, PlotNodeView, SliderNodeView, TextNodeView } from './nodes';
import type { ParamOverrides, resolveParams } from './state';

export interface NodeRenderContext {
  readonly overrides: ParamOverrides;
  readonly setParam: (plotId: string, param: 'k' | 'b', value: number) => void;
  readonly resolve: typeof resolveParams;
}

export interface NodeRendererProps {
  readonly node: IrContentNode;
  readonly ctx: NodeRenderContext;
}

type NodeRenderer = ComponentType<NodeRendererProps>;

export const NODE_RENDERERS: Record<IrContentKind, NodeRenderer> = {
  plot({ node, ctx }) {
    if (node.kind !== 'plot') return null;
    return <PlotNodeView node={node} params={ctx.resolve(node, ctx.overrides)} />;
  },

  slider({ node, ctx }) {
    if (node.kind !== 'slider') return null;
    const value = ctx.overrides[node.bindTo.nodeId]?.[node.bindTo.param] ?? node.range.value;
    return (
      <SliderNodeView
        node={node}
        value={value}
        onChange={(next) => ctx.setParam(node.bindTo.nodeId, node.bindTo.param, next)}
      />
    );
  },

  text({ node }) {
    if (node.kind !== 'text') return null;
    return <TextNodeView node={node} />;
  },

  exercise({ node }) {
    if (node.kind !== 'exercise') return null;
    return <ExerciseNodeView node={node} />;
  },
};

/** 渲染一个节点；类型未注册时返回显式占位符（P7 的故障就长这样）。 */
export function renderNode(node: IrContentNode, ctx: NodeRenderContext) {
  const Renderer = NODE_RENDERERS[node.kind];
  if (!Renderer) {
    return (
      <div className="missing-renderer" data-testid="missing-renderer" data-kind={node.kind}>
        ⚠ 未注册的节点类型：{String(node.kind)}（节点 {node.id} 没有渲染器）
      </div>
    );
  }
  return <Renderer node={node} ctx={ctx} />;
}
