// Cross-model character benchmark — protocol v5, a scoped claim
// (docs/BENCHMARK-PROTOCOL-v5.md). Claim: for qwen3.5:9b and gpt-oss:20b the
// DEFAULT identity layer clears the pre-registered bar. Ten fresh scenes
// (scripts/bench-scenes-v5.ts); no tuning step exists. The verdict comes from
// evaluateProtocol() on the two verdict models' `identity` (default) and
// `control` arms only. The restatement (E2) arm, the qwen2.5:7b floor tier and
// the warmth check are reported, not gated.
//
// Refuses to run unless the scene set and the restatement file match what the
// protocol froze. Goes straight to Ollama; touches no Chronicler server or database.
//
// Run:  npx tsx scripts/run-benchmark-v5.ts
// Env:  BENCH_SAMPLES (default 3), BENCH_JUDGE (default qwen3.6:35b)

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCrossModelBenchmark, type CharacterFixture, type ProviderUnderTest } from "../src/lib/instrumentation/cross-model-runner";
import {
  aggregateScores,
  collapseToMedians,
  evaluateProtocol,
  judgeStats,
  PROTOCOL_V5,
  scoreReply,
  type ReplyScore,
  type ScoringConfig,
} from "../src/lib/instrumentation/character-consistency-scorer";
import { ADIRA_FIXTURE, DirectOllamaProvider } from "./bench-common";
import { SCENES_V5 } from "./bench-scenes-v5";

const FROZEN_SCENES = "f0b07a73f29b8754"; // recorded 2026-09-30T15:06:10Z, before any v5 reply
const FROZEN_REWRITES = "dab4649505921558"; // sha256[:16] of docs/trait-enactment-rewrites-2026-09-30.json

// The judge always scores against the ORIGINAL fixture traits, never the restatements.
const SCORING_CONFIG: ScoringConfig = {
  fixture: ADIRA_FIXTURE,
  scenes_by_id: Object.fromEntries(SCENES_V5.map((s) => [s.scene_id, s])),
  signature_rules: [],
  active_preferences: [],
  active_limits: [],
  drift_summary: "",
  traits_only: true,
};

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
// BENCH_SMOKE=1 exercises every code path with a tiny model and never writes a result file.
const SMOKE = process.env.BENCH_SMOKE === "1";
const MODELS = SMOKE ? ["qwen2.5:1.5b"] : ["qwen3.5:9b", "gpt-oss:20b"]; // the claim's verdict models
const FLOOR = SMOKE ? "qwen2.5:1.5b" : "qwen2.5:7b"; // exploratory floor tier
const mk = (ms: string[]): ProviderUnderTest[] => ms.map((m) => ({ id: m, provider: new DirectOllamaProvider(OLLAMA_BASE, m), model: m }));
const PROVIDERS = mk(MODELS);
const FLOOR_PROVIDERS = mk([FLOOR]);
const JUDGE_MODEL = process.env.BENCH_JUDGE ?? "qwen3.6:35b";
const JUDGE = new DirectOllamaProvider(OLLAMA_BASE, JUDGE_MODEL);
const SAMPLES = Math.max(1, Number(process.env.BENCH_SAMPLES ?? 3));
if (PROVIDERS.some((p) => p.model === JUDGE_MODEL)) throw new Error(`judge ${JUDGE_MODEL} must not be a participant`);

const REN_SCENES = new Set(["v5-missed-wedding", "v5-grandfather", "v5-settle-down", "v5-loose-skiff"]);
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function sceneFingerprint(): string {
  return sha(JSON.stringify({ SCENES_V5, traits: ADIRA_FIXTURE.core_traits }));
}

