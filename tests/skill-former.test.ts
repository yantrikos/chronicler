// Verify skill formation: LLM verifier gates which triggers become skills.
// Run: npx tsx tests/skill-former.test.ts

import { YantrikClient } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import { MockProvider } from "../src/lib/providers/mock";
import {
  SkillFormer,
  type SkillCandidate,
} from "../src/lib/orchestrator/skill-former";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

// Each verifier call is one scripted JSON reply, in submission order.
function scriptedProvider(replies: string[]): MockProvider {
  return new MockProvider({ scripted: replies });
}

function candidate(
  id: string,
  reason: string,
  character_id = "ren"
): SkillCandidate {
  return {
    trigger_id: id,
    reason,
    character_id,
    character_name: "Ren",
  };
}

async function main(): Promise<void> {
  console.log("--- skill formation pipeline test ---");

  // -----------------------------------------------------------------
  // 1) Verifier says no → no skill written to substrate
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = scriptedProvider([
      JSON.stringify({
        is_skill: false,
        skill_type: "pattern",
        applies_to: [],
        body: "",
        confidence: "low",
        why: "not enough evidence",
      }),
    ]);
    const former = new SkillFormer(client, provider, "mock-model", 1);
    const formed = await former.formFromCandidates([
      candidate("t1", "Ren paused before answering once."),
    ]);
    check(formed.length === 0, "verifier-rejected trigger forms no skill");
    check(
      transport.skillsAll().length === 0,
      "no skill written to substrate when verifier rejects"
    );
  }

  // -----------------------------------------------------------------
  // 2) Verifier says yes → skill written with shape
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = scriptedProvider([
      JSON.stringify({
        is_skill: true,
        skill_type: "pattern",
        applies_to: ["ren", "emotional"],
        body:
          "Ren deflects direct emotional questions with self-deprecating bookshop metaphors, then quietly shifts the topic back to the other person.",
        confidence: "high",
        why: "observed across 3 separate scenes with different interlocutors",
      }),
    ]);
    const former = new SkillFormer(client, provider, "mock-model", 1);
    const formed = await former.formFromCandidates([
      candidate(
        "t2",
        "Recurring deflection pattern when asked about feelings — three distinct scenes."
      ),
    ]);
    check(formed.length === 1, "verifier-accepted trigger produces one skill");
    check(
      formed[0].skill_id.startsWith("ren.emotional."),
      `skill_id uses character.area.verb pattern (got ${formed[0].skill_id})`
    );
    check(
      formed[0].skill_type === "pattern",
      "skill_type carried through from verdict"
    );
    check(
      formed[0].applies_to.length === 2 &&
        formed[0].applies_to.includes("ren"),
      "applies_to includes character"
    );
    check(formed[0].state === "candidate", "newly formed skill is candidate");
    const stored = transport.skillsAll();
    check(stored.length === 1, "exactly one skill in substrate");
    check(
      stored[0].body.includes("deflects"),
      "skill body persisted to substrate"
    );
  }

  // -----------------------------------------------------------------
  // 3) Model tic — verifier rejects (we trust the system prompt)
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = scriptedProvider([
      JSON.stringify({
        is_skill: false,
        skill_type: "pattern",
        applies_to: [],
        body: "",
        confidence: "low",
        why: "this is a model phrasing tic, not a character behavior",
      }),
    ]);
    const former = new SkillFormer(client, provider, "mock-model", 1);
    const formed = await former.formFromCandidates([
      candidate(
        "t3",
        "Phrase 'his lips curled into a knowing smile' appears 5 times across replies."
      ),
    ]);
    check(formed.length === 0, "model-tic correctly rejected");
    check(
      transport.skillsAll().length === 0,
      "no skill written for model tic"
    );
  }

  // -----------------------------------------------------------------
  // 4) Verifier accepts but applies_to is too broad → final guard rejects
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = scriptedProvider([
      JSON.stringify({
        is_skill: true,
        skill_type: "pattern",
        applies_to: ["general_roleplay"],
        body:
          "Ren engages with the user in conversation and responds to what they say.",
        confidence: "medium",
        why: "happens every turn",
      }),
    ]);
    const former = new SkillFormer(client, provider, "mock-model", 1);
    const formed = await former.formFromCandidates([
      candidate("t4", "Ren responds to user input."),
    ]);
    check(
      formed.length === 0,
      "broad applies_to rejected by normalizer even when LLM said yes"
    );
    const verdict = former.getCached("t4");
    check(
      verdict?.is_skill === false,
      "cached verdict marked is_skill=false post-normalization"
    );
  }

  // -----------------------------------------------------------------
  // 5) Cache hit — second pass with same trigger_id does NOT re-verify
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);

    let chatCalls = 0;
    const provider = new MockProvider({
      fallback: () => {
        chatCalls++;
        return JSON.stringify({
          is_skill: true,
          skill_type: "rule",
          applies_to: ["ren"],
          body:
            "Ren refuses to share her real name before sundown — observed consistently across encounters.",
          confidence: "high",
          why: "constant rule",
        });
      },
    });
    const former = new SkillFormer(client, provider, "mock-model", 1);

    const c = candidate("t5", "Ren consistently won't give her real name in daylight.");
    const first = await former.formFromCandidates([c]);
    check(first.length === 1, "first pass forms skill");
    check(chatCalls === 1, "first pass calls verifier once");

    const second = await former.formFromCandidates([c]);
    check(second.length === 1, "second pass still forms skill");
    check(
      chatCalls === 1,
      `cache hit: second pass does not re-call verifier (got ${chatCalls} calls)`
    );
  }

  // -----------------------------------------------------------------
  // 6) Verifier returns malformed JSON → conservative rejection, no crash
  // -----------------------------------------------------------------
  {
    const transport = new InMemoryTransport();
    const client = new YantrikClient(transport);
    const provider = scriptedProvider(["Sure! Here's my analysis: yes, accept it."]);
    const former = new SkillFormer(client, provider, "mock-model", 1);
    const formed = await former.formFromCandidates([
      candidate("t6", "Something."),
    ]);
    check(formed.length === 0, "malformed verifier output → no skill");
    check(
      transport.skillsAll().length === 0,
      "substrate untouched on parser failure"
    );
  }

  console.log("\n--- PASS: skill formation pipeline ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
