// Trait enactment rewrite — grounding guards and failure behaviour.
// Run: npx tsx tests/trait-enactment.test.ts

import { applyEnactments, augmentTrait, enactTrait, ensureEnactments, noNewNames, parseEnactment, traitKey } from "../src/lib/identity/trait-enactment";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
/** Replies in order (the last one repeats); an Error entry throws. */
class Canned implements LlmProvider {
  name = "c"; last: ChatRequest | null = null; calls = 0;
  private replies: (string | Error)[];
  constructor(...replies: (string | Error)[]) { this.replies = replies; }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.last = req;
    const r = this.replies[Math.min(this.calls++, this.replies.length - 1)];
    if (r instanceof Error) throw r;
    return { content: r };
  }
}

/** Answers by request kind, so any number of traits can be processed: the checker
 *  prompt gets `check`, the rewrite prompt gets `rewrite`. */
class Smart implements LlmProvider {
  name = "s"; calls = 0;
  constructor(private rewrite: string, private check: string) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls++;
    return { content: req.system.includes("stays faithful") ? this.check : this.rewrite };
  }
}

const TRAIT = "Adira apologizes through actions, not words — she doesn't say 'sorry,' she does the thing that would have prevented harm.";
const GOOD = '{"enact":"When she has caused harm, Adira does the thing that would have prevented it instead of saying sorry."}';

async function main(): Promise<void> {
  console.log("--- accepted ---");
  const ok = parseEnactment(GOOD, TRAIT, "Adira");
  check(ok !== null && ok.startsWith("When she has caused harm"), "a grounded 'When …, Name …' sentence is accepted");
  check(ok!.endsWith("."), "the result ends with a single full stop");
  check(parseEnactment("<think>hmm</think>\n```json\n" + GOOD + "\n```", TRAIT, "Adira") !== null, "think tags and code fences are tolerated");

  console.log("--- rejected ---");
  check(parseEnactment('{"enact":"Adira does the thing that would have prevented harm instead of saying sorry."}', TRAIT, "Adira") === null, "a sentence that does not start with 'When' is rejected");
  check(parseEnactment('{"enact":"When she has caused harm, Adira does the thing that would have prevented it. Then she leaves."}', TRAIT, "Adira") === null, "two sentences are rejected");
  check(parseEnactment('{"enact":"When she has caused harm, Adira mends the broken lamp that Tobin loved instead of saying sorry."}', TRAIT, "Adira") === null, "a new proper name (Tobin) is rejected as invention");
  check(parseEnactment('{"enact":"When sad."}', TRAIT, "Adira") === null, "too short is rejected");
  check(parseEnactment("not json at all", TRAIT, "Adira") === null, "non-JSON is rejected");
  check(parseEnactment('{"enact":42}', TRAIT, "Adira") === null, "a non-string value is rejected");
  check(noNewNames(TRAIT, "When she has caused harm, Adira acts.", "Adira") && !noNewNames(TRAIT, "When she has caused harm, Adira calls Maren.", "Adira"), "new capitalised names are caught, the character's own name is not");

  console.log("--- enactTrait (rewrite, then faithfulness check) ---");
  const p = new Canned(GOOD, '{"adds": false}');
  const r = await enactTrait(p, "m", "Adira", TRAIT);
  check(r !== null && p.calls === 2, "a faithful rewrite is accepted after exactly two calls");
  check(p.last !== null && (p.last.temperature ?? 1) === 0, "both calls are deterministic");
  const para = '{"enact":"When she enters a new situation, Adira scans the people and their interactions before offering any words."}';
  check((await enactTrait(new Canned(para, '{"adds": false}'), "m", "Adira", "Adira opens with quiet observation, never small talk — she reads the room before she speaks.")) !== null, "a faithful paraphrase with almost no shared words is accepted (word overlap wrongly rejected these)");
  check((await enactTrait(new Canned(GOOD, '{"adds": true}'), "m", "Adira", TRAIT)) === null, "a rewrite the checker says adds a fact is rejected");
  check((await enactTrait(new Canned(GOOD, "no idea"), "m", "Adira", TRAIT)) === null, "an unparseable check fails closed");
  check((await enactTrait(new Canned(GOOD, new Error("down")), "m", "Adira", TRAIT)) === null, "a failing check fails closed");
  check((await enactTrait(new Canned(new Error("down")), "m", "Adira", TRAIT)) === null, "a provider error on the rewrite returns null instead of throwing");
  check((await enactTrait(new Canned("garbage"), "m", "Adira", TRAIT)) === null, "an unusable rewrite returns null so the caller keeps the original trait");

  console.log("--- augmentTrait / traitKey ---");
  check(augmentTrait("T", "When x, Adira y.") === "T\n    On the page: When x, Adira y.", "the shape is exactly the one protocol v4 measured");
  check(augmentTrait("T", "") === "T" && augmentTrait("T", null) === "T" && augmentTrait("T", undefined) === "T", "no restatement means the plain trait");
  check(traitKey("Guarded  with strangers") === traitKey("guarded with strangers "), "the key ignores case and spacing");
  check(traitKey("guarded with strangers") !== traitKey("guarded with friends"), "a different trait gets a different key");

  console.log("--- applyEnactments ---");
  const cacheA = { [traitKey("alpha trait")]: "When a, X does b.", [traitKey("rejected trait")]: "" };
  const shown = applyEnactments(["alpha trait", "rejected trait", "never seen"], cacheA);
  check(shown[0] === "alpha trait\n    On the page: When a, X does b.", "a trait with a restatement is augmented");
  check(shown[1] === "rejected trait" && shown[2] === "never seen", "a rejected or missing restatement leaves the plain trait");
  check(JSON.stringify(applyEnactments(["a", "b"], {})) === JSON.stringify(["a", "b"]), "an empty cache changes nothing");

  console.log("--- ensureEnactments ---");
  const two = ["Adira apologizes through actions, not words.", "Adira is guarded with strangers."];
  const prov = new Smart(GOOD, '{"adds": false}');
  const first = await ensureEnactments(prov, "m", "Adira", two, {});
  check(first.added === 2 && prov.calls === 4, "each missing trait costs one rewrite call and one check call");
  check(first.cache[traitKey(two[0])].startsWith("When "), "the accepted restatement is cached under its trait's key");
  const before = prov.calls;
  const again = await ensureEnactments(prov, "m", "Adira", two, first.cache);
  check(again.added === 0 && prov.calls === before, "a cached trait makes no model call");
  const bad = await ensureEnactments(new Canned("garbage"), "m", "Adira", [two[1]], {});
  check(bad.cache[traitKey(two[1])] === "", "a rejected rewrite is cached as empty so it is not retried every turn");
  const retry = new Smart(GOOD, '{"adds": false}');
  await ensureEnactments(retry, "m", "Adira", [two[1]], bad.cache);
  check(retry.calls === 0, "a trait cached as rejected is not retried");
  const stop = { cancelled: true };
  const cancelled = new Smart(GOOD, '{"adds": false}');
  const c = await ensureEnactments(cancelled, "m", "Adira", two, {}, stop);
  check(c.added === 0 && cancelled.calls === 0, "a cancelled run makes no calls");
  const down = await ensureEnactments(new Canned(new Error("down")), "m", "Adira", two, {});
  check(down.added === 2 && Object.values(down.cache).every((v) => v === ""), "a provider outage never throws");

  console.log("\n--- PASS: trait-enactment ---");
}
main().then(() => process.exit(0));
