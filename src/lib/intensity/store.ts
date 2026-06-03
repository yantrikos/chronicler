// Per-mode snippet overrides. Default snippets live in registry.ts;
// users can edit any of them per-mode and the edit persists to
// localStorage. Same pattern as skill overrides + thread overrides.

import type { IntensityId } from "./registry";

const KEY = "chronicler.intensity_snippets_v1";

export function loadIntensitySnippets(): Partial<Record<IntensityId, string>> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<IntensityId, string>> = {};
    for (const id of [
      "neutral",
      "fade_to_black",
      "tasteful",
      "explicit",
    ] as IntensityId[]) {
      const v = (parsed as Record<string, unknown>)[id];
      if (typeof v === "string") out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveIntensitySnippet(id: IntensityId, snippet: string): void {
  try {
    const cur = loadIntensitySnippets();
    cur[id] = snippet;
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* quota / unavailable — skip */
  }
}

export function clearIntensitySnippet(id: IntensityId): void {
  try {
    const cur = loadIntensitySnippets();
    delete cur[id];
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* ignore */
  }
}
