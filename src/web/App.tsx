/**
 * 页面骨架：标题条 + 三栏。
 *
 * 三栏是定下来的信息架构，后续阶段只往里面填内容，不再改布局：
 *   左 = 输入与场景   中 = 产物   右 = 证据
 * 右侧独立成栏是刻意的：面试时「为什么这么选」和「怎么知道生成对了」需要被指着看，
 * 塞在产物下面会被忽略。
 */

import { useCallback, useState } from 'react';

import { CONTRACT_VERSION } from '../contracts/index';
import { ApiRequestError, requestGenerate } from './api';
import { EvidencePanel, PreviewPanel, RequestPanel } from './panels';
import { isBusy, type Phase } from './phase';

export function App() {
  const [utterance, setUtterance] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const busy = isBusy(phase);

  const submit = useCallback(async () => {
    const trimmed = utterance.trim();

    if (trimmed.length === 0) {
      setPhase({ kind: 'error', code: 'EMPTY_UTTERANCE', message: '请先输入需求，或选一个演示场景' });
      return;
    }

    setPhase({ kind: 'loading', utterance: trimmed });
    try {
      const response = await requestGenerate(trimmed);
      setPhase({ kind: 'success', response });
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setPhase({ kind: 'error', code: error.code, message: error.message });
      } else {
        setPhase({ kind: 'error', code: null, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }, [utterance]);

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
          <span className={busy ? 'badge badge--busy' : 'badge'}>阶段 2 / 8</span>
        </div>
      </header>

      <main className="app__main">
        <RequestPanel
          utterance={utterance}
          disabled={busy}
          onChange={setUtterance}
          onSubmit={() => {
            void submit();
          }}
        />
        <PreviewPanel phase={phase} />
        <EvidencePanel phase={phase} />
      </main>
    </div>
  );
}
