// Decompose an imported card into YantrikDB entities, seed memories, graph
// edges, and initial personality — the "card is ingress only, don't think
// in cards" rule. See Saga task #6.

import type { YantrikClient } from "../yantrikdb/client";
import { rememberAsCanon } from "../yantrikdb/client";
import type { ChroniclerMetadata } from "../yantrikdb/types";
import type { AnyCard } from "./types";

export interface DecomposedCharacter {
  character_id: string;
  world_id?: string;
  name: string;
  system_prompt: string;
  seed_rids: string[];
  lorebook_rids: string[];
  /** first_mes followed by any alternate_greetings, in card order. */
  greetings: string[];
}

export async function decomposeCard(
  client: YantrikClient,
  card: AnyCard,
  rawJson: string,
  opts: { session_id: string; user_id: string; world_id?: string } = {
    session_id: "import",
    user_id: "user",
  }
): Promise<DecomposedCharacter> {
  const data = card.data;
  const character_id = slug(data.name) + "-" + shortHash(rawJson);
  const world_id = opts.world_id;

  const metaBase: Partial<ChroniclerMetadata> = {
    character_id,
    world_id,
    visible_to: ["*"],
    raw_card: rawJson,
  };

  // Dedup on re-import: if this character already has seed canon for any of
  // these fields, don't write them again. Uses a broad recall to the
  // character namespace and matches on exact-prefix content.
  const existing = await client
    .listMemoriesInNamespace(`character:${character_id}`, 300)
    .catch(() => [] as Array<{ text?: string }>);
  const existingTexts = new Set(
    existing.map((m) => (m as { text?: string }).text ?? "").filter(Boolean)
  );
  const addIfNew = (bucket: string[], text: string) => {
    if (text && !existingTexts.has(text)) bucket.push(text);
  };

  const seeds: string[] = [];
  if (data.description)
    addIfNew(seeds, `Description of ${data.name}: ${data.description}`);
  if (data.personality)
    addIfNew(seeds, `Personality of ${data.name}: ${data.personality}`);
  if (data.scenario) addIfNew(seeds, `Scenario: ${data.scenario}`);
  if (data.first_mes)
    addIfNew(seeds, `First message template: ${data.first_mes}`);
  if (data.mes_example)
    addIfNew(seeds, `Example dialogues: ${data.mes_example}`);

  const seedInputs = seeds.map((text) =>
    rememberAsCanon(text, opts.session_id, metaBase)
  );
  const seed_rids = seedInputs.length
    ? await client.rememberBatch(seedInputs)
    : [];

  // Lorebook entries (character_book in v2/v3) — stored as canon memories
  // under a dedicated `lorebook:<character_id>` namespace with full
  // lorebook_entry metadata. The orchestrator's scanner then evaluates
  // triggers per turn and injects matching entries into the system prompt.
  const book = (
    data as {
      character_book?: {
        entries?: Array<{
          keys?: string[];
          secondary_keys?: string[];
          content?: string;
          name?: string;
          enabled?: boolean;
          insertion_order?: number;
          case_sensitive?: boolean;
          constant?: boolean;
          selective?: boolean;
          position?: "before_char" | "after_char" | string;
          comment?: string;
        }>;
      };
    }
  ).character_book;
  const lorebook_rids: string[] = [];
  if (book?.entries?.length) {
    const loreInputs = book.entries
      .filter((e) => (e.enabled ?? true) && (e.content ?? "").trim().length > 0)
      .map((e) => {
        const lorebook_entry = {
          keys: e.keys ?? [],
          secondary_keys: e.secondary_keys,
          selective: e.selective ?? false,
          constant: e.constant ?? false,
          position:
            e.position === "before_char" ? "before_char" : "after_char",
          insertion_order: e.insertion_order ?? 100,
          case_sensitive: e.case_sensitive ?? false,
          enabled: e.enabled ?? true,
          name: e.name,
          comment: e.comment,
        } as const;
        return rememberAsCanon(e.content as string, opts.session_id, {
          ...metaBase,
          // dedicated lorebook namespace keeps scanner queries cheap
          character_id,
          world_id,
          lorebook_entry: lorebook_entry as import("../yantrikdb/types").LorebookEntryMeta,
        });
      })
      // Override namespace — rememberAsCanon defaults to character:<id>.
      // Lorebook entries live under lorebook:<character_id>.
      .map((input) => ({
        ...input,
        namespace: `lorebook:${character_id}`,
      }));
    const rids = await client.rememberBatch(loreInputs);
    lorebook_rids.push(...rids);
  }

  // Graph entity for the character
  await client
    .graphRelate(data.name, character_id, "is_character")
    .catch(() => undefined);

  const greetings: string[] = [];
  if (data.first_mes) greetings.push(data.first_mes);
  if (Array.isArray(data.alternate_greetings)) {
    for (const g of data.alternate_greetings) {
      if (typeof g === "string" && g.trim().length > 0) greetings.push(g);
    }
  }

  return {
    character_id,
    world_id,
    name: data.name,
    system_prompt: buildSystemPrompt(card),
    seed_rids,
    lorebook_rids,
    greetings,
  };
}

export function buildSystemPrompt(card: AnyCard): string {
  const d = card.data;
  const parts: string[] = [];
  if (d.system_prompt) parts.push(d.system_prompt);
  parts.push(`You are ${d.name}.`);
  if (d.personality) parts.push(`Personality: ${d.personality}`);
  if (d.scenario) parts.push(`Scenario: ${d.scenario}`);
  if (d.post_history_instructions) parts.push(d.post_history_instructions);
  return parts.join("\n\n");
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function shortHash(s: string): string {
  // djb2-ish, good enough for a collision-unlikely id suffix
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).slice(0, 8);
}
