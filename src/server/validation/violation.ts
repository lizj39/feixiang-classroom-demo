/**
 * 校验结果的通用形状。
 *
 * 校验器（manifest / IR）共用同一个结构，是为了让界面与测试都能用同一套方式展示：
 *   path  —— 出错的位置（可以直接定位到代码或数据的具体位置）
 *   rule  —— 稳定的规则名（测试按它断言，不依赖文案）
 *   message —— 人话
 */

export interface Violation {
  readonly path: string;
  readonly rule: string;
  readonly message: string;
}
