import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { readBugMode, setRegistryBug } from './bug-mode';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('缺少 #root 挂载点');
}

// 必须在首次渲染前生效，否则第一帧还是正常的，L3 会给出错误的结论
setRegistryBug(readBugMode(window.location.search));

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
