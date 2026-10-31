// Each provider family has its own rules about what a request may contain, and they change by model. These tests run the
// real provider classes against strict fake APIs that enforce those rules with the error messages the APIs document,
// and check that Chronicler works out the rules, succeeds, and remembers them (including in a new session).
// Run: npx tsx tests/provider-compat.test.ts

import { GeminiProvider, OllamaProvider, OpenAICompatProvider } from "../src/lib/providers";
import { forgetCompat } from "../src/lib/providers/compat";
import type { ChatMessage, ChatRequest } from "../src/lib/providers";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const realFetch = globalThis.fetch;
type Body = Record<string, unknown> & { messages?: Array<{ role: string; content: unknown }>; contents?: Array<{ role: string }> };
let calls: Body[] = [];
/** Replace the network with a strict fake: `rules(body)` returns an error string to refuse with (400) or null to accept. */
function fake(rules: (b: Body) => string | null, okBody: unknown, opts: { sse?: string } = {}): void {
  calls = [];
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    const payload = JSON.parse(init?.body ?? "{}") as { body?: Body };
    const b = payload.body ?? {};
    calls.push(b);
    const err = rules(b);
    if (err) return new Response(JSON.stringify({ error: { message: err } }), { status: 400 });
    return new Response(opts.sse ?? JSON.stringify(okBody), { status: 200 });
  }) as typeof fetch;
}
const u = (content: string): ChatMessage => ({ role: "user", content });
const a = (content: string): ChatMessage => ({ role: "assistant", content });
const REQ = (model: string, messages: ChatMessage[], extra: Partial<ChatRequest> = {}): ChatRequest => ({ model, system: "You are Ren.", messages, ...extra });
const OAI_OK = { choices: [{ message: { content: "Hello." } }] };
const sse = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
async function collect(it: AsyncIterable<string>): Promise<string> {
  let t = "";
  for await (const c of it) t += c;
  return t;
}

