/**
 * `.env` 读取的验收。
 *
 * 两条规则必须守住：
 *  1. 已存在的环境变量优先（命令行显式设的值不能被文件覆盖）；
 *  2. 只写进 process.env，不打印 —— 这条没法用断言直接证明，但可以证明
 *     返回值里只有键名，不含值。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadDotEnv } from '../../src/server/env';

const touched = new Set<string>();

function setEnv(key: string, value: string | undefined): void {
  touched.add(key);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.clear();
});

function withEnvFile(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'feixiang-env-'));
  const file = path.join(dir, '.env');
  writeFileSync(file, content, 'utf8');
  return file;
}

describe('loadDotEnv', () => {
  it('解析 KEY=VALUE、忽略注释与空行、支持引号', () => {
    const file = withEnvFile(['# 注释', '', 'LLM_MODEL=deepseek-flash', 'QUOTED="a b"', "SINGLE='c d'"].join('\n'));

    try {
      const loaded = loadDotEnv(file);

      expect(process.env.LLM_MODEL).toBe('deepseek-flash');
      expect(process.env.QUOTED).toBe('a b');
      expect(process.env.SINGLE).toBe('c d');
      // 返回值只有键名，不含任何值 —— 避免有人顺手把 key 打进日志
      expect(loaded).toContain('LLM_MODEL');
      expect(loaded.join(' ')).not.toContain('deepseek-flash');
    } finally {
      for (const key of ['LLM_MODEL', 'QUOTED', 'SINGLE']) delete process.env[key];
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it('已存在的环境变量不被文件覆盖', () => {
    const file = withEnvFile('LLM_API_KEY=from-file');
    setEnv('LLM_API_KEY', 'from-shell');

    try {
      loadDotEnv(file);
      expect(process.env.LLM_API_KEY).toBe('from-shell');
    } finally {
      rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it('文件不存在时静默跳过（不是错误）', () => {
    expect(loadDotEnv(path.join(tmpdir(), 'definitely-missing.env'))).toEqual([]);
  });
});
