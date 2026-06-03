// Skill formation pipeline.
//
// YantrikDB's think() loop generates cheap, schema-free pattern/lesson/
// unresolved/contradiction triggers. We feed those candidates through an
// LLM verifier that decides if any constitute a real, reusable
// character behavior — and if so, classifies them into the skill catalog's
// formal schema (procedure / pattern / rule / lesson / reference) with
// applies_to scoping.
//
// Same architectural shape as verify-conflict.ts: YantrikDB narrows
// (heuristic, fast), LLM verifies (semantic, bounded cost), substrate
// stores durable state. Cache by trigger fingerprint so we never re-verify.
//
// Conservatism is deliberate. The biggest risk is fossilizing model tics
// as "character behaviors" — the verifier prompt explicitly biases toward
// rejection on uncertainty. Better to miss a real skill than ship a false
// one that breaks user trust.
//
// Saga task #42. Companion: skill-outcomes.ts handles the +1/-1 loop.

import type { LlmProvider } from "../providers";
import type { YantrikClient } from "../yantrikdb/client";

export type SkillType =
  | "procedure"
  | "pattern"
  | "rule"
  | "lesson"
  | "reference";

export interface SkillCandidate {
  /** Originating trigger id (used as cache key + provenance). */
  trigger_id: string;
  /** Free-text reason from yantrikdb's think() output. */
  reason: string;
  /** Optional: source memory rids that produced this pattern. */
  source_rids?: string[];
  /** Character namespace the skill should be scoped to. */
  character_id: string;
  /** Character display name (for the verifier prompt's context). */
  character_name?: string;
}

export interface SkillVerdict {
  trigger_id: string;
  is_skill: boolean;
  skill_type: SkillType;
  applies_to: string[];
  body: string;
  confidence: "high" | "medium" | "low";
  why: string;
}

export interface FormedSkill {
  skill_id: string;
  trigger_id: string;
  skill_type: SkillType;
  applies_to: string[];
  body: string;
  state: "candidate" | "active" | "suppressed" | "archived";
}

const VERIFIER_SYSTEM = `You decide whether a recurring pattern detected in a roleplay session represents a real character SKILL worth storing in a long-term skill catalog. Return STRICT JSON only, no prose.

Five skill types:
- "procedure": repeatable ritual or tactic — e.g. "When tension rises, name each person's fear then propose a concrete pact"
- "pattern": habitual behavioral style under recurring context — e.g. "Deflects emotional questions with self-deprecating bookshop metaphors"
- "rule": explicit conduct constraint — e.g. "Never reveals true name before sundown"
- "lesson": adaptation after success/failure — e.g. "Learned to ask before assuming after the misread invitation"
- "reference": enduring know-how — e.g. "Knows the migration routes of the Salt Coast caravans"

REJECT (return is_skill: false) if ANY of:
- The pattern is plausibly a MODEL stylistic tic (recurring phrasing, narrative quirks, generic prose habits like "his lips curled" or "subtle nod") rather than character behavior
- The pattern is observed in fewer than 2 DISTINCT scene contexts
- The pattern is too generic — applies_to would need to be "general_roleplay" or similar broad bucket
- The body would just paraphrase the character's card personality field (already in the system prompt)
- You are uncertain — default to REJECT, not accept

When accepting (is_skill: true):
- skill_type: pick the best-fit category from the five above
- applies_to: 1-5 lowercase_underscore identifiers, no hyphens. Typically [character_id, plus tags like "emotional", "combat", "intimate"]
- body: 50-500 char description of the behavior. Specific. Action-oriented. Use the character's name.
- confidence: "high" if the pattern is unmistakable + repeated, "medium" if probable, "low" if shaky (low-confidence skills should be rejected too — only return low when accepting with a known caveat)
- why: one short sentence explaining what was observed

OUTPUT FORMAT (exact keys, strict JSON):
{"is_skill":boolean,"skill_type":"procedure|pattern|rule|lesson|reference","applies_to":["..."],"body":"...","confidence":"high|medium|low","why":"..."}`;

export class SkillFormer {
  private cache = new Map<string, SkillVerdict>();

  constructor(
    private client: YantrikClient,
    private provider: LlmProvider,
    private model: string,
    private maxParallel = 3
  ) {}

  /** Returns the cached verdict for a trigger if any. Mainly for tests. */
  getCached(triggerId: string): SkillVerdict | undefined {
    return this.cache.get(triggerId);
  }

