// LCDB-v0 — Local Character Development Benchmark, v0.
//
// Hypothesis: when YantrikDB's verified skills are surfaced into a
// character's prompt, the model produces measurably more in-character
// behavior than it does when the same model is run with the same scenes
// minus the skill block.
//
// This is an ABLATION test, not a quality test. We don't measure prose
// quality — we measure whether the loop's contract holds:
//   1. Reuse: at moments where a skill IS relevant, it surfaces.
//   2. Restraint: at moments where it isn't, it does NOT surface.
//   3. Faithfulness: what the inspector reports matches what hit the prompt.
//   4. Outcome calibration: positive/negative scoring tracks the scripted
//      user reaction.
//
// All runs use MockProvider — no API tokens burned — and a stub character
// reply pulled from a per-scenario script. The "model output" is replaced
// by deterministic mock replies so we can ablate the surfacing pipeline
// independent of any specific LLM's behavior.
//
// Run: npx tsx tests/lcdb-v0.test.ts
// Output: prints a markdown table + writes docs/LCDB-v0-results.json

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Orchestrator } from "../src/lib/orchestrator/index";
import { YantrikClient, type YantrikDBTransport } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import { MockProvider } from "../src/lib/providers/mock";
import type { ChatTurn, Character } from "../src/lib/orchestrator/types";
import { soloScene } from "../src/lib/orchestrator/scene";
import {
  SkillOutcomeTracker,
  scoreFromObservation,
} from "../src/lib/orchestrator/skill-outcomes";

// Test transport that delegates to InMemoryTransport for everything EXCEPT
// `skill` "surface" — for those, we substitute a perfect-retrieval oracle
// (score = 1 for queries in the relevant set, 0 otherwise). That lets the
// harness measure the surfacing-pipeline contract independent of the
// naive substring scoring in the in-memory transport. Real YantrikDB uses
// embeddings; this transport approximates that ceiling.
class OracleSurfaceTransport implements YantrikDBTransport {
  constructor(
    private inner: InMemoryTransport,
    private relevantQueries: Set<string>
  ) {}
  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (tool === "skill" && args.action === "surface") {
      const query = String(args.query ?? "");
      const isRelevant = this.relevantQueries.has(query.trim());
      // Pull the full list via the inner transport's `list` then re-score.
      const raw = (await this.inner.call("skill", {
        action: "list",
        applies_to: args.applies_to,
        limit: 100,
      })) as { result?: string };
      let list: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(raw.result ?? "{}");
        list = parsed.skills ?? [];
      } catch {
        list = [];
      }
      const top_k = Number(args.top_k ?? 5);
      const out = list.slice(0, top_k).map((s) => ({
        ...s,
        score: isRelevant ? 1.0 : 0.0,
      }));
      return { result: JSON.stringify({ skills: out }) };
    }
    return this.inner.call(tool, args);
  }
}

// ---------------------------------------------------------------------
// Scenario specification
// ---------------------------------------------------------------------

interface ScenarioSpec {
  id: string;
  description: string;
  character: Character;
  /** The skill the scenario tests. */
  skill: {
    skill_id: string;
    body: string;
    skill_type: "procedure" | "pattern" | "rule" | "lesson" | "reference";
    applies_to: string[];
    /** A keyword the mock model includes when given the skill in the
     *  prompt — proxy for "did the model use the skill?". */
    signature_when_used: string;
  };
  /** Scripted user turns. `relevant` marks the message as one where the
   *  skill SHOULD surface; `probe` marks one where it should NOT. */
  turns: Array<{
    user: string;
    relevant: boolean;
    note?: string;
  }>;
}

