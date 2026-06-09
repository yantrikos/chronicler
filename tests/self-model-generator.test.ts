// Phase 11 Pillar 2 — self-model generator tests.
//
// Three surfaces covered:
//   1. validateFirstPerson — the gatekeeper that prevents third-person
//      drift from polluting the self-model.
//   2. needsRefresh — staleness detection across the four trigger paths
//      (no existing, inputs changed, weekly expired, manual override).
//   3. generate — end-to-end with a scripted provider. Includes the
//      reject-non-first-person path that keeps the prior model.

import {
  SelfModelGenerator,
  validateFirstPerson,
} from "../src/lib/identity/self-model-generator";
import type { LlmProvider } from "../src/lib/providers";
import type { SelfModel, SelfModelInputs } from "../src/lib/identity/self-model-types";

function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b)
    throw new Error(`assert failed: ${msg} (got ${String(a)}, want ${String(b)})`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}
function ok(msg: string): void {
  console.log("  ok ", msg);
}

const GOOD_OUTPUT = `I am Adira. I'm a wandering musician — words sit right in my mouth, and that's the only language I really trust.

I'm guarded with strangers. When someone gets close, I deflect with humor before they notice I needed to. I know I do this. I haven't decided to stop.`;

const TRAITS_INPUT: SelfModelInputs = {
  character_id: "char-adira",
  character_name: "Adira",
  core_traits: [
    {
      skill_id: "sk1",
      body: "Adira deflects with humor when emotional intimacy spikes",
      rank: 0.9,
    },
    {
      skill_id: "sk2",
      body: "Speaks with the rhythm of music — phrasing has cadence",
      rank: 0.8,
    },
  ],
  canon_excerpts: ["A wandering musician known on the Salt Coast"],
  drift_summary: "Alex: high trust, openness, low guarded",
  active_preferences: ["Long verbal teasing before any touch"],
};

