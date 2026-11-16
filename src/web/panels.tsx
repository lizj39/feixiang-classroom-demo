/**
 * 三个面板。刻意拆成独立组件而不是塞进 App：
 *  - 每个面板的 data-testid 是 P1-2 的验收判据，单独成文件更容易定位；
 *  - P6 起「证据面板」会膨胀成选择理由 / trace / 验证报告三块，届时只改这里。
 */

import { MAX_UTTERANCE_LENGTH, SCENARIOS, type SkillManifest } from '../contracts/index';
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

        {phase.kind === 'success' && (
          <div className="receipt" data-testid="receipt">
            <p className="receipt__title">服务端已收到这次请求</p>
            <dl className="receipt__list">
              <dt>需求</dt>
              <dd data-testid="receipt-utterance">{phase.response.utterance}</dd>
              <dt>requestId</dt>
              <dd className="mono">{phase.response.requestId}</dd>
              <dt>收到时间</dt>
              <dd className="mono">{phase.response.receivedAt}</dd>
            </dl>
            <p className="panel__hint">
              当前是阶段 1 的接口骨架：<code>plan</code> / <code>courseware</code> / <code>trace</code> /{' '}
              <code>verification</code> 都还是 <code>null</code>。P3 接路由、P4 接渲染器之后，这里会变成真正的可操作课件。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

const EVIDENCE_SLOTS = [
  { key: '选择理由', detail: '每个 Skill 的得分与命中词（P3）' },
  { key: '执行链路', detail: 'router → composer → renderer → validator 的分层 trace（P6）' },
  { key: '验证报告', detail: 'L1 路由 / L2 IR / L3 DOM / L4 行为（P6）' },
] as const;

export function EvidencePanel({
  phase,
  skills,
}: {
  readonly phase: Phase;
  /** null = 加载中；[] = 加载失败或注册表为空 */
  readonly skills: readonly SkillManifest[] | null;
}) {
  return (
    <section className="panel" data-testid="evidence-panel">
      <h2 className="panel__title">证据面板</h2>
      <p className="panel__hint">
        这一栏回答「为什么这么选」和「生成得对不对」。所有结论都来自服务端返回的结构化数据，不是界面文案。
      </p>

      <div className="skill-block" data-testid="registered-skills">
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

      <ul className="evidence-list">
        {EVIDENCE_SLOTS.map((slot) => (
          <li key={slot.key} className="evidence-item" data-testid={`evidence-${slot.key}`}>
            <div className="evidence-item__head">
              <strong>{slot.key}</strong>
              <span className="badge">{phase.kind === 'success' ? '待接入' : '未开始'}</span>
            </div>
            <p className="evidence-item__detail">{slot.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
