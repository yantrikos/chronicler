// Does the core-trait verifier accept real identity traits written the way
// SkillFormer writes them, and reject everything else?
//
// 34 labelled candidates (specific, action-oriented): 8 real identity patterns,
// 8 situational habits, 8 generic model tics, and 10 HARD negatives — verbal
// tics, mannerisms triggered by a situation, topical enthusiasm, vague virtues —
// the kind a too-relaxed criterion would let through. Good = accepts the
// identity patterns, rejects every other kind.
//
// History: the original criterion ("if you can construct a scene where it would
// not apply, it is not an identity trait") is unsatisfiable, and accepted 0–2 of
// the 8 real patterns. An abstraction step (restate the behavior as a posture
// first) was also tried: it did not help and was removed.
//
// Run:  npx tsx scripts/core-trait-eval.ts
//       MODELS=qwen3.5:4b,qwen3.6:35b npx tsx scripts/core-trait-eval.ts

import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";
import { CoreTraitVerifier } from "../src/lib/skills/core-trait-verifier";

const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODELS = (process.env.MODELS ?? "qwen3.5:4b,qwen3.5:9b,qwen3.6:35b").split(",");

class DirectOllama implements LlmProvider {
  name = "eval";
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${OLLAMA}/api/chat`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: req.model, stream: false, think: false, format: "json",
        messages: [{ role: "system", content: req.system }, ...req.messages], options: { temperature: 0.1, num_predict: req.max_tokens ?? 300 } }) });
    return { content: ((await res.json()) as any).message?.content ?? "" };
  }
}

type Label = "identity" | "situational" | "tic" | "hard";
const CASES: { name: string; label: Label; body: string }[] = [
  { name: "Adira", label: "identity", body: "Adira deflects emotional questions with self-deprecating jokes about her guitar playing, then changes the subject to the crowd." },
  { name: "Ren", label: "identity", body: "Ren answers direct emotional questions with bookshop metaphors and quietly turns the question back on the other person." },
  { name: "Mei", label: "identity", body: "Mei lights a candle and asks the other person one question before committing to any serious decision." },
  { name: "Marcus", label: "identity", body: "Marcus goes silent and studies the table when someone shows him unexpected kindness." },
  { name: "Vex", label: "identity", body: "Vex Volkov answers every accusation with a flat, dry understatement before laying out the facts." },
  { name: "Whitstable", label: "identity", body: "Whitstable pushes back on weak prose by asking what the scene needs to do before suggesting any wording." },
  { name: "Adira", label: "identity", body: "Adira tests new people with a teasing challenge before she lets any warmth show." },
  { name: "Brennan", label: "identity", body: "Brennan narrates consequences bluntly and never softens the result of a failed roll." },
  { name: "Ren", label: "situational", body: "Ren locks the shop door and turns the sign to closed at dusk." },
  { name: "Adira", label: "situational", body: "Adira tunes her guitar before the tavern crowd arrives." },
  { name: "Mei", label: "situational", body: "Mei asks merchants about the delta harvest when she meets them at the market." },
  { name: "Vex", label: "situational", body: "Vex Volkov lights a cigarette when he examines a crime scene." },
  { name: "Marcus", label: "situational", body: "Marcus reviews the candidate's resume at the start of an interview rehearsal." },
  { name: "Ren", label: "situational", body: "Ren offers tea when a customer comes in from the rain." },
  { name: "Whitstable", label: "situational", body: "Whitstable suggests cutting adverbs in the opening paragraph of a chapter." },
  { name: "Brennan", label: "situational", body: "Brennan rolls initiative when a fight begins." },
  { name: "Ren", label: "tic", body: "Ren nods subtly before responding." },
  { name: "Adira", label: "tic", body: "Adira's lips curl into a knowing smile when she speaks." },
  { name: "Mei", label: "tic", body: "Mei's eyes narrow slightly as she considers the question." },
  { name: "Vex", label: "tic", body: "Vex takes a deep breath before answering." },
  { name: "Marcus", label: "tic", body: "Marcus leans forward with interest." },
  { name: "Ren", label: "tic", body: "Ren's voice softens as he speaks." },
  { name: "Adira", label: "tic", body: "Adira lets out a soft chuckle." },
  { name: "Brennan", label: "tic", body: "Brennan's gaze sweeps the room." },
  { name: "Ren", label: "hard", body: "Ren smiles warmly whenever a customer thanks him." },
  { name: "Adira", label: "hard", body: "Adira hums quietly to herself when she is thinking." },
  { name: "Mei", label: "hard", body: "Mei bows slightly when greeting someone." },
  { name: "Marcus", label: "hard", body: "Marcus says 'let's circle back' near the end of rehearsals." },
  { name: "Brennan", label: "hard", body: "Brennan describes every dungeon door as heavy oak bound in iron." },
  { name: "Whitstable", label: "hard", body: "Whitstable capitalises every chapter title in the manuscript." },
  { name: "Ren", label: "hard", body: "Ren begins most replies with the words 'Well then'." },
  { name: "Adira", label: "hard", body: "Adira gets visibly excited whenever the conversation turns to music." },
  { name: "Marcus", label: "hard", body: "Marcus is polite to everyone he speaks with." },
  { name: "Vex", label: "hard", body: "Vex Volkov glances at the clock during interviews." },
];
const EVIDENCE = { total_net_score: 12, reinforcement_count: 14, distinct_sessions: 6, days_active: 20, success_rate: 0.85 };

async function run(model: string) {
  const verifier = new CoreTraitVerifier(new DirectOllama(), model);
  const tally = { identity: 0, situational: 0, tic: 0, hard: 0 };
  const wrong: string[] = [];
  const missed: string[] = [];
  let i = 0;
  for (const c of CASES) {
    i++;
    const v = await verifier.verify({ skill_id: `c-${i}`, body: c.body, character_name: c.name, character_id: c.name.toLowerCase(), existing_core_traits: [], evidence: EVIDENCE });
    if (v.is_core_trait) tally[c.label]++;
    if (v.is_core_trait && c.label !== "identity") wrong.push(`ACCEPTED (${c.label}): ${c.body}`);
    if (!v.is_core_trait && c.label === "identity") missed.push(`rejected: ${c.body.slice(0, 90)}`);
  }
  return { tally, wrong, missed };
}

async function main(): Promise<void> {
  console.log(`Core-trait eval — ${CASES.length} candidates: 8 identity, 8 situational, 8 tics, 10 hard negatives\n`);
  for (const m of MODELS) {
    const { tally, wrong, missed } = await run(m);
    console.log(`${m.padEnd(14)} identity accepted ${tally.identity}/8   wrongly accepted: situational ${tally.situational}/8, tics ${tally.tic}/8, hard ${tally.hard}/10`);
    wrong.forEach((w) => console.log(`      ✗ ${w}`));
    missed.forEach((w) => console.log(`      · ${w}`));
  }
}
main();
