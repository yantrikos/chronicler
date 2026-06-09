// Core trait promotion orchestration — Phase 11 Pillar 1.
//
// Runs per-character on session-start. Walks the skill substrate, finds
// any active skill that meets quantitative criteria, runs each through
// the verifier, and persists accepted verdicts as core-trait promotions
// in localStorage.
//
// Also handles the inverse: any core trait whose success rate has dropped
// below the demotion threshold gets de-crystallized back to active.

import type { YantrikClient } from "../yantrikdb/client";
import { logSkillTransition } from "../instrumentation/skill-transition-log";
import {
  decodeNote,
  type OutcomeRecord,
} from "../orchestrator/skill-outcomes";
import {
  clearCoreTraitPromotion,
  listCoreTraitsForCharacter,
  loadCoreTraitPromotions,
  setCoreTraitPromotion,
  type CoreTraitPromotion,
} from "./core-trait-promotions";
import {
  CoreTraitVerifier,
  type CoreTraitCandidate,
} from "./core-trait-verifier";

/** Default promotion criteria. Tunable per saga discussion. */
export const PROMOTION_CRITERIA = {
  /** Minimum sum of (+1 / -1) outcomes. */
  min_net_score: 8,
  /** Minimum count of distinct sessions that produced positive outcomes. */
  min_distinct_sessions: 4,
  /** Minimum elapsed days since first observation. */
  min_days_active: 7,
  /** Minimum success_rate (positive / total observed). */
  min_success_rate: 0.6,
} as const;

/** Default demotion criteria. Symmetric: easy to lose, easy to regain. */
export const DEMOTION_CRITERIA = {
  /** Below this success_rate the trait demotes. */
  max_success_rate: 0.3,
  /** Computed over outcomes in the last N days. */
  rolling_window_days: 30,
  /** Minimum outcomes inside the window before the rolling rate is trusted
   *  enough to demote. Prevents one bad turn from triggering demotion. */
  min_window_outcomes: 5,
} as const;

interface ActiveSkill {
  skill_id: string;
  body: string;
  applies_to: string[];
  outcomes: OutcomeRecord[];
}

interface QuantitativeEvidence {
  total_net_score: number;
  reinforcement_count: number;
  distinct_sessions: number;
  days_active: number;
  success_rate: number;
  first_at: string;
}

export interface PromotionRunResult {
  /** Skills promoted during this run. */
  promoted: Array<{ skill_id: string; reasoning: string; rank: number }>;
  /** Skills demoted during this run. */
  demoted: Array<{ skill_id: string; reason: "low_success_rate" }>;
  /** Eligible-by-numbers but rejected by the verifier. */
  rejected: Array<{ skill_id: string; reasoning: string; duplicate_of?: string }>;
  /** Skills that didn't meet quantitative criteria — skipped silently. */
  skipped_quantitative: number;
}

export class CoreTraitPromoter {
  constructor(
    private client: YantrikClient,
    private verifier: CoreTraitVerifier
  ) {}

  /** Run a full promote+demote pass for one character. Idempotent —
   *  re-running shortly after a previous run is a no-op (the verifier's
   *  per-session cache short-circuits repeated calls). */
  async run(opts: {
    character_id: string;
    character_name: string;
    now?: Date;
  }): Promise<PromotionRunResult> {
    const now = opts.now ?? new Date();
    const promoted: PromotionRunResult["promoted"] = [];
    const demoted: PromotionRunResult["demoted"] = [];
    const rejected: PromotionRunResult["rejected"] = [];
    let skipped_quantitative = 0;

    // ── Pass 1: promotion candidates ─────────────────────────────
    const allSkills = await this.fetchSkillsWithOutcomes(opts.character_id);
    const existing = listCoreTraitsForCharacter(opts.character_id).map(
      (e) => ({
        skill_id: e.skill_id,
        body: "", // filled below if we need it
        rank: e.promotion.rank,
      })
    );
    // Hydrate existing trait bodies for the verifier prompt (so it can
    // detect duplication semantically).
    const existingMap = new Map<string, ActiveSkill>();
    for (const s of allSkills) existingMap.set(s.skill_id, s);
    for (const e of existing) {
      const live = existingMap.get(e.skill_id);
      if (live) e.body = live.body;
    }
    const existingIds = new Set(existing.map((e) => e.skill_id));

    for (const skill of allSkills) {
      if (existingIds.has(skill.skill_id)) continue; // already crystallized

      const evidence = computeEvidence(skill, now);
      if (!meetsPromotionCriteria(evidence)) {
        skipped_quantitative++;
        continue;
      }

      const candidate: CoreTraitCandidate = {
        skill_id: skill.skill_id,
        body: skill.body,
        character_id: opts.character_id,
        character_name: opts.character_name,
        existing_core_traits: existing.filter((e) => e.body.length > 0),
        evidence: {
          total_net_score: evidence.total_net_score,
          reinforcement_count: evidence.reinforcement_count,
          distinct_sessions: evidence.distinct_sessions,
          days_active: evidence.days_active,
          success_rate: evidence.success_rate,
        },
      };

      const verdict = await this.verifier.verify(candidate);
      if (!verdict.is_core_trait) {
        rejected.push({
          skill_id: skill.skill_id,
          reasoning: verdict.reasoning,
          duplicate_of: verdict.duplicate_of,
        });
        continue;
      }

      const promotion: CoreTraitPromotion = {
        crystallized_at: now.toISOString(),
        evidence: {
          total_net_score: evidence.total_net_score,
          reinforcement_count: evidence.reinforcement_count,
          distinct_sessions: evidence.distinct_sessions,
          days_active: evidence.days_active,
          success_rate: evidence.success_rate,
        },
        rank: verdict.rank_estimate,
        verifier_reasoning: verdict.reasoning,
        character_id: opts.character_id,
      };
      setCoreTraitPromotion(skill.skill_id, promotion);
      existing.push({
        skill_id: skill.skill_id,
        body: skill.body,
        rank: verdict.rank_estimate,
      });
      existingIds.add(skill.skill_id);

      await logSkillTransition({
        at: now.toISOString(),
        skill_id: skill.skill_id,
        body: skill.body,
        from_state: "active",
        to_state: "core_trait",
        reason: "crystallized_to_core_trait",
        net_score: evidence.total_net_score,
        total_outcomes: skill.outcomes.length,
        distinct_sessions: evidence.distinct_sessions,
      });

      promoted.push({
        skill_id: skill.skill_id,
        reasoning: verdict.reasoning,
        rank: verdict.rank_estimate,
      });
    }

    // ── Pass 2: demotion sweep ────────────────────────────────────
    const promotionsMap = loadCoreTraitPromotions();
    for (const [skill_id, promotion] of promotionsMap) {
      if (promotion.character_id !== opts.character_id) continue;
      const skill = allSkills.find((s) => s.skill_id === skill_id);
      if (!skill) continue;

      if (shouldDemote(skill, now)) {
        clearCoreTraitPromotion(skill_id);
        await logSkillTransition({
          at: now.toISOString(),
          skill_id,
          body: skill.body,
          from_state: "core_trait",
          to_state: "active",
          reason: "decrystallized_to_active",
          net_score: promotion.evidence.total_net_score,
          total_outcomes: skill.outcomes.length,
          distinct_sessions: promotion.evidence.distinct_sessions,
        });
        demoted.push({ skill_id, reason: "low_success_rate" });
      }
    }

    return { promoted, demoted, rejected, skipped_quantitative };
  }

