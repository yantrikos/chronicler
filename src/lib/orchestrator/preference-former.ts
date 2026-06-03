// PreferenceFormer — LLM verifier that turns raw character canon + scene
// memories into typed preference candidates. Sibling to SkillFormer and
// DriftFormer; same template (cheap input → LLM verifier biased to
// reject → substrate write).
//
// Three guarantees the verifier prompt enforces:
//
//   1. Identity labels (sub/dom/brat/masochist/etc) are NEVER produced.
//      The verifier extracts BEHAVIORS, not archetypes. "Adira likes
//      verbal teasing before touch" not "Adira is submissive."
//
//   2. Observations (literal quotes/actions) vs interpretations (inferred
//      patterns) are tracked separately. Interpretations need at least 2
//      observations of supporting evidence before the verifier promotes.
//
//   3. Sensitivity (ordinary / private / limit) is classified per-item.
//      Limits are EXTRACTED AGGRESSIVELY even from single-shot signals —
//      the cost asymmetry of missing a limit warrants high recall.
//
// Architecture: pull recent memories tagged with character_id, send to
// LLM with the prompt below, get structured JSON output, dedup against
// existing preferences in the substrate, write new candidates with
// pre_activation=true.

import type { LlmProvider } from "../providers";
import type { YantrikClient } from "../yantrikdb/client";
import type { RecallResult } from "../yantrikdb/client";
import type {
  InspectorPreference,
  InterpretationLevel,
  Polarity,
  Preference,
  PreferenceEvidence,
  Sensitivity,
} from "../preferences/types";
import {
  listPreferences,
  preferenceId,
  writePreference,
} from "../preferences/substrate";
import type { CharacterPrefSettings } from "../preferences/store";

const VERIFIER_SYSTEM = `You extract durable PREFERENCES about a roleplay character from recent scene memories. Return STRICT JSON only, no commentary.

THREE EXTRACTION CLASSES (you must pick one per item):
- "observation": A LITERAL fact from the text — what was said, what was done. Examples: "Adira asked Alex to slow down", "Alex told Adira he prefers being challenged". One source memory; no inference.
- "interpretation": A PATTERN inferred from MULTIPLE observations across the input. Examples: "Adira likes long verbal teasing before any touch" (inferred from her repeatedly delaying physical contact + stating preference for build-up). Requires ≥2 distinct supporting moments.
- "identity_label": DO NOT PRODUCE THESE. Forbidden category. Examples that would be identity labels: "submissive", "dominant", "brat", "switch", "praise kink", "masochist", "into noncon". The system rejects identity_label output entirely. Always describe BEHAVIOR ("Adira likes being verbally challenged before touch"), never identity ("Adira is submissive").

THREE SENSITIVITY CLASSES (classify each item):
- "ordinary": low-stakes — foods, hobbies, conversation style, broad emotional tendencies. "Alex prefers tea over coffee", "Adira responds to playful banter".
- "private": intimate — sexual / romantic preferences, body, escalation rhythm. "Adira likes setting the pace", "Alex enjoys verbal teasing before any physical contact". This is where most preferences from intimate scenes land.
- "limit": NEGATIVES, dislikes, hard boundaries. "Adira doesn't want to be rushed", "Alex disengaged when humiliation came up". Extract these AGGRESSIVELY even from single signals — missing a limit costs more than a false positive.

EXTRACTION RULES:
- Third-person, character-named: "Adira likes X" not "she likes X". Always name both parties when relevant.
- Behavior-specific, never identity-compressing.
- Polarity: "positive" for likes / preferences / habits, "negative" for dislikes / avoidances / limits.
- For interpretations, evidence_rids must list ≥2 distinct memory rids from the input that support the pattern. Hallucinated rids are dropped post-hoc.
- For observations, evidence_rids should be exactly one rid (the source).
- Be aggressive on observations (high recall — they're not surfaced raw).
- Be conservative on interpretations (require strong signal — they may land in prompts).
- Be aggressive on limits (high recall — safety asymmetry).
- If a candidate could be either ordinary or private (e.g. "likes slow conversations"), pick ordinary. Reserve private for clearly intimate-context items.
- Skip items already trivially derivable from the character's card (description, personality, scenario). Only extract NEW signal from scene content.

OUTPUT FORMAT (strict JSON):
{
  "items": [
    {
      "statement": "Adira likes long verbal teasing before any touch",
      "interpretation_level": "interpretation",
      "sensitivity": "private",
      "polarity": "positive",
      "evidence_rids": ["m12", "m18"],
      "why": "Asked for it explicitly in m12; delayed physical contact again in m18"
    }
  ]
}

Empty {"items":[]} is a valid response if nothing durable surfaced.`;

