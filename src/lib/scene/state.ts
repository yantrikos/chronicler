// Scene status board — where things stand right now.
//
// Roleplayers hand-build this everywhere (author's notes, lorebook entries,
// ST tracker extensions) because a stateless model forgets that it is night,
// that the door is locked, or who else is in the room. Here it is a small
// structured state the model maintains cheaply and the player can see and
// correct. This file is the deterministic half: the shape, and how a model's
// proposed changes are folded in safely.

export interface SceneState {
  location?: string;
  time?: string;
  mood?: string;
  /** Names of who is physically present. */
  present: string[];
  /** Current short-term objectives. */
  goals: string[];
  /** Notable items the player is carrying. */
  inventory: string[];
  updated_at?: string;
  /** Pacing bookkeeping (see pacing.ts): consecutive turns with no change to
   *  the board, turns left on the cooldown after a story beat, and the last
   *  beat used. Carried on the board so it persists with the session. */
  calm?: number;
  cooldown?: number;
  last_beat?: string;
}

export type ListOp = string[] | { add?: string[]; remove?: string[] };

/** What the model returns: only what CHANGED. Absent = unchanged. */
export interface SceneDelta {
  location?: string | null;
  time?: string | null;
  mood?: string | null;
  present?: ListOp;
  goals?: ListOp;
  inventory?: ListOp;
}

export const MAX_LIST = 8;
const MAX_VALUE_CHARS = 80;
const MAX_ITEM_CHARS = 60;

export function emptySceneState(): SceneState {
  return { present: [], goals: [], inventory: [] };
}

export function isEmptyScene(s: SceneState): boolean {
  return !s.location && !s.time && !s.mood && !s.present.length && !s.goals.length && !s.inventory.length;
}

const JUNK = new Set([
  "", "unknown", "n/a", "na", "none", "null", "undefined", "unchanged", "same",
  "not specified", "unspecified", "no change", "-", "—",
]);

/** Trim, collapse whitespace, cap length; null for anything that is not a
 *  real value (models love to answer "unknown"). */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  let s = v.replace(/\s+/g, " ").trim().replace(/^["'`*_]+|["'`*_.]+$/g, "").trim();
  if (JUNK.has(s.toLowerCase())) return null;
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + "…";
  return s;
}

function key(s: string): string {
  return s.toLowerCase();
}

function applyList(current: string[], op: ListOp | undefined): string[] {
  if (op === undefined) return current;
  const add = Array.isArray(op) ? op : op.add ?? [];
  const remove = Array.isArray(op) ? null : op.remove ?? [];
  let out = [...current];
  if (Array.isArray(op)) out = []; // a bare array is a full replacement
  if (remove) {
    const gone = new Set(remove.map((r) => clean(r, MAX_ITEM_CHARS)).filter((x): x is string => !!x).map(key));
    out = out.filter((x) => !gone.has(key(x)));
  }
  for (const raw of add) {
    const item = clean(raw, MAX_ITEM_CHARS);
    if (!item) continue;
    if (out.some((x) => key(x) === key(item))) continue;
    out.push(item);
  }
  // Newest wins: a board that only ever grows stops being a board.
  return out.slice(-MAX_LIST);
}

export function applyDelta(state: SceneState, delta: SceneDelta, now = new Date()): SceneState {
  const next: SceneState = { ...state, present: [...state.present], goals: [...state.goals], inventory: [...state.inventory] };
  let changed = false;
  for (const f of ["location", "time", "mood"] as const) {
    if (!(f in delta)) continue;
    const v = clean(delta[f], MAX_VALUE_CHARS);
    if (v && v !== state[f]) {
      next[f] = v;
      changed = true;
    }
  }
  for (const f of ["present", "goals", "inventory"] as const) {
    const updated = applyList(state[f], delta[f]);
    if (updated.length !== state[f].length || updated.some((x, i) => x !== state[f][i])) {
      next[f] = updated;
      changed = true;
    }
  }
  if (changed) next.updated_at = now.toISOString();
  return changed ? next : state;
}

/** A player's manual correction. Unlike a model delta this is authoritative:
 *  an empty string clears a field, and lists are replaced outright. */
export function editScene(
  state: SceneState,
  patch: Partial<Pick<SceneState, "location" | "time" | "mood" | "present" | "goals" | "inventory">>,
  now = new Date()
): SceneState {
  const next: SceneState = { ...state, updated_at: now.toISOString() };
  for (const f of ["location", "time", "mood"] as const) {
    if (!(f in patch)) continue;
    next[f] = clean(patch[f], MAX_VALUE_CHARS) ?? undefined;
  }
  for (const f of ["present", "goals", "inventory"] as const) {
    const raw = patch[f];
    if (raw === undefined) continue;
    const seen = new Set<string>();
    next[f] = raw
      .map((x) => clean(x, MAX_ITEM_CHARS))
      .filter((x): x is string => !!x && !seen.has(key(x)) && !!seen.add(key(x)))
      .slice(-MAX_LIST);
  }
  return next;
}

/** Pull the first JSON object out of a model reply, tolerating code fences,
 *  <think> blocks and chatter. Anything unparseable is "no change". */
export function parseSceneDelta(raw: string): SceneDelta {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return {};
  try {
    const obj = JSON.parse(text.slice(a, b + 1));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: SceneDelta = {};
    for (const f of ["location", "time", "mood"] as const) {
      if (typeof obj[f] === "string") out[f] = obj[f];
    }
    for (const f of ["present", "goals", "inventory"] as const) {
      const v = obj[f];
      if (Array.isArray(v)) out[f] = v.filter((x: unknown) => typeof x === "string");
      else if (v && typeof v === "object") {
        const add = Array.isArray(v.add) ? v.add.filter((x: unknown) => typeof x === "string") : [];
        const remove = Array.isArray(v.remove) ? v.remove.filter((x: unknown) => typeof x === "string") : [];
        if (add.length || remove.length) out[f] = { add, remove };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Lines for the prompt, in the order a reader wants them. Empty when there is
 *  nothing known — no block, no cost. */
export function renderSceneStatus(s: SceneState): string[] {
  const lines: string[] = [];
  if (s.location) lines.push(`Location: ${s.location}`);
  if (s.time) lines.push(`Time: ${s.time}`);
  if (s.mood) lines.push(`Mood: ${s.mood}`);
  if (s.present.length) lines.push(`Present: ${s.present.join(", ")}`);
  if (s.goals.length) lines.push(`Current objectives: ${s.goals.join("; ")}`);
  if (s.inventory.length) lines.push(`The player is carrying: ${s.inventory.join(", ")}`);
  return lines;
}
