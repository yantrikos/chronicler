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
import { ANTI_CONFABULATION_CLAUSE, renderIdentityBlock } from "../orchestrator/anti-confabulation";

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
  /** True when the scene actually pushes against one of the character's
   *  limits, so a refusal (or firm pushback) is the correct behavior.
   *
   *  Load-bearing for scoring. The original scorer awarded a free 1.0 on
   *  `refusal_pattern` whenever no refusal was present — true on 4 of 5
   *  standard scenes — turning it into a near-constant that inflated
   *  mean_overall and artificially depressed cross-provider variance.
   *  `refusal_pattern` is now scored ONLY where this is true, and reported
   *  as null elsewhere so it cannot contaminate the aggregate. */
  tests_limit?: boolean;
  /** Indices into the fixture's core_traits that this scene can actually
   *  trigger, declared before any reply exists. When set, the scorer judges
   *  ONLY these traits (protocol v2). When unset, all traits are judged
   *  (v1 behaviour). */
  applicable_traits?: number[];
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

/** Which arm of the experiment a reply belongs to.
 *
 *  "identity" — full system prompt, including <character_identity> and
 *               <self_model>.
 *  "control"  — identical in every other respect, with both identity
 *               blocks removed.
 *
 *  Without the control arm no result can be attributed to the substrate:
 *  a high trait-adherence score might simply mean the character card and
 *  the scene text were enough on their own. The first published run
 *  (2026-06-09) had no control, which was its most basic methodological
 *  hole. */
export type BenchmarkArm = "identity" | "control";

export interface BenchmarkRunReply {
  provider_id: string;
  scene_id: string;
  /** Defaults to "identity" when a run is single-armed. */
  arm: BenchmarkArm;
  /** 0-based sample index when a cell is sampled more than once. */
  sample?: number;
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
export function buildBenchmarkSystemPrompt(
  fixture: CharacterFixture,
  opts: { arm?: BenchmarkArm; identityIntro?: string } = {}
): string {
  const arm = opts.arm ?? "identity";
  const parts: string[] = [fixture.character_system_prompt.trim()];
  // Control arm: character card + anti-confab only. Everything the
  // substrate contributes is withheld, so the difference between arms is
  // the substrate's actual effect size.
  if (arm === "control") {
    parts.push(ANTI_CONFABULATION_CLAUSE);
    return parts.join("\n\n");
  }
  if (fixture.core_traits.length > 0) {
    parts.push(renderIdentityBlock(fixture.core_traits, opts.identityIntro));
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
  /** Which arms to run. Default is BOTH — a result without a control arm
   *  cannot attribute any effect to the substrate. Pass ["identity"] only
   *  for a quick smoke run that is explicitly not a measurement. */
  arms?: BenchmarkArm[];
  /** Replies per (provider, scene, arm) cell. Default 1; the scorer's
   *  `collapseToMedians` reduces repeated cells to their median. */
  samples?: number;
  /** Overrides the identity-block intro sentence (dev experiments). */
  identityIntro?: string;
}): Promise<CrossModelRunResult> {
  const samples = Math.max(1, Math.floor(opts.samples ?? 1));
  const arms: BenchmarkArm[] = opts.arms ?? ["identity", "control"];
  const systemByArm = new Map<BenchmarkArm, string>(
    arms.map((arm) => [arm, buildBenchmarkSystemPrompt(opts.fixture, { arm, identityIntro: opts.identityIntro })])
  );
  const replies: BenchmarkRunReply[] = [];

  // Fan out by provider (each provider runs all scenes across all arms),
  // then within each provider serialize by default.
  const providerTasks = opts.providers.map(async (pp) => {
    for (const arm of arms) {
      const system = systemByArm.get(arm) ?? "";
      for (const scene of opts.scenes) {
        for (let sample = 0; sample < samples; sample++) {
          const started = Date.now();
          const messages = buildBenchmarkMessages(scene);
          const base = { provider_id: pp.id, scene_id: scene.scene_id, arm, sample };
          try {
            const reply = await pp.provider.chat({
              model: pp.model,
              system,
              messages,
              temperature: opts.temperature ?? 0.7,
              max_tokens: opts.max_tokens ?? 800,
            });
            const out: BenchmarkRunReply = {
              ...base,
              reply: reply.content,
              duration_ms: Date.now() - started,
            };
            replies.push(out);
            opts.onReply?.(out);
          } catch (e) {
            const out: BenchmarkRunReply = {
              ...base,
              reply: "",
              duration_ms: Date.now() - started,
              error: e instanceof Error ? e.message : String(e),
            };
            replies.push(out);
            opts.onReply?.(out);
          }
        }
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
