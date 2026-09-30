// The consequence ledger — the world remembers what the player did.
//
// Models answer the moment in front of them. If the player steals the keeper's
// ledger while a witness watches, three turns later the witness has usually
// forgotten, and nothing ever comes of it. Players ask for exactly this
// ("I want the people who were in the office to still be there and react").
//
// A "deed" is something the player character did that others could reasonably
// answer later: a theft, a lie, a promise, violence, a rescue, a secret told or
// found, a debt, damage. Deeds are recorded cheaply, held for a few turns so
// the world doesn't react instantly and mechanically, then handed to the model
// as open consequences it may let land — and marked answered once they do.
//
// This file is the deterministic half: when to look, how the ledger changes,
// and what is due. The model half is ledger-tracker.ts.

export type DeedStatus = "open" | "answered" | "dismissed";

export interface Deed {
  id: string;
  /** Subject + action, e.g. "Sam took the keeper's ledger". */
  text: string;
  /** Turn number when it happened. */
  turn: number;
  affects: string[];
  witnesses: string[];
  status: DeedStatus;
  /** Last turn this was put in front of the model. */
  nudged?: number;
  answered_turn?: number;
}

export interface Ledger {
  deeds: Deed[];
  next: number;
}

export interface NewDeed {
  deed: string;
  affects?: string[];
  witnesses?: string[];
}

export const MAX_OPEN = 6;
/** Turns to let a deed sit before the world may answer it. */
export const MIN_AGE = 3;
/** Turns before the same deed is put to the model again. */
export const RENUDGE_AFTER = 5;
/** At most this many deeds surface in one prompt. */
export const MAX_SHOWN = 2;

export function emptyLedger(): Ledger {
  return { deeds: [], next: 1 };
}

export const openDeeds = (l: Ledger) => l.deeds.filter((d) => d.status === "open");

// Cheap gate: only spend a model call when the exchange plausibly contains a
// deed. Deliberately broad on verbs, because the model decides for real; the
// gate only exists so ordinary chatter costs nothing.
const GATE =
  /\b(stole|stolen|steal\w*|slip(?:s|ped|ping)?|pocket\w*|grab\w*|snatch\w*|swip\w*|filch\w*|lift(?:s|ed)?|borrow\w*|took|tak(?:e|es|en|ing)(?! (?:a (?:seat|look|moment|breath|deep|step|sip|bite|walk|nap|minute|second|while|second)|another|care|your time|it easy|me|us|you|him|her|them|the lead|off your))|lie[sd]?|lying|lied|promis\w+|swear|swore|sworn|kill\w*|murder\w*|attack\w*|stab\w*|shoot|shot|punch\w*|slap\w*|strike|struck|hurt|wound\w*|injur\w*|break|broke|smash\w*|burn\w*|destroy\w*|betray\w*|sav(?:e|ed|es|ing)|rescu\w*|kiss\w*|confess\w*|confront\w*|admit\w*|apolog\w*|sorry|threat\w*|blackmail\w*|brib\w*|owe[sd]?|debt|forgiv\w*|reveal\w*|secret|spar(?:e|ed)|abandon\w*|refus\w*|trespass\w*|hid(?:e|den)?|sneak\w*|snuck|pick(?:s|ed)? (?:the |a )?lock|read (?:the |his |her )?(?:letter|diary|journal)|hand(?:s|ed)? (?:her|him|them|over|back)|put (?:it |them )?back|give back|gave back|return\w*|restor\w*|gift\w*|forge[sd]?|bargain\w*|deal|vow\w*|curse[sd]?|poison\w*|free[sd]?|releas\w*|arrest\w*|expos\w*|accus\w*)\b/i;

export function looksConsequential(spoken: string, reply: string): boolean {
  return GATE.test(spoken) || GATE.test(reply);
}

/** True when the exchange talks about something already on the ledger — it
 *  shares a distinctive word with an open deed ("ledger", "lantern"). That is
 *  when a deed is most likely being answered, so it is worth a look even if the
 *  exchange contains no fresh deed-like verb. */
export function mentionsOpenDeed(l: Ledger, exchange: string): boolean {
  return openDeeds(l).some((d) => deedMentioned(d, exchange));
}

