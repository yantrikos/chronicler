// Can a local model judge character consistency reliably enough to show a player?
//
// Two characters, each with declared traits and 16 replies I wrote:
//   consistent (5)  – shows the traits
//   obvious    (5)  – plainly does the opposite of a trait
//   subtle     (2)  – a mild violation
//   neutral    (4)  – logistics; says nothing about character
// A good judge flags the obvious, ideally the subtle, and stays quiet on the
// consistent and neutral. Flags are grounded (the quote must be in the reply).
//
// Run:  npx tsx scripts/audit-eval.ts
//       MODELS=qwen3.5:4b,qwen3.6:35b npx tsx scripts/audit-eval.ts

import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";
import { ConsistencyJudge } from "../src/lib/audit/judge";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODELS = (process.env.MODELS ?? "qwen3.5:4b,qwen3.5:9b,qwen3.6:35b").split(",");

class DirectOllama implements LlmProvider {
  name = "eval";
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${OLLAMA}/api/chat`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: req.model, stream: false, think: false, format: "json",
        messages: [{ role: "system", content: req.system }, ...req.messages], options: { temperature: 0, num_predict: req.max_tokens ?? 300 } }) });
    return { content: ((await res.json()) as any).message?.content ?? "" };
  }
}

type Kind = "consistent" | "obvious" | "subtle" | "neutral";
interface Char { name: string; traits: string[]; replies: [Kind, string][] }
const CHARS: Char[] = [
  { name: "Ren", traits: [
      "Quiet and perceptive; listens more than he speaks",
      "Dry, understated humor",
      "Never raises his voice or loses his temper",
      "Deflects personal questions with bookshop metaphors",
      "Protective of his shop and his books"],
    replies: [
      ["consistent", "*Ren wipes the counter.* Mm. The tide's late again. Tea?"],
      ["consistent", "*He regards you a moment.* That's a very large question for a Tuesday. Have some tea first."],
      ["consistent", "A good book is like a lighthouse — it doesn't chase anyone, it just stays lit."],
      ["consistent", "*Ren's jaw tightens, but his voice stays low.* Please put that back, gently. It's older than both of us."],
      ["consistent", "Hm. *He waits, letting the silence do the asking.*"],
      ["obvious", "*Ren slams his fist on the counter and shouts.* GET OUT OF MY SHOP RIGHT NOW, YOU IDIOT!"],
      ["obvious", "*Ren launches into a ceaseless monologue.* And another thing, and another, let me tell you absolutely everything about my whole life, I never stop talking!"],
      ["obvious", "*Ren laughs uproariously and slaps his knee.* Oh that's HILARIOUS, the funniest thing I've ever heard, ha ha ha ha!"],
      ["obvious", "*He shrugs and tears a page from a rare first edition to wipe up the spill.* Whatever, it's just paper."],
      ["obvious", "Sure, rifle through the back room. Take whatever you like, I don't care about any of it."],
      ["subtle", "*Ren raises his voice a little, exasperated.* For the last time, stop touching that!"],
      ["subtle", "*Ren answers at once and at length.* I was lonely after my wife died. Here is exactly what happened, all of it."],
      ["neutral", "The bus to Port Llyr leaves at nine."],
      ["neutral", "It's about four miles along the coast road."],
      ["neutral", "Bread's on the shelf, and the kettle's just boiled."],
      ["neutral", "The storm should clear by dawn."]] },
  { name: "Adira", traits: [
      "Confident and playful; likes to provoke a reaction",
      "Reads people quickly",
      "Wears her interest plainly when she means it",
      "Goes quiet and unreadable when she is keeping a wall up",
      "Sharp tongue, sharper guitar"],
    replies: [
      ["consistent", "*Adira grins.* Careful, stranger. Look at me like that again and I might start charging."],
      ["consistent", "*She watches your hands, not your face.* You're nervous, and you're lying about the second one. Sit."],
      ["consistent", "*Adira drops the teasing for a moment.* I like you. I'm not going to pretend I don't."],
      ["consistent", "*She goes very still, eyes flat.* Nothing. It's nothing."],
      ["consistent", "*She plucks a sour chord and smirks.* That's how I feel about your opinion."],
      ["obvious", "*Adira stammers and stares at the floor.* S-sorry, I didn't mean to, I never know what to say to anyone..."],
      ["obvious", "*She apologizes profusely for every teasing word and begs you not to be upset with her.*"],
      ["obvious", "*Adira is completely unable to tell what you are feeling.* I have absolutely no idea what is going on with you."],
      ["obvious", "*She fumbles the guitar clumsily and laughs at how hopeless she is at playing.*"],
      ["obvious", "*Adira meekly agrees with everything you say.* Yes, you're right. Whatever you say, I won't argue."],
      ["subtle", "*Adira hesitates and looks unsure.* Um... maybe? I don't know if I should say."],
      ["subtle", "*She hides her interest completely, insisting she feels nothing at all, even when you ask directly and she clearly means it.*"],
      ["neutral", "The tavern opens at dusk."],
      ["neutral", "There's a room upstairs if you need one."],
      ["neutral", "The ferry stopped running after the storm."],
      ["neutral", "That road goes north along the coast."]] },
];

async function run(model: string) {
  const judge = new ConsistencyJudge(new DirectOllama(), model);
  const stat: Record<Kind, { n: number; flagged: number }> = { consistent: { n: 0, flagged: 0 }, obvious: { n: 0, flagged: 0 }, subtle: { n: 0, flagged: 0 }, neutral: { n: 0, flagged: 0 } };
  const wrong: string[] = [];
  let ms = 0, calls = 0;
  for (const c of CHARS) {
    for (const [kind, reply] of c.replies) {
      const t0 = performance.now();
      const flags = await judge.judge(c.traits, reply, c.name);
      ms += performance.now() - t0; calls++;
      stat[kind].n++;
      if (flags.length) stat[kind].flagged++;
      if ((kind === "consistent" || kind === "neutral") && flags.length) wrong.push(`FALSE FLAG (${kind}) "${reply.slice(0, 60)}…" → trait ${flags[0].trait}: "${flags[0].quote}" — ${flags[0].why}`);
      if (kind === "obvious" && !flags.length) wrong.push(`MISSED (obvious) "${reply.slice(0, 70)}…"`);
    }
  }
  return { stat, wrong, ms: ms / calls };
}

async function main(): Promise<void> {
  console.log("Audit judge eval — 2 characters × 16 replies (5 consistent, 5 obvious, 2 subtle, 4 neutral)\n");
  for (const m of MODELS) {
    const { stat, wrong, ms } = await run(m);
    const fp = stat.consistent.flagged + stat.neutral.flagged;
    console.log(`${m.padEnd(14)} obvious caught ${stat.obvious.flagged}/${stat.obvious.n}   subtle caught ${stat.subtle.flagged}/${stat.subtle.n}   FALSE flags on innocent replies ${fp}/${stat.consistent.n + stat.neutral.n}   ${Math.round(ms / 100) / 10}s/reply`);
    wrong.forEach((w) => console.log(`      ${w}`));
  }
}
main();
