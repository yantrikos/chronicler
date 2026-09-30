// Cross-model character benchmark — protocol v3 (docs/BENCHMARK-PROTOCOL-v3.md).
//
// Eight fresh scenes (scripts/bench-scenes-v3.ts, frozen before the dev
// experiment's results were known). The verdict arm uses identity-intro
// variant B; an exploratory arm runs the current default intro. Thresholds are
// unchanged from v1/v2. The verdict comes from evaluateProtocol() and is
// computed from the B and control arms only.
//
// Goes straight to Ollama; touches no Chronicler server or database.
//
// Run:  npx tsx scripts/run-benchmark-v3.ts
// Env:  BENCH_SAMPLES (default 3), BENCH_JUDGE (default qwen3.6:35b),
//       BENCH_MODELS (comma list, default the three v1 participants)

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runCrossModelBenchmark,
  type ProviderUnderTest,
} from "../src/lib/instrumentation/cross-model-runner";
import {
  aggregateScores,
  collapseToMedians,
  evaluateProtocol,
  judgeStats,
  PROTOCOL_V2,
  scoreReply,
  type ReplyScore,
  type ScoringConfig,
} from "../src/lib/instrumentation/character-consistency-scorer";
import { readFileSync } from "node:fs";
import { IDENTITY_INTRO_DEFAULT } from "../src/lib/orchestrator/anti-confabulation";
import { ADIRA_FIXTURE, DirectOllamaProvider } from "./bench-common";
import { SCENES_V3 } from "./bench-scenes-v3";

const SCORING_CONFIG: ScoringConfig = {
  fixture: ADIRA_FIXTURE,
  scenes_by_id: Object.fromEntries(SCENES_V3.map((s) => [s.scene_id, s])),
  signature_rules: [],
  active_preferences: [],
  active_limits: [],
  drift_summary: "",
  traits_only: true,
};

// Variant B's text is read from the recorded dev result, so what is tested is
// exactly what the pre-declared selection rule chose.
const DEV_RESULT = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "identity-intro-dev-2026-09-30.json"), "utf8"));
if (DEV_RESULT.winner !== "B-enact") throw new Error(`dev winner is ${DEV_RESULT.winner}, protocol v3 tests B-enact`);
const INTRO_B: string = DEV_RESULT.raw["B-enact"].intro;

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODELS = (process.env.BENCH_MODELS ?? "qwen3.5:9b,qwen2.5:7b,gpt-oss:20b").split(",").map((m) => m.trim());
const PROVIDERS: ProviderUnderTest[] = MODELS.map((m) => ({
  id: m,
  provider: new DirectOllamaProvider(OLLAMA_BASE, m),
  model: m,
}));
const JUDGE_MODEL = process.env.BENCH_JUDGE ?? "qwen3.6:35b";
const JUDGE_PROVIDER = new DirectOllamaProvider(OLLAMA_BASE, JUDGE_MODEL);
const SAMPLES = Math.max(1, Number(process.env.BENCH_SAMPLES ?? 3));
if (PROVIDERS.some((p) => p.model === JUDGE_MODEL)) throw new Error(`judge ${JUDGE_MODEL} must not be a participant`);

/** Fingerprint of the scene set + fixture, recorded in the output so a later
 *  edit to the scenes is detectable against the run that used them. */
