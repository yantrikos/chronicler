// Phase 11 Pillar 4 — standalone cross-model benchmark runner.
//
// Validates the thesis "character emerges from the substrate, not the
// LLM weights" against a hand-authored synthetic Adira fixture, run
// against multiple Ollama models locally.
//
// Methodology choices (defended):
//   - Synthetic fixture (not a live crystallized character): the
//     point is to validate the SUBSTRATE → BEHAVIOR pipeline, not to
//     test a specific user's character. The fixture is constructed
//     to mirror what crystallized substrate would look like.
//   - Direct Ollama provider (no proxy): Node has no CORS — the
//     proxy is only needed in the browser. Going direct keeps the
//     benchmark independent of the running dev server.
//   - Judge model OUTSIDE the participant set: prevents the obvious
//     bias where a participant judges its own output favorably.
//
// Governed by docs/BENCHMARK-PROTOCOL.md: pass criteria were fixed before the
// run. The verdict comes from evaluateProtocol(), not from thresholds here.
//
// Outputs (dated; the retraction notice in CHARACTER-EMERGENCE-RESULTS.md is
// hand-written and this script must never overwrite it):
//   - docs/benchmark-run-<date>.json — raw replies + per-sample scores
//   - docs/BENCHMARK-RUN-<date>.md   — human-readable summary
//
// Run:  npx tsx scripts/run-cross-model-benchmark.ts
// Env:  BENCH_SAMPLES (default 3), BENCH_JUDGE (default qwen3.6:35b)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runCrossModelBenchmark,
  type BenchmarkScene,
  type ProviderUnderTest,
} from "../src/lib/instrumentation/cross-model-runner";
import {
  aggregateScores,
  collapseToMedians,
  evaluateProtocol,
  judgeStats,
  PROTOCOL,
  scoreReply,
  type ReplyScore,
  type ScoringConfig,
} from "../src/lib/instrumentation/character-consistency-scorer";

import { ADIRA_FIXTURE, DirectOllamaProvider, SCENES_V1 as SCENES } from "./bench-common";

