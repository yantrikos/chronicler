// A reply with no text must become an explanation, never silence; and thinking must be turned off the way each backend needs.
// Run: npx tsx tests/provider-empty-reply.test.ts

import { OllamaProvider, OpenAICompatProvider } from "../src/lib/providers";
import { setLimitOverrides } from "../src/lib/limits";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
const realFetch = globalThis.fetch;
let sent: Record<string, unknown> = {};
/** Every proxy call answers 200 with this body, and remembers the request it was sent. */
function stub(body: string): void {
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    sent = (JSON.parse(init?.body ?? "{}") as { body?: Record<string, unknown> }).body ?? {};
    return new Response(body, { status: 200 });
  }) as typeof fetch;
}
const nd = (...objs: object[]) => objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
const sse = (...objs: Array<object | "[DONE]">) => objs.map((o) => `data: ${o === "[DONE]" ? o : JSON.stringify(o)}\n\n`).join("");
const REQ = { model: "qwen3.5:4b", system: "s", messages: [{ role: "user" as const, content: "hi" }], max_tokens: 1024 };
async function collect(it: AsyncIterable<string>): Promise<{ text: string; error?: string }> {
  let text = "";
  try {
    for await (const c of it) text += c;
  } catch (e) {
    return { text, error: e instanceof Error ? e.message : String(e) };
  }
  return { text };
}

async function main(): Promise<void> {
  console.log("--- Ollama stream: the failure seen on a real qwen3.5:4b with thinking left on ---");
  stub(nd({ message: { thinking: "Let me think about how Ren would respond… ".repeat(80) } }, { message: { thinking: "more reasoning" } }, { done: true, done_reason: "length", eval_count: 1024 }));
  const a = await collect(new OllamaProvider("http://h:11434", "Ollama (local)").stream(REQ));
  check(a.text === "" && !!a.error && a.error.includes("spent its whole reply budget (1024 tokens) thinking") && a.error.includes("Turn thinking off"), "all tokens spent thinking -> says so and how to fix it (used to be silent)");

  stub(nd({ message: { content: "*Ren looks up.* " } }, { message: { content: "Welcome in." } }, { done: true, done_reason: "stop" }));
  const ok = await collect(new OllamaProvider("http://h:11434", "Ollama (local)").stream(REQ));
  check(ok.text === "*Ren looks up.* Welcome in." && !ok.error, "a normal reply is untouched");

  stub(nd({ message: { thinking: "hmm" } }));
  const cut = await collect(new OllamaProvider("http://h:11434", "Ollama (local)").stream(REQ));
  check(!!cut.error && /whole reply budget|hidden reasoning|timed out or dropped/.test(cut.error), "a stream cut off while thinking is reported, not swallowed");
  stub("");
  const nothing = await collect(new OllamaProvider("http://h:11434", "Ollama (local)").stream(REQ));
  check(!!nothing.error && nothing.error.includes("timed out or dropped"), "a stream that ends with nothing at all says it timed out or dropped");
  stub(nd({ message: { content: "partial" } }));
  const partial = await collect(new OllamaProvider("http://h:11434", "Ollama (local)").stream(REQ));
  check(partial.text === "partial" && !partial.error, "a cut-off reply that already has text is kept, not thrown away");

  console.log("--- Ollama request: think value ---");
  stub(nd({ message: { content: "x" } }, { done: true, done_reason: "stop" }));
  await collect(new OllamaProvider("http://h:11434", "Ollama", true).stream(REQ));
  check(sent.think === false, "thinking off -> think:false for Qwen and most models");
  await collect(new OllamaProvider("http://h:11434", "Ollama", true).stream({ ...REQ, model: "gpt-oss:20b" }));
  check(sent.think === "low", "thinking off on gpt-oss -> its lowest level (it ignores false)");
  await collect(new OllamaProvider("http://h:11434", "Ollama", false).stream(REQ));
  check(!("think" in sent), "thinking left on -> nothing is sent");

  console.log("--- limits reach the request ---");
  stub(nd({ message: { content: "x" } }, { done: true, done_reason: "stop" }));
  const opts = () => sent.options as Record<string, unknown>;
  await collect(new OllamaProvider("http://h:11434", "Ollama", false, 8192).stream(REQ));
  check(opts().num_ctx === 8192, "a provider's context window is sent to Ollama as num_ctx");
  await collect(new OllamaProvider("http://h:11434", "Ollama", false).stream(REQ));
  check(!("num_ctx" in opts()), "with none set, num_ctx is left to the server (behaviour unchanged)");
  const noMax = { ...REQ } as Record<string, unknown>;
  delete noMax.max_tokens;
  await collect(new OllamaProvider("http://h:11434", "Ollama").stream(noMax as unknown as typeof REQ));
  check(opts().num_predict === 1024, "with no reply length set anywhere, the default (1024) is used");
  setLimitOverrides({ "reply.default_tokens": 333 });
  await collect(new OllamaProvider("http://h:11434", "Ollama").stream(noMax as unknown as typeof REQ));
  check(opts().num_predict === 333, "Settings → Advanced → reply length changes that default");
  await collect(new OllamaProvider("http://h:11434", "Ollama").stream({ ...REQ, max_tokens: 150 }));
  check(opts().num_predict === 150, "and a provider's own max reply tokens wins over it");
  setLimitOverrides(undefined);

  console.log("--- OpenAI-compatible (Ollama /v1, vLLM, llama.cpp…) ---");
  stub(sse({ choices: [{ delta: { reasoning: "thinking ".repeat(400) } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }, "[DONE]"));
  const b = await collect(new OpenAICompatProvider("http://h:11434/v1", "", "Ollama via /v1").stream(REQ));
  check(!!b.error && b.error.includes("spent its whole reply budget") , "reasoning-only SSE reply (Ollama /v1 with thinking on) -> explained");
  stub(sse({ choices: [{ delta: { content: "Hello there" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }, "[DONE]"));
  check((await collect(new OpenAICompatProvider("http://h:11434/v1", "", "x").stream(REQ))).text === "Hello there", "a normal SSE reply is untouched");

  await collect(new OpenAICompatProvider("http://host.docker.internal:11434/v1", "", "x", true).stream(REQ));
  check(sent.reasoning_effort === "none" && sent.think === false, "Ollama /v1 address + thinking off -> reasoning_effort:none (the only knob /v1 honours)");
  await collect(new OpenAICompatProvider("http://h:8000/v1", "", "x", true, "template_kwargs").stream(REQ));
  check(JSON.stringify(sent.chat_template_kwargs) === '{"enable_thinking":false}' && !("think" in sent) && !("reasoning_effort" in sent), "vLLM / llama.cpp style -> chat_template_kwargs only");
  await collect(new OpenAICompatProvider("https://api.openai.com/v1", "k", "OpenAI", false).stream(REQ));
  check(!("think" in sent) && !("reasoning_effort" in sent) && !("chat_template_kwargs" in sent), "thinking left alone -> no non-standard fields (real OpenAI rejects them)");
  await collect(new OpenAICompatProvider("http://h:8000/v1", "", "x", true, "none").stream(REQ));
  check(!("think" in sent) && !("reasoning_effort" in sent) && !("chat_template_kwargs" in sent), "an explicit 'none' style sends nothing");

  globalThis.fetch = realFetch;
  console.log("\n--- PASS: provider-empty-reply ---");
}
main().then(() => process.exit(0));
