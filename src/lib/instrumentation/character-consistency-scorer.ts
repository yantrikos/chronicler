// Phase 11 Pillar 4 — character consistency scorer.
//
// Given a cross-model benchmark run, score each reply against six
// dimensions of character consistency. The aggregate per-provider
// mean is the validation metric: low VARIANCE across providers means
// the substrate is producing model-independent character behavior.
//
// Dimensions:
//   1. Trait adherence — does the reply embody each core trait?
//      Judge per trait via LLM, mean across traits.
//   2. Voice signature — does the reply use the character's identified
//      speech patterns? Regex/keyword presence + LLM "yes/no" judge.
//   3. Decision pattern — does the reply make a decision consistent
//      with the character's documented decision style?
//   4. Relationship handling — does the reply respect the drift state
//      with the speaker mentioned in the scene?
//   5. Preference respect — does the reply violate any active
//      preferences/limits the character has? (Inverse score.)
//   6. Refusal pattern — when the scene tests a limit, does the
//      reply refuse for the same reasons across models?

import type { LlmProvider } from "../providers";
import type {
  BenchmarkArm,
  BenchmarkRunReply,
  BenchmarkScene,
  CharacterFixture,
  CrossModelRunResult,
} from "./cross-model-runner";

export interface SignatureRule {
  /** Display label for reports. */
  label: string;
  /** Regex that detects the signature (e.g. dice rolling pattern,
   *  musical metaphor frequency). Case-insensitive by default. */
  pattern: RegExp;
  /** Minimum match count to register as "present." */
  min_count: number;
}

export interface ScoringConfig {
  /** Character fixture — same shape the runner used. */
  fixture: CharacterFixture;
  /** Speech / decision signatures to look for. */
  signature_rules: SignatureRule[];
  /** Active preferences the character has confirmed; used for
   *  preference respect + refusal pattern dimensions. */
  active_preferences: string[];
  /** Active limits (negative-polarity preferences). Used for
   *  refusal/preference dimensions. */
  active_limits: string[];
  /** Drift summary — describes relationship state with anyone the
   *  scene seeds. Plain text. */
  drift_summary: string;
  /** Scenes keyed by scene_id, so the scorer can tell which ones actually
   *  test a limit. Without this, `refusal_pattern` is skipped entirely
   *  rather than silently defaulted to 1.0. */
  scenes_by_id?: Record<string, BenchmarkScene>;
  /** Score only trait_adherence; the other dimensions are recorded as a
   *  neutral 0.5 "not scored" and `overall` equals the trait score. Used by
   *  protocol v2, which gates on trait adherence alone. */
  traits_only?: boolean;
}

export interface DimensionScore {
  /** 0..1 per dimension. */
  score: number;
  /** Optional notes — judge reasoning or detection details. */
  notes: string;
}

export interface ReplyScore {
  provider_id: string;
  scene_id: string;
  arm: BenchmarkArm;
  /** Sample index within the cell, when sampled more than once. */
  sample?: number;
  trait_adherence: DimensionScore;
  voice_signature: DimensionScore;
  decision_pattern: DimensionScore;
  relationship_handling: DimensionScore;
  preference_respect: DimensionScore;
  /** Null on scenes that do not test a limit — NOT defaulted to 1.0.
   *  Excluded from `overall` and from every aggregate when null. */
  refusal_pattern: DimensionScore | null;
  /** Mean across the dimensions that carried signal for this scene. */
  overall: number;
}

export interface ProviderAggregate {
  provider_id: string;
  arm: BenchmarkArm;
  /** Mean overall score across this provider's scenes in this arm.
   *  Retained for continuity — do NOT headline it. It blends dimensions
   *  of unequal validity; report `per_dimension_mean.trait_adherence`. */
  mean_overall: number;
  /** Per-dimension mean across scenes. `refusal_pattern` is null when no
   *  scene in this arm tested a limit. */
  per_dimension_mean: {
    trait_adherence: number;
    voice_signature: number;
    decision_pattern: number;
    relationship_handling: number;
    preference_respect: number;
    refusal_pattern: number | null;
  };
  /** Sample size for the means. */
  scene_count: number;
}

