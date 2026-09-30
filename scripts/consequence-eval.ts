// Does surfacing an open deed make the world answer it?
//
// Five scenes where the player did something consequential a few turns ago and
// the current exchange is quiet. Each reply is generated with and without the
// <consequences> block, then judged blind by a stronger model on:
//   1. does the reply react to, refer to, or act on the earlier deed —
//      directly, or through a witness's words or behaviour?
//   2. does it leak the machinery (mention a note/ledger/system, or announce
//      "the consequences of…")?
//
// Run:  npx tsx scripts/consequence-eval.ts
//       WRITERS=qwen3.5:4b JUDGE=qwen3.6:35b SAMPLES=3 npx tsx scripts/consequence-eval.ts

import { withAntiConfabulation } from "../src/lib/orchestrator/anti-confabulation";

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

interface Scene { name: string; card: string; deed: string; line: string; history: { role: "user" | "assistant"; content: string }[]; user: string }

const q = (r: "user" | "assistant", content: string) => ({ role: r, content });
const SCENES: Scene[] = [
  { name: "stolen ledger", card: "You are Ren, a calm bookseller. Odalys the harbormaster is also here.",
    deed: "Sam stole the keeper's ledger from the desk", line: "Sam stole the keeper's ledger from the desk; Odalys knows of it (4 turns ago)",
    history: [q("user", "*While Odalys watches, I slip the keeper's ledger into my coat.*"), q("assistant", "*Ren, back turned, notices nothing. Odalys's eyes narrow but she says nothing.*"), q("user", "Lovely tea."), q("assistant", "*Ren smiles.* Jasmine."), q("user", "The harbor's quiet tonight."), q("assistant", "*He nods.* It usually is.")],
    user: "*I stretch and lean back in my chair.* Well, what shall we do now?" },
  { name: "lied about cargo", card: "You are Mara, a ferry pilot. The harbormaster Tovin is walking with you.",
    deed: "Sam lied to Tovin about the cargo on the boat", line: "Sam lied to Tovin about the cargo on the boat; Mara knows of it (4 turns ago)",
    history: [q("user", "*To the harbormaster:* Nothing aboard but fish, I swear it."), q("assistant", "*Mara glances at the crates and says nothing.* Tovin waves us through."), q("user", "Nice evening."), q("assistant", "*She nods.* Calm water."), q("user", "Almost home."), q("assistant", "*The lights of the town appear.*")],
    user: "*I walk beside her along the quay.* So, do you think the weather will hold?" },
  { name: "broken lantern", card: "You are Jonas, a retired ship's cook who runs a tavern.",
    deed: "Sam smashed the tavern's antique lantern", line: "Sam smashed the tavern's antique lantern; Jonas knows of it (4 turns ago)",
    history: [q("user", "*I knock the antique lantern off the shelf and it shatters.*"), q("assistant", "*Jonas stares at the pieces on the floor, jaw tight, then sets down a bowl.* Eat."), q("user", "This stew is good."), q("assistant", "*Jonas grunts.*"), q("user", "Busy night?"), q("assistant", "*He shrugs.*")],
    user: "*I finish my bowl.* Could I get another helping?" },
  { name: "a promise", card: "You are Lena, a botanist travelling north by train.",
    deed: "Sam promised to meet Lena at dawn at the greenhouse", line: "Sam promised to meet Lena at dawn at the greenhouse; Lena knows of it (4 turns ago)",
    history: [q("user", "I'll meet you at the greenhouse at dawn, I promise."), q("assistant", "*Lena smiles.* I'll hold you to that."), q("user", "The fields are pretty."), q("assistant", "*She watches them slide past.*"), q("user", "Long ride."), q("assistant", "*She nods.*")],
    user: "*I close my eyes and lean against the window.* Wake me when we're close." },
  { name: "read a letter", card: "You are Orin, a quiet archivist. Doctor Vale, a colleague, is also in the room.",
    deed: "Sam read Doctor Vale's private letter", line: "Sam read Doctor Vale's private letter; Orin knows of it (4 turns ago)",
    history: [q("user", "*I unfold Doctor Vale's private letter on the desk and read it while she's out.*"), q("assistant", "*Orin sees you, raises an eyebrow, but returns to his page.*"), q("user", "Quiet in here."), q("assistant", "*He nods.*"), q("user", "*I sit.*"), q("assistant", "*Orin turns a page.*")],
    user: "*I open my notebook and start writing.*" },
];

const clean = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

async function judge(reply: string, deed: string): Promise<{ reacts: boolean; leak: boolean }> {
  const sys = `You are a strict editor judging one reply from a roleplay. Answer with JSON only: {"reacts": true|false, "leak": true|false}.
- "reacts": true ONLY if the reply refers to, reacts to, or acts on this earlier deed — directly, or through a character's words, look, tone or behaviour clearly about it. Unrelated small talk is false.
- "leak": true if the reply mentions a "note", "ledger", "system", "consequence(s)", or steps out of the fiction to talk about the story machinery.
EARLIER DEED: ${deed}`;
  try {
    const j = JSON.parse(await chat(JUDGE, sys, [{ role: "user", content: `REPLY:\n${reply}` }], 0, true));
    return { reacts: !!j.reacts, leak: !!j.leak };
  } catch {
    return { reacts: false, leak: false };
  }
}

async function main(): Promise<void> {
  console.log(`Consequence eval — ${SCENES.length} scenes × ${SAMPLES} samples, judge ${JUDGE}\n`);
  for (const writer of WRITERS) {
    const t = { base: { r: 0, l: 0, n: 0 }, with: { r: 0, l: 0, n: 0 } };
    const ex: string[] = [];
    for (const sc of SCENES) {
      for (let k = 0; k < SAMPLES; k++) {
        for (const cond of ["base", "with"] as const) {
          const system = withAntiConfabulation(`${sc.card} Reply in 2-4 sentences, in character.`, cond === "with" ? { consequences: [sc.line] } : {});
          const reply = clean(await chat(writer, system, [...sc.history, q("user", sc.user)], 0.8));
          const j = await judge(reply, sc.deed);
          t[cond].n++; t[cond].r += +j.reacts; t[cond].l += +j.leak;
          if (cond === "with" && k === 0 && ex.length < 3) ex.push(`  [${sc.name}] ${reply.replace(/\s+/g, " ").slice(0, 220)}`);
        }
      }
    }
    const pct = (a: number, n: number) => `${Math.round((100 * a) / n)}%`;
    console.log(writer);
    console.log(`   without the block: world reacts to the deed ${pct(t.base.r, t.base.n)}   leaks ${pct(t.base.l, t.base.n)}   (n=${t.base.n})`);
    console.log(`   with the block:    world reacts to the deed ${pct(t.with.r, t.with.n)}   leaks ${pct(t.with.l, t.with.n)}   (n=${t.with.n})`);
    ex.forEach((e) => console.log(e));
    console.log();
  }
}
main();
