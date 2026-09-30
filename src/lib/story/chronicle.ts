// The chronicle — "the story so far", kept as chapters.
//
// The model only reads the last few turns. Everything older survives only as
// scattered extracted facts, so in a long roleplay the thread of *what happened,
// and in what order* is lost — players patch it by hand with manual summaries.
// This keeps it natively.
//
// Why chapters and not one running summary: rewriting a summary over and over
// loses detail and slowly invents some (the game of telephone). Here each
// chapter is written ONCE, straight from the raw turns, and never re-summarised;
// only the very oldest chapters are ever merged into a coarser "earlier"
// paragraph. Chapters are visible and editable; an edited chapter is the
// player's and is never rewritten.
//
// This file is the deterministic half — which turns still need a chapter, how
// chapters are stored, merged and rendered. The model half is chronicler.ts.

import type { ChatTurn } from "../orchestrator/types";

/** Messages the orchestrator still shows the model verbatim. */
export const WINDOW = 10;
/** Messages summarised into one chapter (three exchanges). */
export const CHUNK = 6;
/** Characters of chapter text before the oldest are merged. */
export const MERGE_AT = 3400;
/** Chapters merged at a time. */
export const MERGE_COUNT = 3;
/** Most text ever put in a prompt. */
export const MAX_PROMPT_CHARS = 2800;
/** Longest merged "earlier" paragraph. */
export const MAX_EARLIER_CHARS = 1100;

export interface Chapter {
  id: string;
  /** True when the model could not write this chapter and it is a plain
   *  extract of the messages instead. */
  fallback?: boolean;
  text: string;
  /** Id of the last message this chapter covers. */
  last_id: string;
  /** True once the player has edited it — never rewritten, never merged away
   *  by the model. */
  edited?: boolean;
}

export interface Chronicle {
  /** Merged summary of the oldest chapters. */
  earlier?: string;
  chapters: Chapter[];
  /** Messages covered from the start of the chat. */
  covered: number;
  /** Id of the last covered message — lets `covered` survive deletions. */
  anchor_id?: string;
  next: number;
}

export function emptyChronicle(): Chronicle {
  return { chapters: [], covered: 0, next: 1 };
}

/** How many leading messages are covered, tolerating edits and deletions made
 *  since: trust the anchor's current position, fall back to the stored count. */
export function resolveCovered(turns: ChatTurn[], c: Chronicle): number {
  if (c.anchor_id) {
    const i = turns.findIndex((t) => t.id === c.anchor_id);
    if (i >= 0) return i + 1;
  }
  return Math.min(c.covered, turns.length);
}

/** A message that is part of the story (steering directives are not). */
function isStory(t: ChatTurn): boolean {
  if (t.role === "system" && t.speaker === "system:tool") return false;
  return true;
}

export interface Chunk {
  /** Index in `turns` of the first message of the chunk. */
  from: number;
  /** One past the last. */
  to: number;
  turns: ChatTurn[];
}

/** The next run of messages that has left the window and has no chapter yet,
 *  or null. Whole CHUNKs only, so chapters are a steady size. */
export function nextChunk(turns: ChatTurn[], c: Chronicle, window = WINDOW, chunk = CHUNK): Chunk | null {
  const covered = resolveCovered(turns, c);
  const expiredEnd = turns.length - window;
  if (expiredEnd - covered < chunk) return null;
  const slice = turns.slice(covered, covered + chunk);
  return { from: covered, to: covered + chunk, turns: slice };
}

/** Where the raw history the model reads should start, so that no message is
 *  ever in neither the history nor a chapter. Normally the first uncovered
 *  message; but never fewer than WINDOW messages, and never more than
 *  WINDOW + CHUNK - 1 (a chronicle that is still catching up must not blow up
 *  the prompt). */
export function historyStart(turnCount: number, covered: number, window = WINDOW, chunk = CHUNK): number {
  const floor = turnCount - (window + chunk - 1);
  const ceil = turnCount - window;
  return Math.max(0, Math.min(Math.max(covered, floor), ceil));
}

export function storyTurns(chunk: Chunk): ChatTurn[] {
  return chunk.turns.filter(isStory);
}

