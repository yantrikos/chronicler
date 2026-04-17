// Lorebook (character_book) scanner — ports the v2/v3 community-card
// trigger mechanic on top of YantrikDB. Each entry is stored as a canon
// memory in a dedicated `lorebook:<character_id>` namespace with full
// lorebook_entry metadata; at turn time we pull all entries and decide
// which ones activate based on keyword triggers in recent messages.
//
// Compatibility notes:
//   - keys[]: any primary key matching the scan text triggers the entry
//   - secondary_keys[] + selective=true: also requires a secondary match
//   - constant=true: always active
//   - position: before_char | after_char (controls system-prompt placement)
//   - insertion_order: lower = earlier within its position group
//   - case_sensitive: per-entry match flag
//
// Skipped (future):
//   - probability / priority
//   - recursive scanning (entries triggering other entries)
//   - extensions.depth (arbitrary-depth injection into message history)

import type { YantrikClient } from "../yantrikdb/client";
import type {
  LorebookEntryMeta,
  MemoryRecord,
} from "../yantrikdb/types";

export interface ScanInput {
  character_id: string;
  world_id?: string;
  /** Concatenated recent messages to scan for trigger keywords. */
  recent_text: string;
}

export interface ActivatedEntry {
  content: string;
  position: "before_char" | "after_char";
  insertion_order: number;
  name?: string;
}

export async function scanLorebook(
  client: YantrikClient,
  input: ScanInput
): Promise<ActivatedEntry[]> {
  const namespaces = [`lorebook:${input.character_id}`];
  if (input.world_id) namespaces.push(`lorebook:${input.world_id}`);

  const batches = await Promise.all(
    namespaces.map((ns) =>
      client
        .recall({
          query: input.recent_text || "lorebook entries",
          namespace: ns,
          top_k: 200,
        })
        .catch(() => ({ results: [], count: 0, confidence: 0, hints: [] }))
    )
  );

  const seen = new Set<string>();
  const entries: { rec: MemoryRecord; meta: LorebookEntryMeta }[] = [];
  for (const batch of batches) {
    for (const r of batch.results) {
      if (seen.has(r.rid)) continue;
      const meta = (r.metadata?.lorebook_entry ??
        undefined) as LorebookEntryMeta | undefined;
      if (!meta || meta.enabled === false) continue;
      seen.add(r.rid);
      entries.push({ rec: r as unknown as MemoryRecord, meta });
    }
  }

  const activated: ActivatedEntry[] = [];
  for (const { rec, meta } of entries) {
    if (meta.constant || matchesTriggers(meta, input.recent_text)) {
      activated.push({
        content: rec.text,
        position: meta.position ?? "after_char",
        insertion_order: meta.insertion_order ?? 100,
        name: meta.name,
      });
    }
  }

  // Lower insertion_order = earlier within its position group.
  return activated.sort((a, b) => a.insertion_order - b.insertion_order);
}

function matchesTriggers(
  meta: LorebookEntryMeta,
  rawText: string
): boolean {
  const caseSensitive = meta.case_sensitive ?? false;
  const hay = caseSensitive ? rawText : rawText.toLowerCase();
  const prepare = (k: string) => (caseSensitive ? k : k.toLowerCase());

  const primaries = (meta.keys ?? []).map(prepare).filter((k) => k.length > 0);
  if (primaries.length === 0) return false;
  const anyPrimary = primaries.some((k) => hay.includes(k));
  if (!anyPrimary) return false;

  if (meta.selective && meta.secondary_keys && meta.secondary_keys.length > 0) {
    const secs = meta.secondary_keys.map(prepare).filter((k) => k.length > 0);
    const anySec = secs.some((k) => hay.includes(k));
    if (!anySec) return false;
  }
  return true;
}

/** Partition activated entries by position for injection. */
export function partitionByPosition(entries: ActivatedEntry[]): {
  before: string;
  after: string;
} {
  const before = entries
    .filter((e) => e.position === "before_char")
    .map((e) => formatEntry(e))
    .join("\n\n");
  const after = entries
    .filter((e) => e.position !== "before_char")
    .map((e) => formatEntry(e))
    .join("\n\n");
  return { before, after };
}

function formatEntry(e: ActivatedEntry): string {
  // Wrap with tag for clean separation from other prompt sections, and
  // include the entry name if present so debug/prompt-inspector is readable.
  const label = e.name ? ` name="${e.name}"` : "";
  return `<lore${label}>\n${e.content.trim()}\n</lore>`;
}
