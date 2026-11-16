# SPEC

> 版本：0.1（阶段 0 产出）
> 对应契约版本：`CONTRACT_VERSION = 0.3.0`
> 状态：**规格已定稿，实现未开始**。本文件之后只允许通过「变更记录」修改。

---

## 1. 一句话

老师输入一句话，系统**选出合适的教学 Skill（单个或组合）**，生成**可操作的课件**，并且对「为什么这么选」和「生成得对不对」都给出**可核对的证据**。

三个硬要求，缺一不可：

| 要求 | 体现在哪 |
|---|---|
| 选择可解释 | 每个候选 Skill 都有得分明细与命中词，拒绝时也要说清原因 |
| 结果可验证 | 验证到 IR、DOM、行为三层，不看日志 |
| 故障可定位 | 分层 trace，能指到「日志停在哪一层」 |

---

## 2. 范围

**做**

- 单页 Web 应用 + 一层薄 Node API（`POST /api/generate`）
- 4 个 Skill：`function-plot`、`interactive-slider`、`exercise-choice`、`exercise-input`
- 4 条路由分支：单 Skill / 组合 / 冲突降级 / 无匹配
- 4 层验证 + 分层 trace + 证据面板
- 2 个可复现故障版本（用于演示定位与修复）

**不做（Non-goals，README 会原样列出）**

账号体系、数据库、LMS 对接、课件保存与分享、富文本编辑器、真实 LLM 决策、移动端适配、像素级视觉打磨、跨浏览器兼容。

---

## 3. 用户流程

```
输入一句话
  → [Router]    打分 → 选人 → 判定 single / combo / conflict / no_match
  → [Composer]  拓扑排序 → 名字冲突改名 → 合并成单页 IR → 建立跨 Skill 绑定
  → [Renderer]  IR → DOM（plot 用 SVG，slider 是原生 input[type=range]）
  → [Validator] L1 路由 / L2 IR / L3 DOM / L4 行为
  → 证据面板：选择理由 + IR 树 + trace 时间线 + 验证报告
```

不生成（`no_match` 或冲突平局）时，只输出决策与澄清问题，**不产出 IR**。

---

## 4. API

### `GET /api/health`

骨架自检接口，同时证明「页面与 API 同源」。返回 `{ ok, service, contractVersion, uptimeSec, now }`，
其中 `contractVersion` 取自 `src/contracts`，不硬编码。

### `GET /api/skills`

返回已注册的 Skill 声明（manifest 原样，不含运行时实例）。用于界面展示「系统认识哪些能力」。

```jsonc
{ "apiVersion": 1, "count": 4, "skills": [ /* SkillManifest[] */ ] }
```

manifest 在服务端注册，前端只负责渲染 —— 新增一个 Skill 不需要改前端任何代码。
注册表在创建时做整组校验（id 唯一、互斥对称、requires 无环、namespace 不撞），
校验失败会以 500 信封返回，而不是带着坏声明继续跑。

### `POST /api/generate`

请求

```jsonc
{ "utterance": "能拖动滑块的一次函数演示" }
```

| 字段 | 约束 |
|---|---|
| `utterance` | 必填，折叠空白后长度 1–200，超界返回 400 |
| `flags.bug` | 仅调试用，`drop-node` / `unregistered-renderer`，默认缺省（阶段 7 接入） |

响应 200

```jsonc
{
  "apiVersion": 1,
  "requestId": "req_<uuid>",
  "receivedAt": "ISO 时间",
  "utterance": "归一化后的需求回声",
  "plan": { /* Plan 契约，见 CONTRACTS.md */ },
  "courseware": { /* Courseware，或 null（不生成时） */ },
  "trace": { /* 服务端写入的分层事件 */ },
  "verification": { /* 只含 L1/L2，L3/L4 标记 skipped */ }
}
```

- `courseware` 为 `null` 当且仅当 `shouldGenerate(plan) === false`
- L3/L4 只能由浏览器验证（DOM 与行为），前端完成后再与 L1/L2 合并成最终报告
- **阶段 1 的临时约定**：`plan` / `courseware` / `trace` / `verification` 一律为 `null`，
  由 `tests/server/generate.test.ts` 守着。P3 起逐个填充，信封结构不变

错误码（封闭集合，前端按 `code` 分支而不是匹配文案）

| code | HTTP | 触发条件 |
|---|---|---|
| `EMPTY_UTTERANCE` | 400 | 字段缺失，或折叠空白后为空 |
| `TOO_LONG` | 400 / 413 | 超过 200 字符，或请求体超过 32kb |
| `INVALID_BODY` | 400 | `utterance` 不是字符串，或请求体不是合法 JSON |
| `NOT_FOUND` | 404 | 未知接口 |
| `INTERNAL` | 500 | 未预期的服务端错误 |

