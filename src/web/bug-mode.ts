/**
 * 故障注入开关（演示用，`?bug=`）。
 *
 * 为什么做成开关而不是写一段假日志：题面要的是「发现 → 定位 → 修复」的闭环，
 * 而假日志只能证明你会写日志。开关让故障**真实发生**：IR 里确实少了节点、
 * 绑定确实指错了、渲染器确实没注册 —— 于是验证器会真的红，trace 也会真的指向某一层。
 *
 * 三个模式刻意停在不同层：
 *   drop-node            编排丢节点 → L1（决策与产物不一致）
 *   break-binding        绑定悬空   → L2（结构合法但引用断了）
 *   unregistered-renderer 渲染器缺 → L3（IR 有，DOM 没有）
 */

import { isBugMode, type BugMode, type IrContentKind } from '../contracts/index';
import { NODE_RENDERERS } from './render/registry';

/** 从 `?bug=xxx` 读取；非法值当作没开，不让一个拼错让整页行为诡异。 */
export function readBugMode(search: string): BugMode | null {
  const value = new URLSearchParams(search).get('bug');
  return isBugMode(value) ? value : null;
}

/** 只影响浏览器侧的那个模式：把渲染器从注册表里拿掉。 */
export function applyRegistryBug(mode: BugMode | null): void {
  if (mode !== 'unregistered-renderer') return;
  delete (NODE_RENDERERS as Partial<Record<IrContentKind, unknown>>).slider;
}

/** 挂载时保存一份原始注册表，切换故障模式时据此复原。 */
const ORIGINAL_RENDERERS: Record<string, unknown> = { ...NODE_RENDERERS };

/**
 * 切换故障模式：先复原再按新模式注入。
 *
 * 为什么需要「复原」：从 unregistered-renderer 切回正常时，被删掉的渲染器必须回来，
 * 否则页面会一直缺滑块 —— 这种「开关关不掉」的 bug 在演示里最丢人。
 */
export function setRegistryBug(mode: BugMode | null): void {
  const mutable = NODE_RENDERERS as unknown as Record<string, unknown>;
  for (const [kind, renderer] of Object.entries(ORIGINAL_RENDERERS)) {
    mutable[kind] = renderer;
  }
  applyRegistryBug(mode);
}

/**
 * 需要发给服务端的模式。`unregistered-renderer` 是纯前端故障，
 * 发给后端只会污染 trace，所以不上送。
 */
export function serverBugFlag(mode: BugMode | null): BugMode | null {
  if (mode === 'drop-node' || mode === 'break-binding') return mode;
  return null;
}
