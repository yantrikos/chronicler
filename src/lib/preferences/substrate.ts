// Preference substrate adapter — translates between Preference records
// and YantrikDB memories in the `preferences:<character_id>` namespace.
//
// Each preference is one memory:
//   text     = the human statement ("Adira likes long verbal teasing")
//   metadata = the structured fields (state, level, sensitivity, etc.)
//   importance = a snapshot of confidence at write time
//
// This keeps the substrate dumb (it's just memories) while giving us a
// typed surface for the rest of the app. State changes use
// memory.update_metadata so we never lose history.

import type { YantrikClient } from "../yantrikdb/client";
import type {
  InspectorPreference,
  InterpretationLevel,
  Polarity,
  Preference,
  PreferenceEvidence,
  PreferenceState,
  Sensitivity,
} from "./types";

const NS = (character_id: string) => `preferences:${character_id}`;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** Stable id from the statement so we can dedup across formation runs. */
export function preferenceId(character_id: string, statement: string): string {
  return `pref-${slugify(character_id)}-${slugify(statement)}`;
}

export async function writePreference(
  client: YantrikClient,
  pref: Omit<Preference, "id"> & { id?: string }
): Promise<string> {
  const id =
    pref.id ?? preferenceId(pref.character_id, pref.statement);
  const namespace = NS(pref.character_id);
  // Pack our typed fields into ChroniclerMetadata. The pref_* keys are
  // additional fields the substrate ignores; ChroniclerMetadata is loose
  // enough to accept them via the namespace's metadata pass-through.
  const metadata = {
    tier: "canon" as const, // preferences are durable; not really tier'd
    canonical_status: "canon" as const,
    visible_to: ["*"],
    character_id: pref.character_id,
    session_id: "preference_substrate",
    // Extra typed fields — packed as metadata extension. TypeScript
    // narrows ChroniclerMetadata strictly so we use an object spread
    // with the cast to satisfy the type checker while keeping field
    // intent visible.
    ...({
      pref_id: id,
      pref_state: pref.state,
      pref_level: pref.interpretation_level,
      pref_sensitivity: pref.sensitivity,
      pref_polarity: pref.polarity,
      pref_scope: pref.scope,
      pref_confidence: pref.confidence,
      pref_evidence_json: JSON.stringify(pref.evidence),
      pref_created_at: pref.created_at,
      counterparty_character_id: pref.counterparty_character_id,
      known_by_json: pref.known_by ? JSON.stringify(pref.known_by) : undefined,
      last_confirmed_at: pref.last_confirmed_at,
      last_contradicted_at: pref.last_contradicted_at,
    } as Record<string, unknown>),
  };
  const { rid } = await client.remember({
    text: pref.statement,
    namespace,
    importance: pref.confidence,
    certainty: pref.confidence,
    source: "system",
    metadata,
  });
  return rid;
}

/** Pull all preferences for a character. Parses each memory's metadata
 *  back into the typed Preference shape, skipping any malformed ones. */
export async function listPreferences(
  client: YantrikClient,
  character_id: string
): Promise<InspectorPreference[]> {
  const rows = await client.listMemoriesInNamespace(NS(character_id), 300);
  const out: InspectorPreference[] = [];
  for (const r of rows) {
    const m = (r as { metadata?: Record<string, unknown> }).metadata ?? {};
    const state = m.pref_state as PreferenceState | undefined;
    const level = m.pref_level as InterpretationLevel | undefined;
    const sensitivity = m.pref_sensitivity as Sensitivity | undefined;
    const polarity = (m.pref_polarity as Polarity | undefined) ?? "positive";
    if (!state || !level || !sensitivity) continue;
    let evidence: PreferenceEvidence[] = [];
    try {
      const raw = m.pref_evidence_json;
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) evidence = parsed as PreferenceEvidence[];
      }
    } catch {
      /* keep empty */
    }
    let known_by: string[] | undefined;
    try {
      const raw = m.known_by_json;
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) known_by = parsed as string[];
      }
    } catch {
      /* skip */
    }
    out.push({
      id: String(m.pref_id ?? ""),
      rid: (r as { rid?: string }).rid ?? "",
      character_id,
      counterparty_character_id:
        (m.counterparty_character_id as string | undefined) ?? undefined,
      known_by,
      scope: (m.pref_scope as "global" | "dyadic") ?? "global",
      interpretation_level: level,
      sensitivity,
      polarity,
      statement: (r as { text?: string }).text ?? "",
      evidence,
      state,
      confidence:
        typeof m.pref_confidence === "number"
          ? (m.pref_confidence as number)
          : (r as { importance?: number }).importance ?? 0.5,
      created_at:
        (m.pref_created_at as string | undefined) ?? new Date().toISOString(),
      last_confirmed_at: m.last_confirmed_at as string | undefined,
      last_contradicted_at: m.last_contradicted_at as string | undefined,
    });
  }
  return out;
}

/** Promote/demote/dismiss a preference by updating its metadata. The
 *  underlying memory stays — we don't actually delete preferences, we
 *  just change their state. Dismissed prefs still influence the
 *  verifier's dedup so we don't re-suggest the same one. */
export async function updatePreferenceState(
  client: YantrikClient,
  rid: string,
  state: PreferenceState,
  opts: { confirmed?: boolean; contradicted?: boolean } = {}
): Promise<void> {
  const patch: Record<string, unknown> = { pref_state: state };
  if (opts.confirmed) patch.last_confirmed_at = new Date().toISOString();
  if (opts.contradicted) patch.last_contradicted_at = new Date().toISOString();
  await client.updateMemoryMetadata(rid, patch);
}

/** Look up an existing preference by id (slug). Used by the former to
 *  avoid re-writing the same preference on every formation run; instead
 *  it should APPEND evidence to the existing one. */
export async function findPreferenceByStatement(
  client: YantrikClient,
  character_id: string,
  statement: string
): Promise<InspectorPreference | null> {
  const wanted = preferenceId(character_id, statement);
  const all = await listPreferences(client, character_id);
  return all.find((p) => p.id === wanted) ?? null;
}
