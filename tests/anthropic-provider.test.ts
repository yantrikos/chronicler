// Claude must accept what Chronicler sends. Anthropic's Messages API is stricter than OpenAI-style APIs:
// the first message must be from the user, only "user" and "assistant" roles exist in `messages` (system is a
// top-level field), text blocks may not be empty, temperature is 0..1, and newer models reject temperature
// together with top_p. This test runs the message shapes the orchestrator really produces through the provider
// and validates the request against those rules. Run: npx tsx tests/anthropic-provider.test.ts

import { AnthropicProvider } from "../src/lib/providers";
import type { ChatMessage, ChatRequest } from "../src/lib/providers";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

type Body = { model?: string; system?: string; messages?: Array<{ role: string; content: unknown }>; max_tokens?: number; temperature?: number; top_p?: number; top_k?: number; stream?: boolean };

/** The rules of the Messages API that a request must satisfy; returns the first violation, or null. */
function violation(b: Body): string | null {
  const m = b.messages ?? [];
  if (m.length === 0) return "messages must not be empty";
  if (m[0].role !== "user") return `first message must use the "user" role (got "${m[0].role}")`;
  for (const [i, x] of m.entries()) {
    if (x.role !== "user" && x.role !== "assistant") return `messages.${i}.role must be "user" or "assistant" (got "${x.role}")`;
    const text = typeof x.content === "string" ? x.content : (x.content as Array<{ type: string; text?: string }>).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    const hasImage = Array.isArray(x.content) && (x.content as Array<{ type: string }>).some((c) => c.type === "image");
    if (!hasImage && text.trim() === "") return `messages.${i}: text content blocks must be non-empty`;
  }
  if (m[m.length - 1].role !== "user") return "the conversation must end with a user message (assistant prefill is not accepted by newer models)";
  if (typeof b.temperature === "number" && (b.temperature < 0 || b.temperature > 1)) return `temperature must be between 0 and 1 (got ${b.temperature})`;
  if (b.temperature !== undefined && b.top_p !== undefined) return "temperature and top_p cannot both be specified";
  if (!b.max_tokens || b.max_tokens < 1) return "max_tokens is required";
  return null;
}

const realFetch = globalThis.fetch;
let last: Body = {};
let calls = 0;
type Reply = { status: number; body: string };
/** A fake Anthropic that applies the rules above and answers like the real one (400 + error JSON on a violation). */
function strictAnthropic(opts: { rejectSampling?: boolean; sse?: string } = {}): void {
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    calls++;
    const payload = JSON.parse(init?.body ?? "{}") as { body?: Body; headers?: Record<string, string> };
    last = payload.body ?? {};
    if (!payload.headers?.["x-api-key"] || !payload.headers?.["anthropic-version"]) return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "x-api-key header is required" } }), { status: 401 });
    const v = violation(last);
    if (v) return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: v } }), { status: 400 });
    if (opts.rejectSampling && (last.temperature !== undefined || last.top_p !== undefined || last.top_k !== undefined)) return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "`temperature` is deprecated for this model." } }), { status: 400 });
    const r: Reply = opts.sse ? { status: 200, body: opts.sse } : { status: 200, body: JSON.stringify({ content: [{ type: "text", text: "Hello." }], usage: { input_tokens: 5, output_tokens: 2 } }) };
    return new Response(r.body, { status: r.status });
  }) as typeof fetch;
}

