// Phase 11 live-LLM spin.
//
// Question: do the Phase 11 LLM-side components (CoreTraitVerifier,
// SelfModelGenerator) produce sensible output when wired to real
// canon + real qwen3.5:9b? The existing tests use MockProvider for
// determinism; this script tests the non-deterministic parts.
//
// What it does:
//   1. Pull recent canon for Ren from the just-completed driver session
//   2. Hand-author 3 candidate core traits matching observed Ren behavior
//   3. Run CoreTraitVerifier against each via qwen3.5:9b
//   4. Run SelfModelGenerator with the accepted traits + canon
//   5. Validate first-person check passes
//   6. Print what aggregateIdentity would render in the inspector
//
// Run:  npx tsx scripts/spin-phase11.ts

import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";
import { McpTransport } from "../src/lib/yantrikdb/mcp-transport";
import { YantrikClient } from "../src/lib/yantrikdb/client";
import { CoreTraitVerifier } from "../src/lib/skills/core-trait-verifier";
import { SelfModelGenerator, validateFirstPerson } from "../src/lib/identity/self-model-generator";
import type { SelfModelInputs } from "../src/lib/identity/self-model-types";

// ── localStorage polyfill (Node has none; skills/overrides + core-trait-
// promotions stay no-ops gracefully without it) ─────────────────────
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
  key(i: number): string | null { return Array.from(this.map.keys())[i] ?? null; }
  get length(): number { return this.map.size; }
}
(globalThis as unknown as { localStorage: unknown }).localStorage = new MemoryStorage();

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const STACK = process.env.CHRONICLER_URL ?? "http://127.0.0.1:3001/api/mcp";
const MODEL = process.env.GEN_MODEL ?? "qwen3.5:9b";

class DirectOllama implements LlmProvider {
  name: string;
  constructor(public label: string) { this.name = label; }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: "system", content: req.system },
          ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        stream: false,
        think: false,
        options: { temperature: req.temperature ?? 0.6, num_predict: req.max_tokens ?? 1500 },
      }),
    });
    if (!res.ok) throw new Error(`${this.label} ${res.status}: ${await res.text()}`);
    const d = (await res.json()) as { message?: { content?: string; thinking?: string } };
    return {
      content: d.message?.content?.trim() ? d.message.content : (d.message?.thinking ?? ""),
    };
  }
}

// Candidate core traits for Ren — framed as identity-level posture
// rather than triggered behavior. The previous spin learned that
// "Ren does X when Y" reads to the verifier as situational; rephrased
// here as default disposition.
const CANDIDATE_TRAITS = [
  "Ren is fundamentally observation-led. Speaking is something Ren does after watching, never the opening move; silence is always an option Ren is willing to take.",
  "Ren is quietly cautious with new information. When something matters — a name, a date, a plan — Ren turns it over slowly before keeping it, treating attention as a form of respect.",
  "Ren is uncomfortable with performative warmth. Conversation that asks for it gets met with a small gesture or a literal observation about the room instead of social filler.",
];

// A bait trait — situational, not identity. Should be REJECTED.
const BAIT_TRAIT =
  "Ren recommends maritime law books when customers ask about lighthouses.";

