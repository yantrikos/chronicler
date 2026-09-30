// Consistency audit — grounding rules, trait parsing, session auditing.
// Run: npx tsx tests/audit.test.ts

import { ConsistencyJudge, groundFlags } from "../src/lib/audit/judge";
import { parseTraits, extractDeclaredTraits } from "../src/lib/audit/traits";
import { consistencyScore, repliesToAudit, runAudit, MAX_REPLIES } from "../src/lib/audit/run";
import type { ChatTurn } from "../src/lib/orchestrator/types";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
class Canned implements LlmProvider {
  name = "c"; last: ChatRequest | null = null; calls = 0;
  constructor(private reply: string | Error) {}
  async chat(req: ChatRequest): Promise<ChatResponse> { this.calls++; this.last = req; if (this.reply instanceof Error) throw this.reply; return { content: this.reply }; }
}
const reply = "*Ren slams his fist on the counter and shouts.* GET OUT OF MY SHOP!";

async function main(): Promise<void> {
  console.log("--- grounding ---");
  const good = groundFlags('{"contradictions":[{"trait":3,"quote":"slams his fist on the counter and shouts","why":"He shouts, violating the trait."}]}', reply, 5);
  check(good.length === 1 && good[0].trait === 3, "a flag with a real quote and a valid trait is kept");
  check(groundFlags('{"contradictions":[{"trait":3,"quote":"throws a chair across the room","why":"violent"}]}', reply, 5).length === 0, "a flag quoting words that are NOT in the reply is discarded");
  check(groundFlags('{"contradictions":[{"trait":9,"quote":"shouts","why":"x"}]}', reply, 5).length === 0 && groundFlags('{"contradictions":[{"trait":0,"quote":"shouts","why":"x"}]}', reply, 5).length === 0, "a trait number outside the list is discarded");
  check(groundFlags('{"contradictions":[{"trait":3,"quote":"SLAMS his fist on the COUNTER","why":"loud"}]}', reply, 5).length === 1, "quote matching ignores case and punctuation");
  check(groundFlags('{"contradictions":[{"trait":4,"quote":"Nothing. It\'s nothing.","why":"This aligns with trait 4 rather than contradicting it."}]}', "*She goes still.* Nothing. It's nothing.", 5).length === 0, "a flag whose own explanation says the reply is consistent is dropped");
  check(groundFlags('{"contradictions":[{"trait":1,"quote":"shouts","why":"Shouting is the opposite of quiet."},{"trait":1,"quote":"shouts","why":"again"}]}', reply, 5).length === 1, "duplicate flags collapse");
  check(groundFlags("no json", reply, 5).length === 0 && groundFlags('{"contradictions": [', reply, 5).length === 0 && groundFlags("[]", reply, 5).length === 0, "garbage output means no flags");
  check(groundFlags('<think>hmm</think>```json\n{"contradictions":[{"trait":3,"quote":"shouts","why":"loud"}]}\n```', reply, 5).length === 1, "reasoning blocks and fences are tolerated");

  console.log("--- the judge ---");
  const p = new Canned('{"contradictions":[{"trait":3,"quote":"shouts","why":"loud"}]}');
  const judge = new ConsistencyJudge(p, "m");
  const flags = await judge.judge(["Quiet", "Dry humor", "Never raises his voice"], reply, "Ren");
  check(flags.length === 1 && p.last!.messages[0].content.includes("3. Never raises his voice") && p.last!.messages[0].content.includes("Ren"), "traits are numbered for the judge and the reply is checked");
  check(/does not show a trait|simply does not show/.test(p.last!.system) || /does not show a trait/.test(p.last!.system) || /simply does not show/.test(p.last!.system), "the prompt tells it not to flag a trait that merely doesn't appear");
  const eight = Array.from({ length: 8 }, (_, i) => `Trait number ${i + 1}`);
  let seenCalls = 0;
  const groupsSeen: string[] = [];
  const grouped = new ConsistencyJudge({ name: "g", async chat(req: ChatRequest) { seenCalls++; groupsSeen.push(req.messages[0].content); return { content: seenCalls === 2 ? '{"contradictions":[{"trait":2,"quote":"shouts","why":"loud"}]}' : '{"contradictions":[]}' }; } }, "m");
  const gf = await grouped.judge(eight, reply, "Ren");
  check(seenCalls === 2 && groupsSeen[0].includes("4. Trait number 4") && !groupsSeen[0].includes("Trait number 5") && groupsSeen[1].includes("1. Trait number 5"), "more than four traits are judged in groups of four");
  check(gf.length === 1 && gf[0].trait === 6, "a flag in the second group is mapped back to its place in the full list");
  const few = new Canned('{"contradictions":[]}');
  await new ConsistencyJudge(few, "m").judge(["a trait", "another one", "third", "fourth"], reply, "Ren");
  check(few.calls === 1, "four traits or fewer cost a single call");
  const none = new Canned("x");
  check((await new ConsistencyJudge(none, "m").judge([], reply, "Ren")).length === 0 && none.calls === 0, "no traits → no call");
  check((await new ConsistencyJudge(none, "m").judge(["t"], "ok", "Ren")).length === 0 && none.calls === 0, "a trivially short reply is not sent");
  let threw = false;
  try { await new ConsistencyJudge(new Canned(new Error("down")), "m").judge(["t"], reply, "Ren"); } catch { threw = true; }
  check(threw, "an unreachable model throws, so 'could not check' is never mistaken for 'consistent'");

  console.log("--- declared traits ---");
  check(parseTraits('{"traits":["Speaks in short dry sentences.","Never raises his voice","Speaks in short dry sentences","x"]}').join("|") === "Speaks in short dry sentences|Never raises his voice", "traits are tidied, deduped, and too-short ones dropped");
  check(parseTraits("nope").length === 0 && parseTraits('{"traits":"a"}').length === 0, "garbage yields none");
  check(parseTraits(JSON.stringify({ traits: Array.from({ length: 20 }, (_, i) => `Trait number ${i} is specific enough`) })).length === 8, "at most 8 traits");
  const tp = new Canned('{"traits":["Quiet and dry","Never shouts at anyone"]}');
  check((await extractDeclaredTraits(tp, "m", "Ren", "A calm, observant bookseller. Quiet, perceptive, dry humor. Listens more than speaks.")).length === 2 && /Do NOT include backstory/.test(tp.last!.system), "traits are extracted from a card, with a prompt that excludes backstory");
  check((await extractDeclaredTraits(tp, "m", "Ren", "short")).length === 0, "a near-empty card yields none without a call");
  check((await extractDeclaredTraits(new Canned(new Error("x")), "m", "Ren", "A long enough description of a character here.")).length === 0, "a failed extraction yields none");

  console.log("--- auditing a session ---");
  const mk = (i: number, role: ChatTurn["role"], content: string): ChatTurn => ({ id: `t${i}`, role, speaker: role, content, created_at: "", session_id: "s" });
  const turns: ChatTurn[] = [];
  for (let i = 0; i < 10; i++) { turns.push(mk(i * 2, "user", "hello there")); turns.push(mk(i * 2 + 1, "assistant", `Reply number ${i} from the character, long enough`)); }
  check(repliesToAudit(turns).length === 10 && repliesToAudit(turns).every((t) => t.role === "assistant"), "only the character's replies are audited");
  check(repliesToAudit([mk(1, "assistant", "ok"), mk(2, "system", "narration that is long enough"), mk(3, "assistant", "A real reply that is long enough.")]).length === 1, "trivially short replies and non-replies are skipped");
  const many: ChatTurn[] = Array.from({ length: 100 }, (_, i) => mk(i, "assistant", `A reply that is comfortably long enough ${i}`));
  check(repliesToAudit(many).length === MAX_REPLIES && repliesToAudit(many)[MAX_REPLIES - 1].id === "t99", "a long chat is capped to the newest replies");
  const flagOn = (n: number) => async (_t: string[], reply: string) => (reply.includes(`number ${n} `) ? [{ trait: 2, quote: "x", why: "w" }] : []);
  const rep = await runAudit({ turns, sessionId: "s", traits: ["a", "b", "c"], judgeModel: "m", judge: flagOn(3), now: () => new Date("2026-01-01T00:00:00Z") });
  check(rep.audited === 10 && rep.flagged === 1 && rep.by_trait.join() === "0,1,0" && rep.findings.length === 1 && rep.findings[0].turn_id === "t7", "the report counts replies, flags and per-trait contradictions, and keeps only flagged ones");
  check(consistencyScore(rep) === 0.9 && consistencyScore({ audited: 0, flagged: 0 }) === null, "score is the share of replies with no contradiction; none audited means no score");
  const flaky = await runAudit({ turns, sessionId: "s", traits: ["a"], judgeModel: "m", judge: async (_t, r) => { if (r.includes("number 4 ")) throw new Error("down"); return []; } });
  check(flaky.audited === 9 && flaky.errors === 1 && flaky.flagged === 0, "a reply the judge could not check is counted as an error, never as consistent");
  let n = 0;
  const cancelled = await runAudit({ turns, sessionId: "s", traits: ["a"], judgeModel: "m", judge: async () => [], shouldCancel: () => n++ > 3, concurrency: 1 });
  check(cancelled.partial === true && cancelled.audited < 10, "a cancelled run is marked partial");
  const seenProgress: number[] = [];
  await runAudit({ turns, sessionId: "s", traits: ["a"], judgeModel: "m", judge: async () => [], onProgress: (d) => seenProgress.push(d) });
  check(seenProgress.length === 10 && seenProgress[9] === 10, "progress is reported for every reply");

  console.log("\n--- PASS: audit ---");
}
main().then(() => process.exit(0));
