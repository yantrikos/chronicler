// LLM-based contradiction verifier.
//
// YantrikDB's conflict detector is by design LLM-less — it flags pairs of
// memories sharing an entity with high word overlap as CANDIDATES. That's
// cheap and fast but noisy: "Ren is smirking" + "Ren holds a fork" share
// the entity "Ren" and some vocabulary, yet are obviously compatible.
//
// Chronicler's job is to run an LLM pass AFTER the YantrikDB loop to decide
// whether flagged candidates are real contradictions. The LLM sees only the
// narrowed candidate set, not the full memory base — that's what keeps the
// cost bounded. Verdicts are cached per conflict_id for the session.
//
// This pattern generalizes: YantrikDB narrows the search space with
// heuristics; the LLM applies semantic judgment on a bounded input. Same
// template would work for trigger classification, personality drift
// confirmation, procedural pattern validation, etc.

import type { LlmProvider } from "../providers";

export interface ConflictCandidate {
  id: string;
  a?: { rid: string; text: string };
  b?: { rid: string; text: string };
}

export type ConflictVerdict = "contradiction" | "compatible" | "partial";

export interface ConflictCheck {
  conflict_id: string;
  verdict: ConflictVerdict;
  confidence: "high" | "medium" | "low";
  explanation: string;
}

const SYSTEM = `You determine whether two memories from a roleplay scene CONTRADICT each other. Return STRICT JSON, no prose around it.

Three categories:
- "contradiction": they CANNOT BOTH be true at the same point in the scene. Examples: "the castle is standing" vs "the castle burned down"; "Ren is alive" vs "Ren died in chapter 3"; "User's name is Alice" vs "User's name is Bob".
- "compatible": they describe separate aspects of the same scene/character that can coexist. Examples: "Ren is smirking" + "Ren holds a fork"; "It is raining" + "Users carries a book".
- "partial": one refines, evolves, or softly modifies the other without outright negating. Examples: "User likes tea" + "User now prefers coffee in winter".

Only "contradiction" is actionable for user resolution. Prefer "compatible" when unsure.

OUTPUT FORMAT (exact keys, strict JSON):
{"verdict":"contradiction|compatible|partial","confidence":"high|medium|low","explanation":"<one short sentence>"}`;

export class ConflictVerifier {
  private cache = new Map<string, ConflictCheck>();

  constructor(
    private provider: LlmProvider,
    private model: string,
    private maxParallel = 4
  ) {}

  getCached(conflictId: string): ConflictCheck | undefined {
    return this.cache.get(conflictId);
  }

  /** Verify a batch of conflict candidates. Cached verdicts are skipped;
   *  network calls are bounded by maxParallel. Returns verdicts in input
   *  order, including cached hits. */
  async verifyBatch(
    candidates: ConflictCandidate[]
  ): Promise<ConflictCheck[]> {
    const out: ConflictCheck[] = new Array(candidates.length);
    const todo: Array<{ idx: number; c: ConflictCandidate }> = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const hit = this.cache.get(c.id);
      if (hit) {
        out[i] = hit;
      } else if (!c.a?.text || !c.b?.text) {
        // Can't verify without both texts — treat as compatible (safer
        // than asserting a contradiction we can't confirm).
        const fallback: ConflictCheck = {
          conflict_id: c.id,
          verdict: "compatible",
          confidence: "low",
          explanation: "Insufficient text to verify",
        };
        this.cache.set(c.id, fallback);
        out[i] = fallback;
      } else {
        todo.push({ idx: i, c });
      }
    }

    // Run pending checks in parallel batches of maxParallel.
    for (let i = 0; i < todo.length; i += this.maxParallel) {
      const slice = todo.slice(i, i + this.maxParallel);
      const results = await Promise.all(
        slice.map(({ c }) => this.checkOne(c))
      );
      for (let j = 0; j < slice.length; j++) {
        const res = results[j];
        this.cache.set(slice[j].c.id, res);
        out[slice[j].idx] = res;
      }
    }

    return out;
  }

  private async checkOne(c: ConflictCandidate): Promise<ConflictCheck> {
    const prompt = `MEMORY A: ${JSON.stringify(c.a?.text ?? "")}\nMEMORY B: ${JSON.stringify(
      c.b?.text ?? ""
    )}\n\nClassify.`;
    try {
      const resp = await this.provider.chat({
        model: this.model,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 120,
      });
      const parsed = parseStrictJson(resp.content);
      if (!parsed) throw new Error("non-JSON verifier response");
      const verdict =
        parsed.verdict === "contradiction" ||
        parsed.verdict === "compatible" ||
        parsed.verdict === "partial"
          ? (parsed.verdict as ConflictVerdict)
          : "compatible";
      const confidence =
        parsed.confidence === "high" ||
        parsed.confidence === "medium" ||
        parsed.confidence === "low"
          ? (parsed.confidence as "high" | "medium" | "low")
          : "low";
      const explanation =
        typeof parsed.explanation === "string"
          ? parsed.explanation
          : "(no explanation)";
      return {
        conflict_id: c.id,
        verdict,
        confidence,
        explanation,
      };
    } catch {
      // On any failure, default to compatible+low so we don't block the UI
      // on a noisy positive we can't verify.
      return {
        conflict_id: c.id,
        verdict: "compatible",
        confidence: "low",
        explanation: "verifier failed",
      };
    }
  }
}

function parseStrictJson(text: string): Record<string, unknown> | null {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const obj = JSON.parse(stripped);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}
