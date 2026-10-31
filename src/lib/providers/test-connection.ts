// One real, tiny call through the real provider — so "does this key and model work?" has an answer in seconds,
// with the exact reason when it does not, and a plain note of anything Chronicler had to adapt for this model.

import { limit } from "../limits";
import type { LlmProvider } from "./index";

export interface TestResult {
  ok: boolean;
  /** What the model said (trimmed). */
  reply?: string;
  /** A warning on an otherwise successful call (e.g. it answered with no text). */
  note?: string;
  ms: number;
  /** What was learned about this model's limits, e.g. "leaves out temperature". */
  adapted: string[];
  /** Why it failed, in plain words. */
  error?: string;
}

export async function testProvider(provider: LlmProvider, model: string): Promise<TestResult> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60_000);
  const adapted = () => provider.adaptations?.(model) ?? [];
  try {
    const r = await provider.chat({
      model,
      system: "This is a connection test. Reply with the single word: ok",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: limit("bg.test_connection"),
      signal: ctl.signal,
    });
    const reply = r.content.trim().slice(0, 80);
    return {
      ok: true,
      reply,
      ms: Date.now() - t0,
      adapted: adapted(),
      ...(reply === "" ? { note: "It connected, but the model wrote no text within the test's token limit. If this is a reasoning model, turn thinking off for this provider." } : {}),
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, ms: Date.now() - t0, adapted: adapted(), error: aborted ? "No answer within 60 seconds." : e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
