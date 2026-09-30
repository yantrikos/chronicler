// Core trait LLM verifier — Phase 11 Pillar 1.
//
// Quantitative criteria for active→core_trait promotion are necessary but
// not sufficient. A skill can hit the numerical bar (net ≥ 8 across ≥4
// sessions, ≥7 days active, success_rate ≥ 0.6) and still be a "situational
// pattern" rather than an "identity trait." This verifier draws that line.
//
// Architectural pattern: same shape as skill-former, drift-former,
// preference-former. Bias toward rejection on uncertainty — false-positive
// core traits fossilize incorrectly and require user retcon to remove.

import type { LlmProvider } from "../providers";

export interface CoreTraitCandidate {
  /** YantrikDB skill_id being considered for promotion. */
  skill_id: string;
  /** The skill body text — what behavior was observed. */
  body: string;
  /** Character display name (gives the verifier identity context). */
  character_name: string;
  /** Character id. */
  character_id: string;
  /** Already-crystallized core traits for this character. Used to detect
   *  redundancy ("this is already covered by trait X") + estimate the
   *  candidate's rank relative to existing traits. */
  existing_core_traits: Array<{ skill_id: string; body: string; rank: number }>;
  /** Snapshot of the quantitative evidence — included in the prompt so
   *  the verifier can weigh the strength of the case. */
  evidence: {
    total_net_score: number;
    reinforcement_count: number;
    distinct_sessions: number;
    days_active: number;
    success_rate: number;
  };
}

export interface CoreTraitVerdict {
  skill_id: string;
  /** True iff this should crystallize as a core trait. Defaults to false on
   *  any parse failure (bias-to-reject). */
  is_core_trait: boolean;
  /** Reasoning surfaced in the identity inspector. */
  reasoning: string;
  /** Rank estimate 0..1 — relative importance among existing core traits.
   *  Verifier's best guess; user can override in the inspector. */
  rank_estimate: number;
  /** "duplicate" when the candidate restates an existing trait. */
  duplicate_of?: string;
}

const VERIFIER_SYSTEM = `You decide whether an observed character behavior pattern has crystallized into a permanent IDENTITY TRAIT — part of WHO the character fundamentally IS — versus remaining a SITUATIONAL SKILL tied to a place, object, task or moment.

Return STRICT JSON only. No prose, no markdown fences.

A trait may be TRIGGERED by a KIND of situation — emotional pressure, being accused, being shown kindness, meeting someone new, being cornered, a failed plan, a decision — and still be an identity trait, because those kinds of situation recur across unrelated scenes and with unrelated people. The evidence below shows the pattern was observed across several DISTINCT sessions; weigh that.

WHAT QUALIFIES AS A CORE IDENTITY TRAIT:
- A way of handling emotion or vulnerability ("deflects emotional questions with humor", "goes silent when shown unexpected kindness")
- A default stance toward people ("guarded with strangers until they prove themselves", "tests new people with a teasing challenge")
- A decision-making or conflict style ("asks a question before committing to any serious decision", "answers accusations with dry understatement before laying out facts")
- A stable communication signature ("uses metaphor to talk about feelings", "narrates consequences bluntly")

WHAT DOES NOT QUALIFY:
- Tied to a specific place, object, time of day, task or role ("locks the shop at dusk", "tunes her guitar before the crowd arrives", "reviews a resume at the start of a rehearsal")
- A physical mannerism or stage business ("nods subtly", "lips curl", "takes a deep breath", "eyes narrow", "leans forward", "voice softens")
- An ordinary procedure or game mechanic ("rolls initiative when a fight begins")
- Something that only happens when one particular topic or keyword comes up ("asks merchants about the harvest")
- A capability or topical preference ("is good at negotiation", "likes coffee")
- Too vague to distinguish this character from any other ("is polite", "is kind")

RULES:
- Reject anything already covered by an existing core trait (set duplicate_of).
- Reject when the pattern is only a mannerism or only tied to one place/object/task, however strong the evidence.
- When the pattern clearly is a handling style, stance or signature that recurs across kinds of situations, ACCEPT it — do not reject merely because you could imagine some scene where it would not appear; almost any trait has such a scene.
- Prefer rejecting a vague trait to approving it broadly.

OUTPUT FORMAT:
{
  "is_core_trait": boolean,
  "reasoning": "Short paragraph (1-3 sentences) explaining the decision. Surfaced to user.",
  "rank_estimate": number,  // 0..1, relative importance vs existing traits
  "duplicate_of": "skill_id_string_or_null"  // only set when is_core_trait=false AND a duplicate
}`;

