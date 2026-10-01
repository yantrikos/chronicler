// Every tunable limit, in one place.
//
// These used to be literals scattered through the code (a dozen `max_tokens: 300`s, a 4000-token
// prompt budget, proxy timeouts, scheduler retries). One registry means each has a name, a default,
// a safe range and a plain-language description, appears in Settings → Advanced, and can be changed
// without a code change. Every default equals the value that was hard-coded before, so nothing
// behaves differently until someone edits a field.
//
// `limit(key)` is what call sites use. Overrides live in the saved config (`config.limits`) and are
// pushed here by `setLimitOverrides` whenever the config loads or saves. tests/limits.test.ts fails
// if a numeric token limit is written into the code again.

export type LimitUnit = "tokens" | "seconds" | "ms" | "share" | "count";

export interface LimitDef {
  key: string;
  group: "Replies" | "Prompt budget" | "Background tasks" | "Timeouts" | "Scheduling";
  label: string;
  help: string;
  default: number;
  min: number;
  max: number;
  unit: LimitUnit;
  /** Input step in the UI. */
  step?: number;
}

// Generic so each key stays a string LITERAL type — a typo in `limit("…")` must not compile.
const tokens = <K extends string>(key: K, group: LimitDef["group"], label: string, def: number, help: string, max = 64000) =>
  ({ key, group, label, help, default: def, min: 16, max, unit: "tokens" }) as const satisfies LimitDef;

export const LIMITS = [
  // ── Replies ──
  tokens("reply.default_tokens", "Replies", "Reply length (when a provider sets none)", 1024,
    "Most tokens a character may write per reply. A provider's own “max reply tokens” overrides this. ~750 words at 1,024.", 32768),
  tokens("reply.impersonate_tokens", "Replies", "“Write for me” length", 200,
    "Most tokens for the impersonate / suggest-a-reply feature.", 8192),

  // ── Prompt budget ──
  { key: "prompt.total_tokens", group: "Prompt budget", label: "Memory & context in the prompt", default: 4000, min: 500, max: 200000, unit: "tokens",
    help: "How many tokens of remembered facts and recent scene Chronicler puts in each prompt. Raise it for models with a large context window; keep it below the model's context window minus the reply length." },
  { key: "prompt.canon_pct", group: "Prompt budget", label: "Share for canon facts", default: 0.4, min: 0, max: 1, unit: "share", step: 0.05,
    help: "Fraction of the prompt budget for things you declared true. The shares are independent caps; they need not add up to 1." },
  { key: "prompt.scene_pct", group: "Prompt budget", label: "Share for the recent scene", default: 0.25, min: 0, max: 1, unit: "share", step: 0.05,
    help: "Fraction of the prompt budget for recent turns." },
  { key: "prompt.heuristic_pct", group: "Prompt budget", label: "Share for inferred facts", default: 0.2, min: 0, max: 1, unit: "share", step: 0.05,
    help: "Fraction of the prompt budget for facts Chronicler inferred." },
  { key: "prompt.graph_pct", group: "Prompt budget", label: "Share for relationships", default: 0.1, min: 0, max: 1, unit: "share", step: 0.05,
    help: "Fraction of the prompt budget for entity relationships." },

  // ── Background tasks (tokens each model call may write) ──
  tokens("bg.extract", "Background tasks", "Fact extraction", 600, "After each reply: reads the exchange and writes down the facts worth remembering. Too low and its JSON is cut off and the turn's facts are lost."),
  tokens("bg.scene_board", "Background tasks", "Scene board update", 300, "Keeps location, time, who is present and objectives current."),
  tokens("bg.ledger", "Background tasks", "Consequence ledger", 300, "Notices consequential things you did so the world can answer them later."),
  tokens("bg.chronicle_chapter", "Background tasks", "Story-so-far: new chapter", 260, "Summarises older messages into a short chapter."),
  tokens("bg.chronicle_merge", "Background tasks", "Story-so-far: merge chapters", 300, "Re-condenses older chapters when the summary grows."),
  tokens("bg.recap", "Background tasks", "“Previously on…” recap", 240, "The recap shown when you return to a story."),
  tokens("bg.conflict_check", "Background tasks", "Contradiction check", 120, "Decides whether a new fact contradicts a remembered one."),
  tokens("bg.drift", "Background tasks", "Relationship drift", 360, "Tracks how a relationship's trust and openness change."),
  tokens("bg.skill_former", "Background tasks", "Behaviour patterns", 300, "Distils repeated character behaviour into patterns."),
  tokens("bg.preference_former", "Background tasks", "Preferences", 8000, "Distils likes, dislikes and limits from play."),
  tokens("bg.core_trait_verify", "Background tasks", "Core-trait check", 4000, "Judges whether a pattern is a lasting identity trait."),
  tokens("bg.self_model", "Background tasks", "Character self-model", 4000, "Writes the character's first-person identity paragraph."),
  tokens("bg.trait_enact", "Background tasks", "Trait “on the page” line", 200, "Restates a trait as what the character visibly does (optional setting)."),
  tokens("bg.trait_check", "Background tasks", "Trait line faithfulness check", 60, "Checks that line adds nothing the trait does not say."),
  tokens("bg.audit_traits", "Background tasks", "Consistency audit: list traits", 300, "Extracts the declared traits an audit checks against."),
  tokens("bg.audit_judge", "Background tasks", "Consistency audit: judge", 300, "Flags replies that contradict a trait."),
  tokens("bg.vision_describe", "Background tasks", "Image description", 320, "The description a vision model writes for an attached image."),

  // ── Timeouts (the model server connection) ──
  { key: "proxy.first_byte_s", group: "Timeouts", label: "Wait for the first word (seconds)", default: 600, min: 5, max: 7200, unit: "seconds",
    help: "How long to wait for a model to start answering. Loading a big model and reading a long prompt on CPU can take minutes. Leave empty to use the server's setting (CHRONICLER_LLM_TIMEOUT_MS)." },
  { key: "proxy.idle_s", group: "Timeouts", label: "Give up if it goes silent (seconds)", default: 180, min: 5, max: 3600, unit: "seconds",
    help: "How long a reply may go quiet mid-stream before it is treated as dropped. Reset by every chunk, so a slow but steady reply is never cut off. Leave empty to use the server's setting (CHRONICLER_LLM_IDLE_MS)." },

  // ── Scheduling ──
  { key: "gate.quiet_ms", group: "Scheduling", label: "Quiet moment before background work (ms)", default: 1500, min: 0, max: 60000, unit: "ms", step: 100,
    help: "On a model shared by chat and background tasks, background work waits this long after a reply finishes, so your next message goes first." },
  { key: "gate.max_retries", group: "Scheduling", label: "Retries for interrupted background work", default: 3, min: 0, max: 20, unit: "count",
    help: "A background call is cancelled when you send a message and retried afterwards. After this many cancellations in a row it gives up." },
] as const satisfies readonly LimitDef[];

