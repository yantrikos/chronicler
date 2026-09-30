// Recap gating — no "Previously on…" for a character that hasn't been played.
// Run: npx tsx tests/recap-history.test.ts

import { hasStoryHistory } from "../src/lib/recap/history";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

function main(): void {
  console.log("--- recap history test ---");
  check(!hasStoryHistory([], "ren"), "no sessions → no history");
  check(
    !hasStoryHistory([{ character_ids: ["ren"], turn_count: 1 }], "ren"),
    "greeting-only session is not history"
  );
  check(
    !hasStoryHistory([{ character_ids: ["ren"], turn_count: 0 }], "ren"),
    "empty session is not history"
  );
  check(
    hasStoryHistory([{ character_ids: ["ren"], turn_count: 2 }], "ren"),
    "a session with a reply is history"
  );
  check(
    !hasStoryHistory([{ character_ids: ["mei"], turn_count: 40 }], "ren"),
    "another character's play does not count"
  );
  check(
    hasStoryHistory(
      [
        { character_ids: ["mei"], turn_count: 40 },
        { character_ids: ["ren", "mei"], turn_count: 5 },
      ],
      "ren"
    ),
    "a group session including the character counts"
  );
  console.log("\n--- PASS: recap-history ---");
}

main();