```jsonc
{ "error": { "code": "EMPTY_UTTERANCE", "message": "请先输入需求", "field": "utterance" } }
```

> 「字段缺失」与「空字符串」都归为 `EMPTY_UTTERANCE`：对老师来说是同一件事（没说要什么），
> 分开报错只会让前端多写一个无意义的分支。

---

## 5. 路由规格

### 5.1 理解层

一句话先经过 `IntentParser` 归一化并解析成意图证据：

- 归一化：全角转半角、转小写、折叠空白，必须幂等
- 规则版解析器：用注册表里的词表做包含匹配，按**原文出现顺序**输出命中词
- 解析器**不打分**：同一个词在不同 Skill 里可能是 primary 或 synonym，
  分值必须由打分器按各自 manifest 重新判断

P8 接入 LLM 时只替换解析器实现：额外产出 `capabilities`（能力标签）与 `normalized`
（标准化复述），打分 / 阈值 / 冲突裁决一律不变。能力标签按 **60 分**计 —— 恰好等于
入选阈值，能单独成立；50 分会低于阈值，导致「接了 LLM 反而更难选中」。
LLM 失败时降级回规则版，并在 `degraded.reason` 里留下痕迹。

**参数抽取**（同一层，规则版已实现）：从需求里读出数值参数，产出 `ParsedIntent.params`。

| 能读到的写法 | 例子 |
|---|---|
| 公式 | `y=2x+1`、`y = 2x + 1`、`y=-x`（k=-1）、`y=3x`（b=0）、`y=0.5x-1.5`、全角 `Ｙ＝３Ｘ＋２` |
| 口语 | 「斜率为 -2」「截距是 5」「斜率改成 4」 |

三条约束：

1. 抽不到就留空，由 Composer 用 manifest 默认值并**在课件里标注**「使用默认值（未从需求中识别）」
2. 超出 ±100 的值让**整条公式作废**并写进 trace（只接受一半会画出半懂不懂的图）
3. 没有 `+b` 时截距就是 0，不能落到默认的 `b=1` 上 —— 那会画出一条错的线

### 5.2 计分（整数百分制）

1. 归一化：去首尾空格、全角转半角、转小写
2. 逐 token 做「包含」匹配：命中 `primary` +50，命中 `synonym` +20，命中 `intent` +10
3. **遮蔽规则**：若命中的 token 是另一条已命中 token 的子串（如 `选` ⊂ `选答案`），该 token 不加分，记入 `shadowed`（附带 `shadowedBy`，回答「为什么这个词没加分」）
4. 封顶 100，展示值 `score = points / 100`

> 为什么用整数累加：`0.5 + 0.1` 在 IEEE754 下等于 `0.6000000000000001`，会让「刚好达标」被判成不达标。`60 / 100` 精确等于 `0.6`，阈值判定才是确定的。

### 5.3 阈值与形态

- **单阈值 `0.60`**：`score >= 0.60` 入选，否则不入选。没有「弱匹配候选」档——将就出来的课件比不生成更糟。
- 入选 1 个 → `single`；入选 ≥2 且无冲突 → `combo`；入选 ≥2 且冲突 → `conflict`；入选 0 个 → `no_match`
- `conflict` 的 `resolution.kind === 'winner'` 时允许生成；`degrade-to-clarify` 时不生成

### 5.4 冲突

判定两路并行，命中即记录 `by`：

1. `explicit-conflictsWith`：manifest 里显式声明（必须对称）
2. `shared-slot`：两个 Skill 的 `slot` 相同（同一题位只能有一个占据者）

裁决：`priority` 高者胜；**相同 priority 一律降级为澄清**，不猜。

### 5.5 依赖

`requires` 声明前置 Skill。`interactive-slider` 依赖 `function-plot`（滑块必须有可绑定的图像）。依赖不满足时，Composer 负责补入并在 trace 里说明「依赖补入」，而不是静默产出坏 IR。

---

## 6. 验证规格

| 层 | 检查内容 | 失败意味着 |
|---|---|---|
| **L1 路由** | 选中集合 == `plan` 声称的集合；低于阈值的 Skill 不得出现在 `selected` | 选错了 Skill |
| **L2 编排 / IR** | 节点 id 唯一；`slider.bindTo` 能解析到真实 plot 且参数合法；初始值在区间内；`exercise.mode` 与 `choices` 自洽 | Skill 调用了但产物丢了/坏了 |
| **L3 渲染 / DOM** | 存在 `input[type=range]`；DOM 控件数量与 IR 节点数量一致 | IR 有但没画出来 |
| **L4 行为** | 拖动后参数变化，且曲线在约定采样点上与公式一致（误差 ≤1px） | 画出来了但没用 |

`ruleId` 命名固定为 `层.对象.断言`：

