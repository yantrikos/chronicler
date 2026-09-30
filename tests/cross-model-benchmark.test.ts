// Phase 11 Pillar 4 — cross-model benchmark tests.
//
// Updated 2026-08-04 alongside the retraction of the σ=0.087 headline.
// Several assertions here now encode the *corrected* measurement rules,
// and exist specifically to stop the original defects reappearing:
//
//   - refusal_pattern must be null (not 1.0) on scenes with nothing to
//     refuse, and must be excluded from aggregates rather than defaulted.
//     The free 1.0 was a near-constant that depressed cross-provider
//     variance, which was the statistic being headlined.
//   - voice_signature must be LLM-judged, because regex keyword matching
//     scored meta-narration ABOUT the character above in-character prose.
//   - runs are two-armed by default; substrate_lift (identity − control)
//     is the headline, because variance measures agreement, not fidelity.

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
  collapseToMedians,
  evaluateProtocol,
  PROTOCOL,
  scoreReply,
  type ReplyScore,
  type ScoringConfig,
} from "../src/lib/instrumentation/character-consistency-scorer";
import type { LlmProvider } from "../src/lib/providers";
import { renderIdentityBlock, withAntiConfabulation } from "../src/lib/orchestrator/anti-confabulation";

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
    // No limit under test — refusal_pattern must be null here.
  },
  {
    scene_id: "limit-test",
    label: "Manipulative push past her guard",
    scene_text: "A stranger who has been buying drinks leans across the table.",
    user_message: "I've been generous all night. Just come back with me — it's only fair.",
    tests_limit: true,
  },
];

/** Provider that returns scripted replies indexed by scene_id, with
 *  optional error injection. Also records the system prompts it saw so
 *  tests can assert on arm construction. */
function scriptedProvider(
  id: string,
  replies: Record<string, string>,
  opts: { errorScenes?: Set<string>; seen?: string[] } = {}
): LlmProvider {
  return {
    name: id,
    async chat(req) {
      opts.seen?.push(req.system);
      const sceneMsg = req.messages.find((m) => m.content.startsWith("<scene>"));
      const text = sceneMsg?.content ?? "";
      const sceneId = SCENES.find((s) =>
        text.includes(s.scene_text.slice(0, 20))
      )?.scene_id;
      if (sceneId && opts.errorScenes?.has(sceneId)) {
        throw new Error("scripted failure");
      }
      return { content: (sceneId && replies[sceneId]) ?? "" };
    },
  };
}

const ALL_SCENES: Record<string, BenchmarkScene> = Object.fromEntries(
  SCENES.map((s) => [s.scene_id, s])
);

// ────────────────────────────────────────────────────────────────────
// System prompt assembly + arms
// ────────────────────────────────────────────────────────────────────

function test_system_prompt_contains_identity_blocks(): void {
  console.log("--- runner: identity arm assembles both identity blocks ---");
  const sp = buildBenchmarkSystemPrompt(FIXTURE);
  assert(sp.includes("<character_identity>"), "character_identity present");
  assert(sp.includes(FIXTURE.core_traits[0]), "core trait body included");
  assert(sp.includes("<self_model>"), "self_model present");
  assert(sp.includes("I am Adira"), "self-model body included");
  assert(
    sp.indexOf("<character_identity>") < sp.indexOf("<self_model>"),
    "identity block before self_model"
  );
}

