// Per-skill state overrides. Lets the user "approve" / "disable" / "archive"
// a skill without having to wait for the derived state machine to react.
//
// Persistence: localStorage. The substrate stays a flat outcome log; this
// layer is purely a client-side preference signal that wins over derived
// state inside the orchestrator's getSkillState callback.

import type { SkillState } from "../instrumentation/skill-transition-log";

const KEY = "chronicler.skill_overrides";

export function loadSkillOverrides(): Map<string, SkillState> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const out = new Map<string, SkillState>();
      for (const [k, v] of Object.entries(parsed)) {
        if (
          v === "candidate" ||
          v === "active" ||
          v === "suppressed" ||
          v === "archived"
        ) {
          out.set(k, v);
        }
      }
      return out;
    }
  } catch {
    /* ignore corruption */
  }
  return new Map();
}

export function saveSkillOverrides(map: Map<string, SkillState>): void {
  try {
    const obj: Record<string, SkillState> = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    /* localStorage full or unavailable — skip */
  }
}

export function setSkillOverride(
  skill_id: string,
  state: SkillState
): Map<string, SkillState> {
  const cur = loadSkillOverrides();
  cur.set(skill_id, state);
  saveSkillOverrides(cur);
  return cur;
}

export function clearSkillOverride(
  skill_id: string
): Map<string, SkillState> {
  const cur = loadSkillOverrides();
  cur.delete(skill_id);
  saveSkillOverrides(cur);
  return cur;
}
