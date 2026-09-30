// The chronicle — which turns need a chapter, storage, merging, rendering.
// Run: npx tsx tests/chronicle.test.ts

import {
  CHUNK, MAX_EARLIER_CHARS, MAX_PROMPT_CHARS, historyStart, MERGE_AT, MERGE_COUNT, WINDOW, addChapter, applyMerge, deleteChapter, editChapter,
  emptyChronicle, mergeCandidates, nextChunk, parseChronicle, renderChronicle, resolveCovered, totalChars, type Chronicle,
} from "../src/lib/story/chronicle";
import { composeContext, renderContext } from "../src/lib/orchestrator/compose";
import { ChapterWriter, cleanChapter, dropRepeated, extractiveChapter, stepChronicle, transcriptLine } from "../src/lib/story/chronicler";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";
import type { ChatTurn } from "../src/lib/orchestrator/types";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const mkTurns = (n: number): ChatTurn[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, role: i % 2 === 0 ? "user" : "assistant", speaker: i % 2 === 0 ? "user" : "ren", content: `line ${i}`, created_at: "", session_id: "s" }) as ChatTurn);

class Canned implements LlmProvider {
  name = "c"; last: ChatRequest | null = null;
  constructor(private reply: string | Error) {}
  async chat(req: ChatRequest): Promise<ChatResponse> { this.last = req; if (this.reply instanceof Error) throw this.reply; return { content: this.reply }; }
}
const names = { userName: "Sam", characterName: "Ren" };