const SCORING_CONFIG: ScoringConfig = {
  fixture: ADIRA_FIXTURE,
  scenes_by_id: Object.fromEntries(SCENES.map((s) => [s.scene_id, s])),
  signature_rules: [
    {
      label: "music metaphor",
      pattern: /\b(string|chord|note|rhythm|melody|key|tune|verse|harp|tuning|pitch)\b/,
      min_count: 1,
    },
    {
      label: "deflection/humor markers",
      pattern: /\b(laugh|smile|joke|tease|grin|hmm|ha\b|huh\b)\b/,
      min_count: 1,
    },
    {
      label: "action-not-words pattern",
      pattern: /\b(i'll|i will|let me|i can|here\b)\b/,
      min_count: 1,
    },
  ],
  active_preferences: [
    "Direct questions land better than veiled ones.",
    "Trust is built through consistency over time, not through grand gestures.",
  ],
  active_limits: [
    "Won't be rushed into emotional intimacy.",
    "Won't perform happiness she doesn't feel.",
    "Will not accept transactional framing of physical or emotional closeness.",
  ],
  drift_summary: `Speaker varies by scene. Default with newcomers: trust 0/5, openness 0/5, guarded 5/5. With Ren (trusted friend, scenes 2 and 4): trust 4/5, openness 3/5, guarded 1/5. With the limit-testing stranger in scene 5: adversarial; she does not owe them comfort or compliance.`,
};

// ────────────────────────────────────────────────────────────────────
// Run.
// ────────────────────────────────────────────────────────────────────

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

// Participants: 3 model configurations across families/versions/sizes.
// We picked these because they're the largest variance we have locally
// while keeping run time bounded.
const PROVIDERS: ProviderUnderTest[] = [
  {
    id: "qwen3.5:9b",
    provider: new DirectOllamaProvider(OLLAMA_BASE, "qwen3.5:9b"),
    model: "qwen3.5:9b",
  },
  {
    id: "qwen2.5:7b",
    provider: new DirectOllamaProvider(OLLAMA_BASE, "qwen2.5:7b"),
    model: "qwen2.5:7b",
  },
  {
    id: "gpt-oss:20b",
    provider: new DirectOllamaProvider(OLLAMA_BASE, "gpt-oss:20b"),
    model: "gpt-oss:20b",
  },
];

// Judge: OUTSIDE the participant set and larger than every participant
// (the 4B judge used in the retracted run scored a clearly in-character
// reply at 0.47).
const JUDGE_MODEL = process.env.BENCH_JUDGE ?? "qwen3.6:35b";
const SAMPLES = Math.max(1, Number(process.env.BENCH_SAMPLES ?? 3));
if (PROVIDERS.some((p) => p.model === JUDGE_MODEL)) {
  throw new Error(`judge ${JUDGE_MODEL} must not be a participant`);
}
const JUDGE_PROVIDER = new DirectOllamaProvider(OLLAMA_BASE, JUDGE_MODEL);

async function main(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  console.log(`Cross-model character benchmark — protocol docs/BENCHMARK-PROTOCOL.md`);
  console.log(`character: ${ADIRA_FIXTURE.character_name} (synthetic fixture)`);
  console.log(`scenes:    ${SCENES.length}   samples/cell: ${SAMPLES}   arms: identity, control`);
  console.log(`models:    ${PROVIDERS.map((p) => p.id).join(", ")}`);
  console.log(`judge:     ${JUDGE_MODEL} (outside participant set)`);
  console.log("");

  const runStarted = Date.now();
  console.log("── Phase A: generating replies ──");
  const run = await runCrossModelBenchmark({
    fixture: ADIRA_FIXTURE,
    scenes: SCENES,
    providers: PROVIDERS,
    samples: SAMPLES,
    onReply: (r) => {
      const flag = r.error ? "✗" : "✓";
      const tag = `${r.provider_id} / ${r.scene_id} / ${r.arm} #${r.sample ?? 0}`.padEnd(60, " ");
      console.log(`  ${flag} ${tag} ${(r.duration_ms / 1000).toFixed(1)}s ${r.error ? `err=${r.error}` : `(${r.reply.length} chars)`}`);
    },
  });
  const genElapsed = ((Date.now() - runStarted) / 1000).toFixed(1);
  const failedReplies = run.replies.filter((r) => r.error || !r.reply.trim()).length;
  console.log(`  generation: ${genElapsed}s total, ${failedReplies} failed/empty of ${run.replies.length}\n`);

  console.log("── Phase B: scoring every sample ──");
  const scoreStarted = Date.now();
  const sampleScores: ReplyScore[] = [];
  for (const reply of run.replies) {
    const tag = `${reply.provider_id} / ${reply.scene_id} / ${reply.arm} #${reply.sample ?? 0}`.padEnd(60, " ");
    process.stdout.write(`  ${tag} `);
    const score = await scoreReply(reply, SCORING_CONFIG, JUDGE_PROVIDER, JUDGE_MODEL);
    sampleScores.push(score);
    console.log(`trait=${score.trait_adherence.score.toFixed(2)}`);
  }
  const scoreElapsed = ((Date.now() - scoreStarted) / 1000).toFixed(1);
  console.log(`  scoring: ${scoreElapsed}s total`);
  console.log(`  judge health: ${judgeStats.calls} calls, ${judgeStats.unparseable} unparseable, ${judgeStats.errors} errors (each scored a neutral 0.5)\n`);

  const cells = collapseToMedians(sampleScores);
  const aggregate = aggregateScores(run, cells);
  const verdict = evaluateProtocol(cells);

  console.log("── Verdict (pre-registered protocol) ──");
  for (const m of verdict.models) {
    console.log(`  ${m.provider_id.padEnd(14)} identity ${m.identity.toFixed(3)}  control ${m.control.toFixed(3)}  lift ${m.lift.toFixed(3)}  scenes won ${m.scenes_won}/${m.scene_count}`);
  }
  console.log(`  mean lift ${verdict.mean_lift.toFixed(3)}  mean identity fidelity ${verdict.mean_identity.toFixed(3)}  σ(identity) ${aggregate.cross_provider_stddev.toFixed(3)} (reported, not gated)`);
  console.log(`  → ${verdict.pass ? "PASS" : "FAIL"}${verdict.failures.length ? "\n    " + verdict.failures.join("\n    ") : ""}`);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const docsDir = path.resolve(here, "..", "docs");
  await mkdir(docsDir, { recursive: true });
  const jsonOut = {
    protocol: "docs/BENCHMARK-PROTOCOL.md",
    thresholds: PROTOCOL,
    methodology: {
      character: ADIRA_FIXTURE.character_id,
      participants: PROVIDERS.map((p) => p.id),
      judge: JUDGE_MODEL,
      samples_per_cell: SAMPLES,
      scenes: SCENES.map((s) => ({ id: s.scene_id, label: s.label, tests_limit: !!s.tests_limit })),
      ran_at: run.ran_at,
      generation_seconds: Number(genElapsed),
      scoring_seconds: Number(scoreElapsed),
      judge_health: { ...judgeStats },
      failed_replies: failedReplies,
    },
    verdict,
    aggregate,
    per_sample_scores: sampleScores,
    raw_replies: run.replies,
  };
  await writeFile(path.join(docsDir, `benchmark-run-${date}.json`), JSON.stringify(jsonOut, null, 2) + "\n", "utf8");
  await writeFile(path.join(docsDir, `BENCHMARK-RUN-${date}.md`), renderMarkdown(date, verdict, aggregate, cells, run, failedReplies), "utf8");
  console.log(`\n  wrote docs/benchmark-run-${date}.json and docs/BENCHMARK-RUN-${date}.md`);
  process.exit(verdict.pass ? 0 : 2);
}

function renderMarkdown(
  date: string,
  v: ReturnType<typeof evaluateProtocol>,
  agg: ReturnType<typeof aggregateScores>,
  cells: ReplyScore[],
  run: { scenes: { scene_id: string; label: string }[] },
  failedReplies: number
): string {
  const L: string[] = [];
  L.push(`# Cross-model character benchmark — run of ${date}`);
  L.push("");
  L.push(`Governed by [BENCHMARK-PROTOCOL.md](./BENCHMARK-PROTOCOL.md); criteria were fixed before this run. Judge: \`${JUDGE_MODEL}\`. Samples per cell: ${SAMPLES} (median used). Character: hand-authored fixture (see protocol, "Known limits").`);
  L.push("");
  L.push(`## Verdict: ${v.pass ? "PASS" : "FAIL"}`);
  L.push("");
  if (v.failures.length) {
    L.push("Failed criteria:");
    L.push("");
    for (const f of v.failures) L.push(`- ${f}`);
  } else {
    L.push("All four criteria held.");
  }
  L.push("");
  L.push("## Fidelity and lift (trait adherence, per-cell medians)");
  L.push("");
  L.push("| Model | Identity | Control | Lift | Scenes won |");
  L.push("|---|---|---|---|---|");
  for (const m of v.models) L.push(`| \`${m.provider_id}\` | ${m.identity.toFixed(3)} | ${m.control.toFixed(3)} | **${m.lift.toFixed(3)}** | ${m.scenes_won}/${m.scene_count} |`);
  L.push(`| **mean** | **${v.mean_identity.toFixed(3)}** | | **${v.mean_lift.toFixed(3)}** | |`);
  L.push("");
  L.push(`Thresholds: mean lift ≥ ${PROTOCOL.meanLiftMin}; every model's lift ≥ ${PROTOCOL.perModelLiftMin}; mean identity fidelity ≥ ${PROTOCOL.identityFidelityMin}; identity beats control on ≥ ${PROTOCOL.scenesWonMin} scenes per model.`);
  L.push("");
  L.push(`**Stability (reported, not gated):** cross-provider σ of identity-arm trait adherence = ${agg.cross_provider_stddev.toFixed(3)}. Low σ is not evidence of success.`);
  L.push("");
  L.push("## Per-scene trait adherence (median)");
  L.push("");
  L.push("| Scene | " + v.models.map((m) => `${m.provider_id} id / ctl`).join(" | ") + " |");
  L.push("|---|" + v.models.map(() => "---").join("|") + "|");
  for (const sc of run.scenes) {
    const cellsFor = v.models.map((m) => {
      const g = (arm: "identity" | "control") => cells.find((c) => c.provider_id === m.provider_id && c.scene_id === sc.scene_id && c.arm === arm)?.trait_adherence.score;
      const a = g("identity"), b = g("control");
      return `${a === undefined ? "—" : a.toFixed(2)} / ${b === undefined ? "—" : b.toFixed(2)}`;
    });
    L.push(`| ${sc.label} | ${cellsFor.join(" | ")} |`);
  }
  L.push("");
  L.push("## Judge health and run quality");
  L.push("");
  L.push(`- Judge calls: ${judgeStats.calls}; unparseable: ${judgeStats.unparseable}; errors: ${judgeStats.errors}. Each of those was scored a neutral 0.5.`);
  L.push(`- Failed or empty participant replies: ${failedReplies} (scored 0, counted against the model).`);
  L.push("");
  L.push("## What this does and does not show");
  L.push("");
  L.push("- It measures whether an identity block changes behaviour for one hand-authored character over five scenes and three models, judged by one LLM. It does not show that Chronicler's pipeline forms a good identity block from real play.");
  L.push("- No claim of model-independent character may be made from this document unless the verdict is PASS **and** an explicit go-ahead to announce has been given.");
  L.push("");
  return L.join("\n");
}

main().catch((e) => {
  console.error("benchmark failed:", e);
  process.exit(1);
});