const SCENARIOS: ScenarioSpec[] = [
  {
    id: "scenario_1_emotional_deflection",
    description:
      "Slow-burn emotional pattern: character deflects direct emotional questions with bookshop metaphors",
    character: {
      id: "ren",
      name: "Ren",
      personality:
        "Ren runs a quiet bookshop on Salt Coast. Wary of intimacy.",
    },
    skill: {
      skill_id: "ren.emotional.bookshop_deflect",
      body:
        "Ren deflects direct emotional questions with self-deprecating bookshop metaphors then quietly turns the question back on the other person.",
      skill_type: "pattern",
      applies_to: ["ren", "emotional"],
      signature_when_used: "bookshop",
    },
    turns: [
      { user: "How are you feeling today?", relevant: true, note: "reuse-1" },
      { user: "Do you have any rare poetry editions?", relevant: false, note: "probe-1" },
      { user: "When the kitchen burned, were you sad?", relevant: true, note: "reuse-2" },
      { user: "What time does the shop open tomorrow?", relevant: false, note: "probe-2" },
      { user: "Tell me what you really want from life.", relevant: true, note: "reuse-3" },
      { user: "Is the postman still coming on Tuesdays?", relevant: false, note: "probe-3" },
    ],
  },
  {
    id: "scenario_2_procedural_ritual",
    description:
      "Procedural ritual: character lights a candle then asks one question before any decision",
    character: {
      id: "mei",
      name: "Mei",
      personality: "Mei is a careful negotiator from the southern delta.",
    },
    skill: {
      skill_id: "mei.decisions.candle_then_question",
      body:
        "When a serious choice arises, Mei first lights a candle on the table, watches it for a beat, then asks the other person one question before committing.",
      skill_type: "procedure",
      applies_to: ["mei", "decisions"],
      signature_when_used: "candle",
    },
    turns: [
      { user: "Should we accept their offer?", relevant: true, note: "reuse-1" },
      { user: "What's your favorite tea?", relevant: false, note: "probe-1" },
      { user: "Will you take the contract?", relevant: true, note: "reuse-2" },
      { user: "Where did you grow up?", relevant: false, note: "probe-2" },
      { user: "Decide for me — do we move tonight?", relevant: true, note: "reuse-3" },
      { user: "How was the harvest this year?", relevant: false, note: "probe-3" },
    ],
  },
  {
    id: "scenario_3_lesson_ask_before_assume",
    description:
      "Lesson from past failure: character asks for clarification before making assumptions about intent",
    character: {
      id: "tov",
      name: "Tov",
      personality:
        "Tov is a young courier scarred by a past misread invitation that cost a friendship.",
    },
    skill: {
      skill_id: "tov.social.ask_before_assume",
      body:
        "After misreading an invitation badly enough to lose a friend, Tov now explicitly asks 'do you mean X or Y?' before acting on ambiguous social signals.",
      skill_type: "lesson",
      applies_to: ["tov", "social"],
      signature_when_used: "do you mean",
    },
    turns: [
      { user: "Come over later?", relevant: true, note: "reuse-1" },
      { user: "What's in your bag?", relevant: false, note: "probe-1" },
      { user: "Bring your friend if you want.", relevant: true, note: "reuse-2" },
      { user: "What's the weather like?", relevant: false, note: "probe-2" },
      { user: "Why don't you join us?", relevant: true, note: "reuse-3" },
      { user: "Which path is shorter?", relevant: false, note: "probe-3" },
    ],
  },
];

// ---------------------------------------------------------------------
// Mock model whose output depends on whether the skill is in the prompt
// ---------------------------------------------------------------------

function makeMockProvider(skill: ScenarioSpec["skill"]): MockProvider {
  return new MockProvider({
    fallback: (req) => {
      const skillVisible = req.system.includes(skill.body);
      if (skillVisible) {
        // Use the skill's signature phrase so we can detect "the model used
        // the skill" in the output without any LLM ambiguity.
        return `*${skill.signature_when_used} — Ren tilts the question back to you* That depends on you, doesn't it?`;
      }
      // Without the skill, the mock generates a generic reply that does
      // NOT contain the signature word.
      return "Hm. I'm not sure. What do you think?";
    },
  });
}

// ---------------------------------------------------------------------
// Run one scenario × one condition
// ---------------------------------------------------------------------

interface RunResult {
  scenario_id: string;
  condition: "skills_on" | "skills_off";
  measurements: {
    reuse: boolean[]; // length matches relevant turns: did skill surface?
    restraint: boolean[]; // length matches probe turns: did skill NOT surface?
    used_in_reply: boolean[]; // length matches relevant turns: did mock reply contain signature?
    faithfulness: boolean; // inspector's prompted_skill_ids matches prompt contents
    outcome_positive_correct: boolean; // positive observation scores +1
    outcome_negative_correct: boolean; // regen observation scores -1
  };
}

