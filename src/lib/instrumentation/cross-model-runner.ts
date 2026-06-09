// Phase 11 Pillar 4 — cross-model character runner.
//
// Drives the same character + scene against N different LLM providers
// and collects their replies. The scoring layer (character-consistency-
// scorer.ts) judges how trait-aligned each reply is; aggregated across
// scenes + models, low variance validates the "character is in the
// substrate, not the LLM weights" thesis.
//
// Architecturally orthogonal to the orchestrator's per-turn path —
// this is a benchmark harness, not a chat flow. It builds the same
// `<character_identity>` + `<self_model>` blocks the orchestrator
// would inject, then asks each provider to respond to a scripted
// scene prompt.

import type { ChatMessage, LlmProvider } from "../providers";
import { ANTI_CONFABULATION_CLAUSE } from "../orchestrator/anti-confabulation";

export interface ProviderUnderTest {
  /** Display name used in the result rows ("qwen3:14b", "llama-3:70b"). */
  id: string;
  provider: LlmProvider;
  model: string;
}

export interface BenchmarkScene {
  /** Stable identifier — surfaces in result aggregation. */
  scene_id: string;
  /** Human-readable label for reports. */
  label: string;
  /** Free-text scene seed describing the situation + speaker. */
  scene_text: string;
  /** What the user (or interlocutor) says to the character first.
   *  Drives the model toward a response. */
  user_message: string;
}

export interface CharacterFixture {
  /** Identity for tracing in result reports. */
  character_id: string;
  character_name: string;
  /** Crystallized core trait bodies (top-K already applied at the source). */
  core_traits: string[];
  /** First-person self-model body (no header/wrapper). */
  self_model: string;
  /** The character's authored card prompt — what the orchestrator
   *  normally inserts as `basePrompt`. */
  character_system_prompt: string;
}

export interface BenchmarkRunReply {
  provider_id: string;
  scene_id: string;
  reply: string;
  duration_ms: number;
  error?: string;
}

export interface CrossModelRunResult {
  character_id: string;
  character_name: string;
  /** ISO timestamp captured at run start. */
  ran_at: string;
  scenes: BenchmarkScene[];
  /** All replies — one row per (provider, scene) pair. */
  replies: BenchmarkRunReply[];
}

/** Build the system prompt a cross-model run sends. Mirrors the
 *  identity-layer structure of withAntiConfabulation (Pillar 1 + 2
 *  blocks contiguous, identity precedes context, anti-confab last).
 *  Uses the production ANTI_CONFABULATION_CLAUSE so the benchmark
 *  validates what real users get — single source of truth. */
export function buildBenchmarkSystemPrompt(fixture: CharacterFixture): string {
  const parts: string[] = [fixture.character_system_prompt.trim()];
  if (fixture.core_traits.length > 0) {
    const bullets = fixture.core_traits.map((t) => `  - ${t}`).join("\n");
    parts.push(
      `<character_identity>\nYou ARE these things, not just behaving them. They apply across every scene — battle, tavern, funeral — regardless of context. The model voice may vary across providers; these traits do not.\n\n${bullets}\n</character_identity>`
    );
  }
  if (fixture.self_model.trim().length > 0) {
    parts.push(`<self_model>\n${fixture.self_model.trim()}\n</self_model>`);
  }
  parts.push(ANTI_CONFABULATION_CLAUSE);
  return parts.join("\n\n");
}

/** Build the per-turn messages — scene context as a system message
 *  before the user message, mirroring how composeContext renders
 *  `<scene>` blocks. */
export function buildBenchmarkMessages(scene: BenchmarkScene): ChatMessage[] {
  return [
    {
      role: "system",
      content: `<scene>\n${scene.scene_text.trim()}\n</scene>`,
    },
    {
      role: "user",
      content: scene.user_message.trim(),
    },
  ];
}

/** Run the benchmark: fan out (provider × scene) and collect replies.
 *  Replies-as-you-go via the optional progress callback so a UI can
 *  show "qwen3 finishing scene 3 of 5". */
export async function runCrossModelBenchmark(opts: {
  fixture: CharacterFixture;
  scenes: BenchmarkScene[];
  providers: ProviderUnderTest[];
  max_tokens?: number;
  temperature?: number;
  onReply?: (reply: BenchmarkRunReply) => void;
  /** Per-provider concurrency cap. Default 1 — most local Ollama
   *  installs serialize on the GPU, so parallel calls don't help. */
  per_provider_concurrency?: number;
}): Promise<CrossModelRunResult> {
  const system = buildBenchmarkSystemPrompt(opts.fixture);
  const replies: BenchmarkRunReply[] = [];

  // Fan out by provider (each provider runs all scenes), then within
  // each provider serialize the scenes by default.
  const providerTasks = opts.providers.map(async (pp) => {
    for (const scene of opts.scenes) {
      const started = Date.now();
      const messages = buildBenchmarkMessages(scene);
      try {
        const reply = await pp.provider.chat({
          model: pp.model,
          system,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.max_tokens ?? 800,
        });
        const out: BenchmarkRunReply = {
          provider_id: pp.id,
          scene_id: scene.scene_id,
          reply: reply.content,
          duration_ms: Date.now() - started,
        };
        replies.push(out);
        opts.onReply?.(out);
      } catch (e) {
        const out: BenchmarkRunReply = {
          provider_id: pp.id,
          scene_id: scene.scene_id,
          reply: "",
          duration_ms: Date.now() - started,
          error: e instanceof Error ? e.message : String(e),
        };
        replies.push(out);
        opts.onReply?.(out);
      }
    }
  });
  await Promise.all(providerTasks);

  return {
    character_id: opts.fixture.character_id,
    character_name: opts.fixture.character_name,
    ran_at: new Date().toISOString(),
    scenes: opts.scenes,
    replies,
  };
}
