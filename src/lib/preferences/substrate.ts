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

/** Marker prefix that signals "this text body has structured preference
 *  data embedded." We encode the typed fields in the body itself because
 *  YantrikDB's memory.list / recall responses don't include the metadata
 *  map (verified empirically against v1.27+). The human-readable
 *  statement appears at the end so recall snippets still show something
 *  meaningful. */
const PREF_MARKER = "__GRIMOIRE_PREF_V1__";
const PREF_END = "__END_PREF__";

function encodePreferenceText(pref: Preference): string {
  const payload = {
    id: pref.id,
    character_id: pref.character_id,
    counterparty_character_id: pref.counterparty_character_id,
    known_by: pref.known_by,
    scope: pref.scope,
    state: pref.state,
    interpretation_level: pref.interpretation_level,
    sensitivity: pref.sensitivity,
    polarity: pref.polarity,
    confidence: pref.confidence,
    evidence: pref.evidence,
    created_at: pref.created_at,
    last_confirmed_at: pref.last_confirmed_at,
    last_contradicted_at: pref.last_contradicted_at,
  };
  return `${PREF_MARKER}\n${JSON.stringify(payload)}\n${PREF_END}\n${pref.statement}`;
}

/** Parse a preference text body. Returns null if the body doesn't carry
 *  the marker (older entries written before this encoding shipped). */
function decodePreferenceText(
  text: string,
  fallbackRid: string,
  fallbackCharacterId: string
): InspectorPreference | null {
  if (!text.startsWith(PREF_MARKER)) return null;
  const endIdx = text.indexOf(PREF_END);
  if (endIdx === -1) return null;
  const jsonStart = PREF_MARKER.length + 1; // skip marker + newline
  const jsonStr = text.slice(jsonStart, endIdx).trim();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  const statement = text.slice(endIdx + PREF_END.length).trim();
  if (!statement) return null;
  return {
    id: String(payload.id ?? ""),
    rid: fallbackRid,
    character_id:
      (payload.character_id as string | undefined) ?? fallbackCharacterId,
    counterparty_character_id:
      (payload.counterparty_character_id as string | undefined) ?? undefined,
    known_by: Array.isArray(payload.known_by)
      ? (payload.known_by as string[])
      : undefined,
    scope: ((payload.scope as "global" | "dyadic" | undefined) ?? "global"),
    state: payload.state as PreferenceState,
    interpretation_level: payload.interpretation_level as InterpretationLevel,
    sensitivity: payload.sensitivity as Sensitivity,
    polarity:
      (payload.polarity as Polarity | undefined) ?? "positive",
    statement,
    evidence: Array.isArray(payload.evidence)
      ? (payload.evidence as PreferenceEvidence[])
      : [],
    confidence:
      typeof payload.confidence === "number"
        ? (payload.confidence as number)
        : 0.5,
    created_at:
      (payload.created_at as string | undefined) ?? new Date().toISOString(),
    last_confirmed_at: payload.last_confirmed_at as string | undefined,
    last_contradicted_at: payload.last_contradicted_at as string | undefined,
  };
}

export async function writePreference(
  client: YantrikClient,
  pref: Omit<Preference, "id"> & { id?: string }
): Promise<string> {
  const id =
    pref.id ?? preferenceId(pref.character_id, pref.statement);
  const namespace = NS(pref.character_id);
  // Standard metadata for tier/canon/visibility. The pref_* fields used
  // to live here too but YantrikDB's read API doesn't return metadata,
  // so we encode them in the text body instead (see encodePreferenceText).
  const metadata = {
    tier: "canon" as const,
    canonical_status: "canon" as const,
    visible_to: ["*"],
    character_id: pref.character_id,
    session_id: "preference_substrate",
  };
  const fullPref: Preference = { ...pref, id } as Preference;
  const { rid } = await client.remember({
    text: encodePreferenceText(fullPref),
    namespace,
    importance: pref.confidence,
    certainty: pref.confidence,
    source: "system",
    metadata,
  });
  return rid;
}

/** Pull all preferences for a character. Each row's text body is a
 *  marker-wrapped JSON payload (see encodePreferenceText); rows without
 *  the marker are legacy entries from before the encoding-in-text fix
 *  and are silently skipped (they can't be parsed reliably). */
export async function listPreferences(
  client: YantrikClient,
  character_id: string
): Promise<InspectorPreference[]> {
  const rows = await client.listMemoriesInNamespace(NS(character_id), 300);
  const out: InspectorPreference[] = [];
  for (const r of rows) {
    const text = (r as { text?: string }).text ?? "";
    const rid = (r as { rid?: string }).rid ?? "";
    const parsed = decodePreferenceText(text, rid, character_id);
    if (parsed) out.push(parsed);
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
  opts: { confirmed?: boolean; contradicted?: boolean; characterId?: string } = {}
): Promise<void> {
  // The preference fields live in the text body (YantrikDB strips
  // metadata on read). To update state, we need to find the row,
  // delete it, and re-write with the new state. The characterId is
  // required to scope the listPreferences search; callers pass it
  // through from the InspectorPreference's character_id field.
  if (!opts.characterId) {
    // Best-effort fallback: try to find the row by listing all
    // preference namespaces would be expensive. For now, require the
    // caller to pass characterId; if absent, skip the update.
    console.warn(
      "[grimoire/preferences] updatePreferenceState called without characterId; cannot locate row"
    );
    return;
  }
  const all = await listPreferences(client, opts.characterId);
  const target = all.find((p) => p.rid === rid);
  if (!target) {
    console.warn(`[grimoire/preferences] no row with rid ${rid} found for character ${opts.characterId}`);
    return;
  }
  // Delete old row, write new one with updated state. The rid changes
  // (new write = new rid); callers that cache rids need to refresh.
  await client.forget(rid).catch(() => undefined);
  const updated: Preference = {
    ...target,
    state,
    last_confirmed_at: opts.confirmed
      ? new Date().toISOString()
      : target.last_confirmed_at,
    last_contradicted_at: opts.contradicted
      ? new Date().toISOString()
      : target.last_contradicted_at,
  };
  await writePreference(client, updated);
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
