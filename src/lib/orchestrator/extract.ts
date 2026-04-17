// LLM-based fact extraction. Replaces the regex-based classifier.
//
// The regex version false-positives on everything ("I love this scene" →
// heuristic fact, "you are beautiful" → fact about character). In roleplay
// that pollutes canon fast. An LLM pass per turn is the only honest fix.
//
// Cost/latency: one extraction call per turn, fire-and-forget so it doesn't
// block the user's reply. On GPT-5.4-mini / Haiku 4.5 this is ~200-400ms
// and ~$0.001/turn.

import type { LlmProvider } from "../providers";
import type { Character, ChatTurn } from "./types";

export interface ExtractionResult {
  canon: string[];
  heuristic: string[];
  reflex: string[];
}

export interface Extractor {
  name: string;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

export interface ExtractionInput {
  character: Character;
  user_turn?: ChatTurn;
  assistant_turn?: ChatTurn;
}

// --- Deterministic extractor for tests (same as old regex behavior) ---

export class RegexExtractor implements Extractor {
  name = "regex";
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const canon: string[] = [];
    const heuristic: string[] = [];
    const reflex: string[] = [];

    const CANON_PATTERNS = [
      /\bremember\s+(?:that|this)\s+(.+)/i,
      /\blet'?s?\s+say\s+(.+)/i,
      /\bit'?s?\s+canon\s+that\s+(.+)/i,
      /\bfor\s+the\s+record[,:]\s+(.+)/i,
    ];

    if (input.user_turn) {
      for (const p of CANON_PATTERNS) {
        const m = input.user_turn.content.match(p);
        if (m && m[1]) canon.push(m[1].trim());
      }
    }

    for (const turn of [input.user_turn, input.assistant_turn]) {
      if (!turn) continue;
      const re = /\*([^*]{4,160})\*/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(turn.content)) !== null) {
        reflex.push(match[1].trim());
      }
    }

    return { canon, heuristic, reflex };
  }
}

// --- LLM-based extractor ---

export class LlmExtractor implements Extractor {
  name = "llm";
  constructor(
    private provider: LlmProvider,
    private model: string
  ) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const userText = input.user_turn?.content ?? "";
    const assistantText = input.assistant_turn?.content ?? "";
    const characterName = input.character.name;

    const system = `\
You extract durable facts from a two-turn roleplay exchange and classify them into three tiers. Return STRICT JSON only, no commentary.

TIERS:
- "canon": facts the USER asserts about themselves, the real world, or commits explicitly. Examples: "My cat's name is Kiku", "Remember that I grew up in Tokyo", "My birthday is in April". Character's in-fiction actions (walking, picking up items, saying dialogue) are NOT canon. In-character declarations ("I love you") are NOT canon unless out-of-roleplay frame is clear.
- "heuristic": inferences about the user's preferences or the character's patterns that could be wrong. Examples: "User seems to prefer slow-burn scenes", "Ren tends to deflect emotional questions with humor", "The two have a growing rivalry".
- "reflex": transient scene state that's only true RIGHT NOW. Examples: "Ren is holding a cup of tea", "They are in the bookshop", "It is raining", "Ren is annoyed".

RULES:
- Never classify sarcasm, metaphor, erotic flourish, or in-fiction exaggeration as canon.
- Never invent facts not in the exchange.
- If nothing fits a tier, return [].
- Keep entries terse (under 140 chars each).

OUTPUT: {"canon":[...],"heuristic":[...],"reflex":[...]}`;

    const user = `CHARACTER: ${characterName}

USER TURN: ${userText}

${characterName}'s REPLY: ${assistantText}

Extract now. Return JSON only.`;

    const resp = await this.provider.chat({
      model: this.model,
      system,
      messages: [{ role: "user", content: user }],
      temperature: 0,
      max_tokens: 600,
    });

    return parseExtraction(resp.content);
  }
}

/** Hybrid: use regex for cheap, reliable signals (asterisk narration, explicit
 *  "remember that") AND LLM for heuristic nuance. Merges both results. */
export class HybridExtractor implements Extractor {
  name = "hybrid";
  private regex = new RegexExtractor();
  constructor(private llm: LlmExtractor) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const [regex, llm] = await Promise.all([
      this.regex.extract(input),
      this.llm.extract(input).catch(() => ({
        canon: [],
        heuristic: [],
        reflex: [],
      })),
    ]);
    return {
      canon: dedupe([...regex.canon, ...llm.canon]),
      heuristic: dedupe([...regex.heuristic, ...llm.heuristic]),
      reflex: dedupe([...regex.reflex, ...llm.reflex]),
    };
  }
}

export function parseExtraction(text: string): ExtractionResult {
  // Strip code fences if the model added them.
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const obj = JSON.parse(stripped);
    return {
      canon: sanitize(obj.canon),
      heuristic: sanitize(obj.heuristic),
      reflex: sanitize(obj.reflex),
    };
  } catch {
    // Model produced something that isn't strict JSON — take nothing rather
    // than guess. Polluting memory with garbled output is worse than silence.
    return { canon: [], heuristic: [], reflex: [] };
  }
}

function sanitize(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((s) => s.length > 0 && s.length <= 240);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    const k = i.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  return out;
}
