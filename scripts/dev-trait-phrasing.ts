// Dev experiment: does restating behaviour traits as "when <moment>, <name> <visible act>"
// raise their embodiment? Declared in docs/TRAIT-ENACTMENT-DEV.md before running.
// Dev data only — this picks a phrasing; it does not produce a verdict.
//
// Run:  npx tsx scripts/dev-trait-phrasing.ts
// Env:  BENCH_SAMPLES (default 2), BENCH_JUDGE (default qwen3.6:35b)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCrossModelBenchmark, type BenchmarkScene, type CharacterFixture, type ProviderUnderTest } from "../src/lib/instrumentation/cross-model-runner";
import { collapseToMedians, judgeStats, scoreReply, type ReplyScore, type ScoringConfig } from "../src/lib/instrumentation/character-consistency-scorer";
import { enactTrait } from "../src/lib/identity/trait-enactment";
import { ADIRA_FIXTURE, DirectOllamaProvider, SCENES_V1, SCENES_V2 } from "./bench-common";
import { SCENES_V3 } from "./bench-scenes-v3";

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
  ...SCENES_V3,
];
// Scenes with Ren, a trusted friend — for the over-correction guard.
const REN_SCENES = new Set(["friend-bringing-news", "direct-emotional-question", "v2-confession", "v2-mother-song", "v2-wedding-tease", "v3-torn-songbook", "v3-inscribed-gift", "v3-stage-fright"]);

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

type VariantId = "A-original" | "E1-replace" | "E2-augment";
const VARIANT_IDS: VariantId[] = ["A-original", "E1-replace", "E2-augment"];

function fixtureFor(id: VariantId, enacts: (string | null)[]): CharacterFixture {
  const traits = ADIRA_FIXTURE.core_traits.map((t, i) => {
    const e = enacts[i];
    if (id === "A-original" || !e) return t;
    return id === "E1-replace" ? e : `${t}\n    On the page: ${e}`;
  });
  return { ...ADIRA_FIXTURE, core_traits: traits };
}

