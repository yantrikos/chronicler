// The model half of the chronicle: write one chapter from a run of messages,
// and fold very old chapters together. Never throws — on any failure the caller
// keeps what it had and tries again later.

import { limit } from "../limits";
import type { LlmProvider } from "../providers";
import { narrateUserTurn } from "../vision/narrate";
import { isDirectiveOnly } from "../orchestrator/ooc";
import type { ChatTurn } from "../orchestrator/types";
import {
  MAX_EARLIER_CHARS, addChapter, applyMerge, mergeCandidates, nextChunk, renderChronicle, skipChunk, storyTurns,
  type Chronicle,
} from "./chronicle";

const CHAPTER_SYSTEM = `You write one short chapter of "the story so far" for a long-running roleplay, from a passage of the transcript.

Write 2-4 sentences, past tense, third person, plain prose. Preserve the concrete facts a later scene may need: what was said or promised, what was found or learned, decisions, injuries, gifts and loans, places gone to, people met or lost, and how relationships shifted. Use character NAMES, never pronouns like "he" or "she" for the first mention. Include names, objects and places exactly as given.

Do NOT invent anything that is not in the passage. Do NOT interpret feelings beyond what is stated. Do NOT quote dialogue unless a line is itself the important fact. Do NOT mention "the transcript", "the passage", or the fact that this is a summary. Output only the chapter.`;

const MERGE_SYSTEM = `You condense several consecutive chapters of "the story so far" into one shorter paragraph, in order.

Keep the facts a later scene may need: promises, discoveries, decisions, injuries, gifts and loans, places, people, and relationship changes — names and objects exactly as written. Drop scene-setting and repeated detail. Past tense, third person, plain prose. Do NOT add anything that is not in the chapters. Output only the paragraph, at most ${MAX_EARLIER_CHARS} characters.`;

export interface NameContext {
  userName: string;
  characterName: string;
}

/** A transcript line the model can read: who spoke, what they said. Steering
 *  directives never appear; a shared image appears as its description. */
export function transcriptLine(t: ChatTurn, names: NameContext): string | null {
  if (t.role === "user") {
    if (isDirectiveOnly(t.content) && !(t.attachments?.length)) return null;
    return `${names.userName}: ${narrateUserTurn(t)}`;
  }
  if (t.role === "assistant") return `${names.characterName}: ${t.content.trim()}`;
  return t.content.trim() ? `[narration] ${t.content.trim()}` : null;
}

export type WriteResult = { ok: true; text: string } | { ok: false; reason: "error" | "unusable" | "empty" };

/** A plain, model-free chapter: each line trimmed. Used only when the model
 *  keeps giving unusable output, so the chronicle never stalls and the facts in
 *  those messages are not lost. */
