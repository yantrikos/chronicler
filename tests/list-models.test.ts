// Model lists for Ollama, OpenAI-compatible servers (vLLM, llama.cpp/Vulkan, LM Studio…), Anthropic and Gemini.
// Run: npx tsx tests/list-models.test.ts

import { listModels, modelListRequest, parseModelList } from "../src/lib/providers/list-models";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
const realFetch = globalThis.fetch;
let sent: { target_url?: string; method?: string; headers?: Record<string, string> } = {};
function stub(status: number, body: unknown): void {
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    sent = JSON.parse(init?.body ?? "{}");
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

async function main(): Promise<void> {
  console.log("--- parseModelList ---");
  const ollama = parseModelList("ollama", { models: [{ name: "qwen3.8:latest", size: 17.7e9 }, { name: "x/z-image-turbo:latest" }, { name: "nomic-embed-text" }, { name: "qwen3.5:4b", size: 3.4e9 }, { name: "qwen3.5:4b" }] });
  check(ollama.map((m) => m.id).join(",") === "qwen3.5:4b,qwen3.8:latest", "Ollama: image/embedding models dropped, duplicates removed, sorted");
  check(ollama.find((m) => m.id === "qwen3.8:latest")?.note === "17.7 GB", "Ollama: the size is shown next to the model");
  check(parseModelList("openai-compat", { data: [{ id: "Qwen/Qwen3-8B" }, { id: "meta-llama/Llama-3.1-8B-Instruct" }, { object: "x" }] }).map((m) => m.id).join(",") === "meta-llama/Llama-3.1-8B-Instruct,Qwen/Qwen3-8B", "OpenAI-compatible (vLLM / llama.cpp / LM Studio): reads data[].id, skips junk, sorts case-insensitively");
  check(parseModelList("anthropic", { data: [{ id: "claude-sonnet-4-6" }] })[0].id === "claude-sonnet-4-6", "Anthropic: reads data[].id");
  const gem = parseModelList("gemini", { models: [{ name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] }] });
  check(gem.length === 1 && gem[0].id === "gemini-2.0-flash", "Gemini: strips 'models/' and keeps only models that can generate text");
  check(parseModelList("ollama", null).length === 0 && parseModelList("openai-compat", {}).length === 0, "garbage in -> empty list, no crash");

  console.log("--- modelListRequest ---");
  check(modelListRequest("ollama", "http://h:11434/v1", "")?.url === "http://h:11434/api/tags", "Ollama: the /v1 suffix is normalised to the host root");
  check(modelListRequest("openai-compat", "http://localhost:8000/v1/", "k")?.url === "http://localhost:8000/v1/models" && modelListRequest("openai-compat", "http://localhost:8000/v1", "k")?.headers.authorization === "Bearer k", "OpenAI-compatible: {base}/models with the bearer key");
  check(modelListRequest("openai-compat", "http://localhost:8080/v1", "")?.headers.authorization === undefined, "a local server with no key sends no auth header");
  check(modelListRequest("anthropic", "", "sk-a")?.headers["x-api-key"] === "sk-a", "Anthropic: x-api-key + version header");
  check(modelListRequest("openai-compat", "", "") === null && modelListRequest("ollama", "nonsense", "") === null, "no usable address -> no request");

  console.log("--- listModels (stubbed proxy) ---");
  stub(200, { models: [{ name: "qwen3.5:4b" }] });
  const ok = await listModels("ollama", "http://host.docker.internal:11434", "");
  check(ok.ok && ok.models[0].id === "qwen3.5:4b" && sent.target_url === "http://host.docker.internal:11434/api/tags" && sent.method === "GET", "a GET of /api/tags through the proxy");
  stub(401, { error: { message: "Incorrect API key provided" } });
  const bad = await listModels("openai-compat", "https://api.openai.com/v1", "nope");
  check(!bad.ok && bad.reason.includes("API key in Settings"), "a rejected key is explained");
  stub(502, { error: "llm upstream unreachable: fetch failed" });
  const down = await listModels("openai-compat", "http://localhost:8000/v1", "");
  check(!down.ok && down.reason.includes("Couldn't reach"), "an unreachable server is explained");
  stub(200, "not json");
  check(!(await listModels("ollama", "http://h:11434", "")).ok, "a non-JSON reply is a failure, not a crash");
  check(!(await listModels("openai-compat", "", "")).ok, "no address gives a hint, not a request");

  globalThis.fetch = realFetch;
  console.log("\n--- PASS: list-models ---");
}
main().then(() => process.exit(0));
