// Rule-based arc clustering.
//
// Algorithm: group canon memories by their primary linked entity. A
// memory contributes to every arc keyed on each of its entities (so a
// memory mentioning both "Mara" and "the harbor" lands in both arcs).
// Single-member arcs are kept if the entity is named — they often grow
// into real arcs over a few sessions.
//
// Status thresholds (tunable later):
//   - active:     touched within last 24h
//   - paused:     1-7 days idle
//   - abandoned:  > 14 days idle
//   - resolved:   user-set override (handled outside this module)
//
// Tunability is the point — these are folded into pure functions so we
// can adjust without rewriting the cluster pass.

import type { Arc, ArcMember, ArcStatus } from "./types";

/** Minimum text length we consider a "real" entity. Filters out 1-2 char
 *  junk that occasionally lands in metadata.entities. */
const MIN_ENTITY_LEN = 2;
/** Skip clustering on truly generic entities — they'd dominate arcs. */
const ENTITY_DENYLIST = new Set([
  "user",
  "you",
  "me",
  "i",
  "scene",
  "narrator",
]);

export interface ClusterInput {
  rid: string;
  text: string;
  importance: number;
  /** Either created_at, last_accessed_at, or whichever timestamp the
   *  caller prefers. Used as the "touched" signal for status. */
  touched_at: string;
  /** Linked entity names from memory metadata. Falls back to a naive
   *  capitalized-word extraction if missing. */
  entities?: string[];
}

export function clusterArcs(
  memories: ClusterInput[],
  now: Date = new Date()
): Arc[] {
  // Step 1: build entity → members map
  const byEntity = new Map<string, ArcMember[]>();
  for (const m of memories) {
    const ents = normalizeEntities(m.entities ?? extractFallbackEntities(m.text));
    if (ents.length === 0) continue;
    for (const e of ents) {
      if (!byEntity.has(e)) byEntity.set(e, []);
      byEntity.get(e)!.push({
        rid: m.rid,
        text: m.text,
        importance: m.importance,
        touched_at: m.touched_at,
      });
    }
  }

  // Step 2: turn each entity bucket into an Arc, sorted by importance.
  const arcs: Arc[] = [];
  for (const [entity, members] of byEntity.entries()) {
    // Dedup by rid within the bucket (a memory could be added twice if
    // the same entity appears in metadata twice).
    const seen = new Set<string>();
    const deduped = members.filter((m) => {
      if (seen.has(m.rid)) return false;
      seen.add(m.rid);
      return true;
    });
    // Order members by recency descending so the inspector shows the
    // most-recent first.
    deduped.sort((a, b) => b.touched_at.localeCompare(a.touched_at));
    const last_touched_at = deduped[0]?.touched_at ?? "1970-01-01T00:00:00Z";
    // Co-occurring entities — collected by looking at every member's
    // entity list (where present) and excluding the primary one.
    const otherEnts = new Set<string>();
    for (const m of deduped) {
      // Original entity lists aren't kept on ArcMember; re-extract from
      // text + caller-provided metadata would require threading. v1
      // ships without — adequate for the inspector.
      void m;
    }
    const titleSource = [...deduped].sort(
      (a, b) => b.importance - a.importance
    )[0];
    arcs.push({
      id: `arc:${entity}:${deduped[deduped.length - 1]?.touched_at?.slice(0, 10) ?? "epoch"}`,
      title: makeTitle(entity, titleSource?.text),
      primary_entity: entity,
      entities: [entity, ...otherEnts],
      members: deduped,
      last_touched_at,
      status: deriveStatus(last_touched_at, now),
    });
  }
  // Sort: active first, then paused, then abandoned; within each, most
  // recently touched first.
  const order: Record<ArcStatus, number> = {
    active: 0,
    paused: 1,
    abandoned: 2,
    resolved: 3,
  };
  arcs.sort((a, b) => {
    if (a.status !== b.status) return order[a.status] - order[b.status];
    return b.last_touched_at.localeCompare(a.last_touched_at);
  });
  return arcs;
}

export function deriveStatus(
  lastTouchedAt: string,
  now: Date = new Date()
): ArcStatus {
  const t = new Date(lastTouchedAt).getTime();
  if (Number.isNaN(t)) return "abandoned";
  const ageDays = (now.getTime() - t) / (1000 * 60 * 60 * 24);
  if (ageDays < 1) return "active";
  if (ageDays < 7) return "paused";
  if (ageDays >= 14) return "abandoned";
  return "paused";
}

function normalizeEntities(raw: string[] | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const e of raw) {
    if (typeof e !== "string") continue;
    const cleaned = e.trim();
    if (cleaned.length < MIN_ENTITY_LEN) continue;
    if (ENTITY_DENYLIST.has(cleaned.toLowerCase())) continue;
    out.add(cleaned);
  }
  return [...out];
}

/** Cheap fallback when memories don't carry metadata.entities: pull
 *  capitalized multi-letter words and treat the most repeated ones as
 *  entities. Imperfect but better than zero-arc output on mock backends. */
function extractFallbackEntities(text: string): string[] {
  const words = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
  if (words.length === 0) return [];
  const counts = new Map<string, number>();
  for (const w of words) {
    if (ENTITY_DENYLIST.has(w.toLowerCase())) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  // Top 3 by frequency, ties broken by first-occurrence.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
}

/** Deterministic one-line summary of active + paused arcs, suitable for
 *  prefixing onto the LLM-generated recap so users land oriented on
 *  resume. Pure rule-based — never goes near the recap LLM prompt,
 *  which is the most hallucination-prone surface in the system. */
export function summarizeActiveArcs(arcs: Arc[], cap = 5): string {
  const interesting = arcs.filter(
    (a) => a.status === "active" || a.status === "paused"
  );
  if (interesting.length === 0) return "";
  const head = interesting.slice(0, cap).map((a) => {
    // Strip the "<entity> — " prefix to leave just the entity name for
    // brevity. If the title doesn't have that shape, use it whole.
    const dashIdx = a.title.indexOf(" — ");
    return dashIdx > 0 ? a.title.slice(0, dashIdx) : a.title;
  });
  const more =
    interesting.length > cap
      ? ` (+${interesting.length - cap} more)`
      : "";
  return `Active arcs: ${head.join(", ")}${more}.`;
}

function makeTitle(entity: string, sample: string | undefined): string {
  // Prefer the entity name as the primary frame ("Arc: Mara"); if the
  // sample memory adds shape, append a short hint ("Arc: Mara — the
  // promised lessons"). Avoid LLM titling here — costs tokens per
  // refresh; can layer on later.
  if (!sample) return `Arc: ${entity}`;
  const trimmed = sample.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 60) return `${entity} — ${trimmed}`;
  return `${entity} — ${trimmed.slice(0, 57)}…`;
}
