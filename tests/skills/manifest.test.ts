/**
 * Manifest 校验器的验收。
 *
 * 每条用例都断言「错误落在哪个字段上」（path）和「属于哪条规则」（rule），
 * 而不是只断言「报错了」—— 只说「不合法」的校验器，用起来和没有一样。
 */

import { describe, expect, it } from 'vitest';

import { SKILL_MANIFESTS } from '../../src/server/skills/manifests';
import { validateManifest, validateManifests, type Violation } from '../../src/server/skills/validate';

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'function-plot',
    displayName: '函数图像',
    summary: '画图',
    slot: 'visual',
    priority: 50,
    namespace: 'function-plot',
    triggers: { primary: ['图像'], synonyms: ['画'], intents: ['演示'] },
    produces: ['plot'],
    requires: [],
    conflictsWith: [],
    params: [{ name: 'k', type: 'number', default: 2, min: -5, max: 5, description: '斜率' }],
    ...overrides,
  };
}

function rulesOf(violations: readonly Violation[]): string[] {
  return violations.map((violation) => violation.rule);
}

function pathsOf(violations: readonly Violation[]): string[] {
  return violations.map((violation) => violation.path);
}

describe('单个 manifest', () => {
  it('合法 manifest 没有任何违规', () => {
    expect(validateManifest(validManifest())).toEqual([]);
  });

  it('非对象直接拒绝', () => {
    expect(rulesOf(validateManifest('not a manifest'))).toEqual(['object']);
  });

  it('缺 id 时错误路径指向 .id', () => {
    const violations = validateManifest(validManifest({ id: undefined }));
    expect(pathsOf(violations)).toContain('manifest.id');
    expect(rulesOf(violations)).toContain('required');
  });

  it('id 不在封闭集合里 → enum', () => {
    const violations = validateManifest(validManifest({ id: 'interactive-slidr' }));
    expect(violations.some((v) => v.rule === 'enum' && v.path.endsWith('.id'))).toBe(true);
  });

  it('priority 越界 → range', () => {
    const violations = validateManifest(validManifest({ priority: 150 }));
    expect(violations.some((v) => v.rule === 'range' && v.path === 'manifest.priority')).toBe(true);
  });

  it('priority 不是整数 → integer', () => {
    const violations = validateManifest(validManifest({ priority: 50.5 }));
    expect(violations.some((v) => v.rule === 'integer')).toBe(true);
  });

  it('produces 里出现 IR 之外的节点 → enum，且提示合法值', () => {
    const violations = validateManifest(validManifest({ produces: ['story'] }));
    const hit = violations.find((v) => v.path === 'manifest.produces[0]');
    expect(hit?.rule).toBe('enum');
    expect(hit?.message).toContain('plot');
  });

  it('conflictsWith 指向不存在的 Skill → enum', () => {
    const violations = validateManifest(validManifest({ conflictsWith: ['nope'] }));
    expect(violations.some((v) => v.path === 'manifest.conflictsWith[0]' && v.rule === 'enum')).toBe(true);
  });

  it('requires / conflictsWith 不能引用自己', () => {
    const violations = validateManifest(validManifest({ requires: ['function-plot'] }));
    expect(violations.some((v) => v.rule === 'self-reference')).toBe(true);
  });

  it('namespace 含大写或空格 → format', () => {
    expect(validateManifest(validManifest({ namespace: 'Function Plot' })).some((v) => v.rule === 'format')).toBe(true);
  });

  it('同一个触发词出现在两个列表里 → duplicate', () => {
    const violations = validateManifest(
      validManifest({ triggers: { primary: ['图像'], synonyms: ['图像'], intents: [] } }),
    );
    expect(violations.some((v) => v.rule === 'duplicate')).toBe(true);
  });

  it('primary 为空 → required（没有强信号的 Skill 永远不会被选中）', () => {
    const violations = validateManifest(validManifest({ triggers: { primary: [], synonyms: [], intents: [] } }));
    expect(violations.some((v) => v.path === 'manifest.triggers.primary' && v.rule === 'required')).toBe(true);
  });

  it('参数重名 → duplicate', () => {
    const violations = validateManifest(
      validManifest({
        params: [
          { name: 'k', type: 'number', default: 1, description: 'a' },
          { name: 'k', type: 'number', default: 2, description: 'b' },
        ],
      }),
    );
    expect(violations.some((v) => v.rule === 'duplicate' && v.path === 'manifest.params[1].name')).toBe(true);
  });

  it('number 参数的默认值越界 → range', () => {
    const violations = validateManifest(
      validManifest({ params: [{ name: 'k', type: 'number', default: 99, min: -5, max: 5, description: 'a' }] }),
    );
    expect(violations.some((v) => v.rule === 'range' && v.path === 'manifest.params[0].default')).toBe(true);
  });

  it('错误聚合：一次报出全部问题，不是遇到第一个就停', () => {
    const violations = validateManifest(
      validManifest({ id: 'bogus', priority: 999, produces: ['story'], namespace: 'Bad Name' }),
    );
    // id / priority / produces / namespace 四类问题应同时出现
    expect(violations.length).toBeGreaterThanOrEqual(4);
    const joined = pathsOf(violations).join(' ');
    expect(joined).toContain('.id');
    expect(joined).toContain('.priority');
    expect(joined).toContain('.produces[0]');
    expect(joined).toContain('.namespace');
  });
});

