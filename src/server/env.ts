/**
 * 极简 .env 读取。
 *
 * 为什么自己写而不是引入 dotenv：只需要「KEY=VALUE 且不覆盖已有环境变量」这一条规则，
 * 20 行足够；多一个依赖就要多解释一次它做了什么。
 *
 * 安全约定：只写进 process.env，不打印、不落盘、不返回给调用方。
 */

import { existsSync, readFileSync } from 'node:fs';

export function loadDotEnv(file = '.env'): string[] {
  if (!existsSync(file)) return [];

  const loaded: string[] = [];

  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // 已有环境变量优先：命令行显式设置的值不该被文件覆盖
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }

  return loaded;
}
