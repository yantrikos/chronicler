// Evaluate the scene tracker against a real local model.
//
// A scripted six-turn scene with ground truth per turn, including one turn
// where NOTHING should change (to catch invention). Talks straight to Ollama —
// no app, no database.
//
// Run:  npx tsx scripts/scene-tracker-eval.ts
//       MODELS=qwen3.5:4b,qwen3.5:9b npx tsx scripts/scene-tracker-eval.ts

import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";
import { SceneTracker } from "../src/lib/scene/tracker";
import { emptySceneState, type SceneState } from "../src/lib/scene/state";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODELS = (process.env.MODELS ?? "qwen2.5:1.5b,qwen3.5:4b,qwen3.5:9b").split(",");
const MODES = (process.env.MODES ?? "delta,board").split(",") as ("delta" | "board")[];

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
        model: req.model,
        messages: [{ role: "system", content: req.system }, ...req.messages],
        stream: false,
        think: false,
        format: "json",
        options: { temperature: req.temperature ?? 0.1, num_predict: req.max_tokens ?? 300 },
      }),
    });
    const j = (await res.json()) as { message?: { content?: string } };
    this.calls++;
    this.ms += performance.now() - t0;
    return { content: j.message?.content ?? "" };
  }
}

interface Step {
  user: string;
  reply: string;
  /** Each check is a label + predicate over the board after this turn. */
  expect: [string, (s: SceneState) => boolean][];
}

const has = (xs: string[], w: string) => xs.some((x) => x.toLowerCase().includes(w));
const text = (v?: string) => (v ?? "").toLowerCase();

const SCRIPT: Step[] = [
  {
    user: "*I push open the door of the bookshop, shaking the rain from my coat.* Evening, Ren.",
    reply: "*Ren looks up from the ledger behind the counter of The Salt Page, lamplight on his glasses.* Evening, Sam. Late for browsing — the storm's driven everyone home.",
    expect: [
      ["location is the bookshop", (s) => /salt page|bookshop|shop/.test(text(s.location))],
      ["time is evening/night", (s) => /even|night|late/.test(text(s.time))],
      ["Ren is present", (s) => has(s.present, "ren")],
    ],
  },
  {
    user: "Do you still have that old key you mentioned?",
    reply: "*Ren opens a drawer and slides a tarnished brass key across the counter.* Take it. It opens the lighthouse door, if the keeper ever comes back.",
    expect: [["inventory has the brass key", (s) => has(s.inventory, "key")]],
  },
  {
    user: "*I pocket the key.* Then let's go find the keeper. Now.",
    reply: "*Ren pulls on his coat and locks up.* Come on, then. *They walk through the rain down to the harbor docks, the water black under the pier lights.* The keeper vanished three nights ago.",
    expect: [
      ["location moved to the docks", (s) => /dock|harbor|pier/.test(text(s.location))],
      ["objective: find the keeper", (s) => has(s.goals, "keeper")],
      ["still has the key", (s) => has(s.inventory, "key")],
    ],
  },
  {
    user: "*I scan the pier.* Someone's there.",
    reply: "*A woman in a harbormaster's cap steps out of the fog.* Odalys, harbormaster. You're the ones asking about the keeper?",
    expect: [["Odalys is present", (s) => has(s.present, "odalys")]],
  },
  {
    user: "*I hand her the brass key.* This is his, isn't it?",
    reply: "*Odalys turns the key over, nods slowly, and pockets it.* It is. Thank you. *She tips her cap and walks off along the pier, vanishing into the fog.*",
    expect: [
      ["the key is no longer carried", (s) => !has(s.inventory, "key")],
      ["Odalys has left", (s) => !has(s.present, "odalys")],
    ],
  },
  {
    user: "*I stare out at the water for a while.*",
    reply: "*Ren stands beside me in silence, watching the waves.* ...",
    expect: [
      ["no invented items", (s) => s.inventory.length === 0],
      ["nobody new appeared", (s) => s.present.every((p) => /ren|sam/i.test(p))],
      ["location unchanged", (s) => /dock|harbor|pier/.test(text(s.location))],
    ],
  },
];

async function evalModel(model: string, mode: "delta" | "board"): Promise<{ pass: number; total: number; ms: number; failures: string[] }> {
  const provider = new DirectOllama();
  const tracker = new SceneTracker(provider, model, mode);
  let board = emptySceneState();
  let pass = 0;
  let total = 0;
  const failures: string[] = [];
  for (const [i, step] of SCRIPT.entries()) {
    board = await tracker.update({ state: board, userName: "Sam", characterName: "Ren", userText: step.user, replyText: step.reply });
    for (const [label, ok] of step.expect) {
      total++;
      if (ok(board)) pass++;
      else failures.push(`turn ${i + 1}: ${label}  (board: ${JSON.stringify({ l: board.location, t: board.time, p: board.present, g: board.goals, inv: board.inventory })})`);
    }
  }
  return { pass, total, ms: provider.ms / Math.max(1, provider.calls), failures };
}

async function main(): Promise<void> {
  console.log(`Scene tracker eval — ${SCRIPT.length} turns\n`);
  for (const m of MODELS) {
    for (const mode of MODES) {
      try {
        const r = await evalModel(m, mode);
        console.log(`${m.padEnd(14)} ${mode.padEnd(6)} ${r.pass}/${r.total} checks   ${Math.round(r.ms)} ms/turn`);
        for (const f of r.failures) console.log(`    ✗ ${f}`);
      } catch (e) {
        console.log(`${m.padEnd(14)} ${mode} error: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

main();
