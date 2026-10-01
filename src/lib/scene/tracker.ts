// The model half of the scene board: after each exchange, ask a small, cheap
// call what changed. It only ever returns a delta, and the delta is folded in
// by applyDelta, so a bad answer degrades to "no change" rather than to a
// corrupted board.

import { limit } from "../limits";
import type { LlmProvider } from "../providers";
import { applyDelta, parseSceneDelta, renderSceneStatus, type SceneState } from "./state";
import { splitOoc } from "../orchestrator/ooc";

export interface TrackerInput {
  state: SceneState;
  userName: string;
  characterName: string;
  userText?: string;
  replyText: string;
}

const SYSTEM = `You maintain a compact status board for an ongoing roleplay scene.
You are given the CURRENT board and the latest exchange. Return ONLY what CHANGED, as strict JSON. No commentary.

Fields (all optional — omit anything that did not change):
- "location": short place name, e.g. "The Salt Page bookshop"
- "time": e.g. "late evening", "Tuesday morning"
- "mood": 2-4 words for the overall atmosphere
- "present": {"add":[names], "remove":[names]} — who is physically in the scene now
- "goals": {"add":[...], "remove":[...]} — current short-term objectives or quests actually stated in the text; remove ones completed or dropped
- "inventory": {"add":[...], "remove":[...]} — notable items the PLAYER character now carries, or has used up / given away

Rules:
- Only report what the exchange states or clearly implies. Never invent.
- Use names, never pronouns. Keep every value under 8 words.
- If nothing changed, return {}.`;

// Small models are far better at restating a whole board than at emitting
// precise add/remove operations (measured: scripts/scene-tracker-eval.ts), so
// "board" mode asks for the complete updated board and lets applyDelta treat
// each list as a replacement. "delta" mode is kept for strong models.
const SYSTEM_BOARD = `You maintain a compact status board for an ongoing roleplay scene.
You are given the CURRENT board and the latest exchange. Return the COMPLETE UPDATED board as strict JSON. No commentary.

Fields:
- "location": where the scene is happening NOW. If the text says anyone walked, went, travelled or arrived somewhere, the location IS that new place — never keep the old one.
- "time": e.g. "late evening", "Tuesday morning"
- "mood": 2-4 words for the overall atmosphere
- "present": array of names of everyone physically in the scene RIGHT NOW. Remove anyone who left.
- "goals": array of current short-term objectives actually stated in the text. Remove ones completed or dropped.
- "inventory": array of notable items the PLAYER character is carrying RIGHT NOW. Keep everything already carried unless the text clearly says it was handed over, dropped, lost or consumed.

Rules:
- Start from the CURRENT board; change only what the exchange shows changed. Copy everything else unchanged.
- Only what the exchange states or clearly implies. Never invent people, items or places.
- Use names, never pronouns. Keep every value under 8 words.`;

export type TrackerMode = "board" | "delta";

const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length >= 3);

// A model's say-so is not evidence that something left the scene: even a 35B
// model marked a key as "used up" when it was merely pocketed. So an entry may
// only be dropped from the board when a sentence that mentions it also says it
// went away.
const ITEM_GONE =
  /\b(hand(?:s|ed|ing)?|gives?|gave|giving|drop(?:s|ped|ping)?|lost|lose[sd]?|toss(?:es|ed)?|throws?|threw|burn(?:s|ed|t)?|consum\w*|eats?|ate|drinks?|drank|used up|sells?|sold|trad(?:e|es|ed)|discard\w*|breaks?|broke|smash\w*|returns?|returned|surrender\w*|passes|passed|slides?|slid|stole|steal\w*|took from|leaves? behind|left behind|pockets? it)\b/i;
const PERSON_GONE =
  /\b(leav(?:e|es|ing)|left|depart\w*|exit\w*|goes|went|walks? (?:off|away|out)|walked (?:off|away|out)|vanish\w*|disappear\w*|fades?|faded|slips? away|slipped away|hurr(?:y|ies|ied) off|runs? off|ran off|storm\w* out|retreat\w*|turns? and goes|heads? off)\b/i;

/** True when some sentence of `exchange` says `item` went away. For a person a
 *  pronoun sentence ("She tips her cap and walks off.") borrows the name from
 *  the sentence before — unless it names someone else on the board, in which
 *  case the verb belongs to them. */
