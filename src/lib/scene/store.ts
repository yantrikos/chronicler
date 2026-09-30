// Per-session persistence for the scene board (browser localStorage, like the
// rest of the session data). Every access is guarded: storage can be blocked
// or full, and the board is a convenience, not something worth crashing over.

import { emptySceneState, type SceneState } from "./state";

const KEY = (sessionId: string) => `chronicler.scene.v1.${sessionId}`;

export function loadScene(sessionId: string): SceneState {
  try {
    const raw = window.localStorage.getItem(KEY(sessionId));
    if (!raw) return emptySceneState();
    const o = JSON.parse(raw) as Partial<SceneState>;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return {
      location: typeof o.location === "string" ? o.location : undefined,
      time: typeof o.time === "string" ? o.time : undefined,
      mood: typeof o.mood === "string" ? o.mood : undefined,
      present: list(o.present),
      goals: list(o.goals),
      inventory: list(o.inventory),
      updated_at: typeof o.updated_at === "string" ? o.updated_at : undefined,
      calm: typeof o.calm === "number" ? o.calm : undefined,
      cooldown: typeof o.cooldown === "number" ? o.cooldown : undefined,
      last_beat: typeof o.last_beat === "string" ? o.last_beat : undefined,
    };
  } catch {
    return emptySceneState();
  }
}

export function saveScene(sessionId: string, state: SceneState): void {
  try {
    window.localStorage.setItem(KEY(sessionId), JSON.stringify(state));
  } catch {
    // storage blocked or full — the board just won't survive a reload
  }
}

export function clearScene(sessionId: string): void {
  try {
    window.localStorage.removeItem(KEY(sessionId));
  } catch {
    // ignore
  }
}
