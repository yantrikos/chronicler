// Pacing — a nudge when the story has stopped moving.
//
// "Nothing ever happens" is the second most common complaint about AI
// roleplay: models wait for the player to drive, so a scene can idle for
// twenty turns. Players work around it by hand (generate-five-outcomes,
// bracketed "[make something happen]"). This makes it native: the scene board
// already knows when nothing has changed, and after enough still turns the
// director hands the model one private story beat to weave in.
//
// Deterministic on purpose: when to fire, which beat, and the cooldown are all
// plain code (with an injectable RNG for tests). Only the *writing* of the
// beat is left to the model.

import type { SceneState } from "./state";
import type { Deed } from "./ledger";

/** Things pacing may draw on beyond the board. */
export interface PacingContext {
  deeds?: Deed[];
}

export type PacingLevel = "off" | "gentle" | "lively";

/** Still turns before a beat is offered. */
export const THRESHOLD: Record<PacingLevel, number> = { off: Infinity, gentle: 8, lively: 5 };
/** Turns to wait after a beat before another can fire. */
export const COOLDOWN_TURNS = 4;

export interface Beat {
  id: string;
  label: string;
  /** The private instruction. Written as something to work into the story. */
  text: (s: SceneState, ctx?: PacingContext) => string;
  /** Only eligible when the board gives it something to work with. */
  eligible?: (s: SceneState, ctx?: PacingContext) => boolean;
}

const npcs = (s: SceneState) => s.present.filter((p) => !/^(you|sam|player)$/i.test(p));

export const BEATS: Beat[] = [
  {
    id: "arrival",
    label: "an arrival",
    text: () => "Someone or something unexpected arrives or intrudes on the scene, forcing a reaction.",
  },
  {
    id: "revelation",
    label: "a revelation",
    text: () => "A secret, clue or piece of information surfaces that changes how the situation looks.",
  },
  {
    id: "complication",
    label: "a complication",
    text: () => "Something goes wrong, or an obstacle appears, that raises the stakes.",
  },
  {
    id: "deadline",
    label: "time pressure",
    text: () => "Introduce time pressure: something must be done soon or it will be lost.",
  },
  {
    id: "reversal",
    label: "a reversal",
    text: () => "A reversal: something that seemed settled or safe turns out not to be.",
  },
  {
    id: "offer",
    label: "an opportunity",
    text: () => "An opportunity, or a difficult request, is put to the player's character.",
  },
  {
    id: "shift",
    label: "a change in the surroundings",
    text: () => "The environment changes — weather, light, a sound, the place itself — in a way that affects the scene.",
  },
  {
    id: "past",
    label: "the past resurfacing",
    text: () => "Something from the past surfaces — an object, a name, a memory — and pulls the scene somewhere new.",
  },
  {
    id: "agenda",
    label: "a character acting on their own agenda",
    eligible: (s) => npcs(s).length > 0,
    text: (s) => {
      const who = npcs(s)[0];
      return `${who} has goals of their own and acts on one now, rather than waiting on the player.`;
    },
  },
  {
    id: "consequence",
    label: "a consequence coming due",
    eligible: (_s, ctx) => (ctx?.deeds?.length ?? 0) > 0,
    text: (_s, ctx) =>
      `The consequences of "${ctx!.deeds![0].text}" catch up with the player: someone notices, reacts or acts on it.`,
  },
  {
    id: "objective",
    label: "movement on an objective",
    eligible: (s) => s.goals.length > 0,
    text: (s) => `Push the objective "${s.goals[0]}" forward: progress, a setback, or a new lead.`,
  },
];

export interface PacingInfo {
  /** Consecutive turns the board did not change. */
  calm: number;
  /** Turns left before another beat may fire. */
  cooldown: number;
  last_beat?: string;
}

export function pacingOf(s: SceneState): PacingInfo {
  return { calm: s.calm ?? 0, cooldown: s.cooldown ?? 0, last_beat: s.last_beat };
}

/** Advance the still-turn counters after a tracker update. */
export function advancePacing(s: SceneState, boardChanged: boolean): SceneState {
  const calm = boardChanged ? 0 : (s.calm ?? 0) + 1;
  const cooldown = Math.max(0, (s.cooldown ?? 0) - 1);
  if (calm === (s.calm ?? 0) && cooldown === (s.cooldown ?? 0)) return s;
  return { ...s, calm, cooldown };
}

/** Choose a beat if — and only if — the story has been still long enough. */
export function pickBeat(
  s: SceneState,
  level: PacingLevel,
  rng: () => number = Math.random,
  ctx?: PacingContext
): Beat | null {
  if (level === "off") return null;
  const { calm, cooldown, last_beat } = pacingOf(s);
  if (cooldown > 0 || calm < THRESHOLD[level]) return null;
  const pool = BEATS.filter((b) => b.id !== last_beat && (b.eligible?.(s, ctx) ?? true));
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** Record that a beat was used: reset stillness, start the cooldown. */
export function markBeatUsed(s: SceneState, beat: Beat): SceneState {
  return { ...s, calm: 0, cooldown: COOLDOWN_TURNS, last_beat: beat.id };
}

/** Turns until the next beat could fire, for display. null when off. */
export function turnsUntilBeat(s: SceneState, level: PacingLevel): number | null {
  if (level === "off") return null;
  const { calm, cooldown } = pacingOf(s);
  return Math.max(THRESHOLD[level] - calm, cooldown, 0);
}
