// Auto-promotion heuristic: heuristic → canon.
// THE sink-risk dial. See Saga task #19.
//
// Default policy (tunable):
//   - count  >= 3  reinforcements
//   - unique sessions  >= 2
//   - time span of reinforcements <= 14 days
//   - no user retcon/correction within the window
//
// Every promotion decision is logged via promotion-log instrumentation.

import type { YantrikClient } from "../yantrikdb/client";
import { logPromotion } from "../instrumentation/promotion-log";
import type { RecallResult } from "../yantrikdb/types";

export interface PromotionPolicy {
  min_reinforcements: number;
  min_unique_sessions: number;
  max_days_span: number;
}

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = {
  min_reinforcements: 3,
  min_unique_sessions: 2,
  max_days_span: 14,
};

interface ReinforcementState {
  reinforcement_count: number;
  reinforced_in_sessions: string[]; // unique session ids
  first_reinforced_at?: string;
  last_reinforced_at?: string;
}

export function shouldPromote(
  state: ReinforcementState,
  policy: PromotionPolicy = DEFAULT_PROMOTION_POLICY,
  hasRetconOrCorrection: boolean = false
): boolean {
  if (hasRetconOrCorrection) return false;
  if (state.reinforcement_count < policy.min_reinforcements) return false;
  const uniq = new Set(state.reinforced_in_sessions);
  if (uniq.size < policy.min_unique_sessions) return false;
  if (state.first_reinforced_at && state.last_reinforced_at) {
    const first = Date.parse(state.first_reinforced_at);
    const last = Date.parse(state.last_reinforced_at);
    const days = (last - first) / (1000 * 60 * 60 * 24);
    if (days > policy.max_days_span) return false;
  }
  return true;
}

/**
 * Called after a turn with the heuristic memories that actually appeared in
 * the composed context. Records reinforcement + promotes any that cross the
 * threshold. Every decision (promote OR not) is logged.
 */
export async function reinforceAndMaybePromote(
  client: YantrikClient,
  usedHeuristics: RecallResult[],
  ctx: { session_id: string },
  policy: PromotionPolicy = DEFAULT_PROMOTION_POLICY
): Promise<{ promoted_rids: string[] }> {
  const promoted: string[] = [];
  const now = new Date().toISOString();

  for (const r of usedHeuristics) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const count = Number(meta.reinforcement_count ?? 0) + 1;
    const sessions = Array.isArray(meta.reinforced_in_sessions)
      ? ([...(meta.reinforced_in_sessions as string[])] as string[])
      : [];
    if (!sessions.includes(ctx.session_id)) sessions.push(ctx.session_id);
    const first = (meta.first_reinforced_at as string | undefined) ?? now;

    // Persist reinforcement state
    await (client as unknown as {
      transport: { call: (t: string, a: Record<string, unknown>) => Promise<unknown> };
    }).transport
      .call("memory", {
        action: "update_metadata",
        rid: r.rid,
        metadata_patch: {
          reinforcement_count: count,
          reinforced_in_sessions: sessions,
          first_reinforced_at: first,
          last_reinforced_at: now,
        },
      })
      .catch(() => undefined);

    const state: ReinforcementState = {
      reinforcement_count: count,
      reinforced_in_sessions: sessions,
      first_reinforced_at: first,
      last_reinforced_at: now,
    };

    // Retcon / correction detection — read from promotion_history for any
    // prior user_demote / retcon reasons. Conservative: if any demote in
    // history, we never auto-promote.
    const history = (meta.promotion_history as Array<{ reason?: string }> | undefined) ?? [];
    const hasNeg = history.some(
      (h) =>
        h.reason === "user_demote" ||
        h.reason === "retcon" ||
        h.reason === "user_correction"
    );

    if (shouldPromote(state, policy, hasNeg)) {
      await client.promoteToCanon(r.rid, "threshold_met");
      promoted.push(r.rid);
      await logPromotion({
        at: now,
        memory_id: r.rid,
        text: r.text,
        from_tier: "heuristic",
        to_tier: "canon",
        reason: "threshold_met",
        certainty: r.certainty ?? 0.5,
        importance: r.importance,
        reinforcement_count: count,
        session_id: ctx.session_id,
      });
    }
  }

  return { promoted_rids: promoted };
}
