/**
 * 课件容器：持有「滑块值」，把 IR 渲染成 DOM。
 *
 * 状态只在这里：页面内所有滑块共享一份 overrides，plot 渲染时从中取参数。
 * 换课件（新的 requestId）时必须重置，否则上一个课件的滑块值会污染新的图 ——
 * 这个 bug 只在「连续生成两次」时出现，很容易漏测。
 */

import { useEffect, useMemo, useState } from 'react';

import type { Courseware } from '../../contracts/index';
import { NODE_RENDERERS, renderNode, type NodeRenderContext } from './registry';
import { initialOverrides, resolveParams, withParam } from './state';

export function CoursewareView({ courseware }: { readonly courseware: Courseware }) {
  const [overrides, setOverrides] = useState(() => initialOverrides(courseware));

  // 关键：换课件要重置。依赖 page 的引用（每次响应都是新对象）
  useEffect(() => {
    setOverrides(initialOverrides(courseware));
  }, [courseware]);

  const ctx: NodeRenderContext = useMemo(
    () => ({
      overrides,
      setParam: (plotId, param, value) => setOverrides((previous) => withParam(previous, plotId, param, value)),
      resolve: resolveParams,
    }),
    [overrides],
  );

  return (
    <div className="courseware" data-testid="courseware" data-page-id={courseware.page.id}>
      {courseware.page.children.map((node) => (
        <div className="courseware__slot" key={node.id}>
          {renderNode(node, ctx)}
        </div>
      ))}
    </div>
  );
}

/** 供测试断言覆盖率用：注册表里到底注册了哪些类型。 */
export const REGISTERED_KINDS = Object.keys(NODE_RENDERERS).sort();
