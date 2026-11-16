/**
 * 打分：把意图证据换算成每个 Skill 的得分。
 *
 * 用整数百分制而不是 0.5 / 0.2 / 0.1 这类浮点权重，是为了让
 * `60 / 100 === 0.6` 精确成立 —— 阈值刚好压在 0.60 上时，浮点误差
 * （0.5 + 0.1 = 0.6000000000000001）会把「达标」判成「不达标」。
 *
 * 遮蔽规则：同一个 Skill 内，若命中的词是另一个已命中词的子串（`选` ⊂ `选答案`），
 * 则短的那个不计分。否则同一个含义会被两层词表各加一次分，分数就失去意义。
 */

import {
  scoreFromPoints,
  type ParsedIntent,
  type ScoreBreakdown,
  type ShadowedSignal,
  type Signal,
  type SignalKind,
  type SkillManifest,
} from '../../contracts/index';
import { normalizeForMatching } from '../intent/normalize';

export const SIGNAL_POINTS: Readonly<Record<SignalKind, number>> = {
  primary: 50,
  synonym: 20,
  intent: 10,
  /**
   * 能力标签 60 分，不是 50。
   *
   * 这是被测试逼出来的一个决定：模型直接判定「这句话需要滑块」，比原文里出现一个
   * 「滑块」二字更确定（词可能是反讽、否定或指代别的），所以它至少要能单独成立。
   * 50 分会低于 0.60 的阈值，导致「接了 LLM 反而比词表更难选中」这种荒谬结果。
   * 60 分恰好等于阈值：能单独达标，又不足以在叠加后压过大量词表证据。
   */
  capability: 60,
};

type LexiconKind = 'primary' | 'synonym' | 'intent';

function kindOf(manifest: SkillManifest, token: string): LexiconKind | undefined {
  if (manifest.triggers.primary.some((item) => normalizeForMatching(item) === token)) return 'primary';
  if (manifest.triggers.synonyms.some((item) => normalizeForMatching(item) === token)) return 'synonym';
  if (manifest.triggers.intents.some((item) => normalizeForMatching(item) === token)) return 'intent';
  return undefined;
}

export function scoreSkill(manifest: SkillManifest, intent: ParsedIntent): ScoreBreakdown {
  const candidates: Signal[] = [];

  for (const token of intent.matchedTokens) {
    const kind = kindOf(manifest, token);
    if (!kind) continue;
    candidates.push({ token, kind, points: SIGNAL_POINTS[kind], by: 'lexicon' });
  }

  if (intent.capabilities.includes(manifest.id)) {
    candidates.push({ token: manifest.id, kind: 'capability', points: SIGNAL_POINTS.capability, by: 'llm' });
  }

  const signals: Signal[] = [];
  const shadowed: ShadowedSignal[] = [];

  for (const candidate of candidates) {
    const longer = candidates.find(
      (other) =>
        other !== candidate && other.token.length > candidate.token.length && other.token.includes(candidate.token),
    );

    if (longer) {
      shadowed.push({ token: candidate.token, shadowedBy: longer.token, kind: candidate.kind });
    } else {
      signals.push(candidate);
    }
  }

  const points = signals.reduce((sum, signal) => sum + signal.points, 0);

  return {
    skill: manifest.id,
    score: scoreFromPoints(points),
    // 强信号在前：界面上先看到「一次函数 +50」，再看「演示 +10」
    signals: [...signals].sort((a, b) => b.points - a.points),
    shadowed,
  };
}

/** 全部 Skill 的得分，按分数降序（同分按 id 保证顺序稳定）。 */
export function scoreAll(manifests: readonly SkillManifest[], intent: ParsedIntent): ScoreBreakdown[] {
  return manifests
    .map((manifest) => scoreSkill(manifest, intent))
    .sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));
}
