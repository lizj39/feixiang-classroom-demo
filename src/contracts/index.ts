/**
 * 契约统一出口。
 *
 * 五个契约：
 *  1. skill.ts        Skill Manifest（Skill 能干什么）
 *  2. ir.ts           课件 IR（Skill 之间、前后端之间的交换格式）
 *  3. plan.ts         路由决策（选谁、为什么、要不要生成）
 *  4. trace.ts        分层执行记录（故障定位的依据）
 *  5. verification.ts 四层验证结果（用对了没有）
 *
 * 契约版本独立于应用版本：契约一改就要动 fixtures，所以显式记录。
 */

export const CONTRACT_VERSION = '0.1.0' as const;

export * from './ir.js';
export * from './skill.js';
export * from './plan.js';
export * from './trace.js';
export * from './verification.js';