```
L1.route.selected-match        L1.route.threshold-respected
L2.ir.ids-unique               L2.ir.slider-present
L2.ir.binding-resolves         L2.ir.params-in-range
L2.ir.exercise-mode-coherent
L3.dom.range-present           L3.dom.controls-match-ir
L4.behavior.slider-updates-plot  L4.behavior.exercise-answerable
```

任何一层失败，下游层标记 `skipped`（不是 `pass`），`firstFailedLayer` 取**最外层**失败。

### 6.1 IR 出站校验（阶段 4 已实现）

Composer 产出 IR 后、返回前端前必须先过一遍校验（`src/server/ir/validate.ts`），
坏 IR 宁可 500，也不交给前端画出一个「看起来对」的东西：

| rule | 抓什么故障 |
|---|---|
| `ids-unique` | id 重复 → React key 冲突，后一个覆盖前一个 |
| `binding-resolves` | `bindTo.nodeId` 悬空 → 滑块能拖，拖的是空气 |
| `binding-param` | 绑了 `domain` 之类不可绑定的参数 |
| `params-in-range` / `range-order` / `range-step` | 滑块区间非法 |
| `initial-value-matches-plot` | 初始值与图像参数不一致 → 一进页面就对不上 |
| `plot-params-finite` / `plot-domain` | NaN/Infinity 或反向定义域 |
| `exercise-mode-coherent` / `exercise-answer` | 选择题没选项、填空题带选项、答案不在选项中 |

阶段 6 会把这些结果映射成 `L2.ir.*` 的 ruleId 并写进验证报告；本阶段的 rule 名是内部标识。

### 6.2 渲染约定

- 滑块必须是原生 `input[type=range]`：L3 验证用它作为稳定选择器，不依赖 class 名
- 图像用 SVG `<path>`，其 `d` 属性由当前参数**计算**得出，便于断言「变对了」而不只是「变了」
- x / y 使用同一比例尺（y 跨度由画布宽高比反推，纵向中心取 `b`），
  否则拖动 k 时直线角度会失真
- 渲染注册表是显式的 `Record<IrContentKind, 渲染器>`，缺项时渲染显式占位符而不是白屏

---

## 7. 场景

| 编号 | 输入 | 期望结果 |
|---|---|---|
| S1 | 画一下 y=2x+1 的图像 | `single` / function-plot 0.90 |
| S2 | 能拖动滑块的一次函数演示 | `combo` / slider 1.00 + plot 0.60，滑块绑定到 plot 的 `k` |
| S3 | 出一道一次函数练习题，让学生选答案或填答案 | `conflict` / 1.00 : 1.00 平局 → 降级澄清，不生成 |
| S4 | 帮我准备明天的班会 | `no_match` / 全 0 分 → 澄清，不生成 |
| F1a | S2 + `flags.bug=drop-node` | L1 pass、L2 fail（IR 缺 slider） |
| F1b | S2 + `flags.bug=unregistered-renderer` | L1 pass、L2 pass、L3 fail（DOM 无 range） |

精确期望值以 `tests/fixtures/scenarios.ts` 为准——**fixtures 是这批数字的唯一事实源**，本文只做说明，不重复维护。

---

## 8. 验收命令

```bash
npm ci          # 按 package-lock.json 安装
npm test        # 契约测试 + 单测 + 行为测试
npm run build   # 构建前端产物到 dist/web
npm run dev     # 本地启动（单端口，页面 + API）
npm start       # 生产模式托管 dist/web（需先 build）
```

环境：Node >= 20.19。默认离线可运行，**不需要任何 API Key**。

---

## 9. 目录结构

```
src/contracts/   五个契约（类型 + 常量 + 纯函数），实现方依赖它，它不依赖任何实现
src/server/      薄后端：skill registry / router / composer / validator / validator-merge / api
src/web/         前端：三栏面板 + 渲染器注册表 + 客户端 L3/L4 校验
tests/           契约测试、fixtures、后续各层单测
docs/            SPEC（本文件）、CONTRACTS、任务拆分
```

依赖方向单向：`web / server → contracts`，`contracts → nothing`。

---

## 10. 变更记录

| 版本 | 变更 |
|---|---|
| 0.1 | 定稿：4 Skill、单阈值 0.60、Plan 四形态、四层验证、L1–L4 ruleId 命名 |
| 0.2 | 补充传输层信封（`apiVersion` / `requestId` / `receivedAt` / 回声）、错误码表、阶段 1 的 null 约定 |
| 0.3 | 补充理解层（IntentParser / 归一化 / 能力标签 60 分 / 降级留痕） |
| 0.4 | 补充 IR 出站校验规则表与渲染约定（原生 range、path 由参数计算、等比视野、注册表缺项占位） |
| 0.5 | 补充参数抽取规则与来源标注（来自描述 / 默认值）、超限整条作废 |
