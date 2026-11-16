/**
 * Skill 注册表：把 manifest 集合变成可查询的对象。
 *
 * 它刻意只做「查询」，不做「决策」：
 *   - 没有 score()，那是 P3 Router 的事；
 *   - 没有 merge()，那是 P5 Composer 的事。
 * 一旦注册表开始做决策，它就会变成第二个 Router，后面谁都说不清逻辑在哪。
 *
 * 创建时校验，失败即抛错并带全部违规项 —— 宁可启动就失败，也不要带着坏 manifest 跑。
 */

import type { SkillId, SkillManifest, SkillSlot } from '../../contracts/index';
import { SKILL_MANIFESTS } from './manifests';
import { validateManifests, type Violation } from './validate';

export class SkillRegistryError extends Error {
  readonly violations: readonly Violation[];

  constructor(violations: readonly Violation[]) {
    super(
      `Skill 注册表校验失败（${violations.length} 处）：` +
        violations.map((violation) => `${violation.path} ${violation.message}`).join('；'),
    );
    this.name = 'SkillRegistryError';
    this.violations = violations;
  }
}

export interface SkillRegistry {
  readonly size: number;
  all(): readonly SkillManifest[];
  get(id: string): SkillManifest | undefined;
  bySlot(slot: SkillSlot): readonly SkillManifest[];
  /** 按触发词反查（精确匹配，不做子串）。用于「这句话提到了哪些能力」的快速定位。 */
  byTrigger(token: string): readonly SkillManifest[];
  /** 某个 Skill 声明的全部触发词，供 Router/界面展示。 */
  tokensOf(id: SkillId): readonly string[];
}

export function createSkillRegistry(manifests: readonly SkillManifest[]): SkillRegistry {
  const violations = validateManifests(manifests);
  if (violations.length > 0) {
    throw new SkillRegistryError(violations);
  }

  const byId = new Map<string, SkillManifest>();
  const triggerIndex = new Map<string, SkillManifest[]>();

  for (const manifest of manifests) {
    byId.set(manifest.id, manifest);
    const tokens = [...manifest.triggers.primary, ...manifest.triggers.synonyms, ...manifest.triggers.intents];
    for (const token of tokens) {
      const bucket = triggerIndex.get(token);
      if (bucket) bucket.push(manifest);
      else triggerIndex.set(token, [manifest]);
    }
  }

  return {
    size: manifests.length,
    all: () => manifests,
    get: (id) => byId.get(id),
    bySlot: (slot) => manifests.filter((manifest) => manifest.slot === slot),
    byTrigger: (token) => triggerIndex.get(token) ?? [],
    tokensOf: (id) => {
      const manifest = byId.get(id);
      if (!manifest) return [];
      return [...manifest.triggers.primary, ...manifest.triggers.synonyms, ...manifest.triggers.intents];
    },
  };
}

let cached: SkillRegistry | null = null;

/** 真实注册表按需创建并缓存：模块被 import 时不抛错，避免影响无关测试。 */
export function getSkillRegistry(): SkillRegistry {
  cached ??= createSkillRegistry(SKILL_MANIFESTS);
  return cached;
}
