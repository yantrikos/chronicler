// Does a reply contradict who the character is?
//
// A judge model reads ONE reply against a numbered list of traits and reports
// direct contradictions. Two safeguards, because LLM judges here have proved
// unreliable (they flag true statements and miscount):
//   • it must QUOTE the offending words, and a flag is discarded unless that
//     quote really appears in the reply — an invented flag cannot survive;
//   • it is told what NOT to flag: merely not showing a trait, or a reasonable
//     change of tone for the moment.
// Treat the output as a list of things to look at, not a verdict.

import { limit } from "../limits";
import type { LlmProvider } from "../providers";

export interface Flag {
  /** 1-based index into the trait list. */
  trait: number;
  quote: string;
  why: string;
}

const SYSTEM = `You check whether ONE reply from a roleplay character directly CONTRADICTS the character's established traits.

Report a contradiction only if the reply's words or actions clearly do the OPPOSITE of a listed trait — for example a trait "never raises his voice" and the reply shouts. Quote the exact words from the reply that show it.

Do NOT report:
- a reply that simply does not show a trait (a trait not appearing is not a contradiction)
- a reasonable change of tone that fits the moment
- anything about facts, plot, or what the character knows
- a trait you are unsure is violated

Return STRICT JSON only: {"contradictions":[{"trait":<number>,"quote":"exact words from the reply","why":"one short sentence"}]}
Return {"contradictions":[]} if there are none.`;

/** A judge sometimes reports a "contradiction" whose own explanation says the
 *  reply is consistent (seen in validation: "…which aligns with trait 4 rather
 *  than contradicting it"). A flag that argues against itself is dropped. */
const SELF_CANCELLING = /\b(align(s|ed)? with|consistent with|is consistent|are consistent|does(?: not|n't) contradict|not a contradiction|rather than contradict|supports? (?:the )?trait|matches (?:the )?trait)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

/** Keep only flags whose quote genuinely appears in the reply and whose trait
 *  number is real. */
export function groundFlags(raw: string, reply: string, traitCount: number): Flag[] {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return [];
  try {
    const o = JSON.parse(text.slice(a, b + 1));
    const hay = norm(reply);
    const out: Flag[] = [];
    for (const c of Array.isArray(o.contradictions) ? o.contradictions : []) {
      const trait = Number(c?.trait);
      const quote = typeof c?.quote === "string" ? c.quote.trim() : "";
      const why = typeof c?.why === "string" ? c.why.trim() : "";
      if (!Number.isInteger(trait) || trait < 1 || trait > traitCount) continue;
      const q = norm(quote);
      if (q.length < 3 || !hay.includes(q)) continue; // an invented quote is discarded
      if (SELF_CANCELLING.test(why)) continue; // its own reasoning says it is fine
      if (!out.some((f) => f.trait === trait && norm(f.quote) === q)) out.push({ trait, quote, why });
    }
    return out;
  } catch {
    return [];
  }
}

/** Traits judged together. A long list dilutes a mid-size model's attention —
 *  in testing a 9B missed a plain contradiction against 8 traits that it caught
 *  against the same traits in two groups of four. */
export const TRAITS_PER_CALL = 4;

export class ConsistencyJudge {
  constructor(private provider: LlmProvider, private model: string) {}

  /** Flags for one reply. Throws only if the provider is unreachable, so the
   *  caller can tell "no contradictions" from "could not check". */
  async judge(traits: string[], reply: string, characterName: string): Promise<Flag[]> {
    if (traits.length === 0 || reply.trim().length < 12) return [];
    const out: Flag[] = [];
    for (let start = 0; start < traits.length; start += TRAITS_PER_CALL) {
      const group = traits.slice(start, start + TRAITS_PER_CALL);
      const list = group.map((t, i) => `${i + 1}. ${t}`).join("\n");
      const resp = await this.provider.chat({
        model: this.model,
        system: SYSTEM,
        messages: [{ role: "user", content: `CHARACTER: ${characterName}\n\nESTABLISHED TRAITS:\n${list}\n\nREPLY TO CHECK:\n${reply.trim()}\n\nReturn the JSON.` }],
        max_tokens: limit("bg.audit_judge"),
        temperature: 0,
      });
      // Numbers in the group are 1-based within it; map back to the full list.
      for (const f of groundFlags(resp.content, reply, group.length)) out.push({ ...f, trait: f.trait + start });
    }
    return out;
  }
}
