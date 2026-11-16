/**
 * LLM 客户端：只做一件事 —— 把「system + user」变成一段文本。
 *
 * 刻意不引入 openai sdk：
 *   - 本项目只需要一个 `/v1/chat/completions` 调用，自己发 POST 更透明；
 *   - 整个网络层不到 40 行，评审时一眼能看完，不用担心 sdk 内部还做了什么。
 *
 * 换任何 OpenAI 兼容的服务（DeepSeek / Moonshot / 通义 / 本地 vLLM）只改配置。
 */

export interface LlmRequest {
  readonly system: string;
  readonly user: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<string>;
}

export interface LlmConfig {
  /** 是否具备真实调用条件。false 时整个 LLM 链路不参与，完全走规则版。 */
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export const DEFAULT_LLM_BASE_URL = 'https://api.deepseek.com';
/** V4.1 Flash 在 API 里的模型名就是 deepseek-flash。 */
export const DEFAULT_LLM_MODEL = 'deepseek-flash';

/** 只从环境变量读，绝不写死。没配 key 就是没启用。 */
export function readLlmConfig(env: NodeJS.ProcessEnv): LlmConfig {
  const apiKey = (env.LLM_API_KEY ?? '').trim();
  return {
    enabled: apiKey.length > 0,
    baseUrl: (env.LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL).trim(),
    model: (env.LLM_MODEL ?? DEFAULT_LLM_MODEL).trim(),
    apiKey,
  };
}

export interface OpenAiCompatibleOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  /** 便于测试注入；生产用全局 fetch。 */
  readonly fetchImpl?: typeof fetch;
  readonly maxTokens?: number;
}

/** `https://api.deepseek.com` 与 `.../v1` 两种写法都要能用。 */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
}

export function createOpenAiCompatibleClient(options: OpenAiCompatibleOptions): LlmClient {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async complete(request: LlmRequest): Promise<string> {
      const response = await doFetch(chatCompletionsUrl(options.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          // 只要 JSON，不要散文；temperature 0 让同一句话尽量给同一结果
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: options.maxTokens ?? 400,
        }),
      });

      if (!response.ok) {
        // 错误信息只带状态与响应体片段：绝不能把 Authorization 带进日志
        const detail = await response.text().catch(() => '');
        throw new Error(`LLM 请求失败 HTTP ${response.status}：${detail.slice(0, 200)}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('LLM 返回了空内容');
      }
      return content;
    },
  };
}