export class CoreTraitVerifier {
  /** Cache by skill_id so a repeat verification within the same session
   *  returns the prior verdict instantly. */
  private cache = new Map<string, CoreTraitVerdict>();

  constructor(
    private provider: LlmProvider,
    private model: string
  ) {}

  /** Flush the cache for one skill (e.g. after the user manually retcons
   *  the trait — next verification re-asks the LLM). */
  invalidate(skill_id: string): void {
    this.cache.delete(skill_id);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  async verify(cand: CoreTraitCandidate): Promise<CoreTraitVerdict> {
    const cached = this.cache.get(cand.skill_id);
    if (cached) return cached;

    const existingBlock =
      cand.existing_core_traits.length > 0
        ? cand.existing_core_traits
            .map(
              (t, i) =>
                `  ${i + 1}. [${t.skill_id}] (rank ${t.rank.toFixed(2)}) ${t.body}`
            )
            .join("\n")
        : "  (none yet)";

    const prompt = `CHARACTER: ${cand.character_name}

CANDIDATE TRAIT (under consideration for crystallization):
${cand.body}

QUANTITATIVE EVIDENCE:
- Total net score: ${cand.evidence.total_net_score}
- Reinforcement count: ${cand.evidence.reinforcement_count}
- Distinct sessions observed: ${cand.evidence.distinct_sessions}
- Days active: ${cand.evidence.days_active}
- Success rate: ${cand.evidence.success_rate.toFixed(2)}

EXISTING CORE TRAITS (already crystallized for ${cand.character_name}):
${existingBlock}

Decide: is this candidate a context-independent IDENTITY trait, or just a SITUATIONAL skill that should remain as state=active? Apply the rules in the system prompt. Bias to reject when uncertain.

Respond with strict JSON only.`;

    const verdict = await this.callAndParse(prompt, cand.skill_id);
    this.cache.set(cand.skill_id, verdict);
    return verdict;
  }

  private async callAndParse(
    prompt: string,
    skill_id: string
  ): Promise<CoreTraitVerdict> {
    const defaultReject: CoreTraitVerdict = {
      skill_id,
      is_core_trait: false,
      reasoning: "Verifier could not parse a decision; rejecting by default.",
      rank_estimate: 0,
    };
    try {
      const resp = await this.provider.chat({
        model: this.model,
        system: VERIFIER_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 4000,
      });
      const parsed = parseStrictJson(resp.content);
      if (!parsed || typeof parsed !== "object") return defaultReject;

      const o = parsed as Record<string, unknown>;
      const isCore = o.is_core_trait === true;
      const reasoning =
        typeof o.reasoning === "string" && o.reasoning.length > 0
          ? o.reasoning
          : "(no reasoning provided)";
      const rankRaw = typeof o.rank_estimate === "number" ? o.rank_estimate : 0;
      const rank = Math.max(0, Math.min(1, rankRaw));
      const duplicate =
        typeof o.duplicate_of === "string" && o.duplicate_of.length > 0
          ? o.duplicate_of
          : undefined;

      return {
        skill_id,
        is_core_trait: isCore,
        reasoning,
        rank_estimate: rank,
        duplicate_of: duplicate,
      };
    } catch {
      return defaultReject;
    }
  }
}

/** Lenient JSON extraction — reasoning models (deepseek-r1, gpt-5-thinking)
 *  may emit reasoning prose before the JSON. Walks the response and finds
 *  the LAST balanced {...} object, which is conventionally the answer
 *  (earlier ones are quoted examples in the reasoning trace). */
function parseStrictJson(text: string): Record<string, unknown> | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object" && !Array.isArray(v))
        return v as Record<string, unknown>;
    } catch {
      /* fall through */
    }
    return null;
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  // Scan for balanced {...} blocks; return the last one that's a non-array
  // object containing is_core_trait.
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const v = tryParse(candidates[i]);
    if (v && typeof v.is_core_trait !== "undefined") return v;
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const v = tryParse(candidates[i]);
    if (v) return v;
  }
  return null;
}