export function addChapter(c: Chronicle, text: string, chunk: Chunk, fallback = false): Chronicle {
  const clean = text.replace(/\s+/g, " ").trim();
  const last = chunk.turns[chunk.turns.length - 1];
  return {
    ...c,
    chapters: [...c.chapters, { id: `c${c.next}`, text: clean, last_id: last.id, ...(fallback ? { fallback: true } : {}) }],
    covered: chunk.to,
    anchor_id: last.id,
    next: c.next + 1,
  };
}

/** Advance past a chunk that has nothing to summarise (only steering
 *  directives), so it does not block the ones after it. */
export function skipChunk(c: Chronicle, chunk: Chunk): Chronicle {
  const last = chunk.turns[chunk.turns.length - 1];
  return { ...c, covered: chunk.to, anchor_id: last.id };
}

export function editChapter(c: Chronicle, id: string, text: string): Chronicle {
  return { ...c, chapters: c.chapters.map((ch) => (ch.id === id ? { ...ch, text: text.trim(), edited: true } : ch)) };
}

export function deleteChapter(c: Chronicle, id: string): Chronicle {
  return { ...c, chapters: c.chapters.filter((ch) => ch.id !== id) };
}

export function editEarlier(c: Chronicle, text: string): Chronicle {
  return { ...c, earlier: text.trim() || undefined };
}

export const totalChars = (c: Chronicle) => (c.earlier?.length ?? 0) + c.chapters.reduce((n, ch) => n + ch.text.length, 0);

/** The oldest chapters to fold into "earlier", if the chronicle has outgrown its
 *  budget. Player-edited chapters are never merged by the model. */
export function mergeCandidates(c: Chronicle): Chapter[] | null {
  if (totalChars(c) <= MERGE_AT || c.chapters.length <= MERGE_COUNT) return null;
  const oldest = c.chapters.slice(0, MERGE_COUNT);
  if (oldest.some((ch) => ch.edited)) return null;
  return oldest;
}

/** Fold `merged` chapters into "earlier". `text` is the model's condensation of
 *  the previous "earlier" paragraph TOGETHER WITH those chapters, so it replaces
 *  the old one — compressing the oldest facts, never chopping them off. (An
 *  earlier version appended and cut the front when it grew; that silently
 *  dropped the oldest facts, found by measuring a long story.) */
export function applyMerge(c: Chronicle, merged: Chapter[], text: string): Chronicle {
  const ids = new Set(merged.map((m) => m.id));
  return { ...c, earlier: text.replace(/\s+/g, " ").trim(), chapters: c.chapters.filter((ch) => !ids.has(ch.id)) };
}

/** The text for the prompt: the earlier paragraph, then chapters oldest→newest.
 *  If it is too long, the OLDEST chapters are left out of the prompt (they stay
 *  stored) — recent events matter most. Empty string when there is nothing. */
export function renderChronicle(c: Chronicle, maxChars = MAX_PROMPT_CHARS): string {
  const chapters = c.chapters.map((ch) => ch.text);
  let earlier = c.earlier ?? "";
  const size = () => earlier.length + chapters.reduce((n, t) => n + t.length + 1, 0);
  while (chapters.length > 1 && size() > maxChars) chapters.shift();
  if (size() > maxChars && earlier) earlier = "";
  return [earlier, ...chapters].filter(Boolean).join(" ").trim();
}

/** Tolerant parse of what was stored. */
export function parseChronicle(raw: unknown): Chronicle {
  if (!raw || typeof raw !== "object") return emptyChronicle();
  const o = raw as Partial<Chronicle>;
  const chapters = (Array.isArray(o.chapters) ? o.chapters : []).filter(
    (c): c is Chapter => !!c && typeof c.id === "string" && typeof c.text === "string" && typeof c.last_id === "string"
  );
  return {
    earlier: typeof o.earlier === "string" && o.earlier ? o.earlier : undefined,
    chapters,
    covered: typeof o.covered === "number" ? o.covered : 0,
    anchor_id: typeof o.anchor_id === "string" ? o.anchor_id : undefined,
    next: typeof o.next === "number" ? o.next : chapters.length + 1,
  };
}
