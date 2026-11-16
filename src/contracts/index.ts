/**
 * 契约统一出口。
 *
 * 五个业务契约：
 *  1. skill.ts        Skill Manifest（Skill 能干什么）
 *  2. ir.ts           课件 IR（Skill 之间、前后端之间的交换格式）
 *  3. plan.ts         路由决策（选谁、为什么、要不要生成）
 *  4. trace.ts        分层执行记录（故障定位的依据）
 *  5. verification.ts 四层验证结果（用对了没有）
 *
 * 外加三个配套定义：
 *  - api.ts       传输层信封（把上面五个串起来），前后端共用
 *  - intent.ts    理解层契约（Parser 接口与 ParsedIntent），P8 换 LLM 只需换实现
 *  - scenarios.ts 四个演示场景的输入文案（测试与界面共用，避免两处漂移）
 *
 * 契约版本独立于应用版本：契约一改就要动 fixtures，所以显式记录。
 */

export const CONTRACT_VERSION = '0.2.0' as const;

export * from './ir';
export * from './skill';
export * from './plan';
export * from './trace';
export * from './verification';
export * from './api';
export * from './intent';
export * from './scenarios';