async function main(): Promise<void> {
  // Rewrites: once, by a small local model, identical for every participant.
  const rewriter = new DirectOllamaProvider(OLLAMA_BASE, "qwen3.5:9b");
  const enacts: (string | null)[] = [];
  for (const t of ADIRA_FIXTURE.core_traits) enacts.push(await enactTrait(rewriter, "qwen3.5:9b", ADIRA_FIXTURE.character_name, t));
  console.log("── rewrites (qwen3.5:9b, temperature 0) ──");
  ADIRA_FIXTURE.core_traits.forEach((t, i) => console.log(`  ${i}: ${enacts[i] ?? "(rejected by grounding — original kept)"}`));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const docs = path.resolve(here, "..", "docs");
  await mkdir(docs, { recursive: true });
  await writeFile(path.join(docs, "trait-enactment-rewrites-2026-09-30.json"), JSON.stringify({ rewriter: "qwen3.5:9b", temperature: 0, traits: ADIRA_FIXTURE.core_traits, enacts }, null, 2) + "\n", "utf8");

  const out: Record<string, { perModel: Record<string, number>; mean: number; guard: number; perTrait: Record<string, number>; targeted: number }> = {};
  const raw: Record<string, unknown> = {};
  for (const id of VARIANT_IDS) {
    console.log(`\n=== variant ${id} ===`);
    const run = await runCrossModelBenchmark({ fixture: fixtureFor(id, enacts), scenes: SCENES, providers: PROVIDERS, samples: SAMPLES, arms: ["identity"] });
    const failed = run.replies.filter((r) => r.error || !r.reply.trim()).length;
    console.log(`  generated ${run.replies.length} replies, ${failed} failed/empty`);
    const scored: ReplyScore[] = [];
    const guard: number[] = [];
    const traitVals: Record<string, number[]> = {};
    for (const reply of run.replies) {
      // Scored against the ORIGINAL fixture traits (CONFIG.fixture), never the rewrites.
      const sc = await scoreReply(reply, CONFIG, JUDGE, JUDGE_MODEL);
      scored.push(sc);
      const scene = SCENES.find((x) => x.scene_id === reply.scene_id)!;
      const per = (sc.trait_adherence.notes.match(/per-trait: ([\d.,]+)/)?.[1] ?? "").split(",").map(Number);
      (scene.applicable_traits ?? []).forEach((ti, k) => (traitVals[ti] ??= []).push(per[k]));
      if (REN_SCENES.has(reply.scene_id) && !reply.error) guard.push(await wardScore(scene, reply.reply));
    }
    const cells = collapseToMedians(scored);
    const perModel: Record<string, number> = {};
    for (const m of MODELS) perModel[m] = mean(cells.filter((c) => c.provider_id === m).map((c) => c.trait_adherence.score));
    const perTrait: Record<string, number> = {};
    for (const [k, vals] of Object.entries(traitVals)) perTrait[k] = mean(vals);
    const targeted = mean([...(traitVals[2] ?? []), ...(traitVals[3] ?? [])]);
    out[id] = { perModel, mean: mean(Object.values(perModel)), guard: mean(guard), perTrait, targeted };
    raw[id] = { traits_shown: fixtureFor(id, enacts).core_traits, replies: run.replies, scores: scored, guard };
    console.log(`  mean ${out[id].mean.toFixed(3)}  guard(Ren) ${out[id].guard.toFixed(3)}  targeted(T2+T3) ${targeted.toFixed(3)}  ` + MODELS.map((m) => `${m} ${perModel[m].toFixed(3)}`).join("  "));
    console.log(`  per-trait: ` + Object.entries(perTrait).sort().map(([k, x]) => `T${k}=${x.toFixed(2)}`).join(" "));
  }

  const A = out["A-original"];
  console.log("\n── Selection (rule in docs/TRAIT-ENACTMENT-DEV.md) ──");
  const qualifying: VariantId[] = [];
  for (const id of VARIANT_IDS.slice(1)) {
    const o = out[id];
    const r1 = o.mean - A.mean >= 0.05;
    const r2 = MODELS.every((m) => o.perModel[m] >= A.perModel[m] - 0.05);
    const r3 = o.guard >= A.guard - 0.05;
    const r4 = o.targeted - A.targeted >= 0.05;
    console.log(`  ${id}: gain ${(o.mean - A.mean).toFixed(3)} [${r1 ? "ok" : "FAIL"} ≥0.05]  no-model-drop [${r2 ? "ok" : "FAIL"}]  guard Δ ${(o.guard - A.guard).toFixed(3)} [${r3 ? "ok" : "FAIL"}]  targeted Δ ${(o.targeted - A.targeted).toFixed(3)} [${r4 ? "ok" : "FAIL"} ≥0.05]`);
    if (r1 && r2 && r3 && r4) qualifying.push(id);
  }
  const winner: VariantId | null = qualifying.length
    ? [...qualifying].sort((a, b) => out[b].mean - out[a].mean || (a === "E1-replace" ? -1 : 1))[0]
    : null;
  console.log(`  → ${winner ? `ADOPT ${winner}` : "NO VARIANT QUALIFIES — null result, no v4 run"}`);
  console.log(`  judge health: ${judgeStats.calls} calls, ${judgeStats.unparseable} unparseable, ${judgeStats.errors} errors`);

  await writeFile(path.join(docs, "trait-enactment-dev-2026-09-30.json"), JSON.stringify({ samples: SAMPLES, judge: JUDGE_MODEL, out, winner, judge_health: { ...judgeStats }, raw }, null, 2) + "\n", "utf8");
  console.log("  wrote docs/trait-enactment-dev-2026-09-30.json");
}

main().catch((e) => { console.error("dev run failed:", e); process.exit(1); });
