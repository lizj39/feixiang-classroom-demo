#!/usr/bin/env node
/**
 * 交付前的清洁检查。
 *
 * 只做静态扫描（不跑 git、不联网），因为最脏的东西通常是「本机路径」和「key」
 * 这类一眼能扫出来的东西。命令验证放在 README 里作为单独一步。
 *
 *   npm run check:clean
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.npm-cache', 'coverage', '.vscode', '.idea']);
/** .env 是本地文件，本来就该存在，不算违规；它是否被 gitignore 由下面的规则单独检查。 */
const SKIP_FILES = new Set(['.env', 'package-lock.json']);

const TEXT_FILE = /\.(ts|tsx|js|mjs|json|md|css|html|yml|yaml|txt|example)$|^\.(gitignore|gitattributes|env\.example)$/;

const RULES = [
  { id: 'api-key', message: '疑似真实 API key（sk-…）', pattern: /sk-[A-Za-z0-9]{20,}/ },
  { id: 'github-token', message: '疑似 GitHub token', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { id: 'private-key', message: '私钥内容', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'local-path-home', message: '本机绝对路径（C:\\Users\\…）', pattern: /C:[\\/]Users[\\/]/i },
  { id: 'local-path-project', message: '本机绝对路径（D:\\Projects\\…）', pattern: /D:[\\/]Projects/i },
];

const violations = [];
let scanned = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;

    const path = join(dir, entry.name);
    if (!TEXT_FILE.test(entry.name) && !TEXT_FILE.test(`.${entry.name}`)) continue;
    if (statSync(path).size > 512 * 1024) continue;

    scanned += 1;
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const rule of RULES) {
        if (rule.pattern.test(line)) {
          violations.push({
            file: relative(ROOT, path),
            line: index + 1,
            rule: rule.id,
            message: rule.message,
            sample: line.trim().slice(0, 120),
          });
        }
      }
    });
  }
}

function checkGitignore() {
  let text = '';
  try {
    text = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  } catch {
    violations.push({ file: '.gitignore', line: 0, rule: 'missing', message: '缺少 .gitignore', sample: '' });
    return;
  }

  for (const must of ['node_modules', '.env', 'dist']) {
    if (!text.split(/\r?\n/).some((line) => line.trim() === must || line.trim() === `${must}/`)) {
      violations.push({
        file: '.gitignore',
        line: 0,
        rule: 'gitignore',
        message: `.gitignore 应包含 ${must}`,
        sample: '',
      });
    }
  }

  if (!text.includes('!.env.example')) {
    violations.push({
      file: '.gitignore',
      line: 0,
      rule: 'gitignore',
      message: '应保留 !.env.example，否则样例文件会被 .env.* 规则一并忽略',
      sample: '',
    });
  }
}

walk(ROOT);
checkGitignore();

console.log(`扫描了 ${scanned} 个文本文件`);

if (violations.length === 0) {
  console.log('✓ 未发现真实密钥、本机绝对路径或 gitignore 遗漏');
} else {
  console.log(`✗ 发现 ${violations.length} 处问题：`);
  for (const item of violations) {
    const where = item.line > 0 ? `${item.file}:${item.line}` : item.file;
    console.log(`  - [${item.rule}] ${where} ${item.message}`);
    if (item.sample) console.log(`      ${item.sample}`);
  }
  process.exitCode = 1;
}