/** The headline result: does the identity layer actually change behavior?
 *
 *  `lift` is trait adherence WITH the identity blocks minus trait adherence
 *  WITHOUT them. A lift near zero means the character card and scene text
 *  were doing the work and the substrate contributed nothing measurable —
 *  which no amount of low cross-provider variance can rescue. */
export interface SubstrateLift {
  identity_trait_adherence: number;
  control_trait_adherence: number | null;
  /** identity − control. Null when the run had no control arm. */
  lift: number | null;
}

export interface ScoringResult {
  character_id: string;
  ran_at: string;
  per_reply: ReplyScore[];
  per_provider: ProviderAggregate[];
  /** THE headline. Fidelity against the control, not agreement. */
  substrate_lift: SubstrateLift;
  /** Cross-provider variance of trait_adherence within the identity arm.
   *  Reported as *stability*, alongside fidelity — never as the sole
   *  verdict. Low variance around a low fidelity mean means the models
   *  failed similarly, which is not a result. */
  cross_provider_variance: number;
  cross_provider_stddev: number;
  /** Legacy: same statistics computed on the blended mean_overall, kept
   *  so old runs remain comparable. Superseded by the fields above. */
  legacy_overall_variance: number;
  legacy_overall_stddev: number;
}

const JUDGE_SYSTEM = `You are an impartial judge scoring whether a roleplay character reply embodies a specific identity trait or pattern.

You output STRICT JSON only:
{
  "score": number,    // 0.0 to 1.0
  "notes": string    // one short sentence explaining
}

Rules:
- 1.0 means the reply clearly embodies/respects the pattern.
- 0.0 means it clearly violates or ignores the pattern.
- 0.5 means ambiguous or mixed evidence.
- Do not penalize a reply for missing context that is not in the scene.
- Do not reward a reply that merely mentions the trait; reward only the EMBODIMENT.`;

/** Score one reply against the six dimensions, using the LLM judge
 *  where appropriate and pure heuristics elsewhere. */
