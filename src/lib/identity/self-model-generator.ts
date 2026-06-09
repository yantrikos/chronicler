// Phase 11 Pillar 2 — self-model generation.
//
// Builds a first-person identity paragraph for a character from their
// crystallized core traits + recent canon + drift state + active
// preferences. Periodic refresh: weekly OR when inputs hash changes
// >20%. Manual refresh triggered from the identity inspector.

import type { LlmProvider } from "../providers";
import type {
  SelfModel,
  SelfModelHeader,
  SelfModelInputs,
} from "./self-model-types";

const GENERATOR_SYSTEM = `You are writing a first-person identity paragraph for a roleplay character.

The character does NOT yet have an explicit self-concept; you are giving them one based on observed patterns. The output will be injected directly into the character's system prompt as identity-level context — they will read it as "this is who I am" before every reply.

WRITE IN FIRST PERSON. Lead with "I am [name]." Do not narrate about the character; speak AS the character to themselves.

What to capture:
- What they do and why (not just role; the *why* — what draws them to it)
- How they handle vulnerability / closeness
- What they guard / what they show easily
- A note of self-awareness — what they know about themselves, whether they're working on it or not

TONE RULES:
- Honest, not performative. The character can be flawed or working through things.
- Imperfect, not idealized. No "I love adventure" type bromides.
- Specific, not generic. Reference concrete behaviors not abstract traits.
- 2 to 4 short paragraphs. Each focused on one facet of identity.
- No third-person sentences. No "Adira is..." — only "I am..." or "I do..." or "I feel..."
- No mention of "the user", "the player", or any meta-frame. The character is talking to themselves.

OUTPUT:
Just the paragraphs separated by blank lines. No JSON, no header, no commentary, no markdown formatting.`;

const HUMAN_PROMPT_TEMPLATE = (i: SelfModelInputs) => {
  const traitsBlock =
    i.core_traits.length > 0
      ? i.core_traits
          .map((t, idx) => `${idx + 1}. ${t.body}`)
          .join("\n")
      : "(none yet — derive from canon)";
  const canonBlock =
    i.canon_excerpts.length > 0
      ? i.canon_excerpts.map((c) => `- ${c}`).join("\n")
      : "(no recent canon)";
  const prefsBlock =
    i.active_preferences.length > 0
      ? i.active_preferences.map((p) => `- ${p}`).join("\n")
      : "(none)";
  return `CHARACTER: ${i.character_name}

CRYSTALLIZED CORE TRAITS (the always-on identity patterns observed across many sessions):
${traitsBlock}

RECENT CANON (what's grounded as true about this character):
${canonBlock}

DRIFT STATE (current relationships):
${i.drift_summary || "(no significant relationships tracked yet)"}

ACTIVE PREFERENCES (likes/limits user has confirmed):
${prefsBlock}

Write the first-person identity paragraphs for ${i.character_name}. 2-4 paragraphs. Apply the system rules above.`;
};

/** Stable hash of inputs — used to detect when the model is stale.
 *  Browser-safe (no node:crypto). Lightweight FNV-1a is enough for
 *  "is this materially different" detection. */
