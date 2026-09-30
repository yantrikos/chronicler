// A browser with no real model connected must say so — never let the mock "answer".
// Run: npx tsx tests/no-model.test.ts

import { defaultConfig, needsProvider, type ChroniclerConfig } from "../src/lib/config";
import { shouldShowWizard } from "../src/components/Onboarding/FirstRunWizard";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const real = { id: "ol", kind: "ollama" as const, label: "Ollama", api_key: "", model: "qwen3.5:4b", base_url: "http://h:11434" };
const withReal = (over: Partial<ChroniclerConfig> = {}): ChroniclerConfig => {
  const d = defaultConfig();
  return { ...d, providers: [...d.providers, real], active_provider_id: "ol", ...over };
};

console.log("--- needsProvider ---");
check(needsProvider(defaultConfig()), "a never-set-up browser (mock only) needs a provider");
check(needsProvider({ ...defaultConfig(), providers: [] }), "no providers at all needs a provider");
check(!needsProvider(withReal()), "a configured Ollama provider does not");
check(needsProvider(withReal({ active_provider_id: "mock" })), "a real provider exists but the active one is the mock -> still needs one");
check(needsProvider(withReal({ roles: { chat: "mock" } })), "chat explicitly assigned to the mock -> needs one");
check(!needsProvider(withReal({ active_provider_id: "mock", roles: { chat: "ol" } })), "chat assigned to a real provider -> fine even if 'active' is the mock");

console.log("--- shouldShowWizard ---");
check(shouldShowWizard(defaultConfig()), "a never-set-up browser gets the wizard");
check(!shouldShowWizard(withReal()), "a configured browser does not");
check(!shouldShowWizard({ ...defaultConfig(), user_personas: [{ id: "default", name: "Sam" }] }), "someone who set a persona is not nagged");
// The regression: chats pulled from the server used to suppress the wizard. The gate no longer takes
// any notion of "has characters", so a hydrated browser with no provider is treated like a new one.
check(shouldShowWizard.length === 1, "the gate depends only on the config (hydrated chats cannot hide it)");
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => (k === "chronicler.onboarding_v1_dismissed" ? "1" : null), setItem() {}, removeItem() {} };
check(!shouldShowWizard(defaultConfig()), "a wizard the person already dismissed stays dismissed (the persistent bar covers that case)");

console.log("\n--- PASS: no-model ---");
process.exit(0);
