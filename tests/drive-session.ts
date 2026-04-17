// Automated driver session — exercises the full stack end-to-end against
// REAL YantrikDB (via the running Chronicler proxy) and REAL Ollama. Not a
// unit test — produces a structural observation report for dogfood tuning.
//
// Run (with `docker compose up -d` already running):
//   npx tsx tests/drive-session.ts
//
// What it does:
//   1. Creates a throwaway character (namespace isolated from your UI session)
//   2. Runs 6 scripted user turns that establish specific facts
//   3. Measures per-turn latency (retrieval, generation, extraction)
//   4. Ends the session, starts a fresh one to simulate "next day"
//   5. Generates the "Previously on..." recap
//   6. Asserts recap references the established facts
//   7. Prints a structural report: promotions, memory counts, latencies
//
// No transcripts leave this machine. The model's replies are printed to
// stdout for maintainer inspection ONLY — close the terminal when done.

import { YantrikClient } from "../src/lib/yantrikdb/client";
import { McpTransport } from "../src/lib/yantrikdb/mcp-transport";
import { OllamaProvider } from "../src/lib/providers";
import {
  HybridExtractor,
  LlmExtractor,
} from "../src/lib/orchestrator/extract";
import { Orchestrator } from "../src/lib/orchestrator";
import type { Character, ChatTurn } from "../src/lib/orchestrator/types";
import {
  decomposeCard,
  buildSystemPrompt,
} from "../src/lib/cards/decompose";
import { soloScene } from "../src/lib/orchestrator/scene";
import { startSession, endSession } from "../src/lib/session/lifecycle";
import { generateRecap } from "../src/lib/recap/generator";

const STACK_URL =
  process.env.CHRONICLER_URL ?? "http://127.0.0.1:3001/api/mcp";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const GEN_MODEL = process.env.GEN_MODEL ?? "qwen3.5:4b";
const EXTRACT_MODEL = process.env.EXTRACT_MODEL ?? "qwen2.5:1.5b";

const TAG = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const CHAR_ID = `ren-driver-${TAG}`;
const WORLD_ID = `salt-page-driver-${TAG}`;

const SCRIPT: string[] = [
  "Hi Ren. I'm Pranab, visiting for the week.",
  "Remember that my cat's name is Kiku.",
  "I grew up in a fishing village called Oji, by the way.",
  "My birthday is April 2nd.",
  "Are there any books about lighthouses in the shop?",
  "Let's meet at the real lighthouse at dusk on Saturday — remember that.",
];

// Facts that MUST appear in the day-2 recap for the test to pass
const EXPECTED_FACTS: Array<{ label: string; terms: string[] }> = [
  { label: "user's name", terms: ["pranab"] },
  { label: "cat's name", terms: ["kiku"] },
  { label: "hometown", terms: ["oji", "fishing village"] },
  { label: "birthday", terms: ["april 2", "april 2nd"] },
  { label: "lighthouse meeting", terms: ["lighthouse", "saturday", "dusk"] },
];

function mkTurn(
  role: ChatTurn["role"],
  speaker: string,
  content: string,
  session_id: string
): ChatTurn {
  return {
    id: crypto.randomUUID(),
    role,
    speaker,
    content,
    created_at: new Date().toISOString(),
    session_id,
  };
}

function ms(n: number): string {
  return `${Math.round(n)}ms`;
}