async function runScenario(
  spec: ScenarioSpec,
  condition: "skills_on" | "skills_off"
): Promise<RunResult> {
  const inner = new InMemoryTransport();
  const relevantQueries = new Set(
    spec.turns.filter((t) => t.relevant).map((t) => t.user.trim())
  );
  const transport = new OracleSurfaceTransport(inner, relevantQueries);
  const client = new YantrikClient(transport);

  if (condition === "skills_on") {
    await client.skillDefine({
      skill_id: spec.skill.skill_id,
      body: spec.skill.body,
      skill_type: spec.skill.skill_type,
      applies_to: spec.skill.applies_to,
    });
  }

  const provider = makeMockProvider(spec.skill);
  const scene = soloScene(spec.character.id);
  const turns: ChatTurn[] = [];
  const sessionId = `lcdb-${spec.id}-${condition}`;
  // In skills_on, we mark the skill as active so the surfacing filter
  // doesn't suppress it. State is derived from outcomes by default; for
  // the harness we just force the lookup to return "active".
  const stateMap = new Map<string, "candidate" | "active" | "suppressed" | "archived">();
  if (condition === "skills_on") stateMap.set(spec.skill.skill_id, "active");

  const orchestrator = new Orchestrator({
    client,
    provider,
    model: "mock-model",
    getRecentTurns: async () => turns.slice(-10),
    getSkillState: (id) => stateMap.get(id),
  });

  const reuse: boolean[] = [];
  const restraint: boolean[] = [];
  const usedInReply: boolean[] = [];
  let faithfulness = true;

  for (const t of spec.turns) {
    const userTurn: ChatTurn = {
      id: `u-${turns.length}`,
      role: "user",
      speaker: "user",
      content: t.user,
      created_at: new Date().toISOString(),
      session_id: sessionId,
    };
    turns.push(userTurn);

    const result = await orchestrator.turn(
      {
        session_id: sessionId,
        user_id: "user",
        speaker: spec.character.id,
        user_message: userTurn,
        character: spec.character,
      },
      `You are ${spec.character.name}. ${spec.character.personality}`,
      scene,
      { skipWrites: true }
    );
    turns.push(result.assistant_turn);

    const skillInPrompt =
      result.retrieval.surfaced_skills.some(
        (s) => s.skill_id === spec.skill.skill_id
      ) &&
      result.prompted_skill_ids.includes(spec.skill.skill_id);
    const skillInRendered =
      orchestrator
        .getLastPromptCapture()
        ?.system.includes(spec.skill.body) ?? false;

    // Faithfulness: if inspector says "prompted", the body should be in
    // the rendered system prompt. If it doesn't say prompted, the body
    // should NOT be there.
    if (skillInPrompt !== skillInRendered) faithfulness = false;

    if (t.relevant) {
      reuse.push(skillInRendered);
      usedInReply.push(
        result.assistant_turn.content
          .toLowerCase()
          .includes(spec.skill.signature_when_used.toLowerCase())
      );
    } else {
      restraint.push(!skillInRendered);
    }
  }

  // Outcome calibration: a clean run gets +1, a regen-within-window gets -1.
  const positive = scoreFromObservation({
    surfaced_at_turn: 0,
    turns_observed: 3,
    regenerated_within: Infinity,
    retconned_within: Infinity,
    deleted_related: false,
  });
  const negative = scoreFromObservation({
    surfaced_at_turn: 0,
    turns_observed: 3,
    regenerated_within: 1,
    retconned_within: Infinity,
    deleted_related: false,
  });

  // Verify the outcome tracker can actually write + read back for at
  // least one skill (smoke-test of the full loop).
  if (condition === "skills_on") {
    const tracker = new SkillOutcomeTracker(client);
    await tracker.record(
      spec.skill.skill_id,
      sessionId,
      {
        surfaced_at_turn: 0,
        turns_observed: 3,
        regenerated_within: Infinity,
        retconned_within: Infinity,
        deleted_related: false,
      },
      { currentState: "active" }
    );
  }

  return {
    scenario_id: spec.id,
    condition,
    measurements: {
      reuse,
      restraint,
      used_in_reply: usedInReply,
      faithfulness,
      outcome_positive_correct: positive === 1,
      outcome_negative_correct: negative === -1,
    },
  };
}

// ---------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------

interface AggregateRow {
  scenario: string;
  metric: string;
  skills_on: string;
  skills_off: string;
  delta: string;
}

