/**
 * 输入归一化。只做三件事，且必须保证幂等（再次归一化结果不变）：
 *   1. 全角转半角（老师可能在中文输入法下打出全角字母，如 `ｙ＝２ｘ`）
 *   2. 转小写（`Y=2X` 与 `y=2x` 应命中同一个词）
 *   3. 折叠连续空白并去掉首尾空白
 *
 * 不做的事：去标点、纠错、同义替换 —— 那些属于「理解」，交给 IntentParser 的实现
 * （规则版用词表，LLM 版用模型）。归一化只保证「同一句话的不同写法不会因为全角/大小写而漏匹配」。
 */

export function normalizeForMatching(input: string): string {
  return toHalfWidth(input).toLowerCase().replace(/\s+/g, ' ').trim();
}

function toHalfWidth(input: string): string {
  let output = '';

  for (const char of input) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    // 全角空格
    if (code === 0x3000) {
      output += ' ';
      continue;
    }
    // 全角 ASCII（！ 到 ～）
    if (code >= 0xff01 && code <= 0xff5e) {
      output += String.fromCodePoint(code - 0xfee0);
      continue;
    }
    output += char;
  }

  return output;
}
