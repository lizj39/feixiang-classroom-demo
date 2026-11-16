/**
 * 冲突检测与裁决。
 *
 * 检测走两路，因为两种冲突的成因不同：
 *   explicit-conflictsWith —— manifest 显式声明（约定）
 *   shared-slot            —— 两个 Skill 抢同一个题位（结构事实）
 * 只有前者时，漏声明就会静默拼出两个抢同一题位的节点；只有后者时，语义互斥
 * 但槽位不同的 Skill 又检测不到。两路都要。
 *
 * 裁决规则刻意简单且唯一：优先级高者胜；相同优先级一律降级澄清，不猜。
 * 「猜」的代价是老师拿到一个不想要的东西，而不是一句询问。
 */

import type { ConflictResolution, ConflictRule, SkillId, SkillManifest } from '../../contracts/index';

export interface ConflictPair {
  readonly a: SkillId;
  readonly b: SkillId;
  readonly by: readonly ConflictRule[];
}

function pairsOf<T>(items: readonly T[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < items.length; j += 1) {
      const b = items[j];
      if (b === undefined) continue;
      pairs.push([a, b]);
    }
  }
  return pairs;
}

export function detectConflicts(selected: readonly SkillManifest[]): ConflictPair[] {
  const conflicts: ConflictPair[] = [];

  for (const [a, b] of pairsOf(selected)) {
    const by: ConflictRule[] = [];

    if (a.conflictsWith.includes(b.id) || b.conflictsWith.includes(a.id)) {
      by.push('explicit-conflictsWith');
    }
    if (a.slot === b.slot) {
      by.push('shared-slot');
    }

    if (by.length > 0) {
      conflicts.push({ a: a.id, b: b.id, by });
    }
  }

  return conflicts;
}

export function resolveConflicts(
  selected: readonly SkillManifest[],
  conflicts: readonly ConflictPair[],
): ConflictResolution {
  const involvedIds = [...new Set(conflicts.flatMap((conflict) => [conflict.a, conflict.b]))];
  const involved = selected.filter((manifest) => involvedIds.includes(manifest.id));
  const by = [...new Set(conflicts.flatMap((conflict) => conflict.by))];

  const topPriority = Math.max(...involved.map((manifest) => manifest.priority));
  const tier = involved.filter((manifest) => manifest.priority === topPriority);

  if (tier.length > 1) {
    const names = tier.map((manifest) => manifest.id).join(' / ');
    return {
      kind: 'degrade-to-clarify',
      competitors: tier.map((manifest) => manifest.id),
      by,
      reason: `${names} 同为优先级 ${topPriority}，无法裁决，按策略降级为澄清而不是硬选一个。`,
    };
  }

  const winner = tier[0];
  if (!winner) {
    // 理论不可达（conflicts 非空则 involved 非空）；保底走降级，绝不抛错给用户
    return {
      kind: 'degrade-to-clarify',
      competitors: involved.map((manifest) => manifest.id),
      by,
      reason: '冲突双方无法比较优先级，降级为澄清。',
    };
  }

  const dropped = involved.filter((manifest) => manifest.id !== winner.id).map((manifest) => manifest.id);

  return {
    kind: 'winner',
    kept: selected.filter((manifest) => !dropped.includes(manifest.id)).map((manifest) => manifest.id),
    dropped,
    by,
    reason: `${winner.id} 优先级 ${winner.priority} 高于 ${dropped.join(' / ')}，保留它并丢弃冲突方。`,
  };
}
