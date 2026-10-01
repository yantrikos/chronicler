// LLM-based fact extraction. Replaces the regex-based classifier.
//
// The regex version false-positives on everything ("I love this scene" →
// heuristic fact, "you are beautiful" → fact about character). In roleplay
// that pollutes canon fast. An LLM pass per turn is the only honest fix.
//
// Cost/latency: one extraction call per turn, fire-and-forget so it doesn't
// block the user's reply. On GPT-5.4-mini / Haiku 4.5 this is ~200-400ms
// and ~$0.001/turn.

import { limit } from "../limits";
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
  /** Who the user is playing as. LOAD-BEARING for attribution.
   *
   *  Without it the extractor knows exactly one named entity — the
   *  character — and attributes every fact to it. That is how a canon row
   *  reading "Ren's birthday is April 2nd" was written from a session
   *  where April 2nd was the USER's birthday and Ren merely repeated the
   *  date back in dialogue. See tests/extract-attribution.test.ts. */
  user_persona?: { name: string; description?: string };
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
    // Fall back to the turn's speaker, then a generic label. "the user" is
    // still a usable subject anchor — far better than the character's name,
    // which is what an unnamed user used to collapse into.
    const userName =
      input.user_persona?.name?.trim() ||
      input.user_turn?.speaker?.trim() ||
      "the user";
    const personaNote = input.user_persona?.description
      ? ` — ${input.user_persona.description}`
      : "";

    const system = `\
You extract durable facts and observations from a two-turn roleplay exchange and classify them into three tiers. Return STRICT JSON only, no commentary.

EXAMPLES BELOW USE THE PLACEHOLDERS <C> (a character) AND <U> (a user). They are ILLUSTRATIONS OF FORM ONLY. Never copy their content into your output, and never emit a literal "<C>" or "<U>". Only facts present in the exchange you are given may be extracted.
(This warning exists because earlier example text was written into permanent memory as if it were real: examples that named actual characters were copied out verbatim as invented backstory.)

TIERS:
- "canon": durable facts the USER explicitly asserts (out of roleplay frame): "Remember that I grew up in Tokyo", "My cat's name is Kiku". Also: facts a CHARACTER establishes about themselves IN SCENE that the user would expect to persist as backstory — e.g. if <C> says "my grandmother stitched this guitar case" or "I learned to read from my mother", those land in canon.
- "heuristic": (A) PREFERENCES, HABITS, AND PERSONAL HISTORY revealed in this exchange — what a character likes, dislikes, fears, owns, knows; what's happened to them; what they tend to do. Form: "<C> loves sea-salt taffy from the harbor market", "<C> hums old shanties when nervous", "<U> prefers tea over coffee". (B) BEHAVIORAL PATTERNS observed in this exchange — even from a single scene if the pattern is clear: "<C> teases when they have the upper hand", "<C> deflects emotional questions with bookshop metaphors". Be GENEROUS with heuristic — it's reviewable in the inspector, the user can dismiss false positives. Empty heuristic on a substantive exchange is almost always wrong.
- "reflex": only the EPHEMERAL PRESENT STATE of this specific scene. Form: "<C> is sitting on the seawall", "It is winter solstice night", "<C> is holding a cup of tea right now". Brief sensory descriptions of THIS moment.

NEVER invent backstory. Bereavement, illness, lost family, old wounds and similar dramatic history must appear IN THE EXCHANGE ITSELF to be extracted. If the exchange does not state it, it did not happen — no matter how well it would fit the character.

IMPORTANT — intimate / erotic scenes are NOT exempt from heuristic extraction. The previous rule was "no erotic flourish in canon" — that rule still applies for canon (don't write "<U> loves X kink" into permanent canon from one scene) — but DO extract durable preferences and personal history revealed during intimate scenes into heuristic. Forms that SHOULD land in heuristic from an intimate scene: "<C> has wanted <U> since they first met in Port Llyr", "<U> responds to verbal challenges", "<C> likes to set the pace". Things that should stay REFLEX: specific sensory descriptions of this moment ("their breath catches"), in-scene exclamations.

ATTRIBUTION — THE MOST IMPORTANT RULE. Getting this wrong corrupts memory permanently.

Every entry must name WHOSE fact it is. There are exactly two people in this exchange: the user (${userName}) and the character (${characterName}).

FIRST PERSON IS NEVER AMBIGUOUS — whoever said "my" or "I" is the subject. Extract these; do not skip them.
- "my birthday is April 2nd" in ${userName}'s turn  -> "${userName}'s birthday is April 2nd"
- "my uncle left me the shop" in ${characterName}'s reply -> "${characterName}'s uncle left ${characterName} the shop"

Then the rule that protects against the common failure:
- When ${characterName} REPEATS, confirms, or reacts to something ${userName} said, the fact still belongs to ${userName}. An echo is not a claim. ${characterName} saying "April 2nd" back does not give ${characterName} a birthday.
- Resolve every pronoun before writing. "my cat's name is Kiku" said by ${userName} becomes "${userName}'s cat is named Kiku" — never "my cat", never "${characterName}'s cat", never a claim with no subject.
- Only if you genuinely cannot tell who a fact belongs to, drop it. This is a last resort for real ambiguity, NOT a reason to skip clear first-person statements.

Worked example. ${userName} says "My birthday is April 2nd." ${characterName} replies "April 2nd. A Tuesday, that year."
  CORRECT  -> "${userName}'s birthday is April 2nd"              (extract it — first person, unambiguous)
  WRONG    -> "${characterName}'s birthday is April 2nd"        (echo mistaken for a claim)
  WRONG    -> "${characterName} and ${userName} share a birthday" (invented from an echo)
  WRONG    -> "birthday is April 2nd"                            (no subject at all)
  WRONG    -> extracting nothing                                 (the fact was clearly attributable)

RULES:
- Third-person, always named: "${characterName} lost her brother", "${userName} grew up in Oji". Never bare pronouns, never a subjectless claim.
- Never invent facts not in the exchange.
- Aggressive on heuristic; conservative on canon.
- If a tier truly has nothing, return [].
- Keep entries terse (under 180 chars each).

OUTPUT: {"canon":[...],"heuristic":[...],"reflex":[...]}`;

    const user = `CHARACTER (the one being roleplayed): ${characterName}
USER (the human, playing as): ${userName}${personaNote}

${userName}'s TURN: ${userText}

${characterName}'s REPLY: ${assistantText}

Extract now, attributing every fact to ${userName} or ${characterName} explicitly. Return JSON only.`;

    const resp = await this.provider.chat({
      model: this.model,
      system,
      messages: [{ role: "user", content: user }],
      temperature: 0,
      max_tokens: limit("bg.extract"),
    });

    return sanitizeExtraction(parseExtraction(resp.content));
  }
}

