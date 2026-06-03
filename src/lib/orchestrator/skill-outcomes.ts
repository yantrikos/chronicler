// Skill outcome loop + derived state machine.
//
// Each turn end, the orchestrator hands us the list of skill_ids that were
// surfaced into that turn's prompt, plus an observation of how the user
// reacted (regenerated? retconned? deleted a related memory?). We score
// +1 / -1 / 0 and append to the skill's outcome history via
// client.skillOutcome (which goes to YantrikDB's skill_substrate).
//
// STATE IS DERIVED, not stored on the skill. The substrate doesn't expose
// a state field — it just stores outcomes. We derive state by reading the
// outcome list. This keeps the substrate dumb and lets us tune the
// thresholds without a migration.
//
//   candidate  → active      net ≥ +3 across ≥2 distinct sessions
//   active     → suppressed  last 5 outcomes net ≤ -2
//   suppressed → archived    no outcome activity for 7 days
//   any        → archived    explicit user action
//
// Distinct sessions are recovered from the `note` field, where we encode a
// JSON header on every outcome write (session_id + ts + reason). Reading
// it back lets us count sessions without an extra round trip.
//
// Saga task #43.

import type { YantrikClient } from "../yantrikdb/client";
import {
  logSkillTransition,
  type SkillState,
} from "../instrumentation/skill-transition-log";

export interface SkillObservation {
  /** Surfaced into the prompt at this turn index (0-based, monotonic
   *  across the session). */
  surfaced_at_turn: number;
  /** Number of user turns we waited before scoring. Must be ≥ 1 to score
   *  +1; the window matters for the no-regen-no-retcon definition. */
  turns_observed: number;
  /** Did the user regenerate the model reply within the observation
   *  window? Distance in turns; Infinity = never. */
  regenerated_within: number;
  /** Did the user edit (retcon) the model reply within the window? */
  retconned_within: number;
  /** Did the user delete or correct a memory related to this skill in
   *  the window? */
  deleted_related: boolean;
}

export type Score = -1 | 0 | 1;

// Tunable. Brainstorm convergence said 2-5 turn window; we use 2 for
// regen (immediate signal) and 5 for retcon/delete (delayed reflection).
const REGEN_WINDOW = 2;
const RETCON_WINDOW = 5;

export interface OutcomeRecord {
  succeeded: boolean;
  note?: string;
  at: string;
}

/** Pure: turn an observation into a score. Doesn't touch the substrate. */
export function scoreFromObservation(obs: SkillObservation): Score {
  if (obs.turns_observed < 1) return 0;
  const regen = obs.regenerated_within <= REGEN_WINDOW;
  const retcon = obs.retconned_within <= RETCON_WINDOW;
  const negative = regen || retcon || obs.deleted_related;
  if (negative) return -1;
  // Only positive if we observed long enough for retcon to have appeared.
  if (obs.turns_observed >= REGEN_WINDOW) return 1;
  return 0;
}

interface OutcomeNote {
  session_id: string;
  ts: string;
  score: 1 | -1;
  reason: string;
}

export function encodeNote(n: OutcomeNote): string {
  return `__skill_outcome__:${JSON.stringify(n)}`;
}

