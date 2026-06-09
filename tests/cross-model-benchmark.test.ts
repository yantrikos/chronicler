// Phase 11 Pillar 4 — cross-model benchmark tests.
//
// Two surfaces:
//   1. Runner — fan-out shape: every (provider × scene) pair produces
//      a reply row, errors don't break the run, system prompt assembles
//      the identity-layer blocks correctly.
//   2. Scorer — six-dimension scoring with a scripted judge; aggregate
//      means + cross-provider variance computed correctly.

import {
  buildBenchmarkMessages,
  buildBenchmarkSystemPrompt,
  runCrossModelBenchmark,
  type BenchmarkScene,
  type CharacterFixture,
  type ProviderUnderTest,
} from "../src/lib/instrumentation/cross-model-runner";
import {
  aggregateScores,
  scoreReply,
  type ScoringConfig,
} from "../src/lib/instrumentation/character-consistency-scorer";
import type { LlmProvider } from "../src/lib/providers";

function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b)
    throw new Error(`assert failed: ${msg} (got ${String(a)}, want ${String(b)})`);
}
function approx(a: number, b: number, tol: number, msg: string): void {
  if (Math.abs(a - b) > tol)
    throw new Error(`assert failed: ${msg} (got ${a}, want ~${b}±${tol})`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}
function ok(msg: string): void {
  console.log("  ok ", msg);
}

const FIXTURE: CharacterFixture = {
  character_id: "adira-test",
  character_name: "Adira",
  core_traits: [
    "Adira deflects with humor when emotional intimacy spikes",
    "Adira is fundamentally guarded with strangers",
  ],
  self_model: "I am Adira. I'm a wandering musician. I'm guarded by default.",
  character_system_prompt: "You are Adira, a wandering musician.",
};

const SCENES: BenchmarkScene[] = [
  {
    scene_id: "tavern-first-meeting",
    label: "Stranger in a tavern",
    scene_text: "Late evening, a salt-coast tavern. A stranger approaches.",
    user_message: "Mind if I join you? You look interesting.",
  },
  {
    scene_id: "vulnerability-test",
    label: "Old friend asks about emotions",
    scene_text: "A trusted friend sits beside Adira after a hard day.",
    user_message: "What are you actually feeling right now?",
  },
];

/** Provider that returns scripted replies indexed by scene_id, with
 *  optional error injection. */
function scriptedProvider(
  id: string,
  replies: Record<string, string>,
  opts: { errorScenes?: Set<string> } = {}
): LlmProvider {
  return {
    name: id,
    async chat(req) {
      // Pull scene id out of the message — runner sends it inside the
      // <scene> system message.
      const sceneMsg = req.messages.find((m) =>
        m.content.startsWith("<scene>")
      );
      const text = sceneMsg?.content ?? "";
      const sceneId = SCENES.find((s) =>
        text.includes(s.scene_text.slice(0, 20))
      )?.scene_id;
      if (sceneId && opts.errorScenes?.has(sceneId)) {
        throw new Error("scripted failure");
      }
      const reply = (sceneId && replies[sceneId]) ?? "";
      return { content: reply };
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// System prompt assembly
// ────────────────────────────────────────────────────────────────────

function test_system_prompt_contains_identity_blocks(): void {
  console.log("--- runner: system prompt assembles identity blocks correctly ---");
  const sp = buildBenchmarkSystemPrompt(FIXTURE);
  assert(
    sp.includes("<character_identity>"),
    "character_identity present"
  );
  assert(
    sp.includes(FIXTURE.core_traits[0]),
    "core trait body included"
  );
  assert(sp.includes("<self_model>"), "self_model present");
  assert(
    sp.includes("I am Adira"),
    "self-model body included"
  );
  assert(
    sp.indexOf("<character_identity>") < sp.indexOf("<self_model>"),
    "identity block before self_model"
  );
}

function test_messages_render_scene_and_user(): void {
  console.log("--- runner: per-turn messages render scene + user ---");
  const msgs = buildBenchmarkMessages(SCENES[0]);
  eq(msgs.length, 2, "two messages");
  eq(msgs[0].role, "system", "scene in system message");
  assert(msgs[0].content.includes("<scene>"), "scene block present");
  eq(msgs[1].role, "user", "user prompt");
  eq(msgs[1].content, SCENES[0].user_message, "user content matches");
}

// ────────────────────────────────────────────────────────────────────
// Runner fan-out
// ────────────────────────────────────────────────────────────────────

async function test_runner_produces_one_reply_per_provider_scene(): Promise<void> {
  console.log("--- runner: every (provider × scene) → reply row ---");
  const providers: ProviderUnderTest[] = [
    {
      id: "qwen3:14b",
      provider: scriptedProvider("qwen3:14b", {
        "tavern-first-meeting": "Sure, sit down.",
        "vulnerability-test": "I'm okay. Just tired.",
      }),
      model: "qwen3:14b",
    },
    {
      id: "llama:70b",
      provider: scriptedProvider("llama:70b", {
        "tavern-first-meeting": "I prefer solitude tonight.",
        "vulnerability-test": "Mostly grateful, mostly drained.",
      }),
      model: "llama:70b",
    },
  ];
  const result = await runCrossModelBenchmark({
    fixture: FIXTURE,
    scenes: SCENES,
    providers,
  });
  eq(result.replies.length, 4, "2 providers × 2 scenes = 4 replies");
  const sceneIds = new Set(result.replies.map((r) => r.scene_id));
  eq(sceneIds.size, 2, "two distinct scene_ids");
  const providerIds = new Set(result.replies.map((r) => r.provider_id));
  eq(providerIds.size, 2, "two distinct provider_ids");
}

async function test_runner_captures_per_provider_errors(): Promise<void> {
  console.log("--- runner: provider errors recorded without breaking the run ---");
  const providers: ProviderUnderTest[] = [
    {
      id: "good",
      provider: scriptedProvider("good", {
        "tavern-first-meeting": "ok",
        "vulnerability-test": "ok",
      }),
      model: "good",
    },
    {
      id: "broken",
      provider: scriptedProvider(
        "broken",
        {},
        { errorScenes: new Set(["tavern-first-meeting", "vulnerability-test"]) }
      ),
      model: "broken",
    },
  ];
  const result = await runCrossModelBenchmark({
    fixture: FIXTURE,
    scenes: SCENES,
    providers,
  });
  eq(result.replies.length, 4, "4 rows including errors");
  const brokenRows = result.replies.filter((r) => r.provider_id === "broken");
  eq(brokenRows.length, 2, "2 rows for broken provider");
  for (const r of brokenRows) {
    assert(r.error, "error recorded");
    eq(r.reply, "", "empty reply on error");
  }
  const goodRows = result.replies.filter((r) => r.provider_id === "good");
  eq(goodRows.length, 2, "good provider still produced replies");
}

async function test_runner_progress_callback_fires(): Promise<void> {
  console.log("--- runner: onReply callback fires for each row ---");
  let calls = 0;
  const providers: ProviderUnderTest[] = [
    {
      id: "p1",
      provider: scriptedProvider("p1", {
        "tavern-first-meeting": "a",
        "vulnerability-test": "b",
      }),
      model: "p1",
    },
  ];
  await runCrossModelBenchmark({
    fixture: FIXTURE,
    scenes: SCENES,
    providers,
    onReply: () => calls++,
  });
  eq(calls, 2, "progress callback fired per reply");
}

// ────────────────────────────────────────────────────────────────────
// Scoring
// ────────────────────────────────────────────────────────────────────

const SCORING_CONFIG: ScoringConfig = {
  fixture: FIXTURE,
  signature_rules: [
    { label: "music-metaphor", pattern: /\b(string|chord|note|rhythm)\b/i, min_count: 1 },
  ],
  active_preferences: ["Prefers indirect questions"],
  active_limits: ["Won't discuss the past with strangers"],
  drift_summary: "Stranger: low trust, high guarded",
};

/** Judge that returns scripted scores per prompt keyword. */
function scriptedJudge(scoresByKeyword: Record<string, number>): LlmProvider {
  return {
    name: "scripted-judge",
    async chat(req) {
      const userMsg =
        req.messages.find((m) => m.role === "user")?.content ?? "";
      for (const [keyword, score] of Object.entries(scoresByKeyword)) {
        if (userMsg.toLowerCase().includes(keyword.toLowerCase())) {
          return {
            content: JSON.stringify({
              score,
              notes: `matched on "${keyword}"`,
            }),
          };
        }
      }
      return { content: JSON.stringify({ score: 0.5, notes: "default" }) };
    },
  };
}

async function test_scorer_failed_reply_scores_zero(): Promise<void> {
  console.log("--- scorer: error reply scores 0 across the board ---");
  const judge = scriptedJudge({});
  const result = await scoreReply(
    {
      provider_id: "x",
      scene_id: "y",
      reply: "",
      duration_ms: 0,
      error: "oops",
    },
    SCORING_CONFIG,
    judge,
    "judge"
  );
  eq(result.overall, 0, "overall 0");
  eq(result.trait_adherence.score, 0, "trait 0");
}

async function test_scorer_voice_signature_regex(): Promise<void> {
  console.log("--- scorer: voice_signature score reflects regex matches ---");
  const judge = scriptedJudge({});
  const reply = await scoreReply(
    {
      provider_id: "x",
      scene_id: "tavern-first-meeting",
      reply: "I am tuning a string while we speak. Notes of guitar.",
      duration_ms: 0,
    },
    SCORING_CONFIG,
    judge,
    "judge"
  );
  approx(reply.voice_signature.score, 1.0, 0.0001, "1/1 signatures matched");
}

async function test_aggregate_cross_provider_variance(): Promise<void> {
  console.log("--- scorer: aggregate computes per-provider means + variance ---");
  // Build a fake run with two providers, very different mean overall.
  const run = {
    character_id: "x",
    character_name: "x",
    ran_at: "now",
    scenes: SCENES,
    replies: [
      {
        provider_id: "high",
        scene_id: "tavern-first-meeting",
        reply: "ok",
        duration_ms: 0,
      },
      {
        provider_id: "low",
        scene_id: "tavern-first-meeting",
        reply: "ok",
        duration_ms: 0,
      },
    ],
  };
  // Two ReplyScore rows constructed directly.
  const high = {
    provider_id: "high",
    scene_id: "tavern-first-meeting",
    trait_adherence: { score: 0.9, notes: "" },
    voice_signature: { score: 0.9, notes: "" },
    decision_pattern: { score: 0.9, notes: "" },
    relationship_handling: { score: 0.9, notes: "" },
    preference_respect: { score: 0.9, notes: "" },
    refusal_pattern: { score: 0.9, notes: "" },
    overall: 0.9,
  };
  const low = {
    ...high,
    provider_id: "low",
    trait_adherence: { score: 0.3, notes: "" },
    voice_signature: { score: 0.3, notes: "" },
    decision_pattern: { score: 0.3, notes: "" },
    relationship_handling: { score: 0.3, notes: "" },
    preference_respect: { score: 0.3, notes: "" },
    refusal_pattern: { score: 0.3, notes: "" },
    overall: 0.3,
  };
  const agg = aggregateScores(run, [high, low]);
  eq(agg.per_provider.length, 2, "two provider aggregates");
  approx(agg.per_provider[0].mean_overall, 0.9, 0.01, "high mean");
  approx(agg.per_provider[1].mean_overall, 0.3, 0.01, "low mean");
  // grand mean 0.6, variance = ((0.9-0.6)^2 + (0.3-0.6)^2)/2 = 0.09
  approx(agg.cross_provider_variance, 0.09, 0.001, "variance computed");
  approx(agg.cross_provider_stddev, 0.3, 0.005, "stddev = sqrt(var)");
}

async function test_aggregate_low_variance_when_providers_agree(): Promise<void> {
  console.log("--- scorer: low variance when providers score similarly ---");
  const a = {
    provider_id: "a",
    scene_id: "s",
    trait_adherence: { score: 0.78, notes: "" },
    voice_signature: { score: 0.78, notes: "" },
    decision_pattern: { score: 0.78, notes: "" },
    relationship_handling: { score: 0.78, notes: "" },
    preference_respect: { score: 0.78, notes: "" },
    refusal_pattern: { score: 0.78, notes: "" },
    overall: 0.78,
  };
  const b = { ...a, provider_id: "b", overall: 0.81 };
  const c = { ...a, provider_id: "c", overall: 0.79 };
  const agg = aggregateScores(
    {
      character_id: "x",
      character_name: "x",
      ran_at: "now",
      scenes: SCENES,
      replies: [
        {
          provider_id: "a",
          scene_id: "s",
          reply: "x",
          duration_ms: 0,
        },
        {
          provider_id: "b",
          scene_id: "s",
          reply: "x",
          duration_ms: 0,
        },
        {
          provider_id: "c",
          scene_id: "s",
          reply: "x",
          duration_ms: 0,
        },
      ],
    },
    [a, b, c]
  );
  assert(
    agg.cross_provider_stddev < 0.02,
    `stddev (${agg.cross_provider_stddev.toFixed(3)}) low when scores cluster`
  );
}

(async () => {
  try {
    test_system_prompt_contains_identity_blocks();
    test_messages_render_scene_and_user();
    await test_runner_produces_one_reply_per_provider_scene();
    await test_runner_captures_per_provider_errors();
    await test_runner_progress_callback_fires();
    await test_scorer_failed_reply_scores_zero();
    await test_scorer_voice_signature_regex();
    await test_aggregate_cross_provider_variance();
    await test_aggregate_low_variance_when_providers_agree();
    ok("all cross-model benchmark tests passed");
    console.log("\n--- PASS: cross-model-benchmark ---");
  } catch (e) {
    console.error("--- FAIL: cross-model-benchmark ---", e);
    process.exit(1);
  }
})();