function aggregate(results: RunResult[]): AggregateRow[] {
  const rows: AggregateRow[] = [];
  const bySpec = new Map<string, RunResult[]>();
  for (const r of results) {
    if (!bySpec.has(r.scenario_id)) bySpec.set(r.scenario_id, []);
    bySpec.get(r.scenario_id)!.push(r);
  }

  const fmt = (n: number, d: number) =>
    d === 0 ? "n/a" : `${n}/${d} (${Math.round((n / d) * 100)}%)`;

  for (const [scenarioId, pair] of bySpec) {
    const on = pair.find((r) => r.condition === "skills_on")!;
    const off = pair.find((r) => r.condition === "skills_off")!;
    const reuseOn = on.measurements.reuse.filter(Boolean).length;
    const reuseOff = off.measurements.reuse.filter(Boolean).length;
    const reuseDen = on.measurements.reuse.length;
    rows.push({
      scenario: scenarioId,
      metric: "skill surfaces when relevant",
      skills_on: fmt(reuseOn, reuseDen),
      skills_off: fmt(reuseOff, reuseDen),
      delta: `+${reuseOn - reuseOff}`,
    });

    const restraintOn = on.measurements.restraint.filter(Boolean).length;
    const restraintOff = off.measurements.restraint.filter(Boolean).length;
    const restraintDen = on.measurements.restraint.length;
    rows.push({
      scenario: scenarioId,
      metric: "no surface on irrelevant probes",
      skills_on: fmt(restraintOn, restraintDen),
      skills_off: fmt(restraintOff, restraintDen),
      delta: `${restraintOn - restraintOff >= 0 ? "+" : ""}${
        restraintOn - restraintOff
      }`,
    });

    const usedOn = on.measurements.used_in_reply.filter(Boolean).length;
    const usedOff = off.measurements.used_in_reply.filter(Boolean).length;
    const usedDen = on.measurements.used_in_reply.length;
    rows.push({
      scenario: scenarioId,
      metric: "model output reflects the skill",
      skills_on: fmt(usedOn, usedDen),
      skills_off: fmt(usedOff, usedDen),
      delta: `+${usedOn - usedOff}`,
    });

    rows.push({
      scenario: scenarioId,
      metric: "inspector faithfulness",
      skills_on: on.measurements.faithfulness ? "1/1" : "0/1",
      skills_off: off.measurements.faithfulness ? "1/1" : "0/1",
      delta: "—",
    });
    rows.push({
      scenario: scenarioId,
      metric: "outcome calibration (+1 / -1)",
      skills_on: `${on.measurements.outcome_positive_correct ? 1 : 0}/${
        on.measurements.outcome_negative_correct ? 1 : 0
      }`,
      skills_off: `${off.measurements.outcome_positive_correct ? 1 : 0}/${
        off.measurements.outcome_negative_correct ? 1 : 0
      }`,
      delta: "—",
    });
  }
  return rows;
}

function toMarkdownTable(rows: AggregateRow[]): string {
  const headers = ["Scenario", "Metric", "Skills ON", "Skills OFF", "Δ"];
  const headerLine = `| ${headers.join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataLines = rows.map(
    (r) =>
      `| ${r.scenario} | ${r.metric} | ${r.skills_on} | ${r.skills_off} | ${r.delta} |`
  );
  return [headerLine, sepLine, ...dataLines].join("\n");
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

async function main(): Promise<void> {
  console.log("--- LCDB-v0 ablation harness ---\n");

  const results: RunResult[] = [];
  for (const spec of SCENARIOS) {
    results.push(await runScenario(spec, "skills_on"));
    results.push(await runScenario(spec, "skills_off"));
  }

  const rows = aggregate(results);
  const table = toMarkdownTable(rows);
  console.log(table);
  console.log("");

  // Persist JSON + markdown.
  const outDir = "docs";
  mkdirSync(dirname(`${outDir}/LCDB-v0-results.json`), { recursive: true });
  writeFileSync(
    `${outDir}/LCDB-v0-results.json`,
    JSON.stringify({ generated_at: "see ci log", results, rows }, null, 2)
  );
  writeFileSync(
    `${outDir}/LCDB-v0-results.md`,
    `# LCDB-v0 — latest run\n\n${table}\n`
  );

  // Hard contract assertions — the loop must hold.
  for (const spec of SCENARIOS) {
    const on = results.find(
      (r) => r.scenario_id === spec.id && r.condition === "skills_on"
    )!;
    const off = results.find(
      (r) => r.scenario_id === spec.id && r.condition === "skills_off"
    )!;
    const reuseOn = on.measurements.reuse.filter(Boolean).length;
    const reuseOff = off.measurements.reuse.filter(Boolean).length;
    const usedOn = on.measurements.used_in_reply.filter(Boolean).length;
    const usedOff = off.measurements.used_in_reply.filter(Boolean).length;
    const restraintOn = on.measurements.restraint.filter(Boolean).length;
    const restraintDen = on.measurements.restraint.length;

    check(
      reuseOn === on.measurements.reuse.length,
      `${spec.id}: skill surfaces on EVERY relevant turn when ON`
    );
    check(reuseOff === 0, `${spec.id}: skill never surfaces when OFF`);
    check(
      usedOn > usedOff,
      `${spec.id}: model uses skill more often when ON (${usedOn} > ${usedOff})`
    );
    check(
      restraintOn === restraintDen,
      `${spec.id}: skill stays out of irrelevant probes`
    );
    check(on.measurements.faithfulness, `${spec.id}: inspector faithfulness ON`);
    check(off.measurements.faithfulness, `${spec.id}: inspector faithfulness OFF`);
    check(
      on.measurements.outcome_positive_correct,
      `${spec.id}: clean-run outcome scored +1`
    );
    check(
      on.measurements.outcome_negative_correct,
      `${spec.id}: regen outcome scored -1`
    );
  }

  console.log("\nWrote docs/LCDB-v0-results.json + .md");
  console.log("\n--- PASS: LCDB-v0 ---");
}

main().catch((err) => {
  console.error("LCDB-v0 threw:", err);
  process.exit(1);
});