async function main(): Promise<void> {
  console.log("--- which turns need a chapter ---");
  const c0 = emptyChronicle();
  check(nextChunk(mkTurns(WINDOW + CHUNK - 1), c0) === null, "nothing to write while fewer than a chunk have left the window");
  const ch = nextChunk(mkTurns(WINDOW + CHUNK), c0)!;
  check(ch.from === 0 && ch.to === CHUNK && ch.turns.length === CHUNK, "once a chunk has left the window, the oldest CHUNK messages are next");
  check(nextChunk(mkTurns(WINDOW), c0) === null && nextChunk([], c0) === null, "a short chat never needs one");
  let c = addChapter(c0, "  Sam promised   Ren to return the lantern. ", ch);
  check(c.chapters[0].text === "Sam promised Ren to return the lantern." && c.covered === CHUNK && c.anchor_id === "t5", "a chapter is stored tidied, and coverage advances");
  check(nextChunk(mkTurns(WINDOW + CHUNK), c) === null, "the same messages are never written up twice");
  const more = nextChunk(mkTurns(WINDOW + 2 * CHUNK), c)!;
  check(more.from === CHUNK && more.to === 2 * CHUNK, "the next chapter starts exactly where the last ended");

  console.log("--- no message is ever in neither place ---");
  check(historyStart(38, 24) === 24, "history starts at the first message no chapter covers");
  check(historyStart(38, 24) <= 38 - WINDOW, "…and always includes at least the window");
  check(historyStart(38, 36) === 28, "when chapters cover nearly everything, the plain window is used");
  check(historyStart(38, 0) === 38 - (WINDOW + CHUNK - 1), "a chronicle still catching up cannot inflate the prompt beyond WINDOW+CHUNK-1");
  check(historyStart(5, 0) === 0 && historyStart(0, 0) === 0, "short chats show everything");
  for (let n = 0; n < 80; n++) {
    let cov = 0;
    const turns = mkTurns(n);
    for (let g = 0; g < 20; g++) { const k = nextChunk(turns, { ...emptyChronicle(), covered: cov }); if (!k) break; cov = k.to; }
    if (historyStart(n, cov) > cov) { check(false, `a gap exists at n=${n}`); }
  }
  check(true, "at every chat length, a caught-up chronicle plus the history leaves no uncovered message");

  console.log("--- edits and deletions in the chat ---");
  const t = mkTurns(40);
  const cov = { ...emptyChronicle(), covered: 12, anchor_id: "t11" };
  check(resolveCovered(t, cov) === 12, "coverage follows the anchor message");
  check(resolveCovered(t.filter((x) => x.id !== "t3"), cov) === 11, "a message deleted before the anchor shifts coverage with it");
  check(resolveCovered(t.filter((x) => x.id !== "t11"), cov) === 12, "if the anchor itself is deleted, the stored count is used");
  check(resolveCovered(mkTurns(5), { ...emptyChronicle(), covered: 12 }) === 5, "coverage never exceeds the chat length");

  console.log("--- the player's edits ---");
  const edited = editChapter(c, "c1", "Sam swore to bring the lantern back by dawn.");
  check(edited.chapters[0].edited === true && edited.chapters[0].text.startsWith("Sam swore"), "an edited chapter is marked as the player's");
  check(deleteChapter(edited, "c1").chapters.length === 0, "a chapter can be deleted");

  console.log("--- merging the oldest ---");
  // Chapter size derived from the thresholds, so the test doesn't depend on their exact values:
  // three chapters fit under MERGE_AT, four do not.
  const CH = Math.ceil((MERGE_AT + 100) / 4);
  const big = (n: number, edited = false): Chronicle => ({ ...emptyChronicle(), chapters: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, text: "x".repeat(CH), last_id: `t${i}`, edited: edited && i === 0 })), next: n + 1 });
  check(mergeCandidates(big(3)) === null, "a small chronicle is left alone");
  check(mergeCandidates(big(4))!.length === MERGE_COUNT && totalChars(big(4)) > MERGE_AT, "an oversized one offers its oldest chapters to merge");
  check(mergeCandidates(big(5, true)) === null, "a chapter the player edited is never merged away by the model");
  const merged = applyMerge(big(5), big(5).chapters.slice(0, 3), "Earlier: a lantern was promised.");
  check(merged.chapters.length === 2 && merged.earlier === "Earlier: a lantern was promised.", "merged chapters become the 'earlier' paragraph");
  check(applyMerge(merged, merged.chapters.slice(0, 1), "Earlier and then more, condensed.").earlier === "Earlier and then more, condensed.", "a later merge REPLACES 'earlier' with the re-condensed text — it never appends and chops the front");
  const seen: string[] = [];
  const spy: LlmProvider = { name: "spy", async chat(req: ChatRequest) { seen.push(req.messages[0].content); return { content: "Condensed: the promise, the name Aldous Finch, and the key." }; } };
  const withEarlier: Chronicle = { ...emptyChronicle(), earlier: "OLDEST FACT: Aldous Finch vanished.", chapters: Array.from({ length: 4 }, (_, i) => ({ id: `c${i + 1}`, text: "z".repeat(CH), last_id: `t${i}` })), covered: 24, anchor_id: "t23", next: 5 };
  await stepChronicle(withEarlier, mkTurns(WINDOW + CHUNK * 5 + 1), new ChapterWriter({ name: "s2", async chat(req: ChatRequest) { seen.push(req.messages[0].content); return { content: req.system.includes("condense") ? "Condensed: Aldous Finch vanished, and more." : "A new chapter about Sam and the lantern at dawn." }; } }, "m"), names);
  check(seen.some((p) => p.includes("OLDEST FACT: Aldous Finch vanished.")), "when merging, the model is shown the existing 'earlier' paragraph too, so its facts survive");
  void spy;

  console.log("--- what goes in the prompt ---");
  check(renderChronicle(emptyChronicle()) === "", "an empty chronicle adds nothing to the prompt");
  const two = addChapter(addChapter(emptyChronicle(), "First.  event happened", { from: 0, to: 1, turns: [mkTurns(1)[0]] }), "Second event.", { from: 1, to: 2, turns: [mkTurns(2)[1]] });
  check(renderChronicle({ ...two, earlier: "Long ago." }) === "Long ago. First. event happened Second event.", "earlier paragraph, then chapters, oldest first");
  const long = big(6);
  const out = renderChronicle(long);
  check(out.length <= MAX_PROMPT_CHARS && out.length > 0, "the prompt text is capped");
  check(renderChronicle({ ...long, chapters: [{ ...long.chapters[0], text: "OLD".repeat(300) }, { ...long.chapters[1], text: "NEWEST" }] }, 400).includes("NEWEST"), "when too long, the OLDEST chapters are left out of the prompt — recent events matter most");
  check(long.chapters.length === 6, "…but they stay stored");

  console.log("--- in the prompt ---");
  const emptyRetrieval = { canon: [], scene: [], heuristic: [], graph: [], temporal_triggers: [], pending_conflicts: 0, surfaced_skills: [], latency_ms: 0 };
  const sys = renderContext(composeContext(emptyRetrieval, [], undefined, { storySoFar: "Sam promised Ren the lantern would be back by dawn." }), "You are Ren.").system;
  check(sys.includes("<story_so_far>") && sys.includes("Sam promised Ren") && /treat it as canon/.test(sys), "the chronicle reaches the model as real history");
  check(sys.indexOf("<story_so_far>") < sys.indexOf("<canon>"), "…ahead of <canon>");
  check(!renderContext(composeContext(emptyRetrieval, []), "You are Ren.").system.includes("<story_so_far>"), "no block when there is no chronicle");

  console.log("--- storage shape ---");
  check(parseChronicle(null).chapters.length === 0 && parseChronicle("junk").covered === 0, "garbage parses to an empty chronicle");
  const rt = parseChronicle(JSON.parse(JSON.stringify(c)));
  check(rt.chapters.length === 1 && rt.anchor_id === "t5" && rt.covered === CHUNK, "a stored chronicle round-trips");
  check(parseChronicle({ chapters: [{ id: 1 }, { id: "c1", text: "ok", last_id: "t" }] }).chapters.length === 1, "malformed chapters are dropped, good ones kept");

  console.log("--- what the writer is given ---");
  const dir = { ...mkTurns(1)[0], content: "((push the plot))" };
  check(transcriptLine(dir, names) === null, "a steering directive never reaches a chapter");
  check(transcriptLine({ ...dir, content: "Hello ((secret))" }, names) === "Sam: Hello", "…and is stripped from a mixed message");
  check(transcriptLine({ ...dir, content: "", attachments: [{ id: "h", kind: "image", mime: "image/jpeg", width: 1, height: 1, description: "A brass key." }] }, names) === "Sam: *[An image is shown: A brass key.]*", "a shared image appears as its description");
  check(transcriptLine({ ...mkTurns(2)[1], content: "  Ren nods. " }, names) === "Ren: Ren nods.", "assistant lines are attributed to the character");
  check(transcriptLine({ ...mkTurns(1)[0], role: "system", speaker: "system:tool", content: "tool output" }, names) === "[narration] tool output", "system rows read as narration");

  console.log("--- cleaning model output ---");
  check(cleanChapter("Here's the chapter: Sam promised to return the lantern by dawn.") === "Sam promised to return the lantern by dawn.", "chatter before the chapter is removed");
  check(cleanChapter("<think>hmm</think>**Chapter 3:** Sam found a brass key under the floorboard.")!.startsWith("Sam found"), "reasoning, markdown and a chapter heading are removed");
  check(cleanChapter("ok") === null && cleanChapter("   ") === null, "too-short output is rejected");

  console.log("--- the writer ---");
  const p = new Canned("Sam promised Ren that the lantern would be back at the lighthouse by dawn.");
  const w = new ChapterWriter(p, "m");
  const txt = await w.write(mkTurns(6), names, "Earlier, Sam arrived in town.");
  check(txt.ok && p.last!.messages[0].content.includes("PASSAGE:") && p.last!.messages[0].content.includes("Earlier, Sam arrived in town."), "the passage and the story just before it are given");
  check(/Do NOT invent/.test(p.last!.system) && /never pronouns/.test(p.last!.system), "the prompt forbids invention and asks for names");
  const errR = await new ChapterWriter(new Canned(new Error("boom")), "m").write(mkTurns(6), names);
  check(!errR.ok && errR.reason === "error", "a provider error is reported as an error, not a crash");
  const badR = await new ChapterWriter(new Canned("ok"), "m").write(mkTurns(6), names);
  check(!badR.ok && badR.reason === "unusable", "an unusable answer is reported as unusable");
  const onlyDirectives = mkTurns(2).map((x) => ({ ...x, role: "user" as const, content: "((x))" }));
  const idle = new Canned("Should not be called at all here.");
  const emptyR = await new ChapterWriter(idle, "m").write(onlyDirectives, names);
  check(!emptyR.ok && emptyR.reason === "empty" && idle.last === null, "a passage with nothing but directives costs no call");
  check(dropRepeated("Sam arrived at the shop. Sam found a key under the floorboard.", "Sam arrived at the shop.") === "Sam found a key under the floorboard.", "a sentence copied from the story so far is dropped, the new one kept");
  check(dropRepeated("Sam arrived at the shop.", "Sam arrived at the shop!") === null, "a chapter that only repeats what is already known is rejected");
  check(dropRepeated("A brand new event occurred.", "Something else entirely happened here.") === "A brand new event occurred.", "a genuinely new chapter passes through untouched");
  const before1 = "Sam pushed open the door of The Salt Page and shook the rain from his coat as evening fell. After receiving a solemn promise that he would return the borrowed lantern to the lighthouse before dawn, Ren nodded slowly.";
  const reworded = "Sam pushed open the door of The Salt Page as evening fell and shook rain from his coat before asking Ren to borrow the brass lighthouse lantern. Later, when Sam asked who kept the lighthouse before it went dark, Ren revealed a man named Aldous Finch had vanished three winters ago.";
  const fz = dropRepeated(reworded, before1);
  check(fz !== null && !/pushed open the door/.test(fz) && /Aldous Finch/.test(fz), "a REWORDED re-telling of earlier events is dropped, the new event kept");
  check(dropRepeated("Sam found a brass key under the floorboard behind the counter.", before1) !== null, "a different event that shares a few names is not mistaken for a repeat");
  const copier = await new ChapterWriter(new Canned("Sam arrived at the shop yesterday evening. Sam found a brass key under the floorboard."), "m").write(mkTurns(6), names, "Sam arrived at the shop yesterday evening.");
  check(copier.ok && copier.text === "Sam found a brass key under the floorboard.", "the writer removes text it copied from the context it was given");
  const merge = await new ChapterWriter(new Canned("z".repeat(2000)), "m").merge(["a", "b", "c"]);
  check(merge !== null && merge.length <= MAX_EARLIER_CHARS + 1, "a merged paragraph is kept within its limit");

  console.log("--- the chronicle never stalls ---");
  const many = mkTurns(WINDOW + CHUNK * 2 + 2);
  const mkSeq = (...replies: (string | Error)[]) => {
    let i = 0;
    const prompts: string[] = [];
    const prov: LlmProvider = { name: "seq", async chat(req: ChatRequest) { prompts.push(req.messages[0].content); const r = replies[Math.min(i++, replies.length - 1)]; if (r instanceof Error) throw r; return { content: r }; } };
    return { prov, prompts };
  };
  const good = "Sam promised Ren the lantern would be back at the lighthouse by dawn.";
  let s1 = await stepChronicle(emptyChronicle(), many, new ChapterWriter(mkSeq(good).prov, "m"), names);
  check(s1 !== null && s1.chapters.length === 1 && s1.covered === CHUNK && !s1.chapters[0].fallback, "a normal step writes one chapter and advances coverage");
  check((await stepChronicle(emptyChronicle(), mkTurns(WINDOW), new ChapterWriter(mkSeq(good).prov, "m"), names)) === null, "nothing to do when no chunk has left the window");
  const down = await stepChronicle(emptyChronicle(), many, new ChapterWriter(mkSeq(new Error("offline")).prov, "m"), names);
  check(down === null, "an unreachable model changes nothing — no invented fallback, it simply tries again later");
  const seeded = addChapter(emptyChronicle(), "Sam arrived in town at dusk carrying a lantern.", nextChunk(many, emptyChronicle())!);
  const retry = mkSeq("ok", good);
  const s2 = await stepChronicle(seeded, many, new ChapterWriter(retry.prov, "m"), names);
  check(s2 !== null && s2.chapters.length === 2 && !s2.chapters[1].fallback && retry.prompts.length === 2, "an unusable answer is retried once");
  check(retry.prompts[0].includes("STORY JUST BEFORE") && !retry.prompts[1].includes("STORY JUST BEFORE"), "…without the story-so-far context, the usual trigger for a small model copying it");
  const s3 = await stepChronicle(seeded, many, new ChapterWriter(mkSeq("ok").prov, "m"), names);
  check(s3 !== null && s3.chapters[1].fallback === true && s3.covered === 2 * CHUNK, "still unusable → a plain extract, flagged, and coverage still advances");
  check(/line 6/.test(s3!.chapters[1].text) && /Sam:/.test(s3!.chapters[1].text), "the extract keeps who said what, so the facts are not lost");
  const dirs = many.map((x) => ({ ...x, role: "user" as const, speaker: "user", content: "((steer))" }));
  const s4 = await stepChronicle(emptyChronicle(), dirs, new ChapterWriter(mkSeq(good).prov, "m"), names);
  check(s4 !== null && s4.chapters.length === 0 && s4.covered === CHUNK, "a chunk that is only steering is skipped, not stuck on");
  let cc = emptyChronicle();
  const garbage = new ChapterWriter(mkSeq("ok").prov, "m");
  for (let g = 0; g < 30; g++) { const n = await stepChronicle(cc, many, garbage, names); if (!n) break; cc = n; }
  check(nextChunk(many, cc) === null && cc.chapters.length === 2 && cc.chapters.every((c) => c.fallback), "even if the model only ever returns garbage, every chunk ends up covered");
  const oversized: Chronicle = { ...emptyChronicle(), chapters: Array.from({ length: 4 }, (_, i) => ({ id: `c${i + 1}`, text: "y".repeat(CH), last_id: `t${i}` })), covered: CHUNK * 4, anchor_id: "t23", next: 5 };
  const longTurns = mkTurns(WINDOW + CHUNK * 5 + 1);
  const mrg = await stepChronicle(oversized, longTurns, new ChapterWriter(mkSeq("A brand new chapter about Sam and the lantern at dawn.", "Condensed earlier events, in brief.").prov, "m"), names);
  check(mrg !== null && mrg.earlier === "Condensed earlier events, in brief." && mrg.chapters.length < 5, "an oversized chronicle folds its oldest chapters into 'earlier' as part of the step");
  check(extractiveChapter(mkTurns(2), names).includes("Sam: line 0") , "the extract is attributed and readable");

  console.log("\n--- PASS: chronicle ---");
}

main().then(() => process.exit(0));
