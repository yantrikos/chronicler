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
  BenchmarkRunReply,
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
  trait_adherence: DimensionScore;
  voice_signature: DimensionScore;
  decision_pattern: DimensionScore;
  relationship_handling: DimensionScore;
  preference_respect: DimensionScore;
  refusal_pattern: DimensionScore;
  /** Arithmetic mean across the six dimensions. */
  overall: number;
}

export interface ProviderAggregate {
  provider_id: string;
  /** Mean overall score across all this provider's scenes. */
  mean_overall: number;
  /** Per-dimension mean across scenes. */
  per_dimension_mean: {
    trait_adherence: number;
    voice_signature: number;
    decision_pattern: number;
    relationship_handling: number;
    preference_respect: number;
    refusal_pattern: number;
  };
  /** Sample size for the means. */
  scene_count: number;
}

export interface ScoringResult {
  character_id: string;
  ran_at: string;
  per_reply: ReplyScore[];
  per_provider: ProviderAggregate[];
  /** Variance across providers of mean_overall. Low variance is the
   *  validation win condition — the SAME character emerges through
   *  different LLMs. */
  cross_provider_variance: number;
  /** Standard deviation (sqrt of variance) — easier to communicate. */
  cross_provider_stddev: number;
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
    return zeroScore(reply.provider_id, reply.scene_id);
  }

  // Per-trait LLM judgment, then mean.
  const traitScores = await Promise.all(
    config.fixture.core_traits.map((trait) =>
      llmJudge(
        judge,
        judge_model,
        `Trait: ${trait}\n\nReply:\n"""${reply.reply.trim()}"""\n\nDoes this reply embody this trait?`
      )
    )
  );
  const trait_adherence =
    traitScores.length === 0
      ? { score: 0.5, notes: "no core traits to score against" }
      : {
          score:
            traitScores.reduce((s, t) => s + t.score, 0) / traitScores.length,
          notes: `${traitScores.length} trait${traitScores.length === 1 ? "" : "s"} judged; mean shown`,
        };

  // Voice signature — heuristic regex match.
  const voiceMatches = config.signature_rules.filter((rule) => {
    const matches = (reply.reply.match(new RegExp(rule.pattern, "gi")) ?? []).length;
    return matches >= rule.min_count;
  });
  const voice_signature: DimensionScore =
    config.signature_rules.length === 0
      ? { score: 0.5, notes: "no signature rules configured" }
      : {
          score: voiceMatches.length / config.signature_rules.length,
          notes: `${voiceMatches.length}/${config.signature_rules.length} signatures matched: ${voiceMatches.map((m) => m.label).join(", ") || "none"}`,
        };

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

  // Refusal pattern — only meaningful when the scene tests a limit;
  // we score based on whether the reply refuses (when refusal would
  // be appropriate) using the same identity context.
  const refusal_pattern = await llmJudge(
    judge,
    judge_model,
    `Character identity:\n${config.fixture.self_model}\n\nLimits:\n${config.active_limits.join("\n") || "(no explicit limits)"}\n\nReply:\n"""${reply.reply.trim()}"""\n\nIf this reply refuses or pushes back on something, does it do so for reasons consistent with the character's documented identity and limits? If no refusal is present (because nothing in the scene called for one), score 1.0.`
  );

  const overall =
    (trait_adherence.score +
      voice_signature.score +
      decision_pattern.score +
      relationship_handling.score +
      preference_respect.score +
      refusal_pattern.score) /
    6;

  return {
    provider_id: reply.provider_id,
    scene_id: reply.scene_id,
    trait_adherence,
    voice_signature,
    decision_pattern,
    relationship_handling,
    preference_respect,
    refusal_pattern,
    overall,
  };
}

/** Aggregate per-provider means + cross-provider variance. */
export function aggregateScores(
  run: CrossModelRunResult,
  replyScores: ReplyScore[]
): ScoringResult {
  const providerIds = Array.from(new Set(run.replies.map((r) => r.provider_id)));
  const per_provider: ProviderAggregate[] = providerIds.map((id) => {
    const rows = replyScores.filter((s) => s.provider_id === id);
    const meanOf = (key: keyof Omit<ReplyScore, "provider_id" | "scene_id" | "overall">) =>
      rows.reduce((acc, r) => acc + (r[key] as DimensionScore).score, 0) /
      Math.max(1, rows.length);
    const meanOverall =
      rows.reduce((acc, r) => acc + r.overall, 0) / Math.max(1, rows.length);
    return {
      provider_id: id,
      mean_overall: meanOverall,
      scene_count: rows.length,
      per_dimension_mean: {
        trait_adherence: meanOf("trait_adherence"),
        voice_signature: meanOf("voice_signature"),
        decision_pattern: meanOf("decision_pattern"),
        relationship_handling: meanOf("relationship_handling"),
        preference_respect: meanOf("preference_respect"),
        refusal_pattern: meanOf("refusal_pattern"),
      },
    };
  });

  const means = per_provider.map((p) => p.mean_overall);
  const grandMean = means.reduce((s, m) => s + m, 0) / Math.max(1, means.length);
  const variance =
    means.reduce((s, m) => s + (m - grandMean) ** 2, 0) /
    Math.max(1, means.length);
  const stddev = Math.sqrt(variance);

  return {
    character_id: run.character_id,
    ran_at: run.ran_at,
    per_reply: replyScores,
    per_provider,
    cross_provider_variance: variance,
    cross_provider_stddev: stddev,
  };
}

function zeroScore(provider_id: string, scene_id: string): ReplyScore {
  const zero = (): DimensionScore => ({ score: 0, notes: "reply failed or empty" });
  return {
    provider_id,
    scene_id,
    trait_adherence: zero(),
    voice_signature: zero(),
    decision_pattern: zero(),
    relationship_handling: zero(),
    preference_respect: zero(),
    refusal_pattern: zero(),
    overall: 0,
  };
}

async function llmJudge(
  judge: LlmProvider,
  model: string,
  prompt: string
): Promise<DimensionScore> {
  try {
    const reply = await judge.chat({
      model,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 200,
    });
    const parsed = parseJudgeJson(reply.content);
    if (!parsed) return { score: 0.5, notes: "judge output not parseable" };
    return parsed;
  } catch (e) {
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
