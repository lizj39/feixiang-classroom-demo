/**
 * 页面骨架：标题条 + 三栏。
 *
 * 三栏是定下来的信息架构，后续迭代只往里面填内容，不改布局：
 *   左 = 输入与场景   中 = 产物   右 = 证据
 * 右侧独立成栏是刻意的：「为什么这么选」和「怎么知道生成对了」需要与产物并列展示，
 * 塞在产物下面会被忽略。
 *
 * 验证报告的合并在这个层做：课件 DOM 的 ref 由这里持有，L3/L4 需要它。
 */

import { useEffect, useRef, useState } from 'react';

import { CONTRACT_VERSION, type BugMode, type ParserMode, type SkillManifest } from '../contracts/index';
import { ApiRequestError, requestGenerate, requestSkills } from './api';
import { readBugMode, setRegistryBug } from './bug-mode';
import { EvidencePanel, PreviewPanel, RequestPanel } from './panels';
import { isBusy, type Phase } from './phase';
import { useVerification } from './verify/useVerification';

export interface LlmStatus {
  readonly configured: boolean;
  readonly model: string | null;
}

export function App({ initialBugMode }: { readonly initialBugMode?: BugMode | null } = {}) {
  const [utterance, setUtterance] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // null = 加载中；[] = 加载失败（不阻塞生成流程，只是这块证据缺失）
  const [skills, setSkills] = useState<readonly SkillManifest[] | null>(null);
  const [llm, setLlm] = useState<LlmStatus | null>(null);

  const coursewareRef = useRef<HTMLDivElement | null>(null);

  // 故障模式：从 URL 初始化，之后由页面上的按钮切换（同时也同步回 URL）
  const [bugMode, setBugMode] = useState<BugMode | null>(
    () => initialBugMode ?? readBugMode(window.location.search),
  );

  // 理解方式：null = auto（配了 key 用 LLM，没配用规则）
  const [parserMode, setParserMode] = useState<ParserMode | null>(null);

  const busy = isBusy(phase);
  const courseware = phase.kind === 'success' ? phase.response.courseware : null;
  const serverReport = phase.kind === 'success' ? phase.response.verification : null;
  const verification = useVerification({ serverReport, courseware, container: coursewareRef });

  useEffect(() => {
    let cancelled = false;
    requestSkills()
      .then((payload) => {
        if (cancelled) return;
        setSkills(payload.skills);
        setLlm(payload.llm);
      })
      .catch(() => {
        if (cancelled) return;
        setSkills([]);
        setLlm({ configured: false, model: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changeBugMode = (next: BugMode | null): void => {
    // 先改注册表再 setState：渲染发生在 setState 之后，顺序反了会画出上一帧的样子
    setRegistryBug(next);
    setBugMode(next);

    const url = new URL(window.location.href);
    if (next === null) url.searchParams.delete('bug');
    else url.searchParams.set('bug', next);
    window.history.replaceState(null, '', url.toString());

    // 旧结果是旧模式下产生的，切换后作废，避免自己骗自己
    setPhase({ kind: 'idle' });
  };

  const changeParserMode = (next: ParserMode | null): void => {
    setParserMode(next);
    setPhase({ kind: 'idle' });
  };

  const submit = async () => {
    const trimmed = utterance.trim();

    if (trimmed.length === 0) {
      setPhase({ kind: 'error', code: 'EMPTY_UTTERANCE', message: '请先输入需求，或选一个示例场景' });
      return;
    }

    setPhase({ kind: 'loading', utterance: trimmed });
    try {
      const response = await requestGenerate(trimmed, { bug: bugMode, parser: parserMode });
      setPhase({ kind: 'success', response });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setPhase({ kind: 'error', code: error.code, message: error.message });
      } else {
        setPhase({ kind: 'error', code: null, message: error instanceof Error ? error.message : String(error) });
      }
    }
  };

  return (
    <div className="app" data-testid="app-root">
      <header className="app__header">
        <div className="app__brand">
          <h1 className="app__title">飞象老师 · 一句话生成课堂互动课件</h1>
          <p className="app__subtitle">选择可解释 · 结果可验证 · 故障可定位</p>
        </div>
        <div className="app__meta">
          <span className="badge" data-testid="contract-version">
            契约 v{CONTRACT_VERSION}
          </span>
          {verification !== null && (
            <span
              className={
                verification.overall === 'fail'
                  ? 'badge badge--warn'
                  : verification.pendingLayers.length > 0
                    ? 'badge'
                    : 'badge badge--ok'
              }
              data-testid="header-verification"
              title={verification.summary}
            >
              {verification.overall === 'fail'
                ? `✗ ${verification.firstFailedLayer ?? ''} 失败`
                : verification.pendingLayers.length > 0
                  ? `… ${verification.pendingLayers.join(' / ')} 待执行`
                  : '✓ 四层验证通过'}
            </span>
          )}
          <span className={busy ? 'badge badge--busy' : 'badge'}>v0.1.0</span>
        </div>
      </header>

      {bugMode !== null && (
        <div className="bug-banner" data-testid="bug-banner">
          <strong>
            故障注入已开启：<code>{bugMode}</code>
          </strong>
          <span>这是故障演练开关，用来稳定复现「日志说调用了、页面却没有」。看右侧验证报告停在哪一层。</span>
        </div>
      )}

      <main className="app__main">
        <RequestPanel
          utterance={utterance}
          disabled={busy}
          bugMode={bugMode}
          onBugModeChange={changeBugMode}
          parserMode={parserMode}
          onParserModeChange={changeParserMode}
          llmConfigured={llm?.configured ?? false}
          llmModel={llm?.model ?? null}
          onChange={setUtterance}
          onSubmit={() => {
            void submit();
          }}
        />
        <PreviewPanel phase={phase} coursewareRef={coursewareRef} />
        <EvidencePanel phase={phase} skills={skills} verification={verification} />
      </main>
    </div>
  );
}
