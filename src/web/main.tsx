/**
 * 骨架阶段的占位页。
 *
 * 它只做一件有信息量的事：调用同源的 /api/health 并显示结果。
 * 页面能显示 ok，就同时证明了「Vite middleware 挂上了」+「API 路由通了」+「前后端同源」。
 * 三栏布局与证据面板在 P1-2 才开始。
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

interface HealthPayload {
  ok: boolean;
  service: string;
  contractVersion: string;
  uptimeSec: number;
  now: string;
}

type HealthState = { status: 'loading' } | { status: 'ok'; data: HealthPayload } | { status: 'error'; message: string };

const styles = {
  page: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
    margin: 0,
    padding: '48px 24px',
    background: '#f6f7f9',
    color: '#1f2328',
    minHeight: '100vh',
    boxSizing: 'border-box',
  },
  card: {
    maxWidth: 720,
    margin: '0 auto',
    background: '#fff',
    border: '1px solid #d8dee4',
    borderRadius: 12,
    padding: '28px 32px',
  },
  eyebrow: { fontSize: 13, color: '#59636e', margin: 0 },
  title: { fontSize: 26, margin: '8px 0 4px' },
  subtitle: { fontSize: 14, color: '#59636e', margin: '0 0 24px' },
  statusRow: { display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 8px' },
  dot: (ok: boolean) => ({
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: ok ? '#1a7f37' : '#cf222e',
    display: 'inline-block',
  }),
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: 13,
    background: '#f6f8fa',
    border: '1px solid #d8dee4',
    borderRadius: 8,
    padding: '12px 14px',
    whiteSpace: 'pre-wrap' as const,
    margin: '12px 0 24px',
  },
  list: { fontSize: 14, lineHeight: 1.9, color: '#1f2328', paddingLeft: 20, margin: 0 },
} as const;

function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as HealthPayload;
      })
      .then((data) => {
        if (!cancelled) setHealth({ status: 'ok', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setHealth({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ok = health.status === 'ok';

  return (
    <div style={styles.page} data-testid="app-root">
      <div style={styles.card}>
        <p style={styles.eyebrow}>全栈实习生作业 · 阶段 1 / 8</p>
        <h1 style={styles.title}>飞象老师 · 一句话生成课堂互动课件</h1>
        <p style={styles.subtitle}>
          单进程骨架已就位：页面与 API 同源同端口，前端不需要代理或 CORS 配置。
        </p>

        <div style={styles.statusRow} data-testid="health-status">
          <span style={styles.dot(ok)} />
          <strong>
            {health.status === 'loading' && '正在调用 /api/health …'}
            {health.status === 'ok' && 'API 连通'}
            {health.status === 'error' && `API 调用失败：${health.message}`}
          </strong>
        </div>

        <pre style={styles.code} data-testid="health-payload">
          {health.status === 'ok'
            ? JSON.stringify(health.data, null, 2)
            : health.status === 'error'
              ? health.message
              : 'loading…'}
        </pre>

        <p style={{ ...styles.subtitle, margin: '0 0 8px' }}>
          <strong>接下来</strong>
        </p>
        <ol style={styles.list}>
          <li>三栏布局：需求输入 / 课件预览 / 证据面板（选择理由、trace、验证报告）</li>
          <li>Skill 注册表与 4 个 manifest</li>
          <li>打分路由：单用 / 组合 / 冲突降级 / 无匹配</li>
        </ol>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
