// Verify extractor behavior — the #1 risk we identified is that bad
// extraction pollutes canon. Specifically test the failure modes the regex
// version fell into: sarcasm, metaphor, in-character declarations, and
// malformed LLM output.
//
// Run: npx tsx tests/extract.test.ts

import { MockProvider } from "../src/lib/providers/mock";
import {
  HybridExtractor,
  LlmExtractor,
  RegexExtractor,
  parseExtraction,
} from "../src/lib/orchestrator/extract";
import type { Character, ChatTurn } from "../src/lib/orchestrator/types";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const CHAR: Character = {
  id: "ren",
  name: "Ren",
  description: "A calm bookseller.",
};

function turn(role: ChatTurn["role"], content: string): ChatTurn {
  return {
    id: "t",
    role,
    speaker: role === "user" ? "user" : "ren",
    content,
    created_at: new Date().toISOString(),
    session_id: "s",
  };
}

async function main(): Promise<void> {
  console.log("--- extractor behavior test ---");

  // parseExtraction: strict JSON
  {
    const r = parseExtraction('{"canon":["a"],"heuristic":[],"reflex":["b"]}');
    check(r.canon[0] === "a" && r.reflex[0] === "b", "parses clean JSON");
  }

  // parseExtraction: fenced
  {
    const r = parseExtraction('```json\n{"canon":["x"],"heuristic":[],"reflex":[]}\n```');
    check(r.canon[0] === "x", "strips ```json fences");
  }

  // parseExtraction: garbage returns empty (DO NOT POLLUTE)
  {
    const r = parseExtraction("I think user likes tea. Canon: user likes tea.");
    check(
      r.canon.length === 0 && r.heuristic.length === 0 && r.reflex.length === 0,
      "garbage extraction returns empty, does NOT pollute"
    );
  }

  // parseExtraction: non-array values rejected
  {
    const r = parseExtraction('{"canon":"oops","heuristic":null,"reflex":[]}');
    check(r.canon.length === 0, "rejects non-array canon field");
  }

  // RegexExtractor: explicit canon works
  {
    const r = await new RegexExtractor().extract({
      character: CHAR,
      user_turn: turn("user", "Remember that my cat's name is Kiku."),
    });
    check(
      r.canon.some((c) => c.toLowerCase().includes("kiku")),
      "regex catches explicit 'remember that' canon"
    );
  }

  // RegexExtractor: asterisk narration becomes reflex
  {
    const r = await new RegexExtractor().extract({
      character: CHAR,
      assistant_turn: turn("assistant", "*looks up from the ledger* Hello."),
    });
    check(r.reflex.length > 0, "regex catches asterisk narration as reflex");
  }

  // LlmExtractor: clean JSON flows through
  {
    const mock = new MockProvider({
      scripted: [
        '{"canon":["User is Kiku\'s owner"],"heuristic":["User seems warm toward Ren"],"reflex":["They are in the shop"]}',
      ],
    });
    const r = await new LlmExtractor(mock, "mock").extract({
      character: CHAR,
      user_turn: turn("user", "Hi Ren, did you miss me?"),
      assistant_turn: turn("assistant", "*smiles faintly* Perhaps."),
    });
    check(r.canon.length === 1 && r.heuristic.length === 1 && r.reflex.length === 1, "llm extractor routes JSON to tiers");
  }

  // LlmExtractor: malformed JSON swallowed without polluting
  {
    const mock = new MockProvider({ scripted: ["I think the user..."] });
    const r = await new LlmExtractor(mock, "mock").extract({
      character: CHAR,
      user_turn: turn("user", "test"),
    });
    check(
      r.canon.length === 0 && r.heuristic.length === 0 && r.reflex.length === 0,
      "llm extractor swallows malformed output without polluting"
    );
  }

  // Hybrid: regex + llm merged, deduped
  {
    const mock = new MockProvider({
      scripted: [
        '{"canon":["User cat Kiku"],"heuristic":["User prefers morning walks"],"reflex":[]}',
      ],
    });
    const r = await new HybridExtractor(new LlmExtractor(mock, "mock")).extract({
      character: CHAR,
      user_turn: turn("user", "Remember that my cat's name is Kiku."),
    });
    check(r.canon.length === 2, "hybrid combines regex and llm canon (2 distinct items)");
    check(
      r.heuristic.some((h) => h.toLowerCase().includes("morning")),
      "hybrid includes llm-only heuristic"
    );
  }

  // Adversarial: sarcasm / metaphor / in-character declarations
  // With the LLM stubbed to return empty (a good model WOULD return empty here),
  // we verify the pipeline can tolerate the "declines to extract" case.
  {
    const declineMock = new MockProvider({
      scripted: ['{"canon":[],"heuristic":[],"reflex":[]}'],
    });
    const r = await new HybridExtractor(new LlmExtractor(declineMock, "mock")).extract({
      character: CHAR,
      user_turn: turn("user", "I love this scene. You are absolutely perfect."),
    });
    check(
      r.canon.length === 0,
      "hybrid does NOT commit 'I love this scene' or 'you are perfect' as canon"
    );
    check(
      r.heuristic.length === 0,
      "hybrid does NOT commit in-character flattery as heuristic"
    );
  }

  console.log("\n--- PASS: extractor behavior ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
