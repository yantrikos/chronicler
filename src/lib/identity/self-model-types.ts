// Phase 11 Pillar 2 — self-model types.
//
// One row per character in the `self:<character_id>` YantrikDB namespace.
// Encoded in the text body (per [[yantrikdb-strips-metadata-on-read]]):
//
//   __GRIMOIRE_SELF_V1__
//   {<json header>}
//   __END_SELF__
//   <first-person identity paragraphs>

export interface SelfModelHeader {
  character_id: string;
  generated_at: string; // ISO
  model_used: string;
  /** sha256 of the inputs (core traits bodies + canon snapshot fingerprint
   *  + drift snapshot). Used by the stale detector. */
  inputs_hash: string;
  paragraph_count: number;
  /** ISO timestamp after which the model is considered stale even if
   *  inputs haven't changed (weekly refresh cap). */
  next_refresh_after: string;
}

export interface SelfModel {
  header: SelfModelHeader;
  /** The first-person identity paragraphs that get injected into the
   *  system prompt under `<self_model>`. Plain text, paragraph-separated
   *  by blank lines. */
  body: string;
}

/** Snapshot of the inputs used to derive a self-model — passed to the
 *  generator and fingerprinted to detect staleness. */
export interface SelfModelInputs {
  character_id: string;
  character_name: string;
  core_traits: Array<{ skill_id: string; body: string; rank: number }>;
  /** Recent canon excerpts that anchor the identity (last N important). */
  canon_excerpts: string[];
  /** Drift state across known interlocutors. */
  drift_summary: string;
  /** Active preferences (string statements, no metadata). */
  active_preferences: string[];
}
