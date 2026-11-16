# 飞象老师 · 一句话生成课堂互动课件

> 全栈实习生作业 Demo
> **状态：骨架已跑通（阶段 1 / 8），业务实现进行中**

老师输入一句话需求，系统选择合适的教学 Skill（单个或组合），生成**可操作的课件**，并对「为什么这么选」和「生成得对不对」给出**可核对的证据**。

## 三个硬要求

| 要求 | 怎么做到 |
|---|---|
| 选择可解释 | 每个候选 Skill 都有得分明细与命中词；拒绝生成时也说清原因 |
| 结果可验证 | 验到 IR / DOM / 行为三层，不看调用日志 |
| 故障可定位 | 分层 trace，能指出「日志停在哪一层」 |

## 快速开始

```bash
npm ci
npm run dev        # http://localhost:5173 —— 页面与 /api 同源同端口
```

验证 API：

```bash
curl http://localhost:5173/api/health
```

其它命令：

| 命令 | 作用 |
|---|---|
| `npm run verify` | `tsc --noEmit && vitest run`，当前 **41 个测试** |
| `npm run build` | 构建前端到 `dist/web` |
| `npm start` | 以生产模式托管 `dist/web`（需先 build） |

## 进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 规格 + 五个契约 + 场景 fixtures | ✅ |
| 1 | 单进程骨架（Vite + React + Node API） | ✅ |
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
src/server/      薄后端：api（/api/health）、app（装配）、main（入口）
src/web/         React 前端，Vite 构建到 dist/web
tests/           契约测试、服务端集成测试、场景 fixtures
docs/            SPEC / CONTRACTS / 任务拆分 / 需求原文
```

依赖方向单向：`web / server → contracts`，`contracts → 无需任何依赖`。

开发模式下 Vite 以 middlewareMode 挂在 Express 后面，所以**一个端口同时给出页面和 API**，
不需要 proxy 配置，也没有跨域问题。

## 文档

- [SPEC.md](docs/SPEC.md) —— 输入输出、计分与阈值、冲突裁决、四层验证的规则命名
- [CONTRACTS.md](docs/CONTRACTS.md) —— 五个契约的字段约束与正反例
- [任务拆分.md](docs/任务拆分.md) —— 30 个小任务、各自的验收判据与客观性分级
- [需求原文.md](docs/需求原文.md)

## 环境

Node >= 20.19，默认离线可运行，**不需要任何 API Key**。
