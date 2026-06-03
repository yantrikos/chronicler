// Relationship Drift detector — Phase 9 pillar 3.
//
// Dyadic successor to retired Phase 4 #24 (generic personality
// inference). Instead of abstract Big-Five-style trait axes, this
// detects shifts in how a character relates to a specific target —
// the user, another character, a faction. We constrain to four
// labeled axes (trust / defensiveness / openness / dependency) and
// require canon-grounded evidence for every signal.
//
// Architecture: same template as SkillFormer (pipeline.ts pattern).
// Cheap input (recent canon memories about the dyad), LLM verifier
// biased to reject, output written to the YantrikDB skill substrate
// as skill_type="pattern" with applies_to=["<character>", "<target>",
// "<axis>"]. Surfaces in the Character Development tab through the
// existing skill UI — no parallel system, no duplicate review queue.
//
// The LLM verifier carries TWO biases:
//   1. Default to "no_drift" — same anti-fossilization stance as
//      skills. False positives erode user trust faster than missed
//      real signals.
//   2. Reject signals with <2 distinct canon memories of evidence —
//      single-data-point "drift" is just one interaction.

import type { LlmProvider } from "../providers";
import type { YantrikClient } from "../yantrikdb/client";
import type { RecallResult } from "../yantrikdb/client";

export type DriftAxis =
  | "trust"
  | "defensiveness"
  | "openness"
  | "dependency";

export type DriftDirection = "up" | "down";

export interface DriftCandidate {
  /** Character whose relationship is shifting. */
  character_id: string;
  character_name?: string;
  /** Who the shift is toward — usually "user" for v1, but other
   *  characters / factions are supported. */
  target: string;
  target_label?: string;
  /** Recent canon memories about this character. The verifier reads
   *  them to look for a dyadic shift. Pre-filtered by caller (e.g.
   *  last N memories from character namespace). */
  recent_memories: RecallResult[];
}

export interface DriftVerdict {
  is_drift: boolean;
  axis: DriftAxis;
  direction: DriftDirection;
  body: string;
  confidence: "high" | "medium" | "low";
  evidence_rids: string[];
  why: string;
}

export interface FormedDrift {
  skill_id: string;
  character_id: string;
  target: string;
  axis: DriftAxis;
  direction: DriftDirection;
  body: string;
  evidence_rids: string[];
}

const VERIFIER_SYSTEM = `You determine whether a character's relationship with a target has SHIFTED based on canon evidence from recent roleplay scenes. Return STRICT JSON only, no prose.

The four axes you can detect (pick at most ONE):
- "trust": willingness to share private things, vulnerability, reliance on the other's word
- "defensiveness": guardedness, suspicion, withdrawal under stress
- "openness": readiness to engage with new ideas, emotional availability, curiosity about the other
- "dependency": needing the other's presence, opinion, or approval for decisions

Direction: "up" means MORE of that axis, "down" means LESS.

REJECT (return is_drift: false) if ANY of:
- Fewer than 2 distinct canon memories support the shift
- The "shift" reflects a single intense moment rather than a pattern across scenes
- The character's personality card already describes this as their baseline (it's not a SHIFT, just who they are)
- You are uncertain about direction — better to wait for more evidence
- The evidence is ambiguous about who the shift is toward

When accepting (is_drift: true):
- axis: pick the BEST-FIT of the four; if multiple apply, pick the strongest
- direction: "up" or "down"
- body: 60-300 chars describing the shift in plain language, using the character's name and the target. Specific, not vague.
- confidence: "high" if 3+ memories unmistakably point the same direction; "medium" if 2 clear memories; "low" if you accept but with caveats
- evidence_rids: array of memory rids from the input that support this — at least 2
- why: one short sentence explaining the pattern

OUTPUT FORMAT (exact keys, strict JSON):
{"is_drift":boolean,"axis":"trust|defensiveness|openness|dependency","direction":"up|down","body":"...","confidence":"high|medium|low","evidence_rids":["...","..."],"why":"..."}`;

export class DriftFormer {
  /** Cache by (character_id, target, axis) — we don't re-verify the same
   *  axis until the cache is invalidated externally (e.g. after another
   *  N turns). Keeps token cost bounded. */
  private cache = new Map<string, DriftVerdict>();

  constructor(
    private client: YantrikClient,
    private provider: LlmProvider,
    private model: string
  ) {}