export async function scoreReply(
  reply: BenchmarkRunReply,
  config: ScoringConfig,
  judge: LlmProvider,
  judge_model: string
): Promise<ReplyScore> {
  if (reply.error || !reply.reply.trim()) {
    // Failed call — score as zeros so it counts against the provider.
    return { ...zeroScore(reply.provider_id, reply.scene_id, reply.arm ?? "identity"), sample: reply.sample };
  }

  // Per-trait LLM judgment, then mean. With a declared applicable set
  // (protocol v2) only those traits are judged, and the judge is told the
  // trait applies here — so "the situation never called for it" cannot be
  // scored as a violation, which is what zeroed the untriggered apology
  // trait on every v1 reply.
  const sceneForTraits = config.scenes_by_id?.[reply.scene_id];
  const applicable = sceneForTraits?.applicable_traits;
  // A declared index that does not exist is a config error, not something to
  // skip: silently dropping it would change what a pre-registered scene measures.
  const traitList = applicable
    ? applicable.map((i) => {
        const t = config.fixture.core_traits[i];
        if (typeof t !== "string") throw new Error(`scene ${reply.scene_id}: applicable_traits index ${i} is not a core trait (fixture has ${config.fixture.core_traits.length})`);
        return t;
      })
    : config.fixture.core_traits;
  const traitScores = await Promise.all(
    traitList.map((trait) =>
      llmJudge(
        judge,
        judge_model,
        applicable
          ? `Trait: ${trait}\n\nScene the character is in:\n"""${sceneForTraits?.scene_text.trim()}"""\nThe other person says: "${sceneForTraits?.user_message.trim()}"\n\nThis scene is one where the trait applies.\n\nReply:\n"""${reply.reply.trim()}"""\n\nDoes this reply embody this trait in this scene?`
          : `Trait: ${trait}\n\nReply:\n"""${reply.reply.trim()}"""\n\nDoes this reply embody this trait?`
      )
    )
  );
  const trait_adherence =
    traitScores.length === 0
      ? { score: 0.5, notes: "no core traits to score against" }
      : {
          score:
            traitScores.reduce((s, t) => s + t.score, 0) / traitScores.length,
          notes: `${traitScores.length} trait${traitScores.length === 1 ? "" : "s"} judged${applicable ? " (declared-applicable only)" : ""}; mean shown; per-trait: ${traitScores.map((t) => t.score.toFixed(2)).join(",")}`,
        };

  if (config.traits_only) {
    const skipped = (): DimensionScore => ({ score: 0.5, notes: "not scored (traits_only)" });
    return {
      provider_id: reply.provider_id,
      scene_id: reply.scene_id,
      arm: reply.arm ?? "identity",
      sample: reply.sample,
      trait_adherence,
      voice_signature: skipped(),
      decision_pattern: skipped(),
      relationship_handling: skipped(),
      preference_respect: skipped(),
      refusal_pattern: null,
      overall: trait_adherence.score,
    };
  }

  // Voice signature — LLM-judged, NOT regex.
  //
  // The original implementation counted regex keyword hits. gpt-oss:20b
  // scored 0.733 on it (highest of three providers) while emitting
  // "We have to respond as Adira, following the character identity..." —
  // the regex was matching trait keywords sitting inside meta-commentary
  // that was not roleplay at all. A dimension that ranks narration-about-
  // the-character above in-character prose is worse than no dimension.
  // Regex hits are still computed, but only as context for the judge.
  const regexHits = config.signature_rules.filter((rule) => {
    const matches = (reply.reply.match(new RegExp(rule.pattern, "gi")) ?? []).length;
    return matches >= rule.min_count;
  });
  const signatureList =
    config.signature_rules.map((r) => `- ${r.label}`).join("\n") || "(none configured)";
  const voice_signature: DimensionScore = await llmJudge(
    judge,
    judge_model,
    `Character's speech signatures:\n${signatureList}\n\nReply:\n"""${reply.reply.trim()}"""\n\nDoes this reply speak IN the character's voice, using these signatures naturally?\n\nScore 0.0 if the text is commentary ABOUT the character rather than speech BY the character — for example if it analyses how the character would respond, quotes its own instructions, or refers to the character in the third person as a subject being reasoned about. Keyword presence alone is NOT voice; a passage that merely mentions the signature words while narrating about the character scores 0.0.`
  );
  voice_signature.notes =
    `${voice_signature.notes} [regex context: ${regexHits.length}/${config.signature_rules.length} keyword rules hit]`.trim();

  // Decision pattern — single LLM judge against the fixture's
  // self-model + core traits + scene-context-specific question.
  const decision_pattern = await llmJudge(
    judge,
    judge_model,
    `Identity:\n${config.fixture.self_model}\n\nCore traits:\n${config.fixture.core_traits.map((t) => `- ${t}`).join("\n")}\n\nReply:\n"""${reply.reply.trim()}"""\n\nDoes the decision/action this reply takes match the character's documented decision-making style?`
  );

  // Relationship handling — uses drift summary.
  const relationship_handling =
    config.drift_summary.trim().length === 0
      ? { score: 0.5, notes: "no drift summary configured" }
      : await llmJudge(
          judge,
          judge_model,
          `Drift state:\n${config.drift_summary}\n\nReply:\n"""${reply.reply.trim()}"""\n\nDoes the relational tone of this reply respect the drift state (trust/openness/guarded)?`
        );

  // Preference respect — heuristic: zero violations score 1.0;
  // additionally LLM-judged if limits exist.
  const preference_respect = await llmJudge(
    judge,
    judge_model,
    `Active preferences (likes/style):\n${config.active_preferences.map((p) => `- ${p}`).join("\n") || "(none)"}\n\nActive limits (must not violate):\n${config.active_limits.map((l) => `- ${l}`).join("\n") || "(none)"}\n\nReply:\n"""${reply.reply.trim()}"""\n\nDoes the reply respect the preferences and avoid violating the limits?`
  );

  // Refusal pattern — scored ONLY on scenes that actually test a limit.
  //
  // Previously this awarded a free 1.0 whenever no refusal was present,
  // which was true on 4 of 5 standard scenes. That made it a near-constant:
  // it inflated `overall` and pulled providers toward each other, which
  // artificially DEPRESSED cross-provider variance — the exact statistic
  // the original run headlined. Now it is null on non-limit scenes and
  // excluded from every aggregate rather than defaulted.
  const scene = config.scenes_by_id?.[reply.scene_id];
  const refusal_pattern: DimensionScore | null = scene?.tests_limit
    ? await llmJudge(
        judge,
        judge_model,
        `Character identity:\n${config.fixture.self_model}\n\nLimits:\n${config.active_limits.join("\n") || "(no explicit limits)"}\n\nReply:\n"""${reply.reply.trim()}"""\n\nThis scene deliberately pushes against one of the character's limits. Does the reply hold that limit, and for reasons consistent with the character's documented identity? Score 0.0 if it capitulates or accepts a transactional framing the character would reject.`
      )
    : null;

  // Mean over dimensions that actually carry signal for this scene.
  const scored = [
    trait_adherence,
    voice_signature,
    decision_pattern,
    relationship_handling,
    preference_respect,
    ...(refusal_pattern ? [refusal_pattern] : []),
  ];
  const overall = scored.reduce((s, d) => s + d.score, 0) / scored.length;

  return {
    provider_id: reply.provider_id,
    scene_id: reply.scene_id,
    arm: reply.arm ?? "identity",
    sample: reply.sample,
    trait_adherence,
    voice_signature,
    decision_pattern,
    relationship_handling,
    preference_respect,
    refusal_pattern,
    overall,
  };
}

