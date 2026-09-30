// Cross-model character benchmark — protocol v4 (docs/BENCHMARK-PROTOCOL-v4.md).
//
// Tests trait enactment phrasing (variant E2-augment of docs/TRAIT-ENACTMENT-DEV.md):
// each trait is shown as the original text plus an "On the page:" restatement.
// Eight fresh scenes (scripts/bench-scenes-v4.ts). Thresholds unchanged from v1–v3.
// The verdict comes from evaluateProtocol() on the `identity` (E2) and `control`
// arms only; an `identity-original` arm and a warmth check are reported, not gated.
//
// Refuses to run unless the scene set and the rewrites file match what the
// protocol froze. Goes straight to Ollama; touches no Chronicler server or database.
//
// Run:  npx tsx scripts/run-benchmark-v4.ts
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
  PROTOCOL_V2,
  scoreReply,
  type ReplyScore,
  type ScoringConfig,
} from "../src/lib/instrumentation/character-consistency-scorer";
import { ADIRA_FIXTURE, DirectOllamaProvider } from "./bench-common";
import { SCENES_V4 } from "./bench-scenes-v4";

const FROZEN_SCENES = "f369219f74512996"; // recorded 2026-09-30T07:16:09Z, before any dev result
const FROZEN_REWRITES = "dab4649505921558"; // sha256[:16] of docs/trait-enactment-rewrites-2026-09-30.json

// The judge always scores against the ORIGINAL fixture traits, never the restatements.
const SCORING_CONFIG: ScoringConfig = {
  fixture: ADIRA_FIXTURE,
  scenes_by_id: Object.fromEntries(SCENES_V4.map((s) => [s.scene_id, s])),
  signature_rules: [],
  active_preferences: [],
  active_limits: [],
  drift_summary: "",
  traits_only: true,
};

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODELS = (process.env.BENCH_MODELS ?? "qwen3.5:9b,qwen2.5:7b,gpt-oss:20b").split(",").map((m) => m.trim());
const PROVIDERS: ProviderUnderTest[] = MODELS.map((m) => ({ id: m, provider: new DirectOllamaProvider(OLLAMA_BASE, m), model: m }));
const JUDGE_MODEL = process.env.BENCH_JUDGE ?? "qwen3.6:35b";
const JUDGE = new DirectOllamaProvider(OLLAMA_BASE, JUDGE_MODEL);
const SAMPLES = Math.max(1, Number(process.env.BENCH_SAMPLES ?? 3));
if (PROVIDERS.some((p) => p.model === JUDGE_MODEL)) throw new Error(`judge ${JUDGE_MODEL} must not be a participant`);

