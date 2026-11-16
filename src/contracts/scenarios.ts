/**
 * 四个示例场景的输入文案 —— 唯一事实源。
 *
 * 这里只放「老师会说什么」，不放「系统应该返回什么」：
 * 期望结果在 tests/fixtures/scenarios.ts，那是测试的基准，不该被 UI 引用。
 *
 * 放在 contracts 下而不是 web 下，是因为这些句子同时也是验收用的输入，
 * 测试与界面各写一份迟早会漂移。
 */

export const SCENARIO_IDS = ['S1', 'S2', 'S3', 'S4'] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface ScenarioCase {
  readonly id: ScenarioId;
  /** 界面上按钮的短标签 */
  readonly label: string;
  /** 老师的原话（也是测试的输入） */
  readonly utterance: string;
  /** 一句话说明这个场景的意图 */
  readonly expectation: string;
}

export const SCENARIOS: readonly ScenarioCase[] = [
  {
    id: 'S1',
    label: '单 Skill',
    utterance: '画一下 y=2x+1 的图像',
    expectation: '只用一个 Skill：画图',
  },
  {
    id: 'S2',
    label: '组合 Skill',
    utterance: '能拖动滑块的一次函数演示',
    expectation: '两个 Skill 搭配：画图 + 滑块联动',
  },
  {
    id: 'S3',
    label: '冲突',
    utterance: '出一道一次函数练习题，让学生选答案或填答案',
    expectation: '两个 Skill 抢同一题位，平局降级为澄清',
  },
  {
    id: 'S4',
    label: '无匹配',
    utterance: '帮我准备明天的班会',
    expectation: '都不合适，不生成，给出澄清问题',
  },
];

export function findScenario(id: ScenarioId): ScenarioCase {
  const found = SCENARIOS.find((item) => item.id === id);
  if (!found) throw new Error(`未定义的场景：${id}`);
  return found;
}
