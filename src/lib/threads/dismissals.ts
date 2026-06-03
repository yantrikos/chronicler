// Per-user thread state overrides. Open threads come from YantrikDB
// (temporal.upcoming + temporal.stale); the user's per-row actions land
// here. We don't mutate the source memories — those stay authoritative —
// we just record "user dismissed this," "snoozed until X," "marked as
// resolved." Filtered on render.
//
// Storage: localStorage, keyed by thread id (which is the source rid
// when available — see threads/types.ts).

export type ThreadStatus = "dismissed" | "snoozed" | "resolved" | "pinned";

export interface ThreadOverride {
  status: ThreadStatus;
  /** ISO timestamp; only meaningful for `snoozed`. After this passes,
   *  the thread surfaces again on next refresh. */
  until?: string;
  /** When the override was set, for inspection / debugging. */
  at: string;
}

const KEY = "chronicler.thread_overrides_v1";

export function loadThreadOverrides(): Map<string, ThreadOverride> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return new Map();
    const out = new Map<string, ThreadOverride>();
    for (const [k, v] of Object.entries(obj)) {
      const cand = v as Partial<ThreadOverride>;
      if (
        cand &&
        (cand.status === "dismissed" ||
          cand.status === "snoozed" ||
          cand.status === "resolved" ||
          cand.status === "pinned") &&
        typeof cand.at === "string"
      ) {
        out.set(k, {
          status: cand.status,
          until: typeof cand.until === "string" ? cand.until : undefined,
          at: cand.at,
        });
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

export function saveThreadOverrides(map: Map<string, ThreadOverride>): void {
  try {
    const obj: Record<string, ThreadOverride> = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    /* quota / unavailable — skip */
  }
}

export function setThreadOverride(
  id: string,
  status: ThreadStatus,
  opts: { until?: string; now?: Date } = {}
): Map<string, ThreadOverride> {
  const map = loadThreadOverrides();
  map.set(id, {
    status,
    until: opts.until,
    at: (opts.now ?? new Date()).toISOString(),
  });
  saveThreadOverrides(map);
  return map;
}

export function clearThreadOverride(id: string): Map<string, ThreadOverride> {
  const map = loadThreadOverrides();
  map.delete(id);
  saveThreadOverrides(map);
  return map;
}

/** True iff a thread's current override hides it from the inspector. A
 *  snoozed thread that's past its `until` timestamp surfaces again. */
export function isHidden(
  override: ThreadOverride | undefined,
  now: Date = new Date()
): boolean {
  if (!override) return false;
  if (override.status === "dismissed" || override.status === "resolved")
    return true;
  if (override.status === "snoozed") {
    if (!override.until) return true;
    return new Date(override.until).getTime() > now.getTime();
  }
  return false;
}
