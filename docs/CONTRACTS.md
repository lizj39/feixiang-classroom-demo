# CONTRACTS

> 契约版本 `0.2.0`。代码：`src/contracts/`。
> 规则：**实现依赖契约，契约不依赖实现**。任何一方绕开契约（例如在渲染器里 if 判断 SkillId）都算违规。

五个契约，各自回答一个问题：

| # | 文件 | 回答的问题 | 谁消费 |
|---|---|---|---|
| 1 | `skill.ts` | 一个 Skill 能干什么、和谁打架 | Router、Composer |
| 2 | `ir.ts` | Skill 之间、前后端之间交换什么 | Composer、Renderer、Validator |
| 3 | `plan.ts` | 选了谁、为什么、要不要生成 | Router、UI、Validator(L1) |
| 4 | `trace.ts` | 每一步发生在哪一层 | 全部层、证据面板 |
| 5 | `verification.ts` | 用对了没有、错在哪层 | Validator、证据面板 |

三个配套定义（不是业务契约，但同样被多方共用）：

| 文件 | 作用 |
|---|---|
| `api.ts` | 传输层信封 + 错误码，前后端共用 |
| `intent.ts` | 理解层：`IntentParser` 接口与 `ParsedIntent`，**P8 接 LLM 的唯一改动点** |
| `scenarios.ts` | 四个演示场景的输入文案，测试与界面共用 |

---

## 1. Skill Manifest

**目的**：把「一个 Skill 的行为」全部变成数据。代码里出现 `if (skillId === 'xxx')` 就是设计出问题的信号。

关键字段与约束：

| 字段 | 约束 | 由谁守门 |
|---|---|---|
| `id` | 必须属于封闭集合 `SKILL_IDS`（4 个） | 类型（字面量联合） |
| `produces` | 必须是 `IR_CONTENT_KINDS` 的子集 | 类型 + P2-2 单测 |
| `conflictsWith` | 必须**对称**：A 声明 B，则 B 必须声明 A | P2-2 单测 |
| `requires` | 不得自引用、不得成环 | P5-1 单测 |
| `slot` | 决定结构冲突（同槽位互斥） | P2-2 / P3-3 |
| `priority` | 0–100，冲突裁决用；相同即平局 | P3-3 单测 |
| `namespace` | 合并后节点 id 前缀，防止互相覆盖 | P5-2 单测 |

正例

```ts
{
  id: 'interactive-slider',
  slot: 'interaction',
  priority: 60,
  namespace: 'interactive-slider',
  produces: ['slider'],
  requires: ['function-plot'],
  conflictsWith: [],
  // ...
}
```

反例（编译期就挡掉）

```ts
produces: ['story']          // 'story' 不是 IR 节点
id: 'interactive-slidr'      // 拼错
```

---

## 2. 课件 IR

**目的**：Skill 只产节点、不产整页。合并、布局、命名空间全部由 Composer 统一负责——这样两个 Skill 才不会各画一整个页面。

节点类型封顶 5 种：`page / plot / slider / text / exercise`。**新增节点类型必须同时改 `IR_NODE_KINDS`**，渲染注册表的覆盖率断言依赖它。

三个真实约束（都由 L2 验证，不由类型保证）：

1. 节点 `id` 在 page 内唯一
2. `slider.bindTo.nodeId` 必须指向存在的 `plot`，`param` ∈ `{k, b}`
3. `slider.range.value` ∈ `[min, max]`

正例

```ts
{
  kind: 'slider',
  id: 'interactive-slider:slider-1',
  source: 'interactive-slider',
  label: '斜率 k',
  bindTo: { nodeId: 'function-plot:plot-1', param: 'k' },
  range: { min: -3, max: 3, step: 0.5, value: 2 },
}
```

反例

```ts
{ kind: 'slider', bindTo: { nodeId: 'plot-1', param: 'domain' } }  // domain 不可绑定
{ kind: 'plot' }                                                    // 缺 params
```

> `source` 字段不是装饰：证据面板要能回答「这个节点是谁放的」。少了它，`drop-node` 故障就查不出是 Composer 丢了还是 Renderer 没画。

---

## 3. 路由决策 Plan

**目的**：题面第 1 问的答案就是这个对象。它必须同时携带**结果**和**理由**，否则页面上的解释只能靠文案硬写。

四种形态刻意不合并：

| 形态 | 含义 | 是否生成 |
|---|---|---|
| `single` | 1 个 Skill 达标 | 是 |
| `combo` | ≥2 个达标且不冲突 | 是 |
| `conflict` | ≥2 个达标但冲突，带 `resolution` | 看裁决 |
| `no_match` | 0 个达标 | 否 |

**为什么 `conflict` 和 `no_match` 不合成一个 `clarify`**：那样会丢掉「多个都想要但打架」和「一个都不合适」的区别，而这恰好是面试要问的两种情况。是否生成由 `shouldGenerate(plan)` 判定，不由 `type` 推断。

`scores` 必须包含**全部 4 个 Skill**（含 0 分），否则「为什么没选它」无从回答。

正例

```ts
{ type: 'conflict', selected: ['exercise-choice', 'exercise-input'],
  resolution: { kind: 'degrade-to-clarify', competitors: [...], by: ['explicit-conflictsWith', 'shared-slot'], reason: '...' },
  questions: [ /* ≥2 条 */ ], scores: [ /* 4 条 */ ] }
```

反例

```ts
{ type: 'single', selected: ['function-plot', 'interactive-slider'] }  // 类型不允许
{ type: 'no_match', selected: ['function-plot'] }                      // 自相矛盾
```

### 3.1 计分证据 `Signal`

`ScoreBreakdown` 不存字符串数组，而是存带来源与分值的证据：

