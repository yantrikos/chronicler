// Preference substrate — character-level memory of habits, tastes,
// dynamics, and limits. Distinct from skills (tactical behaviors) and
// from drift signals (dyadic relationship shifts). Three-round
// brainstorm (gpt-5.4 + deepseek + claude) converged on this schema.
//
// Storage: YantrikDB namespace `preferences:<character_id>`. Each
// preference is one memory in that namespace; the structured fields
// below live in metadata (prefixed `pref_*` so they don't collide with
// existing memory metadata).
//
// Three axes (the load-bearing design decision — NOT a topic-based split):
//
//   interpretation_level: how far from the literal text
//     - observation: literal quote/action from a turn ("Adira asked to be teased first")
//     - interpretation: inferred pattern across turns ("Adira likes verbal teasing before touch")
//     - identity_label: archetype compression (sub/dom/brat/etc) — NEVER auto-generated
//
//   sensitivity: harm-cost-if-wrong
//     - ordinary: low-stakes (foods, hobbies, conversation style)
//     - private: intimate, requires user confirmation before prompt injection
//     - limit: hard limits/dislikes/aversions; surface aggressively, one-click to inject
//
//   scope: who this applies between (v1: always character-global; schema
//     supports dyadic for v2)
//
// State machine:
//   observed → never injected raw; evidence base for interpretations
//   candidate → awaiting threshold or user confirmation
//   active → in prompt
//   dismissed → user said no; permanent unless fresh strong evidence
//
// Brakes against runaway self-reinforcement:
//   - pre/post-activation evidence weighting (evidence collected BEFORE the
//     preference was active counts more than after — defeats self-confirming
//     loops where the prompt makes the character perform the preference)
//   - contradiction detection (user actions contradicting an active
//     preference demote its confidence)
//   - trailing prompt instruction softening "remembered tendencies, not rules"

export type PreferenceState =
  | "observed"
  | "candidate"
  | "active"
  | "dismissed";

export type InterpretationLevel =
  | "observation"
  | "interpretation"
  | "identity_label";

export type Sensitivity = "ordinary" | "private" | "limit";

export type Polarity = "positive" | "negative";

export interface PreferenceEvidence {
  session_id: string;
  /** rid of the source memory (when known). */
  rid?: string;
  source: "scene" | "user_statement" | "character_statement";
  /** True if this evidence was collected BEFORE the parent preference
   *  became active in the prompt. Weighted more than post-activation
   *  evidence by the state-machine — the load-bearing brake against
   *  self-confirming loops. */
  pre_activation: boolean;
  /** Short excerpt of the supporting text, for the inspector UI's
   *  "evidence" section. ≤200 chars. */
  text_excerpt?: string;
}

export interface Preference {
  /** Stable id; ascii-folded slug of the statement for dedup. */
  id: string;
  character_id: string;
  /** Schema only in v1 — dyadic extraction lands v2. */
  counterparty_character_id?: string;
  /** Schema only in v1 — `known_by` graph edges land v2. */
  known_by?: string[];
  scope: "global" | "dyadic";
  interpretation_level: InterpretationLevel;
  sensitivity: Sensitivity;
  polarity: Polarity;
  /** The preference itself. Third-person, character-named.
   *  Example: "Adira likes long verbal teasing before any touch." */
  statement: string;
  evidence: PreferenceEvidence[];
  state: PreferenceState;
  /** 0..1; combination of evidence count, source quality, contradictions. */
  confidence: number;
  created_at: string;
  last_confirmed_at?: string;
  last_contradicted_at?: string;
}

/** Inspector-friendly view of a preference; identical to Preference plus
 *  the rid (yantrikdb memory id) so we can update/dismiss without
 *  re-fetching. */
export interface InspectorPreference extends Preference {
  rid: string;
}