function fingerprint(): string {
  return createHash("sha256").update(JSON.stringify({ SCENES_V3, traits: ADIRA_FIXTURE.core_traits })).digest("hex").slice(0, 16);
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const FROZEN_FINGERPRINT = "ee00498f76a69862"; // recorded 2026-09-30T05:26:15Z, before dev results

async function main(): Promise<void> {
  if (fingerprint() !== FROZEN_FINGERPRINT) throw new Error(`scene set or fixture changed since it was frozen (${fingerprint()} != ${FROZEN_FINGERPRINT}); protocol v3 is void`);
  const date = new Date().toISOString().slice(0, 10);
  console.log(`Cross-model character benchmark v3 — docs/BENCHMARK-PROTOCOL-v3.md`);
  console.log(`scenes: ${SCENES_V3.length}  samples/cell: ${SAMPLES}  models: ${MODELS.join(", ")}  judge: ${JUDGE_MODEL}  fingerprint: ${fingerprint()}\n`);

  const t0 = Date.now();
  const run = await runCrossModelBenchmark({
    fixture: ADIRA_FIXTURE,
    scenes: SCENES_V3,
    providers: PROVIDERS,
    samples: SAMPLES,
    identityIntro: INTRO_B,
    onReply: (r) =>
      console.log(`  ${r.error ? "✗" : "✓"} ${`${r.provider_id} / ${r.scene_id} / ${r.arm} #${r.sample ?? 0}`.padEnd(64)} ${(r.duration_ms / 1000).toFixed(1)}s ${r.error ? `err=${r.error}` : `(${r.reply.length} chars)`}`),
  });
  const genSec = ((Date.now() - t0) / 1000).toFixed(1);
  const failed = run.replies.filter((r) => r.error || !r.reply.trim()).length;
  console.log(`generation: ${genSec}s, ${failed} failed/empty of ${run.replies.length}\n── scoring ──`);

  const t1 = Date.now();
  const sampleScores: ReplyScore[] = [];
  for (const reply of run.replies) {
    const score = await scoreReply(reply, SCORING_CONFIG, JUDGE_PROVIDER, JUDGE_MODEL);
    sampleScores.push(score);
    console.log(`  ${`${reply.provider_id} / ${reply.scene_id} / ${reply.arm} #${reply.sample ?? 0}`.padEnd(64)} trait=${score.trait_adherence.score.toFixed(2)}`);
  }
  const scoreSec = ((Date.now() - t1) / 1000).toFixed(1);
  console.log(`scoring: ${scoreSec}s; judge health: ${judgeStats.calls} calls, ${judgeStats.unparseable} unparseable, ${judgeStats.errors} errors\n`);

  const cells = collapseToMedians(sampleScores);
  const agg = aggregateScores(run, cells);
  const verdict = evaluateProtocol(cells, PROTOCOL_V2);

  console.log("── Verdict (protocol v3) ──");
  for (const m of verdict.models)
    console.log(`  ${m.provider_id.padEnd(14)} identity ${m.identity.toFixed(3)}  control ${m.control.toFixed(3)}  lift ${m.lift.toFixed(3)}  scenes won ${m.scenes_won}/${m.scene_count}`);
  console.log(`  mean lift ${verdict.mean_lift.toFixed(3)}  mean identity fidelity ${verdict.mean_identity.toFixed(3)}  σ(identity) ${agg.cross_provider_stddev.toFixed(3)} (reported, not gated)`);
  console.log(`  → ${verdict.pass ? "PASS" : "FAIL"}${verdict.failures.length ? "\n    " + verdict.failures.join("\n    ") : ""}`);

  // Exploratory (never gated): the current production intro on the same fresh scenes.
  console.log("\n── Exploratory arm: identity with the default intro ──");
  const runDef = await runCrossModelBenchmark({
    fixture: ADIRA_FIXTURE, scenes: SCENES_V3, providers: PROVIDERS, samples: SAMPLES, arms: ["identity"], identityIntro: IDENTITY_INTRO_DEFAULT,
  });
  const defScores: ReplyScore[] = [];
  for (const reply of runDef.replies) defScores.push(await scoreReply(reply, SCORING_CONFIG, JUDGE_PROVIDER, JUDGE_MODEL));
  const defCells = collapseToMedians(defScores);
  const mBy = (cs: ReplyScore[], arm: "identity" | "control", id: string) => mean(cs.filter((c) => c.provider_id === id && c.arm === arm).map((c) => c.trait_adherence.score));
  const explore = MODELS.map((id) => ({ id, B: mBy(cells, "identity", id), def: mBy(defCells, "identity", id) }));
  const meanB = mean(explore.map((e) => e.B)), meanDef = mean(explore.map((e) => e.def));
  for (const e of explore) console.log(`  ${e.id.padEnd(14)} B ${e.B.toFixed(3)}  default ${e.def.toFixed(3)}  B−default ${(e.B - e.def).toFixed(3)}`);
  console.log(`  mean B ${meanB.toFixed(3)}  default ${meanDef.toFixed(3)}  B−default ${(meanB - meanDef).toFixed(3)} (descriptive only)`);

  // Per-trait breakdown from the per-sample notes (identity arm), for diagnosis.
  const perTrait: Record<string, { identity: number[]; control: number[] }> = {};
  for (const s of sampleScores) {
    const sc = SCENES_V3.find((x) => x.scene_id === s.scene_id);
    const vals = (s.trait_adherence.notes.match(/per-trait: ([\d.,]+)/)?.[1] ?? "").split(",").map(Number);
    (sc?.applicable_traits ?? []).forEach((ti, k) => {
      const key = `${ti}: ${ADIRA_FIXTURE.core_traits[ti].slice(0, 48)}`;
      (perTrait[key] ??= { identity: [], control: [] })[s.arm].push(vals[k]);
    });
  }
  console.log("\n  per-trait mean (all models, all samples)          identity  control");
  for (const [k, v] of Object.entries(perTrait).sort())
    console.log(`  ${k.padEnd(52)} ${mean(v.identity).toFixed(2)}      ${mean(v.control).toFixed(2)}`);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const docsDir = path.resolve(here, "..", "docs");
  await mkdir(docsDir, { recursive: true });
  const stem = `benchmark-v3-${date}`;
  await writeFile(
    path.join(docsDir, `${stem}.json`),
    JSON.stringify({ protocol: "docs/BENCHMARK-PROTOCOL-v3.md", thresholds: PROTOCOL_V2, fingerprint: fingerprint(), models: MODELS, judge: JUDGE_MODEL, samples: SAMPLES, ran_at: run.ran_at, judge_health: { ...judgeStats }, failed_replies: failed, verdict, intro_B: INTRO_B, exploratory: { explore, meanB, meanDef, def_replies: runDef.replies, def_scores: defScores }, per_trait: perTrait, per_sample_scores: sampleScores, raw_replies: run.replies }, null, 2) + "\n",
    "utf8"
  );
  console.log(`\n  wrote docs/${stem}.json`);
  process.exit(verdict.pass ? 0 : 2);
}

main().catch((e) => {
  console.error("benchmark failed:", e);
  process.exit(1);
});
