// Phase 11 Pillar 3 — identity aggregator tests.
//
// Pure-function tests against the aggregator that builds the
// IdentityInspector view-model from the substrates. No React, no LLM,
// no YantrikDB — we feed in pre-shaped state and verify the
// composition logic.

import {
  aggregateIdentity,
  type InspectorIdentity,
} from "../src/lib/identity/aggregator";
import {
  setCoreTraitPromotion,
  type CoreTraitPromotion,
} from "../src/lib/skills/core-trait-promotions";
import type { InspectorSkill } from "../src/components/Inspector/SkillInspector";
import type { SelfModel } from "../src/lib/identity/self-model-types";

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

function makePromotion(opts: Partial<CoreTraitPromotion> = {}): CoreTraitPromotion {
  return {
    crystallized_at: opts.crystallized_at ?? "2026-05-01T00:00:00Z",
    evidence: opts.evidence ?? {
      total_net_score: 10,
      reinforcement_count: 10,
      distinct_sessions: 5,
      days_active: 14,
      success_rate: 0.85,
    },
    rank: opts.rank ?? 0.7,
    verifier_reasoning: opts.verifier_reasoning ?? "Stable identity signature.",
    character_id: opts.character_id ?? "char-x",
  };
}

function makeSkill(skill_id: string, body: string): InspectorSkill {
  return {
    skill_id,
    body,
    skill_type: "pattern",
    applies_to: ["char-x"],
    state: "core_trait",
    score: 1,
    success_rate: 0.85,
    uses: 10,
    transitions: [],
    successes: 9,
    override: undefined,
    raw_state: "core_trait",
  } as unknown as InspectorSkill;
}

function test_aggregate_returns_empty_when_no_promotions(): void {
  console.log("--- aggregate: no promotions → empty traits + null self-model ---");
  reset();
  const id = aggregateIdentity({
    character_id: "char-x",
    character_name: "X",
    self_model: null,
    skills: [],
    disabled_skill_ids: new Set(),
  });
  eq(id.core_traits.length, 0, "no traits");
  eq(id.crystallization_timeline.length, 0, "empty timeline");
  eq(id.crystallized_since, null, "no crystallization date");
  eq(id.self_model, null, "no self-model");
}

function test_aggregate_orders_traits_by_rank_descending(): void {
  console.log("--- aggregate: traits sorted by rank highest first ---");
  reset();
  setCoreTraitPromotion("sk1", makePromotion({ rank: 0.3 }));
  setCoreTraitPromotion("sk2", makePromotion({ rank: 0.9 }));
  setCoreTraitPromotion("sk3", makePromotion({ rank: 0.6 }));
  const id = aggregateIdentity({
    character_id: "char-x",
    character_name: "X",
    self_model: null,
    skills: [
      makeSkill("sk1", "Low-rank trait"),
      makeSkill("sk2", "High-rank trait"),
      makeSkill("sk3", "Mid-rank trait"),
    ],
    disabled_skill_ids: new Set(),
  });
  eq(id.core_traits.length, 3, "3 traits in identity");
  eq(id.core_traits[0].skill_id, "sk2", "highest rank first");
  eq(id.core_traits[1].skill_id, "sk3", "mid second");
  eq(id.core_traits[2].skill_id, "sk1", "lowest last");
}

function test_aggregate_timeline_ordered_by_crystallized_at(): void {
  console.log("--- aggregate: timeline ordered by crystallization date ---");
  reset();
  setCoreTraitPromotion(
    "sk-recent",
    makePromotion({ rank: 0.9, crystallized_at: "2026-06-01T00:00:00Z" })
  );
  setCoreTraitPromotion(
    "sk-oldest",
    makePromotion({ rank: 0.5, crystallized_at: "2026-04-01T00:00:00Z" })
  );
  setCoreTraitPromotion(
    "sk-middle",
    makePromotion({ rank: 0.7, crystallized_at: "2026-05-01T00:00:00Z" })
  );
  const id = aggregateIdentity({
    character_id: "char-x",
    character_name: "X",
    self_model: null,
    skills: [
      makeSkill("sk-recent", "Most recent"),
      makeSkill("sk-oldest", "Oldest crystallization"),
      makeSkill("sk-middle", "Middle"),
    ],
    disabled_skill_ids: new Set(),
  });
  eq(id.crystallization_timeline[0].skill_id, "sk-oldest", "oldest first");
  eq(id.crystallization_timeline[1].skill_id, "sk-middle", "middle second");
  eq(id.crystallization_timeline[2].skill_id, "sk-recent", "recent last");
  eq(
    id.crystallized_since,
    "2026-04-01T00:00:00Z",
    "crystallized_since = earliest crystallization"
  );
}

