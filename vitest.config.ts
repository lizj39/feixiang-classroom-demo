import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 线程池代替默认的 fork 池：本项目的测试全是纯函数/契约校验，不需要进程级隔离，
    // 线程池启动更快，也不依赖子进程管道（某些受限环境下 fork 会直接 EPERM）。
    pool: 'threads',
    // .tsx 必须包含：组件测试要跑 DOM 断言，只匹配 .ts 会把它们静默跳过
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // 契约测试一旦挂了就不该继续跑后面的用例，避免误导性的「大部分通过」
    bail: 1,
  },
});
