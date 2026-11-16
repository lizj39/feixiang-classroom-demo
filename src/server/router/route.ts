/**
 * 路由：一句话 → Plan。系统的选择结论与理由都在这里产出。
 *
 * 六个步骤，每步都写一条 trace，任何一步的结论都能回查：
 *   1. 解析意图        （parser：规则版或 LLM 版）
 *   2. 打分            （4 个 Skill 各自的证据与总分）
 *   3. 阈值筛选        （>= 0.60 才算达标）
 *   4. 依赖闭包        （slider 需要 plot，自动补入并记录理由）
 *   5. 冲突检测与裁决  （两路检测 + 优先级 / 平局降级）
 *   6. 组装 Plan       （四种形态之一 + 澄清问题）
 *
 * 顺序上有个刻意的决定：**依赖闭包在冲突检测之前**。因为补入依赖会改变参与
 * 冲突判定的集合，若放在之后，可能产出「已经判定无冲突、又补进来一个冲突方」的坏 Plan。
 */

import {
  CONFLICT_POLICY,
  type ClarifyingQuestion,
  type Plan,
  type ScoreBreakdown,
  type SkillId,
  type SkillManifest,
} from '../../contracts/index';
import type { IntentParser, ParsedIntent } from '../../contracts/index';
import type { SkillRegistry } from '../skills/registry';
import type { Emit } from '../trace/recorder';
import { detectConflicts, resolveConflicts } from './conflict';
import { scoreAll } from './score';

/** 入选阈值。单阈值，没有「弱匹配候选」档：将就出来的课件比不生成更糟。 */
export const SELECTION_THRESHOLD = 0.6;

export interface RouteDeps {
  readonly registry: SkillRegistry;
  readonly parser: IntentParser;
  readonly emit: Emit;
}

/** 路由产物：决策 + 解析出的意图。意图要交给 Composer 取参数，所以必须一起返回。 */
export interface RouteOutcome {
  readonly plan: Plan;
  readonly intent: ParsedIntent;
}

export async function route(utterance: string, deps: RouteDeps): Promise<RouteOutcome> {
  const { registry, parser, emit } = deps;

  // 1. 解析意图
  const intent = await parser.parse(utterance);
  emit({
    layer: 'router',
    step: 'parse-intent',
    input: { utterance },
    output: {
      parser: intent.parser,
      normalized: intent.utterance,
      matchedTokens: intent.matchedTokens,
      capabilities: intent.capabilities,
      params: intent.params,
      degraded: intent.degraded?.reason ?? null,
      notes: intent.notes ?? [],
    },
    decision: `用 ${intent.parser} 解析器理解需求`,
    reason:
      intent.matchedTokens.length > 0
        ? `命中 ${intent.matchedTokens.length} 个触发词：${intent.matchedTokens.join('、')}`
        : '没有命中任何触发词',
  });

  // 2. 打分
  const scores = scoreAll(registry.all(), intent);
  const top = scores[0];

  emit({
    layer: 'router',
    step: 'score-skills',
    input: { matchedTokens: intent.matchedTokens, capabilities: intent.capabilities },
    output: scores.map((breakdown) => ({
      skill: breakdown.skill,
      score: breakdown.score,
      signals: breakdown.signals.map((signal) => `${signal.token}+${signal.points}`),
    })),
    decision: '按整数百分制给每个 Skill 打分',
    reason: top ? `最高分 ${top.skill} ${top.score.toFixed(2)}` : '没有任何候选',
  });

  // 3. 阈值筛选
  const qualified = scores.filter((breakdown) => breakdown.score >= SELECTION_THRESHOLD);
  const qualifiedManifests = resolveManifests(qualified, registry);

  emit({
    layer: 'router',
    step: 'apply-threshold',
    input: { threshold: SELECTION_THRESHOLD, scores: scores.map((item) => ({ skill: item.skill, score: item.score })) },
    output: { qualified: qualifiedManifests.map((manifest) => manifest.id) },
    decision: `保留得分 ≥ ${SELECTION_THRESHOLD} 的 Skill`,
    reason:
      qualifiedManifests.length > 0
        ? `${qualifiedManifests.length} 个达标`
        : '没有一个达标，按规则不生成课件',
  });

  // 4. 依赖闭包
  const { closed, added } = closeDependencies(qualifiedManifests, registry);
  if (added.length > 0) {
    emit({
      layer: 'router',
      step: 'close-dependencies',
      input: { qualified: qualifiedManifests.map((manifest) => manifest.id) },
      output: { added },
      decision: '补入被依赖的 Skill',
      reason: `${added.join('、')} 是已选 Skill 的前置依赖，缺少它产出的 IR 无法成立`,
    });
  }

  // 5. 冲突检测与裁决
  const conflicts = detectConflicts(closed);

  if (closed.length === 0) {
    return { plan: noMatchPlan(intent.utterance, scores), intent };
  }

  if (conflicts.length === 0) {
    emit({
      layer: 'router',
      step: 'detect-conflicts',
      input: { selected: closed.map((manifest) => manifest.id) },
      output: { conflicts: [] },
      decision: '没有冲突',
      reason: '选中的 Skill 之间既没有显式互斥，也没有抢占同一个题位',
    });

    const [only] = closed;
    const plan =
      closed.length === 1 && only
        ? singlePlan(intent.utterance, scores, only, intent.parser)
        : comboPlan(intent.utterance, scores, closed, intent.parser);
    return { plan, intent };
  }

  const resolution = resolveConflicts(closed, conflicts);

  emit({
    layer: 'router',
    step: 'resolve-conflict',
    input: {
      selected: closed.map((manifest) => manifest.id),
      conflicts: conflicts.map((conflict) => ({ a: conflict.a, b: conflict.b, by: conflict.by })),
    },
    output: resolution,
    decision: resolution.kind === 'winner' ? '按优先级裁决' : '降级为澄清',
    reason: resolution.reason,
  });

  return { plan: conflictPlan(intent.utterance, scores, closed, resolution), intent };
}

