// Per-turn retrieval pipeline. Kicks off recalls + graph pulls + temporal
// checks + conflict scan IN PARALLEL. Serial retrieval feels awful.
// See Saga task #8.

import { YantrikClient, type RecallResult } from "../yantrikdb/client";
import { ns } from "../yantrikdb/types";
import type { TurnRequest } from "./types";

export interface SurfacedSkill {
  skill_id: string;
  body: string;
  skill_type: string;
  applies_to: string[];
  score?: number;
  uses?: number;
  success_rate?: number;
}

export interface RetrievalResult {
  canon: RecallResult[];
  scene: RecallResult[];
  heuristic: RecallResult[];
  graph: RecallResult[];
  temporal_triggers: string[];
  pending_conflicts: number;
  /** Skills surfaced from skill_substrate ranked by relevance. State
   *  filtering (suppressed/archived hidden) happens in compose so the
   *  pipeline stays I/O-only. */
  surfaced_skills: SurfacedSkill[];
  latency_ms: number;
}

/** Retrieve everything the orchestrator needs for a given turn. Recall is
 *  filtered by the `speaker` so a character can only see memories whose
 *  visible_to includes them (or is "*"). See scene.ts for the ACL model. */
export async function retrieveForTurn(
  client: YantrikClient,
  req: TurnRequest
): Promise<RetrievalResult> {
  const t0 = performance.now();
  const query = req.user_message?.content ?? "";
  // When a CHARACTER is the speaker (it's their turn), retrieval must be
  // scoped to what that character can see. When the USER is the speaker,
  // we use the character-being-replied-to as the visibility subject (the
  // user sees everything their characters see via the inspector anyway).
  const visibilitySubject =
    req.speaker === "user" ? req.character.id : req.speaker;
  const speaker = visibilitySubject;
  const charNs = ns.character(req.character.id);
  // Union the character's legacy single-world field with the new
  // world_ids[] array — characters can belong to multiple worlds and
  // every world's namespace contributes canon recalls.
  const worldIds = new Set<string>();
  if (req.character.world_id) worldIds.add(req.character.world_id);
  for (const w of req.character.world_ids ?? []) worldIds.add(w);
  const sessionNs = ns.session(req.session_id);

  // Fan out per-world canon recalls in parallel with the main calls.
  const worldRecallPromise = Promise.all(
    [...worldIds].map((wid) =>
      client.recall({
        query,
        namespace: ns.world(wid),
        speaker,
        tier: "canon",
        top_k: 8,
        expand_entities: true,
      })
    )
  );

  const [canonChar, worldRecalls, scene, heuristic, tempUp, _tempStale, conflicts, skills] =
    await Promise.all([
      // Canon memories for active character
      client.recall({
        query,
        namespace: charNs,
        speaker,
        tier: "canon",
        top_k: 12,
        expand_entities: true,
      }),
      worldRecallPromise,
      // Recent scene state (reflex tier, session-scoped)
      client.recall({
        query: query || "recent scene",
        namespace: sessionNs,
        speaker,
        tier: ["reflex", "heuristic"],
        top_k: 10,
      }),
      // Heuristic candidates for character
      client.recall({
        query,
        namespace: charNs,
        speaker,
        tier: "heuristic",
        top_k: 8,
      }),
      // Temporal upcoming (scene hooks)
      client.temporalUpcoming(charNs).catch(() => ({ result: "[]" })),
      // Temporal stale (unresolved threads)
      client.temporalStale(charNs).catch(() => ({ result: "[]" })),
      // Conflicts pending for the character
      client.conflictPending(charNs).catch(() => ({ result: "[]" })),
      // Surfaced skills — query is the current user message, scoped to the
      // active character. Returns top 10; compose filters by derived state.
      client.skillSurface(query || "current scene", {
        applies_to: [req.character.id],
        top_k: 10,
      }),
    ]);

  const t1 = performance.now();

  return {
    canon: mergeRankByScore([
      canonChar.results,
      ...worldRecalls.map((w) => w.results),
    ]),
    scene: scene.results,
    heuristic: heuristic.results,
    graph: [], // filled later by graph.depth from current turn entities (Phase 2)
    temporal_triggers: extractTriggers(tempUp),
    pending_conflicts: countConflicts(conflicts),
    surfaced_skills: skills.map((s) => ({
      skill_id: s.skill_id,
      body: s.body,
      skill_type: s.skill_type,
      applies_to: s.applies_to,
      score: s.score,
      uses: s.uses,
      success_rate: s.success_rate,
    })),
    latency_ms: Math.round(t1 - t0),
  };
}

function mergeRankByScore(batches: RecallResult[][]): RecallResult[] {
  const seen = new Set<string>();
  const flat: RecallResult[] = [];
  for (const batch of batches) {
    for (const r of batch) {
      if (!seen.has(r.rid)) {
        seen.add(r.rid);
        flat.push(r);
      }
    }
  }
  return flat.sort((a, b) => b.score - a.score);
}

function extractTriggers(tempRes: unknown): string[] {
  try {
    const r = tempRes as { result?: unknown };
    const parsed =
      typeof r.result === "string" ? JSON.parse(r.result) : tempRes;
    if (Array.isArray(parsed)) return parsed.map((x) => String(x.text ?? x));
    if (parsed?.triggers)
      return parsed.triggers.map((x: { text?: string }) => x.text ?? "");
    return [];
  } catch {
    return [];
  }
}

function countConflicts(res: unknown): number {
  try {
    const r = res as { result?: unknown };
    const parsed = typeof r.result === "string" ? JSON.parse(r.result) : res;
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed?.conflicts) return parsed.conflicts.length;
    if (parsed?.count) return parsed.count;
    return 0;
  } catch {
    return 0;
  }
}
