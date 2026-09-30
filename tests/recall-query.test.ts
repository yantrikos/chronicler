// Recall query construction — short replies are anchored to what they answer.
// Run: npx tsx tests/recall-query.test.ts

import { buildRecallQuery } from "../src/lib/orchestrator/pipeline";
import type { ChatTurn } from "../src/lib/orchestrator/types";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

function turn(role: ChatTurn["role"], content: string): ChatTurn {
  return { id: content, role, speaker: role, content, created_at: "", session_id: "s" };
}

function main(): void {
  console.log("--- recall query test ---");

  const long = "Tell me about the night the lighthouse keeper vanished from Salt Coast.";
  check(
    buildRecallQuery(long, [turn("assistant", "Something else entirely.")]) === long,
    "long message is used unchanged"
  );

  const mid = "When the kitchen burned, were you sad?";
  check(
    buildRecallQuery(mid, [turn("assistant", "Poetry editions are on the left shelf.")]) === mid,
    "a real question under 60 chars is not diluted with prior turns"
  );

  const history = [
    turn("user", "Who is Adira?"),
    turn("assistant", "Adira is a wandering musician who hides a debt to the harbormaster."),
    turn("user", "ok"),
  ];
  const q = buildRecallQuery("ok", history);
  check(q.includes("harbormaster") && q.endsWith("ok"), "short reply anchored to last assistant turn");

  check(buildRecallQuery("ok", []) === "ok", "no history falls back to the message");
  check(
    buildRecallQuery("ok", [turn("user", "hi"), turn("system", "narration")]) === "ok",
    "user/system turns are not used as context"
  );
  check(buildRecallQuery("   ", history).includes("harbormaster"), "empty message uses context alone");

  const big = "x".repeat(1000);
  check(buildRecallQuery("go on", [turn("assistant", big)]).length < 260, "context is length-capped");
  check(
    buildRecallQuery("same", [turn("assistant", "same")]) === "same",
    "an echo of the message itself is not duplicated"
  );

  console.log("\n--- PASS: recall-query ---");
}

main();