async function main(): Promise<void> {
  forgetCompat();

  console.log("--- OpenAI's reasoning models (gpt-5 / o-series style) ---");
  const reasoning = (b: Body): string | null => {
    if ("max_tokens" in b) return "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
    if ("temperature" in b) return "Unsupported value: 'temperature' does not support 0.9 with this model. Only the default (1) value is supported.";
    if ("top_p" in b) return "Unsupported parameter: 'top_p' is not supported with this model.";
    return null;
  };
  fake(reasoning, OAI_OK);
  const p = new OpenAICompatProvider("https://api.openai.com/v1", "sk-x", "OpenAI");
  const r1 = await p.chat(REQ("gpt-5-mini", [u("hi")], { sampling: { temperature: 0.9, top_p: 0.95 } }));
  const finalBody = calls[calls.length - 1];
  check(r1.content === "Hello." && "max_completion_tokens" in finalBody && !("max_tokens" in finalBody) && !("temperature" in finalBody) && !("top_p" in finalBody), `the first message succeeds: ${calls.length} tries, ending with max_completion_tokens and no temperature / top_p`);
  check(p.adaptations!("gpt-5-mini").join(" | ").includes("max_completion_tokens") && p.adaptations!("gpt-5-mini").join(" | ").includes("temperature"), "Settings can describe what was adapted, in words");
  calls = [];
  await p.chat(REQ("gpt-5-mini", [u("again")], { sampling: { temperature: 0.9 } }));
  check(calls.length === 1, "the next message is right the first time");
  calls = [];
  const p2 = new OpenAICompatProvider("https://api.openai.com/v1", "sk-x", "OpenAI");
  await p2.chat(REQ("gpt-5-mini", [u("new session")]));
  check(calls.length === 1, "a NEW provider instance (a new session) also remembers, because it is stored per model");
  calls = [];
  fake((b) => ("max_tokens" in b ? null : "this model uses max_tokens"), OAI_OK);
  await new OpenAICompatProvider("https://api.openai.com/v1", "sk-x", "OpenAI").chat(REQ("gpt-4o-mini", [u("hi")], { sampling: { temperature: 0.7 } }));
  check(calls.length === 1 && calls[0].temperature === 0.7 && "max_tokens" in calls[0], "a different model is unaffected: it still gets temperature and max_tokens");
  fake(reasoning, OAI_OK, { sse: sse("Streamed.") });
  forgetCompat();
  check((await collect(new OpenAICompatProvider("https://api.openai.com/v1", "k", "OpenAI").stream(REQ("o4-mini", [u("hi")], { sampling: { temperature: 0.9 } })))) === "Streamed.", "streaming adapts the same way");

  console.log("--- Mistral-style strict roles ---");
  forgetCompat();
  const strict = (b: Body): string | null => {
    const m = b.messages ?? [];
    for (let i = 1; i < m.length; i++) if (m[i].role === "system") return "Unexpected role 'system' after role 'assistant'";
    const nonSystem = m.filter((x) => x.role !== "system");
    if (nonSystem[nonSystem.length - 1]?.role !== "user") return "Expected last role User or Tool (or Assistant with prefix True) for serving but got assistant";
    return null;
  };
  fake(strict, OAI_OK);
  const m1 = new OpenAICompatProvider("https://api.mistral.ai/v1", "k", "Mistral");
  const hist = [a("*Ren waves.*"), u("hi"), a("hello"), { role: "system" as const, content: "Steering note: keep it tense." }, u("go on"), a("ok")];
  const mr = await m1.chat(REQ("mistral-large-latest", hist));
  const roles = (calls[calls.length - 1].messages ?? []).map((x) => x.role[0]).join("");
  check(mr.content === "Hello." && roles.startsWith("s") && roles.endsWith("u") && !roles.slice(1).includes("s"), `a conversation with a greeting, a mid-history note and a trailing assistant turn is accepted after adapting (${calls.length} tries, final roles ${roles})`);
  calls = [];
  await m1.chat(REQ("mistral-large-latest", hist));
  check(calls.length === 1, "and remembered");
  const kept = JSON.stringify(calls[0].messages);
  check(kept.includes("Steering note: keep it tense.") && kept.includes("Ren waves"), "nothing the player or character said is lost in the strict ordering");
  fake((b) => (b.messages?.[1]?.role === "system" ? "Unexpected role" : null), OAI_OK);
  forgetCompat();
  calls = [];
  await new OpenAICompatProvider("https://api.openai.com/v1", "k", "OpenAI").chat(REQ("gpt-4o", [u("hi"), a("hello"), { role: "system", content: "note" }, u("go")]));
  check(calls.length === 1 || calls.length === 2, "a server that accepts the plain ordering is never forced into the strict one");

  console.log("--- Gemini ---");
  forgetCompat();
  const gemini = (b: Body): string | null => {
    if (b.contents?.[0]?.role !== "user") return "Please ensure that multiturn requests start with a user turn.";
    const gc = (b.generationConfig ?? {}) as Record<string, unknown>;
    if ("topK" in gc) return 'Invalid JSON payload received. Unknown name "topK" at \'generation_config\': Cannot find field.';
    return null;
  };
  fake(gemini, { candidates: [{ content: { parts: [{ text: "Hi." }] } }] });
  const gp = new GeminiProvider("key");
  const gr = await gp.chat(REQ("gemini-2.5-flash", [a("*Ren waves.*"), u("hi")], { sampling: { temperature: 0.8, top_k: 40 } }));
  const gb = calls[calls.length - 1];
  check(gr.content === "Hi." && gb.contents?.[0]?.role === "user", "a chat that starts with the character's greeting is accepted (a user opener goes first)");
  check(!("topK" in ((gb.generationConfig ?? {}) as Record<string, unknown>)) && "temperature" in ((gb.generationConfig ?? {}) as Record<string, unknown>), "a refused topK is left out while temperature is kept");
  calls = [];
  await gp.chat(REQ("gemini-2.5-flash", [u("again")], { sampling: { temperature: 0.8, top_k: 40 } }));
  check(calls.length === 1, "and remembered");

  console.log("--- Ollama: an older build that does not know `think` ---");
  forgetCompat();
  fake((b) => ("think" in b ? 'json: unknown field "think"' : null), { message: { content: "ok" } });
  const op = new OllamaProvider("http://h:11434", "Ollama", true);
  const orr = await op.chat(REQ("llama3", [u("hi")]));
  check(orr.content === "ok" && !("think" in calls[calls.length - 1]), `an old Ollama that refuses \`think\` still works (${calls.length} tries)`);

  console.log("--- things that must NOT be 'adapted' ---");
  forgetCompat();
  fake(() => "Incorrect API key provided: sk-***", OAI_OK);
  let err = "";
  try {
    await new OpenAICompatProvider("https://api.openai.com/v1", "bad", "OpenAI").chat(REQ("gpt-4o", [u("hi")], { sampling: { temperature: 0.7 } }));
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check(calls.length === 1 && /API key/.test(err), "a bad key is reported once, with no retries, and nothing is wrongly 'learned'");
  check(new OpenAICompatProvider("https://api.openai.com/v1", "bad", "OpenAI").adaptations!("gpt-4o").length === 0, "so nothing is dropped for that model");

  globalThis.fetch = realFetch;
  console.log("\n--- PASS: provider-compat ---");
}
main().then(() => process.exit(0));