export function decodeNote(raw: string | undefined): OutcomeNote | null {
  if (!raw) return null;
  const prefix = "__skill_outcome__:";
  if (!raw.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(raw.slice(prefix.length));
    if (
      parsed &&
      typeof parsed.session_id === "string" &&
      typeof parsed.ts === "string" &&
      (parsed.score === 1 || parsed.score === -1) &&
      typeof parsed.reason === "string"
    ) {
      return parsed as OutcomeNote;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Pure: derive a skill's state from its outcome history. */
export function deriveState(
  outcomes: OutcomeRecord[],
  now: Date,
  currentState: SkillState = "candidate"
): SkillState {
  if (outcomes.length === 0) {
    // Idle archival applies to candidates too if they sit untouched.
    return currentState;
  }
  const parsed = outcomes
    .map((o) => ({
      succeeded: o.succeeded,
      at: o.at,
      note: decodeNote(o.note),
    }))
    .filter((o) => o.note !== null) as Array<{
    succeeded: boolean;
    at: string;
    note: OutcomeNote;
  }>;

  if (parsed.length === 0) return currentState;

  const totalNet = parsed.reduce(
    (s, o) => s + (o.note.score === 1 ? 1 : -1),
    0
  );
  const distinctSessions = new Set(parsed.map((o) => o.note.session_id)).size;
  const lastFive = parsed.slice(-5);
  const lastFiveNet = lastFive.reduce(
    (s, o) => s + (o.note.score === 1 ? 1 : -1),
    0
  );

  // Idle archival: no outcome in last 7 days.
  const lastAt = new Date(parsed[parsed.length - 1].note.ts).getTime();
  const idleDays = (now.getTime() - lastAt) / (1000 * 60 * 60 * 24);

  // Transition rules — order matters. Suppressed beats active when net
  // turns sharply negative; archived beats both when stale.
  if (currentState === "suppressed" && idleDays >= 7) return "archived";
  if (lastFive.length >= 5 && lastFiveNet <= -2) return "suppressed";
  if (totalNet >= 3 && distinctSessions >= 2) return "active";
  return currentState;
}

export interface RecordResult {
  skill_id: string;
  score: Score;
  reason: string;
  state_before: SkillState;
  state_after: SkillState;
  transitioned: boolean;
}

export class SkillOutcomeTracker {
  // De-dup guard: same (skill_id, session_id, surfaced_at_turn) tuple is
  // only ever scored once per process. The substrate is append-only, so
  // any client-side flaw that re-fires for the same turn would double-count.
  private seen = new Set<string>();

  constructor(private client: YantrikClient) {}

  /** Returns the de-dup key for this observation. */
  private key(skill_id: string, session_id: string, turn: number): string {
    return `${skill_id}::${session_id}::${turn}`;
  }

  hasRecorded(
    skill_id: string,
    session_id: string,
    surfaced_at_turn: number
  ): boolean {
    return this.seen.has(this.key(skill_id, session_id, surfaced_at_turn));
  }

  /** Record an observation. Returns the resulting state transition (if
   *  any). State is derived from the substrate's outcome list, so the
   *  same call doubles as the transition checkpoint. */
  async record(
    skill_id: string,
    session_id: string,
    obs: SkillObservation,
    opts: { currentState?: SkillState; now?: Date } = {}
  ): Promise<RecordResult> {
    const now = opts.now ?? new Date();
    const currentState = opts.currentState ?? "candidate";
    const tupleKey = this.key(skill_id, session_id, obs.surfaced_at_turn);

    // Score is computed from the observation regardless — useful for the
    // caller's UI even when we don't write.
    const score = scoreFromObservation(obs);
    const reason = describeReason(obs, score);

    let stateAfter = currentState;

    if (score !== 0 && !this.seen.has(tupleKey)) {
      this.seen.add(tupleKey);
      const note: OutcomeNote = {
        session_id,
        ts: now.toISOString(),
        score: score as 1 | -1,
        reason,
      };
      await this.client
        .skillOutcome(skill_id, score === 1, encodeNote(note))
        .catch(() => undefined);

      // Re-fetch to derive new state from the full history.
      const skill = await this.client.skillGet(skill_id);
      const outcomes = (skill?.outcomes ?? []) as OutcomeRecord[];
      stateAfter = deriveState(outcomes, now, currentState);

      if (stateAfter !== currentState) {
        const parsed = outcomes
          .map((o) => decodeNote(o.note))
          .filter((n): n is OutcomeNote => n !== null);
        const totalNet = parsed.reduce(
          (s, n) => s + (n.score === 1 ? 1 : -1),
          0
        );
        const distinctSessions = new Set(parsed.map((n) => n.session_id))
          .size;
        await logSkillTransition({
          at: now.toISOString(),
          skill_id,
          body: skill?.body ?? "",
          from_state: currentState,
          to_state: stateAfter,
          reason: transitionReason(currentState, stateAfter),
          net_score: totalNet,
          total_outcomes: parsed.length,
          distinct_sessions: distinctSessions,
        });
      }
    }

    return {
      skill_id,
      score,
      reason,
      state_before: currentState,
      state_after: stateAfter,
      transitioned: stateAfter !== currentState,
    };
  }

  /** Recompute state for a skill without writing a new outcome — used by
   *  the idle-archival sweep and on app open. */
  async refreshState(
    skill_id: string,
    currentState: SkillState,
    now: Date = new Date()
  ): Promise<{ state: SkillState; transitioned: boolean }> {
    const skill = await this.client.skillGet(skill_id);
    const outcomes = (skill?.outcomes ?? []) as OutcomeRecord[];
    const next = deriveState(outcomes, now, currentState);
    if (next !== currentState) {
      const parsed = outcomes
        .map((o) => decodeNote(o.note))
        .filter((n): n is OutcomeNote => n !== null);
      const totalNet = parsed.reduce(
        (s, n) => s + (n.score === 1 ? 1 : -1),
        0
      );
      const distinctSessions = new Set(parsed.map((n) => n.session_id)).size;
      await logSkillTransition({
        at: now.toISOString(),
        skill_id,
        body: skill?.body ?? "",
        from_state: currentState,
        to_state: next,
        reason: transitionReason(currentState, next),
        net_score: totalNet,
        total_outcomes: parsed.length,
        distinct_sessions: distinctSessions,
      });
    }
    return { state: next, transitioned: next !== currentState };
  }

  /** Explicit user archival. */
  async archive(
    skill_id: string,
    session_id: string,
    now: Date = new Date()
  ): Promise<void> {
    const skill = await this.client.skillGet(skill_id);
    await this.client
      .skillOutcome(
        skill_id,
        false,
        encodeNote({
          session_id,
          ts: now.toISOString(),
          score: -1,
          reason: "user_archived",
        })
      )
      .catch(() => undefined);
    await logSkillTransition({
      at: now.toISOString(),
      skill_id,
      body: skill?.body ?? "",
      from_state: "active",
      to_state: "archived",
      reason: "user_action",
      net_score: -1,
      total_outcomes: 1,
      distinct_sessions: 1,
    });
  }
}

function describeReason(obs: SkillObservation, score: Score): string {
  if (score === 1) return "no negative signal in window";
  if (score === -1) {
    const bits: string[] = [];
    if (obs.regenerated_within <= REGEN_WINDOW)
      bits.push(`regen@${obs.regenerated_within}`);
    if (obs.retconned_within <= RETCON_WINDOW)
      bits.push(`retcon@${obs.retconned_within}`);
    if (obs.deleted_related) bits.push("deleted_related");
    return bits.join(",") || "negative";
  }
  return "window not yet closed";
}

function transitionReason(
  from: SkillState,
  to: SkillState
): "threshold_met" | "negative_streak" | "idle_window" | "user_action" {
  if (to === "active") return "threshold_met";
  if (to === "suppressed") return "negative_streak";
  if (to === "archived" && from === "suppressed") return "idle_window";
  return "user_action";
}
