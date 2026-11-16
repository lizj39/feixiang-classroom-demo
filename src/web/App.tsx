/**
 * 页面骨架：标题条 + 三栏。
 *
 * 三栏是定下来的信息架构，后续阶段只往里面填内容，不再改布局：
 *   左 = 输入与场景   中 = 产物   右 = 证据
 * 右侧独立成栏是刻意的：面试时「为什么这么选」和「怎么知道生成对了」需要被指着看，
 * 塞在产物下面会被忽略。
 *
 * 验证报告的合并在这个层做：课件 DOM 的 ref 由这里持有，L3/L4 需要它。
 */

import { useEffect, useRef, useState } from 'react';

import { CONTRACT_VERSION, type BugMode, type SkillManifest } from '../contracts/index';
import { ApiRequestError, requestGenerate, requestSkills } from './api';
import { EvidencePanel, PreviewPanel, RequestPanel } from './panels';
import { isBusy, type Phase } from './phase';
import { useVerification } from './verify/useVerification';

export function App({ bugMode = null }: { readonly bugMode?: BugMode | null }) {
  const [utterance, setUtterance] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // null = 加载中；[] = 加载失败（不阻塞生成流程，只是这块证据缺失）
  const [skills, setSkills] = useState<readonly SkillManifest[] | null>(null);

  const coursewareRef = useRef<HTMLDivElement | null>(null);

  const busy = isBusy(phase);
  const courseware = phase.kind === 'success' ? phase.response.courseware : null;
  const serverReport = phase.kind === 'success' ? phase.response.verification : null;
  const verification = useVerification({ serverReport, courseware, container: coursewareRef });

  useEffect(() => {
    let cancelled = false;
    requestSkills()
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    const trimmed = utterance.trim();

    if (trimmed.length === 0) {
      setPhase({ kind: 'error', code: 'EMPTY_UTTERANCE', message: '请先输入需求，或选一个演示场景' });
      return;
    }

    setPhase({ kind: 'loading', utterance: trimmed });
    try {
      const response = await requestGenerate(trimmed, bugMode);
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
          <span className={busy ? 'badge badge--busy' : 'badge'}>阶段 6 / 8</span>
        </div>
      </header>

      {bugMode !== null && (
        <div className="bug-banner" data-testid="bug-banner">
          <strong>故障注入已开启：<code>{bugMode}</code></strong>
          <span>
            这是演示开关，用来稳定复现「日志说调用了、页面却没有」。看右侧验证报告停在哪一层。
          </span>
        </div>
      )}

      <main className="app__main">
        <RequestPanel
          utterance={utterance}
          disabled={busy}
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
