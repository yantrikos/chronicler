// Turn a trait into a statement about what the character DOES on the page.
//
// Benchmark finding (docs/BENCHMARK-RUN-v3-2026-09-30.md): traits that ask the
// model to do a specific thing — apologize through an action, deflect with
// humor — were embodied far less than traits about manner of speech. A trait
// like "apologizes through actions, not words" describes a disposition; it does
// not say what to write. This module states the disposition as
// "when <kind of moment>, <name> <visible act or line>".
//
// It must not invent. Two checks, both failing closed: a structural one (one
// "When …" sentence, no new proper names) and a faithfulness check by the same
// small model ("does the rewrite state anything the trait does not?"). Word
// overlap was tried first and rejected faithful paraphrases ("scans the people
// before offering words" for "reads the room before she speaks"). Any failure
// returns null and the caller keeps the original trait.

import { limit } from "../limits";
import type { LlmProvider } from "../providers";

const SYSTEM = `You restate ONE character trait as what the character concretely DOES on the page.

Write exactly one sentence in the form: "When <the kind of moment that triggers it>, <Name> <the visible thing they do or say>."
- Prefer a visible act or a spoken line over a feeling or an attitude.
- Keep the trait's meaning. Add nothing the trait does not imply: no new backstory, places, objects or named people.
- If the trait is about how they speak, say what that sounds like in a line, not what it means.
- If the trait is only about manner and has no trigger, use "When they speak,".

Examples (different characters):
Trait: "Kestrel keeps his word even when it costs him."
{"enact":"When a promise he made comes due at a cost to himself, Kestrel does the promised thing anyway and says little about it."}
Trait: "Mirel goes quiet and precise when she is angry."
{"enact":"When she is angry, Mirel drops her voice and answers in short, exact sentences instead of raising it."}

Return STRICT JSON only: {"enact":"..."}`;

/** True when the rewrite introduces no capitalised word (other than the character's
 *  name and words already in the trait) after the first word of a sentence. Catches
 *  invented people and places cheaply; meaning is checked separately. */
export function noNewNames(trait: string, enact: string, name: string): boolean {
  const known = new Set([...trait.split(/[^A-Za-z']+/), ...name.split(/\s+/)].map((w) => w.toLowerCase()));
  const words = enact.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/[^A-Za-z']/g, "");
    if (/^[A-Z][a-z]{2,}$/.test(w) && !known.has(w.toLowerCase()) && !words[i - 1].endsWith(".")) return false;
  }
  return true;
}

const VERIFY_SYSTEM = `You check whether a rewritten sentence stays faithful to a character trait.
Answer adds=true if the rewrite states any specific fact, event, object, place, person, or motive that the trait does not state or clearly imply. Restating the trait as concrete visible behavior is fine and is NOT adding. A different wording of the same behavior is fine.
Return STRICT JSON only: {"adds": true} or {"adds": false}`;

/** Parse and validate a model reply. Returns the sentence or null. */
export function parseEnactment(raw: string, trait: string, name: string): string | null {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const o = JSON.parse(text.slice(a, b + 1)) as { enact?: unknown };
    if (typeof o.enact !== "string") return null;
    const s = o.enact.replace(/\s+/g, " ").trim();
    if (s.length < 20 || s.length > 260) return null;
    if (!/^when\b/i.test(s)) return null;
    if (/\n/.test(s) || (s.match(/[.!?](\s|$)/g) ?? []).length > 1) return null; // one sentence
    return noNewNames(trait, s, name) ? s.replace(/[.\s]+$/, "") + "." : null;
  } catch {
    return null;
  }
}

/** Ask the model whether the rewrite adds anything. Fails closed. */
async function isFaithful(provider: LlmProvider, model: string, trait: string, enact: string): Promise<boolean> {
  try {
    const resp = await provider.chat({
      model,
      system: VERIFY_SYSTEM,
      messages: [{ role: "user", content: `Trait: "${trait.trim()}"\nRewrite: "${enact}"\n\nReturn the JSON.` }],
      max_tokens: limit("bg.trait_check"),
      temperature: 0,
    });
    const text = resp.content.replace(/<think>[\s\S]*?<\/think>/gi, "");
    const m = text.match(/\{[^{}]*\}/);
    if (!m) return false;
    const o = JSON.parse(m[0]) as { adds?: unknown };
    return o.adds === false;
  } catch {
    return false;
  }
}

/** Restate one trait; null on any failure (caller keeps the original). */
export async function enactTrait(provider: LlmProvider, model: string, name: string, trait: string): Promise<string | null> {
  try {
    const resp = await provider.chat({
      model,
      system: SYSTEM,
      messages: [{ role: "user", content: `Name: ${name}\nTrait: "${trait.trim()}"\n\nReturn the JSON.` }],
      max_tokens: limit("bg.trait_enact"),
      temperature: 0,
    });
    const enact = parseEnactment(resp.content, trait, name);
    if (!enact) return null;
    return (await isFaithful(provider, model, trait, enact)) ? enact : null;
  } catch {
    return null;
  }
}

/** How a restatement is shown next to its trait in <character_identity>. This
 *  exact shape is what protocol v4 measured (docs/BENCHMARK-RUN-v4-2026-09-30.md). */
export function augmentTrait(trait: string, enact: string | undefined | null): string {
  return enact ? `${trait}\n    On the page: ${enact}` : trait;
}

/** The traits as the prompt should show them: each with its restatement when the
 *  cache has a non-empty one, otherwise unchanged. Pure. */
export function applyEnactments(traits: string[], cache: EnactmentCache): string[] {
  return traits.map((t) => augmentTrait(t, cache[traitKey(t)]));
}

/** Stable key for a trait's text (case/spacing-insensitive), so an edited trait
 *  gets a fresh restatement and an unchanged one keeps its own. */
export function traitKey(trait: string): string {
  const s = trait.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** A cache of restatements by traitKey. An empty string means "tried, rejected":
 *  it is not retried until the trait text changes, so a trait the checks keep
 *  rejecting costs one attempt, not one per turn. */
export type EnactmentCache = Record<string, string>;

/** Fill in any trait that has no cache entry. Never throws; returns a new cache
 *  (the same object's contents when nothing was missing). */
export async function ensureEnactments(
  provider: LlmProvider,
  model: string,
  name: string,
  traits: string[],
  cache: EnactmentCache,
  signal?: { cancelled: boolean }
): Promise<{ cache: EnactmentCache; added: number }> {
  const next: EnactmentCache = { ...cache };
  let added = 0;
  for (const t of traits) {
    if (signal?.cancelled) break;
    const k = traitKey(t);
    if (k in next) continue;
    const e = await enactTrait(provider, model, name, t);
    next[k] = e ?? "";
    added++;
  }
  return { cache: next, added };
}
