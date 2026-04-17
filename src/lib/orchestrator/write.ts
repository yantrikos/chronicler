// Post-turn write path. Takes a WriteClassification (from an Extractor) and
// writes to YantrikDB with the right tier + metadata.
//
// Extraction itself lives in extract.ts. Default extractor is regex-based for
// tests and in-memory development; real deployments use HybridExtractor
// (regex + LLM) so heuristic extraction is actually smart.

import {
  YantrikClient,
  rememberAsReflex,
  rememberAsHeuristic,
  rememberAsCanon,
} from "../yantrikdb/client";
import type { ChatTurn } from "./types";
import type { Character } from "./types";
import type { Extractor, ExtractionResult } from "./extract";
import { RegexExtractor } from "./extract";

export interface WriteInput {
  session_id: string;
  speaker: string;
  character: Character;
  user_turn?: ChatTurn;
  assistant_turn?: ChatTurn;
  visible_to?: string[];
  extractor?: Extractor;
}

export async function writeTurn(
  client: YantrikClient,
  input: WriteInput
): Promise<{ reflex_rids: string[]; heuristic_rids: string[]; canon_rids: string[] }> {
  const extractor = input.extractor ?? new RegexExtractor();
  const writes = await extractor.extract(input);
  const session_id = input.session_id;
  const visible_to = input.visible_to ?? ["*"];
  const character_id = input.character.id;
  const world_id = input.character.world_id;

  const reflexInputs = writes.reflex.map((text) =>
    rememberAsReflex(text, session_id, {
      visible_to,
      character_id,
      world_id,
      source_turn_id: input.user_turn?.id ?? input.assistant_turn?.id,
    })
  );
  const heuristicInputs = writes.heuristic.map((text) =>
    rememberAsHeuristic(text, session_id, {
      visible_to,
      character_id,
      world_id,
      source_turn_id: input.user_turn?.id ?? input.assistant_turn?.id,
    })
  );
  const canonInputs = writes.canon.map((text) =>
    rememberAsCanon(text, session_id, {
      visible_to,
      character_id,
      world_id,
      source_turn_id: input.user_turn?.id,
    })
  );

  const [reflex_rids, heuristic_rids, canon_rids] = await Promise.all([
    reflexInputs.length ? client.rememberBatch(reflexInputs) : Promise.resolve([]),
    heuristicInputs.length
      ? client.rememberBatch(heuristicInputs)
      : Promise.resolve([]),
    canonInputs.length ? client.rememberBatch(canonInputs) : Promise.resolve([]),
  ]);

  return { reflex_rids, heuristic_rids, canon_rids };
}

// Back-compat shim for tests; new code should use Extractor directly.
export async function classifyTurn(input: WriteInput): Promise<ExtractionResult> {
  const extractor = input.extractor ?? new RegexExtractor();
  return extractor.extract(input);
}

/** Reinforce an existing memory — called when recall returns a memory and the
 *  orchestrator actually uses it in generation. Phase 1 records reinforcement
 *  count + last_reinforced_at; Phase 2 uses this to drive auto-promotion. */
export async function reinforce(
  client: YantrikClient,
  rid: string,
  currentMetadata: { reinforcement_count?: number; importance?: number }
): Promise<void> {
  const nextImportance = Math.min(
    1,
    (currentMetadata.importance ?? 0.4) + 0.05
  );
  await client.updateImportance(rid, nextImportance);
  // reinforcement_count + last_reinforced_at would be updated via a memory
  // update API once we expose one. For now importance decay/boost tracks it.
}
