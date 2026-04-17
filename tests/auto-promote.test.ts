// Verify the auto-promotion heuristic fires at the intended threshold.
// Run: npx tsx tests/auto-promote.test.ts

import { YantrikClient, rememberAsHeuristic } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import { reinforceAndMaybePromote, shouldPromote } from "../src/lib/orchestrator/auto-promote";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

async function main(): Promise<void> {
  console.log("--- auto-promotion threshold test ---");

  // Pure-function level: verify shouldPromote gating.
  check(
    !shouldPromote({
      reinforcement_count: 2,
      reinforced_in_sessions: ["s1", "s2"],
      first_reinforced_at: "2026-04-01T00:00:00Z",
      last_reinforced_at: "2026-04-03T00:00:00Z",
    }),
    "2 reinforcements not enough"
  );
  check(
    !shouldPromote({
      reinforcement_count: 3,
      reinforced_in_sessions: ["s1"],
      first_reinforced_at: "2026-04-01T00:00:00Z",
      last_reinforced_at: "2026-04-03T00:00:00Z",
    }),
    "3 reinforcements in 1 session not enough"
  );
  check(
    shouldPromote({
      reinforcement_count: 3,
      reinforced_in_sessions: ["s1", "s2"],
      first_reinforced_at: "2026-04-01T00:00:00Z",
      last_reinforced_at: "2026-04-03T00:00:00Z",
    }),
    "3 reinforcements across 2 sessions in <14 days promotes"
  );
  check(
    !shouldPromote(
      {
        reinforcement_count: 3,
        reinforced_in_sessions: ["s1", "s2"],
        first_reinforced_at: "2026-04-01T00:00:00Z",
        last_reinforced_at: "2026-04-20T00:00:00Z",
      },
      undefined,
      false
    ),
    "reinforcement span >14 days does not promote"
  );
  check(
    !shouldPromote(
      {
        reinforcement_count: 3,
        reinforced_in_sessions: ["s1", "s2"],
        first_reinforced_at: "2026-04-01T00:00:00Z",
        last_reinforced_at: "2026-04-05T00:00:00Z",
      },
      undefined,
      true // user correction present
    ),
    "user correction blocks promotion"
  );

  // Integration: actually reinforce a heuristic memory across 2 sessions and
  // verify the tier flips.
  const transport = new InMemoryTransport();
  const client = new YantrikClient(transport);

  const input = rememberAsHeuristic("User seems to prefer dusk walks", "sess-1", {
    character_id: "ren",
    visible_to: ["*"],
  });
  const { rid } = await client.remember(input);

  // Each turn re-recalls the memory, so we re-read state from the transport
  // before each reinforcement (matching orchestrator behavior).
  function currentResult() {
    const m = transport.all().find((x) => x.rid === rid)!;
    return {
      rid,
      text: m.text,
      type: "semantic" as const,
      score: 1,
      importance: m.importance,
      certainty: m.certainty,
      metadata: m.metadata,
    };
  }
  await reinforceAndMaybePromote(client, [currentResult()], { session_id: "sess-1" });
  await reinforceAndMaybePromote(client, [currentResult()], { session_id: "sess-1" });
  const stored = transport.all()[0];
  check(
    (stored.metadata.reinforcement_count as number) === 2,
    `reinforcement_count updated to 2 (got ${stored.metadata.reinforcement_count})`
  );
  check(
    stored.metadata.tier === "heuristic",
    "still heuristic after 2 reinforcements in 1 session"
  );
  // third reinforcement in a different session
  await reinforceAndMaybePromote(client, [currentResult()], { session_id: "sess-2" });
  const afterPromo = transport.all()[0];
  check(
    afterPromo.metadata.tier === "canon",
    `tier promoted to canon (got ${String(afterPromo.metadata.tier)})`
  );
  check(
    Array.isArray(afterPromo.metadata.promotion_history) &&
      (afterPromo.metadata.promotion_history as Array<{ reason?: string }>).some(
        (h) => h.reason === "threshold_met"
      ),
    "promotion_history records threshold_met reason"
  );

  console.log("\n--- PASS: auto-promotion test ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
