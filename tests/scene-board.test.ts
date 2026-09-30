// Scene board — deterministic state handling, tolerant parsing, and the
// tracker's failure modes. Run: npx tsx tests/scene-board.test.ts

import {
  applyDelta, editScene, emptySceneState, isEmptyScene, parseSceneDelta, renderSceneStatus, MAX_LIST,
} from "../src/lib/scene/state";
import { SceneTracker, isGrounded, restoreUnremoved, hasRemovalEvidence } from "../src/lib/scene/tracker";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

class Canned implements LlmProvider {
  name = "canned";
  lastPrompt = "";
  constructor(private reply: string | Error) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.lastPrompt = req.messages[0].content;
    if (this.reply instanceof Error) throw this.reply;
    return { content: this.reply };
  }
}

async function main(): Promise<void> {
  console.log("--- applying changes ---");
  let s = emptySceneState();
  check(isEmptyScene(s), "starts empty");
  s = applyDelta(s, { location: "The Salt Page", time: "late evening", present: { add: ["Ren", "Ava"] } });
  check(s.location === "The Salt Page" && s.present.join() === "Ren,Ava", "sets fields and adds to lists");
  s = applyDelta(s, { present: { remove: ["ava"], add: ["Mei"] } });
  check(s.present.join() === "Ren,Mei", "remove is case-insensitive; add appends");
  s = applyDelta(s, { present: { add: ["REN"] } });
  check(s.present.length === 2, "duplicates (any case) are not added twice");
  s = applyDelta(s, { inventory: ["lantern", "map"] });
  check(s.inventory.join() === "lantern,map", "a bare array replaces the list");

  console.log("--- junk and limits ---");
  const before = s;
  check(applyDelta(s, { location: "unknown", mood: "N/A", time: "" }) === before, "'unknown'/'N/A'/empty never overwrite a real value");
  check(applyDelta(s, { location: null }) === before, "null leaves it unchanged");
  check(applyDelta(s, {}) === before, "an empty delta returns the very same object");
  const many = applyDelta(emptySceneState(), { goals: { add: Array.from({ length: 20 }, (_, i) => `goal ${i}`) } });
  check(many.goals.length === MAX_LIST && many.goals[MAX_LIST - 1] === "goal 19", "lists are capped, newest kept");
  const long = applyDelta(emptySceneState(), { location: "x".repeat(300) });
  check((long.location ?? "").length <= 80, "over-long values are truncated");
  check(applyDelta(emptySceneState(), { location: "  *The Docks.*  " }).location === "The Docks", "markup and stray punctuation are trimmed");

  console.log("--- manual edits ---");
  const edited = editScene(s, { location: "", time: "  dawn  ", present: ["A", "a", "B", ""] });
  check(edited.location === undefined, "a manual edit can clear a field (a model delta cannot)");
  check(edited.time === "dawn" && edited.present.join() === "A,B", "manual lists are deduped and cleaned");
  check(editScene(s, {}).inventory.join() === s.inventory.join(), "untouched fields are kept");

  console.log("--- parsing model output ---");
  check(parseSceneDelta('{"location":"Docks"}').location === "Docks", "plain JSON");
  check(parseSceneDelta('```json\n{"mood":"tense"}\n```').mood === "tense", "code fences");
  check(parseSceneDelta('<think>hmm</think>Sure! {"time":"dawn"} hope that helps').time === "dawn", "think blocks and chatter");
  check(Object.keys(parseSceneDelta("no json here")).length === 0, "prose → no change");
  check(Object.keys(parseSceneDelta('{"location": ')).length === 0, "broken JSON → no change");
  check(Object.keys(parseSceneDelta("[1,2]")).length === 0, "an array is not a delta");
  const d = parseSceneDelta('{"present":{"add":["A",5,null],"remove":["B"]},"goals":["g"]}');
  check(JSON.stringify(d.present) === '{"add":["A"],"remove":["B"]}' && Array.isArray(d.goals), "non-string list entries are dropped");

  console.log("--- rendering ---");
  check(renderSceneStatus(emptySceneState()).length === 0, "nothing known → no lines");
  const lines = renderSceneStatus({ location: "Docks", present: ["Ren"], goals: ["find the key"], inventory: ["lantern"], time: "dusk" });
  check(lines[0] === "Location: Docks" && lines.includes("Present: Ren") && lines.some((l) => l.startsWith("The player is carrying")),
    "renders location first, then time, present, objectives, inventory");

  console.log("--- tracker ---");
  const start = applyDelta(emptySceneState(), { location: "The Salt Page" });
  const ok = new SceneTracker(new Canned('{"time":"midnight","inventory":{"add":["brass key"]}}'), "m");
  const after = await ok.update({ state: start, userName: "Sam", characterName: "Ren", userText: "I pocket the key. ((slow down))", replyText: "Ren nods and lowers the lamp as the clock strikes twelve." });
  check(after.time === "midnight" && after.inventory[0] === "brass key" && after.location === "The Salt Page", "folds the model's delta into the board");
  const canned = new Canned("{}");
  await new SceneTracker(canned, "m").update({ state: start, userName: "Sam", characterName: "Ren", userText: "hi ((secret directive))", replyText: "Ren waves a slow hello from behind the counter." });
  check(!canned.lastPrompt.includes("secret directive"), "OOC directives never reach the tracker");
  check(canned.lastPrompt.includes("Location: The Salt Page"), "the current board is sent so it can report only changes");
  const failing = new SceneTracker(new Canned(new Error("boom")), "m");
  check((await failing.update({ state: start, userName: "S", characterName: "R", replyText: "A long enough reply to be considered here." })) === start, "a provider error leaves the board unchanged");
  const garbage = new SceneTracker(new Canned("I cannot help with that."), "m");
  check((await garbage.update({ state: start, userName: "S", characterName: "R", replyText: "A long enough reply to be considered here." })) === start, "a non-JSON answer leaves the board unchanged");
  const spy = new Canned("{}");
  await new SceneTracker(spy, "m").update({ state: start, userName: "S", characterName: "R", replyText: "ok" });
  check(spy.lastPrompt === "", "trivially short replies do not spend a call");

  console.log("--- board mode guards ---");
  const walk = "*I pocket the key.* Then let's go find the keeper. *Ren locks up and they walk down to the docks.*";
  check(restoreUnremoved(["brass key", "lantern"], ["lantern"], walk, "item").join() === "brass key,lantern",
    "an item the model silently dropped is restored when the text shows no removal");
  check(restoreUnremoved(["brass key", "lantern"], ["lantern"], "I hand her the brass key. She nods.", "item").join() === "lantern",
    "…but an item really handed over is removed");
  check(!hasRemovalEvidence("brass key", "I pocket the key and nod.", "item"), "pocketing is not removal");
  check(hasRemovalEvidence("Odalys", "She tips her cap and Odalys walks off into the fog.", "person"), "a person walking off is evidence");
  check(hasRemovalEvidence("Odalys", "Odalys turns the key over. She tips her cap and walks off.", "person"),
    "a pronoun sentence borrows the name from the sentence before");
  check(hasRemovalEvidence("Odalys", "*Odalys pockets it.* It is. Thank you. *She tips her cap and walks off along the pier.*", "person"),
    "action markup and a two-sentence gap don't hide who left");
  check(!hasRemovalEvidence("Ren", "Ren pulls on his coat. Sam leaves the shop.", "person", ["Sam"]),
    "…but not when it names someone else on the board");
  check(restoreUnremoved(["Ren", "Odalys"], ["Ren", "Odalys"], "", "person").join() === "Ren,Odalys", "an unchanged list is unchanged");
  check(isGrounded("brass key", "she slid the key across") && !isGrounded("golden crown", "she slid the key across"),
    "additions must be mentioned in the exchange");
  const boardTracker = new SceneTracker(new Canned('{"location":"Docks","inventory":[],"present":["Ren"]}'), "m", "board");
  const held = applyDelta(emptySceneState(), { inventory: ["brass key"], present: ["Ren", "Sam"] });
  const kept = await boardTracker.update({ state: held, userName: "Sam", characterName: "Ren", replyText: "They walk down to the harbor docks in the rain together." });
  check(kept.inventory.join() === "brass key" && kept.present.includes("Sam"),
    "end to end: a silent wipe of inventory/people is undone");
  check(kept.location === "Docks", "…while a real change (the move) is applied");
  const invented = new SceneTracker(new Canned('{"present":["Ren","Mysterious Stranger"]}'), "m", "board");
  const noInvent = await invented.update({ state: applyDelta(emptySceneState(), { present: ["Ren"] }), userName: "Sam", characterName: "Ren", replyText: "Ren nods at the counter and says nothing for a while." });
  check(!noInvent.present.includes("Mysterious Stranger"), "a person nobody mentioned is not added");

  console.log("\n--- PASS: scene-board ---");
}

main().then(() => process.exit(0));
