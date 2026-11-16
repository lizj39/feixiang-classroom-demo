/**
 * 三个面板。刻意拆成独立组件而不是塞进 App：
 *  - 每个面板的 data-testid 是验收判据，单独成文件更容易定位；
 *  - 中间的「产物」与右边的「证据」职责不同：产物给人看结果，证据给人看理由。
 *
 * P3 起，证据面板开始展示真实数据：每个 Skill 的得分、每条证据及其来源、
 * 以及服务端写的分层 trace。
 */

import {
  MAX_UTTERANCE_LENGTH,
  SCENARIOS,
  shouldGenerate,
  type Plan,
  type SkillManifest,
} from '../contracts/index';
import { CoursewareView } from './render/CoursewareView';
import type { Phase } from './phase';

interface RequestPanelProps {
  readonly utterance: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
}

export function RequestPanel({ utterance, disabled, onChange, onSubmit }: RequestPanelProps) {
  const length = utterance.trim().length;

  return (
    <section className="panel" data-testid="request-panel">
      <h2 className="panel__title">需求输入</h2>
      <p className="panel__hint">用一句话说清你要的课件，系统会自己判断该用哪个教学 Skill。</p>

      <textarea
        className="input"
        data-testid="utterance-input"
        value={utterance}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        placeholder="例如：能拖动滑块的一次函数演示"
        disabled={disabled}
      />

      <div className="input__meta">
        <span className={length > MAX_UTTERANCE_LENGTH ? 'input__count input__count--over' : 'input__count'}>
          {length} / {MAX_UTTERANCE_LENGTH}
        </span>
        <button className="button" type="button" data-testid="generate-button" onClick={onSubmit} disabled={disabled}>
          {disabled ? '生成中…' : '生成课件'}
        </button>
      </div>

      <div className="scenarios">
        <h3 className="panel__subtitle">演示场景</h3>
        <div className="scenario-list">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              className="chip"
              data-testid={`scenario-${scenario.id}`}
              onClick={() => onChange(scenario.utterance)}
              disabled={disabled}
              title={scenario.utterance}
            >
              <span className="chip__id">{scenario.id}</span>
              <span className="chip__label">{scenario.label}</span>
              <span className="chip__hint">{scenario.expectation}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

const PLAN_TYPE_LABEL: Record<Plan['type'], string> = {
  single: '单 Skill',
  combo: '组合',
  conflict: '冲突',
  no_match: '无匹配',
};

export function PreviewPanel({ phase }: { readonly phase: Phase }) {
  return (
    <section className="panel panel--preview" data-testid="preview-panel">
      <h2 className="panel__title">课件预览</h2>

      <div className="preview" data-testid="preview-status">
        {phase.kind === 'idle' && (
          <p className="placeholder">
            还没有生成任何东西。
            <br />
            选一个演示场景，或自己写一句需求，然后点「生成课件」。
          </p>
        )}

        {phase.kind === 'loading' && (
          <p className="placeholder" data-testid="loading-indicator">
            生成中…（正在解析需求并选择 Skill）
          </p>
        )}

        {phase.kind === 'error' && (
          <div className="error" data-testid="error-banner">
            <span className="error__code">{phase.code ?? 'ERROR'}</span>
            <span className="error__message">{phase.message}</span>
          </div>
        )}

        {phase.kind === 'success' && phase.response.plan === null && (
          <div className="receipt" data-testid="receipt">
            <p className="receipt__title">服务端已收到这次请求</p>
            <p className="panel__hint" data-testid="receipt-utterance">
              {phase.response.utterance}
            </p>
            <pre className="mono">{phase.response.requestId}</pre>
          </div>
        )}

        {phase.kind === 'success' && phase.response.plan !== null && (
          <div className="decision" data-testid="decision">
            <div className="decision__head">
              <span className="badge badge--strong" data-testid="decision-type">
                {PLAN_TYPE_LABEL[phase.response.plan.type]}
              </span>
              <span className={shouldGenerate(phase.response.plan) ? 'badge badge--ok' : 'badge badge--warn'}>
                {shouldGenerate(phase.response.plan) ? '生成课件' : '不生成'}
              </span>
            </div>

            {phase.response.courseware !== null && <CoursewareView courseware={phase.response.courseware} />}

            <p className="decision__reason" data-testid="decision-reason">
              {phase.response.plan.reason}
            </p>

            {phase.response.plan.selected.length > 0 && (
              <div className="decision__selected">
                {phase.response.plan.selected.map((id) => (
                  <span key={id} className="chip chip--static mono">
                    {id}
                  </span>
                ))}
              </div>
            )}

            {phase.response.plan.questions.length > 0 && (
              <div className="questions" data-testid="clarify-questions">
                <h3 className="panel__subtitle">需要你补充</h3>
                <ol className="questions__list">
                  {phase.response.plan.questions.map((question) => (
                    <li key={question.id}>
                      {question.question}
                      {question.options && question.options.length > 0 && (
                        <span className="questions__options">{question.options.join(' / ')}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {phase.response.courseware === null && (
              <p className="panel__hint">
                这次没有产出课件（决策为「不生成」）。系统选择先问清楚，而不是猜一个看起来像答案的东西。
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function EvidencePanel({
  phase,
  skills,
}: {
  readonly phase: Phase;
  /** null = 加载中；[] = 加载失败或注册表为空 */
  readonly skills: readonly SkillManifest[] | null;
}) {
  const plan = phase.kind === 'success' ? phase.response.plan : null;
  const trace = phase.kind === 'success' ? phase.response.trace : null;
  // plan.selected 是三种元组/数组的联合（含空元组），直接 .includes 会被推成 never
  const selectedIds = new Set<string>(plan?.selected ?? []);

  return (
    <section className="panel" data-testid="evidence-panel">
      <h2 className="panel__title">证据面板</h2>
      <p className="panel__hint">
        这一栏回答「为什么这么选」和「生成得对不对」。所有结论都来自服务端返回的结构化数据，不是界面文案。
      </p>

      <div className="block" data-testid="evidence-scores">
        <h3 className="panel__subtitle">选择理由（每个 Skill 的得分与证据）</h3>

        {plan === null && <p className="panel__hint">还没有请求，所以还没有分数。</p>}

        {plan !== null && (
          <table className="score-table">
            <tbody>
              {plan.scores.map((breakdown) => (
                <tr
                  key={breakdown.skill}
                  data-testid={`score-${breakdown.skill}`}
                  className={selectedIds.has(breakdown.skill) ? 'score-row is-selected' : 'score-row'}
                >
                  <td className="mono score-row__skill">{breakdown.skill}</td>
                  <td className="score-row__value">{breakdown.score.toFixed(2)}</td>
                  <td className="score-row__signals">
                    {breakdown.signals.length === 0 && <span className="muted">—</span>}
                    {breakdown.signals.map((signal) => (
                      <span
                        key={`${signal.token}-${signal.by}`}
                        className={signal.by === 'llm' ? 'signal signal--llm' : 'signal'}
                        title={signal.by === 'llm' ? 'LLM 判定的能力' : '词表命中的词'}
                      >
                        {signal.token}
                        <em>+{signal.points}</em>
                      </span>
                    ))}
                    {breakdown.shadowed.map((shadow) => (
                      <span
                        key={`${shadow.token}-shadowed`}
                        className="signal signal--shadowed"
                        title={`被「${shadow.shadowedBy}」遮挡，不重复计分`}
                      >
                        {shadow.token}
                        <em>0</em>
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {plan !== null && (
          <p className="panel__hint">
            阈值 0.60。灰色删除线表示命中了但被更长的词遮挡（同一含义不重复计分）；
            蓝色标的是 LLM 判定的能力，与词表证据分开显示。
          </p>
        )}
      </div>

      <div className="block" data-testid="evidence-trace">
        <h3 className="panel__subtitle">执行链路（服务端写入的 trace）</h3>

        {trace === null && <p className="panel__hint">还没有请求。</p>}

        {trace !== null && (
          <ol className="trace-list">
            {trace.events.map((event) => (
              <li key={event.seq} className="trace-item" data-testid="trace-event">
                <span className="badge">{event.layer}</span>
                <span className="trace-item__step mono">{event.step}</span>
                <span className="trace-item__decision">{event.decision}</span>
                <p className="trace-item__reason">{event.reason}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="block" data-testid="evidence-verification">
        <h3 className="panel__subtitle">验证报告（L1–L4）</h3>
        <p className="panel__hint">
          还没接入。P6 会在这里显示：路由选对没有、IR 里真有节点没有、DOM 里真有控件没有、拖动真的重绘没有。
        </p>
      </div>

      <div className="block" data-testid="registered-skills">
        <h3 className="panel__subtitle">
          已注册的 Skill
          {skills ? `（${skills.length}）` : ''}
        </h3>

        {skills === null && <p className="panel__hint">加载中…</p>}
        {skills !== null && skills.length === 0 && <p className="panel__hint">未能加载 Skill 清单</p>}

        {skills !== null && skills.length > 0 && (
          <ul className="skill-list">
            {skills.map((skill) => (
              <li key={skill.id} className="skill-item" data-testid={`skill-${skill.id}`}>
                <div className="skill-item__head">
                  <strong>{skill.displayName}</strong>
                  <code>{skill.id}</code>
                </div>
                <div className="skill-item__meta">
                  <span className="badge">槽位 {skill.slot}</span>
                  <span className="badge">优先级 {skill.priority}</span>
                  <span className="badge">产出 {skill.produces.join(' / ')}</span>
                </div>
                <p className="skill-item__summary">{skill.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
