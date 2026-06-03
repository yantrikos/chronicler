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
You extract durable facts and observations from a two-turn roleplay exchange and classify them into three tiers. Return STRICT JSON only, no commentary.

TIERS:
- "canon": durable facts the USER explicitly asserts (out of roleplay frame): "Remember that I grew up in Tokyo", "My cat's name is Kiku". Also: facts a CHARACTER establishes about themselves IN SCENE that the user would expect to persist as backstory — e.g. if Adira says "my grandmother stitched this guitar case" or Ren says "I learned to read from my mother", those land in canon.
- "heuristic": (A) PREFERENCES, HABITS, AND PERSONAL HISTORY revealed in this exchange — what a character likes, dislikes, fears, owns, knows; what's happened to them; what they tend to do. Examples: "Adira loves sea-salt taffy from the harbor market", "Ren hums old shanties when nervous", "Adira lost her brother to the salt fevers three winters ago", "Alex prefers tea over coffee". (B) BEHAVIORAL PATTERNS observed in this exchange — even from a single scene if the pattern is clear: "Adira teases when she has the upper hand", "Ren deflects emotional questions with bookshop metaphors". Be GENEROUS with heuristic — it's reviewable in the inspector, the user can dismiss false positives. Empty heuristic on a substantive exchange is almost always wrong.
- "reflex": only the EPHEMERAL PRESENT STATE of this specific scene. Examples: "Adira is sitting on the seawall", "It is winter solstice night", "Ren is holding a cup of tea right now". Brief sensory descriptions of THIS moment.

IMPORTANT — intimate / erotic scenes are NOT exempt from heuristic extraction. The previous rule was "no erotic flourish in canon" — that rule still applies for canon (don't write "Alex loves X kink" into permanent canon from one scene) — but DO extract durable preferences and personal history revealed during intimate scenes into heuristic. Examples that SHOULD land in heuristic from an intimate scene: "Adira has wanted Alex since they first met in Port Llyr", "Alex responds to verbal challenges", "Adira likes to set the pace". Examples that should stay REFLEX: specific sensory descriptions of this moment ("her breath catches"), in-scene exclamations.

RULES:
- Third-person, character-named: "Adira lost her brother" not "she lost her brother". Use the character's name + the user's persona name if known.
- Never invent facts not in the exchange.
- Aggressive on heuristic; conservative on canon.
- If a tier truly has nothing, return [].
- Keep entries terse (under 180 chars each).

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