interface VerifierItem {
  statement: string;
  interpretation_level: InterpretationLevel;
  sensitivity: Sensitivity;
  polarity: Polarity;
  evidence_rids: string[];
  why?: string;
}

export interface PreferenceCandidate {
  character_id: string;
  character_name?: string;
  /** Recent memories to scan for preferences. Caller should provide a
   *  mix of character-namespace canon + recent session reflex tagged
   *  with this character_id. */
  recent_memories: RecallResult[];
  session_id: string;
}

export interface FormedPreference {
  rid: string;
  preference: Preference;
  /** True iff this is a brand-new preference. False = appended evidence
   *  to an existing preference. */
  is_new: boolean;
}

export class PreferenceFormer {
  /** Per-character cache of last-run verdicts so we don't re-prompt
   *  the LLM with identical inputs. Cleared by invalidate(). */
  private cache = new Map<string, VerifierItem[]>();

  constructor(
    private client: YantrikClient,
    private provider: LlmProvider,
    private model: string
  ) {}

  invalidate(character_id: string): void {
    this.cache.delete(character_id);
  }

  /** Pull verifier output for the candidate, dedup against existing
   *  substrate, write new prefs / append evidence to existing.
   *
   *  settings.auto_keep_ordinary controls whether new ordinary
   *  interpretations auto-activate (default true) vs land as candidate.
   *  Private + limit always start as candidate. */
  async formFromCandidate(
    cand: PreferenceCandidate,
    settings: CharacterPrefSettings
  ): Promise<FormedPreference[]> {
    if (cand.recent_memories.length < 2) return [];

    const items =
      this.cache.get(cand.character_id) ?? (await this.verify(cand));
    this.cache.set(cand.character_id, items);

    const existing = await listPreferences(this.client, cand.character_id);
    const existingById = new Map(existing.map((p) => [p.id, p]));
    const validRids = new Set(cand.recent_memories.map((m) => m.rid));

    const formed: FormedPreference[] = [];
    for (const item of items) {
      // Identity labels are forbidden — final guard in case the prompt
      // didn't catch it. Drop silently.
      if (item.interpretation_level === "identity_label") continue;
      if (!item.statement || item.statement.length < 20) continue;

      // Sanitize evidence rids — only keep ones actually in our input.
      const cleanRids = item.evidence_rids.filter((r) => validRids.has(r));
      // Interpretations need ≥2 supporting evidence; observations need 1.
      const minEvidence =
        item.interpretation_level === "interpretation" ? 2 : 1;
      if (cleanRids.length < minEvidence) continue;

      const id = preferenceId(cand.character_id, item.statement);
      const newEvidence: PreferenceEvidence[] = cleanRids.map((rid) => ({
        session_id: cand.session_id,
        rid,
        source: "scene",
        pre_activation: true,
        text_excerpt: cand.recent_memories
          .find((m) => m.rid === rid)
          ?.text?.slice(0, 200),
      }));

      const prior = existingById.get(id);
      if (prior) {
        // Already exists — append evidence (deduped by rid). Don't
        // change state on its own; the state machine handles promotion.
        const existingRids = new Set(prior.evidence.map((e) => e.rid));
        const fresh = newEvidence.filter((e) => !existingRids.has(e.rid));
        if (fresh.length === 0) continue; // nothing new
        const merged: Preference = {
          ...prior,
          evidence: [...prior.evidence, ...fresh],
          confidence: Math.min(1, prior.confidence + 0.1 * fresh.length),
        };
        await writePreference(this.client, merged);
        formed.push({ rid: prior.rid, preference: merged, is_new: false });
        continue;
      }

      // Brand-new preference. Activation depends on sensitivity + settings.
      const state = decideInitialState(
        item.sensitivity,
        item.interpretation_level,
        settings
      );
      const pref: Preference = {
        id,
        character_id: cand.character_id,
        scope: "global",
        interpretation_level: item.interpretation_level,
        sensitivity: item.sensitivity,
        polarity: item.polarity,
        statement: item.statement,
        evidence: newEvidence,
        state,
        confidence: 0.5 + 0.1 * Math.min(5, cleanRids.length),
        created_at: new Date().toISOString(),
      };
      const rid = await writePreference(this.client, pref);
      formed.push({ rid, preference: pref, is_new: true });
    }
    return formed;
  }