export function extractiveChapter(turns: ChatTurn[], names: NameContext): string {
  const clean = (s: string) => s.replace(/\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim();
  const parts = turns
    .map((t) => transcriptLine(t, names))
    .filter((l): l is string => !!l)
    .map((l) => {
      const i = l.indexOf(": ");
      const who = i > 0 ? l.slice(0, i) : "";
      const body = clean(i > 0 ? l.slice(i + 2) : l);
      return body ? `${who ? `${who}: ` : ""}${body.length > 110 ? body.slice(0, 110).replace(/\s+\S*$/, "") + "…" : body}` : "";
    })
    .filter(Boolean);
  return parts.join(" ");
}

export class ChapterWriter {
  constructor(private provider: LlmProvider, private model: string) {}

  /** One chapter from these messages. "error" means the model could not be
   *  reached (try later, write nothing); "unusable" means it answered with
   *  nothing worth keeping; "empty" means there was nothing to summarise. */
  async write(turns: ChatTurn[], names: NameContext, before?: string): Promise<WriteResult> {
    const lines = turns.map((t) => transcriptLine(t, names)).filter((l): l is string => !!l);
    if (lines.length === 0) return { ok: false, reason: "empty" };
    const prompt = `${before ? `THE STORY JUST BEFORE THIS PASSAGE (for names and continuity only — do not repeat it):\n${before}\n\n` : ""}PASSAGE:\n${lines.join("\n")}\n\nWrite the chapter.`;
    try {
      const resp = await this.provider.chat({
        model: this.model,
        system: CHAPTER_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        max_tokens: limit("bg.chronicle_chapter"),
        temperature: 0.2,
      });
      const chapter = cleanChapter(resp.content);
      const text = chapter && before ? dropRepeated(chapter, before) : chapter;
      return text ? { ok: true, text } : { ok: false, reason: "unusable" };
    } catch {
      return { ok: false, reason: "error" };
    }
  }

  async merge(texts: string[]): Promise<string | null> {
    if (texts.length === 0) return null;
    try {
      const resp = await this.provider.chat({
        model: this.model,
        system: MERGE_SYSTEM,
        messages: [{ role: "user", content: `CHAPTERS, oldest first:\n${texts.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nWrite the condensed paragraph.` }],
        max_tokens: limit("bg.chronicle_merge"),
        temperature: 0.2,
      });
      const out = cleanChapter(resp.content);
      return out && out.length > MAX_EARLIER_CHARS ? out.slice(0, MAX_EARLIER_CHARS).replace(/\s+\S*$/, "…") : out;
    } catch {
      return null;
    }
  }
}

// Lead-ins models add before the actual text: "Here's the chapter:", "Sure.",
// "Chapter 3:", "Summary:".
const LEAD_INS = [
  /^\s*(here(?:'s| is)|sure|certainly|okay|of course)[^:.\n]{0,60}[:.]\s*/i,
  /^\s*chapter\s*\d*\s*[:.\-–]\s*/i,
  /^\s*summary\s*[:.\-–]\s*/i,
];

const normSentence = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const sentencesOf = (t: string) => (t.match(/[^.!?]+[.!?]?/g) ?? []).map((x) => x.trim()).filter(Boolean);
const contentWords = (s: string) => new Set(normSentence(s).split(" ").filter((w) => w.length >= 4));

/** Share of distinctive words two sentences have in common (Jaccard). */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}
const REPEAT_OVERLAP = 0.5;
const MIN_WORDS_FOR_FUZZY = 5;

/** Small models re-tell earlier events when given "the story just before" for
 *  continuity — sometimes word for word, more often reworded. Drop any sentence
 *  that repeats one already in it (exactly, or by mostly sharing its distinctive
 *  words); null if nothing new is left (the caller retries without the context,
 *  then falls back to an extract). */
export function dropRepeated(chapter: string, before: string): string | null {
  const prior = sentencesOf(before).map((s) => ({ norm: normSentence(s), words: contentWords(s) })).filter((p) => p.norm.length > 12);
  const kept = sentencesOf(chapter).filter((s) => {
    const norm = normSentence(s);
    const words = contentWords(s);
    return !prior.some(
      (p) => p.norm === norm || (words.size >= MIN_WORDS_FOR_FUZZY && p.words.size >= MIN_WORDS_FOR_FUZZY && overlap(words, p.words) >= REPEAT_OVERLAP)
    );
  });
  const out = kept.join(" ").trim();
  return out.length >= 20 ? out : null;
}

/** Strip reasoning blocks, headings and chatter; reject empty or meta output. */
export function cleanChapter(raw: string): string | null {
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/\*\*|__|`/g, "").replace(/^#+\s.*$/gm, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) for (const re of LEAD_INS) t = t.replace(re, "");
  t = t.replace(/^[:\-–\s]+/, "").trim();
  if (t.length < 20) return null;
  return t;
}

/** Advance the chronicle by one step: write the next chapter if a chunk has
 *  left the window (and merge the oldest chapters if it has outgrown its
 *  budget). Never stalls on a bad answer:
 *    error    → returns null; nothing is written, try again later
 *    unusable → retry once without the story-so-far context (the usual trigger
 *               for a small model copying it), then fall back to an extract
 *    empty    → the chunk is only steering; coverage advances past it
 *  Returns the new chronicle, or null if there was nothing to do or to retry. */
export async function stepChronicle(
  c: Chronicle,
  turns: ChatTurn[],
  writer: ChapterWriter,
  names: NameContext
): Promise<Chronicle | null> {
  const chunk = nextChunk(turns, c);
  if (!chunk) return null;
  const story = storyTurns(chunk);
  const before = renderChronicle(c, 700) || undefined;
  let r = await writer.write(story, names, before);
  if (!r.ok && r.reason === "unusable" && before) r = await writer.write(story, names, undefined);
  let next: Chronicle;
  if (r.ok) next = addChapter(c, r.text, chunk);
  else if (r.reason === "error") return null;
  else if (r.reason === "empty") next = skipChunk(c, chunk);
  else next = addChapter(c, extractiveChapter(story, names), chunk, true);
  const m = mergeCandidates(next);
  if (m) {
    // Condense the existing "earlier" paragraph together with the chapters being
    // folded in, so the oldest facts are compressed rather than cut.
    const merged = await writer.merge([...(next.earlier ? [next.earlier] : []), ...m.map((x) => x.text)]);
    if (merged) next = applyMerge(next, m, merged);
  }
  return next;
}
