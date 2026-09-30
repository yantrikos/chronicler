// Scene state — session facts reach the prompt as a <scene> block, without
// duplicating canon/history or asserting guesses.
// Run: npx tsx tests/scene-state.test.ts

import { composeContext, pickSceneState, renderContext } from "../src/lib/orchestrator/compose";
import type { RetrievalResult } from "../src/lib/orchestrator/pipeline";
import type { ChatTurn } from "../src/lib/orchestrator/types";
import type { RecallResult } from "../src/lib/yantrikdb/types";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

function rr(text: string, tier?: "reflex" | "heuristic" | "canon"): RecallResult {
  return {
    rid: text, text, type: "semantic", score: 0.5, importance: 0.5,
    metadata: tier ? ({ tier } as RecallResult["metadata"]) : undefined,
  };
}
function turn(content: string): ChatTurn {
  return { id: content, role: "user", speaker: "user", content, created_at: "", session_id: "s" };
}
function retrieval(over: Partial<RetrievalResult>): RetrievalResult {
  return {
    canon: [], scene: [], heuristic: [], graph: [], temporal_triggers: [],
    pending_conflicts: 0, surfaced_skills: [], latency_ms: 0, ...over,
  };
}

function main(): void {
  console.log("--- scene state test ---");

  const picked = pickSceneState(
    [
      rr("She is sitting on the seawall", "reflex"),
      rr("She is sitting on the seawall", "reflex"),
      rr("Ren owns The Salt Page", "reflex"),
      rr("He is probably lying", "heuristic"),
      rr("It is raining hard", "reflex"),
    ],
    [rr("Ren owns The Salt Page", "canon")],
    [turn("It is raining hard")]
  );
  check(picked.length === 1 && picked[0].text === "She is sitting on the seawall",
    "dedupes repeats, canon and text already in the recent turns, and drops heuristic guesses");

  const many = Array.from({ length: 12 }, (_, i) => rr(`fact number ${i}`, "reflex"));
  check(pickSceneState(many, [], []).length === 6, "capped at 6 facts");

  const ctx = composeContext(
    retrieval({ scene: [rr("She is sitting on the seawall", "reflex")] }),
    []
  );
  const { system } = renderContext(ctx, "You are Ren.");
  check(system.includes("<scene>") && system.includes("- She is sitting on the seawall"),
    "scene facts render as a <scene> block");
  check(system.indexOf("<canon>") < system.indexOf("<scene>"), "<scene> follows <canon>");
  check(ctx.token_usage.scene > 0 && ctx.token_usage.total >= ctx.token_usage.scene,
    "scene-state tokens are counted");

  const withStatus = renderContext(
    composeContext(retrieval({ scene: [rr("She is sitting on the seawall", "reflex")] }), [], undefined, {
      sceneStatus: ["Location: The docks", "Time: dusk"],
    }),
    "You are Ren."
  ).system;
  check(withStatus.includes("<scene>") && withStatus.includes("- Location: The docks") && withStatus.includes("- She is sitting on the seawall"),
    "status board and scene facts share one <scene> block");
  check(withStatus.indexOf("Location: The docks") < withStatus.indexOf("sitting on the seawall"), "the board comes first");
  check((withStatus.match(/<scene>/g) ?? []).length === 1, "only one <scene> block");
  const boardOnly = renderContext(composeContext(retrieval({}), [], undefined, { sceneStatus: ["Time: dusk"] }), "You are Ren.").system;
  check(boardOnly.includes("<scene>") && boardOnly.includes("- Time: dusk"), "the board alone still renders");

  const empty = renderContext(composeContext(retrieval({}), []), "You are Ren.").system;
  check(!empty.includes("<scene>"), "no <scene> block when there are no scene facts");

  console.log("\n--- PASS: scene-state ---");
}

main();