  private async verify(cand: PreferenceCandidate): Promise<VerifierItem[]> {
    // Cap at 12 memories: deepseek-r1 and other reasoning models will
    // analyze each input row in their internal chain-of-thought, and a
    // 30-row input can blow past any reasonable max_tokens budget before
    // the JSON answer gets written. 12 is a good signal/cost balance.
    // Take the LONGEST 12 — short reflex fragments ("Yeah.", "Oh fuck—")
    // carry no preference signal; the longer beats (full sentences, body
    // language paragraphs) are where the durable preferences live.
    const sorted = [...cand.recent_memories].sort(
      (a, b) => (b.text?.length ?? 0) - (a.text?.length ?? 0)
    );
    const memBlock = sorted
      .slice(0, 12)
      .map(
        (m, i) =>
          `  ${i + 1}. [${m.rid}] ${m.text.replace(/\s+/g, " ").trim().slice(0, 320)}`
      )
      .join("\n");
    const prompt = `CHARACTER: ${cand.character_name ?? cand.character_id}

Recent scene memories about ${cand.character_name ?? cand.character_id}:
${memBlock}

Extract preferences and respond with JSON immediately. Do NOT analyze memories one-by-one. Skim, identify 1-6 durable patterns, emit JSON. Never produce identity_label entries. Cite rids in evidence_rids. Empty {"items":[]} is fine if no durable signal stands out.`;
    try {
      const resp = await this.provider.chat({
        model: this.model,
        system: VERIFIER_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        // Reasoning models (deepseek-r1, gpt-5 thinking) emit a long
        // internal chain-of-thought before the JSON answer. 8000 gives
        // headroom even when the model wants to enumerate every input
        // memory. The lenient JSON parser will find the {...} block
        // wherever it lands (content field or reasoning field).
        max_tokens: 8000,
      });
      const parsed = parseStrictJson(resp.content);
      if (!parsed || !Array.isArray(parsed.items)) {
        console.warn(
          `[prefs/verifier] ${cand.character_name ?? cand.character_id}: ` +
            `no JSON items array in response. Raw response (first 500 chars):\n${resp.content.slice(0, 500)}`
        );
        return [];
      }
      const items = (parsed.items as unknown[])
        .map((raw) => normalizeItem(raw))
        .filter((x): x is VerifierItem => x !== null);
      if (items.length === 0) {
        console.warn(
          `[prefs/verifier] ${cand.character_name ?? cand.character_id}: ` +
            `${parsed.items.length} raw items returned but all filtered out. ` +
            `Raw items: ${JSON.stringify(parsed.items).slice(0, 500)}`
        );
      } else {
        console.log(
          `[prefs/verifier] ${cand.character_name ?? cand.character_id}: ${items.length} items survived normalization`
        );
      }
      return items;
    } catch (e) {
      console.warn(
        `[prefs/verifier] ${cand.character_name ?? cand.character_id}: chat call threw`,
        e
      );
      return [];
    }
  }
}

