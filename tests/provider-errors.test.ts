// Provider failures must say why, in words a person can act on.
// Run: npx tsx tests/provider-errors.test.ts

import { extractErrorDetail, friendlyProviderError, providerHttpError } from "../src/lib/providers/errors";
import { AnthropicProvider, GeminiProvider, OllamaProvider, OpenAICompatProvider } from "../src/lib/providers";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const realFetch = globalThis.fetch;
/** Every call to the proxy answers with this status and body. */
function stub(status: number, body: string): void {
  globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
}
async function msgOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "(did not throw)";
}
const REQ = { model: "qwen3:4b", system: "s", messages: [{ role: "user" as const, content: "hi" }] };
const drain = async (it: AsyncIterable<string>) => {
  for await (const _ of it) void _;
};

async function main(): Promise<void> {
  console.log("--- extractErrorDetail ---");
  check(extractErrorDetail(`{"error":"model 'qwen3:4b' not found"}`) === "model 'qwen3:4b' not found", "Ollama's {error:string} is read");
  check(extractErrorDetail(`{"error":{"message":"Incorrect API key provided","type":"x"}}`) === "Incorrect API key provided", "OpenAI/Anthropic/Gemini {error:{message}} is read");
  check(extractErrorDetail(`{"message":"Quota exceeded"}`) === "Quota exceeded", "a bare {message} is read");
  check(extractErrorDetail("plain   text\nerror") === "plain text error", "plain text is collapsed to one line");
  check(extractErrorDetail("") === "" && extractErrorDetail("   ") === "", "an empty body gives no detail");
  check(extractErrorDetail("x".repeat(1000)).length <= 240, "a huge body (e.g. an HTML error page) is truncated");

  console.log("--- friendlyProviderError ---");
  const nf = friendlyProviderError({ label: "Ollama (local)", status: 404, detail: "model 'qwen3:4b' not found", model: "qwen3:4b" });
  check(nf.includes('ollama pull qwen3:4b') && nf.includes("HTTP 404: model 'qwen3:4b' not found"), "a missing model says how to get it and keeps the raw reason");
  const un = friendlyProviderError({ label: "Ollama (local)", status: 502, detail: "llm upstream unreachable: fetch failed", baseUrl: "http://host.docker.internal:11434" });
  check(un.includes("Couldn't reach Ollama (local) at http://host.docker.internal:11434") && un.includes("OLLAMA_HOST=0.0.0.0"), "an unreachable server names the address and the Docker/Linux fix");
  check(friendlyProviderError({ label: "OpenAI", status: 401, detail: "Incorrect API key" }).includes("API key in Settings"), "401 points at the API key");
  check(friendlyProviderError({ label: "OpenAI", status: 429, detail: "" }).includes("rate-limiting"), "429 says rate limit / quota");
  check(friendlyProviderError({ label: "X", status: 503, detail: "overloaded" }).includes("server error"), "5xx says it is the service's side");
  check(friendlyProviderError({ label: "X", status: 404, detail: "" }).includes("address"), "a bare 404 suggests checking the address and model");
  check(friendlyProviderError({ label: "X", status: 418, detail: "teapot" }) === "X failed (HTTP 418: teapot)", "an unknown status still reports status and reason, with no made-up advice");

  console.log("--- providerHttpError ---");
  check((await providerHttpError("L", { status: 500, text: async () => { throw new Error("broken body"); } })).message.includes("HTTP 500"), "an unreadable body never throws; the status is still reported");
  check((await providerHttpError("L", { status: 500, text: async () => "y".repeat(50000) })).message.length < 1200, "a huge body is bounded");

  console.log("--- through the real provider classes (stubbed proxy) ---");
  stub(404, `{"error":"model 'qwen3:4b' not found"}`);
  const ollamaStream = await msgOf(() => drain(new OllamaProvider("http://host.docker.internal:11434", "Ollama (local)").stream(REQ)));
  check(ollamaStream.includes("ollama pull qwen3:4b") && !/^Ollama \(local\) stream failed: 404$/.test(ollamaStream), "Ollama STREAMING 404 (the path chat uses) now explains the missing model");
  const ollamaChat = await msgOf(() => new OllamaProvider("http://h:11434", "Ollama (local)").chat(REQ));
  check(ollamaChat.includes("ollama pull qwen3:4b"), "Ollama non-streaming 404 explains it too");

  stub(502, `{"error":"llm upstream unreachable: fetch failed"}`);
  const unreachable = await msgOf(() => drain(new OllamaProvider("http://host.docker.internal:11434", "Ollama (local)").stream(REQ)));
  check(unreachable.includes("Couldn't reach") && unreachable.includes("http://host.docker.internal:11434"), "an unreachable Ollama names the address that failed");

  stub(401, `{"error":{"message":"Incorrect API key provided: sk-***"}}`);
  const oai = await msgOf(() => drain(new OpenAICompatProvider("https://api.openai.com/v1", "sk-x", "OpenAI").stream({ ...REQ, model: "gpt-4o-mini" })));
  check(oai.includes("API key in Settings") && oai.includes("Incorrect API key provided"), "OpenAI-compatible 401 points at the key and keeps OpenAI's own words");
  stub(429, `{"error":{"message":"rate limited"}}`);
  check((await msgOf(() => drain(new AnthropicProvider("k").stream({ ...REQ, model: "claude-sonnet-4-6" })))).includes("rate-limiting"), "Anthropic streaming 429 is explained");
  stub(403, `{"error":{"message":"API key not valid"}}`);
  check((await msgOf(() => new GeminiProvider("k").chat({ ...REQ, model: "gemini-2.0-flash" }))).includes("API key in Settings"), "Gemini 403 is explained");

  stub(200, JSON.stringify({ choices: [{ message: { content: "hello there" } }] }));
  const ok = await new OpenAICompatProvider("https://x/v1", "k", "OpenAI").chat(REQ);
  check(ok.content === "hello there", "a successful call is unaffected");

  globalThis.fetch = realFetch;
  console.log("\n--- PASS: provider-errors ---");
}
main().then(() => process.exit(0));
