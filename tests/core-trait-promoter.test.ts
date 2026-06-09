// Phase 11 Pillar 1 — Core trait promoter tests.
//
// Two surfaces covered:
//   1. Pure helpers: computeEvidence, meetsPromotionCriteria, shouldDemote
//      — deterministic given a fixture; verify the threshold math is
//      correct and edge cases handled.
//   2. CoreTraitPromoter.run with a mocked YantrikClient + scripted
//      verifier — verifies the full promote/demote/reject orchestration
//      including localStorage persistence and skill-transition logging.

import {
  PROMOTION_CRITERIA,
  CoreTraitPromoter,
  computeEvidence,
  meetsPromotionCriteria,
  shouldDemote,
} from "../src/lib/skills/core-trait-promoter";
import {
  loadCoreTraitPromotions,
  setCoreTraitPromotion,
} from "../src/lib/skills/core-trait-promotions";
import type { OutcomeRecord } from "../src/lib/orchestrator/skill-outcomes";
import type {
  CoreTraitCandidate,
  CoreTraitVerdict,
  CoreTraitVerifier,
} from "../src/lib/skills/core-trait-verifier";
import type { YantrikClient } from "../src/lib/yantrikdb/client";

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

// Stub localStorage.
class MemStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
  clear(): void {
    this.data.clear();
  }
  get length(): number {
    return this.data.size;
  }
  key(n: number): string | null {
    return Array.from(this.data.keys())[n] ?? null;
  }
}
const storage = new MemStorage();
(globalThis as unknown as { localStorage: MemStorage }).localStorage = storage;

function reset(): void {
  storage.clear();
}

// Build a synthetic outcome with the encoded note shape skill-outcomes
// uses. score=+1 / -1, session_id assignable, ts ISO.
function outcome(opts: {
  session_id: string;
  ts: string;
  score: 1 | -1;
  reason?: string;
}): OutcomeRecord {
  const note = {
    session_id: opts.session_id,
    ts: opts.ts,
    score: opts.score,
    reason: opts.reason ?? "positive",
  };
  return {
    succeeded: opts.score === 1,
    at: opts.ts,
    note: `__skill_outcome__:${JSON.stringify(note)}`,
  };
}

