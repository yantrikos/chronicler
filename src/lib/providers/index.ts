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
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** When role is "assistant" and the model emitted tool calls, the
   *  provider populates this. Reflected back in follow-up requests so
   *  the LLM has continuity. Format follows OpenAI's tool-calling spec. */
  tool_calls?: ChatToolCall[];
  /** When role is "tool", the id of the assistant's tool_call this
   *  message satisfies. */
  tool_call_id?: string;
  /** Optional metadata for tools — display name + provider id. The
   *  orchestrator stashes this here when re-injecting tool messages so
   *  the chat UI can render attribution. */
  tool_name?: string;
}

export interface ChatToolCall {
  id: string;
  /** Always "function" in OpenAI's spec. Reserved for future expansion. */
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments string per the OpenAI spec. */
    arguments: string;
  };
}

export interface ChatToolDef {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown; // JSON Schema
  };
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
  /** OpenAI-compatible tool definitions. When set, the provider sends
   *  them as the `tools` field. Most providers (OpenAI, Ollama,
   *  OpenRouter, nano-gpt, Anthropic-via-compat) honor this. */
  tools?: ChatToolDef[];
  /** Optional tool_choice — "auto" (default), "none", or a specific
   *  tool name. Reserved; defaults to "auto" when tools is set. */
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

export interface ChatResponse {
  content: string;
  /** Populated when the model emitted tool calls. Empty when the model
   *  produced a normal text reply. */
  tool_calls?: ChatToolCall[];
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
    // Serialize messages per the OpenAI chat-completions spec. Tool
    // messages need {role: "tool", content, tool_call_id}; assistant
    // messages may include {tool_calls: [...]} when reflecting prior
    // calls back so the model has continuity across loop iterations.
    const messages = req.messages.map((m) => {
      const base: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.tool_calls && m.tool_calls.length > 0) base.tool_calls = m.tool_calls;
      if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
      return base;
    });
    return {
      model: req.model,
      messages: [
        { role: "system" as const, content: req.system },
        ...messages,
      ],
      temperature: s.temperature ?? req.temperature ?? 0.9,
      top_p: s.top_p,
      max_tokens: req.max_tokens ?? 1024,
      ...(streaming ? { stream: true } : {}),
      // OpenAI-style tool calling. Most providers (OpenAI, Ollama,
      // OpenRouter, nano-gpt, Anthropic-via-compat) honor this; ones
      // that don't ignore the field and the model produces a normal
      // text reply.
      ...(req.tools && req.tools.length > 0
        ? { tools: req.tools, tool_choice: req.tool_choice ?? "auto" }
        : {}),
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
    // Reasoning models (deepseek-r1, gpt-5 thinking, etc) sometimes put the
    // final answer in `reasoning` instead of `content` when the reasoning
    // budget consumes the whole output token cap (finish_reason="length").
    // Fall back to reasoning when content is empty so JSON-emitting
    // verifiers don't silently get "".
    const msg = data?.choices?.[0]?.message ?? {};
    const content: string =
      (typeof msg.content === "string" && msg.content.length > 0)
        ? msg.content
        : (typeof msg.reasoning === "string" ? msg.reasoning : "");
    // Parse OpenAI-format tool_calls when present. Models that don't
    // emit tool calls omit the field; we leave it undefined so callers
    // can `if (resp.tool_calls?.length)` cleanly.
    let tool_calls: ChatToolCall[] | undefined;
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      tool_calls = msg.tool_calls
        .filter((tc: unknown): tc is Record<string, unknown> => !!tc && typeof tc === "object")
        .map((tc: Record<string, unknown>) => {
          const fn = (tc.function ?? {}) as Record<string, unknown>;
          return {
            id: String(tc.id ?? crypto.randomUUID()),
            type: "function" as const,
            function: {
              name: String(fn.name ?? ""),
              arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
            },
          };
        })
        .filter((tc: ChatToolCall) => tc.function.name.length > 0);
    }
    return {
      content,
      tool_calls,
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

// --- Google Gemini ---
//
// Gemini's native API has its own request body shape — `contents` instead
// of `messages`, `parts[]` for content blocks, `systemInstruction` as a
// separate top-level field, and `generationConfig` for sampling controls.
// Streaming uses the same /streamGenerateContent endpoint with
// alt=sse to get SSE framing. Models accept `temperature`, `topP`, `topK`,
// `maxOutputTokens` and ignore `min_p` / `repetition_penalty`.

export class GeminiProvider implements LlmProvider {
  name = "gemini";
  constructor(
    private apiKey: string,
    private baseUrl = "https://generativelanguage.googleapis.com/v1beta"
  ) {}

  private buildBody(req: ChatRequest) {
    const s = req.sampling ?? {};
    // Gemini wants user/model turns; map our assistant role to "model".
    const contents = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    return {
      contents,
      systemInstruction: req.system
        ? { parts: [{ text: req.system }] }
        : undefined,
      generationConfig: {
        temperature: s.temperature ?? req.temperature ?? 0.9,
        topP: s.top_p,
        topK: s.top_k,
        maxOutputTokens: req.max_tokens ?? 1024,
      },
    };
  }

  private endpoint(model: string, streaming: boolean): string {
    const action = streaming ? "streamGenerateContent" : "generateContent";
    // API key goes in a query param; alt=sse on streaming makes it use SSE
    // framing instead of one giant JSON array.
    const qs = streaming
      ? `?alt=sse&key=${encodeURIComponent(this.apiKey)}`
      : `?key=${encodeURIComponent(this.apiKey)}`;
    return `${this.baseUrl}/models/${encodeURIComponent(model)}:${action}${qs}`;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await proxyFetch({
      target_url: this.endpoint(req.model, false),
      headers: { "content-type": "application/json" },
      body: this.buildBody(req),
    });
    if (!res.ok) {
      throw new Error(`gemini chat failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const content = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? "")
      .join("");
    return {
      content,
      usage: data?.usageMetadata
        ? {
            prompt_tokens: data.usageMetadata.promptTokenCount ?? 0,
            completion_tokens: data.usageMetadata.candidatesTokenCount ?? 0,
          }
        : undefined,
    };
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const res = await proxyFetch({
      target_url: this.endpoint(req.model, true),
      headers: { "content-type": "application/json" },
      body: this.buildBody(req),
    });
    if (!res.ok || !res.body) {
      throw new Error(`gemini stream failed: ${res.status}`);
    }
    yield* parseSseDeltas(res.body, (obj) => {
      const o = obj as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const parts = o?.candidates?.[0]?.content?.parts ?? [];
      const txt = parts.map((p) => p.text ?? "").join("");
      return txt || undefined;
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
