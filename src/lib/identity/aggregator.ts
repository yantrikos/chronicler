// Phase 11 Pillar 3 — identity aggregator.
//
// Combines the self-model substrate (Pillar 2), core traits substrate
// (Pillar 1), drift state, active preferences, and skill outcome
// history into a single typed object the IdentityInspector renders.
//
// Pure read-only: no LLM calls, no substrate writes. Sources are passed
// in (already-hydrated state from App.tsx) rather than fetched here,
// so the aggregator is trivially testable.

import {
  listCoreTraitsForCharacter,
  type CoreTraitPromotion,
} from "../skills/core-trait-promotions";
import type { SelfModel } from "./self-model-types";
import type { InspectorSkill } from "../../components/Inspector/SkillInspector";

export interface InspectorCoreTrait {
  skill_id: string;
  body: string;
  rank: number;
  crystallized_at: string;
  verifier_reasoning: string;
  evidence: CoreTraitPromotion["evidence"];
  /** True iff the trait is currently injecting into the prompt
   *  (not disabled by user override and the body is resolvable). */
  active_in_prompt: boolean;
}

export interface InspectorIdentity {
  character_id: string;
  character_name: string;
  self_model: SelfModel | null;
  core_traits: InspectorCoreTrait[];
  /** Sorted by crystallized_at ascending — oldest crystallization first
   *  so the timeline reads left-to-right as the character developed. */
  crystallization_timeline: InspectorCoreTrait[];
  /** Distinct sessions counted across all skill outcomes for this
   *  character (rough sense of "how much time has been spent here"). */
  sessions_observed: number;
  /** ISO timestamp of the first crystallization, or null when no core
   *  traits exist yet. Used by the inspector header for "crystallized
   *  since day N." */
  crystallized_since: string | null;
}

export function aggregateIdentity(args: {
  character_id: string;
  character_name: string;
  self_model: SelfModel | null;
  skills: InspectorSkill[];
  /** Per-skill_id set of "user disabled in inspector"; pulled from the
   *  same overrides path the existing SkillInspector uses. We treat
   *  disabled traits as not-active-in-prompt. */
  disabled_skill_ids: Set<string>;
}): InspectorIdentity {
  const promotions = listCoreTraitsForCharacter(args.character_id);
  const skillsById = new Map(args.skills.map((s) => [s.skill_id, s]));

  const coreTraits: InspectorCoreTrait[] = [];
  for (const { skill_id, promotion } of promotions) {
    const live = skillsById.get(skill_id);
    const body = live?.body ?? "";
    coreTraits.push({
      skill_id,
      body,
      rank: promotion.rank,
      crystallized_at: promotion.crystallized_at,
      verifier_reasoning: promotion.verifier_reasoning,
      evidence: promotion.evidence,
      active_in_prompt: body.length > 0 && !args.disabled_skill_ids.has(skill_id),
    });
  }

  const timeline = [...coreTraits].sort((a, b) =>
    a.crystallized_at.localeCompare(b.crystallized_at)
  );
  const crystallizedSince = timeline.length > 0 ? timeline[0].crystallized_at : null;

  // Roughly count distinct sessions across this character's skills. Each
  // skill exposes uses + success_rate; the inspector doesn't track
  // session_ids directly, but the total uses across all skills is a
  // reasonable proxy. For the "first crystallization" baseline we use
  // promotion evidence which carries distinct_sessions explicitly.
  const sessionsObserved = timeline.reduce(
    (max, t) => Math.max(max, t.evidence.distinct_sessions),
    0
  );

  return {
    character_id: args.character_id,
    character_name: args.character_name,
    self_model: args.self_model,
    core_traits: coreTraits, // ranked highest-first (listCoreTraits returns sorted)
    crystallization_timeline: timeline,
    sessions_observed: sessionsObserved,
    crystallized_since: crystallizedSince,
  };
}
