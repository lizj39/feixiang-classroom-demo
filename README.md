# 飞象老师 · 一句话生成课堂互动课件

> 全栈实习生作业 Demo
> **状态：Skill 声明层已就绪（阶段 2 / 8 完成），打分路由是下一步**

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
| `npm run verify` | `tsc --noEmit && vitest run`，当前 **99 个测试** |
| `npm run build` | 构建前端到 `dist/web` |
| `npm start` | 以生产模式托管 `dist/web`（需先 build） |

## 进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 规格 + 五个契约 + 场景 fixtures | ✅ |
| 1 | 单进程骨架 + 三栏界面 + `/api/generate` 信封 | ✅ |
| 2 | Skill 注册表（4 个 manifest + 校验 + `/api/skills`） | ✅ |
| 3 | 需求解析与打分路由 | ⬜ |
| 4 | 课件 IR + 渲染器（可拖动滑块） | ⬜ |
| 5 | 组合编排与参数绑定 | ⬜ |
| 6 | 四层验证 + trace 证据面板 | ⬜ |
| 7 | 故障版本开关 + 定位 + 修复 | ⬜ |
| 8 | README 全量、演示脚本、交付检查 | ⬜ |

## 目录

```
src/contracts/   契约：skill / ir / plan / trace / verification + api 信封 + 场景文案
src/server/      薄后端：api（路由）、app（装配）、main（入口）、skills（manifest / 校验 / 注册表）
src/web/         React 前端：App（状态机）、panels（三栏）、api（唯一网络出口）
tests/           契约测试、服务端 HTTP 测试、组件测试、场景 fixtures
docs/            SPEC / CONTRACTS / 任务拆分 / 需求原文
```

依赖方向单向：`web / server → contracts`，`contracts → 无需任何依赖`。

开发模式下 Vite 以 middlewareMode 挂在 Express 后面，所以**一个端口同时给出页面和 API**，
不需要 proxy 配置，也没有跨域问题。

## 现在打开页面能看到什么

三栏：左侧输入与四个演示场景、中间课件预览、右侧证据面板。

这一步只做到「请求能发出去、响应能回来」：点「生成课件」后，中间显示服务端回执
（requestId + 归一化后的需求），`plan` / `courseware` / `trace` / `verification` 仍是 `null`。
课件本身要等阶段 3（路由）与阶段 4（渲染器）接上。

> 有一条测试专门守着这四个字段必须为 `null`（`tests/server/generate.test.ts`），
> 防止提前塞写死的演示数据。

## 文档

- [SPEC.md](docs/SPEC.md) —— 输入输出、计分与阈值、冲突裁决、四层验证的规则命名
- [CONTRACTS.md](docs/CONTRACTS.md) —— 五个契约的字段约束与正反例
- [任务拆分.md](docs/任务拆分.md) —— 30 个小任务、各自的验收判据与客观性分级
- [需求原文.md](docs/需求原文.md)

## 环境

Node >= 20.19，默认离线可运行，**不需要任何 API Key**。