export type LimitKey = (typeof LIMITS)[number]["key"];
export type LimitOverrides = Partial<Record<LimitKey, number>>;

const DEFS: ReadonlyMap<string, LimitDef> = new Map(LIMITS.map((d) => [d.key, d]));
let overrides: LimitOverrides = {};

export function limitDef(key: LimitKey): LimitDef {
  return DEFS.get(key)!;
}

/** Clamp a candidate value into the key's range; undefined when it is not a usable number. */
export function sanitizeLimit(key: string, value: unknown): number | undefined {
  const def = DEFS.get(key);
  if (!def) return undefined;
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const clamped = Math.min(def.max, Math.max(def.min, n));
  return def.unit === "share" ? Math.round(clamped * 1000) / 1000 : Math.round(clamped);
}

/** Replace the active overrides (called whenever the config loads or saves). Unknown keys and
 *  unusable values are dropped, so a hand-edited or old config can never break a call. */
export function setLimitOverrides(next: Record<string, unknown> | undefined): void {
  const clean: LimitOverrides = {};
  for (const [k, v] of Object.entries(next ?? {})) {
    const s = sanitizeLimit(k, v);
    if (s !== undefined) (clean as Record<string, number>)[k] = s;
  }
  overrides = clean;
}

/** The value in effect: the user's override, else the default. */
export function limit(key: LimitKey): number {
  return overrides[key] ?? limitDef(key).default;
}

/** The value a given set of overrides would give — for the Settings screen, which edits a draft that
 *  has not been saved (and so is not yet the active overrides). */
export function limitFrom(draft: Record<string, number> | undefined, key: LimitKey): number {
  const s = draft ? sanitizeLimit(key, draft[key]) : undefined;
  return s ?? limitDef(key).default;
}

/** The user's override, or undefined when none is set (so "use the server's setting" can be told apart). */
export function limitOverride(key: LimitKey): number | undefined {
  return overrides[key];
}

export const LIMIT_GROUPS: ReadonlyArray<LimitDef["group"]> = ["Replies", "Prompt budget", "Background tasks", "Timeouts", "Scheduling"];