function test_aggregate_marks_disabled_traits_as_inactive(): void {
  console.log("--- aggregate: disabled trait shows active_in_prompt=false ---");
  reset();
  setCoreTraitPromotion("sk-on", makePromotion({ rank: 0.8 }));
  setCoreTraitPromotion("sk-off", makePromotion({ rank: 0.6 }));
  const id = aggregateIdentity({
    character_id: "char-x",
    character_name: "X",
    self_model: null,
    skills: [
      makeSkill("sk-on", "Active trait"),
      makeSkill("sk-off", "Disabled trait"),
    ],
    disabled_skill_ids: new Set(["sk-off"]),
  });
  const onTrait = id.core_traits.find((t) => t.skill_id === "sk-on")!;
  const offTrait = id.core_traits.find((t) => t.skill_id === "sk-off")!;
  assert(onTrait.active_in_prompt, "non-disabled trait active");
  assert(!offTrait.active_in_prompt, "disabled trait inactive");
}

function test_aggregate_handles_missing_skill_body(): void {
  console.log("--- aggregate: promotion without matching skill → empty body, inactive ---");
  reset();
  setCoreTraitPromotion("sk-orphan", makePromotion({ rank: 0.7 }));
  const id = aggregateIdentity({
    character_id: "char-x",
    character_name: "X",
    self_model: null,
    skills: [], // sk-orphan promotion exists but no live skill
    disabled_skill_ids: new Set(),
  });
  eq(id.core_traits.length, 1, "promotion still listed");
  eq(id.core_traits[0].body, "", "body empty");
  assert(!id.core_traits[0].active_in_prompt, "orphan inactive in prompt");
}

function test_aggregate_sessions_observed_uses_max_evidence(): void {
  console.log("--- aggregate: sessions_observed = max evidence.distinct_sessions ---");
  reset();
  setCoreTraitPromotion(
    "a",
    makePromotion({
      evidence: {
        total_net_score: 8,
        reinforcement_count: 8,
        distinct_sessions: 4,
        days_active: 10,
        success_rate: 0.7,
      },
    })
  );
  setCoreTraitPromotion(
    "b",
    makePromotion({
      evidence: {
        total_net_score: 20,
        reinforcement_count: 20,
        distinct_sessions: 12,
        days_active: 40,
        success_rate: 0.9,
      },
    })
  );
  const id = aggregateIdentity({
    character_id: "char-x",
    character_name: "X",
    self_model: null,
    skills: [makeSkill("a", "x"), makeSkill("b", "y")],
    disabled_skill_ids: new Set(),
  });
  eq(id.sessions_observed, 12, "max evidence.distinct_sessions used");
}

function test_aggregate_includes_self_model(): void {
  console.log("--- aggregate: self_model threaded through ---");
  reset();
  const selfModel: SelfModel = {
    header: {
      character_id: "char-x",
      generated_at: "2026-06-01T00:00:00Z",
      model_used: "qwen3:14b",
      inputs_hash: "abc",
      paragraph_count: 2,
      next_refresh_after: "2026-06-08T00:00:00Z",
    },
    body: "I am X. I do things.",
  };
  const id = aggregateIdentity({
    character_id: "char-x",
    character_name: "X",
    self_model: selfModel,
    skills: [],
    disabled_skill_ids: new Set(),
  });
  eq(id.self_model?.body, "I am X. I do things.", "self-model body preserved");
  eq(id.self_model?.header.model_used, "qwen3:14b", "header preserved");
}

function test_aggregate_only_lists_traits_for_this_character(): void {
  console.log("--- aggregate: cross-character promotions don't leak ---");
  reset();
  setCoreTraitPromotion("sk-x", makePromotion({ character_id: "char-x", rank: 0.8 }));
  setCoreTraitPromotion("sk-y", makePromotion({ character_id: "char-y", rank: 0.9 }));
  const id = aggregateIdentity({
    character_id: "char-x",
    character_name: "X",
    self_model: null,
    skills: [makeSkill("sk-x", "X trait"), makeSkill("sk-y", "Y trait")],
    disabled_skill_ids: new Set(),
  });
  eq(id.core_traits.length, 1, "only char-x trait shown");
  eq(id.core_traits[0].skill_id, "sk-x", "right trait");
}

(() => {
  try {
    test_aggregate_returns_empty_when_no_promotions();
    test_aggregate_orders_traits_by_rank_descending();
    test_aggregate_timeline_ordered_by_crystallized_at();
    test_aggregate_marks_disabled_traits_as_inactive();
    test_aggregate_handles_missing_skill_body();
    test_aggregate_sessions_observed_uses_max_evidence();
    test_aggregate_includes_self_model();
    test_aggregate_only_lists_traits_for_this_character();
    ok("all identity aggregator tests passed");
    console.log("\n--- PASS: identity-aggregator ---");
  } catch (e) {
    console.error("--- FAIL: identity-aggregator ---", e);
    process.exit(1);
  }
})();
