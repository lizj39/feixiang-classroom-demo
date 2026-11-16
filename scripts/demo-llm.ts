/**
 * 真实调用演示：用三句话验证 LLM 理解层。
 *
 * 刻意不进 `npm test`：那会让测试结果取决于模型当天状态与网络。
 * 这是一个**手动脚本**，需要真实 key，跑一次约 3 次调用。
 *
 *   npm run demo:llm
 *
 * 输出里不会出现 API key；报错只带状态码与响应片段。
 */

import { loadDotEnv } from '../src/server/env';
import { createRuleIntentParser } from '../src/server/intent/rule-parser';
import { createOpenAiCompatibleClient, readLlmConfig } from '../src/server/intent/llm/client';
import { createLlmIntentParser } from '../src/server/intent/llm/parser';
import { route } from '../src/server/router/route';
import { SKILL_MANIFESTS } from '../src/server/skills/manifests';
import { createSkillRegistry } from '../src/server/skills/registry';

const UTTERANCES = [
  '让学生自己调参数看看，画一条斜率是负二、截距是五的直线',
  '帮我出一道关于一次函数的练习题，让学生选答案',
  '帮我准备明天的班会',
];

async function main(): Promise<void> {
  loadDotEnv();

  const config = readLlmConfig(process.env);
  if (!config.enabled) {
    console.error('未配置 LLM_API_KEY。请在项目根目录创建 .env（参考 .env.example），然后重跑。');
    process.exitCode = 1;
    return;
  }

  console.log(`模型 ${config.model} @ ${config.baseUrl}\n`);

  const registry = createSkillRegistry(SKILL_MANIFESTS);
  const rule = createRuleIntentParser(registry);
  const llm = createLlmIntentParser({
    registry,
    client: createOpenAiCompatibleClient({
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey: config.apiKey,
    }),
    fallback: rule,
  });

  for (const utterance of UTTERANCES) {
    console.log('─'.repeat(60));
    console.log(`输入：${utterance}`);

    const outcome = await route(utterance, { registry, parser: llm, emit: () => {} });
    const { intent, plan } = outcome;

    console.log(`解析器：${intent.parser}${intent.degraded ? `（降级：${intent.degraded.reason}）` : ''}`);
    console.log(`词表证据：${intent.matchedTokens.join('、') || '（无）'}`);
    console.log(`模型能力：${intent.capabilities.join('、') || '（无）'}`);
    console.log(`参数：${JSON.stringify(intent.params)}`);
    if (intent.normalized) console.log(`标准化：${intent.normalized}`);
    if (intent.notes?.length) console.log(`提示：${intent.notes.join('；')}`);

    console.log(`决策：${plan.type} / ${plan.selected.join(' + ') || '未选中'}`);
    console.log(
      `得分：${plan.scores
        .map((item) => `${item.skill} ${item.score.toFixed(2)}`)
        .filter((line) => !line.endsWith('0.00'))
        .join('，') || '（全 0）'}`,
    );
    console.log(`理由：${plan.reason}`);
  }

  console.log('─'.repeat(60));
  console.log('完成。若某条出现「降级」，说明模型输出不合约定，规则版已接管。');
}

main().catch((error: unknown) => {
  console.error('演示失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