export function hasRemovalEvidence(
  item: string,
  exchange: string,
  kind: "item" | "person",
  others: string[] = []
): boolean {
  const gone = kind === "item" ? ITEM_GONE : PERSON_GONE;
  const itemWords = wordsOf(item).filter((w) => !["the", "old", "her", "his"].includes(w));
  if (itemWords.length === 0) return false;
  const mentions = (text: string, words: string[]) => words.some((w) => text.includes(w));
  const otherWords = others.flatMap(wordsOf);
  // Action markup (*she nods.*) would glue sentences together and hide the
  // sentence boundary, so strip it first.
  const sentences = exchange.replace(/[*_~`]/g, " ").split(/(?<=[.!?…])\s+|\n+/);
  return sentences.some((sentence, i) => {
    if (!gone.test(sentence)) return false;
    const low = sentence.toLowerCase();
    if (mentions(low, itemWords)) return true;
    if (kind !== "person" || mentions(low, otherWords)) return false;
    // Pronoun sentence: look back a few sentences for who "she" is, giving up
    // as soon as someone else on the board is named.
    for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
      const prev = sentences[k].toLowerCase();
      if (mentions(prev, itemWords)) return true;
      if (mentions(prev, otherWords)) return false;
    }
    return false;
  });
}

/** In board mode a list comes back as a full replacement. Anything the model
 *  dropped silently stays unless the exchange shows it went away. */
export function restoreUnremoved(
  previous: string[],
  next: string[],
  exchange: string,
  kind: "item" | "person"
): string[] {
  const nextKeys = new Set(next.map((x) => x.toLowerCase()));
  const kept = previous.filter(
    (p) =>
      !nextKeys.has(p.toLowerCase()) &&
      !hasRemovalEvidence(p, exchange, kind, previous.filter((x) => x !== p))
  );
  return [...kept, ...next];
}

/** True when `item` is actually talked about in the exchange — at least one
 *  meaningful word of it appears in the text. Used to stop a model from
 *  adding people or objects that nobody mentioned. */
export function isGrounded(item: string, exchange: string): boolean {
  const hay = exchange.toLowerCase();
  const words = item.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length >= 3 && !["the", "and", "old", "her", "his"].includes(w));
  return words.length === 0 ? true : words.some((w) => hay.includes(w));
}

export class SceneTracker {
  constructor(
    private provider: LlmProvider,
    private model: string,
    private mode: TrackerMode = "board"
  ) {}

  /** Returns the updated board. Never throws: on any failure the board is
   *  returned unchanged. */
  async update(input: TrackerInput): Promise<SceneState> {
    if (input.replyText.trim().length < 20) return input.state;
    const board = renderSceneStatus(input.state);
    const spoken = input.userText ? splitOoc(input.userText).spoken : "";
    const exchange = `${spoken}\n${input.replyText}`;
    const prompt = `CURRENT BOARD:
${board.length ? board.join("\n") : "(empty)"}

LATEST EXCHANGE
${input.userName}: ${spoken || "(no dialogue)"}
${input.characterName}: ${input.replyText.trim()}

${this.mode === "board" ? "Return the complete updated board as JSON." : "Return the JSON of what changed."}`;
    try {
      const resp = await this.provider.chat({
        model: this.model,
        system: this.mode === "board" ? SYSTEM_BOARD : SYSTEM,
        messages: [{ role: "user", content: prompt }],
        max_tokens: limit("bg.scene_board"),
        temperature: 0.1,
      });
      const delta = parseSceneDelta(resp.content);
      if (this.mode === "board") {
        for (const [f, kind] of [["present", "person"], ["inventory", "item"]] as const) {
          const op = delta[f];
          if (Array.isArray(op)) delta[f] = restoreUnremoved(input.state[f], op, exchange, kind);
        }
      }
      // Never take a model's word for a new person or item: it must appear
      // in what was actually said.
      for (const f of ["present", "inventory", "goals"] as const) {
        const op = delta[f];
        if (!op) continue;
        const known = new Set(input.state[f].map((x) => x.toLowerCase()));
        const ok = (x: string) => known.has(x.toLowerCase()) || isGrounded(x, exchange);
        delta[f] = Array.isArray(op)
          ? op.filter(ok)
          : { add: (op.add ?? []).filter(ok), remove: op.remove };
      }
      return applyDelta(input.state, delta);
    } catch {
      return input.state;
    }
  }
}
