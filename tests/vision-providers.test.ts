// Vision plumbing — provider roles, capability detection, and per-provider
// image serialization. Run: npx tsx tests/vision-providers.test.ts

import { anthropicContent, geminiParts, openAIContent, type ChatMessage } from "../src/lib/providers";
import { providerForRole, type ChroniclerConfig, type ProviderConfigEntry } from "../src/lib/config";
import { detectVision } from "../src/lib/vision/capability";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const P = (id: string, extra: Partial<ProviderConfigEntry> = {}): ProviderConfigEntry => ({
  id, kind: "ollama", label: id, api_key: "", model: id, base_url: "http://o:11434", ...extra,
});
const cfg = (over: Partial<ChroniclerConfig>): ChroniclerConfig => ({
  yantrikdb: { kind: "memory" }, providers: [P("chat"), P("bg"), P("eyes", { supports_vision: true })],
  active_provider_id: "chat", ...over,
});

async function main(): Promise<void> {
  console.log("--- roles ---");
  check(providerForRole(cfg({}), "chat")!.id === "chat", "chat role falls back to the active provider");
  check(providerForRole(cfg({ extraction_provider_id: "bg" }), "background")!.id === "bg", "background role falls back to the extraction provider");
  check(providerForRole(cfg({}), "background")!.id === "chat", "…and to chat when none is set");
  check(providerForRole(cfg({}), "vision") === undefined, "no vision provider when chat can't see and none is assigned");
  const seeing = cfg({ providers: [P("chat", { supports_vision: true })] });
  check(providerForRole(seeing, "vision")!.id === "chat", "a vision-capable chat model is its own vision provider");
  check(providerForRole(cfg({ roles: { vision: "eyes" } }), "vision")!.id === "eyes", "an assigned vision provider wins");
  check(providerForRole(cfg({ roles: { vision: "gone" } }), "vision") === undefined, "a dangling assignment is ignored, not trusted");
  check(providerForRole(cfg({ roles: { chat: "bg" } }), "chat")!.id === "bg" && providerForRole(cfg({}), "chat")!.id === "chat", "roles.chat, if ever set, overrides the legacy field");

  console.log("--- capability detection ---");
  const post = (caps: unknown) => async (url: string) => ({ url, capabilities: caps } as any);
  check((await detectVision(P("m"), post(["completion", "vision"]))) === true, "an Ollama model listing 'vision' can see");
  check((await detectVision(P("m"), post(["completion", "tools"]))) === false, "…one that doesn't cannot");
  check((await detectVision(P("m"), async () => ({}))) === undefined, "an unrecognised answer is 'unknown', not 'no'");
  check((await detectVision(P("m"), async () => { throw new Error("down"); })) === undefined, "an unreachable server is 'unknown'");
  check((await detectVision(P("m", { kind: "anthropic" }), post(["vision"]))) === undefined, "non-Ollama kinds are not guessed");
  let seenUrl = "";
  await detectVision(P("m", { base_url: "http://o:11434/v1/" }), async (u) => ((seenUrl = u), {}));
  check(seenUrl === "http://o:11434/api/show", "an OpenAI-style /v1 URL is normalised to the Ollama root");

  console.log("--- serialization ---");
  const plain: ChatMessage = { role: "user", content: "hello" };
  const withImg: ChatMessage = { role: "user", content: "what is this?", images: ["AAAA"] };
  check(openAIContent(plain) === "hello" && anthropicContent(plain) === "hello", "text-only messages are unchanged");
  const oa = openAIContent(withImg) as any[];
  check(oa[0].type === "text" && oa[1].image_url.url === "data:image/jpeg;base64,AAAA", "OpenAI style: text part + data-URL image part");
  const an = anthropicContent(withImg) as any[];
  check(an[0].source.media_type === "image/jpeg" && an[0].source.data === "AAAA" && an[1].text === "what is this?", "Anthropic: base64 image block, then text");
  const ge = geminiParts(withImg) as any[];
  check(ge[0].inline_data.data === "AAAA" && ge[1].text === "what is this?", "Gemini: inline_data part, then text");
  check((geminiParts(plain) as any[]).length === 1, "Gemini text-only stays a single part");

  console.log("\n--- PASS: vision-providers ---");
}

main().then(() => process.exit(0));
