// Does a story beat actually move a stalled scene — without breaking it?
//
// Five deliberately quiet scenes. For each, a reply is generated with and
// without a private <story_beat>, then a stronger model judges each reply
// blind on two questions:
//   1. Does it introduce a NEW development (an arrival, revelation, obstacle…)
//      that changes the situation, beyond describing the current moment?
//   2. Does it leak the machinery (mentions a note, a beat, the director, or
//      steps out of character)?
// A beat that works: development rate up, leak rate ~0.
//
// Run:  npx tsx scripts/pacing-eval.ts
//       WRITERS=qwen3.5:4b,qwen3.5:9b JUDGE=qwen3.6:35b npx tsx scripts/pacing-eval.ts

import { withAntiConfabulation } from "../src/lib/orchestrator/anti-confabulation";
import { BEATS } from "../src/lib/scene/pacing";
import { applyDelta, emptySceneState } from "../src/lib/scene/state";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const WRITERS = (process.env.WRITERS ?? "qwen3.5:4b,qwen3.5:9b").split(",");
const JUDGE = process.env.JUDGE ?? "qwen3.6:35b";
const SAMPLES = Number(process.env.SAMPLES ?? 2);

async function chat(model: string, system: string, messages: { role: string; content: string }[], temperature: number, json = false): Promise<string> {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model, stream: false, think: false, ...(json ? { format: "json" } : {}),
      messages: [{ role: "system", content: system }, ...messages],
      options: { temperature, num_predict: json ? 120 : 260 },
    }),
  });
  return ((await res.json()) as { message?: { content?: string } }).message?.content ?? "";
}

interface Scene { name: string; card: string; board: Parameters<typeof applyDelta>[1]; history: { role: "user" | "assistant"; content: string }[]; user: string }

const SCENES: Scene[] = [
  { name: "tea in the shop", card: "You are Ren, a calm, observant bookseller in a small coastal town.",
    board: { location: "The Salt Page bookshop", time: "afternoon", mood: "quiet, cosy", present: ["Ren", "Sam"] },
    history: [{ role: "assistant", content: "*Ren pours two cups of tea.* Take your time with the shelves." }, { role: "user", content: "Thanks. This tea is lovely." }, { role: "assistant", content: "*He smiles.* Jasmine. My mother's habit." }],
    user: "Mm. It's a slow day, isn't it?" },
  { name: "beach walk", card: "You are Mara, a thoughtful ferry pilot who walks the shore at dusk.",
    board: { location: "the shingle beach", time: "dusk", mood: "peaceful", present: ["Mara", "Sam"] },
    history: [{ role: "assistant", content: "*Mara walks beside you, the waves lapping at the stones.* Nice evening for it." }, { role: "user", content: "It really is." }],
    user: "*I pick up a smooth stone and turn it over.*" },
  { name: "dinner talk", card: "You are Jonas, a retired ship's cook who runs a small tavern.",
    board: { location: "the Anchor tavern", time: "evening", mood: "warm", present: ["Jonas", "Sam"] },
    history: [{ role: "assistant", content: "*Jonas sets down two bowls of stew.* Eat while it's hot." }, { role: "user", content: "Smells great." }],
    user: "So, how's business been this season?" },
  { name: "train ride", card: "You are Lena, a botanist travelling north by train.",
    board: { location: "a train carriage", time: "morning", mood: "calm", present: ["Lena", "Sam"] },
    history: [{ role: "assistant", content: "*Lena watches the fields slide past the window.* Almost there." }, { role: "user", content: "Long ride." }],
    user: "*I stretch and look out the window too.*" },
  { name: "library study", card: "You are Orin, a quiet archivist at a university library.",
    board: { location: "the archive reading room", time: "late night", mood: "hushed", present: ["Orin", "Sam"] },
    history: [{ role: "assistant", content: "*Orin turns a page carefully.* This one is nearly finished." }, { role: "user", content: "Take your time." }],
    user: "*I sit down across from him and open my notebook.*" },
];

const clean = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

async function judge(reply: string, situation: string): Promise<{ development: boolean; leak: boolean }> {
  const sys = `You are a strict editor judging one reply from a roleplay. Answer with JSON only: {"development": true|false, "leak": true|false}.
- "development": true ONLY if the reply introduces a NEW event, arrival, revelation, obstacle, request or change of situation that was not already underway. Describing the current quiet moment, small talk, gestures or feelings is NOT a development.
- "leak": true if the reply mentions a "note", "beat", "director", "instruction", "story", or otherwise steps out of the fiction / talks about the writing itself.`;
  const out = await chat(JUDGE, sys, [{ role: "user", content: `SITUATION BEFORE THE REPLY: ${situation}\n\nREPLY:\n${reply}` }], 0, true);
  try {
    const j = JSON.parse(out);
    return { development: !!j.development, leak: !!j.leak };
  } catch {
    return { development: false, leak: false };
  }
}

async function main(): Promise<void> {
  console.log(`Pacing eval — ${SCENES.length} quiet scenes × ${SAMPLES} samples, judge ${JUDGE}\n`);
  for (const writer of WRITERS) {
    const tally = { base: { dev: 0, leak: 0, n: 0 }, beat: { dev: 0, leak: 0, n: 0 } };
    const examples: string[] = [];
    for (const [si, sc] of SCENES.entries()) {
      const board = applyDelta(emptySceneState(), sc.board);
      const situation = `${sc.board.location}, ${sc.board.time}; ${sc.history.map((h) => h.content).join(" ")}`;
      for (let k = 0; k < SAMPLES; k++) {
        const beat = BEATS.filter((b) => !b.eligible || b.eligible(board))[(si * 3 + k * 4) % BEATS.filter((b) => !b.eligible || b.eligible(board)).length];
        for (const cond of ["base", "beat"] as const) {
          const system = withAntiConfabulation(`${sc.card} Reply in 2-4 sentences, in character.`, cond === "beat" ? { storyBeat: beat.text(board) } : {});
          const reply = clean(await chat(writer, system, [...sc.history, { role: "user", content: sc.user }], 0.8));
          const j = await judge(reply, situation);
          const t = tally[cond];
          t.n++; t.dev += +j.development; t.leak += +j.leak;
          if (cond === "beat" && k === 0 && si < 2) examples.push(`  [${sc.name} · ${beat.id}] ${reply.replace(/\s+/g, " ").slice(0, 230)}`);
        }
      }
    }
    const pct = (a: number, n: number) => `${Math.round((100 * a) / n)}%`;
    console.log(`${writer}`);
    console.log(`   without beat: new development ${pct(tally.base.dev, tally.base.n)}   leaks ${pct(tally.base.leak, tally.base.n)}   (n=${tally.base.n})`);
    console.log(`   with beat:    new development ${pct(tally.beat.dev, tally.beat.n)}   leaks ${pct(tally.beat.leak, tally.beat.n)}   (n=${tally.beat.n})`);
    for (const e of examples) console.log(e);
    console.log();
  }
}

main();