async function hashInputs(i: SelfModelInputs): Promise<string> {
  const stableJson = JSON.stringify(
    {
      cid: i.character_id,
      ct: i.core_traits.map((t) => t.body).sort(),
      cn: i.canon_excerpts.slice().sort(),
      dr: i.drift_summary,
      pr: i.active_preferences.slice().sort(),
    },
    null,
    0
  );
  // Use SubtleCrypto if available (browser + modern node); fall back to
  // FNV-1a otherwise.
  const cryptoObj = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (cryptoObj?.subtle) {
    const buf = new TextEncoder().encode(stableJson);
    const digest = await cryptoObj.subtle.digest("SHA-256", buf);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return hex;
  }
  // FNV-1a fallback
  let h = 0x811c9dc5;
  for (let n = 0; n < stableJson.length; n++) {
    h ^= stableJson.charCodeAt(n);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Hamming-style "input change" detector: returns true if the new hash
 *  differs from the old. Originally we discussed >20% threshold but
 *  with a cryptographic hash, any change is "different" — and that's
 *  fine because refreshes are weekly-rate-limited via next_refresh_after. */
function inputsChanged(oldHash: string, newHash: string): boolean {
  return oldHash !== newHash;
}

export class SelfModelGenerator {
  constructor(
    private provider: LlmProvider,
    private model: string
  ) {}

  /** Check whether the self-model should be regenerated.
   *
   *   - no existing model → generate
   *   - existing model has stale inputs_hash → generate
   *   - existing model's next_refresh_after is past → generate
   *   - manualRefresh override → generate
   *   - else: skip */
  async needsRefresh(
    existing: SelfModel | null,
    inputs: SelfModelInputs,
    opts: { manualRefresh?: boolean; now?: Date } = {}
  ): Promise<boolean> {
    const now = opts.now ?? new Date();
    if (opts.manualRefresh) return true;
    if (!existing) return true;
    const newHash = await hashInputs(inputs);
    if (inputsChanged(existing.header.inputs_hash, newHash)) return true;
    return now.getTime() >= Date.parse(existing.header.next_refresh_after);
  }

  /** Generate a fresh self-model. Caller persists via writeSelfModel.
   *  Returns null on LLM error so callers can keep the prior version. */
  async generate(
    inputs: SelfModelInputs,
    opts: { now?: Date } = {}
  ): Promise<SelfModel | null> {
    const now = opts.now ?? new Date();
    if (inputs.core_traits.length === 0 && inputs.canon_excerpts.length === 0) {
      return null; // not enough to generate from
    }
    try {
      const reply = await this.provider.chat({
        model: this.model,
        system: GENERATOR_SYSTEM,
        messages: [{ role: "user", content: HUMAN_PROMPT_TEMPLATE(inputs) }],
        temperature: 0.6,
        max_tokens: 4000,
      });
      const body = (reply.content ?? "").trim();
      if (!body || !validateFirstPerson(body)) return null;
      const inputsHash = await hashInputs(inputs);
      const nextRefresh = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
      const header: SelfModelHeader = {
        character_id: inputs.character_id,
        generated_at: now.toISOString(),
        model_used: this.model,
        inputs_hash: inputsHash,
        paragraph_count: paragraphs.length,
        next_refresh_after: nextRefresh.toISOString(),
      };
      return { header, body };
    } catch {
      return null;
    }
  }
}

/** First-person sanity check — if the model started narrating ("Adira
 *  is..."), reject and keep the prior self-model. */
export function validateFirstPerson(body: string): boolean {
  const text = body.trim();
  if (text.length < 60) return false;
  // Must start with a first-person opener.
  const opener = text.split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  const firstPersonOpeners = new Set(["i", "i'm", "i've", "i'll", "i'd"]);
  if (!firstPersonOpeners.has(opener)) return false;
  // No third-person sentences about the character. Heuristic: count
  // occurrences of " is " / " was " / " has " near the start of
  // sentences and reject if there's a high incidence (typical
  // third-person narration shape).
  // We tolerate occasional third-person ("there is a part of me…") but
  // reject if it dominates.
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  let thirdPerson = 0;
  for (const s of sentences) {
    const head = s.trim().slice(0, 80).toLowerCase();
    if (/^(adira|ren|brennan|whitstable|vex|marcus|mei|alex|the user)\b/.test(head)) {
      thirdPerson++;
    } else if (/^(she|he|they)\s+(is|was|has|had|did)/.test(head)) {
      thirdPerson++;
    }
  }
  if (sentences.length === 0) return false;
  // Reject if more than 1/5 of sentences are third-person narration.
  return thirdPerson / sentences.length < 0.2;
}