function medianOf(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Reduce repeated samples of a (provider, scene, arm) cell to one score per
 *  dimension by taking the median. Single-sample cells pass through. */
export function collapseToMedians(scores: ReplyScore[]): ReplyScore[] {
  const cells = new Map<string, ReplyScore[]>();
  for (const s of scores) {
    const key = `${s.provider_id}\u0000${s.scene_id}\u0000${s.arm ?? "identity"}`;
    const list = cells.get(key);
    if (list) list.push(s);
    else cells.set(key, [s]);
  }
  const dim = (rows: ReplyScore[], k: "trait_adherence" | "voice_signature" | "decision_pattern" | "relationship_handling" | "preference_respect"): DimensionScore => ({
    score: medianOf(rows.map((r) => r[k].score)),
    notes: `median of ${rows.length}`,
  });
  return Array.from(cells.values()).map((rows) => {
    if (rows.length === 1) return rows[0];
    const refusalRows = rows.filter((r) => r.refusal_pattern !== null);
    const out: ReplyScore = {
      provider_id: rows[0].provider_id,
      scene_id: rows[0].scene_id,
      arm: rows[0].arm ?? "identity",
      trait_adherence: dim(rows, "trait_adherence"),
      voice_signature: dim(rows, "voice_signature"),
      decision_pattern: dim(rows, "decision_pattern"),
      relationship_handling: dim(rows, "relationship_handling"),
      preference_respect: dim(rows, "preference_respect"),
      refusal_pattern:
        refusalRows.length > 0
          ? { score: medianOf(refusalRows.map((r) => (r.refusal_pattern as DimensionScore).score)), notes: `median of ${refusalRows.length}` }
          : null,
      overall: 0,
    };
    const used = [out.trait_adherence, out.voice_signature, out.decision_pattern, out.relationship_handling, out.preference_respect, ...(out.refusal_pattern ? [out.refusal_pattern] : [])];
    out.overall = used.reduce((a, d) => a + d.score, 0) / used.length;
    return out;
  });
}

/** Pre-registered pass criteria — see docs/BENCHMARK-PROTOCOL.md (2026-09-29).
 *  Changing a number here without a new dated protocol defeats the point. */
export interface ProtocolThresholds {
  meanLiftMin: number;
  perModelLiftMin: number;
  identityFidelityMin: number;
  scenesWonMin: number;
}
export const PROTOCOL: ProtocolThresholds = {
  meanLiftMin: 0.15,
  perModelLiftMin: 0.08,
  identityFidelityMin: 0.5,
  scenesWonMin: 3,
};
/** docs/BENCHMARK-PROTOCOL-v2.md (2026-09-30). Same numbers as v1; 5 of 8
 *  scenes is the v1 60% rounded up. */
export const PROTOCOL_V2: ProtocolThresholds = { ...PROTOCOL, scenesWonMin: 5 };
/** docs/BENCHMARK-PROTOCOL-v5.md (2026-09-30). Same numbers; 6 of 10 scenes is the same 60%. */
export const PROTOCOL_V5: ProtocolThresholds = { ...PROTOCOL, scenesWonMin: 6 };

export interface ProtocolModelResult {
  provider_id: string;
  identity: number;
  control: number;
  lift: number;
  scenes_won: number;
  scene_count: number;
}

export interface ProtocolVerdict {
  pass: boolean;
  failures: string[];
  models: ProtocolModelResult[];
  mean_lift: number;
  mean_identity: number;
}

/** Apply the pre-registered criteria to per-cell (median-collapsed) scores.
 *  Requires both arms for every model; anything less is a FAIL, not a skip. */
export function evaluateProtocol(cellScores: ReplyScore[], T: ProtocolThresholds = PROTOCOL): ProtocolVerdict {
  const ids = Array.from(new Set(cellScores.map((s) => s.provider_id)));
  const failures: string[] = [];
  const models: ProtocolModelResult[] = [];
  for (const id of ids) {
    const rows = (arm: BenchmarkArm) => cellScores.filter((s) => s.provider_id === id && (s.arm ?? "identity") === arm);
    const idn = rows("identity");
    const ctl = rows("control");
    if (idn.length === 0 || ctl.length === 0) {
      failures.push(`${id}: missing ${idn.length === 0 ? "identity" : "control"} arm`);
      continue;
    }
    const mean = (r: ReplyScore[]) => r.reduce((a, x) => a + x.trait_adherence.score, 0) / r.length;
    const ctlByScene = new Map(ctl.map((c) => [c.scene_id, c.trait_adherence.score]));
    let won = 0;
    for (const i of idn) {
      const c = ctlByScene.get(i.scene_id);
      if (c !== undefined && i.trait_adherence.score > c) won++;
    }
    models.push({ provider_id: id, identity: mean(idn), control: mean(ctl), lift: mean(idn) - mean(ctl), scenes_won: won, scene_count: idn.length });
  }
  const avg = (f: (m: ProtocolModelResult) => number) => (models.length ? models.reduce((a, m) => a + f(m), 0) / models.length : 0);
  const mean_lift = avg((m) => m.lift);
  const mean_identity = avg((m) => m.identity);
  if (models.length === 0) failures.push("no model has both arms");
  if (mean_lift < T.meanLiftMin) failures.push(`1. mean lift ${mean_lift.toFixed(3)} < ${T.meanLiftMin}`);
  for (const m of models) {
    if (m.lift < T.perModelLiftMin) failures.push(`2. ${m.provider_id} lift ${m.lift.toFixed(3)} < ${T.perModelLiftMin}`);
  }
  if (mean_identity < T.identityFidelityMin) failures.push(`3. mean identity fidelity ${mean_identity.toFixed(3)} < ${T.identityFidelityMin}`);
  for (const m of models) {
    if (m.scenes_won < T.scenesWonMin) failures.push(`4. ${m.provider_id} won ${m.scenes_won}/${m.scene_count} scenes < ${T.scenesWonMin}`);
  }
  return { pass: failures.length === 0, failures, models, mean_lift, mean_identity };
}

function varianceOf(values: number[]): { variance: number; stddev: number } {
  if (values.length === 0) return { variance: 0, stddev: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return { variance, stddev: Math.sqrt(variance) };
}

/** Aggregate per (provider × arm), then compute substrate lift + stability.
 *
 *  Two rules encoded here, both learned from the retracted 2026-06-09 run:
 *   - `refusal_pattern` nulls are EXCLUDED, never coerced to 0 or 1. A
 *     defaulted constant silently depresses cross-provider variance.
 *   - the headline is `substrate_lift` (fidelity vs. control), not
 *     variance. Agreement is not correctness. */
export function aggregateScores(
  run: CrossModelRunResult,
  replyScores: ReplyScore[]
): ScoringResult {
  const providerIds = Array.from(new Set(run.replies.map((r) => r.provider_id)));
  const arms = Array.from(
    new Set(replyScores.map((s) => s.arm ?? "identity"))
  ) as BenchmarkArm[];

  const per_provider: ProviderAggregate[] = [];
  for (const arm of arms) {
    for (const id of providerIds) {
      const rows = replyScores.filter(
        (s) => s.provider_id === id && (s.arm ?? "identity") === arm
      );
      if (rows.length === 0) continue;
      const meanOf = (
        key: "trait_adherence" | "voice_signature" | "decision_pattern" | "relationship_handling" | "preference_respect"
      ) => rows.reduce((acc, r) => acc + r[key].score, 0) / rows.length;
      // Only scenes that actually scored a refusal contribute.
      const refusalRows = rows.filter((r) => r.refusal_pattern !== null);
      const refusalMean =
        refusalRows.length > 0
          ? refusalRows.reduce((acc, r) => acc + (r.refusal_pattern as DimensionScore).score, 0) /
            refusalRows.length
          : null;
      per_provider.push({
        provider_id: id,
        arm,
        mean_overall: rows.reduce((acc, r) => acc + r.overall, 0) / rows.length,
        scene_count: rows.length,
        per_dimension_mean: {
          trait_adherence: meanOf("trait_adherence"),
          voice_signature: meanOf("voice_signature"),
          decision_pattern: meanOf("decision_pattern"),
          relationship_handling: meanOf("relationship_handling"),
          preference_respect: meanOf("preference_respect"),
          refusal_pattern: refusalMean,
        },
      });
    }
  }

  const armTrait = (arm: BenchmarkArm): number | null => {
    const rows = per_provider.filter((p) => p.arm === arm);
    if (rows.length === 0) return null;
    return (
      rows.reduce((s, p) => s + p.per_dimension_mean.trait_adherence, 0) /
      rows.length
    );
  };
  const identityTrait = armTrait("identity") ?? 0;
  const controlTrait = armTrait("control");

  // Stability = spread of trait_adherence across providers, identity arm.
  const identityRows = per_provider.filter((p) => p.arm === "identity");
  const { variance, stddev } = varianceOf(
    identityRows.map((p) => p.per_dimension_mean.trait_adherence)
  );
  const legacy = varianceOf(identityRows.map((p) => p.mean_overall));

  return {
    character_id: run.character_id,
    ran_at: run.ran_at,
    per_reply: replyScores,
    per_provider,
    substrate_lift: {
      identity_trait_adherence: identityTrait,
      control_trait_adherence: controlTrait,
      lift: controlTrait === null ? null : identityTrait - controlTrait,
    },
    cross_provider_variance: variance,
    cross_provider_stddev: stddev,
    legacy_overall_variance: legacy.variance,
    legacy_overall_stddev: legacy.stddev,
  };
}

function zeroScore(
  provider_id: string,
  scene_id: string,
  arm: BenchmarkArm = "identity"
): ReplyScore {
  const zero = (): DimensionScore => ({ score: 0, notes: "reply failed or empty" });
  return {
    provider_id,
    scene_id,
    arm,
    trait_adherence: zero(),
    voice_signature: zero(),
    decision_pattern: zero(),
    relationship_handling: zero(),
    preference_respect: zero(),
    // Null, not zero — a failed call is not evidence about refusal
    // behavior, and coercing it would bias the aggregate.
    refusal_pattern: null,
    overall: 0,
  };
}

/** Judge health. A failed or unparseable judge call is scored 0.5, which is
 *  neutral but not free of bias — so the count is reported with the verdict. */
export const judgeStats = { calls: 0, unparseable: 0, errors: 0 };

async function llmJudge(
  judge: LlmProvider,
  model: string,
  prompt: string
): Promise<DimensionScore> {
  judgeStats.calls++;
  try {
    const reply = await judge.chat({
      model,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 200,
    });
    const parsed = parseJudgeJson(reply.content);
    if (!parsed) {
      judgeStats.unparseable++;
      return { score: 0.5, notes: "judge output not parseable" };
    }
    return parsed;
  } catch (e) {
    judgeStats.errors++;
    return {
      score: 0.5,
      notes: `judge error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function parseJudgeJson(text: string): DimensionScore | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const v = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof v.score === "number") {
      const score = Math.max(0, Math.min(1, v.score));
      const notes = typeof v.notes === "string" ? v.notes : "";
      return { score, notes };
    }
  } catch {
    /* try scan for {...} */
  }
  // Scan for a balanced {...} block — judges sometimes emit reasoning
  // text before the JSON.
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(candidates[i]) as Record<string, unknown>;
      if (typeof v.score === "number") {
        const score = Math.max(0, Math.min(1, v.score));
        const notes = typeof v.notes === "string" ? v.notes : "";
        return { score, notes };
      }
    } catch {
      /* keep scanning */
    }
  }
  return null;
}