const sseText = (t: string) => `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: t } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
const ask = async (messages: ChatMessage[], extra: Partial<ChatRequest> = {}) => {
  try {
    const r = await new AnthropicProvider("sk-test").chat({ model: "claude-sonnet-5-5", system: "You are Ren.", messages, ...extra });
    return { ok: true as const, text: r.content };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
};
async function collect(it: AsyncIterable<string>): Promise<{ text: string; error?: string }> {
  let text = "";
  try {
    for await (const c of it) text += c;
  } catch (e) {
    return { text, error: e instanceof Error ? e.message : String(e) };
  }
  return { text };
}

const u = (content: string): ChatMessage => ({ role: "user", content });
const a = (content: string): ChatMessage => ({ role: "assistant", content });

async function main(): Promise<void> {
  strictAnthropic();

  console.log("--- the shapes a real chat produces ---");
  let r = await ask([a("*Ren looks up from the ledger.* Found something?"), u("Hi, I'm Sam.")]);
  check(r.ok, `a chat that starts with the character's greeting is accepted${r.ok ? "" : " — " + (r as { error: string }).error}`);
  strictAnthropic();
  r = await ask([u("hi"), a("hello"), { role: "system", content: "Steering note for this scene: keep it tense." }, u("go on")]);
  check(r.ok, `a depth-N author note (a system-role message in the history) is accepted${r.ok ? "" : " — " + (r as { error: string }).error}`);
  strictAnthropic();
  r = await ask([u("one"), u("two"), a("three"), a("four"), u("five")]);
  check(r.ok, `consecutive same-role turns are accepted${r.ok ? "" : " — " + (r as { error: string }).error}`);
  strictAnthropic();
  r = await ask([u("hi"), a(""), u("   "), u("real message")]);
  check(r.ok, `empty or whitespace-only turns do not poison the request${r.ok ? "" : " — " + (r as { error: string }).error}`);
  strictAnthropic();
  r = await ask([u("hi"), a("hello")]);
  check(r.ok, `a history that ends on the character (a "continue" request) is accepted${r.ok ? "" : " — " + (r as { error: string }).error}`);

  console.log("--- what is sent is faithful ---");
  strictAnthropic();
  await ask([a("*Ren looks up.* Found something?"), u("Hi, I'm Sam.")]);
  const msgs = last.messages ?? [];
  check(msgs[0]?.role === "user" && msgs.some((m) => m.role === "assistant" && String(m.content).includes("Found something?")), "the greeting is kept as the character's line (a short user opener is added in front, nothing is dropped)");
  check(msgs[msgs.length - 1]?.content === "Hi, I'm Sam.", "the player's real message is last and untouched");
  strictAnthropic();
  await ask([u("hi"), { role: "system", content: "Steering note: keep it tense." }, u("go on")]);
  check(JSON.stringify(last.messages).includes("Steering note: keep it tense."), "a steering note is not lost when it moves out of the system role");
  check((last.system ?? "") === "You are Ren.", "the character's system prompt stays in the top-level system field");

  console.log("--- sampling ---");
  strictAnthropic();
  r = await ask([u("hi")], { sampling: { temperature: 1.4, top_p: 0.92, top_k: 40 } });
  check(r.ok && last.temperature === 1 && last.top_p === undefined && last.top_k === 40, `temperature is clamped to Claude's 0..1, and top_p is not sent alongside it${r.ok ? "" : " — " + (r as { error: string }).error}`);
  strictAnthropic();
  r = await ask([u("hi")], { sampling: { top_p: 0.9 } });
  check(r.ok && last.top_p === 0.9 && last.temperature === undefined, "with only a top_p chosen, that is honoured on its own (Claude takes temperature OR top_p, never both)");
  strictAnthropic({ rejectSampling: true });
  calls = 0;
  const p = new AnthropicProvider("sk-test");
  const s1 = await p.chat({ model: "claude-future-1", system: "s", messages: [u("hi")], sampling: { temperature: 0.7 } }).then(() => "ok", (e) => String(e));
  check(s1 === "ok" && calls === 2 && last.temperature === undefined, "if a model refuses sampling parameters, the call is retried once without them instead of failing");
  const before = calls;
  await p.chat({ model: "claude-future-1", system: "s", messages: [u("again")] });
  check(calls === before + 1, "and the provider remembers, so later calls do not fail first");

  console.log("--- streaming ---");
  strictAnthropic({ sse: sseText("Well met.") });
  const st = await collect(new AnthropicProvider("sk-test").stream({ model: "claude-sonnet-5-5", system: "s", messages: [a("*Ren waves.*"), u("hi")] }));
  check(st.text === "Well met." && !st.error, "a streamed reply to a chat that starts with a greeting works");
  strictAnthropic({ sse: `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n` });
  const ov = await collect(new AnthropicProvider("sk-test").stream({ model: "claude-sonnet-5-5", system: "s", messages: [u("hi")] }));
  check(!!ov.error && /overloaded/i.test(ov.error), `an "overloaded" event mid-stream is reported by name, not as a vague empty reply${ov.error ? "" : " (it was silent)"}`);

  console.log("--- error wording ---");
  globalThis.fetch = (async () => new Response(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model: claude-sonnet-4-6" } }), { status: 404 })) as typeof fetch;
  const nf = await ask([u("hi")], { model: "claude-sonnet-4-6" });
  check(!nf.ok && !/ollama/i.test(nf.error) && /load models|Settings/.test(nf.error), `a wrong Claude model name never tells the user to run "ollama pull"${nf.ok ? "" : " — got: " + nf.error.slice(0, 120)}`);

  globalThis.fetch = realFetch;
  console.log("\n--- PASS: anthropic-provider ---");
}
main().then(() => process.exit(0));
