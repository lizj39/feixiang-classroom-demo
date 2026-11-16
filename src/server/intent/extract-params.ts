/**
 * 从一句话里读出数值参数（规则版）。
 *
 * 为什么参数抽取属于「理解层」而不是 Composer：读的是人话，输出的是结构化值。
 * 规则版能覆盖 `y = 2x + 1` 这类规范写法；P8 的 LLM 版会填同一个字段，
 * 覆盖「画一条过 (0,2)、斜率是负一的直线」这种只有模型才读得出来的表达。
 *
 * 两条诚实性约束：
 *  1. 抽不到就返回空对象，由 Composer 用 manifest 默认值并**在界面上标注**，
 *     绝不假装听懂了；
 *  2. 抽到但离谱的值（|v| > 100）放进 `rejected` 并写进 trace，而不是静默丢弃。
 */

import { normalizeForMatching } from './normalize';

/** 允许的参数绝对值上限。超过它多半是识别错误（例如把年份当成斜率）。 */
export const MAX_PARAM_ABS = 100;

export interface RejectedParam {
  readonly name: string;
  readonly raw: string;
  readonly reason: string;
}

export interface ParamExtraction {
  readonly values: Readonly<Record<string, number>>;
  readonly rejected: readonly RejectedParam[];
}

/** `y = kx + b`，允许空格、正负号与省略（`y=x`、`y=-x`）。 */
const EQUATION = /y\s*=\s*([+-]?(?:\d+(?:\.\d+)?)?)\s*x(?:\s*([+-])\s*(\d+(?:\.\d+)?))?/;

const SLOPE = /斜率\s*(?:是|为|等于|改成|改为|换成|变成|=|:|：)?\s*([+-]?\d+(?:\.\d+)?)/;

const INTERCEPT = /截距\s*(?:是|为|等于|改成|改为|换成|变成|=|:|：)?\s*([+-]?\d+(?:\.\d+)?)/;

function parseCoefficient(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/\s+/g, '');
  if (cleaned === '' || cleaned === '+') return 1;
  if (cleaned === '-') return -1;

  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function extractParams(utterance: string): ParamExtraction {
  const text = normalizeForMatching(utterance);
  const values: Record<string, number> = {};
  const rejected: RejectedParam[] = [];

  const record = (name: string, raw: string, value: number | null): void => {
    if (value === null) return;
    if (!Number.isFinite(value)) {
      rejected.push({ name, raw, reason: '不是有限数' });
      return;
    }
    if (Math.abs(value) > MAX_PARAM_ABS) {
      rejected.push({ name, raw, reason: `绝对值超过 ${MAX_PARAM_ABS}` });
      return;
    }
    values[name] = value;
  };

  const equation = EQUATION.exec(text);
  if (equation) {
    const slopeRaw = equation[1] ?? '';
    const slope = parseCoefficient(slopeRaw);
    const hasIntercept = equation[2] !== undefined && equation[3] !== undefined;
    const interceptRaw = hasIntercept ? `${equation[2] ?? ''}${equation[3] ?? ''}` : '0';
    const intercept = hasIntercept ? parseCoefficient(interceptRaw) : 0;

    const unusable: RejectedParam[] = [];
    if (slope === null || Math.abs(slope) > MAX_PARAM_ABS) {
      unusable.push({ name: 'k', raw: slopeRaw, reason: `不是合理解析出的斜率（上限 ±${MAX_PARAM_ABS}）` });
    }
    if (intercept === null || Math.abs(intercept) > MAX_PARAM_ABS) {
      unusable.push({ name: 'b', raw: interceptRaw, reason: `不是合理解析出的截距（上限 ±${MAX_PARAM_ABS}）` });
    }

    if (unusable.length > 0) {
      // 整条公式作废。只接受一半会画出「斜率是默认值、截距是读到的」这种半懂不懂的图，
      // 比直接说「没读懂」更糟。
      rejected.push(...unusable);
    } else if (slope !== null && intercept !== null) {
      values.k = slope;
      // 没有写 +b 时截距就是 0（`y = 3x` 是过原点的直线）。
      // 必须显式给出，否则会落到 manifest 的默认 b=1 上，画出一条错的线。
      values.b = intercept;
    }
  }

  // 明确说出「斜率 / 截距」时以它为准（比公式更口语、也更不容易误读）
  const slope = SLOPE.exec(text);
  if (slope?.[1]) record('k', slope[1], parseCoefficient(slope[1]));

  const intercept = INTERCEPT.exec(text);
  if (intercept?.[1]) record('b', intercept[1], parseCoefficient(intercept[1]));

  return { values, rejected };
}
