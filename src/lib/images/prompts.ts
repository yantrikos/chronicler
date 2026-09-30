// Prompts for generated graphics. Built ONLY from the character card and the
// scene board — never from what the player typed — so a private message can't
// leak into an image request, and so the same input always gives the same
// prompt (which is what makes caching work).

import type { SceneState } from "../scene/state";
import { DEFAULT_NEGATIVE, DEFAULT_STYLE } from "./types";

const MAX_DESC = 320;

/** Card text is full of template macros, markdown and second person. */
function tidy(text: string): string {
  return text
    .replace(/\{\{\s*(?:char|user)\s*\}\}/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~`#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PortraitSubject {
  name: string;
  description?: string;
}

export function portraitPrompt(c: PortraitSubject, style = DEFAULT_STYLE): { prompt: string; negative: string } {
  const full = tidy(c.description ?? "");
  // Only cut (back to a whole word) when it really is too long.
  const desc = full.length > MAX_DESC ? full.slice(0, MAX_DESC).replace(/\s+\S*$/, "") : full;
  const parts = [`Portrait of ${c.name}`, desc, "head and shoulders, looking toward the viewer", style];
  return { prompt: parts.filter(Boolean).join(". "), negative: DEFAULT_NEGATIVE };
}

/** Coarse time-of-day, used both for the prompt and to bound the cache: a
 *  location is drawn at most once per time bucket, however the board words it. */
export type TimeBucket = "dawn" | "day" | "dusk" | "night";

export function timeBucket(time: string | undefined): TimeBucket | null {
  const t = (time ?? "").toLowerCase();
  if (!t) return null;
  if (/dawn|sunrise|first light|early morning/.test(t)) return "dawn";
  if (/midnight|night|late|dark|small hours/.test(t)) return "night";
  if (/dusk|sunset|evening|twilight|nightfall/.test(t)) return "dusk";
  if (/morning|noon|midday|afternoon|day|lunch/.test(t)) return "day";
  return null;
}

export function backdropPrompt(s: SceneState, style = DEFAULT_STYLE): { prompt: string; negative: string } | null {
  if (!s.location) return null;
  const bucket = timeBucket(s.time);
  const when = bucket ? { dawn: "at dawn", day: "in daylight", dusk: "at dusk", night: "at night" }[bucket] : "";
  const parts = [
    `${tidy(s.location)} ${when}`.trim(),
    s.mood ? `${tidy(s.mood)} atmosphere` : "",
    "environment concept art, wide establishing shot, no people",
    style,
  ];
  return {
    prompt: parts.filter(Boolean).join(", "),
    negative: `${DEFAULT_NEGATIVE}, people, characters, faces`,
  };
}

/** Stable, non-cryptographic key (FNV-1a). Same inputs → same key. */
export function cacheKey(kind: "portrait" | "backdrop", model: string | undefined, size: string, prompt: string): string {
  let h = 0x811c9dc5;
  const s = `${kind}|${model ?? ""}|${size}|${prompt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${kind}:${h.toString(16)}`;
}
