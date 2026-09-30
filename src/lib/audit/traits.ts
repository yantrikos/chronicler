// The traits a character is audited against.
//
// Drift from the character card is what players complain about most ("lobotomized
// zombies going off a checklist of quirks", personality flattening). So the audit
// compares replies to the character's DECLARED traits — extracted once from the
// card into short, checkable statements — plus any core traits the identity
// layer has crystallised. It therefore works even if the identity layer never
// fills, and the player can edit the list before auditing.

import type { LlmProvider } from "../providers";

const SYSTEM = `You turn a roleplay character's description into a short list of CHECKABLE behavioral traits — things a reply could clearly violate.

Write ONE statement for EACH distinct behavior or tendency the description gives — cover all of them, up to 8. Each is ONE short sentence about how the character speaks, behaves, or what they value or refuse ("Speaks in short, dry sentences", "Never raises his voice", "Goes quiet when cornered"). Each must be specific enough that you could point at a line and say it contradicts the trait.

Do NOT include backstory, facts, appearance, occupation or relationships. Do NOT include vague virtues ("is kind", "is smart"). Use only what the description supports; do not invent.
Return STRICT JSON only: {"traits":["...","..."]}`;

export async function extractDeclaredTraits(provider: LlmProvider, model: string, name: string, description: string): Promise<string[]> {
  if (description.trim().length < 20) return [];
  try {
    const resp = await provider.chat({
      model,
      system: SYSTEM,
      messages: [{ role: "user", content: `CHARACTER: ${name}\n\nDESCRIPTION:\n${description.slice(0, 2500)}\n\nReturn the JSON.` }],
      max_tokens: 300,
      temperature: 0.1,
    });
    return parseTraits(resp.content);
  } catch {
    return [];
  }
}

export function parseTraits(raw: string): string[] {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return [];
  try {
    const o = JSON.parse(text.slice(a, b + 1));
    const seen = new Set<string>();
    return (Array.isArray(o.traits) ? o.traits : [])
      .filter((t: unknown): t is string => typeof t === "string")
      .map((t: string) => t.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, ""))
      .filter((t: string) => t.length >= 8 && t.length <= 160 && !seen.has(t.toLowerCase()) && !!seen.add(t.toLowerCase()))
      .slice(0, 8);
  } catch {
    return [];
  }
}