function resolveManifests(scores: readonly ScoreBreakdown[], registry: SkillRegistry): SkillManifest[] {
  return scores
    .map((breakdown) => registry.get(breakdown.skill))
    .filter((manifest): manifest is SkillManifest => manifest !== undefined);
}

function closeDependencies(
  selected: readonly SkillManifest[],
  registry: SkillRegistry,
): { closed: SkillManifest[]; added: SkillId[] } {
  const closed = [...selected];
  const added: SkillId[] = [];
  const queue = [...selected];

  while (queue.length > 0) {
    const manifest = queue.shift();
    if (!manifest) break;

    for (const requiredId of manifest.requires) {
      if (closed.some((item) => item.id === requiredId)) continue;
      const required = registry.get(requiredId);
      if (!required) continue; // 注册表校验阶段已挡住，这里只是防御
      closed.push(required);
      added.push(required.id);
      queue.push(required);
    }
  }

  return { closed, added };
}

function question(id: string, text: string, options?: readonly string[]): ClarifyingQuestion {
  return options ? { id, question: text, options } : { id, question: text };
}

/** 无匹配时的澄清问题：给方向，而不是让老师自己猜系统能做什么。 */
function noMatchQuestions(): readonly ClarifyingQuestion[] {
  return [
    question('q-topic', '你想演示哪个具体的知识点？（例如「一次函数图像」「函数单调性」）'),
    question('q-style', '希望是可拖动的互动演示，还是一次随堂练习？', ['互动演示', '随堂练习']),
  ];
}

/** 冲突降级时的澄清问题：把「选哪个」摆到老师面前，而不是替他猜。 */
function conflictQuestions(
  competitors: readonly SkillId[],
  candidates: readonly SkillManifest[],
): readonly ClarifyingQuestion[] {
  const names = competitors.map(
    (id) => candidates.find((manifest) => manifest.id === id)?.displayName ?? id,
  );
  return [
    question('q-conflict-mode', CONFLICT_POLICY.clarifyQuestion, names),
    question('q-conflict-count', '需要几道题？（默认 1 道）', ['1 道', '3 道']),
  ];
}

function parserNote(parser: 'rule' | 'llm'): string {
  return parser === 'llm' ? '（意图由 LLM 解析，评分与裁决仍由规则完成）' : '';
}

function singlePlan(
  utterance: string,
  scores: readonly ScoreBreakdown[],
  manifest: SkillManifest,
  parser: 'rule' | 'llm',
): Plan {
  const breakdown = scores.find((item) => item.skill === manifest.id);
  const score = breakdown?.score ?? 0;

  return {
    type: 'single',
    utterance,
    selected: [manifest.id],
    scores,
    reason: `只有 ${manifest.id} 达到阈值 ${SELECTION_THRESHOLD}（${score.toFixed(2)}），且没有其它 Skill 竞争，单独使用。${parserNote(parser)}`,
    questions: [],
  };
}

function comboPlan(
  utterance: string,
  scores: readonly ScoreBreakdown[],
  selected: readonly SkillManifest[],
  parser: 'rule' | 'llm',
): Plan {
  const names = selected.map((manifest) => {
    const score = scores.find((item) => item.skill === manifest.id)?.score ?? 0;
    return `${manifest.id} ${score.toFixed(2)}`;
  });

  return {
    type: 'combo',
    utterance,
    selected: selected.map((manifest) => manifest.id),
    scores,
    reason: `${names.join(' 与 ')} 同时达标，槽位互不冲突，组合生成。${parserNote(parser)}`,
    questions: [],
  };
}

function conflictPlan(
  utterance: string,
  scores: readonly ScoreBreakdown[],
  selected: readonly SkillManifest[],
  resolution: ReturnType<typeof resolveConflicts>,
): Plan {
  const generate = resolution.kind === 'winner';

  return {
    type: 'conflict',
    utterance,
    selected: selected.map((manifest) => manifest.id),
    scores,
    resolution,
    reason: resolution.reason,
    questions: generate ? [] : conflictQuestions(resolution.competitors, selected),
  };
}

function noMatchPlan(utterance: string, scores: readonly ScoreBreakdown[]): Plan {
  return {
    type: 'no_match',
    utterance,
    selected: [],
    scores,
    reason: `没有任何 Skill 达到阈值 ${SELECTION_THRESHOLD}，当前能力集覆盖不了这个需求，因此不生成课件。`,
    questions: noMatchQuestions(),
  };
}
