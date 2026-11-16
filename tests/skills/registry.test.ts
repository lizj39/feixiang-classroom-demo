/**
 * 注册表的验收：查询行为 + 拒绝坏数据。
 *
 * 「拒绝坏数据」这几条比查询更重要 —— 一个接受重复 id 的注册表，
 * 会让其中一个 Skill 凭空消失，而错误要等到演示时才暴露。
 */

import { describe, expect, it } from 'vitest';

import { IR_CONTENT_KINDS, SKILL_IDS, type SkillManifest } from '../../src/contracts/index';
import { SKILL_MANIFESTS } from '../../src/server/skills/manifests';
import { SkillRegistryError, createSkillRegistry, getSkillRegistry } from '../../src/server/skills/registry';
import { validateManifests } from '../../src/server/skills/validate';

describe('真实注册表', () => {
  const registry = createSkillRegistry(SKILL_MANIFESTS);

  it('加载 4 个 Skill，id 与契约里的封闭集合一致', () => {
    expect(registry.size).toBe(4);
    expect(registry.all().map((manifest) => manifest.id).sort()).toEqual([...SKILL_IDS].sort());
  });

  it('get 命中返回声明,未知 id 返回 undefined', () => {
    expect(registry.get('interactive-slider')?.displayName).toBe('滑块联动');
    expect(registry.get('不存在的-skill')).toBeUndefined();
  });

  it('bySlot 能取出同槽位的竞争者（冲突检测的输入）', () => {
    const exercise = registry.bySlot('exercise');
    expect(exercise).toHaveLength(2);
    expect(exercise.map((manifest) => manifest.id).sort()).toEqual(['exercise-choice', 'exercise-input']);
    expect(registry.bySlot('visual')).toHaveLength(1);
  });

  it('byTrigger 精确命中，不做子串猜测', () => {
    expect(registry.byTrigger('滑块').map((manifest) => manifest.id)).toEqual(['interactive-slider']);
    expect(registry.byTrigger('练习题').map((manifest) => manifest.id).sort()).toEqual([
      'exercise-choice',
      'exercise-input',
    ]);
    expect(registry.byTrigger('滑')).toEqual([]);
  });

  it('tokensOf 给出某个 Skill 的全部触发词', () => {
    expect(registry.tokensOf('interactive-slider')).toEqual(
      expect.arrayContaining(['滑块', '拖动', '互动']),
    );
  });

  it('真实数据满足契约约束：produces 都是 IR 节点、互斥是对称的、依赖存在', () => {
    expect(validateManifests(SKILL_MANIFESTS)).toEqual([]);

    for (const manifest of SKILL_MANIFESTS) {
      for (const kind of manifest.produces) {
        expect(IR_CONTENT_KINDS).toContain(kind);
      }
      for (const other of manifest.conflictsWith) {
        expect(registry.get(other)?.conflictsWith).toContain(manifest.id);
      }
      for (const required of manifest.requires) {
        expect(registry.get(required)).toBeDefined();
      }
    }
  });

  it('getSkillRegistry 惰性创建并缓存同一个实例', () => {
    expect(getSkillRegistry()).toBe(getSkillRegistry());
  });
});

describe('拒绝坏数据', () => {
  function clone(overrides: Partial<SkillManifest>): SkillManifest[] {
    return SKILL_MANIFESTS.map((manifest) =>
      manifest.id === 'function-plot' ? ({ ...manifest, ...overrides } as SkillManifest) : manifest,
    );
  }

  it('重复 id：抛错并指出重复的位置', () => {
    const broken = [...SKILL_MANIFESTS, SKILL_MANIFESTS[0] as SkillManifest];
    expect(() => createSkillRegistry(broken)).toThrow(SkillRegistryError);

    try {
      createSkillRegistry(broken);
    } catch (error) {
      const violations = (error as SkillRegistryError).violations;
      expect(violations.some((violation) => violation.rule === 'duplicate-id')).toBe(true);
    }
  });

  it('互斥不对称：抛错并指明是哪一对', () => {
    const broken = clone({ conflictsWith: ['exercise-choice'] });
    // function-plot 声明与 exercise-choice 互斥，但对方没有回指
    try {
      createSkillRegistry(broken);
      throw new Error('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillRegistryError);
      const violations = (error as SkillRegistryError).violations;
      const hit = violations.find((violation) => violation.rule === 'asymmetric-conflict');
      expect(hit?.message).toContain('function-plot');
      expect(hit?.message).toContain('exercise-choice');
    }
  });

  it('namespace 撞车：抛错', () => {
    const broken = clone({ namespace: 'interactive-slider' });
    expect(() => createSkillRegistry(broken)).toThrow(SkillRegistryError);
  });

  it('priority 非法：抛错', () => {
    const broken = clone({ priority: 200 });
    expect(() => createSkillRegistry(broken)).toThrow(SkillRegistryError);
  });
});
