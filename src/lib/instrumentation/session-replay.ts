// Replay the auto-promotion policy against a recorded session log with
// different thresholds. Answers questions like:
//   "If I require 4 reinforcements instead of 3, how many of today's
//   promotions would have fired?"
//   "If I shrink the window to 7 days, which heuristics would have stayed
//   heuristic?"
//
// Without this, the auto-promotion dial is untunable and the sink-risk is
// literally the entire project. See Saga task #29.

import {
  shouldPromote,
  type PromotionPolicy,
} from "../orchestrator/auto-promote";
import type { LogEvent, ReinforcementEvent } from "./session-log";

export interface ReplayPolicyCompare {
  policy: PromotionPolicy;
  would_promote: Array<{
    memory_id: string;
    memory_text: string;
    at: string;
    reinforcement_count: number;
    unique_sessions: number;
  }>;
  would_NOT_promote: Array<{
    memory_id: string;
    memory_text: string;
    reason: string;
  }>;
}

export interface ReplayResult {
  baseline: ReplayPolicyCompare;
  candidate: ReplayPolicyCompare;
  delta: {
    newly_promoted_ids: string[];
    no_longer_promoted_ids: string[];
  };
}

/** Walk the log, rebuild per-memory reinforcement state, and decide what
 *  would promote under each of two policies. The baseline is what actually
 *  happened; the candidate is what would happen under the new thresholds.
 *
 *  Crucial: we replay from the reinforcement events, not the promotion
 *  events. A memory may have many reinforcements before crossing a
 *  threshold; the policy decides at which point the promotion fires. */
export function replay(
  log: LogEvent[],
  baseline: PromotionPolicy,
  candidate: PromotionPolicy
): ReplayResult {
  const baselineResult = simulate(log, baseline);
  const candidateResult = simulate(log, candidate);

  const basePromoted = new Set(
    baselineResult.would_promote.map((p) => p.memory_id)
  );
  const candPromoted = new Set(
    candidateResult.would_promote.map((p) => p.memory_id)
  );

  return {
    baseline: baselineResult,
    candidate: candidateResult,
    delta: {
      newly_promoted_ids: [...candPromoted].filter((id) => !basePromoted.has(id)),
      no_longer_promoted_ids: [...basePromoted].filter((id) => !candPromoted.has(id)),
    },
  };
}

function simulate(log: LogEvent[], policy: PromotionPolicy): ReplayPolicyCompare {
  // Per-memory rolling state, built up by walking reinforcement events in order.
  interface State {
    count: number;
    sessions: Set<string>;
    first: string;
    last: string;
    text: string;
    had_correction: boolean;
    promoted_at?: string;
  }
  const states: Record<string, State> = {};
  const promotions: ReplayPolicyCompare["would_promote"] = [];
  const unpromoted: ReplayPolicyCompare["would_NOT_promote"] = [];

  for (const e of log) {
    if (e.kind !== "reinforcement") continue;
    const r = e as ReinforcementEvent;
    const s =
      states[r.memory_id] ??
      {
        count: 0,
        sessions: new Set(),
        first: r.at,
        last: r.at,
        text: r.memory_text,
        had_correction: false,
      };
    s.count = r.new_count;
    for (const id of r.unique_sessions) s.sessions.add(id);
    s.first = r.first_reinforced_at;
    s.last = r.last_reinforced_at;
    s.text = r.memory_text;
    s.had_correction ||= r.had_correction;
    states[r.memory_id] = s;

    if (s.promoted_at) continue; // already promoted under this policy

    if (
      shouldPromote(
        {
          reinforcement_count: s.count,
          reinforced_in_sessions: [...s.sessions],
          first_reinforced_at: s.first,
          last_reinforced_at: s.last,
        },
        policy,
        s.had_correction
      )
    ) {
      s.promoted_at = r.at;
      promotions.push({
        memory_id: r.memory_id,
        memory_text: s.text,
        at: r.at,
        reinforcement_count: s.count,
        unique_sessions: s.sessions.size,
      });
    }
  }

  for (const [rid, s] of Object.entries(states)) {
    if (s.promoted_at) continue;
    let reason = "below reinforcement threshold";
    if (s.had_correction) reason = "had user correction";
    else if (s.sessions.size < policy.min_unique_sessions)
      reason = `only ${s.sessions.size} session(s)`;
    else if (s.count < policy.min_reinforcements)
      reason = `only ${s.count} reinforcement(s)`;
    else {
      const days =
        (Date.parse(s.last) - Date.parse(s.first)) / (1000 * 60 * 60 * 24);
      if (days > policy.max_days_span) reason = `spanned ${days.toFixed(1)} days`;
    }
    unpromoted.push({ memory_id: rid, memory_text: s.text, reason });
  }

  return { policy, would_promote: promotions, would_NOT_promote: unpromoted };
}
