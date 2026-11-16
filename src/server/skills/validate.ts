/**
 * Manifest 校验：两层，因为约束的性质不同。
 *
 *   单个 manifest —— 字段类型、取值、枚举（`produces` 只能是 IR 里存在的节点）
 *   整组 manifest —— 集合级交叉约束（id 唯一、互斥对称、requires 无环、namespace 不撞）
 *
 * 两条设计原则：
 *  1. **错误聚合**：一次返回全部问题，不是遇到第一个就停。否则改一个 manifest 要来回跑十次。
 *  2. **错误带路径**：`manifests[2].produces[0]` 这种定位串可以直接显示在界面上，
 *     也能被测试精确断言 —— 只说「manifest 不合法」等于没检查。
 */

import { IR_CONTENT_KINDS, SKILL_IDS, SKILL_SLOTS } from '../../contracts/index';
import type { Violation } from '../validation/violation';

export type { Violation };

const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/;
const PARAM_TYPES = ['number', 'string', 'enum', 'boolean'] as const;
const TRIGGER_KEYS = ['primary', 'synonyms', 'intents'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidId(value: unknown): value is string {
  return isNonEmptyString(value) && (SKILL_IDS as readonly string[]).includes(value);
}

export function validateManifest(input: unknown, path = 'manifest'): Violation[] {
  const violations: Violation[] = [];
  const push = (sub: string, rule: string, message: string) => {
    violations.push({ path: `${path}${sub}`, rule, message });
  };

  if (!isRecord(input)) {
    push('', 'object', 'manifest 必须是对象');
    return violations;
  }

  if (!isNonEmptyString(input.id)) {
    push('.id', 'required', 'id 必须是非空字符串');
  } else if (!isValidId(input.id)) {
    push('.id', 'enum', `id 必须是 ${SKILL_IDS.join(' / ')} 之一，当前是 ${input.id}`);
  }

  if (!isNonEmptyString(input.displayName)) push('.displayName', 'required', 'displayName 必填');
  if (!isNonEmptyString(input.summary)) push('.summary', 'required', 'summary 必填');

  if (!isNonEmptyString(input.slot)) {
    push('.slot', 'required', 'slot 必填');
  } else if (!(SKILL_SLOTS as readonly string[]).includes(input.slot)) {
    push('.slot', 'enum', `slot 必须是 ${SKILL_SLOTS.join(' / ')} 之一，当前是 ${input.slot}`);
  }

  if (typeof input.priority !== 'number') {
    push('.priority', 'type', 'priority 必须是数字');
  } else if (!Number.isInteger(input.priority)) {
    push('.priority', 'integer', 'priority 必须是整数');
  } else if (input.priority < 0 || input.priority > 100) {
    push('.priority', 'range', `priority 必须在 0-100 之间，当前是 ${input.priority}`);
  }

  if (!isNonEmptyString(input.namespace)) {
    push('.namespace', 'required', 'namespace 必填');
  } else if (!NAMESPACE_PATTERN.test(input.namespace)) {
    push('.namespace', 'format', `namespace 只能是小写字母开头、由小写字母/数字/连字符组成，当前是 ${input.namespace}`);
  }

  validateTriggers(input.triggers, push);
  validateProduces(input.produces, push);
  validateReferences(input, push);
  validateParams(input.params, push);

  return violations;
}

type Push = (sub: string, rule: string, message: string) => void;

function validateTriggers(triggers: unknown, push: Push): void {
  if (!isRecord(triggers)) {
    push('.triggers', 'object', 'triggers 必须是对象');
    return;
  }

  const seen = new Map<string, string>();

  for (const key of TRIGGER_KEYS) {
    const list = triggers[key];
    if (!Array.isArray(list)) {
      push(`.triggers.${key}`, 'type', `triggers.${key} 必须是数组`);
      continue;
    }

    list.forEach((item, index) => {
      if (!isNonEmptyString(item)) {
        push(`.triggers.${key}[${index}]`, 'type', '触发词必须是非空字符串');
        return;
      }
      // 同一个词出现在两个列表里会让分值翻倍且无法解释
      const previous = seen.get(item);
      if (previous) {
        push(`.triggers.${key}[${index}]`, 'duplicate', `「${item}」与 ${previous} 重复`);
        return;
      }
      seen.set(item, `triggers.${key}[${index}]`);
    });
  }

  if (Array.isArray(triggers.primary) && triggers.primary.length === 0) {
    push('.triggers.primary', 'required', 'primary 不能为空：没有强信号的 Skill 永远不会被选中');
  }
}

function validateProduces(produces: unknown, push: Push): void {
  if (!Array.isArray(produces)) {
    push('.produces', 'type', 'produces 必须是数组');
    return;
  }
  if (produces.length === 0) {
    push('.produces', 'required', 'produces 不能为空：不产出任何节点的 Skill 没有意义');
  }

  const seen = new Set<string>();
  produces.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      push(`.produces[${index}]`, 'type', 'produces 的元素必须是字符串');
      return;
    }
    if (!(IR_CONTENT_KINDS as readonly string[]).includes(item)) {
      push(
        `.produces[${index}]`,
        'enum',
        `${item} 不是 IR 内容节点类型（合法值：${IR_CONTENT_KINDS.join(' / ')}）`,
      );
      return;
    }
    if (seen.has(item)) push(`.produces[${index}]`, 'duplicate', `${item} 重复声明`);
    seen.add(item);
  });
}

