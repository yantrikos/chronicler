// LLM provider adapter. OpenAI-compatible (covers OpenAI / Ollama / OpenRouter
// / vLLM / llama.cpp server / nano-gpt) + Anthropic native.
//
// Every LLM call flows through the server-side proxy at /api/llm. Reasons:
//   - Browsers can't talk directly to Anthropic / most hosted providers (CORS)
//   - API keys are carried in the proxy request body, which stays on localhost
//   - One code path for all deployments — direct dev + prod docker identical
//
// The server translates { target_url, method, headers, body } into a real
// upstream call and streams the response back (SSE passes through).

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface SamplingOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  sampling?: SamplingOptions;
}

export interface ChatResponse {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface LlmProvider {
  name: string;
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream?(req: ChatRequest): AsyncIterable<string>;
}

export async function collectStream(
  provider: LlmProvider,
  req: ChatRequest
): Promise<ChatResponse> {
  if (!provider.stream) return provider.chat(req);
  let content = "";
  for await (const chunk of provider.stream(req)) content += chunk;
  return { content };
}

// --- Proxy fetch ---
//
// In the browser, the relative path /api/llm resolves against window origin
// (same-origin proxy). In Node (tests, drivers) we need an absolute URL —
// read it from CHRONICLER_PROXY_URL env var.

function resolveProxyEndpoint(): string {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
  };
  const fromEnv = g.process?.env?.CHRONICLER_PROXY_URL;
  if (fromEnv) return fromEnv;
  return "/api/llm";
}

const PROXY_ENDPOINT = resolveProxyEndpoint();

interface ProxyFetchOpts {
  target_url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

async function proxyFetch(opts: ProxyFetchOpts): Promise<Response> {
  return fetch(PROXY_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target_url: opts.target_url,
      method: opts.method ?? "POST",
      headers: opts.headers ?? {},
      body: opts.body,
    }),
  });
}

// --- OpenAI-compatible ---

export class OpenAICompatProvider implements LlmProvider {
  name = "openai-compat";
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private label = "openai-compat",
    private disableThinking = false
  ) {
    this.name = label;
  }

  private buildBody(req: ChatRequest, streaming: boolean) {
    const s = req.sampling ?? {};
    return {
      model: req.model,
      messages: [
        { role: "system" as const, content: req.system },
        ...req.messages,
      ],
      temperature: s.temperature ?? req.temperature ?? 0.9,
      top_p: s.top_p,
      max_tokens: req.max_tokens ?? 1024,
      ...(streaming ? { stream: true } : {}),
      // Ollama + Qwen3 respect `think: false` to skip the reasoning phase.
      // Ignored by providers that don't know about it.
      ...(this.disableThinking ? { think: false } : {}),
    };
  }

  private buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await proxyFetch({
      target_url: `${this.baseUrl}/chat/completions`,
      headers: this.buildHeaders(),
      body: this.buildBody(req, false),
    });
    if (!res.ok) {
      throw new Error(
        `${this.label} chat failed: ${res.status} ${await res.text()}`
      );
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    return {
      content,
      usage: data?.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const res = await proxyFetch({
      target_url: `${this.baseUrl}/chat/completions`,
      headers: this.buildHeaders(),
      body: this.buildBody(req, true),
    });
    if (!res.ok || !res.body) {
      throw new Error(`${this.label} stream failed: ${res.status}`);
    }
    yield* parseSseDeltas(res.body, (obj) => {
      const o = obj as { choices?: Array<{ delta?: { content?: string } }> };
      return o?.choices?.[0]?.delta?.content;
    });
  }
}

// --- Ollama (native /api/chat) ---
//
// Ollama's OpenAI-compat endpoint silently drops unknown fields including
// `think: false`. To actually skip thinking on Qwen3 and similar models, we
// have to hit /api/chat directly. This provider speaks that flavor.

export class OllamaProvider implements LlmProvider {
  name = "ollama";
  constructor(
    private baseUrl: string,
    private label = "ollama",
    private disableThinking = false
  ) {
    this.name = label;
  }