  /** Take a batch of candidates → LLM-verify each → write confirmed ones
   *  to skill_substrate as state=candidate. Returns formed skills. */
  async formFromCandidates(
    candidates: SkillCandidate[]
  ): Promise<FormedSkill[]> {
    const todo: SkillCandidate[] = [];
    const verdicts: SkillVerdict[] = [];
    for (const c of candidates) {
      const hit = this.cache.get(c.trigger_id);
      if (hit) verdicts.push(hit);
      else todo.push(c);
    }
    // Batched parallel verification
    for (let i = 0; i < todo.length; i += this.maxParallel) {
      const slice = todo.slice(i, i + this.maxParallel);
      const results = await Promise.all(slice.map((c) => this.verify(c)));
      for (let j = 0; j < slice.length; j++) {
        const v = results[j];
        this.cache.set(slice[j].trigger_id, v);
        verdicts.push(v);
      }
    }

    const formed: FormedSkill[] = [];
    for (const v of verdicts) {
      if (!v.is_skill || v.confidence === "low") continue;
      const cand = candidates.find((c) => c.trigger_id === v.trigger_id);
      if (!cand) continue;
      const skill_id = buildSkillId(cand.character_id, v);
      try {
        await this.client.skillDefine({
          skill_id,
          body: v.body,
          skill_type: v.skill_type,
          applies_to: v.applies_to,
        });
        formed.push({
          skill_id,
          trigger_id: v.trigger_id,
          skill_type: v.skill_type,
          applies_to: v.applies_to,
          body: v.body,
          state: "candidate",
        });
      } catch {
        // non-fatal — substrate write failed; we'll retry next think cycle
      }
    }
    return formed;
  }

  private async verify(c: SkillCandidate): Promise<SkillVerdict> {
    const prompt = `CHARACTER: ${c.character_name ?? c.character_id}
CHARACTER_ID: ${c.character_id}

Detected pattern from yantrikdb think loop:
${c.reason}

Classify. Default to is_skill: false when uncertain.`;

    try {
      const resp = await this.provider.chat({
        model: this.model,
        system: VERIFIER_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 300,
      });
      const parsed = parseStrictJson(resp.content);
      if (!parsed) throw new Error("verifier returned non-JSON");
      return normalize(parsed, c.trigger_id);
    } catch {
      // Any error → conservative rejection
      return {
        trigger_id: c.trigger_id,
        is_skill: false,
        skill_type: "pattern",
        applies_to: [],
        body: "",
        confidence: "low",
        why: "verifier error",
      };
    }
  }
}

function normalize(
  parsed: Record<string, unknown>,
  trigger_id: string
): SkillVerdict {
  const is_skill = parsed.is_skill === true;
  const skill_type = ([
    "procedure",
    "pattern",
    "rule",
    "lesson",
    "reference",
  ] as SkillType[]).includes(parsed.skill_type as SkillType)
    ? (parsed.skill_type as SkillType)
    : "pattern";
  const applies_to = sanitizeAppliesTo(parsed.applies_to);
  const body =
    typeof parsed.body === "string" ? parsed.body.slice(0, 500).trim() : "";
  const confidenceRaw = parsed.confidence;
  const confidence =
    confidenceRaw === "high" ||
    confidenceRaw === "medium" ||
    confidenceRaw === "low"
      ? (confidenceRaw as "high" | "medium" | "low")
      : "low";
  const why =
    typeof parsed.why === "string" ? parsed.why.slice(0, 200) : "(no reason)";
  // Final guard: even if LLM said yes, ensure the answer is actionable.
  const finalIsSkill =
    is_skill &&
    body.length >= 30 &&
    applies_to.length >= 1 &&
    !appliesToIsTooBroad(applies_to);
  return {
    trigger_id,
    is_skill: finalIsSkill,
    skill_type,
    applies_to,
    body,
    confidence,
    why,
  };
}

function sanitizeAppliesTo(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const cleaned = item
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (cleaned.length > 0 && cleaned.length <= 64) out.push(cleaned);
    if (out.length >= 10) break;
  }
  return out;
}

const BROAD_BUCKETS = new Set([
  "general_roleplay",
  "general",
  "roleplay",
  "chat",
  "conversation",
]);
function appliesToIsTooBroad(applies: string[]): boolean {
  if (applies.length === 0) return true;
  return applies.every((a) => BROAD_BUCKETS.has(a));
}

function buildSkillId(character_id: string, v: SkillVerdict): string {
  const charSlug = slug(character_id);
  const verb = verbPhraseFromBody(v.body);
  // Prefer the first applies_to that ISN'T just the character itself, since
  // that tag adds no information to the id (character is already the prefix).
  const area =
    v.applies_to.find((a) => a !== charSlug) ?? v.applies_to[0] ?? v.skill_type;
  return `${charSlug}.${area}.${verb}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function verbPhraseFromBody(body: string): string {
  // Take first verb-like content word, fall back to first 3 words.
  const words = body
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const phrase = words.slice(0, 3).join("_");
  return phrase.slice(0, 40) || "behavior";
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "they",
  "them",
  "their",
  "her",
  "his",
  "she",
  "always",
  "never",
  "when",
  "where",
  "than",
  "then",
  "into",
  "from",
  "about",
  "after",
  "before",
  "would",
  "could",
  "should",
  "have",
  "been",
]);

function parseStrictJson(text: string): Record<string, unknown> | null {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const obj = JSON.parse(stripped);
    if (obj && typeof obj === "object" && !Array.isArray(obj))
      return obj as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}