const REN_SCENES = new Set(["v4-missed-vigil", "v4-promise-ring", "v4-first-solo"]);
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function sceneFingerprint(): string {
  return sha(JSON.stringify({ SCENES_V4, traits: ADIRA_FIXTURE.core_traits }));
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
  if (sceneFingerprint() !== FROZEN_SCENES) throw new Error(`scenes/fixture changed since freezing (${sceneFingerprint()} != ${FROZEN_SCENES}); protocol v4 is void`);
  const rewritesRaw = await readFile(path.join(docsDir, "trait-enactment-rewrites-2026-09-30.json"), "utf8");
  if (sha(rewritesRaw) !== FROZEN_REWRITES) throw new Error(`rewrites file changed since freezing (${sha(rewritesRaw)} != ${FROZEN_REWRITES}); protocol v4 is void`);
  const rewrites = JSON.parse(rewritesRaw) as { traits: string[]; enacts: (string | null)[] };
  if (JSON.stringify(rewrites.traits) !== JSON.stringify(ADIRA_FIXTURE.core_traits)) throw new Error("rewrites were made for different traits than the fixture has");
  const dev = JSON.parse(await readFile(path.join(docsDir, "trait-enactment-dev-2026-09-30.json"), "utf8"));
  if (dev.winner !== "E2-augment") throw new Error(`dev winner is ${dev.winner}; protocol v4 tests E2-augment`);

  const e2Traits = ADIRA_FIXTURE.core_traits.map((t, i) => (rewrites.enacts[i] ? `${t}\n    On the page: ${rewrites.enacts[i]}` : t));
  if (JSON.stringify(e2Traits) !== JSON.stringify(dev.raw["E2-augment"].traits_shown)) throw new Error("the traits rendered here differ from what the dev run rendered for E2-augment");
  const e2Fixture: CharacterFixture = { ...ADIRA_FIXTURE, core_traits: e2Traits };

  const date = new Date().toISOString().slice(0, 10);
  console.log(`Cross-model character benchmark v4 — docs/BENCHMARK-PROTOCOL-v4.md`);
  console.log(`scenes: ${SCENES_V4.length}  samples/cell: ${SAMPLES}  models: ${MODELS.join(", ")}  judge: ${JUDGE_MODEL}`);
  console.log(`frozen inputs OK: scenes ${FROZEN_SCENES}, rewrites ${FROZEN_REWRITES}; ${rewrites.enacts.filter(Boolean).length}/${rewrites.enacts.length} traits restated\n`);

  // ── verdict arms: identity (E2) and control ──
  const t0 = Date.now();
  const run = await runCrossModelBenchmark({
    fixture: e2Fixture, scenes: SCENES_V4, providers: PROVIDERS, samples: SAMPLES,
    onReply: (r) => console.log(`  ${r.error ? "✗" : "✓"} ${`${r.provider_id} / ${r.scene_id} / ${r.arm} #${r.sample ?? 0}`.padEnd(64)} ${(r.duration_ms / 1000).toFixed(1)}s ${r.error ? `err=${r.error}` : `(${r.reply.length} chars)`}`),
  });
  const genSec = ((Date.now() - t0) / 1000).toFixed(1);
  const failed = run.replies.filter((r) => r.error || !r.reply.trim()).length;
  console.log(`generation: ${genSec}s, ${failed} failed/empty of ${run.replies.length}\n── scoring ──`);

  const t1 = Date.now();
  const sampleScores: ReplyScore[] = [];
  for (const reply of run.replies) {
    const s = await scoreReply(reply, SCORING_CONFIG, JUDGE, JUDGE_MODEL);
    sampleScores.push(s);
    console.log(`  ${`${reply.provider_id} / ${reply.scene_id} / ${reply.arm} #${reply.sample ?? 0}`.padEnd(64)} trait=${s.trait_adherence.score.toFixed(2)}`);
  }
  console.log(`scoring: ${((Date.now() - t1) / 1000).toFixed(1)}s\n`);

  const cells = collapseToMedians(sampleScores);
  const agg = aggregateScores(run, cells);
  const verdict = evaluateProtocol(cells, PROTOCOL_V2);

  console.log("── Verdict (protocol v4) ──");
  for (const m of verdict.models)
    console.log(`  ${m.provider_id.padEnd(14)} identity ${m.identity.toFixed(3)}  control ${m.control.toFixed(3)}  lift ${m.lift.toFixed(3)}  scenes won ${m.scenes_won}/${m.scene_count}`);
  console.log(`  mean lift ${verdict.mean_lift.toFixed(3)}  mean identity fidelity ${verdict.mean_identity.toFixed(3)}  σ(identity) ${agg.cross_provider_stddev.toFixed(3)} (reported, not gated)`);
  console.log(`  → ${verdict.pass ? "PASS" : "FAIL"}${verdict.failures.length ? "\n    " + verdict.failures.join("\n    ") : ""}`);

  // ── exploratory: the fixture's original traits, same scenes ──
  console.log("\n── Exploratory arm: identity-original (traits as-is) ──");
  const runOrig = await runCrossModelBenchmark({ fixture: ADIRA_FIXTURE, scenes: SCENES_V4, providers: PROVIDERS, samples: SAMPLES, arms: ["identity"] });
  const origScores: ReplyScore[] = [];
  for (const reply of runOrig.replies) origScores.push(await scoreReply(reply, SCORING_CONFIG, JUDGE, JUDGE_MODEL));
  const origCells = collapseToMedians(origScores);
  const by = (cs: ReplyScore[], id: string) => mean(cs.filter((c) => c.provider_id === id && c.arm === "identity").map((c) => c.trait_adherence.score));
  const explore = MODELS.map((id) => ({ id, e2: by(cells, id), original: by(origCells, id) }));
  const meanE2 = mean(explore.map((e) => e.e2)), meanOrig = mean(explore.map((e) => e.original));
  for (const e of explore) console.log(`  ${e.id.padEnd(14)} E2 ${e.e2.toFixed(3)}  original ${e.original.toFixed(3)}  E2−original ${(e.e2 - e.original).toFixed(3)}`);
  console.log(`  mean E2 ${meanE2.toFixed(3)}  original ${meanOrig.toFixed(3)}  E2−original ${(meanE2 - meanOrig).toFixed(3)}`);

  // ── reported, not gated: warmth toward Ren ──
  const warmE2: number[] = [], warmOrig: number[] = [];
  for (const r of run.replies) if (r.arm === "identity" && REN_SCENES.has(r.scene_id) && !r.error) warmE2.push(await warmth(SCENES_V4.find((s) => s.scene_id === r.scene_id)!, r.reply));
  for (const r of runOrig.replies) if (REN_SCENES.has(r.scene_id) && !r.error) warmOrig.push(await warmth(SCENES_V4.find((s) => s.scene_id === r.scene_id)!, r.reply));
  console.log(`  warmth toward Ren (reported, not gated): E2 ${mean(warmE2).toFixed(3)}  original ${mean(warmOrig).toFixed(3)}  Δ ${(mean(warmE2) - mean(warmOrig)).toFixed(3)}`);

  // ── per-trait breakdown (identity E2 vs control) ──
  const perTrait: Record<string, { identity: number[]; control: number[] }> = {};
  for (const s of sampleScores) {
    const sc = SCENES_V4.find((x) => x.scene_id === s.scene_id);
    const vals = (s.trait_adherence.notes.match(/per-trait: ([\d.,]+)/)?.[1] ?? "").split(",").map(Number);
    (sc?.applicable_traits ?? []).forEach((ti, k) => {
      const key = `${ti}: ${ADIRA_FIXTURE.core_traits[ti].slice(0, 48)}`;
      (perTrait[key] ??= { identity: [], control: [] })[s.arm].push(vals[k]);
    });
  }
  console.log("\n  per-trait mean (all models, all samples)          identity  control");
  for (const [k, v] of Object.entries(perTrait).sort()) console.log(`  ${k.padEnd(52)} ${mean(v.identity).toFixed(2)}      ${mean(v.control).toFixed(2)}`);
  console.log(`  judge health: ${judgeStats.calls} calls, ${judgeStats.unparseable} unparseable, ${judgeStats.errors} errors`);

  await mkdir(docsDir, { recursive: true });
  const stem = `benchmark-v4-${date}`;
  await writeFile(
    path.join(docsDir, `${stem}.json`),
    JSON.stringify({ protocol: "docs/BENCHMARK-PROTOCOL-v4.md", thresholds: PROTOCOL_V2, frozen: { scenes: FROZEN_SCENES, rewrites: FROZEN_REWRITES }, models: MODELS, judge: JUDGE_MODEL, samples: SAMPLES, ran_at: run.ran_at, judge_health: { ...judgeStats }, failed_replies: failed, verdict, traits_shown: e2Traits, exploratory: { explore, meanE2, meanOrig, warmth: { e2: mean(warmE2), original: mean(warmOrig) }, orig_replies: runOrig.replies, orig_scores: origScores }, per_trait: perTrait, per_sample_scores: sampleScores, raw_replies: run.replies }, null, 2) + "\n",
    "utf8"
  );
  console.log(`\n  wrote docs/${stem}.json`);
  process.exit(verdict.pass ? 0 : 2);
}

main().catch((e) => {
  console.error("benchmark failed:", e);
  process.exit(1);
});
