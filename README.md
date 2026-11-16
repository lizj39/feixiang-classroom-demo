# 飞象老师 · 一句话生成课堂互动课件

> 全栈实习生作业 Demo
> **状态：规格与契约已完成（阶段 0 / 8），业务实现进行中**

老师输入一句话需求，系统选择合适的教学 Skill（单个或组合），生成**可操作的课件**，并对「为什么这么选」和「生成得对不对」给出**可核对的证据**。

## 三个硬要求

| 要求 | 怎么做到 |
|---|---|
| 选择可解释 | 每个候选 Skill 都有得分明细与命中词；拒绝生成时也说清原因 |
| 结果可验证 | 验到 IR / DOM / 行为三层，不看调用日志 |
| 故障可定位 | 分层 trace，能指出「日志停在哪一层」 |

## 当前可运行的验证

```bash
npm ci
npm run verify     # tsc --noEmit && vitest run
```

阶段 0 只包含契约与 fixtures，当前 **29 个契约测试**通过。
`npm run dev` / `npm run build` 随阶段 1（单进程骨架）接入。

## 进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 规格 + 五个契约 + 场景 fixtures | ✅ |
| 1 | 单进程骨架（Vite + React + Node API） | ⬜ |
| 2 | Skill 注册表（4 个 manifest） | ⬜ |
| 3 | 需求解析与打分路由 | ⬜ |
| 4 | 课件 IR + 渲染器（可拖动滑块） | ⬜ |
| 5 | 组合编排与参数绑定 | ⬜ |
| 6 | 四层验证 + trace 证据面板 | ⬜ |
| 7 | 故障版本开关 + 定位 + 修复 | ⬜ |
| 8 | README 全量、演示脚本、交付检查 | ⬜ |

## 目录

```
src/contracts/   五个契约（类型 + 常量 + 纯函数），不依赖任何实现
src/server/      薄后端：registry / router / composer / validator / api（阶段 1 起）
src/web/         前端：证据面板 + 渲染器注册表 + 客户端 L3/L4 校验（阶段 1 起）
tests/           契约测试、场景 fixtures、后续各层单测
docs/            SPEC / CONTRACTS / 任务拆分 / 需求原文
```

依赖方向单向：`web / server → contracts`，`contracts → 无需任何依赖`。

## 文档

- [SPEC.md](docs/SPEC.md) —— 输入输出、计分与阈值、冲突裁决、四层验证的规则命名
- [CONTRACTS.md](docs/CONTRACTS.md) —— 五个契约的字段约束与正反例
- [任务拆分.md](docs/任务拆分.md) —— 30 个小任务、各自的验收判据与客观性分级
- [需求原文.md](docs/需求原文.md)

## 环境

Node >= 20.19，默认离线可运行，**不需要任何 API Key**。
