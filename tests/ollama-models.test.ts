// First-run Ollama check: list installed models, say why when it fails.
// Run: npx tsx tests/ollama-models.test.ts

import { isInstalled, ollamaRoot, chatModels, paramBillions, pickModel, probeOllama, suggestChatModel } from "../src/lib/providers/ollama-models";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
const realFetch = globalThis.fetch;
let lastBody: { target_url?: string; method?: string } = {};
function stub(status: number, body: string): void {
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    lastBody = JSON.parse(init?.body ?? "{}");
    return new Response(body, { status });
  }) as typeof fetch;
}

async function main(): Promise<void> {
  console.log("--- ollamaRoot ---");
  check(ollamaRoot("http://h:11434/") === "http://h:11434" && ollamaRoot("http://h:11434/v1") === "http://h:11434" && ollamaRoot(" http://h:11434/v1/ ") === "http://h:11434", "trailing slash, /v1 and whitespace are normalised");

  console.log("--- probeOllama ---");
  stub(200, JSON.stringify({ models: [{ name: "qwen3.5:4b" }, { name: "gpt-oss:20b" }, { bad: 1 }] }));
  const ok = await probeOllama("http://host.docker.internal:11434/v1");
  check(ok.ok && ok.models.join(",") === "qwen3.5:4b,gpt-oss:20b", "installed model names are listed; malformed entries are skipped");
  check(lastBody.target_url === "http://host.docker.internal:11434/api/tags" && lastBody.method === "GET", "it asks /api/tags with GET through the proxy");
  stub(200, JSON.stringify({ models: [] }));
  const none = await probeOllama("http://h:11434");
  check(none.ok && none.models.length === 0, "an Ollama with no models is reported as connected with an empty list");
  stub(502, `{"error":"llm upstream unreachable: fetch failed"}`);
  const down = await probeOllama("http://host.docker.internal:11434");
  check(!down.ok && down.reason.includes("Couldn't reach") && down.reason.includes("host.docker.internal"), "an unreachable Ollama gives the Docker-aware explanation");
  check(!(await probeOllama("not a url")).ok && !(await probeOllama("")).ok, "a malformed address is rejected without a network call");
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  const offline = await probeOllama("http://h:11434");
  check(!offline.ok && offline.reason.includes("Failed to fetch"), "the Chronicler server itself being down is reported, not thrown");
  stub(200, "not json");
  check(!(await probeOllama("http://h:11434")).ok, "a non-JSON reply is a failure, not a crash");

  console.log("--- suggestChatModel / pickModel / isInstalled ---");
  check(paramBillions("qwen3.5:4b") === 4 && paramBillions("llama3:70b-instruct") === 70 && paramBillions("qwen3.5:0.8b") === 0.8 && paramBillions("yantrik:latest") === null, "parameter counts are read from the tag");
  const mine = ["qwen3.6:35b", "x/z-image-turbo:latest", "qwen2.5:1.5b", "qwen3.5:9b", "yantrik:latest", "qwen3.5:4b", "nomic-embed-text:latest"];
  check(suggestChatModel(mine) === "qwen3.5:4b", "from a real mixed list it suggests the smallest real chat model of at least 3B (not the 35B, not the image/embedding models, not the 1.5B)");
  check(suggestChatModel(["nomic-embed-text:latest", "x/z-image-turbo:latest"]) === null, "with only non-chat models it suggests nothing");
  check(suggestChatModel(["mystery:latest", "qwen2.5:1.5b"]) === null, "with no size it can trust, it does not guess");
  check(chatModels(mine).join(",") === "qwen3.6:35b,qwen2.5:1.5b,qwen3.5:9b,yantrik:latest,qwen3.5:4b" && !chatModels(mine).some((m) => /image|embed/.test(m)), "the choices offered exclude image and embedding models");
  check(pickModel("qwen3:4b", "qwen3:4b", mine, false) === "qwen3.5:4b", "the untouched, missing default becomes that suggestion");
  check(pickModel("qwen3:4b", "qwen3:4b", ["mystery:latest"], false) === "qwen3:4b", "with no clear suggestion the default stays (the wizard then lists what is installed)");
  check(pickModel("qwen3:4b", "qwen3:4b", [mine[3], "qwen3:4b"], false) === "qwen3:4b", "the default is kept when it is installed");
  check(pickModel("qwen3:4b", "qwen3:4b", [], false) === "qwen3:4b", "with nothing installed the default stays (so the pull hint names it)");
  check(pickModel("my-model", "qwen3:4b", mine, false) === "my-model" && pickModel("qwen3:4b", "qwen3:4b", mine, true) === "qwen3:4b", "a model the person typed or edited is never replaced");
  check(isInstalled("qwen3.5:4b", ["qwen3.5:4b"]) && isInstalled("llama3", ["llama3:latest"]) && !isInstalled("qwen3:4b", ["qwen3.5:4b"]) && !isInstalled("", ["a"]), "installed-ness handles :latest and exact tags");

  globalThis.fetch = realFetch;
  console.log("\n--- PASS: ollama-models ---");
}
main().then(() => process.exit(0));
