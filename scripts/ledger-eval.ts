// Can a local model keep the consequence ledger? Scripted eight-turn scene:
// chatter, a theft with a witness, chatter, a promise, chatter, the theft is
// put right, chatter. Checks what is recorded, what is marked answered, that
// nothing is invented, and how many model calls the cheap gate saved.
//
// Run:  npx tsx scripts/ledger-eval.ts
//       MODELS=qwen3.5:4b,qwen3.6:35b npx tsx scripts/ledger-eval.ts

import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";
import { emptyLedger, openDeeds, type Ledger } from "../src/lib/scene/ledger";
import { LedgerTracker } from "../src/lib/scene/ledger-tracker";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODELS = (process.env.MODELS ?? "qwen3.5:4b,qwen3.5:9b,qwen3.6:35b").split(",");

class DirectOllama implements LlmProvider {
  name = "eval";
  calls = 0;
  ms = 0;
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const t0 = performance.now();
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model, stream: false, think: false, format: "json",
        messages: [{ role: "system", content: req.system }, ...req.messages],
        options: { temperature: req.temperature ?? 0.1, num_predict: req.max_tokens ?? 300 },
      }),
    });
    this.calls++;
    this.ms += performance.now() - t0;
    return { content: ((await res.json()) as { message?: { content?: string } }).message?.content ?? "" };
  }
}

interface Step {
  user: string;
  reply: string;
  present: string[];
  expect: [string, (l: Ledger) => boolean][];
}
const txt = (l: Ledger) => l.deeds.map((d) => d.text.toLowerCase()).join(" | ");
const P = ["Ren", "Odalys", "Sam"];

const SCRIPT: Step[] = [
  { user: "Quiet night, isn't it?", reply: "*Ren pours tea for the three of you.* The harbor's asleep. Even the gulls have gone quiet.", present: P,
    expect: [["chatter records nothing", (l) => l.deeds.length === 0]] },
  { user: "*While Ren checks the kettle and Odalys watches me, I slip the keeper's ledger off the desk and into my coat.*",
    reply: "*Ren, back turned, notices nothing. Odalys's eyes narrow at the empty spot on the desk, but she says nothing.*", present: P,
    expect: [
      ["the theft is recorded", (l) => /ledger/.test(txt(l))],
      ["Odalys is noted as knowing", (l) => l.deeds.some((d) => d.witnesses.some((w) => /odalys/i.test(w)))],
    ] },
  { user: "This tea is really good.", reply: "*Ren smiles.* Jasmine. My mother's habit. Take another cup.", present: P,
    expect: [["chatter adds nothing", (l) => l.deeds.length === 1]] },
  { user: "I promise I'll bring your lantern back before dawn, Ren.", reply: "*Ren hands you the brass lantern.* Then we have a deal. Before dawn, mind.", present: P,
    expect: [["the promise is recorded", (l) => /promis|lantern|return|bring/.test(txt(l)) && l.deeds.length === 2]] },
  { user: "What time is it, do you think?", reply: "*Ren glances at the clock.* Near midnight. The tide turns soon.", present: P,
    expect: [["chatter adds nothing", (l) => l.deeds.length === 2]] },
  { user: "*I take the ledger out of my coat and set it back on the desk.* I'm sorry, Odalys. I shouldn't have taken it.",
    reply: "*Odalys picks up the ledger and studies you.* You put it back. That counts for something. We'll say no more about it.", present: P,
    expect: [
      ["the theft is marked answered", (l) => l.deeds.some((d) => /ledger/i.test(d.text) && d.status === "answered")],
      ["the promise is still open", (l) => openDeeds(l).some((d) => /promis|lantern|return|bring/i.test(d.text))],
    ] },
  { user: "Well, I should head off.", reply: "*Ren walks you to the door.* Safe travels, Sam.", present: P,
    expect: [["nothing invented", (l) => l.deeds.length <= 2]] },
];

async function evalModel(model: string) {
  const provider = new DirectOllama();
  const tracker = new LedgerTracker(provider, model);
  let ledger = emptyLedger();
  let pass = 0, total = 0;
  const fails: string[] = [];
  for (const [i, s] of SCRIPT.entries()) {
    ledger = await tracker.update({ ledger, turn: i + 1, userName: "Sam", characterName: "Ren", present: s.present, userText: s.user, replyText: s.reply });
    for (const [label, ok] of s.expect) {
      total++;
      if (ok(ledger)) pass++;
      else fails.push(`turn ${i + 1}: ${label}  (ledger: ${ledger.deeds.map((d) => `${d.id}[${d.status}] ${d.text} w=${d.witnesses.join("/")}`).join("; ") || "empty"})`);
    }
  }
  return { pass, total, calls: provider.calls, ms: provider.calls ? provider.ms / provider.calls : 0, fails };
}

async function main(): Promise<void> {
  console.log(`Ledger eval — ${SCRIPT.length} turns (${SCRIPT.filter((s) => /steal|slip|promise|ledger/i.test(s.user)).length} contain deeds)\n`);
  for (const m of MODELS) {
    const r = await evalModel(m);
    console.log(`${m.padEnd(14)} ${r.pass}/${r.total} checks   ${r.calls}/${SCRIPT.length} turns needed a model call   ${Math.round(r.ms)} ms/call`);
    for (const f of r.fails) console.log(`    ✗ ${f}`);
  }
}
main();