const GUARD_SYSTEM = `You judge one roleplay reply. Output STRICT JSON only: {"score": number, "notes": string}. score is 0.0 to 1.0.`;
async function warmth(scene: { scene_text: string; user_message: string }, reply: string): Promise<number> {
  try {
    const r = await JUDGE.chat({
      model: JUDGE_MODEL, system: GUARD_SYSTEM, temperature: 0, max_tokens: 200,
      messages: [{ role: "user", content: `Scene:\n"""${scene.scene_text}"""\nRen says: "${scene.user_message}"\n\nAdira's reply:\n"""${reply.trim()}"""\n\nRen is Adira's closest, most trusted friend. Is Adira warm and open TOWARD REN in this reply — not cold, stonewalling, or treating Ren like a stranger? 1.0 = clearly warm and open; 0.0 = cold, evasive, or hostile to Ren.` }],
    });
    const m = r.content.match(/"score"\s*:\s*([0-9.]+)/);
    return m ? Math.max(0, Math.min(1, Number(m[1]))) : 0.5;
  } catch {
    return 0.5;
  }
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const docsDir = path.resolve(here, "..", "docs");

  // ── frozen-input checks ──
  if (sceneFingerprint() !== FROZEN_SCENES) throw new Error(`scenes/fixture changed since freezing (${sceneFingerprint()} != ${FROZEN_SCENES}); protocol v5 is void`);
  const rewritesRaw = await readFile(path.join(docsDir, "trait-enactment-rewrites-2026-09-30.json"), "utf8");
  if (sha(rewritesRaw) !== FROZEN_REWRITES) throw new Error(`rewrites file changed since freezing (${sha(rewritesRaw)} != ${FROZEN_REWRITES}); protocol v5 is void`);
  const rewrites = JSON.parse(rewritesRaw) as { traits: string[]; enacts: (string | null)[] };
  if (JSON.stringify(rewrites.traits) !== JSON.stringify(ADIRA_FIXTURE.core_traits)) throw new Error("rewrites were made for different traits than the fixture has");
  const e2Traits = ADIRA_FIXTURE.core_traits.map((t, i) => (rewrites.enacts[i] ? `${t}\n    On the page: ${rewrites.enacts[i]}` : t));
  const e2Fixture: CharacterFixture = { ...ADIRA_FIXTURE, core_traits: e2Traits };

  const date = new Date().toISOString().slice(0, 10);
  console.log(`Cross-model character benchmark v5 (scoped claim) — docs/BENCHMARK-PROTOCOL-v5.md`);
  console.log(`scenes: ${SCENES_V5.length}  samples/cell: ${SAMPLES}  verdict models: ${MODELS.join(", ")}  floor: ${FLOOR}  judge: ${JUDGE_MODEL}`);
  console.log(`frozen inputs OK: scenes ${FROZEN_SCENES}, rewrites ${FROZEN_REWRITES}\n`);

  const progress = (r: { error?: string; provider_id: string; scene_id: string; arm: string; sample?: number; duration_ms: number; reply: string }) =>
    console.log(`  ${r.error ? "✗" : "✓"} ${`${r.provider_id} / ${r.scene_id} / ${r.arm} #${r.sample ?? 0}`.padEnd(64)} ${(r.duration_ms / 1000).toFixed(1)}s ${r.error ? `err=${r.error}` : `(${r.reply.length} chars)`}`);
  const scoreAll = async (replies: { provider_id: string; scene_id: string; arm: "identity" | "control"; sample?: number; reply: string; duration_ms: number; error?: string }[]): Promise<ReplyScore[]> => {
    const out: ReplyScore[] = [];
    for (const reply of replies) out.push(await scoreReply(reply, SCORING_CONFIG, JUDGE, JUDGE_MODEL));
    return out;
  };

  // ── verdict arms: default identity layer vs control, the two claim models ──
  const t0 = Date.now();
  const run = await runCrossModelBenchmark({ fixture: ADIRA_FIXTURE, scenes: SCENES_V5, providers: PROVIDERS, samples: SAMPLES, onReply: progress });
  const failed = run.replies.filter((r) => r.error || !r.reply.trim()).length;
  console.log(`generation (verdict): ${((Date.now() - t0) / 1000).toFixed(1)}s, ${failed} failed/empty of ${run.replies.length}`);
  const sampleScores = await scoreAll(run.replies);
  const cells = collapseToMedians(sampleScores);
  const agg = aggregateScores(run, cells);
  const verdict = evaluateProtocol(cells, PROTOCOL_V5);

  console.log("\n── Verdict (protocol v5) ──");
  for (const m of verdict.models)
    console.log(`  ${m.provider_id.padEnd(14)} identity ${m.identity.toFixed(3)}  control ${m.control.toFixed(3)}  lift ${m.lift.toFixed(3)}  scenes won ${m.scenes_won}/${m.scene_count}`);
  console.log(`  mean lift ${verdict.mean_lift.toFixed(3)}  mean identity fidelity ${verdict.mean_identity.toFixed(3)}  σ(identity) ${agg.cross_provider_stddev.toFixed(3)} (reported, not gated)`);
  console.log(`  → ${verdict.pass ? "PASS" : "FAIL"}${verdict.failures.length ? "\n    " + verdict.failures.join("\n    ") : ""}`);

  // ── exploratory (a): the optional restatement arm, same two models ──
  console.log("\n── Exploratory (a): identity with 'On the page:' restatements (E2) ──");
  const runE2 = await runCrossModelBenchmark({ fixture: e2Fixture, scenes: SCENES_V5, providers: PROVIDERS, samples: SAMPLES, arms: ["identity"], onReply: progress });
  const e2Scores = await scoreAll(runE2.replies);
  const e2Cells = collapseToMedians(e2Scores);
  const by = (cs: ReplyScore[], id: string, arm: "identity" | "control" = "identity") => mean(cs.filter((c) => c.provider_id === id && c.arm === arm).map((c) => c.trait_adherence.score));
  const explore = MODELS.map((id) => ({ id, default: by(cells, id), e2: by(e2Cells, id) }));
  for (const e of explore) console.log(`  ${e.id.padEnd(14)} default ${e.default.toFixed(3)}  E2 ${e.e2.toFixed(3)}  E2−default ${(e.e2 - e.default).toFixed(3)}`);
  console.log(`  mean default ${mean(explore.map((e) => e.default)).toFixed(3)}  E2 ${mean(explore.map((e) => e.e2)).toFixed(3)}  (descriptive; per-model E2 gains varied ±0.2 between earlier runs)`);

  // ── exploratory (b): the 7B floor tier, both arms ──
  console.log("\n── Exploratory (b): floor tier qwen2.5:7b ──");
  const runFloor = await runCrossModelBenchmark({ fixture: ADIRA_FIXTURE, scenes: SCENES_V5, providers: FLOOR_PROVIDERS, samples: SAMPLES, onReply: progress });
  const floorScores = await scoreAll(runFloor.replies);
  const floorCells = collapseToMedians(floorScores);
  const floorVerdict = evaluateProtocol(floorCells, PROTOCOL_V5);
  for (const m of floorVerdict.models) console.log(`  ${m.provider_id.padEnd(14)} identity ${m.identity.toFixed(3)}  control ${m.control.toFixed(3)}  lift ${m.lift.toFixed(3)}  scenes won ${m.scenes_won}/${m.scene_count}`);

  // ── reported, not gated: warmth toward Ren, default vs E2 ──
  const warmDef: number[] = [], warmE2: number[] = [];
  const scene = (id: string) => SCENES_V5.find((s) => s.scene_id === id)!;
  for (const r of run.replies) if (r.arm === "identity" && REN_SCENES.has(r.scene_id) && !r.error) warmDef.push(await warmth(scene(r.scene_id), r.reply));
  for (const r of runE2.replies) if (REN_SCENES.has(r.scene_id) && !r.error) warmE2.push(await warmth(scene(r.scene_id), r.reply));
  console.log(`\n  warmth toward Ren (reported, not gated): default ${mean(warmDef).toFixed(3)}  E2 ${mean(warmE2).toFixed(3)}`);

  // ── per-trait breakdown (verdict models, identity vs control) ──
  const perTrait: Record<string, { identity: number[]; control: number[] }> = {};
  for (const sc of sampleScores) {
    const def = SCENES_V5.find((x) => x.scene_id === sc.scene_id);
    const vals = (sc.trait_adherence.notes.match(/per-trait: ([\d.,]+)/)?.[1] ?? "").split(",").map(Number);
    (def?.applicable_traits ?? []).forEach((ti, k) => {
      const key = `${ti}: ${ADIRA_FIXTURE.core_traits[ti].slice(0, 48)}`;
      (perTrait[key] ??= { identity: [], control: [] })[sc.arm].push(vals[k]);
    });
  }
  console.log("\n  per-trait mean (verdict models, all samples)      identity  control");
  for (const [k, v] of Object.entries(perTrait).sort()) console.log(`  ${k.padEnd(52)} ${mean(v.identity).toFixed(2)}      ${mean(v.control).toFixed(2)}`);
  const failedAll = failed + runE2.replies.filter((r) => r.error || !r.reply.trim()).length + runFloor.replies.filter((r) => r.error || !r.reply.trim()).length;
  console.log(`  failed/empty replies overall: ${failedAll}; judge health: ${judgeStats.calls} calls, ${judgeStats.unparseable} unparseable, ${judgeStats.errors} errors`);

  if (SMOKE) {
    console.log("\n  SMOKE run: nothing written, and this is not a measurement.");
    process.exit(0);
  }
  await mkdir(docsDir, { recursive: true });
  const stem = `benchmark-v5-${date}`;
  await writeFile(
    path.join(docsDir, `${stem}.json`),
    JSON.stringify({
      protocol: "docs/BENCHMARK-PROTOCOL-v5.md", thresholds: PROTOCOL_V5, frozen: { scenes: FROZEN_SCENES, rewrites: FROZEN_REWRITES },
      models: MODELS, floor: FLOOR, judge: JUDGE_MODEL, samples: SAMPLES, ran_at: run.ran_at,
      judge_health: { ...judgeStats }, failed_replies: failedAll, verdict, per_trait: perTrait,
      exploratory: { explore, warmth: { default: mean(warmDef), e2: mean(warmE2) }, floor: floorVerdict, e2_replies: runE2.replies, e2_scores: e2Scores, floor_replies: runFloor.replies, floor_scores: floorScores },
      per_sample_scores: sampleScores, raw_replies: run.replies,
    }, null, 2) + "\n",
    "utf8"
  );
  console.log(`\n  wrote docs/${stem}.json`);
  process.exit(verdict.pass ? 0 : 2);
}

main().catch((e) => {
  console.error("benchmark failed:", e);
  process.exit(1);
});