function scriptedProvider(content: string): LlmProvider {
  return {
    name: "scripted",
    async chat() {
      return { content };
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// validateFirstPerson
// ────────────────────────────────────────────────────────────────────

function test_validateFirstPerson_accepts_clean_paragraphs(): void {
  console.log("--- validate: clean first-person passes ---");
  const text = `I am Adira. I'm a wandering musician — words sit right in my mouth and that's what brings me here. I keep my hands moving because still hands invite questions, and I'm not ready for those questions from people who haven't earned them.

I'm guarded with strangers. When someone gets close, I deflect with humor before they notice I needed to. I know I do this. I haven't decided to stop.`;
  assert(validateFirstPerson(text), "well-formed first-person accepted");
}

function test_validateFirstPerson_rejects_third_person(): void {
  console.log("--- validate: third-person narration rejected ---");
  const text =
    "Adira is a wandering musician. She is known on the Salt Coast for her sharp tongue. She has been crossing paths with the user for months. She is guarded with strangers.";
  assert(!validateFirstPerson(text), "third-person rejected");
}

function test_validateFirstPerson_rejects_too_short(): void {
  console.log("--- validate: too-short output rejected ---");
  assert(!validateFirstPerson("I am Adira."), "short output rejected");
}

function test_validateFirstPerson_rejects_non_first_person_opener(): void {
  console.log("--- validate: non-first-person opener rejected ---");
  assert(
    !validateFirstPerson(
      "The character is a wandering musician. They keep moving from port to port."
    ),
    "third-person opener rejected"
  );
}

function test_validateFirstPerson_tolerates_occasional_third_person(): void {
  console.log("--- validate: occasional third-person tolerated when dominant tense is first ---");
  const text = `I am Adira. I'm a wandering musician. There is a part of me that I keep hidden. I trust who I trust, and I'm slow to let others in. I haven't decided why this is. I think I'm working on it.`;
  assert(validateFirstPerson(text), "occasional 'there is' tolerated");
}

// ────────────────────────────────────────────────────────────────────
// needsRefresh
// ────────────────────────────────────────────────────────────────────

async function test_needsRefresh_no_existing(): Promise<void> {
  console.log("--- needsRefresh: no existing model → true ---");
  const gen = new SelfModelGenerator(scriptedProvider(""), "x");
  const needs = await gen.needsRefresh(null, TRAITS_INPUT);
  assert(needs, "no existing → regenerate");
}

async function test_needsRefresh_inputs_unchanged_within_window(): Promise<void> {
  console.log("--- needsRefresh: inputs match + within weekly window → false ---");
  const gen = new SelfModelGenerator(scriptedProvider(GOOD_OUTPUT), "x");
  // Generate fresh to capture the current hash for these inputs.
  const fresh = await gen.generate(TRAITS_INPUT, {
    now: new Date("2026-06-15T00:00:00Z"),
  });
  assert(fresh, "generate succeeded");
  const checkNeeds = await gen.needsRefresh(fresh, TRAITS_INPUT, {
    now: new Date("2026-06-16T00:00:00Z"),
  });
  assert(!checkNeeds, "fresh model within window → skip");
}

async function test_needsRefresh_inputs_changed(): Promise<void> {
  console.log("--- needsRefresh: inputs hash differs → true ---");
  const gen = new SelfModelGenerator(scriptedProvider(GOOD_OUTPUT), "x");
  const baseline = await gen.generate(TRAITS_INPUT, {
    now: new Date("2026-06-15T00:00:00Z"),
  });
  const changed: SelfModelInputs = {
    ...TRAITS_INPUT,
    core_traits: [
      ...TRAITS_INPUT.core_traits,
      { skill_id: "new", body: "New trait crystallized", rank: 0.7 },
    ],
  };
  const needs = await gen.needsRefresh(baseline, changed, {
    now: new Date("2026-06-16T00:00:00Z"),
  });
  assert(needs, "inputs changed → regenerate");
}

async function test_needsRefresh_manual_override(): Promise<void> {
  console.log("--- needsRefresh: manualRefresh forces regeneration ---");
  const gen = new SelfModelGenerator(scriptedProvider(GOOD_OUTPUT), "x");
  const fresh = await gen.generate(TRAITS_INPUT, {
    now: new Date("2026-06-15T00:00:00Z"),
  });
  const needs = await gen.needsRefresh(fresh, TRAITS_INPUT, {
    manualRefresh: true,
  });
  assert(needs, "manual override → regenerate");
}

async function test_needsRefresh_weekly_expired(): Promise<void> {
  console.log("--- needsRefresh: weekly window elapsed → true ---");
  const gen = new SelfModelGenerator(scriptedProvider(GOOD_OUTPUT), "x");
  const fresh = await gen.generate(TRAITS_INPUT, {
    now: new Date("2026-06-15T00:00:00Z"),
  });
  // 8 days later → past the next_refresh_after.
  const needs = await gen.needsRefresh(fresh, TRAITS_INPUT, {
    now: new Date("2026-06-23T00:00:00Z"),
  });
  assert(needs, "weekly window elapsed → regenerate");
}

// ────────────────────────────────────────────────────────────────────
// generate
// ────────────────────────────────────────────────────────────────────

async function test_generate_happy_path(): Promise<void> {
  console.log("--- generate: scripted first-person reply → SelfModel returned ---");
  const goodOutput = `I am Adira. I'm a wandering musician — words sit right in my mouth, and that's the only language I really trust.

I'm guarded with strangers. When someone gets close, I deflect with humor before they notice I needed to. I know I do this. I haven't decided to stop.`;
  const gen = new SelfModelGenerator(scriptedProvider(goodOutput), "test-model");
  const result = await gen.generate(TRAITS_INPUT, {
    now: new Date("2026-06-15T00:00:00Z"),
  });
  assert(result, "result returned");
  eq(result?.header.character_id, "char-adira", "character id");
  eq(result?.header.paragraph_count, 2, "two paragraphs detected");
  eq(result?.header.model_used, "test-model", "model recorded");
  assert(
    result?.body.startsWith("I am Adira"),
    "body starts with first-person opener"
  );
}

async function test_generate_rejects_third_person_output(): Promise<void> {
  console.log("--- generate: third-person output returns null ---");
  const thirdPerson =
    "Adira is a wandering musician. She is known on the Salt Coast for her sharp tongue. She is guarded with strangers.";
  const gen = new SelfModelGenerator(scriptedProvider(thirdPerson), "test-model");
  const result = await gen.generate(TRAITS_INPUT);
  eq(result, null, "third-person output rejected by validator");
}

async function test_generate_no_inputs(): Promise<void> {
  console.log("--- generate: no core traits + no canon → null (insufficient input) ---");
  const gen = new SelfModelGenerator(scriptedProvider("I am Test."), "x");
  const result = await gen.generate({
    character_id: "c1",
    character_name: "Test",
    core_traits: [],
    canon_excerpts: [],
    drift_summary: "",
    active_preferences: [],
  });
  eq(result, null, "no anchor → null returned");
}

async function test_generate_llm_error_returns_null(): Promise<void> {
  console.log("--- generate: provider throwing → null returned ---");
  const failing: LlmProvider = {
    name: "failing",
    async chat() {
      throw new Error("simulated LLM error");
    },
  };
  const gen = new SelfModelGenerator(failing, "x");
  const result = await gen.generate(TRAITS_INPUT);
  eq(result, null, "LLM error → null");
}

(async () => {
  try {
    test_validateFirstPerson_accepts_clean_paragraphs();
    test_validateFirstPerson_rejects_third_person();
    test_validateFirstPerson_rejects_too_short();
    test_validateFirstPerson_rejects_non_first_person_opener();
    test_validateFirstPerson_tolerates_occasional_third_person();
    await test_needsRefresh_no_existing();
    await test_needsRefresh_inputs_unchanged_within_window();
    await test_needsRefresh_inputs_changed();
    await test_needsRefresh_manual_override();
    await test_needsRefresh_weekly_expired();
    await test_generate_happy_path();
    await test_generate_rejects_third_person_output();
    await test_generate_no_inputs();
    await test_generate_llm_error_returns_null();
    ok("all self-model generator tests passed");
    console.log("\n--- PASS: self-model-generator ---");
  } catch (e) {
    console.error("--- FAIL: self-model-generator ---", e);
    process.exit(1);
  }
})();
