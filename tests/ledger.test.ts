// Consequence ledger — the deterministic rules, and the tracker's failure modes.
// Run: npx tsx tests/ledger.test.ts

import {
  MAX_OPEN, MAX_SHOWN, MIN_AGE, RENUDGE_AFTER, addDeeds, dismiss, dueDeeds, emptyLedger,
  looksConsequential, markAnswered, mentionsOpenDeed, markNudged, openDeeds, parseLedgerDelta, renderConsequences,
} from "../src/lib/scene/ledger";
import { LedgerTracker } from "../src/lib/scene/ledger-tracker";
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
  calls = 0;
  lastPrompt = "";
  constructor(private reply: string | Error) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls++;
    this.lastPrompt = req.messages[0].content;
    if (this.reply instanceof Error) throw this.reply;
    return { content: this.reply };
  }
}

async function main(): Promise<void> {
  console.log("--- the gate ---");
  check(!looksConsequential("Nice weather today.", "Ren nods and pours tea for the two of you."), "small talk does not trigger a model call");
  check(looksConsequential("I steal the ledger while she's turned away.", ""), "a theft does");
  check(looksConsequential("", "Odalys swore she would never tell."), "…and so does a vow in the reply");
  check(looksConsequential("I lied to him.", ""), "lies");
  check(!looksConsequential("I walk to the window and look at the harbor.", "The gulls wheel over the water."), "walking and looking do not");

  check(looksConsequential("*I slip the keeper's ledger off the desk and into my coat.*", ""), "slipping something into a coat counts (the case a narrow gate missed)");
  check(looksConsequential("I'm sorry, I shouldn't have.", "") && looksConsequential("", "You put it back. That counts."), "apologies and putting things back count");
  check(!looksConsequential("Take another cup of tea.", "Ren nods. Take your time, he says.") && !looksConsequential("Take a seat.", ""), "harmless 'take' phrases do not");
  const open1 = addDeeds(emptyLedger(), [{ deed: "Sam stole the keeper's ledger" }], 1);
  check(mentionsOpenDeed(open1, "Odalys eyes the ledger on the desk") && !mentionsOpenDeed(open1, "The tea is good tonight"), "talk about an open deed's subject triggers a look");

  console.log("--- recording deeds ---");
  let l = addDeeds(emptyLedger(), [{ deed: "Sam took the keeper's ledger.", affects: ["the keeper"], witnesses: ["Odalys", "Odalys", " "] }], 4);
  check(l.deeds.length === 1 && l.deeds[0].id === "d1" && l.deeds[0].text === "Sam took the keeper's ledger" && l.deeds[0].turn === 4, "a deed is recorded, tidied, and numbered");
  check(l.deeds[0].witnesses.join() === "Odalys", "witness names are deduped and cleaned");
  l = addDeeds(l, [{ deed: "Sam took the keeper's ledger from the drawer" }], 5);
  check(l.deeds.length === 1, "restating the same deed does not add a second one");
  l = addDeeds(l, [{ deed: "x" }, { deed: "" }], 5);
  check(l.deeds.length === 1, "junk is ignored");
  l = addDeeds(l, [{ deed: "Sam promised Ren to return before dawn" }], 6);
  check(l.deeds.length === 2 && l.deeds[1].id === "d2", "a different deed is a new entry");
  let big = emptyLedger();
  const twelve = ["stole a golden chalice", "lied about the harbor", "burned the old map", "promised safe passage", "smashed the tavern lantern",
    "betrayed the smugglers", "rescued the drowning sailor", "forged the captain's signature", "poisoned the rival's wine", "freed the caged raven",
    "revealed the hidden vault", "accused the innkeeper openly"];
  for (const [i, t] of twelve.entries()) big = addDeeds(big, [{ deed: `Sam ${t}` }], i);
  check(openDeeds(big).length === MAX_OPEN, "open deeds are capped, oldest dropped");

  console.log("--- when the world may answer ---");
  const base = addDeeds(emptyLedger(), [{ deed: "Sam stole the ledger", witnesses: ["Odalys"] }], 10);
  check(dueDeeds(base, 10 + MIN_AGE - 1).length === 0, "not due before it has aged");
  check(dueDeeds(base, 10 + MIN_AGE).length === 1, "due once it has aged");
  const nudged = markNudged(base, ["d1"], 13);
  check(dueDeeds(nudged, 13 + RENUDGE_AFTER - 1).length === 0, "not re-surfaced right after being surfaced");
  check(dueDeeds(nudged, 13 + RENUDGE_AFTER).length === 1, "…but surfaced again after a gap, so it can't be forgotten");
  let many = emptyLedger();
  for (const d of ["Sam stole gold", "Sam lied about Ren", "Sam burned the map", "Sam broke the vase"]) many = addDeeds(many, [{ deed: d }], 1);
  check(dueDeeds(many, 20).length === MAX_SHOWN, "only a couple of deeds surface at once");
  const answered = markAnswered(base, ["d1"], 14);
  check(dueDeeds(answered, 30).length === 0 && answered.deeds[0].status === "answered" && answered.deeds[0].answered_turn === 14, "an answered deed stops surfacing");
  check(markAnswered(base, ["d9"], 14) === base, "answering an unknown id changes nothing");
  check(dueDeeds(dismiss(base, "d1"), 30).length === 0, "a dismissed deed stops surfacing");

  console.log("--- rendering ---");
  const line = renderConsequences(base.deeds, 15)[0];
  check(line === "Sam stole the ledger; Odalys knows of it (5 turns ago)", "a line names the deed, who knows, and how long ago");
  check(renderConsequences(addDeeds(emptyLedger(), [{ deed: "Sam sold the map", witnesses: ["A", "B"] }], 1).deeds, 2)[0].includes("A and B know of it"), "several witnesses");

  console.log("--- parsing ---");
  const d = parseLedgerDelta('```json\n{"new":[{"deed":"Sam stole the ledger","affects":["keeper"],"witnesses":["Odalys",5]}],"answered":["d1",3]}\n```');
  check(d.new[0].witnesses!.join() === "Odalys" && d.answered.join() === "d1", "fenced JSON parses; non-strings are dropped");
  check(parseLedgerDelta("nothing to report").new.length === 0 && parseLedgerDelta('{"new": [').answered.length === 0, "prose and broken JSON mean nothing");
  check(parseLedgerDelta('{"new":[{"nope":1}]}').new.length === 0, "entries without a deed are dropped");

  console.log("--- tracker ---");
  const quiet = new Canned('{"new":[{"deed":"Sam took the ledger"}]}');
  const same = await new LedgerTracker(quiet, "m").update({ ledger: emptyLedger(), turn: 1, userName: "Sam", characterName: "Ren", present: ["Ren"], userText: "Lovely evening.", replyText: "Ren smiles and refills the teapot for you both." });
  check(quiet.calls === 0 && same.deeds.length === 0, "ordinary chatter makes no model call at all");
  const good = new Canned('{"new":[{"deed":"Sam stole the keeper\'s ledger","affects":["keeper"],"witnesses":["Odalys"]}],"answered":[]}');
  const got = await new LedgerTracker(good, "m").update({ ledger: emptyLedger(), turn: 7, userName: "Sam", characterName: "Ren", present: ["Ren", "Odalys", "Sam"], userText: "*While Odalys watches, I steal the keeper's ledger from the desk.* ((keep it tense))", replyText: "Ren's eyes narrow as the ledger disappears into your coat." });
  check(got.deeds.length === 1 && got.deeds[0].witnesses.join() === "Odalys" && got.deeds[0].turn === 7, "a real deed is recorded with its witness");
  check(!good.lastPrompt.includes("keep it tense"), "OOC directives never reach the ledger tracker");
  const invented = new Canned('{"new":[{"deed":"Sam burned down the cathedral","witnesses":["The Pope"]}]}');
  const none = await new LedgerTracker(invented, "m").update({ ledger: emptyLedger(), turn: 2, userName: "Sam", characterName: "Ren", present: ["Ren"], userText: "I steal a candle.", replyText: "Ren watches you slip a candle into your pocket quietly." });
  check(none.deeds.length === 0, "a deed nobody said is not recorded");
  const withOpen = addDeeds(emptyLedger(), [{ deed: "Sam stole the ledger" }], 1);
  const ans = await new LedgerTracker(new Canned('{"new":[],"answered":["d1","d99"]}'), "m").update({ ledger: withOpen, turn: 9, userName: "Sam", characterName: "Odalys", present: ["Odalys", "Sam"], userText: "Sorry about the ledger.", replyText: "Odalys forgave you for the theft, but insisted you return the stolen ledger." });
  check(ans.deeds[0].status === "answered", "an open deed the characters responded to is marked answered");
  const two = addDeeds(emptyLedger(), [{ deed: "Sam stole the keeper's ledger" }, { deed: "Sam promised to return Ren's lantern" }], 1);
  const sweep = await new LedgerTracker(new Canned('{"new":[],"answered":["d1","d2"]}'), "m").update({ ledger: two, turn: 9, userName: "Sam", characterName: "Odalys", present: ["Odalys", "Sam"], userText: "*I put the ledger back.* I'm sorry.", replyText: "Odalys picks up the ledger. You put it back. We'll say no more about it." });
  check(sweep.deeds[0].status === "answered" && sweep.deeds[1].status === "open", "resolving one deed does not sweep away an unrelated open one");
  const bad = await new LedgerTracker(new Canned(new Error("boom")), "m").update({ ledger: withOpen, turn: 9, userName: "S", characterName: "R", present: [], userText: "I lie.", replyText: "A long enough reply about the lying that happened." });
  check(bad === withOpen, "a provider error leaves the ledger unchanged");
  const junk = await new LedgerTracker(new Canned("I can't help with that."), "m").update({ ledger: withOpen, turn: 9, userName: "S", characterName: "R", present: [], userText: "I lie.", replyText: "A long enough reply about the lying that happened." });
  check(junk.deeds.length === 1 && junk.deeds[0].status === "open", "a non-JSON answer changes nothing");

  console.log("\n--- PASS: ledger ---");
}

main().then(() => process.exit(0));