function validateReferences(input: Record<string, unknown>, push: Push): void {
  for (const key of ['requires', 'conflictsWith'] as const) {
    const list = input[key];
    if (!Array.isArray(list)) {
      push(`.${key}`, 'type', `${key} 必须是数组`);
      continue;
    }

    list.forEach((item, index) => {
      if (!isNonEmptyString(item)) {
        push(`.${key}[${index}]`, 'type', `${key} 的元素必须是字符串`);
        return;
      }
      if (!isValidId(item)) {
        push(`.${key}[${index}]`, 'enum', `${key} 引用了不存在的 Skill：${item}`);
        return;
      }
      if (isNonEmptyString(input.id) && item === input.id) {
        push(`.${key}[${index}]`, 'self-reference', `${key} 不能引用自己`);
      }
    });
  }
}

function validateParams(params: unknown, push: Push): void {
  if (!Array.isArray(params)) {
    push('.params', 'type', 'params 必须是数组（可以为空）');
    return;
  }

  const names = new Set<string>();

  params.forEach((param, index) => {
    const path = `.params[${index}]`;

    if (!isRecord(param)) {
      push(path, 'object', '参数必须是对象');
      return;
    }

    if (!isNonEmptyString(param.name)) {
      push(`${path}.name`, 'required', '参数名必填');
    } else if (names.has(param.name)) {
      push(`${path}.name`, 'duplicate', `参数名 ${param.name} 重复`);
    } else {
      names.add(param.name);
    }

    if (!isNonEmptyString(param.description)) {
      push(`${path}.description`, 'required', '参数说明必填：界面上要展示它');
    }

    if (!isNonEmptyString(param.type) || !(PARAM_TYPES as readonly string[]).includes(param.type)) {
      push(`${path}.type`, 'enum', `参数类型必须是 ${PARAM_TYPES.join(' / ')} 之一`);
      return;
    }

    if (param.type === 'number') validateNumberParam(param, path, push);
    if (param.type === 'enum' && (!Array.isArray(param.values) || param.values.length === 0)) {
      push(`${path}.values`, 'required', 'enum 参数必须给出非空 values');
    }
  });
}

function validateNumberParam(param: Record<string, unknown>, path: string, push: Push): void {
  if (typeof param.default !== 'number') {
    push(`${path}.default`, 'type', 'number 参数的 default 必须是数字');
  }

  const min = param.min;
  const max = param.max;

  if (min !== undefined && typeof min !== 'number') push(`${path}.min`, 'type', 'min 必须是数字');
  if (max !== undefined && typeof max !== 'number') push(`${path}.max`, 'type', 'max 必须是数字');

  if (typeof min === 'number' && typeof max === 'number' && min > max) {
    push(`${path}.min`, 'range', `min(${min}) 不能大于 max(${max})`);
  }

  if (typeof param.default === 'number') {
    if (typeof min === 'number' && param.default < min) {
      push(`${path}.default`, 'range', `默认值 ${param.default} 小于下界 ${min}`);
    }
    if (typeof max === 'number' && param.default > max) {
      push(`${path}.default`, 'range', `默认值 ${param.default} 大于上界 ${max}`);
    }
  }
}