  private apiUrl(): string {
    // Accept base_url that ends in /v1 (user pasted openai-compat URL) and
    // normalize to the Ollama host root. Chat endpoint is /api/chat.
    return this.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "") + "/api/chat";
  }

  private buildBody(req: ChatRequest, streaming: boolean) {
    const s = req.sampling ?? {};
    return {
      model: req.model,
      messages: [
        { role: "system" as const, content: req.system },
        ...req.messages,
      ],
      stream: streaming,
      ...(this.disableThinking ? { think: false } : {}),
      options: {
        temperature: s.temperature ?? req.temperature ?? 0.9,
        top_p: s.top_p,
        top_k: s.top_k,
        min_p: s.min_p,
        repeat_penalty: s.repetition_penalty,
        num_predict: req.max_tokens ?? 1024,
      },
    };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await proxyFetch({
      target_url: this.apiUrl(),
      headers: { "content-type": "application/json" },
      body: this.buildBody(req, false),
    });
    if (!res.ok) {
      throw new Error(
        `${this.label} chat failed: ${res.status} ${await res.text()}`
      );
    }
    const data = await res.json();
    const content = data?.message?.content ?? "";
    return {
      content,
      usage:
        data?.prompt_eval_count !== undefined
          ? {
              prompt_tokens: data.prompt_eval_count,
              completion_tokens: data.eval_count ?? 0,
            }
          : undefined,
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const res = await proxyFetch({
      target_url: this.apiUrl(),
      headers: { "content-type": "application/json" },
      body: this.buildBody(req, true),
    });
    if (!res.ok || !res.body) {
      throw new Error(`${this.label} stream failed: ${res.status}`);
    }
    // Ollama streams newline-delimited JSON, not SSE `data:` framing.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          const chunk = obj?.message?.content;
          if (chunk) yield chunk;
        } catch {
          // skip malformed line
        }
      }
    }
  }
}

// --- Anthropic ---

export class AnthropicProvider implements LlmProvider {
  name = "anthropic";
  constructor(
    private apiKey: string,
    private apiUrl = "https://api.anthropic.com"
  ) {}

  private buildBody(req: ChatRequest, streaming: boolean) {
    const s = req.sampling ?? {};
    return {
      model: req.model,
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: req.max_tokens ?? 1024,
      temperature: s.temperature ?? req.temperature ?? 0.9,
      top_p: s.top_p,
      top_k: s.top_k,
      ...(streaming ? { stream: true } : {}),
    };
  }

  private buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await proxyFetch({
      target_url: `${this.apiUrl}/v1/messages`,
      headers: this.buildHeaders(),
      body: this.buildBody(req, false),
    });
    if (!res.ok) {
      throw new Error(
        `anthropic chat failed: ${res.status} ${await res.text()}`
      );
    }
    const data = await res.json();
    const content = (data?.content ?? [])
      .filter((b: { type?: string }) => b.type === "text")
      .map((b: { text?: string }) => b.text ?? "")
      .join("");
    return {
      content,
      usage: data?.usage
        ? {
            prompt_tokens: data.usage.input_tokens,
            completion_tokens: data.usage.output_tokens,
          }
        : undefined,
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const res = await proxyFetch({
      target_url: `${this.apiUrl}/v1/messages`,
      headers: this.buildHeaders(),
      body: this.buildBody(req, true),
    });
    if (!res.ok || !res.body) {
      throw new Error(`anthropic stream failed: ${res.status}`);
    }
    yield* parseSseDeltas(res.body, (obj) => {
      const o = obj as { type?: string; delta?: { text?: string } };
      if (o?.type === "content_block_delta" && o?.delta?.text)
        return o.delta.text;
      return undefined;
    });
  }
}

// --- Shared SSE parser ---

async function* parseSseDeltas(
  body: ReadableStream<Uint8Array>,
  extract: (obj: unknown) => string | undefined
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload);
        const chunk = extract(obj);
        if (chunk) yield chunk;
      } catch {
        // skip malformed line
      }
    }
  }
}

// --- Factory ---

export interface ProviderConfig {
  kind: "openai-compat" | "anthropic";
  label?: string;
  base_url?: string;
  api_key: string;
  disable_thinking?: boolean;
}

export function makeProvider(cfg: ProviderConfig): LlmProvider {
  if (cfg.kind === "anthropic") return new AnthropicProvider(cfg.api_key);
  return new OpenAICompatProvider(
    cfg.base_url ?? "https://api.openai.com/v1",
    cfg.api_key,
    cfg.label ?? "openai-compat",
    cfg.disable_thinking ?? false
  );
}
