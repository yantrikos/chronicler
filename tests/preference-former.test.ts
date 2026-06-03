// PreferenceFormer verifier behavior + substrate roundtrip.
// Run: npx tsx tests/preference-former.test.ts

import { YantrikClient } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import { MockProvider } from "../src/lib/providers/mock";
import {
  PreferenceFormer,
  type PreferenceCandidate,
} from "../src/lib/orchestrator/preference-former";
import { listPreferences } from "../src/lib/preferences/substrate";
import { defaultSettings } from "../src/lib/preferences/store";
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
    importance: 0.5,
    certainty: 0.8,
  };
}

function candidate(
  character_id: string,
  memories: RecallResult[]
): PreferenceCandidate {
  return {
    character_id,
    character_name: character_id,
    session_id: "test-session",
    recent_memories: memories,
  };
}

async function main(): Promise<void> {
  console.log("--- PreferenceFormer test ---");

  // ---- 1. Ordinary interpretation auto-activates (default settings) ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    const p = new MockProvider({
      scripted: [
        JSON.stringify({
          items: [
            {
              statement: "Adira prefers tea over coffee and asks for it often",
              interpretation_level: "interpretation",
              sensitivity: "ordinary",
              polarity: "positive",
              evidence_rids: ["m1", "m2"],
              why: "stated preference + ordered tea twice",
            },
          ],
        }),
      ],
    });
    const former = new PreferenceFormer(c, p, "mock");
    const formed = await former.formFromCandidate(
      candidate("adira", [mem("m1", "Adira said she prefers tea"), mem("m2", "Adira ordered tea")]),
      defaultSettings()
    );
    check(formed.length === 1, "ordinary interp formed one preference");
    check(formed[0].preference.state === "active", "auto-active by default");
    const stored = await listPreferences(c, "adira");
    check(stored.length === 1, "one preference in substrate");
    check(stored[0].sensitivity === "ordinary", "sensitivity ordinary");
    check(stored[0].evidence.every((e) => e.pre_activation), "evidence marked pre_activation");
  }

  // ---- 2. Private interpretation requires confirmation (candidate state) ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    const p = new MockProvider({
      scripted: [
        JSON.stringify({
          items: [
            {
              statement: "Adira enjoys long verbal teasing before any physical touch",
              interpretation_level: "interpretation",
              sensitivity: "private",
              polarity: "positive",
              evidence_rids: ["m1", "m2", "m3"],
              why: "delayed touch + requested verbal build-up multiple times",
            },
          ],
        }),
      ],
    });
    const former = new PreferenceFormer(c, p, "mock");
    const formed = await former.formFromCandidate(
      candidate("adira", [
        mem("m1", "Adira pulled his hand away gently"),
        mem("m2", "Adira asked him to keep talking"),
        mem("m3", "Adira sighed when he made her wait"),
      ]),
      defaultSettings()
    );
    check(formed.length === 1, "private interp formed");
    check(
      formed[0].preference.state === "candidate",
      `private starts as candidate (got ${formed[0].preference.state})`
    );
  }

  // ---- 3. Private interpretation auto-activates when trust_private=true ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    const p = new MockProvider({
      scripted: [
        JSON.stringify({
          items: [
            {
              statement: "Adira likes setting the pace in intimate scenes",
              interpretation_level: "interpretation",
              sensitivity: "private",
              polarity: "positive",
              evidence_rids: ["m1", "m2"],
            },
          ],
        }),
      ],
    });
    const former = new PreferenceFormer(c, p, "mock");
    const formed = await former.formFromCandidate(
      candidate("adira", [mem("m1", "a"), mem("m2", "b")]),
      { ...defaultSettings(), trust_private: true }
    );
    check(
      formed[0].preference.state === "active",
      "trust_private auto-activates private interp"
    );
  }

  // ---- 4. Limit ALWAYS starts as candidate (safety floor) ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    const p = new MockProvider({
      scripted: [
        JSON.stringify({
          items: [
            {
              statement: "Adira does not enjoy being rushed in any context",
              interpretation_level: "interpretation",
              sensitivity: "limit",
              polarity: "negative",
              evidence_rids: ["m1", "m2"],
            },
          ],
        }),
      ],
    });
    const former = new PreferenceFormer(c, p, "mock");
    // Even with both toggles maxed, limit stays candidate.
    const formed = await former.formFromCandidate(
      candidate("adira", [mem("m1", "a"), mem("m2", "b")]),
      { auto_keep_ordinary: true, trust_private: true, auto_keep_limits: false }
    );
    check(
      formed[0].preference.state === "candidate",
      "limits ALWAYS candidate — settings cannot override"
    );
    check(formed[0].preference.polarity === "negative", "limit polarity negative");
  }

  // ---- 5. Identity label REJECTED by verifier (even if scripted) ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    const p = new MockProvider({
      scripted: [
        JSON.stringify({
          items: [
            {
              statement: "Adira is submissive in intimate scenes with Alex",
              interpretation_level: "identity_label",
              sensitivity: "private",
              polarity: "positive",
              evidence_rids: ["m1", "m2"],
            },
            {
              statement: "Adira is a brat — she enjoys talking back",
              interpretation_level: "interpretation",
              sensitivity: "private",
              polarity: "positive",
              evidence_rids: ["m1", "m2"],
            },
          ],
        }),
      ],
    });
    const former = new PreferenceFormer(c, p, "mock");
    const formed = await former.formFromCandidate(
      candidate("adira", [mem("m1", "a"), mem("m2", "b")]),
      defaultSettings()
    );
    check(
      formed.length === 0,
      `both identity labels rejected (got ${formed.length})`
    );
    const stored = await listPreferences(c, "adira");
    check(stored.length === 0, "no identity labels in substrate");
  }

  // ---- 6. Forbidden identity REGEX catches mis-labeled "interpretation" ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    const p = new MockProvider({
      scripted: [
        JSON.stringify({
          items: [
            {
              // Verifier mis-classifies as interpretation but text says "is submissive"
              statement: "Across multiple scenes, Alex is submissive when challenged",
              interpretation_level: "interpretation",
              sensitivity: "private",
              polarity: "positive",
              evidence_rids: ["m1", "m2"],
            },
          ],
        }),
      ],
    });
    const former = new PreferenceFormer(c, p, "mock");
    const formed = await former.formFromCandidate(
      candidate("alex", [mem("m1", "a"), mem("m2", "b")]),
      defaultSettings()
    );
    check(
      formed.length === 0,
      "regex final-guard catches 'is submissive' even when mis-labeled"
    );
  }

  // ---- 7. Interpretation with <2 evidence rids is dropped ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    const p = new MockProvider({
      scripted: [
        JSON.stringify({
          items: [
            {
              statement: "Adira always wears mismatched socks for luck",
              interpretation_level: "interpretation",
              sensitivity: "ordinary",
              polarity: "positive",
              evidence_rids: ["m1"], // only one
            },
          ],
        }),
      ],
    });
    const former = new PreferenceFormer(c, p, "mock");
    const formed = await former.formFromCandidate(
      candidate("adira", [mem("m1", "a"), mem("m2", "b")]),
      defaultSettings()
    );
    check(formed.length === 0, "single-evidence interpretation rejected");
  }

  // ---- 8. Hallucinated rids filtered out ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    const p = new MockProvider({
      scripted: [
        JSON.stringify({
          items: [
            {
              statement: "Adira likes long verbal teasing before any physical touch",
              interpretation_level: "interpretation",
              sensitivity: "private",
              polarity: "positive",
              evidence_rids: ["m1", "m99", "m100", "m2"], // m99/m100 hallucinated
            },
          ],
        }),
      ],
    });
    const former = new PreferenceFormer(c, p, "mock");
    const formed = await former.formFromCandidate(
      candidate("adira", [mem("m1", "a"), mem("m2", "b")]),
      defaultSettings()
    );
    check(formed.length === 1, "accept survives with 2 real rids");
    check(
      formed[0].preference.evidence.length === 2 &&
        formed[0].preference.evidence.every((e) =>
          ["m1", "m2"].includes(e.rid!)
        ),
      "hallucinated rids dropped from evidence"
    );
  }

  // ---- 9. Cache prevents re-prompting same character ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    let chatCalls = 0;
    const p = new MockProvider({
      fallback: () => {
        chatCalls++;
        return JSON.stringify({
          items: [
            {
              statement: "Adira ordered the same tea repeatedly across sessions",
              interpretation_level: "interpretation",
              sensitivity: "ordinary",
              polarity: "positive",
              evidence_rids: ["m1", "m2"],
            },
          ],
        });
      },
    });
    const former = new PreferenceFormer(c, p, "mock");
    const cand = candidate("adira", [mem("m1", "a"), mem("m2", "b")]);
    await former.formFromCandidate(cand, defaultSettings());
    await former.formFromCandidate(cand, defaultSettings());
    await former.formFromCandidate(cand, defaultSettings());
    check(chatCalls === 1, `cache: 3 passes → 1 verifier call (got ${chatCalls})`);
    former.invalidate("adira");
    await former.formFromCandidate(cand, defaultSettings());
    check(chatCalls === 2, "invalidate() forces re-verify");
  }

  // ---- 10. Dedup: re-running on same memories appends evidence, doesn't duplicate ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    const p = new MockProvider({
      fallback: () =>
        JSON.stringify({
          items: [
            {
              statement: "Adira gravitates toward small dogs at the harbor",
              interpretation_level: "interpretation",
              sensitivity: "ordinary",
              polarity: "positive",
              evidence_rids: ["m1", "m2"],
            },
          ],
        }),
    });
    const former = new PreferenceFormer(c, p, "mock");
    const cand = candidate("adira", [mem("m1", "a"), mem("m2", "b")]);
    await former.formFromCandidate(cand, defaultSettings());
    former.invalidate("adira");
    // Same memories, second run — should dedup the existing pref (no new
    // evidence added because rids m1/m2 are already there).
    await former.formFromCandidate(cand, defaultSettings());
    const stored = await listPreferences(c, "adira");
    check(stored.length === 1, "dedup: one preference, not two");
    check(stored[0].evidence.length === 2, "no duplicate evidence appended");
  }

  // ---- 11. Malformed JSON → conservative empty output ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    const p = new MockProvider({ scripted: ["not json at all"] });
    const former = new PreferenceFormer(c, p, "mock");
    const formed = await former.formFromCandidate(
      candidate("adira", [mem("m1", "a"), mem("m2", "b")]),
      defaultSettings()
    );
    check(formed.length === 0, "malformed verifier output → no prefs");
  }

  // ---- 12. <2 input memories bypasses verifier entirely ----
  {
    const t = new InMemoryTransport();
    const c = new YantrikClient(t);
    let chatCalls = 0;
    const p = new MockProvider({
      fallback: () => {
        chatCalls++;
        return "{}";
      },
    });
    const former = new PreferenceFormer(c, p, "mock");
    const formed = await former.formFromCandidate(
      candidate("adira", [mem("m1", "only one")]),
      defaultSettings()
    );
    check(formed.length === 0, "single-mem input → no formation");
    check(chatCalls === 0, "verifier not called with insufficient input");
  }

  console.log("\n--- PASS: preference-former ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
