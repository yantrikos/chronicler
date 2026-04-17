// Promotion decision structured logging — Saga task #28.
//
// PRIVACY: memory text is REDACTED by default. The audience skews
// sensitive/NSFW/personal and a public logger that spills session content
// is unacceptable. Verbose mode (opt-in, local-only) is gated by the
// CHRONICLER_VERBOSE_LOGS env/flag. Never default-on in shipped code.
//
// See docs/DOGFOOD.md for the privacy-safe observation protocol.

import type { Tier } from "../yantrikdb/types";

export interface PromotionLogEntry {
  at: string; // ISO
  memory_id: string;
  text: string; // stripped on write unless verbose mode is on
  from_tier: Tier;
  to_tier: Tier;
  reason:
    | "user_pin"
    | "user_demote"
    | "threshold_met"
    | "retcon"
    | "imported_seed"
    | "user_confirm";
  certainty: number;
  importance: number;
  reinforcement_count?: number;
  session_span_days?: number;
  session_id?: string;
  outcome?: "accepted" | "reverted";
}

type Writer = (entry: PromotionLogEntry) => void | Promise<void>;

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

/** Enable verbose local-only logging (memory text included). Never call this
 *  in shipped code paths. It's for maintainer dogfooding only. */
export function setVerboseLocal(enabled: boolean): void {
  verboseLocal = enabled;
}

function redact(entry: PromotionLogEntry): PromotionLogEntry {
  if (verboseLocal || isVerboseEnv()) return entry;
  return { ...entry, text: "[redacted]" };
}

let writer: Writer = (entry) => {
  // eslint-disable-next-line no-console
  console.log("[promotion-log]", JSON.stringify(redact(entry)));
};

export function setPromotionLogWriter(w: Writer): void {
  writer = (entry) => w(redact(entry));
}

export async function logPromotion(entry: PromotionLogEntry): Promise<void> {
  await writer(entry);
}
