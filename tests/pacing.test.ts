// Pacing — when a story beat fires, which one, and the guardrails.
// Run: npx tsx tests/pacing.test.ts

import {
  BEATS, COOLDOWN_TURNS, THRESHOLD, advancePacing, markBeatUsed, pickBeat, turnsUntilBeat,
} from "../src/lib/scene/pacing";
import { applyDelta, emptySceneState, type SceneState } from "../src/lib/scene/state";
import { withAntiConfabulation } from "../src/lib/orchestrator/anti-confabulation";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

function still(n: number, base: SceneState = emptySceneState()): SceneState {
  let s = base;
  for (let i = 0; i < n; i++) s = advancePacing(s, false);
  return s;
}
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

function main(): void {
  console.log("--- when a beat fires ---");
  check(pickBeat(still(50), "off") === null, "never fires when pacing is off, however still");
  check(pickBeat(still(THRESHOLD.gentle - 1), "gentle") === null, "not before the threshold");
  check(pickBeat(still(THRESHOLD.gentle), "gentle", () => 0) !== null, "fires at the threshold");
  check(THRESHOLD.lively < THRESHOLD.gentle, "lively fires sooner than gentle");
  check(pickBeat(still(THRESHOLD.lively), "lively", () => 0) !== null && pickBeat(still(THRESHOLD.lively), "gentle") === null,
    "the same stillness fires lively but not gentle");

  console.log("--- stillness counting ---");
  let s = still(6);
  check(s.calm === 6, "each still turn counts");
  s = advancePacing(s, true);
  check(s.calm === 0, "any change to the board resets it");
  check(advancePacing(emptySceneState(), true).calm === undefined || advancePacing(emptySceneState(), true).calm === 0,
    "a fresh board that changes stays at zero");
  const changed = applyDelta(still(5), { location: "Docks" });
  check((changed.calm ?? 0) === 5, "board edits by the tracker keep the counters until advancePacing runs");

  console.log("--- cooldown and repeats ---");
  const beat = pickBeat(still(THRESHOLD.gentle), "gentle", () => 0)!;
  let after = markBeatUsed(still(THRESHOLD.gentle), beat);
  check(after.calm === 0 && after.cooldown === COOLDOWN_TURNS && after.last_beat === beat.id, "using a beat resets stillness and starts the cooldown");
  after = still(THRESHOLD.gentle + 2, after);
  check(after.cooldown === 0, "the cooldown counts down with turns");
  const next = pickBeat(after, "gentle", () => 0);
  check(next !== null && next.id !== beat.id, "the same beat is never picked twice in a row");
  let cool = markBeatUsed(emptySceneState(), beat);
  cool = { ...cool, calm: 99 };
  check(pickBeat(cool, "gentle") === null, "no beat while on cooldown, however still");

  console.log("--- choosing ---");
  const ids = new Set<string>();
  for (const r of [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 0.999]) {
    const b = pickBeat(still(20), "gentle", () => r);
    if (b) ids.add(b.id);
  }
  check(ids.size >= 5, "the RNG spreads across many different beats");
  check(pickBeat(still(20), "gentle", () => 0.999999) !== null, "an RNG at the top of its range still picks a beat");
  const bare = still(20);
  check(BEATS.filter((b) => b.eligible && !b.eligible(bare)).length === 3, "goal-, NPC- and consequence-specific beats need something to work with");
  const rich = applyDelta(still(20), { goals: ["find the keeper"], present: ["Ren", "Odalys"] });
  const objective = BEATS.find((b) => b.id === "objective")!;
  check(objective.eligible!(rich) && objective.text(rich).includes("find the keeper"), "the objective beat uses the actual objective");
  const agenda = BEATS.find((b) => b.id === "agenda")!;
  check(agenda.text(rich).startsWith("Ren"), "the agenda beat names a character actually present");
  check(!agenda.eligible!(applyDelta(emptySceneState(), { present: ["You"] })), "the player is never given an 'agenda'");

  const deedCtx = { deeds: [{ id: "d1", text: "Sam stole the keeper's ledger", turn: 1, affects: [], witnesses: [], status: "open" as const }] };
  const conseq = BEATS.find((b) => b.id === "consequence")!;
  check(!conseq.eligible!(bare) && conseq.eligible!(bare, deedCtx), "the consequence beat exists only when a deed is open");
  check(conseq.text(bare, deedCtx).includes("Sam stole the keeper's ledger"), "…and names the actual deed");
  const only = pickBeat(still(20), "gentle", () => 0, deedCtx);
  check(only !== null, "pacing can draw on open deeds");

  console.log("--- display ---");
  check(turnsUntilBeat(still(3), "gentle") === THRESHOLD.gentle - 3, "counts down to the next beat");
  check(turnsUntilBeat(still(3), "off") === null, "nothing to show when off");
  check(turnsUntilBeat(markBeatUsed(still(3), beat), "lively")! >= COOLDOWN_TURNS - 0, "the cooldown counts toward the wait");

  console.log("--- in the prompt ---");
  const sys = withAntiConfabulation("You are Ren.", { storyBeat: "Someone arrives." });
  check(sys.includes("<story_beat>") && sys.includes("- Someone arrives."), "the beat reaches the model as a <story_beat>");
  check(/do not mention this note/.test(sys) && /do not announce/.test(sys), "the model is told to show it, not announce it");
  check(!withAntiConfabulation("You are Ren.", {}).includes("<story_beat>"), "no block without a beat");
  const cons = withAntiConfabulation("You are Ren.", { consequences: ["Sam stole the ledger; Odalys knows of it (5 turns ago)"] });
  check(cons.includes("<consequences>") && cons.includes("- Sam stole the ledger; Odalys knows of it"), "open deeds reach the model as <consequences>");
  check(/do not announce/.test(cons) && /do not force it into every reply/.test(cons), "the model is told to let the world answer naturally, not every turn");
  check(!withAntiConfabulation("You are Ren.", { consequences: [] }).includes("<consequences>"), "no block when nothing is open");

  console.log("\n--- PASS: pacing ---");
}

main();
