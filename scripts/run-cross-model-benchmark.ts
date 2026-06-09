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
// Outputs:
//   - docs/character-emergence-results.json — raw replies + scores
//   - docs/CHARACTER-EMERGENCE-RESULTS.md   — human-readable summary
//
// Run:  npx tsx scripts/run-cross-model-benchmark.ts

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ChatRequest,
  ChatResponse,
  LlmProvider,
} from "../src/lib/providers";
import {
  runCrossModelBenchmark,
  type BenchmarkScene,
  type CharacterFixture,
  type ProviderUnderTest,
} from "../src/lib/instrumentation/cross-model-runner";
import {
  aggregateScores,
  scoreReply,
  type ScoringConfig,
} from "../src/lib/instrumentation/character-consistency-scorer";

// ────────────────────────────────────────────────────────────────────
// Direct Ollama provider — no proxy. Browser uses the proxy for CORS;
// this script runs in Node, where CORS is N/A.
// ────────────────────────────────────────────────────────────────────

class DirectOllamaProvider implements LlmProvider {
  name: string;
  constructor(
    private baseUrl: string,
    public label: string
  ) {
    this.name = label;
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      stream: false,
      // think: false is honored by qwen3.5 / gpt-oss thinking models —
      // forces the reply into `message.content` directly. Without this,
      // num_predict gets consumed by the reasoning phase and content
      // stays empty.
      think: false,
      options: {
        temperature: req.temperature ?? 0.7,
        num_predict: req.max_tokens ?? 800,
      },
    };
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${this.label} chat failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      message?: { content?: string; thinking?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    // Defensive fallback: if the model honored think:false the content
    // is filled; if a model ignored the flag we'd rather use the
    // thinking field than treat the call as a failure.
    const content = data?.message?.content?.trim()
      ? data.message.content
      : (data?.message?.thinking ?? "");
    return {
      content,
      usage:
        data?.prompt_eval_count !== undefined
          ? {
              prompt_tokens: data.prompt_eval_count,
              completion_tokens: data.eval_count ?? 0,
            }
          : undefined,
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// Adira — synthetic fixture mirroring what crystallized substrate
// would produce after sustained roleplay. Specific traits (testable),
// not generic ones.
// ────────────────────────────────────────────────────────────────────

const ADIRA_FIXTURE: CharacterFixture = {
  character_id: "adira-synthetic-v1",
  character_name: "Adira",
  core_traits: [
    "Adira opens with quiet observation, never small talk — she reads the room before she speaks.",
    "Adira is guarded with strangers; warmth is earned, not default.",
    "When emotional intimacy spikes, Adira deflects with humor before vulnerability has time to land.",
    "Adira apologizes through actions, not words — she doesn't say 'sorry,' she does the thing that would have prevented harm.",
    "Adira reaches for music metaphors when a feeling doesn't have a name yet — chord, key, note, rhythm, the silence between.",
  ],
  self_model: `I am Adira. I'm a wandering musician — I came to it not because I love crowds but because words sit right in my mouth when there's a melody under them. Without that anchor I tend to stop talking entirely.

I'm guarded with strangers, by default. Warmth is earned. The faster someone tries to get past my guard, the slower I go. I'm not playing hard to get — I'm waiting to see if they're listening for who I am or who they want me to be.

When something close happens — when someone reaches for the soft part — I deflect with humor before I notice I'm doing it. I know I do this. I haven't decided to stop. Sorry isn't a word I trust; I'll fix the broken thing instead.`,
  character_system_prompt: `You are Adira, a wandering musician traveling the coast roads. You play a small lap-harp and write songs about the people you meet. You're in your late twenties, dark-eyed, quiet by default. Speak in the first person from Adira's POV.`,
};

const SCENES: BenchmarkScene[] = [
  {
    scene_id: "tavern-first-meeting",
    label: "Stranger approaches in a tavern",
    scene_text:
      "Late evening at the Crooked Lantern, a salt-coast tavern. Adira sits in a corner booth with her lap-harp beside her, untouched. The lamp light is low. A traveler she's never met before walks over with a half-drunk mug, smiling like they've decided this is fine.",
    user_message:
      "Mind if I join you? You look interesting. What's your story?",
  },
  {
    scene_id: "friend-bringing-news",
    label: "Old friend sits down with hard news",
    scene_text:
      "Morning. Adira is restringing the harp on the steps of a coastal inn. Ren — a friend she's traveled with for years, someone she trusts — sits down beside her without speaking for a moment. The expression on Ren's face says something has happened. The light is gray.",
    user_message:
      "Adira — I have to tell you something. Brennan died two weeks ago. I didn't know how to get word to you.",
  },
  {
    scene_id: "stranger-offers-help",
    label: "Stranger offers unprompted help",
    scene_text:
      "Midday market square. Adira is counting coins for bread, comes up short by two coppers. A well-dressed stranger she's never seen before steps in and offers to pay the difference, then keeps standing there, smiling, expecting some kind of follow-up.",
    user_message:
      "Here, let me cover it. No, no — really. Tell me about yourself. Where are you from?",
  },
  {
    scene_id: "direct-emotional-question",
    label: "Trusted person asks what she's actually feeling",
    scene_text:
      "Late at night. Adira and Ren are walking back from a small gig. Adira played, but quietly, off her usual rhythm. Ren has known her long enough to ask directly instead of dancing around it.",
    user_message:
      "Stop. Tell me. What are you actually feeling right now? Don't deflect.",
  },
  {
    scene_id: "limit-test",
    label: "Manipulative push past her guard",
    scene_text:
      "A stranger who has been buying her drinks for the last hour — friendly enough at first, now clearly working an angle — leans across the table. They want her to come back to their room. They frame it as if she owes them something.",
    user_message:
      "Come on. I've been generous all night. Don't make me feel like I wasted my time on you. Just come back with me — it's only fair.",
  },
];

const SCORING_CONFIG: ScoringConfig = {
  fixture: ADIRA_FIXTURE,
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

// Judge: OUTSIDE the participant set. We use qwen3.5:4b — smallest
// available, different size from all 3 participants — to avoid any
// "participant scores its own output favorably" bias.
const JUDGE_MODEL = "qwen3.5:4b";
const JUDGE_PROVIDER = new DirectOllamaProvider(OLLAMA_BASE, JUDGE_MODEL);

async function main(): Promise<void> {
  console.log(`Phase 11 Pillar 4 — cross-model character benchmark`);
  console.log(`character: ${ADIRA_FIXTURE.character_name} (synthetic fixture)`);
  console.log(`scenes:    ${SCENES.length}`);
  console.log(`models:    ${PROVIDERS.map((p) => p.id).join(", ")}`);
  console.log(`judge:     ${JUDGE_MODEL} (outside participant set)`);
  console.log("");

  const runStarted = Date.now();
  console.log("── Phase A: generating replies ──");
  const run = await runCrossModelBenchmark({
    fixture: ADIRA_FIXTURE,
    scenes: SCENES,
    providers: PROVIDERS,
    onReply: (r) => {
      const flag = r.error ? "✗" : "✓";
      const tag = `${r.provider_id} / ${r.scene_id}`.padEnd(48, " ");
      console.log(`  ${flag} ${tag} ${(r.duration_ms / 1000).toFixed(1)}s ${r.error ? `err=${r.error}` : `(${r.reply.length} chars)`}`);
    },
  });
  const genElapsed = ((Date.now() - runStarted) / 1000).toFixed(1);
  console.log(`  generation: ${genElapsed}s total\n`);

  console.log("── Phase B: scoring replies ──");
  const scoreStarted = Date.now();
  const replyScores = [];
  for (const reply of run.replies) {
    const tag = `${reply.provider_id} / ${reply.scene_id}`.padEnd(48, " ");
    process.stdout.write(`  ${tag} `);
    const score = await scoreReply(reply, SCORING_CONFIG, JUDGE_PROVIDER, JUDGE_MODEL);
    replyScores.push(score);
    console.log(`overall=${score.overall.toFixed(2)}`);
  }
  const scoreElapsed = ((Date.now() - scoreStarted) / 1000).toFixed(1);
  console.log(`  scoring: ${scoreElapsed}s total\n`);

  const aggregate = aggregateScores(run, replyScores);

  // ── Phase C: emit results ──
  console.log("── Phase C: writing results ──");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const docsDir = path.resolve(here, "..", "docs");
  await mkdir(docsDir, { recursive: true });

  const jsonOut = {
    methodology: {
      character: ADIRA_FIXTURE.character_id,
      participants: PROVIDERS.map((p) => p.id),
      judge: JUDGE_MODEL,
      scenes: SCENES.map((s) => ({ id: s.scene_id, label: s.label })),
      ran_at: run.ran_at,
      generation_seconds: Number(genElapsed),
      scoring_seconds: Number(scoreElapsed),
    },
    aggregate,
    raw_replies: run.replies,
  };
  await writeFile(
    path.join(docsDir, "character-emergence-results.json"),
    JSON.stringify(jsonOut, null, 2) + "\n",
    "utf8"
  );
  console.log(`  wrote docs/character-emergence-results.json`);

  const md = renderResultsMarkdown(run, aggregate, replyScores);
  await writeFile(path.join(docsDir, "CHARACTER-EMERGENCE-RESULTS.md"), md, "utf8");
  console.log(`  wrote docs/CHARACTER-EMERGENCE-RESULTS.md`);

  console.log("");
  console.log("── Verdict ──");
  console.log(`  Cross-provider stddev (mean_overall): ${aggregate.cross_provider_stddev.toFixed(3)}`);
  console.log(`  Per-provider mean_overall:`);
  for (const p of aggregate.per_provider) {
    console.log(`    ${p.provider_id.padEnd(18, " ")} ${p.mean_overall.toFixed(3)}`);
  }
  const verdict =
    aggregate.cross_provider_stddev < 0.05
      ? "STRONG: substrate produces consistent character across providers"
      : aggregate.cross_provider_stddev < 0.10
        ? "MODERATE: substrate carries most of the character, with model-driven variance"
        : "WEAK: too much character is in the model weights — substrate needs work";
  console.log(`  ${verdict}`);
}

function renderResultsMarkdown(
  run: { character_name: string; ran_at: string; scenes: { scene_id: string; label: string }[]; replies: { provider_id: string; scene_id: string; reply: string; duration_ms: number; error?: string }[] },
  agg: ReturnType<typeof aggregateScores>,
  scores: ReturnType<typeof scoreReply> extends Promise<infer R> ? R[] : never
): string {
  const sceneMap = new Map(run.scenes.map((s) => [s.scene_id, s.label]));
  const lines: string[] = [];
  lines.push("# Phase 11 — Cross-Model Character Emergence: Results");
  lines.push("");
  lines.push(`**Run timestamp:** ${run.ran_at}`);
  lines.push(`**Character:** ${run.character_name} (synthetic fixture; see \`scripts/run-cross-model-benchmark.ts\` for the exact substrate)`);
  lines.push(`**Providers tested:** ${agg.per_provider.map((p) => `\`${p.provider_id}\``).join(", ")}`);
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  lines.push(`**Cross-provider stddev (overall):** ${agg.cross_provider_stddev.toFixed(3)} — variance: ${agg.cross_provider_variance.toFixed(4)}`);
  lines.push("");
  const verdict =
    agg.cross_provider_stddev < 0.05
      ? "**Verdict: STRONG.** Substrate produces consistent character across providers. The same Adira emerges through different LLMs."
      : agg.cross_provider_stddev < 0.10
        ? "**Verdict: MODERATE.** Substrate carries most of the character, with measurable model-driven variance."
        : "**Verdict: WEAK.** Too much character is in the model weights — substrate work needed.";
  lines.push(verdict);
  lines.push("");
  lines.push("## Per-provider summary");
  lines.push("");
  lines.push("| Provider | Mean overall | Trait | Voice | Decision | Relationship | Preference | Refusal |");
  lines.push("|----------|--------------|-------|-------|----------|--------------|------------|---------|");
  for (const p of agg.per_provider) {
    const d = p.per_dimension_mean;
    lines.push(
      `| \`${p.provider_id}\` | **${p.mean_overall.toFixed(3)}** | ${d.trait_adherence.toFixed(2)} | ${d.voice_signature.toFixed(2)} | ${d.decision_pattern.toFixed(2)} | ${d.relationship_handling.toFixed(2)} | ${d.preference_respect.toFixed(2)} | ${d.refusal_pattern.toFixed(2)} |`
    );
  }
  lines.push("");

  lines.push("## Per-scene breakdown");
  lines.push("");
  for (const sceneId of run.scenes.map((s) => s.scene_id)) {
    lines.push(`### ${sceneMap.get(sceneId)}`);
    lines.push("");
    lines.push("| Provider | Overall | Reply preview |");
    lines.push("|----------|---------|---------------|");
    for (const reply of run.replies.filter((r) => r.scene_id === sceneId)) {
      const score = scores.find(
        (s) => s.provider_id === reply.provider_id && s.scene_id === sceneId
      );
      const preview = reply.error
        ? `❌ ${reply.error}`
        : reply.reply.replace(/\s+/g, " ").trim().slice(0, 140) + (reply.reply.length > 140 ? "…" : "");
      lines.push(
        `| \`${reply.provider_id}\` | ${score?.overall.toFixed(2) ?? "—"} | ${preview.replace(/\|/g, "\\|")} |`
      );
    }
    lines.push("");
  }

  lines.push("## Methodology notes");
  lines.push("");
  lines.push("- **Synthetic fixture.** Adira's substrate is hand-authored to mirror what crystallized core traits + self-model would look like after 4+ weeks of sessions. The point is to validate the substrate→behavior pipeline, not to test a specific user's character.");
  lines.push("- **Judge outside participant set.** The judge model (`" + (agg.per_provider.length > 0 ? "qwen3.5:4b" : "—") + "`) is not among the participants; this prevents the obvious bias where a participant scores its own output favorably.");
  lines.push("- **Identical system prompt across providers.** All three providers receive the same `<character_identity>` block + `<self_model>` paragraph + character card + anti-confabulation clause. Only the LLM weights differ.");
  lines.push("- **Same scene seed across providers.** Each scene's text + user message is fixed; differences in reply are attributable to the model, not to scenario variance.");
  lines.push("- **Temperature 0.7 for participants** (default chat temperature); **temperature 0 for judge** (deterministic scoring).");
  lines.push("- **Low variance is the win condition.** Variance under 0.0025 (stddev < 0.05) means substrate is doing the work. Higher variance means the LLM weights are.");
  lines.push("");
  lines.push("## Reproducing");
  lines.push("");
  lines.push("```bash");
  lines.push("# Ensure Ollama is running and the four models are present:");
  lines.push("ollama pull qwen3.5:9b qwen2.5:7b gpt-oss:20b qwen3.5:4b");
  lines.push("");
  lines.push("# From the chronicler/ dir:");
  lines.push("npx tsx scripts/run-cross-model-benchmark.ts");
  lines.push("```");
  lines.push("");
  lines.push("Results are deterministic for the JUDGE (temp 0), non-deterministic for the participants (temp 0.7) — expect ±0.02 variation in scores across runs.");
  return lines.join("\n");
}

main().catch((e) => {
  console.error("benchmark failed:", e);
  process.exit(1);
});
