// Verify the session replay harness — the tool that makes the sink-risk
// dial tunable. Task #29.
//
// Run: npx tsx tests/session-replay.test.ts

import { replay } from "../src/lib/instrumentation/session-replay";
import type { ReinforcementEvent } from "../src/lib/instrumentation/session-log";
import {
  DEFAULT_PROMOTION_POLICY,
  type PromotionPolicy,
} from "../src/lib/orchestrator/auto-promote";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

function reinforce(
  id: string,
  session: string,
  count: number,
  sessionsSoFar: string[],
  firstAt: string,
  lastAt: string,
  text = `heuristic about ${id}`,
  hadCorrection = false
): ReinforcementEvent {
  return {
    kind: "reinforcement",
    at: lastAt,
    session_id: session,
    memory_id: id,
    memory_text: text,
    new_count: count,
    unique_sessions: sessionsSoFar,
    first_reinforced_at: firstAt,
    last_reinforced_at: lastAt,
    importance: 0.4 + count * 0.05,
    certainty: 0.5,
    had_correction: hadCorrection,
  };
}

async function main(): Promise<void> {
  console.log("--- session-replay test ---");

  // Synthetic session: three heuristic memories with different reinforcement
  // patterns.
  //   mem-A: reinforced 3 times across 2 sessions, 5 days span → should PROMOTE under baseline
  //   mem-B: reinforced 3 times but all in one session → should NOT promote
  //   mem-C: reinforced 3 times across 2 sessions but with a user correction → should NOT promote
  const log: ReinforcementEvent[] = [
    reinforce("mem-A", "s1", 1, ["s1"], "2026-04-01", "2026-04-01"),
    reinforce("mem-A", "s1", 2, ["s1"], "2026-04-01", "2026-04-03"),
    reinforce("mem-A", "s2", 3, ["s1", "s2"], "2026-04-01", "2026-04-06"),
    reinforce("mem-B", "s1", 1, ["s1"], "2026-04-01", "2026-04-01"),
    reinforce("mem-B", "s1", 2, ["s1"], "2026-04-01", "2026-04-02"),
    reinforce("mem-B", "s1", 3, ["s1"], "2026-04-01", "2026-04-03"),
    // mem-C: correction arrived BEFORE any reinforcement could make it
    // promotable. Sticky — once flagged, never promotes under any policy.
    reinforce(
      "mem-C",
      "s1",
      1,
      ["s1"],
      "2026-04-01",
      "2026-04-01",
      "heuristic about mem-C",
      true // user correction present from the start
    ),
    reinforce(
      "mem-C",
      "s2",
      2,
      ["s1", "s2"],
      "2026-04-01",
      "2026-04-04",
      "heuristic about mem-C",
      true
    ),
    reinforce(
      "mem-C",
      "s2",
      3,
      ["s1", "s2"],
      "2026-04-01",
      "2026-04-05",
      "heuristic about mem-C",
      true
    ),
  ];

  const baseline = DEFAULT_PROMOTION_POLICY;
  // Candidate: tighter — require 4 reinforcements instead of 3.
  const tighter: PromotionPolicy = {
    min_reinforcements: 4,
    min_unique_sessions: 2,
    max_days_span: 14,
  };

  const result = replay(log, baseline, tighter);

  // Baseline expectations
  const basePromotedIds = result.baseline.would_promote.map((p) => p.memory_id);
  check(
    basePromotedIds.includes("mem-A"),
    "baseline: mem-A promotes (3 reinforcements, 2 sessions, 5-day span)"
  );
  check(
    !basePromotedIds.includes("mem-B"),
    "baseline: mem-B does NOT promote (only 1 unique session)"
  );
  check(
    !basePromotedIds.includes("mem-C"),
    "baseline: mem-C does NOT promote (had user correction)"
  );

  // Candidate (tighter) expectations — mem-A should no longer promote
  const candPromotedIds = result.candidate.would_promote.map((p) => p.memory_id);
  check(
    !candPromotedIds.includes("mem-A"),
    "tighter policy: mem-A no longer promotes (only 3 reinforcements < 4)"
  );
  check(
    result.delta.no_longer_promoted_ids.includes("mem-A"),
    "delta.no_longer_promoted includes mem-A"
  );
  check(
    result.delta.newly_promoted_ids.length === 0,
    "tighter policy has no new promotions"
  );

  // Reverse: looser policy — require only 2 reinforcements, allow 1 session
  const looser: PromotionPolicy = {
    min_reinforcements: 2,
    min_unique_sessions: 1,
    max_days_span: 14,
  };
  const looserResult = replay(log, baseline, looser);
  const looserIds = looserResult.candidate.would_promote.map((p) => p.memory_id);
  check(
    looserIds.includes("mem-B"),
    "looser policy: mem-B now promotes (1-session minimum relaxed)"
  );
  check(
    looserResult.delta.newly_promoted_ids.includes("mem-B"),
    "delta.newly_promoted includes mem-B"
  );
  check(
    !looserIds.includes("mem-C"),
    "looser policy still excludes mem-C (user correction is a hard block)"
  );

  console.log("\n--- PASS: session-replay ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