describe('整组 manifest', () => {
  it('四个真实 manifest 通过整组校验', () => {
    expect(validateManifests(SKILL_MANIFESTS)).toEqual([]);
  });

  it('重复 id → duplicate-id', () => {
    const a = validManifest();
    const b = validManifest({ namespace: 'other' });
    const violations = validateManifests([a, b]);
    expect(violations.some((v) => v.rule === 'duplicate-id')).toBe(true);
  });

  it('conflictsWith 不对称 → asymmetric-conflict，并指出是哪一对', () => {
    const choice = validManifest({
      id: 'exercise-choice',
      namespace: 'exercise-choice',
      slot: 'exercise',
      produces: ['exercise'],
      conflictsWith: ['exercise-input'],
    });
    const input = validManifest({
      id: 'exercise-input',
      namespace: 'exercise-input',
      slot: 'exercise',
      produces: ['exercise'],
      conflictsWith: [],
    });

    const violations = validateManifests([choice, input]).filter((v) => v.rule === 'asymmetric-conflict');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('exercise-choice');
    expect(violations[0]?.message).toContain('exercise-input');
  });

  it('namespace 撞车 → duplicate-namespace（否则合并时节点互相覆盖）', () => {
    const a = validManifest();
    const b = validManifest({ id: 'interactive-slider', namespace: 'function-plot' });
    const violations = validateManifests([a, b]);
    expect(violations.some((v) => v.rule === 'duplicate-namespace')).toBe(true);
  });

  it('requires 指向不在本次注册集合里的 Skill → unknown-requires', () => {
    const slider = validManifest({
      id: 'interactive-slider',
      namespace: 'interactive-slider',
      slot: 'interaction',
      produces: ['slider'],
      requires: ['function-plot'],
    });
    const violations = validateManifests([slider]);
    expect(violations.some((v) => v.rule === 'unknown-requires')).toBe(true);
  });

  it('requires 成环 → requires-cycle，并给出环路', () => {
    const a = validManifest({ id: 'function-plot', namespace: 'a', requires: ['interactive-slider'] });
    const b = validManifest({
      id: 'interactive-slider',
      namespace: 'b',
      slot: 'interaction',
      produces: ['slider'],
      requires: ['function-plot'],
    });

    const violations = validateManifests([a, b]).filter((v) => v.rule === 'requires-cycle');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('→');
  });
});
