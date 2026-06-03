// Per-arc user state. Like thread overrides, lives in localStorage and
// wins over derived state at render time. The clusterer's status output
// remains the "truth"; this layer is the user's preference signal.

export type ArcOverrideStatus = "resolved" | "archived" | "pinned";

export interface ArcOverride {
  status: ArcOverrideStatus;
  at: string;
}

const KEY = "chronicler.arc_overrides_v1";

export function loadArcOverrides(): Map<string, ArcOverride> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return new Map();
    const out = new Map<string, ArcOverride>();
    for (const [k, v] of Object.entries(obj)) {
      const c = v as Partial<ArcOverride>;
      if (
        c &&
        (c.status === "resolved" ||
          c.status === "archived" ||
          c.status === "pinned") &&
        typeof c.at === "string"
      ) {
        out.set(k, { status: c.status, at: c.at });
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

export function saveArcOverrides(map: Map<string, ArcOverride>): void {
  try {
    const obj: Record<string, ArcOverride> = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    /* quota / unavailable — skip */
  }
}

export function setArcOverride(
  id: string,
  status: ArcOverrideStatus,
  now: Date = new Date()
): Map<string, ArcOverride> {
  const map = loadArcOverrides();
  map.set(id, { status, at: now.toISOString() });
  saveArcOverrides(map);
  return map;
}

export function clearArcOverride(id: string): Map<string, ArcOverride> {
  const map = loadArcOverrides();
  map.delete(id);
  saveArcOverrides(map);
  return map;
}