```ts
signals: [
  { token: '图像', kind: 'primary', points: 50, by: 'lexicon' },
  { token: 'y=',   kind: 'synonym', points: 20, by: 'lexicon' },
]
shadowed: [{ token: '选', shadowedBy: '选答案', kind: 'synonym' }]
```

两个字段都是为 P8 的 LLM 准备的，但**现在就要定**：

| 字段 | 回答什么问题 |
|---|---|
| `points` | 这一分是怎么来的（界面可逐行相加） |
| `by` | 这条证据是词表命中的，还是模型读出来的 |
| `shadowedBy` | 这个词命中了为什么没加分 |

`by` 不能省：LLM 会给出「原文里没有的能力词」——老师说「让学生自己调参数看看」，模型读出「滑块」。
如果界面显示「命中『滑块』+50」而原文没有这两个字，是能被一眼看穿的破绽。
分成 `lexicon` / `llm` 之后，这类证据在界面上是另一行、另一种颜色。

约束：`score === min(Σpoints, 100) / 100`（由 `scoreFromPoints(totalPoints(b))` 保证唯一实现）。

---

## 4. Trace

**目的**：题面第 2 问里那句「日志显示互动 Skill 已调用」，指的就是这份结构。

三条硬要求：

1. **服务端写入**，前端只展示——日志可信的前提是它由执行方产生
2. 每层至少一条，`layer` 有序 `router → composer → renderer → validator`
3. `input` / `output` 是**当时的快照**，不是引用；否则回放看到的永远是最终状态

`step` 用短标签（`score-skills`、`merge-ir`、`resolve-conflict`），`reason` 承载「为什么这么决定」。

正例

```ts
{ seq: 3, layer: 'composer', step: 'merge-ir', at: '2026-01-01T00:00:00.000Z',
  input: { selected: ['function-plot', 'interactive-slider'] },
  output: { childCount: 4 },
  decision: '合并为单页 IR', reason: 'slider 绑定 plot.params.k' }
```

反例：`layer: 'planner'`（不在 `TRACE_LAYERS` 里，无法断言「停在哪层」）

---

## 5. 验证结果

**目的**：把「我觉得对」变成「四层证据」。

| 层 | 证据种类 | 典型断言 |
|---|---|---|
| L1 路由 | `plan` | 选中集合与 `plan.selected` 一致 |
| L2 编排 | `ir-path` | `page.children[1]` 是 slider，且 `bindTo` 可解析 |
| L3 渲染 | `dom` | `input[type=range]` 存在且数量匹配 |
| L4 行为 | `behavior` | 拖动后 `k` 变化，采样点落在公式上（误差 ≤1px） |

规则：

- 任何一层 `fail`，下游一律 `skipped`（不是 `pass`）
- `firstFailedLayer` 取**最外层**（L1 优先于 L4）
- `status` 只有 `pass / fail / skipped`——不允许「看起来通过」的模糊状态

正例

```ts
{ ruleId: 'L2.ir.binding-resolves', layer: 'L2', status: 'fail',
  evidence: { kind: 'ir-path', detail: 'page.children[1].bindTo.nodeId' },
  expected: 'function-plot:plot-1', actual: 'plot-1',
  blockedReason: '绑定目标不存在，L3/L4 不执行' }
```

---

## 6. 理解层 IntentParser（LLM 的唯一接入点）

**目的**：把「一句人话」变成「可打分的意图证据」。这一层单独抽出来，是为了 P8 接 LLM 时
下游一行不改。

```ts
interface IntentParser {
  readonly id: 'rule' | 'llm';
  parse(utterance: string): Promise<ParsedIntent>;
}

interface ParsedIntent {
  utterance: string;              // 归一化后
  matchedTokens: readonly string[];   // 词表在原文里真的匹配到的词
  capabilities: readonly SkillId[];   // LLM 判定的能力（规则版恒为空）
  parser: 'rule' | 'llm';
  normalized?: string;            // LLM 的标准化复述，仅展示
  degraded?: { reason: string };  // LLM 失败降级的原因
}
```

三条约束：

1. **解析器不打分、不裁决。** `matchedTokens` 只记词，是 strong 还是 weak 由打分器按各自
   manifest 重新判断——同一个词在不同 Skill 里可能权重不同。
2. **证据来源必须分得开。** `signals[].by` 取 `lexicon` / `llm`，界面上分开显示。
   LLM 判定的能力在原文里可能没有对应的词，冒充分数会让「可解释」变成「看起来可解释」。
3. **降级必须有痕迹。** LLM 超时 / 返回非 JSON / 给出未知能力 → 回到规则版，并在
   `degraded.reason` 里写明，trace 上能看到「这次没有模型参与」。

分值（整数百分制，`score = min(Σpoints, 100)/100`）：

| 来源 | kind | points |
|---|---|---|
| 词表 | primary | 50 |
| 词表 | synonym | 20 |
| 词表 | intent | 10 |
| LLM | capability | **60** |

`capability` 取 60 而不是 50 是被测试逼出来的：50 分低于 0.60 的阈值，会导致
「接了 LLM 反而比词表更难选中」。60 分恰好等于阈值——单个能力标签能单独成立，
又不足以在叠加后压过大量词表证据。

---

## 7. 版本与变更

- `CONTRACT_VERSION` 与 `package.json` 的版本**解耦**：契约一改，fixtures 就要跟着改，所以单独记版本
- 改契约的顺序必须是：改 `src/contracts` → 改 fixtures → 改测试 → 再改实现。反序就会写出一堆「代码怎么写、测试就怎么断言」的假测试。
- 反例断言集中在 `tests/contracts.type-assertions.ts`：用 `@ts-expect-error` 守住「契约没被悄悄放宽」。