interface Entry {
  readonly index: number;
  readonly manifest: Record<string, unknown>;
  readonly id: string;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * 整组校验：单个 manifest 合法并不代表这组声明是可用的。
 * 这四条约束如果漏掉，故障会在运行时以更难查的形式出现：
 *   重复 id       → 注册表被悄悄覆盖，另一个 Skill 凭空消失
 *   互斥不对称    → 冲突只在一侧生效，取决于遍历顺序
 *   requires 成环 → 组合编排时拓扑排序死循环
 *   namespace 撞  → 合并后节点 id 冲突，后写入的覆盖前一个
 */
export function validateManifests(inputs: readonly unknown[]): Violation[] {
  const violations: Violation[] = [];
  inputs.forEach((manifest, index) => {
    violations.push(...validateManifest(manifest, `manifests[${index}]`));
  });

  const entries: Entry[] = [];
  inputs.forEach((manifest, index) => {
    if (isRecord(manifest) && isNonEmptyString(manifest.id)) {
      entries.push({ index, manifest, id: manifest.id });
    }
  });

  // 1) id 唯一
  const idOwner = new Map<string, number>();
  for (const entry of entries) {
    const previous = idOwner.get(entry.id);
    if (previous !== undefined) {
      violations.push({
        path: `manifests[${entry.index}].id`,
        rule: 'duplicate-id',
        message: `id ${entry.id} 与 manifests[${previous}] 重复，注册表会互相覆盖`,
      });
      continue;
    }
    idOwner.set(entry.id, entry.index);
  }

  // 2) namespace 唯一
  const namespaceOwner = new Map<string, string>();
  for (const entry of entries) {
    const namespace = entry.manifest.namespace;
    if (!isNonEmptyString(namespace)) continue;
    const previous = namespaceOwner.get(namespace);
    if (previous) {
      violations.push({
        path: `${entry.id}.namespace`,
        rule: 'duplicate-namespace',
        message: `namespace ${namespace} 与 ${previous} 相同，合并后节点 id 会互相覆盖`,
      });
      continue;
    }
    namespaceOwner.set(namespace, entry.id);
  }

  // 3) conflictsWith 必须对称
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  for (const entry of entries) {
    for (const other of stringsOf(entry.manifest.conflictsWith)) {
      const target = byId.get(other);
      if (!target) continue; // 引用不存在的 Skill 已在单体检出
      if (!stringsOf(target.manifest.conflictsWith).includes(entry.id)) {
        violations.push({
          path: `${entry.id}.conflictsWith`,
          rule: 'asymmetric-conflict',
          message: `${entry.id} 声明与 ${other} 互斥，但 ${other} 没有回指 —— 冲突只会在遍历到 ${entry.id} 时生效`,
        });
      }
    }
  }

  // 4) requires 必须存在 + 无环
  const graph = new Map<string, readonly string[]>();
  for (const entry of entries) {
    const requires = stringsOf(entry.manifest.requires).filter((id) => id !== entry.id);
    graph.set(entry.id, requires);
    for (const required of requires) {
      if (!byId.has(required)) {
        violations.push({
          path: `${entry.id}.requires`,
          rule: 'unknown-requires',
          message: `${entry.id} 依赖的 ${required} 不在本次注册的 Skill 集合里`,
        });
      }
    }
  }

  violations.push(...findCycles(graph));

  return violations;
}

function findCycles(graph: ReadonlyMap<string, readonly string[]>): Violation[] {
  const violations: Violation[] = [];
  const finished = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();

  const walk = (id: string): void => {
    if (finished.has(id)) return;

    const cycleStart = stack.indexOf(id);
    if (cycleStart >= 0) {
      const cycle = [...stack.slice(cycleStart), id];
      const signature = [...new Set(cycle)].sort().join(',');
      if (!reported.has(signature)) {
        reported.add(signature);
        violations.push({
          path: `${id}.requires`,
          rule: 'requires-cycle',
          message: `requires 成环：${cycle.join(' → ')}，拓扑排序无法终止`,
        });
      }
      return;
    }

    stack.push(id);
    for (const next of graph.get(id) ?? []) {
      walk(next);
    }
    stack.pop();
    finished.add(id);
  };

  for (const id of graph.keys()) walk(id);
  return violations;
}
