// Skill state-machine transition log. Sibling of promotion-log.ts —
// same privacy posture (redacted by default, verbose only on opt-in env
// flag) but typed for the skill catalog rather than memory tiers.
//
// Kept separate so the memory-promotion telemetry contract stays clean.

export type SkillState = "candidate" | "active" | "suppressed" | "archived";

export interface SkillTransitionEntry {
  at: string; // ISO
  skill_id: string;
  body: string; // redacted unless verbose mode
  from_state: SkillState;
  to_state: SkillState;
  reason:
    | "threshold_met"
    | "negative_streak"
    | "idle_window"
    | "user_action";
  net_score: number;
  total_outcomes: number;
  distinct_sessions: number;
}

type Writer = (entry: SkillTransitionEntry) => void | Promise<void>;

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

export function setSkillVerboseLocal(enabled: boolean): void {
  verboseLocal = enabled;
}

function redact(entry: SkillTransitionEntry): SkillTransitionEntry {
  if (verboseLocal || isVerboseEnv()) return entry;
  return { ...entry, body: "[redacted]" };
}

let writer: Writer = (entry) => {
  // eslint-disable-next-line no-console
  console.log("[skill-transition]", JSON.stringify(redact(entry)));
};

export function setSkillTransitionWriter(w: Writer): void {
  writer = (entry) => w(redact(entry));
}

export async function logSkillTransition(
  entry: SkillTransitionEntry
): Promise<void> {
  await writer(entry);
}