function daysAgoIso(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────

function test_computeEvidence_empty(): void {
  console.log("--- pure: computeEvidence on empty outcomes ---");
  const ev = computeEvidence({ outcomes: [] }, new Date());
  eq(ev.total_net_score, 0, "net 0");
  eq(ev.distinct_sessions, 0, "0 sessions");
  eq(ev.days_active, 0, "0 days");
}

function test_computeEvidence_aggregates_correctly(): void {
  console.log("--- pure: computeEvidence aggregates outcomes ---");
  const now = new Date("2026-06-15T00:00:00Z");
  const outcomes = [
    outcome({ session_id: "s1", ts: daysAgoIso(10, now), score: 1 }),
    outcome({ session_id: "s1", ts: daysAgoIso(9, now), score: 1 }),
    outcome({ session_id: "s2", ts: daysAgoIso(7, now), score: 1 }),
    outcome({ session_id: "s3", ts: daysAgoIso(5, now), score: -1 }),
    outcome({ session_id: "s4", ts: daysAgoIso(2, now), score: 1 }),
  ];
  const ev = computeEvidence({ outcomes }, now);
  eq(ev.total_net_score, 3, "net = 4 positives - 1 negative = 3");
  eq(ev.reinforcement_count, 4, "4 positive outcomes counted");
  eq(ev.distinct_sessions, 4, "4 distinct sessions");
  eq(Math.round(ev.days_active), 10, "first observation 10 days ago");
  eq(Math.round(ev.success_rate * 10) / 10, 0.8, "4/5 = 0.8 success");
}

function test_meetsPromotionCriteria_all_thresholds(): void {
  console.log("--- pure: promotion criteria honor all four thresholds ---");
  const meets = {
    total_net_score: PROMOTION_CRITERIA.min_net_score,
    reinforcement_count: 10,
    distinct_sessions: PROMOTION_CRITERIA.min_distinct_sessions,
    days_active: PROMOTION_CRITERIA.min_days_active,
    success_rate: PROMOTION_CRITERIA.min_success_rate,
    first_at: new Date().toISOString(),
  };
  assert(meetsPromotionCriteria(meets), "minimum bar meets criteria");
  assert(
    !meetsPromotionCriteria({ ...meets, total_net_score: meets.total_net_score - 1 }),
    "below net score rejects"
  );
  assert(
    !meetsPromotionCriteria({ ...meets, distinct_sessions: meets.distinct_sessions - 1 }),
    "below distinct sessions rejects"
  );
  assert(
    !meetsPromotionCriteria({ ...meets, days_active: meets.days_active - 1 }),
    "below days active rejects"
  );
  assert(
    !meetsPromotionCriteria({
      ...meets,
      success_rate: meets.success_rate - 0.01,
    }),
    "below success rate rejects"
  );
}

function test_shouldDemote_window_thresholds(): void {
  console.log("--- pure: demotion criteria for low success rate in window ---");
  const now = new Date("2026-06-15T00:00:00Z");
  // 6 recent outcomes, only 1 positive → 17% success rate, below 0.3
  const badRecent = [
    outcome({ session_id: "s1", ts: daysAgoIso(5, now), score: 1 }),
    outcome({ session_id: "s1", ts: daysAgoIso(4, now), score: -1 }),
    outcome({ session_id: "s2", ts: daysAgoIso(3, now), score: -1 }),
    outcome({ session_id: "s2", ts: daysAgoIso(2, now), score: -1 }),
    outcome({ session_id: "s3", ts: daysAgoIso(1, now), score: -1 }),
    outcome({ session_id: "s3", ts: daysAgoIso(0.5, now), score: -1 }),
  ];
  assert(
    shouldDemote({ outcomes: badRecent }, now),
    "1/6 = 17% within window → demote"
  );
  // Same outcomes but all OLD (outside window) → don't demote
  const allOld = badRecent.map((o) => ({
    ...o,
    at: daysAgoIso(40, now),
    note: o.note?.replace(/"ts":"[^"]+"/, `"ts":"${daysAgoIso(40, now)}"`),
  }));
  assert(!shouldDemote({ outcomes: allOld }, now), "old outcomes outside window → no demote");
  // Too few outcomes in window → no demote even if all negative
  const sparse = [
    outcome({ session_id: "s1", ts: daysAgoIso(5, now), score: -1 }),
    outcome({ session_id: "s2", ts: daysAgoIso(3, now), score: -1 }),
  ];
  assert(!shouldDemote({ outcomes: sparse }, now), "sparse window → no demote");
  // Healthy recent → no demote
  const good = badRecent.map((o) => ({
    ...o,
    note: o.note?.replace(/"score":-1/, '"score":1'),
  }));
  assert(!shouldDemote({ outcomes: good }, now), "high success rate → no demote");
}

// ────────────────────────────────────────────────────────────────────
// Promoter orchestration
// ────────────────────────────────────────────────────────────────────

function buildSkill(
  skill_id: string,
  applies_to: string,
  body: string,
  outcomes: OutcomeRecord[]
) {
  return { skill_id, body, applies_to: [applies_to], outcomes };
}

function makeFakeClient(skills: ReturnType<typeof buildSkill>[]): YantrikClient {
  return {
    skillList: async () =>
      skills.map((s) => ({
        skill_id: s.skill_id,
        body: s.body,
        skill_type: "pattern",
        applies_to: s.applies_to,
      })),
    skillGet: async (id: string) => {
      const found = skills.find((s) => s.skill_id === id);
      if (!found) return null;
      return {
        skill_id: found.skill_id,
        body: found.body,
        skill_type: "pattern",
        applies_to: found.applies_to,
        outcomes: found.outcomes,
      };
    },
  } as unknown as YantrikClient;
}

function makeFakeVerifier(
  verdictsByBody: Record<string, Omit<CoreTraitVerdict, "skill_id">>
): CoreTraitVerifier {
  return {
    cache: new Map(),
    invalidate: () => undefined,
    invalidateAll: () => undefined,
    verify: async (cand: CoreTraitCandidate) => {
      const v = verdictsByBody[cand.body];
      if (!v) {
        return {
          skill_id: cand.skill_id,
          is_core_trait: false,
          reasoning: "no scripted verdict for body",
          rank_estimate: 0,
        };
      }
      return { ...v, skill_id: cand.skill_id };
    },
  } as unknown as CoreTraitVerifier;
}

async function test_promoter_promotes_eligible_skill(): Promise<void> {
  console.log("--- promoter: eligible skill + verifier accept → crystallizes ---");
  reset();
  const now = new Date("2026-06-15T00:00:00Z");
  const elig = buildSkill(
    "sk1",
    "char-adira",
    "Adira deflects with humor when emotional intimacy spikes",
    [
      outcome({ session_id: "s1", ts: daysAgoIso(10, now), score: 1 }),
      outcome({ session_id: "s1", ts: daysAgoIso(9, now), score: 1 }),
      outcome({ session_id: "s2", ts: daysAgoIso(8, now), score: 1 }),
      outcome({ session_id: "s2", ts: daysAgoIso(7, now), score: 1 }),
      outcome({ session_id: "s3", ts: daysAgoIso(6, now), score: 1 }),
      outcome({ session_id: "s3", ts: daysAgoIso(5, now), score: 1 }),
      outcome({ session_id: "s4", ts: daysAgoIso(4, now), score: 1 }),
      outcome({ session_id: "s4", ts: daysAgoIso(3, now), score: 1 }),
    ]
  );
  const client = makeFakeClient([elig]);
  const verifier = makeFakeVerifier({
    "Adira deflects with humor when emotional intimacy spikes": {
      is_core_trait: true,
      reasoning: "Context-independent vulnerability handling pattern.",
      rank_estimate: 0.8,
    },
  });
  const promoter = new CoreTraitPromoter(client, verifier);
  const result = await promoter.run({
    character_id: "char-adira",
    character_name: "Adira",
    now,
  });
  eq(result.promoted.length, 1, "one promotion");
  eq(result.promoted[0].skill_id, "sk1", "right skill promoted");
  eq(result.demoted.length, 0, "no demotions");
  eq(result.rejected.length, 0, "no rejections");

  const stored = loadCoreTraitPromotions();
  const p = stored.get("sk1");
  assert(p, "stored to localStorage");
  eq(p?.character_id, "char-adira", "scoped to character");
  eq(p?.rank, 0.8, "rank persisted");
}

async function test_promoter_respects_verifier_reject(): Promise<void> {
  console.log("--- promoter: eligible skill + verifier reject → no promotion ---");
  reset();
  const now = new Date("2026-06-15T00:00:00Z");
  const elig = buildSkill("sk-reject", "char-x", "Adira helps people in distress", [
    outcome({ session_id: "s1", ts: daysAgoIso(10, now), score: 1 }),
    outcome({ session_id: "s1", ts: daysAgoIso(9, now), score: 1 }),
    outcome({ session_id: "s2", ts: daysAgoIso(8, now), score: 1 }),
    outcome({ session_id: "s2", ts: daysAgoIso(7, now), score: 1 }),
    outcome({ session_id: "s3", ts: daysAgoIso(6, now), score: 1 }),
    outcome({ session_id: "s3", ts: daysAgoIso(5, now), score: 1 }),
    outcome({ session_id: "s4", ts: daysAgoIso(4, now), score: 1 }),
    outcome({ session_id: "s4", ts: daysAgoIso(3, now), score: 1 }),
  ]);
  const client = makeFakeClient([elig]);
  const verifier = makeFakeVerifier({
    "Adira helps people in distress": {
      is_core_trait: false,
      reasoning: "Situational — would not apply in scenes without distress.",
      rank_estimate: 0,
    },
  });
  const promoter = new CoreTraitPromoter(client, verifier);
  const result = await promoter.run({
    character_id: "char-x",
    character_name: "Adira",
    now,
  });
  eq(result.promoted.length, 0, "no promotion");
  eq(result.rejected.length, 1, "one rejection logged");
  assert(
    loadCoreTraitPromotions().get("sk-reject") === undefined,
    "not stored"
  );
}

async function test_promoter_skips_below_quantitative_criteria(): Promise<void> {
  console.log("--- promoter: under-threshold skill skipped without verifier call ---");
  reset();
  const now = new Date("2026-06-15T00:00:00Z");
  // Only 2 sessions worth of outcomes → below distinct_sessions threshold
  const sparse = buildSkill("sk-sparse", "char-y", "Speaks softly", [
    outcome({ session_id: "s1", ts: daysAgoIso(3, now), score: 1 }),
    outcome({ session_id: "s1", ts: daysAgoIso(2, now), score: 1 }),
    outcome({ session_id: "s2", ts: daysAgoIso(1, now), score: 1 }),
  ]);
  const client = makeFakeClient([sparse]);
  let verifierCalled = false;
  const verifier = {
    cache: new Map(),
    invalidate: () => undefined,
    invalidateAll: () => undefined,
    verify: async () => {
      verifierCalled = true;
      return {
        skill_id: "sk-sparse",
        is_core_trait: true,
        reasoning: "x",
        rank_estimate: 1,
      };
    },
  } as unknown as CoreTraitVerifier;
  const promoter = new CoreTraitPromoter(client, verifier);
  const result = await promoter.run({
    character_id: "char-y",
    character_name: "Test",
    now,
  });
  eq(result.promoted.length, 0, "no promotion");
  eq(result.skipped_quantitative, 1, "counted as skipped");
  assert(!verifierCalled, "verifier never invoked");
}

async function test_promoter_demotes_low_success(): Promise<void> {
  console.log("--- promoter: existing core trait with low success rate → demoted ---");
  reset();
  const now = new Date("2026-06-15T00:00:00Z");
  // Pre-existing crystallization
  setCoreTraitPromotion("sk-demo", {
    crystallized_at: daysAgoIso(60, now),
    evidence: {
      total_net_score: 10,
      reinforcement_count: 10,
      distinct_sessions: 5,
      days_active: 30,
      success_rate: 0.9,
    },
    rank: 0.7,
    verifier_reasoning: "Was solid before",
    character_id: "char-z",
  });
  // Last 30 days: 1 positive, 5 negative — 17% success → below 0.3 threshold
  const decayed = buildSkill("sk-demo", "char-z", "Used to be solid", [
    outcome({ session_id: "old", ts: daysAgoIso(50, now), score: 1 }),
    outcome({ session_id: "old", ts: daysAgoIso(45, now), score: 1 }),
    outcome({ session_id: "s1", ts: daysAgoIso(20, now), score: 1 }),
    outcome({ session_id: "s1", ts: daysAgoIso(15, now), score: -1 }),
    outcome({ session_id: "s2", ts: daysAgoIso(10, now), score: -1 }),
    outcome({ session_id: "s2", ts: daysAgoIso(8, now), score: -1 }),
    outcome({ session_id: "s3", ts: daysAgoIso(5, now), score: -1 }),
    outcome({ session_id: "s3", ts: daysAgoIso(2, now), score: -1 }),
  ]);
  const client = makeFakeClient([decayed]);
  const verifier = makeFakeVerifier({}); // empty — promotion shouldn't fire
  const promoter = new CoreTraitPromoter(client, verifier);
  const result = await promoter.run({
    character_id: "char-z",
    character_name: "Test",
    now,
  });
  eq(result.demoted.length, 1, "one demotion");
  eq(result.demoted[0].skill_id, "sk-demo", "right trait demoted");
  assert(
    loadCoreTraitPromotions().get("sk-demo") === undefined,
    "removed from storage"
  );
}

async function test_promoter_idempotent_per_run(): Promise<void> {
  console.log("--- promoter: re-running on same state is no-op ---");
  reset();
  const now = new Date("2026-06-15T00:00:00Z");
  const elig = buildSkill(
    "sk-once",
    "char-once",
    "Speaks with rhythm",
    Array.from({ length: 8 }, (_, i) =>
      outcome({
        session_id: `s${(i % 4) + 1}`,
        ts: daysAgoIso(10 - i, now),
        score: 1,
      })
    )
  );
  const client = makeFakeClient([elig]);
  const verifier = makeFakeVerifier({
    "Speaks with rhythm": {
      is_core_trait: true,
      reasoning: "Speech signature.",
      rank_estimate: 0.6,
    },
  });
  const promoter = new CoreTraitPromoter(client, verifier);
  const first = await promoter.run({
    character_id: "char-once",
    character_name: "Test",
    now,
  });
  eq(first.promoted.length, 1, "first run promotes");
  const second = await promoter.run({
    character_id: "char-once",
    character_name: "Test",
    now,
  });
  eq(second.promoted.length, 0, "second run is no-op (already crystallized)");
}

(async () => {
  try {
    test_computeEvidence_empty();
    test_computeEvidence_aggregates_correctly();
    test_meetsPromotionCriteria_all_thresholds();
    test_shouldDemote_window_thresholds();
    await test_promoter_promotes_eligible_skill();
    await test_promoter_respects_verifier_reject();
    await test_promoter_skips_below_quantitative_criteria();
    await test_promoter_demotes_low_success();
    await test_promoter_idempotent_per_run();
    ok("all core-trait promoter tests passed");
    console.log("\n--- PASS: core-trait-promoter ---");
  } catch (e) {
    console.error("--- FAIL: core-trait-promoter ---", e);
    process.exit(1);
  }
})();