async function main(): Promise<void> {
  console.log("Phase 11 live-LLM spin");
  console.log(`model: ${MODEL}\n`);

  // 1. Pull Ren canon from YantrikDB to anchor the verifier + generator
  const t = new McpTransport({ kind: "streamable-http", url: STACK });
  const client = new YantrikClient(t);
  // Pull from any namespace that has Ren content — the driver writes
  // to namespace `character:ren-driver-<tag>` and `world:<...>`. Use
  // a broad query without namespace filter to see anything indexed.
  const canon = await client.recall({
    query: "Ren bookseller Salt Page Pranab cat Kiku",
    top_k: 15,
  });
  const canonTexts = (canon.memories ?? [])
    .map((m) => m.text)
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .slice(0, 10);
  console.log(`pulled ${canonTexts.length} canon facts about Ren from YantrikDB:`);
  for (const c of canonTexts.slice(0, 5)) {
    console.log(`  · ${c.slice(0, 120)}${c.length > 120 ? "…" : ""}`);
  }
  console.log("");

  // 2. Run verifier on all candidates + the bait
  const provider = new DirectOllama("verifier");
  const verifier = new CoreTraitVerifier(provider, MODEL);
  console.log("── Verifier pass (qwen3.5:9b) ──");
  const verdicts: Array<{ body: string; accepted: boolean; reasoning: string; rank: number }> = [];
  const all = [...CANDIDATE_TRAITS, BAIT_TRAIT];
  for (const body of all) {
    const verdict = await verifier.verify({
      skill_id: `ren-test-${all.indexOf(body)}`,
      body,
      character_id: "ren-spin",
      character_name: "Ren",
      existing_core_traits: [],
      evidence: {
        total_net_score: 9,
        reinforcement_count: 10,
        distinct_sessions: 4,
        days_active: 14,
        success_rate: 0.8,
      },
    });
    const flag = verdict.is_core_trait ? "✓" : "✗";
    console.log(`  ${flag} ${body.slice(0, 80)}${body.length > 80 ? "…" : ""}`);
    console.log(`     reasoning: ${verdict.reasoning.slice(0, 200)}${verdict.reasoning.length > 200 ? "…" : ""}`);
    console.log(`     rank: ${verdict.rank_estimate?.toFixed(2) ?? "—"}\n`);
    verdicts.push({
      body,
      accepted: verdict.is_core_trait,
      reasoning: verdict.reasoning,
      rank: verdict.rank_estimate ?? 0,
    });
  }

  // 3. Generate self-model from accepted traits
  const accepted = verdicts.filter((v) => v.accepted);
  console.log("── Self-model generation (qwen3.5:9b) ──");
  console.log(`accepted ${accepted.length}/${all.length} candidates\n`);
  if (accepted.length === 0) {
    console.log("nothing accepted — cannot generate self-model. exiting.");
    return;
  }
  const generator = new SelfModelGenerator(provider, MODEL);
  const inputs: SelfModelInputs = {
    character_id: "ren-spin",
    character_name: "Ren",
    core_traits: accepted.map((a) => ({ body: a.body, rank: a.rank })),
    canon_excerpts: canonTexts.slice(0, 6),
    drift_summary: "Speaker (user, Pranab): recent visitor, has shared name + hometown + cat — moderate trust forming.",
    active_preferences: ["Quiet observation over performative warmth.", "Specific details over generic recommendations."],
  };
  const result = await generator.generate(inputs);
  if (!result) {
    console.log("self-model generation FAILED (validation rejected output or LLM error)");
    return;
  }
  console.log("self-model generated:\n");
  console.log("─".repeat(70));
  console.log(result.body);
  console.log("─".repeat(70));
  console.log(`\n  generated_at: ${result.header.generated_at}`);
  console.log(`  model_used:   ${result.header.model_used}`);
  console.log(`  paragraphs:   ${result.header.paragraph_count}`);
  console.log(`  inputs_hash:  ${result.header.inputs_hash.slice(0, 16)}…`);
  console.log(`  first_person_check: ${validateFirstPerson(result.body) ? "PASS" : "FAIL"}`);

  // 4. What aggregateIdentity would render in the inspector
  console.log("\n── What the Identity inspector would show ──");
  console.log(`  Header:  ${"Ren"} · ${accepted.length} traits`);
  console.log(`  Self-model: ${result.body.split("\n")[0].slice(0, 100)}…`);
  console.log(`  Core traits (ranked):`);
  for (const a of accepted.sort((x, y) => y.rank - x.rank)) {
    const stars = Math.max(1, Math.round(a.rank * 5));
    console.log(`    ${"★".repeat(stars)}${"☆".repeat(5 - stars)} ${a.body.slice(0, 80)}${a.body.length > 80 ? "…" : ""}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("spin failed:", e);
    process.exit(1);
  });