  /** Fetch all skills scoped to a character with their outcome history. */
  private async fetchSkillsWithOutcomes(
    character_id: string
  ): Promise<ActiveSkill[]> {
    const list = await this.client.skillList({
      applies_to: [character_id],
      limit: 200,
    });
    const out: ActiveSkill[] = [];
    for (const s of list) {
      const full = await this.client.skillGet(s.skill_id);
      if (!full) continue;
      out.push({
        skill_id: s.skill_id,
        body: s.body,
        applies_to: s.applies_to,
        outcomes: ((full.outcomes ?? []) as Array<{
          succeeded: boolean;
          note?: string;
          at?: string;
        }>).map((o) => ({
          succeeded: o.succeeded,
          note: o.note,
          at: o.at ?? "",
        })),
      });
    }
    return out;
  }
}

// ── Pure helpers ────────────────────────────────────────────────────

export function computeEvidence(
  skill: { outcomes: OutcomeRecord[] },
  now: Date
): QuantitativeEvidence {
  const parsedAll = skill.outcomes
    .map((o) => ({ outcome: o, note: decodeNote(o.note) }))
    .filter((p) => p.note !== null) as Array<{
    outcome: OutcomeRecord;
    note: NonNullable<ReturnType<typeof decodeNote>>;
  }>;
  if (parsedAll.length === 0) {
    return {
      total_net_score: 0,
      reinforcement_count: 0,
      distinct_sessions: 0,
      days_active: 0,
      success_rate: 0,
      first_at: now.toISOString(),
    };
  }
  const total_net_score = parsedAll.reduce(
    (s, p) => s + (p.note.score === 1 ? 1 : -1),
    0
  );
  const distinct_sessions = new Set(parsedAll.map((p) => p.note.session_id)).size;
  const positive = parsedAll.filter((p) => p.note.score === 1).length;
  const success_rate = positive / parsedAll.length;
  const firstAtIso = parsedAll[0].note.ts;
  const firstAt = new Date(firstAtIso).getTime();
  const days_active = Math.max(
    0,
    (now.getTime() - firstAt) / (1000 * 60 * 60 * 24)
  );
  return {
    total_net_score,
    reinforcement_count: positive,
    distinct_sessions,
    days_active,
    success_rate,
    first_at: firstAtIso,
  };
}

export function meetsPromotionCriteria(e: QuantitativeEvidence): boolean {
  return (
    e.total_net_score >= PROMOTION_CRITERIA.min_net_score &&
    e.distinct_sessions >= PROMOTION_CRITERIA.min_distinct_sessions &&
    e.days_active >= PROMOTION_CRITERIA.min_days_active &&
    e.success_rate >= PROMOTION_CRITERIA.min_success_rate
  );
}

export function shouldDemote(
  skill: { outcomes: OutcomeRecord[] },
  now: Date
): boolean {
  const windowMs =
    DEMOTION_CRITERIA.rolling_window_days * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;
  const parsed = skill.outcomes
    .map((o) => ({ outcome: o, note: decodeNote(o.note) }))
    .filter((p) => p.note !== null) as Array<{
    outcome: OutcomeRecord;
    note: NonNullable<ReturnType<typeof decodeNote>>;
  }>;
  const inWindow = parsed.filter(
    (p) => new Date(p.note.ts).getTime() >= cutoff
  );
  if (inWindow.length < DEMOTION_CRITERIA.min_window_outcomes) return false;
  const positive = inWindow.filter((p) => p.note.score === 1).length;
  const rate = positive / inWindow.length;
  return rate < DEMOTION_CRITERIA.max_success_rate;
}