  /** Verify each candidate. Returns confirmed drift signals (is_drift
   *  + confidence >= medium) and writes them to skill_substrate as
   *  pattern skills. The Character Development tab picks them up via
   *  the existing skill render path. */
  async formFromCandidates(
    candidates: DriftCandidate[]
  ): Promise<FormedDrift[]> {
    const formed: FormedDrift[] = [];
    for (const c of candidates) {
      // Need at least 2 memories of input — single-memory "drift" is
      // never durable enough to bother the verifier with.
      if (c.recent_memories.length < 2) continue;
      const cacheKey = `${c.character_id}::${c.target}`;
      const cached = this.cache.get(cacheKey);
      const verdict = cached ?? (await this.verify(c));
      this.cache.set(cacheKey, verdict);
      if (!verdict.is_drift || verdict.confidence === "low") continue;
      if (verdict.evidence_rids.length < 2) continue;
      const skill_id = buildDriftSkillId(
        c.character_id,
        c.target,
        verdict.axis,
        verdict.direction
      );
      try {
        await this.client.skillDefine({
          skill_id,
          body: verdict.body,
          skill_type: "pattern",
          applies_to: [
            slug(c.character_id),
            slug(c.target),
            verdict.axis,
            `direction_${verdict.direction}`,
          ],
        });
        formed.push({
          skill_id,
          character_id: c.character_id,
          target: c.target,
          axis: verdict.axis,
          direction: verdict.direction,
          body: verdict.body,
          evidence_rids: verdict.evidence_rids,
        });
      } catch {
        // non-fatal — substrate write failed; retry next cycle
      }
    }
    return formed;
  }

  /** Internal accessor for tests + the orchestrator's cache-invalidation
   *  hooks (e.g. after a retcon / delete that changes evidence). */
  invalidate(character_id: string, target: string): void {
    this.cache.delete(`${character_id}::${target}`);
  }

  private async verify(c: DriftCandidate): Promise<DriftVerdict> {
    const memBlock = c.recent_memories
      .slice(0, 20)
      .map(
        (m, i) =>
          `  ${i + 1}. [${m.rid}] ${m.text.replace(/\s+/g, " ").trim()}`
      )
      .join("\n");
    const prompt = `CHARACTER: ${c.character_name ?? c.character_id}
TARGET (who the relationship is toward): ${c.target_label ?? c.target}

Recent canon memories about ${c.character_name ?? c.character_id}:
${memBlock}

Classify any relationship drift toward ${c.target_label ?? c.target}. Default to is_drift: false on uncertainty. Cite at least 2 memory rids in evidence_rids when accepting.`;
    try {
      const resp = await this.provider.chat({
        model: this.model,
        system: VERIFIER_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 360,
      });
      const parsed = parseStrictJson(resp.content);
      if (!parsed) throw new Error("non-JSON verifier output");
      return normalize(parsed, c);
    } catch {
      return {
        is_drift: false,
        axis: "trust",
        direction: "up",
        body: "",
        confidence: "low",
        evidence_rids: [],
        why: "verifier error",
      };
    }
  }
}

function normalize(
  parsed: Record<string, unknown>,
  c: DriftCandidate
): DriftVerdict {
  const is_drift = parsed.is_drift === true;
  const axis = (
    ["trust", "defensiveness", "openness", "dependency"] as DriftAxis[]
  ).includes(parsed.axis as DriftAxis)
    ? (parsed.axis as DriftAxis)
    : "trust";
  const direction =
    parsed.direction === "up" || parsed.direction === "down"
      ? (parsed.direction as DriftDirection)
      : "up";
  const body =
    typeof parsed.body === "string" ? parsed.body.slice(0, 500).trim() : "";
  const confidence =
    parsed.confidence === "high" ||
    parsed.confidence === "medium" ||
    parsed.confidence === "low"
      ? (parsed.confidence as "high" | "medium" | "low")
      : "low";
  const why =
    typeof parsed.why === "string" ? parsed.why.slice(0, 240) : "(no reason)";
  // Restrict evidence rids to ones that were actually in the input — the
  // verifier sometimes hallucinates ids that look plausible.
  const presentRids = new Set(c.recent_memories.map((m) => m.rid));
  const evidence_rids = Array.isArray(parsed.evidence_rids)
    ? (parsed.evidence_rids as unknown[])
        .map((x) => String(x))
        .filter((id) => presentRids.has(id))
    : [];
  const finalIsDrift =
    is_drift &&
    body.length >= 30 &&
    evidence_rids.length >= 2 &&
    confidence !== "low";
  return {
    is_drift: finalIsDrift,
    axis,
    direction,
    body,
    confidence,
    evidence_rids,
    why,
  };
}

function buildDriftSkillId(
  character_id: string,
  target: string,
  axis: DriftAxis,
  direction: DriftDirection
): string {
  return `${slug(character_id)}.drift.${slug(target)}_${axis}_${direction}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
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
    /* ignore */
  }
  return null;
}