function decideInitialState(
  sensitivity: Sensitivity,
  level: InterpretationLevel,
  settings: CharacterPrefSettings
): "observed" | "candidate" | "active" {
  // Observations are evidence; they never appear in the inspector as
  // their own row — we use them through the interpretations they support.
  // Still write them as state=observed so the substrate has the raw
  // signal for future re-evaluation.
  if (level === "observation") return "observed";
  // Limits ALWAYS require one-click confirmation — even with
  // settings.auto_keep_ordinary=true and even with trust_private=true.
  // This is the safety floor; settings can't override it.
  if (sensitivity === "limit") return "candidate";
  // Private interpretations: candidate unless user explicitly opted in
  // via per-character `trust_private`.
  if (sensitivity === "private") {
    return settings.trust_private ? "active" : "candidate";
  }
  // Ordinary interpretations: active by default (settings can disable).
  if (sensitivity === "ordinary") {
    return settings.auto_keep_ordinary ? "active" : "candidate";
  }
  return "candidate";
}

const FORBIDDEN_IDENTITY_RE =
  /\b(?:is|are|am)\s+(?:a\s+)?(submissive|dominant|sub|dom|brat|switch|masochist|sadist|little|caregiver|daddy|mommy|alpha|omega|top|bottom)\b/i;

function normalizeItem(raw: unknown): VerifierItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const statement = typeof o.statement === "string" ? o.statement.trim() : "";
  if (!statement || statement.length < 20) return null;
  const interpretation_level =
    o.interpretation_level === "observation" ||
    o.interpretation_level === "interpretation" ||
    o.interpretation_level === "identity_label"
      ? (o.interpretation_level as InterpretationLevel)
      : "interpretation";
  // Hard guard: even if the verifier mis-labels, sniff the statement
  // text for forbidden identity patterns and drop. The verifier prompt
  // says "never produce identity_label" but belt + suspenders.
  if (
    interpretation_level === "identity_label" ||
    FORBIDDEN_IDENTITY_RE.test(statement)
  ) {
    return null;
  }
  const sensitivity =
    o.sensitivity === "ordinary" ||
    o.sensitivity === "private" ||
    o.sensitivity === "limit"
      ? (o.sensitivity as Sensitivity)
      : "ordinary";
  const polarity =
    o.polarity === "negative" ? "negative" : "positive";
  const evidence_rids = Array.isArray(o.evidence_rids)
    ? (o.evidence_rids as unknown[]).map((x) => String(x)).filter(Boolean)
    : [];
  return {
    statement,
    interpretation_level,
    sensitivity,
    polarity,
    evidence_rids,
    why: typeof o.why === "string" ? o.why : undefined,
  };
}

function parseStrictJson(text: string): Record<string, unknown> | null {
  // First try: the whole response is JSON (with optional markdown fence).
  const fenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
    return null;
  };
  const direct = tryParse(fenced);
  if (direct) return direct;
  // Second try: reasoning models (deepseek-r1, gpt-5 thinking, etc) often
  // emit prose/reasoning before/after the JSON. Scan for the LAST balanced
  // {...} object — the last one is usually the final answer (earlier ones
  // are quoted examples in the reasoning trace).
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
    const parsed = tryParse(candidates[i]);
    if (parsed && Array.isArray(parsed.items)) return parsed;
  }
  // Fall back to the last balanced object even without items[] — let the
  // caller decide.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const parsed = tryParse(candidates[i]);
    if (parsed) return parsed;
  }
  return null;
}

/** Apply a user disposition to an existing preference. Mostly delegates
 *  to substrate.updatePreferenceState; centralized here so the
 *  formation pipeline knows about state transitions for cache
 *  invalidation. */
export async function applyUserDisposition(
  client: YantrikClient,
  former: PreferenceFormer,
  pref: InspectorPreference,
  disposition: "kept" | "dismissed",
  character_id: string
): Promise<void> {
  const { updatePreferenceState } = await import("../preferences/substrate");
  const nextState = disposition === "kept" ? "active" : "dismissed";
  await updatePreferenceState(client, pref.rid, nextState, {
    confirmed: disposition === "kept",
  });
  former.invalidate(character_id);
}