/** Structural post-filter. Does NOT depend on the model obeying the prompt.
 *
 *  Needed because prompt compliance degrades with model size, and Chronicler
 *  deliberately encourages a small, fast extraction model. Observed on
 *  qwen2.5:1.5b: the literal placeholder token was written into a durable
 *  memory — "<C> keeps a calendar on the wall". The 7b and 9b models never
 *  did this. A prompt rule cannot be the only defense for something that
 *  corrupts memory permanently.
 *
 *  Drops any entry that: leaks a template placeholder, has no resolved
 *  subject (bare first/second person), or is empty. Dropping is always safe
 *  here — an omitted fact costs a recall; a poisoned one costs trust. */
export function sanitizeExtraction(result: ExtractionResult): ExtractionResult {
  const PLACEHOLDER = /<\s*[CU]\s*>|\b(?:<C>|<U>)\b/;
  // "my cat is Kiku" / "I grew up in Oji" — never attributable once the
  // turn context is gone, which is exactly when they get recalled.
  const UNRESOLVED_SUBJECT = /^\s*(?:my|i|me|mine|our|we|us|your|you|yours)\b/i;

  const clean = (entries: string[]): string[] =>
    entries.filter((raw) => {
      const e = raw.trim();
      if (e.length === 0) return false;
      if (PLACEHOLDER.test(e)) return false;
      if (UNRESOLVED_SUBJECT.test(e)) return false;
      return true;
    });

  return {
    canon: clean(result.canon),
    heuristic: clean(result.heuristic),
    reflex: clean(result.reflex),
  };
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
