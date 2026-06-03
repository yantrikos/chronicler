// Relationship drift detector — verifier behavior + substrate write.
// Run: npx tsx tests/relationship-drift.test.ts

import { YantrikClient } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import { MockProvider } from "../src/lib/providers/mock";
import {
  DriftFormer,
  type DriftCandidate,
} from "../src/lib/orchestrator/relationship-drift";
import type { RecallResult } from "../src/lib/yantrikdb/client";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

function mem(rid: string, text: string): RecallResult {
  return {
    rid,
    text,
    type: "semantic",
    score: 1,
    importance: 0.6,
    certainty: 0.8,
  };
}

function candidate(
  character_id: string,
  target: string,
  memories: RecallResult[]
): DriftCandidate {
  return {
    character_id,
    character_name: character_id,
    target,
    target_label: target,
    recent_memories: memories,
  };
}

async function main(): Promise<void> {
  console.log("--- relationship drift verifier test ---");

  // ---- accept path: clear trust↑ with 3 memories ----
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = new MockProvider({
      scripted: [
        JSON.stringify({
          is_drift: true,
          axis: "trust",
          direction: "up",
          body: "Ren has grown noticeably more trusting toward the user across recent scenes, sharing private memories of the shop fire she'd previously refused to discuss.",
          confidence: "high",
          evidence_rids: ["m1", "m2", "m3"],
          why: "three clear vulnerability disclosures in a row",
        }),
      ],
    });
    const former = new DriftFormer(client, provider, "mock");
    const formed = await former.formFromCandidates([
      candidate("ren", "user", [
        mem("m1", "Ren told the user about her father's letters."),
        mem("m2", "Ren admitted she still keeps her mother's apron behind the counter."),
        mem("m3", "Ren confessed she used to lie about being from the coast."),
      ]),
    ]);
    check(formed.length === 1, "accepted drift produces one formed entry");
    check(formed[0].axis === "trust", "axis carried through");
    check(formed[0].direction === "up", "direction carried through");
    check(
      formed[0].skill_id === "ren.drift.user_trust_up",
      `skill_id well-formed (got ${formed[0].skill_id})`
    );
    check(
      transport.skillsAll().some((s) => s.skill_id === formed[0].skill_id),
      "drift written to skill substrate"
    );
    const stored = transport.skillsAll()[0];
    check(stored.skill_type === "pattern", "stored with skill_type=pattern");
    check(
      stored.applies_to.includes("ren") &&
        stored.applies_to.includes("user") &&
        stored.applies_to.includes("trust") &&
        stored.applies_to.includes("direction_up"),
      "applies_to carries character + target + axis + direction tags"
    );
  }

  // ---- reject: verifier says no_drift ----
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = new MockProvider({
      scripted: [
        JSON.stringify({
          is_drift: false,
          axis: "trust",
          direction: "up",
          body: "",
          confidence: "low",
          evidence_rids: [],
          why: "ambiguous evidence",
        }),
      ],
    });
    const former = new DriftFormer(client, provider, "mock");
    const formed = await former.formFromCandidates([
      candidate("ren", "user", [
        mem("m1", "Ren smiled at the user."),
        mem("m2", "Ren served tea."),
      ]),
    ]);
    check(formed.length === 0, "rejected drift forms nothing");
    check(
      transport.skillsAll().length === 0,
      "no substrate write on rejection"
    );
  }

  // ---- reject: not enough input memories (single observation) ----
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = new MockProvider({
      scripted: [
        // Even if the verifier accepts, the input filter should bypass it
        JSON.stringify({
          is_drift: true,
          axis: "trust",
          direction: "up",
          body: "should not surface",
          confidence: "high",
          evidence_rids: ["m1"],
          why: "ignored",
        }),
      ],
    });
    const former = new DriftFormer(client, provider, "mock");
    const formed = await former.formFromCandidates([
      candidate("ren", "user", [mem("m1", "single memory")]),
    ]);
    check(
      formed.length === 0,
      "single-memory input bypasses verifier entirely"
    );
  }

  // ---- reject: verifier accepts but with <2 evidence rids ----
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = new MockProvider({
      scripted: [
        JSON.stringify({
          is_drift: true,
          axis: "openness",
          direction: "down",
          body: "Ren has become more guarded after the argument about the harbor.",
          confidence: "high",
          evidence_rids: ["m1"], // only one
          why: "single evidence",
        }),
      ],
    });
    const former = new DriftFormer(client, provider, "mock");
    const formed = await former.formFromCandidates([
      candidate("ren", "user", [
        mem("m1", "Ren snapped at the user."),
        mem("m2", "Ren left the room."),
      ]),
    ]);
    check(
      formed.length === 0,
      "final guard rejects when evidence_rids has < 2 entries"
    );
  }

  // ---- reject: low confidence ----
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = new MockProvider({
      scripted: [
        JSON.stringify({
          is_drift: true,
          axis: "trust",
          direction: "up",
          body: "Mild softening across two scenes, but the user hasn't reciprocated yet.",
          confidence: "low",
          evidence_rids: ["m1", "m2"],
          why: "soft signal",
        }),
      ],
    });
    const former = new DriftFormer(client, provider, "mock");
    const formed = await former.formFromCandidates([
      candidate("ren", "user", [
        mem("m1", "soft 1"),
        mem("m2", "soft 2"),
      ]),
    ]);
    check(formed.length === 0, "low-confidence accept rejected by guard");
  }

  // ---- evidence rid sanitization: hallucinated rids dropped ----
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = new MockProvider({
      scripted: [
        JSON.stringify({
          is_drift: true,
          axis: "trust",
          direction: "up",
          body: "Ren has grown noticeably more trusting toward the user, sharing private memories repeatedly.",
          confidence: "high",
          // Verifier hallucinates two rids that aren't in the input
          evidence_rids: ["m1", "m99", "m100", "m2"],
          why: "hallucinated extras",
        }),
      ],
    });
    const former = new DriftFormer(client, provider, "mock");
    const formed = await former.formFromCandidates([
      candidate("ren", "user", [
        mem("m1", "Ren told the user a secret."),
        mem("m2", "Ren shared a memory."),
      ]),
    ]);
    check(formed.length === 1, "accept survives with valid rids");
    check(
      formed[0].evidence_rids.length === 2 &&
        formed[0].evidence_rids.includes("m1") &&
        formed[0].evidence_rids.includes("m2"),
      "hallucinated rids filtered out"
    );
  }

  // ---- cache: same (character, target) → no re-verify ----
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    let chatCalls = 0;
    const provider = new MockProvider({
      fallback: () => {
        chatCalls++;
        return JSON.stringify({
          is_drift: true,
          axis: "trust",
          direction: "up",
          body: "Ren has consistently opened up to the user across recent scenes.",
          confidence: "high",
          evidence_rids: ["m1", "m2"],
          why: "consistent",
        });
      },
    });
    const former = new DriftFormer(client, provider, "mock");
    const cand = candidate("ren", "user", [
      mem("m1", "one"),
      mem("m2", "two"),
    ]);
    await former.formFromCandidates([cand]);
    await former.formFromCandidates([cand]);
    await former.formFromCandidates([cand]);
    check(
      chatCalls === 1,
      `cached by (character, target); 3 passes → 1 verifier call (got ${chatCalls})`
    );

    former.invalidate("ren", "user");
    await former.formFromCandidates([cand]);
    check(
      chatCalls === 2,
      "invalidate() forces re-verification"
    );
  }

  // ---- malformed JSON → conservative rejection ----
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = new MockProvider({
      scripted: ["nope just prose here"],
    });
    const former = new DriftFormer(client, provider, "mock");
    const formed = await former.formFromCandidates([
      candidate("ren", "user", [
        mem("m1", "one"),
        mem("m2", "two"),
      ]),
    ]);
    check(formed.length === 0, "malformed verifier output → no drift");
  }

  console.log("\n--- PASS: relationship drift ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