/** True when the exchange talks about this particular deed. A model cannot
 *  mark a deed "answered" unless it did — otherwise resolving one deed tends
 *  to sweep unrelated open ones away with it. */
export function deedMentioned(d: Deed, exchange: string): boolean {
  const hay = exchange.toLowerCase();
  return wordsOf(d.text).filter((w) => w.length >= 5).some((w) => hay.includes(w));
}

const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length >= 4);

/** True when two deeds are, in effect, the same one (most words shared). */
function similar(a: string, b: string): boolean {
  const wa = new Set(wordsOf(a));
  const wb = wordsOf(b);
  if (wa.size === 0 || wb.length === 0) return false;
  const shared = wb.filter((w) => wa.has(w)).length;
  return shared / Math.min(wa.size, wb.length) >= 0.6;
}

const cleanNames = (xs: string[] | undefined) =>
  [...new Set((xs ?? []).map((x) => x.trim()).filter((x) => x.length > 0 && x.length <= 40))].slice(0, 4);

export function addDeeds(l: Ledger, incoming: NewDeed[], turn: number): Ledger {
  let next = l.next;
  const deeds = [...l.deeds];
  for (const n of incoming) {
    const text = n.deed.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "").slice(0, 140);
    if (text.length < 8) continue;
    if (deeds.some((d) => d.status === "open" && similar(d.text, text))) continue;
    deeds.push({
      id: `d${next++}`,
      text,
      turn,
      affects: cleanNames(n.affects),
      witnesses: cleanNames(n.witnesses),
      status: "open",
    });
  }
  // A ledger that only grows stops being one: drop the oldest open deeds.
  const open = deeds.filter((d) => d.status === "open");
  const overflow = new Set(open.slice(0, Math.max(0, open.length - MAX_OPEN)).map((d) => d.id));
  return { deeds: deeds.filter((d) => !overflow.has(d.id)).slice(-40), next };
}

export function markAnswered(l: Ledger, ids: string[], turn: number): Ledger {
  const set = new Set(ids);
  if (!l.deeds.some((d) => d.status === "open" && set.has(d.id))) return l;
  return {
    ...l,
    deeds: l.deeds.map((d) => (d.status === "open" && set.has(d.id) ? { ...d, status: "answered", answered_turn: turn } : d)),
  };
}

export function dismiss(l: Ledger, id: string): Ledger {
  return { ...l, deeds: l.deeds.map((d) => (d.id === id ? { ...d, status: "dismissed" } : d)) };
}

/** Open deeds that have aged enough, and were not put to the model recently. */
export function dueDeeds(l: Ledger, turn: number): Deed[] {
  return openDeeds(l)
    .filter((d) => turn - d.turn >= MIN_AGE && (d.nudged === undefined || turn - d.nudged >= RENUDGE_AFTER))
    .slice(0, MAX_SHOWN);
}

export function markNudged(l: Ledger, ids: string[], turn: number): Ledger {
  const set = new Set(ids);
  return { ...l, deeds: l.deeds.map((d) => (set.has(d.id) ? { ...d, nudged: turn } : d)) };
}

/** Prompt lines, e.g. "Sam took the keeper's ledger; Odalys saw it (5 turns ago)". */
export function renderConsequences(deeds: Deed[], turn: number): string[] {
  return deeds.map((d) => {
    const who = d.witnesses.length ? `; ${d.witnesses.join(" and ")} ${d.witnesses.length > 1 ? "know" : "knows"} of it` : "";
    const ago = turn - d.turn;
    return `${d.text}${who} (${ago} turn${ago === 1 ? "" : "s"} ago)`;
  });
}

export interface LedgerDelta {
  new: NewDeed[];
  answered: string[];
}

/** Tolerant parse of the model's answer; anything unparseable is "nothing". */
export function parseLedgerDelta(raw: string): LedgerDelta {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return { new: [], answered: [] };
  try {
    const o = JSON.parse(text.slice(a, b + 1));
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const news = (Array.isArray(o.new) ? o.new : [])
      .filter((x: any) => x && typeof x.deed === "string")
      .map((x: any) => ({ deed: x.deed as string, affects: strs(x.affects), witnesses: strs(x.witnesses) }));
    return { new: news, answered: strs(o.answered) };
  } catch {
    return { new: [], answered: [] };
  }
}
