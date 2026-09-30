// Stop button — aborting mid-stream keeps the partial reply; aborting before
// anything streamed produces no turn; unrelated errors still propagate.
// Run: npx tsx tests/stop-generation.test.ts

import { YantrikClient } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import { Orchestrator } from "../src/lib/orchestrator";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/lib/providers";
import type { Character, ChatTurn } from "../src/lib/orchestrator/types";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const CHARACTER: Character = { id: "ren", name: "Ren", world_id: "w", description: "A bookseller." };

/** Streams `chunks`, then hangs until the request's signal aborts, then
 *  throws AbortError — what a real fetch reader does. */
class HangingProvider implements LlmProvider {
  name = "hanging";
  seenSignal: AbortSignal | undefined;
  constructor(private chunks: string[], private failWith?: Error) {}
  async chat(): Promise<ChatResponse> {
    return { content: "" };
  }
  async *stream(req: ChatRequest): AsyncIterable<string> {
    this.seenSignal = req.signal;
    for (const c of this.chunks) yield c;
    if (this.failWith) throw this.failWith;
    await new Promise<void>((_, reject) => {
      req.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError"))
      );
    });
  }
}

async function runTurn(provider: LlmProvider, abortAfterMs: number) {
  const client = new YantrikClient(new InMemoryTransport());
  const turns: ChatTurn[] = [];
  const orch = new Orchestrator({
    client,
    provider,
    model: "m",
    getRecentTurns: async () => turns,
  });
  const user: ChatTurn = {
    id: "u1", role: "user", speaker: "user", content: "hello there, tell me a story",
    created_at: new Date().toISOString(), session_id: "s1",
  };
  const ac = new AbortController();
  setTimeout(() => ac.abort(), abortAfterMs);
  const seen: string[] = [];
  return orch.turn(
    { session_id: "s1", user_id: "user", speaker: "user", user_message: user, character: CHARACTER },
    "You are Ren.",
    undefined,
    { onChunk: (_c, acc) => seen.push(acc), signal: ac.signal, skipWrites: true }
  );
}

async function main(): Promise<void> {
  console.log("--- stop generation test ---");

  const partial = new HangingProvider(["Once upon ", "a time"]);
  const r = await runTurn(partial, 300);
  check(r.assistant_turn.content === "Once upon a time", "abort mid-stream keeps the partial reply");
  check(partial.seenSignal !== undefined, "the signal reaches the provider request");

  let threw = false;
  try {
    await runTurn(new HangingProvider([]), 300);
  } catch (e) {
    threw = e instanceof DOMException && e.name === "AbortError";
  }
  check(threw, "abort before any text rejects with AbortError (no empty turn)");

  let propagated = false;
  try {
    await runTurn(new HangingProvider(["partial"], new Error("upstream 500")), 5000);
  } catch (e) {
    propagated = e instanceof Error && e.message === "upstream 500";
  }
  check(propagated, "a real provider error mid-stream is not swallowed");

  console.log("\n--- PASS: stop-generation ---");
}

main().then(() => process.exit(0));