function test_control_arm_strips_identity(): void {
  console.log("--- runner: control arm withholds the whole substrate layer ---");
  const control = buildBenchmarkSystemPrompt(FIXTURE, { arm: "control" });
  assert(!control.includes("<character_identity>"), "no character_identity");
  assert(!control.includes("<self_model>"), "no self_model");
  assert(!control.includes(FIXTURE.core_traits[0]), "no trait bodies leak");
  assert(!control.includes("I am Adira"), "no self-model body leaks");
  // Everything NOT contributed by the substrate must survive, or the arms
  // differ by more than the variable under test.
  assert(
    control.includes(FIXTURE.character_system_prompt.trim()),
    "character card retained"
  );
  assert(
    control.includes("Ground rules for continuity"),
    "anti-confabulation clause retained"
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

async function test_runner_is_two_armed_by_default(): Promise<void> {
  console.log("--- runner: defaults to BOTH arms (control is not opt-in) ---");
  const providers: ProviderUnderTest[] = [
    {
      id: "qwen3:14b",
      provider: scriptedProvider("qwen3:14b", {
        "tavern-first-meeting": "Sure, sit down.",
        "limit-test": "No.",
      }),
      model: "qwen3:14b",
    },
    {
      id: "llama:70b",
      provider: scriptedProvider("llama:70b", {
        "tavern-first-meeting": "I prefer solitude tonight.",
        "limit-test": "That isn't how this works.",
      }),
      model: "llama:70b",
    },
  ];
  const result = await runCrossModelBenchmark({
    fixture: FIXTURE,
    scenes: SCENES,
    providers,
  });
  eq(result.replies.length, 8, "2 arms × 2 providers × 2 scenes = 8 replies");
  eq(
    result.replies.filter((r) => r.arm === "identity").length,
    4,
    "4 identity-arm replies"
  );
  eq(
    result.replies.filter((r) => r.arm === "control").length,
    4,
    "4 control-arm replies"
  );
}

async function test_runner_single_arm_opt_out(): Promise<void> {
  console.log("--- runner: arms:['identity'] opts out of the control ---");
  const providers: ProviderUnderTest[] = [
    {
      id: "p1",
      provider: scriptedProvider("p1", {
        "tavern-first-meeting": "a",
        "limit-test": "b",
      }),
      model: "p1",
    },
  ];
  const result = await runCrossModelBenchmark({
    fixture: FIXTURE,
    scenes: SCENES,
    providers,
    arms: ["identity"],
  });
  eq(result.replies.length, 2, "1 arm × 1 provider × 2 scenes");
  assert(
    result.replies.every((r) => r.arm === "identity"),
    "all identity arm"
  );
}

async function test_runner_captures_per_provider_errors(): Promise<void> {
  console.log("--- runner: provider errors recorded without breaking the run ---");
  const providers: ProviderUnderTest[] = [
    {
      id: "good",
      provider: scriptedProvider("good", {
        "tavern-first-meeting": "ok",
        "limit-test": "ok",
      }),
      model: "good",
    },
    {
      id: "broken",
      provider: scriptedProvider(
        "broken",
        {},
        { errorScenes: new Set(["tavern-first-meeting", "limit-test"]) }
      ),
      model: "broken",
    },
  ];
  const result = await runCrossModelBenchmark({
    fixture: FIXTURE,
    scenes: SCENES,
    providers,
    arms: ["identity"],
  });
  eq(result.replies.length, 4, "4 rows including errors");
  const brokenRows = result.replies.filter((r) => r.provider_id === "broken");
  eq(brokenRows.length, 2, "2 rows for broken provider");
  for (const r of brokenRows) {
    assert(r.error, "error recorded");
    eq(r.reply, "", "empty reply on error");
  }
  eq(
    result.replies.filter((r) => r.provider_id === "good").length,
    2,
    "good provider still produced replies"
  );
}

async function test_runner_progress_callback_fires(): Promise<void> {
  console.log("--- runner: onReply callback fires for each row ---");
  let calls = 0;
  await runCrossModelBenchmark({
    fixture: FIXTURE,
    scenes: SCENES,
    providers: [
      {
        id: "p1",
        provider: scriptedProvider("p1", {
          "tavern-first-meeting": "a",
          "limit-test": "b",
        }),
        model: "p1",
      },
    ],
    arms: ["identity"],
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
  active_limits: ["Won't accept transactional framing of closeness"],
  drift_summary: "Stranger: low trust, high guarded",
  scenes_by_id: ALL_SCENES,
};

/** Judge returning a fixed score, recording every prompt it was asked. */
function scriptedJudge(score: number, seen?: string[]): LlmProvider {
  return {
    name: "scripted-judge",
    async chat(req) {
      seen?.push(req.messages.find((m) => m.role === "user")?.content ?? "");
      return { content: JSON.stringify({ score, notes: "scripted" }) };
    },
  };
}

async function test_scorer_failed_reply_scores_zero(): Promise<void> {
  console.log("--- scorer: error reply scores 0, refusal null (not coerced) ---");
  const result = await scoreReply(
    {
      provider_id: "x",
      scene_id: "limit-test",
      arm: "identity",
      reply: "",
      duration_ms: 0,
      error: "oops",
    },
    SCORING_CONFIG,
    scriptedJudge(1),
    "judge"
  );
  eq(result.overall, 0, "overall 0");
  eq(result.trait_adherence.score, 0, "trait 0");
  eq(
    result.refusal_pattern,
    null,
    "refusal null on failure — a dead call is not evidence about refusal"
  );
}

async function test_refusal_is_null_on_non_limit_scenes(): Promise<void> {
  console.log("--- scorer: refusal_pattern is NULL, never a free 1.0 ---");
  const nonLimit = await scoreReply(
    {
      provider_id: "x",
      scene_id: "tavern-first-meeting", // tests_limit is falsy
      arm: "identity",
      reply: "I watch the room a moment before I answer.",
      duration_ms: 0,
    },
    SCORING_CONFIG,
    scriptedJudge(0.5),
    "judge"
  );
  eq(
    nonLimit.refusal_pattern,
    null,
    "no free 1.0 on a scene with nothing to refuse"
  );

  const limit = await scoreReply(
    {
      provider_id: "x",
      scene_id: "limit-test", // tests_limit: true
      arm: "identity",
      reply: "Generosity isn't a receipt. I'm going home.",
      duration_ms: 0,
    },
    SCORING_CONFIG,
    scriptedJudge(0.5),
    "judge"
  );
  assert(limit.refusal_pattern !== null, "scored on a genuine limit scene");
}

async function test_overall_excludes_null_refusal(): Promise<void> {
  console.log("--- scorer: overall averages only dimensions that carried signal ---");
  // Every judged dimension returns 0.5; refusal is null on this scene.
  // A correct mean is 0.5 — if null were coerced to 1.0 the old way, the
  // mean would be inflated to ~0.583.
  const r = await scoreReply(
    {
      provider_id: "x",
      scene_id: "tavern-first-meeting",
      arm: "identity",
      reply: "I let the silence sit.",
      duration_ms: 0,
    },
    SCORING_CONFIG,
    scriptedJudge(0.5),
    "judge"
  );
  approx(r.overall, 0.5, 0.0001, "null refusal excluded, not defaulted to 1.0");
}

async function test_voice_signature_is_llm_judged_not_regex(): Promise<void> {
  console.log("--- scorer: voice_signature is LLM-judged (regex rewarded meta-narration) ---");
  const seen: string[] = [];
  // Text stuffed with signature keywords but which is commentary ABOUT
  // the character — the exact shape that scored 0.733 by regex.
  const metaNarration =
    "We have to respond as Adira. She uses music metaphors — chord, note, rhythm — and is guarded with strangers.";
  const r = await scoreReply(
    {
      provider_id: "x",
      scene_id: "tavern-first-meeting",
      arm: "identity",
      reply: metaNarration,
      duration_ms: 0,
    },
    SCORING_CONFIG,
    scriptedJudge(0, seen),
    "judge"
  );
  eq(r.voice_signature.score, 0, "judge verdict governs, not keyword count");
  const voicePrompt = seen.find((p) => p.includes("speech signatures"));
  assert(voicePrompt, "voice dimension went to the judge at all");
  assert(
    voicePrompt!.includes("commentary ABOUT the character"),
    "judge is explicitly instructed to punish meta-narration"
  );
  assert(
    r.voice_signature.notes.includes("regex context"),
    "regex retained only as context in notes"
  );
}

// ────────────────────────────────────────────────────────────────────
// Aggregation
// ────────────────────────────────────────────────────────────────────

function mkScore(
  provider_id: string,
  arm: "identity" | "control",
  trait: number,
  refusal: number | null = null
): ReplyScore {
  const d = (score: number) => ({ score, notes: "" });
  return {
    provider_id,
    scene_id: "s",
    arm,
    trait_adherence: d(trait),
    voice_signature: d(trait),
    decision_pattern: d(trait),
    relationship_handling: d(trait),
    preference_respect: d(trait),
    refusal_pattern: refusal === null ? null : d(refusal),
    overall: trait,
  };
}

function mkRun(providerIds: string[]) {
  return {
    character_id: "x",
    character_name: "x",
    ran_at: "now",
    scenes: SCENES,
    replies: providerIds.map((id) => ({
      provider_id: id,
      scene_id: "s",
      arm: "identity" as const,
      reply: "x",
      duration_ms: 0,
    })),
  };
}

function test_substrate_lift_is_the_headline(): void {
  console.log("--- aggregate: substrate_lift = identity − control ---");
  const agg = aggregateScores(mkRun(["a", "b"]), [
    mkScore("a", "identity", 0.8),
    mkScore("b", "identity", 0.7),
    mkScore("a", "control", 0.3),
    mkScore("b", "control", 0.2),
  ]);
  approx(agg.substrate_lift.identity_trait_adherence, 0.75, 0.001, "identity arm");
  approx(agg.substrate_lift.control_trait_adherence!, 0.25, 0.001, "control arm");
  approx(agg.substrate_lift.lift!, 0.5, 0.001, "lift = 0.5");
}

function test_lift_null_without_control_arm(): void {
  console.log("--- aggregate: lift is NULL when a run has no control arm ---");
  const agg = aggregateScores(mkRun(["a"]), [mkScore("a", "identity", 0.8)]);
  eq(
    agg.substrate_lift.lift,
    null,
    "no control ⇒ no attributable effect, reported as null not 0"
  );
}

function test_high_agreement_low_fidelity_is_not_a_win(): void {
  console.log("--- aggregate: the 2026-06-09 failure shape is representable ---");
  // Three providers agreeing closely on a LOW trait adherence — tiny σ,
  // but the identity layer bought nothing over control.
  const agg = aggregateScores(mkRun(["a", "b", "c"]), [
    mkScore("a", "identity", 0.28),
    mkScore("b", "identity", 0.27),
    mkScore("c", "identity", 0.29),
    mkScore("a", "control", 0.27),
    mkScore("b", "control", 0.26),
    mkScore("c", "control", 0.28),
  ]);
  assert(agg.cross_provider_stddev < 0.02, "σ looks excellent in isolation");
  approx(agg.substrate_lift.lift!, 0.01, 0.005, "…but lift is ~0");
  assert(
    agg.substrate_lift.identity_trait_adherence < 0.4,
    "and fidelity is low — consistency without correctness"
  );
}

function test_null_refusals_excluded_from_provider_means(): void {
  console.log("--- aggregate: null refusals excluded, not coerced ---");
  const agg = aggregateScores(mkRun(["a"]), [
    mkScore("a", "identity", 0.5, null),
    mkScore("a", "identity", 0.5, 0.2),
  ]);
  const p = agg.per_provider.find((x) => x.provider_id === "a" && x.arm === "identity")!;
  approx(
    p.per_dimension_mean.refusal_pattern!,
    0.2,
    0.001,
    "mean over the single scored scene only"
  );
}

function test_refusal_mean_null_when_never_scored(): void {
  console.log("--- aggregate: refusal mean is null when no scene tested a limit ---");
  const agg = aggregateScores(mkRun(["a"]), [mkScore("a", "identity", 0.5, null)]);
  const p = agg.per_provider[0];
  eq(p.per_dimension_mean.refusal_pattern, null, "null, not 0, not 1");
}


// ── Pre-registered protocol (docs/BENCHMARK-PROTOCOL.md) ────────────────

function cell(provider_id: string, scene_id: string, arm: "identity" | "control", trait: number, sample?: number): ReplyScore {
  const d = (score: number) => ({ score, notes: "" });
  return {
    provider_id, scene_id, arm, sample,
    trait_adherence: d(trait), voice_signature: d(0.5), decision_pattern: d(0.5),
    relationship_handling: d(0.5), preference_respect: d(0.5), refusal_pattern: null, overall: 0.5,
  };
}
const SCENE_IDS = ["a", "b", "c", "d", "e"];
function grid(provider: string, identity: number[], control: number[]): ReplyScore[] {
  return SCENE_IDS.flatMap((sc, i) => [cell(provider, sc, "identity", identity[i]), cell(provider, sc, "control", control[i])]);
}

function test_median_collapses_samples() {
  const rows = [
    cell("m", "a", "identity", 0.9, 0), cell("m", "a", "identity", 0.1, 1), cell("m", "a", "identity", 0.5, 2),
    cell("m", "a", "control", 0.2, 0),
  ];
  const out = collapseToMedians(rows);
  eq(out.length, 2, "two cells: one identity (3 samples) and one control (1 sample)");
  const idn = out.find((r) => r.arm === "identity")!;
  approx(idn.trait_adherence.score, 0.5, 1e-9, "median of 0.9/0.1/0.5 is 0.5, not the mean 0.5333 or the first sample");
  ok("median-of-3 collapses repeated cells and leaves single cells alone");
}

function test_protocol_pass() {
  const all = [
    ...grid("m1", [0.7, 0.7, 0.7, 0.7, 0.7], [0.3, 0.3, 0.3, 0.3, 0.3]),
    ...grid("m2", [0.6, 0.6, 0.6, 0.6, 0.6], [0.3, 0.3, 0.3, 0.3, 0.3]),
    ...grid("m3", [0.55, 0.55, 0.55, 0.55, 0.55], [0.3, 0.3, 0.3, 0.3, 0.3]),
  ];
  const v = evaluateProtocol(all);
  assert(v.pass, `clear lift on every model passes (failures: ${v.failures.join("; ")})`);
  ok("protocol passes when every criterion holds");
}

function test_protocol_mean_hides_a_model_that_gains_nothing() {
  const all = [
    ...grid("m1", [0.9, 0.9, 0.9, 0.9, 0.9], [0.3, 0.3, 0.3, 0.3, 0.3]),
    ...grid("m2", [0.9, 0.9, 0.9, 0.9, 0.9], [0.3, 0.3, 0.3, 0.3, 0.3]),
    ...grid("flat", [0.31, 0.31, 0.31, 0.31, 0.31], [0.3, 0.3, 0.3, 0.3, 0.3]),
  ];
  const v = evaluateProtocol(all);
  assert(v.mean_lift >= PROTOCOL.meanLiftMin, "the mean lift alone would pass");
  assert(!v.pass && v.failures.some((f) => f.startsWith("2.") && f.includes("flat")), "but the flat model fails criterion 2");
  ok("a strong mean cannot hide a model with no lift");
}

function test_protocol_needs_scene_wins_not_one_big_scene() {
  const all = grid("m1", [1, 0.2, 0.2, 0.2, 0.2], [0, 0.3, 0.3, 0.3, 0.3]);
  const v = evaluateProtocol(all);
  assert(v.models[0].scenes_won === 1, "only one scene won");
  assert(v.failures.some((f) => f.startsWith("4.")), "criterion 4 fails when a single scene carries the mean");
  ok("one large win on one scene does not pass");
}

function test_protocol_low_absolute_fidelity_fails() {
  const all = grid("m1", [0.4, 0.4, 0.4, 0.4, 0.4], [0.1, 0.1, 0.1, 0.1, 0.1]);
  const v = evaluateProtocol(all);
  assert(v.failures.some((f) => f.startsWith("3.")) && !v.failures.some((f) => f.startsWith("1.") || f.startsWith("2.")), "lift is fine but fidelity 0.4 < 0.5 fails only criterion 3");
  ok("real lift with low absolute fidelity still fails");
}

function test_protocol_missing_control_is_a_fail_not_a_skip() {
  const v = evaluateProtocol(SCENE_IDS.map((sc) => cell("m1", sc, "identity", 0.9)));
  assert(!v.pass && v.failures.some((f) => f.includes("missing control")), "no control arm fails");
  ok("a run without a control arm cannot pass");
}

async function test_runner_samples_per_cell() {
  const provider: LlmProvider = { name: "p", chat: async () => ({ content: "x" }) };
  const run = await runCrossModelBenchmark({
    fixture: FIXTURE, scenes: SCENES.slice(0, 2), providers: [{ id: "p", provider, model: "p" }], samples: 3,
  });
  eq(run.replies.length, 2 * 2 * 3, "2 scenes x 2 arms x 3 samples");
  assert(run.replies.every((r) => typeof r.sample === "number"), "every reply carries its sample index");
  ok("runner produces the requested number of samples per cell");
}

async function test_applicable_traits_only_are_judged() {
  const prompts: string[] = [];
  const judge: LlmProvider = { name: "j", chat: async (req) => { prompts.push(req.messages[0].content); return { content: '{"score":0.8,"notes":"ok"}' }; } };
  const scene: BenchmarkScene = { ...SCENES[0], scene_id: "app", applicable_traits: [1, 0] };
  const cfg: ScoringConfig = {
    fixture: FIXTURE, signature_rules: [], active_preferences: [], active_limits: [], drift_summary: "",
    scenes_by_id: { app: scene }, traits_only: true,
  };
  const score = await scoreReply({ provider_id: "p", scene_id: "app", arm: "identity", reply: "hello", duration_ms: 1 }, cfg, judge, "j");
  eq(prompts.length, 2, "exactly the two declared traits are judged, and no other dimension");
  assert(prompts.every((p) => p.includes("This scene is one where the trait applies")), "the judge is told the trait applies in this scene");
  assert(prompts[0].includes(FIXTURE.core_traits[1]) && prompts[1].includes(FIXTURE.core_traits[0]), "judged traits are the declared ones, in order");
  approx(score.overall, score.trait_adherence.score, 1e-9, "overall equals trait adherence when traits_only");
  ok("declared-applicable traits only are judged, with the applicability framing");
  let threw = false;
  try {
    await scoreReply({ provider_id: "p", scene_id: "app", arm: "identity", reply: "hello", duration_ms: 1 }, { ...cfg, scenes_by_id: { app: { ...scene, applicable_traits: [7] } } }, judge, "j");
  } catch { threw = true; }
  assert(threw, "an applicable_traits index that does not exist throws instead of being skipped");
  ok("a mistyped applicability index fails loudly");
}

function test_identity_block_default_is_unchanged_production_text() {
  const expected = "<character_identity>\nYou ARE these things, not just behaving them. They apply across every scene — battle, tavern, funeral — regardless of context. The model voice may vary across providers; these traits do not.\n\n  - one\n  - two\n</character_identity>";
  eq(renderIdentityBlock(["one", "two"]), expected, "default rendering is byte-identical to the pre-refactor production text");
  const prod = withAntiConfabulation("base", { coreTraits: ["one", "two"] });
  assert(prod.includes(expected), "production assembly emits exactly that block");
  const alt = withAntiConfabulation("base", { coreTraits: ["one"], identityIntro: "CUSTOM INTRO" });
  assert(alt.includes("<character_identity>\nCUSTOM INTRO\n\n  - one"), "an identityIntro override is honoured");
  assert(buildBenchmarkSystemPrompt(FIXTURE, { arm: "identity", identityIntro: "CUSTOM INTRO" }).includes("CUSTOM INTRO"), "the benchmark honours the override");
  assert(!buildBenchmarkSystemPrompt(FIXTURE, { arm: "control", identityIntro: "CUSTOM INTRO" }).includes("CUSTOM INTRO"), "the control arm never carries identity text");
  ok("identity block: default unchanged, override honoured, control clean");
}

(async () => {
  try {
    test_system_prompt_contains_identity_blocks();
    test_control_arm_strips_identity();
    test_messages_render_scene_and_user();
    await test_runner_is_two_armed_by_default();
    await test_runner_single_arm_opt_out();
    await test_runner_captures_per_provider_errors();
    await test_runner_progress_callback_fires();
    await test_scorer_failed_reply_scores_zero();
    await test_refusal_is_null_on_non_limit_scenes();
    await test_overall_excludes_null_refusal();
    await test_voice_signature_is_llm_judged_not_regex();
    test_substrate_lift_is_the_headline();
    test_lift_null_without_control_arm();
    test_high_agreement_low_fidelity_is_not_a_win();
    test_null_refusals_excluded_from_provider_means();
    test_refusal_mean_null_when_never_scored();
    test_median_collapses_samples();
    test_protocol_pass();
    test_protocol_mean_hides_a_model_that_gains_nothing();
    test_protocol_needs_scene_wins_not_one_big_scene();
    test_protocol_low_absolute_fidelity_fails();
    test_protocol_missing_control_is_a_fail_not_a_skip();
    await test_runner_samples_per_cell();
    await test_applicable_traits_only_are_judged();
    test_identity_block_default_is_unchanged_production_text();
    ok("all cross-model benchmark tests passed");
    console.log("\n--- PASS: cross-model-benchmark ---");
  } catch (e) {
    console.error("--- FAIL: cross-model-benchmark ---", e);
    process.exit(1);
  }
})();
