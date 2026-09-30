// The model half of the ledger. Runs only when the cheap gate in ledger.ts says
// the exchange may contain a deed, so it costs nothing on ordinary chatter.
// Never throws: on any failure the ledger is returned unchanged.

import type { LlmProvider } from "../providers";
import { splitOoc } from "../orchestrator/ooc";
import { isGrounded } from "./tracker";
import {
  addDeeds, deedMentioned, looksConsequential, markAnswered, mentionsOpenDeed, openDeeds, parseLedgerDelta,
  type Ledger,
} from "./ledger";

const SYSTEM = `You keep a ledger of consequential deeds in an ongoing roleplay.

A DEED is something the player character did that other characters or the world could reasonably answer later: a theft, a lie, a promise or vow, violence, a rescue, a betrayal, a secret told or discovered, a debt, a gift, damage, a crime. Conversation, walking, feelings, questions and small talk are NOT deeds.

You get the currently OPEN deeds (with ids) and the latest exchange. Return strict JSON only:
{"new":[{"deed":"<subject + action, under 12 words>","affects":[names],"witnesses":[names who saw it or know of it]}],"answered":[ids]}
- "new": only deeds the PLAYER CHARACTER performed in THIS exchange that are not already open. Use names, not pronouns.
- "answered": ids of OPEN deeds that the characters in this exchange visibly responded to or resolved (confronted, punished, forgave, repaid…).
- Empty arrays if none. Never invent.`;

export interface LedgerInput {
  ledger: Ledger;
  turn: number;
  userName: string;
  characterName: string;
  present: string[];
  userText?: string;
  replyText: string;
}

export class LedgerTracker {
  constructor(private provider: LlmProvider, private model: string) {}

  async update(input: LedgerInput): Promise<Ledger> {
    const spoken = input.userText ? splitOoc(input.userText).spoken : "";
    // The cheap gate: no consequential-looking verb, no call.
    if (input.replyText.trim().length < 20) return input.ledger;
    const open = openDeeds(input.ledger);
    const both = `${spoken}\n${input.replyText}`;
    if (!looksConsequential(spoken, input.replyText) && !mentionsOpenDeed(input.ledger, both)) return input.ledger;

    const exchange = `${spoken}\n${input.replyText}`;
    const prompt = `OPEN DEEDS:
${open.length ? open.map((d) => `${d.id}: ${d.text}`).join("\n") : "(none)"}

PRESENT: ${input.present.length ? input.present.join(", ") : "(unknown)"}

LATEST EXCHANGE
${input.userName} (the player): ${spoken || "(no dialogue)"}
${input.characterName}: ${input.replyText.trim()}

Return the JSON.`;
    try {
      const resp = await this.provider.chat({
        model: this.model,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.1,
      });
      const delta = parseLedgerDelta(resp.content);
      const openIds = new Set(open.map((d) => d.id));
      const known = new Set([...input.present, input.userName, input.characterName].map((n) => n.toLowerCase()));
      const okName = (n: string) => known.has(n.toLowerCase()) || isGrounded(n, exchange);
      // A deed must be about something actually said, and its people real.
      const fresh = delta.new
        .filter((n) => isGrounded(n.deed, exchange))
        .map((n) => ({ ...n, affects: (n.affects ?? []).filter(okName), witnesses: (n.witnesses ?? []).filter(okName) }));
      const byId = new Map(open.map((d) => [d.id, d]));
      // Only deeds the exchange actually talks about can be answered by it.
      const answeredIds = delta.answered.filter((id) => openIds.has(id) && deedMentioned(byId.get(id)!, exchange));
      let next = markAnswered(input.ledger, answeredIds, input.turn);
      next = addDeeds(next, fresh, input.turn);
      return next;
    } catch {
      return input.ledger;
    }
  }
}
