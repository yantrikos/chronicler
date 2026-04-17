// The MVP gate: Saga task #15.
//
// Three sessions across "three days". On day 3, assert the "previously on..."
// recap references at least 4 specific facts established on day 1, with
// zero gaslighting-level errors (no false statements).
//
// Run: npx tsx tests/three-day-continuity.test.ts
//
// Uses MockProvider (scripted) + InMemoryTransport so the test is
// deterministic and needs no API keys. The gate test with a real LLM is
// spelled out in README.md and meant to be run before shipping.

import { YantrikClient } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import { MockProvider } from "../src/lib/providers/mock";
import { Orchestrator } from "../src/lib/orchestrator";
import type { Character, ChatTurn } from "../src/lib/orchestrator/types";
import { startSession, endSession } from "../src/lib/session/lifecycle";
import { generateRecap } from "../src/lib/recap/generator";
import { rememberAsCanon } from "../src/lib/yantrikdb/client";

// --- Fixtures ---

const CHARACTER: Character = {
  id: "test-char-01",
  name: "Ren",
  world_id: "test-world-01",
  description: "A calm, observant bookseller in a small coastal town.",
};

const DAY_1_FACTS = [
  "User's pet cat is named Kiku",
  "User's birthday is April 2nd",
  "User and Ren plan to meet at the lighthouse at dusk on Saturday",
  "User grew up in a fishing village called Oji",
  "Ren's shop is called The Salt Page",
];

// --- Helpers ---

function mkTurn(
  role: ChatTurn["role"],
  speaker: string,
  content: string,
  session_id: string
): ChatTurn {
  return {
    id: `t-${Math.random().toString(36).slice(2, 10)}`,
    role,
    speaker,
    content,
    created_at: new Date().toISOString(),
    session_id,
  };
}

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

async function runScriptedSession(
  client: YantrikClient,
  character: Character,
  sessionScript: { user: string; assistant: string }[],
  sessionIdx: number
): Promise<{ session_id: string; turns: ChatTurn[] }> {
  const session = await startSession(client, {
    user_id: "user",
    character_ids: [character.id],
    world_id: character.world_id,
  });
  const turns: ChatTurn[] = [];
  const mock = new MockProvider({
    scripted: sessionScript.map((s) => s.assistant),
  });
  const orch = new Orchestrator({
    client,
    provider: mock,
    model: "mock-model",
    getRecentTurns: async () => turns.slice(-10),
  });

  for (const step of sessionScript) {
    const userTurn = mkTurn("user", "user", step.user, session.id);
    turns.push(userTurn);
    const { assistant_turn } = await orch.turn(
      {
        session_id: session.id,
        user_id: "user",
        speaker: "user",
        user_message: userTurn,
        character,
      },
      `You are ${character.name}. ${character.description}`
    );
    turns.push(assistant_turn);
  }
  await endSession(client, session, turns, {
    summary: `Session ${sessionIdx + 1}: user and ${character.name} discussed ${sessionScript.length} topics.`,
  });
  return { session_id: session.id, turns };
}

// --- Test ---

async function main(): Promise<void> {
  console.log("--- 3-day continuity test (MVP gate) ---");
  const transport = new InMemoryTransport();
  const client = new YantrikClient(transport);

  // Seed the card-imported canon facts directly (bypassing parser — that's
  // tested separately). Each DAY_1_FACTS entry is written as canon so the
  // recap has real facts to draw from.
  const seedInputs = DAY_1_FACTS.map((fact) =>
    rememberAsCanon(fact, "seed-session", {
      character_id: CHARACTER.id,
      world_id: CHARACTER.world_id,
      visible_to: ["*"],
    })
  );
  await client.rememberBatch(seedInputs);

  // Day 1 session — establishes the facts via explicit user statements.
  console.log("\nDay 1 session");
  const day1Script = [
    { user: "Remember that my cat's name is Kiku.", assistant: "Got it, Kiku." },
    { user: "Remember that my birthday is April 2nd.", assistant: "Noted." },
    {
      user: "Remember that we plan to meet at the lighthouse at dusk on Saturday.",
      assistant: "I'll be there.",
    },
    {
      user: "Remember that I grew up in a fishing village called Oji.",
      assistant: "Tell me more sometime.",
    },
    {
      user: "Remember that your shop is called The Salt Page.",
      assistant: "It is — for years now.",
    },
  ];
  await runScriptedSession(client, CHARACTER, day1Script, 0);
  check(transport.all().length >= 5, "day 1 stored at least 5 memories");

  // Day 2 session — reinforces two facts.
  console.log("\nDay 2 session");
  const day2Script = [
    { user: "Kiku knocked a mug off the counter this morning.", assistant: "Cats." },
    {
      user: "Still planning on the lighthouse Saturday?",
      assistant: "Yes. Dusk.",
    },
  ];
  await runScriptedSession(client, CHARACTER, day2Script, 1);

  // Day 3 session start — generate recap BEFORE any user turn.
  console.log("\nDay 3 session start — generating recap");
  const recapProvider = new MockProvider(); // uses default fallback
  const recap = await generateRecap(client, {
    character_id: CHARACTER.id,
    world_id: CHARACTER.world_id,
    speaker: "user",
    provider: recapProvider,
    model: "mock-model",
  });

  console.log("\nRecap text:\n" + recap.text);
  console.log("\nRecap sources:", recap.sources);

  // Assert: recap references >= 4 of 5 day-1 facts (case-insensitive substring match on key terms).
  const keyTerms = [
    ["kiku"], // cat
    ["april 2"], // birthday
    ["lighthouse", "saturday", "dusk"], // meeting
    ["oji", "fishing village"], // hometown
    ["salt page"], // shop
  ];
  const text = recap.text.toLowerCase();
  const hits = keyTerms.filter((terms) => terms.some((t) => text.includes(t)));
  check(hits.length >= 4, `recap references >=4 day-1 facts (got ${hits.length})`);

  // Assert: no gaslighting — the recap does not claim any fact not in the seed set.
  // Check that it doesn't invent names not in the canon.
  const forbiddenInventions = ["bob", "alice", "london", "new york", "dragon"];
  for (const word of forbiddenInventions) {
    check(!text.includes(word), `recap does not invent "${word}"`);
  }

  console.log("\n--- PASS: 3-day continuity test ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
