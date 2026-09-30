// Dev experiment: which identity-block intro wording elicits behaviour traits
// best? Declared in docs/IDENTITY-INTRO-DEV.md before running. Dev data only —
// this picks a wording; it does not produce a verdict.
//
// Run:  npx tsx scripts/dev-identity-variants.ts
// Env:  BENCH_SAMPLES (default 2), BENCH_JUDGE (default qwen3.6:35b)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCrossModelBenchmark, type BenchmarkScene, type ProviderUnderTest } from "../src/lib/instrumentation/cross-model-runner";
import { collapseToMedians, judgeStats, scoreReply, type ReplyScore, type ScoringConfig } from "../src/lib/instrumentation/character-consistency-scorer";
import { IDENTITY_INTRO_DEFAULT } from "../src/lib/orchestrator/anti-confabulation";
import { ADIRA_FIXTURE, DirectOllamaProvider, SCENES_V1, SCENES_V2 } from "./bench-common";

const TAIL = " The model voice may vary across providers; these traits do not.";
const B =
  "These describe how this character behaves. When a moment calls for one of them — the situation it describes actually comes up — enact it in this reply: let it show in what the character concretely does and says, not only in tone or atmosphere. Do not skip a trait because another response would be smoother, more agreeable, or more comfortable. A trait the moment does not call for stays quiet; never force it into a scene where it does not belong.";
const C =
  B +
  " Traits about what the character DOES (apologizing, deflecting, opening a conversation, withholding) must appear as a specific action or line in the reply itself — a described act or spoken words — not merely be implied or summarised.";

const VARIANTS: { id: string; intro: string }[] = [
  { id: "A-default", intro: IDENTITY_INTRO_DEFAULT },
  { id: "B-enact", intro: B + TAIL },
  { id: "C-enact-concrete", intro: C + TAIL },
];

// Dev-only applicability for the five v1 scenes (see docs/IDENTITY-INTRO-DEV.md).
const V1_MAP: Record<string, number[]> = {
  "tavern-first-meeting": [0, 1],
  "friend-bringing-news": [0, 2, 4],
  "stranger-offers-help": [0, 1],
  "direct-emotional-question": [2, 4],
  "limit-test": [1],
};
const SCENES: BenchmarkScene[] = [
  ...SCENES_V1.map((s) => ({ ...s, applicable_traits: V1_MAP[s.scene_id] })),
  ...SCENES_V2,
];
// Scenes with Ren, a trusted friend — for the over-correction guard.
const REN_SCENES = new Set(["friend-bringing-news", "direct-emotional-question", "v2-confession", "v2-mother-song", "v2-wedding-tease"]);

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODELS = ["qwen3.5:9b", "qwen2.5:7b", "gpt-oss:20b"];
const PROVIDERS: ProviderUnderTest[] = MODELS.map((m) => ({ id: m, provider: new DirectOllamaProvider(OLLAMA_BASE, m), model: m }));
const JUDGE_MODEL = process.env.BENCH_JUDGE ?? "qwen3.6:35b";
const JUDGE = new DirectOllamaProvider(OLLAMA_BASE, JUDGE_MODEL);
const SAMPLES = Math.max(1, Number(process.env.BENCH_SAMPLES ?? 2));

const CONFIG: ScoringConfig = {
  fixture: ADIRA_FIXTURE,
  scenes_by_id: Object.fromEntries(SCENES.map((s) => [s.scene_id, s])),
  signature_rules: [], active_preferences: [], active_limits: [], drift_summary: "",
  traits_only: true,
};

