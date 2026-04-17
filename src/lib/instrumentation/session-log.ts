// Session log — append-only JSONL of turn-level events. Feeds the replay
// harness (session-replay.ts) and the threshold tuning dashboard. See Saga
// tasks #28 (promotion log) and #29 (replay harness).
//
// PRIVACY: by default, all free-text fields (turn.content, memory_text) are
// REDACTED. Verbose mode (opt-in, local-only) is gated by the
// CHRONICLER_VERBOSE_LOGS env var or localStorage flag. Structural fields
// (ids, counts, timestamps, tier transitions) always stay.

import type { Tier } from "../yantrikdb/types";

export type LogEvent = TurnEvent | ReinforcementEvent | PromotionEvent;

export interface TurnEvent {
  kind: "turn";
  at: string;
  session_id: string;
  speaker: string;
  role: "user" | "assistant";
  content: string;
}

export interface ReinforcementEvent {
  kind: "reinforcement";
  at: string;
  session_id: string;
  memory_id: string;
  memory_text: string;
  new_count: number;
  unique_sessions: string[];
  first_reinforced_at: string;
  last_reinforced_at: string;
  importance: number;
  certainty: number;
  had_correction: boolean;
}

export interface PromotionEvent {
  kind: "promotion";
  at: string;
  session_id: string;
  memory_id: string;
  memory_text: string;
  from_tier: Tier;
  to_tier: Tier;
  reason: string;
  reinforcement_count?: number;
  certainty?: number;
  importance?: number;
}

type Writer = (e: LogEvent) => void | Promise<void>;

let verboseLocal = false;

function isVerboseEnv(): boolean {
  const g = globalThis as unknown as {
    process?: { env?: Record<string, string | undefined> };
    localStorage?: { getItem?: (k: string) => string | null };
  };
  const envVal = g.process?.env?.CHRONICLER_VERBOSE_LOGS;
  if (envVal === "1" || envVal?.toLowerCase() === "true") return true;
  if (typeof g.localStorage?.getItem === "function") {
    if (g.localStorage.getItem("chronicler.verboseLogs") === "1") return true;
  }
  return false;
}

export function setVerboseLocal(enabled: boolean): void {
  verboseLocal = enabled;
}

function redactEvent(e: LogEvent): LogEvent {
  if (verboseLocal || isVerboseEnv()) return e;
  if (e.kind === "turn") return { ...e, content: "[redacted]" };
  if (e.kind === "reinforcement")
    return { ...e, memory_text: "[redacted]" };
  if (e.kind === "promotion") return { ...e, memory_text: "[redacted]" };
  return e;
}

let writer: Writer = (e) => {
  // Default: in-memory ring; replaced with FS writer in production.
  ring.push(redactEvent(e));
  if (ring.length > 10_000) ring.shift();
};
const ring: LogEvent[] = [];

export function setSessionLogWriter(w: Writer): void {
  writer = (e) => w(redactEvent(e));
}

export async function logEvent(e: LogEvent): Promise<void> {
  await writer(e);
}

export function getInMemoryLog(): LogEvent[] {
  return [...ring];
}

export function clearInMemoryLog(): void {
  ring.length = 0;
}