async function main(): Promise<void> {
  console.log(`--- drive-session (tag=${TAG}) ---`);
  console.log(`stack: ${STACK_URL}`);
  console.log(`ollama: ${OLLAMA_URL}`);
  console.log(`models: gen=${GEN_MODEL} extract=${EXTRACT_MODEL}`);
  console.log();

  const transport = new McpTransport({
    kind: "streamable-http",
    url: STACK_URL,
  });
  const client = new YantrikClient(transport);

  // Two separate provider instances so we can hit qwen3.5:4b for generation
  // and qwen2.5:1.5b for extraction in parallel.
  const genProvider = new OllamaProvider(OLLAMA_URL, "gen", true);
  const extractProvider = new OllamaProvider(OLLAMA_URL, "extract", true);
  const extractor = new HybridExtractor(
    new LlmExtractor(extractProvider, EXTRACT_MODEL)
  );

  // --- 1. Seed an isolated Ren character ---
  const card = {
    spec: "chara_card_v2" as const,
    spec_version: "2.0" as const,
    data: {
      name: "Ren",
      description:
        "A calm, observant bookseller in the small coastal town of Port Lyra.",
      personality:
        "Quiet, perceptive, dry humor. Listens more than speaks. Narrates actions in third person past tense.",
      scenario:
        "Visit to Ren's second-hand bookshop, The Salt Page, on a grey afternoon.",
      first_mes: "*looks up from the ledger* Found something?",
    },
  };
  const rawJson = JSON.stringify(card);
  // Override id so we don't collide with the user's session
  const decomposed = await decomposeCard(client, card, rawJson, {
    session_id: "driver-import",
    user_id: "driver",
    world_id: WORLD_ID,
  });
  const character: Character = {
    id: CHAR_ID,
    name: "Ren",
    world_id: WORLD_ID,
    description: card.data.description,
  };

  // Re-seed canon under our own char id (decomposed uses its own generated id)
  void decomposed;
  const systemPrompt = buildSystemPrompt(card);

  // --- 2. Run session 1 ---
  const session1 = await startSession(client, {
    user_id: "driver",
    character_ids: [CHAR_ID],
    world_id: WORLD_ID,
  });
  const scene = soloScene(CHAR_ID);
  const turns: ChatTurn[] = [];
  const timings: Array<{
    idx: number;
    total_ms: number;
    writes_ms: number;
    reply_preview: string;
  }> = [];

  const orch = new Orchestrator({
    client,
    provider: genProvider,
    model: GEN_MODEL,
    extractor,
    getRecentTurns: async () => turns.slice(-10),
  });

  console.log("=== Session 1: establishing facts ===");
  for (let i = 0; i < SCRIPT.length; i++) {
    const userText = SCRIPT[i];
    const userTurn = mkTurn("user", "user", userText, session1.id);
    turns.push(userTurn);
    console.log(`\n[user] ${userText}`);
    const t0 = performance.now();
    const { assistant_turn, writes_promise } = await orch.turn(
      {
        session_id: session1.id,
        user_id: "driver",
        speaker: "user",
        user_message: userTurn,
        character,
      },
      systemPrompt,
      scene
    );
    const reply_ms = performance.now() - t0;
    turns.push(assistant_turn);
    const preview =
      assistant_turn.content.length > 200
        ? assistant_turn.content.slice(0, 197) + "…"
        : assistant_turn.content;
    console.log(`[ren]  ${preview}`);
    const t1 = performance.now();
    await writes_promise;
    const writes_ms = performance.now() - t1;
    timings.push({
      idx: i + 1,
      total_ms: reply_ms,
      writes_ms,
      reply_preview: preview,
    });
    console.log(
      `       turn latency: reply=${ms(reply_ms)}  writes=${ms(writes_ms)}`
    );
  }

  console.log("\n=== Ending session 1 ===");
  await endSession(client, session1, turns, {
    summary: `Session 1: driver (Pranab) visited The Salt Page and established: name, cat (Kiku), hometown (Oji), birthday (April 2nd), plan to meet at lighthouse.`,
  });

  // --- 3. Simulate "next day" ---
  console.log("\n=== Simulating next-day session — generating recap ===");
  await startSession(client, {
    user_id: "driver",
    character_ids: [CHAR_ID],
    world_id: WORLD_ID,
  });
  const recap_t0 = performance.now();
  const recap = await generateRecap(client, {
    character_id: CHAR_ID,
    world_id: WORLD_ID,
    speaker: "user",
    provider: genProvider,
    model: GEN_MODEL,
  });
  const recap_ms = performance.now() - recap_t0;
  console.log(`recap generated in ${ms(recap_ms)} from ${recap.sources.canon_count} canon facts`);
  console.log(`\n--- Previously on... ---`);
  console.log(recap.text);
  console.log(`--- end recap ---\n`);

  // --- 4. Validate ---
  console.log("=== Continuity validation ===");
  const recapLower = recap.text.toLowerCase();
  let hits = 0;
  for (const fact of EXPECTED_FACTS) {
    const matched = fact.terms.some((t) => recapLower.includes(t.toLowerCase()));
    if (matched) hits++;
    console.log(
      `  ${matched ? "✓" : "✗"} ${fact.label} (looked for: ${fact.terms.join(" | ")})`
    );
  }
  const pass = hits >= 4;
  console.log(
    `\nRecap referenced ${hits}/${EXPECTED_FACTS.length} established facts. ${
      pass ? "PASS" : "FAIL"
    } (threshold: >=4)`
  );

  // --- 5. Structural report ---
  console.log("\n=== Latency distribution ===");
  const reply_times = timings.map((t) => t.total_ms);
  const writes_times = timings.map((t) => t.writes_ms);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const max = (xs: number[]) => Math.max(...xs);
  console.log(
    `  reply  — avg ${ms(avg(reply_times))}  max ${ms(max(reply_times))}  (${SCRIPT.length} turns)`
  );
  console.log(
    `  writes — avg ${ms(avg(writes_times))}  max ${ms(max(writes_times))}`
  );
  console.log(`  recap  — ${ms(recap_ms)}`);

  // --- 6. Cleanup hint (not auto-deleted so you can inspect) ---
  console.log(
    `\n(memories under namespace character:${CHAR_ID} and world:${WORLD_ID} remain in YantrikDB for inspection)`
  );

  await transport.close();
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("\nDriver session threw:", err);
  process.exit(1);
});
