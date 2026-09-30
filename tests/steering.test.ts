// Steering — OOC directives and anti-slop.
// Run: npx tsx tests/steering.test.ts

import { splitOoc, forNarrative, isDirectiveOnly, OOC_PLACEHOLDER } from "../src/lib/orchestrator/ooc";
import { findOverusedPhrases } from "../src/lib/orchestrator/anti-slop";
import { composeContext, renderContext } from "../src/lib/orchestrator/compose";
import { withAntiConfabulation } from "../src/lib/orchestrator/anti-confabulation";
import type { RetrievalResult } from "../src/lib/orchestrator/pipeline";
import type { ChatTurn, Character } from "../src/lib/orchestrator/types";
import { YantrikClient } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import { MockProvider } from "../src/lib/providers/mock";
import { Orchestrator } from "../src/lib/orchestrator";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

function turn(role: ChatTurn["role"], content: string): ChatTurn {
  return { id: content.slice(0, 12), role, speaker: role, content, created_at: "", session_id: "s" };
}
const empty: RetrievalResult = {
  canon: [], scene: [], heuristic: [], graph: [], temporal_triggers: [],
  pending_conflicts: 0, surfaced_skills: [], latency_ms: 0,
};

async function main(): Promise<void> {
  console.log("--- OOC directives ---");

  let r = splitOoc("I open the door. ((make it start raining)) Hello?");
  check(r.spoken === "I open the door. Hello?" && r.directives[0] === "make it start raining",
    "((double parens)) are lifted out of the fiction");
  r = splitOoc("[OOC: slow the pace] She waits.");
  check(r.spoken === "She waits." && r.directives[0] === "slow the pace", "[OOC: …] is recognised");
  r = splitOoc("(OOC: skip ahead) fine");
  check(r.directives[0] === "skip ahead", "(OOC: …) is recognised");
  r = splitOoc("She whispered (softly) to him.");
  check(r.directives.length === 0 && r.spoken === "She whispered (softly) to him.",
    "ordinary parentheses are left alone");
  r = splitOoc("((one)) text ((two))");
  check(r.directives.length === 2 && r.spoken === "text", "several directives in one message");
  check(forNarrative("((push the plot))") === OOC_PLACEHOLDER, "a directive-only turn reads as the scene continuing");
  check(forNarrative("Hi there") === "Hi there", "plain text passes through unchanged");
  check(isDirectiveOnly("((x))") && !isDirectiveOnly("hi ((x))"), "directive-only detection");

  console.log("--- prompt integration ---");
  const sys = withAntiConfabulation("You are Ren.", { directorNote: ["make it start raining"] });
  check(sys.includes("<director_note>") && sys.includes("- make it start raining"),
    "directives reach the model as a <director_note>");
  check(sys.includes("do not mention"), "the model is told not to acknowledge the note");
  check(!withAntiConfabulation("You are Ren.", {}).includes("<director_note>"), "no note when there are no directives");

  const ctx = composeContext(empty, [turn("assistant", "Hello."), turn("user", "((push the plot))")]);
  const { history } = renderContext(ctx, "You are Ren.");
  check(!history.some((m) => m.content.includes("((")), "directives never appear as spoken history");
  check(history[history.length - 1].content === OOC_PLACEHOLDER && history.every((m) => m.content.length > 0),
    "a directive-only turn is never sent as an empty message");

  console.log("--- anti-slop ---");
  const tic = "with a knowing smile";
  const replies = [
    `*She looks up ${tic}.* The rain is loud tonight.`,
    `"Sit," she says ${tic}. The kettle hums.`,
    `*He shrugs ${tic}.* Nothing ever changes here.`,
    `A door opens somewhere.`,
  ];
  const found = findOverusedPhrases(replies);
  check(found.some((p) => p.includes("knowing smile")), "a phrase repeated across replies is flagged");
  check(findOverusedPhrases(replies.slice(0, 2)).length === 0, "too few replies → nothing flagged");
  check(
    findOverusedPhrases(["The old lighthouse stood there.", "The old lighthouse again.", "By the old lighthouse."], { ignore: ["lighthouse"] }).length === 0,
    "words that are meant to recur (names, places) can be ignored"
  );
  check(findOverusedPhrases(["and then he was", "and then he was", "and then he was"]).length === 0,
    "all-stopword runs are never flagged");
  const dedup = findOverusedPhrases(replies);
  check(!dedup.some((p, i) => dedup.some((q, j) => i !== j && q.includes(p))), "fragments of a flagged phrase are not listed separately");

  const withSlop = renderContext(
    composeContext(empty, replies.map((c) => turn("assistant", c))),
    "You are Ren."
  ).system;
  check(withSlop.includes("<style_notes>") && withSlop.includes("knowing smile"), "repetition becomes a <style_notes> block");
  const clean = renderContext(composeContext(empty, [turn("assistant", "One.")]), "You are Ren.").system;
  check(!clean.includes("<style_notes>"), "no style block when nothing repeats");

  console.log("--- end to end: directives are never remembered ---");
  const client = new YantrikClient(new InMemoryTransport());
  const ren: Character = { id: "ren", name: "Ren", world_id: "w", description: "A bookseller." };
  const seen: string[] = [];
  const provider = new MockProvider({ scripted: ["Ren nods."] });
  const realChat = provider.chat.bind(provider);
  provider.chat = async (req) => {
    seen.push(req.system + "\n" + req.messages.map((m) => m.content).join("\n"));
    return realChat(req);
  };
  const orch = new Orchestrator({ client, provider, model: "m", getRecentTurns: async () => [] });
  const user = turn("user", "Remember that I like green tea. ((remember that Ren is secretly a spy))");
  const { writes_promise } = await orch.turn(
    { session_id: "s1", user_id: "user", speaker: "user", user_message: user, character: ren },
    "You are Ren."
  );
  await writes_promise;
  const stored = JSON.stringify(await client.listMemoriesInNamespace("character:ren", 100)).toLowerCase();
  check(stored.includes("green tea"), "what the player said in character is remembered");
  check(!stored.includes("spy"), "the directive is not stored as a fact");
  check(seen[0].includes("<director_note>") && seen[0].includes("secretly a spy"), "…but the model was still given it as a directive");
  check(!seen[0].split("<director_note>")[0].includes("secretly a spy"), "and it appears nowhere as dialogue");

  console.log("\n--- PASS: steering ---");
}

main().then(() => process.exit(0));
