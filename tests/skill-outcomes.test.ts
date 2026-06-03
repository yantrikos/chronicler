// Skill outcome loop + state machine.
// Run: npx tsx tests/skill-outcomes.test.ts

import { YantrikClient } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import {
  SkillOutcomeTracker,
  scoreFromObservation,
  deriveState,
  encodeNote,
  type OutcomeRecord,
} from "../src/lib/orchestrator/skill-outcomes";
import { setSkillTransitionWriter } from "../src/lib/instrumentation/skill-transition-log";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

async function defineSkill(client: YantrikClient, id: string): Promise<void> {
  await client.skillDefine({
    skill_id: id,
    body:
      "Ren deflects emotional questions with bookshop metaphors then redirects.",
    skill_type: "pattern",
    applies_to: ["ren", "emotional"],
  });
}

async function main(): Promise<void> {
  console.log("--- skill outcome loop + state machine ---");
  setSkillTransitionWriter(() => undefined); // silence logger in test

  // -----------------------------------------------------------------
  // 1) Pure: scoreFromObservation
  // -----------------------------------------------------------------
  check(
    scoreFromObservation({
      surfaced_at_turn: 4,
      turns_observed: 3,
      regenerated_within: Infinity,
      retconned_within: Infinity,
      deleted_related: false,
    }) === 1,
    "clean run → +1"
  );
  check(
    scoreFromObservation({
      surfaced_at_turn: 4,
      turns_observed: 3,
      regenerated_within: 1,
      retconned_within: Infinity,
      deleted_related: false,
    }) === -1,
    "regen within window → -1"
  );
  check(
    scoreFromObservation({
      surfaced_at_turn: 4,
      turns_observed: 3,
      regenerated_within: Infinity,
      retconned_within: 4,
      deleted_related: false,
    }) === -1,
    "retcon within 5-turn window → -1"
  );
  check(
    scoreFromObservation({
      surfaced_at_turn: 4,
      turns_observed: 3,
      regenerated_within: Infinity,
      retconned_within: Infinity,
      deleted_related: true,
    }) === -1,
    "deleted related memory → -1"
  );
  check(
    scoreFromObservation({
      surfaced_at_turn: 4,
      turns_observed: 0,
      regenerated_within: Infinity,
      retconned_within: Infinity,
      deleted_related: false,
    }) === 0,
    "zero turns observed → 0 (no write)"
  );

  // -----------------------------------------------------------------
  // 2) +1 success path writes an outcome via client
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const tracker = new SkillOutcomeTracker(client);
    await defineSkill(client, "ren.emotional.deflects");
    const res = await tracker.record(
      "ren.emotional.deflects",
      "sess-1",
      {
        surfaced_at_turn: 4,
        turns_observed: 3,
        regenerated_within: Infinity,
        retconned_within: Infinity,
        deleted_related: false,
      },
      { currentState: "candidate" }
    );
    check(res.score === 1, "score recorded as +1");
    check(res.state_before === "candidate", "starts as candidate");
    check(res.state_after === "candidate", "single +1 not enough for active");
    const stored = transport.skillsAll()[0];
    check(stored.outcomes.length === 1, "one outcome appended to substrate");
    check(stored.outcomes[0].succeeded === true, "outcome marked succeeded");
  }

  // -----------------------------------------------------------------
  // 3) -1 regen path
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const tracker = new SkillOutcomeTracker(client);
    await defineSkill(client, "ren.emotional.deflects");
    const res = await tracker.record("ren.emotional.deflects", "sess-1", {
      surfaced_at_turn: 4,
      turns_observed: 3,
      regenerated_within: 1,
      retconned_within: Infinity,
      deleted_related: false,
    });
    check(res.score === -1, "regen produces -1");
    const stored = transport.skillsAll()[0];
    check(stored.outcomes[0].succeeded === false, "stored as failure");
    check(
      String(stored.outcomes[0].note ?? "").includes("regen@1"),
      "note encodes regen distance"
    );
  }

  // -----------------------------------------------------------------
  // 4) candidate → active: net +3 across ≥2 distinct sessions
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const tracker = new SkillOutcomeTracker(client);
    await defineSkill(client, "ren.emotional.deflects");
    const obs = {
      surfaced_at_turn: 0,
      turns_observed: 3,
      regenerated_within: Infinity,
      retconned_within: Infinity,
      deleted_related: false,
    };
    // 3 positive outcomes but all in the same session — should NOT promote
    let res = await tracker.record(
      "ren.emotional.deflects",
      "sess-1",
      { ...obs, surfaced_at_turn: 1 },
      { currentState: "candidate" }
    );
    res = await tracker.record(
      "ren.emotional.deflects",
      "sess-1",
      { ...obs, surfaced_at_turn: 2 },
      { currentState: res.state_after }
    );
    res = await tracker.record(
      "ren.emotional.deflects",
      "sess-1",
      { ...obs, surfaced_at_turn: 3 },
      { currentState: res.state_after }
    );
    check(
      res.state_after === "candidate",
      "3 outcomes in 1 session → still candidate (need ≥2 sessions)"
    );
    // Add one in a second session — now meets both thresholds
    res = await tracker.record(
      "ren.emotional.deflects",
      "sess-2",
      { ...obs, surfaced_at_turn: 1 },
      { currentState: res.state_after }
    );
    check(
      res.state_after === "active",
      `4 outcomes across 2 sessions → active (got ${res.state_after})`
    );
    check(res.transitioned === true, "transition flag set");
  }

  // -----------------------------------------------------------------
  // 5) active → suppressed: last 5 outcomes net ≤ -2
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const tracker = new SkillOutcomeTracker(client);
    await defineSkill(client, "ren.emotional.deflects");
    // Seed with 4 successes across 2 sessions to promote first
    const pos = {
      surfaced_at_turn: 0,
      turns_observed: 3,
      regenerated_within: Infinity,
      retconned_within: Infinity,
      deleted_related: false,
    };
    let state: "candidate" | "active" | "suppressed" | "archived" = "candidate";
    for (let i = 0; i < 3; i++) {
      const r = await tracker.record(
        "ren.emotional.deflects",
        "sess-1",
        { ...pos, surfaced_at_turn: i },
        { currentState: state }
      );
      state = r.state_after;
    }
    const r0 = await tracker.record(
      "ren.emotional.deflects",
      "sess-2",
      { ...pos, surfaced_at_turn: 0 },
      { currentState: state }
    );
    state = r0.state_after;
    check(state === "active", "primed to active before testing suppression");

    // Now feed 5 negatives across new sessions to flip
    const neg = {
      surfaced_at_turn: 0,
      turns_observed: 3,
      regenerated_within: 1,
      retconned_within: Infinity,
      deleted_related: false,
    };
    for (let i = 0; i < 4; i++) {
      const r = await tracker.record(
        "ren.emotional.deflects",
        "sess-3",
        { ...neg, surfaced_at_turn: 10 + i },
        { currentState: state }
      );
      state = r.state_after;
    }
    // After 4 negatives, last 5 = (pos, neg, neg, neg, neg) → net -3
    check(
      state === "suppressed",
      `last 5 outcomes net ≤ -2 → suppressed (got ${state})`
    );
  }

  // -----------------------------------------------------------------
  // 6) No double-counting: same (skill, session, turn) tuple ignored
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const tracker = new SkillOutcomeTracker(client);
    await defineSkill(client, "ren.emotional.deflects");
    const obs = {
      surfaced_at_turn: 7,
      turns_observed: 3,
      regenerated_within: Infinity,
      retconned_within: Infinity,
      deleted_related: false,
    };
    await tracker.record("ren.emotional.deflects", "sess-1", obs);
    await tracker.record("ren.emotional.deflects", "sess-1", obs);
    await tracker.record("ren.emotional.deflects", "sess-1", obs);
    const stored = transport.skillsAll()[0];
    check(
      stored.outcomes.length === 1,
      `same (skill, session, turn) only writes once (got ${stored.outcomes.length})`
    );
    check(
      tracker.hasRecorded("ren.emotional.deflects", "sess-1", 7),
      "hasRecorded reflects dedup state"
    );
  }

  // -----------------------------------------------------------------
  // 7) Pure: deriveState with synthetic outcome lists
  // -----------------------------------------------------------------
  {
    const now = new Date("2026-06-10T00:00:00Z");
    const positives = (n: number, session: string): OutcomeRecord[] =>
      Array.from({ length: n }, (_, i) => ({
        succeeded: true,
        at: `2026-06-0${(i % 9) + 1}T00:00:00Z`,
        note: encodeNote({
          session_id: session,
          ts: `2026-06-0${(i % 9) + 1}T00:00:00Z`,
          score: 1,
          reason: "clean",
        }),
      }));
    check(
      deriveState(positives(3, "s1"), now, "candidate") === "candidate",
      "3 positives in one session → candidate (sessions threshold)"
    );
    check(
      deriveState(
        [...positives(2, "s1"), ...positives(2, "s2")],
        now,
        "candidate"
      ) === "active",
      "4 across 2 sessions → active"
    );

    // 7-day idle from suppressed → archived
    const oldDate = "2026-05-15T00:00:00Z";
    const idleSuppressed: OutcomeRecord[] = [
      {
        succeeded: false,
        at: oldDate,
        note: encodeNote({
          session_id: "s-old",
          ts: oldDate,
          score: -1,
          reason: "regen",
        }),
      },
    ];
    check(
      deriveState(idleSuppressed, now, "suppressed") === "archived",
      "suppressed + 7d idle → archived"
    );
  }

  console.log("\n--- PASS: skill outcomes ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