const GUARD_SYSTEM = `You judge one roleplay reply. Output STRICT JSON only: {"score": number, "notes": string}. score is 0.0 to 1.0.`;
async function wardScore(scene: BenchmarkScene, reply: string): Promise<number> {
  try {
    const r = await JUDGE.chat({
      model: JUDGE_MODEL, system: GUARD_SYSTEM, temperature: 0, max_tokens: 200,
      messages: [{ role: "user", content: `Scene:\n"""${scene.scene_text}"""\nRen says: "${scene.user_message}"\n\nAdira's reply:\n"""${reply.trim()}"""\n\nRen is Adira's closest, most trusted friend. Is Adira warm and open TOWARD REN in this reply — not cold, stonewalling, or treating Ren like a stranger? 1.0 = clearly warm and open; 0.0 = cold, evasive, or hostile to Ren.` }],
    });
    const m = r.content.match(/"score"\s*:\s*([0-9.]+)/);
    return m ? Math.max(0, Math.min(1, Number(m[1]))) : 0.5;
  } catch { return 0.5; }
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

async function main(): Promise<void> {
  const out: Record<string, { perModel: Record<string, number>; mean: number; guard: number; perTrait: Record<string, number> }> = {};
  const raw: Record<string, unknown> = {};
  for (const v of VARIANTS) {
    console.log(`\n=== variant ${v.id} ===`);
    const run = await runCrossModelBenchmark({ fixture: ADIRA_FIXTURE, scenes: SCENES, providers: PROVIDERS, samples: SAMPLES, arms: ["identity"], identityIntro: v.intro });
    const failed = run.replies.filter((r) => r.error || !r.reply.trim()).length;
    console.log(`  generated ${run.replies.length} replies, ${failed} failed/empty`);
    const scored: ReplyScore[] = [];
    const guard: number[] = [];
    const traitVals: Record<string, number[]> = {};
    for (const reply of run.replies) {
      const s = await scoreReply(reply, CONFIG, JUDGE, JUDGE_MODEL);
      scored.push(s);
      const scene = SCENES.find((x) => x.scene_id === reply.scene_id)!;
      const per = (s.trait_adherence.notes.match(/per-trait: ([\d.,]+)/)?.[1] ?? "").split(",").map(Number);
      (scene.applicable_traits ?? []).forEach((ti, k) => (traitVals[ti] ??= []).push(per[k]));
      if (REN_SCENES.has(reply.scene_id) && !reply.error) guard.push(await wardScore(scene, reply.reply));
    }
    const cells = collapseToMedians(scored);
    const perModel: Record<string, number> = {};
    for (const m of MODELS) perModel[m] = mean(cells.filter((c) => c.provider_id === m).map((c) => c.trait_adherence.score));
    const perTrait: Record<string, number> = {};
    for (const [k, vals] of Object.entries(traitVals)) perTrait[k] = mean(vals);
    out[v.id] = { perModel, mean: mean(Object.values(perModel)), guard: mean(guard), perTrait };
    raw[v.id] = { intro: v.intro, replies: run.replies, scores: scored, guard };
    console.log(`  mean ${out[v.id].mean.toFixed(3)}  guard(Ren) ${out[v.id].guard.toFixed(3)}  ` + MODELS.map((m) => `${m} ${perModel[m].toFixed(3)}`).join("  "));
    console.log(`  per-trait: ` + Object.entries(perTrait).sort().map(([k, x]) => `T${k}=${x.toFixed(2)}`).join(" "));
  }

  // Apply the pre-declared selection rule.
  const A = out["A-default"];
  console.log("\n── Selection (rule in docs/IDENTITY-INTRO-DEV.md) ──");
  const qualifying: string[] = [];
  for (const v of VARIANTS.slice(1)) {
    const o = out[v.id];
    const r1 = o.mean - A.mean >= 0.05;
    const r2 = MODELS.every((m) => o.perModel[m] >= A.perModel[m] - 0.05);
    const r3 = o.guard >= A.guard - 0.05;
    console.log(`  ${v.id}: gain ${(o.mean - A.mean).toFixed(3)} [${r1 ? "ok" : "FAIL"} ≥0.05]  no-model-drop [${r2 ? "ok" : "FAIL"}]  guard Δ ${(o.guard - A.guard).toFixed(3)} [${r3 ? "ok" : "FAIL"}]`);
    if (r1 && r2 && r3) qualifying.push(v.id);
  }
  const winner = qualifying.length
    ? qualifying.sort((a, b) => out[b].mean - out[a].mean || VARIANTS.find((v) => v.id === a)!.intro.length - VARIANTS.find((v) => v.id === b)!.intro.length)[0]
    : "A-default";
  console.log(`  → ${qualifying.length ? `ADOPT ${winner}` : "NO VARIANT QUALIFIES — default stays (null result)"}`);
  console.log(`  judge health: ${judgeStats.calls} calls, ${judgeStats.unparseable} unparseable, ${judgeStats.errors} errors`);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const docs = path.resolve(here, "..", "docs");
  await mkdir(docs, { recursive: true });
  await writeFile(path.join(docs, "identity-intro-dev-2026-09-30.json"), JSON.stringify({ samples: SAMPLES, judge: JUDGE_MODEL, out, winner, judge_health: { ...judgeStats }, raw }, null, 2) + "\n", "utf8");
  console.log("  wrote docs/identity-intro-dev-2026-09-30.json");
}

main().catch((e) => { console.error("dev run failed:", e); process.exit(1); });
