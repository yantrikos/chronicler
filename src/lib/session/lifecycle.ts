// Session lifecycle: start, end, and post-session think.
// See Saga task #13.

import type { YantrikClient } from "../yantrikdb/client";
import { rememberAsCanon } from "../yantrikdb/client";
import type { ChatTurn, Session } from "../orchestrator/types";

export async function startSession(
  client: YantrikClient,
  opts: { user_id: string; character_ids: string[]; world_id?: string }
): Promise<Session> {
  const id = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const ns = opts.world_id
    ? `world:${opts.world_id}`
    : `character:${opts.character_ids[0]}`;
  await client.sessionStart(id, ns).catch(() => undefined);
  return {
    id,
    user_id: opts.user_id,
    character_ids: opts.character_ids,
    world_id: opts.world_id,
    created_at: new Date().toISOString(),
  };
}

export interface EndSessionResult {
  session_summary_rid?: string;
  think_result?: unknown;
}

export async function endSession(
  client: YantrikClient,
  session: Session,
  turns: ChatTurn[],
  opts: { summary?: string } = {}
): Promise<EndSessionResult> {
  await client.sessionEnd(session.id).catch(() => undefined);

  // Write a session summary as canon. If caller didn't supply one, compose
  // a minimal one from turn count + first/last turns.
  const summaryText = opts.summary ?? defaultSummary(session, turns);
  const input = rememberAsCanon(summaryText, session.id, {
    character_id: session.character_ids[0],
    world_id: session.world_id,
    visible_to: ["*"],
  });
  const { rid } = await client.remember(input);

  // Run consolidation
  const think_result = await client.think(
    session.world_id ? `world:${session.world_id}` : `character:${session.character_ids[0]}`
  ).catch(() => undefined);

  return { session_summary_rid: rid, think_result };
}

function defaultSummary(session: Session, turns: ChatTurn[]): string {
  if (turns.length === 0) return `Session ${session.id} started and ended with no turns.`;
  const first = turns[0];
  const last = turns[turns.length - 1];
  return `Session recap (session_id=${session.id}, ${turns.length} turns): began with ${
    first.role
  }: "${trim(first.content, 140)}" and ended with ${last.role}: "${trim(last.content, 140)}".`;
}

function trim(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
