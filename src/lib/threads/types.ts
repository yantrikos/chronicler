// Open threads — narrative continuity items surfaced from YantrikDB's
// temporal primitives. Two kinds:
//   - upcoming: events with approaching deadlines or planned beats
//   - stale: important memories that haven't been touched in a while
//            (e.g. "you promised X 3 sessions ago, never followed up")
//
// Both are derived from canon memories that carry temporal metadata.
// The inspector surfaces them with provenance (source rid, last-seen
// timestamp, linked entities) and per-row actions (dismiss / snooze /
// resolve / pin) persisted locally.

export type ThreadKind = "upcoming" | "stale";

export interface Thread {
  /** Stable key used for dismissal storage. Prefer the source rid; fall
   *  back to a hash of the text + kind if no rid is available. */
  id: string;
  kind: ThreadKind;
  text: string;
  /** Originating memory rid, when known. Clicking jumps to it in the
   *  Memory tab. */
  rid?: string;
  importance?: number;
  /** ISO timestamp of when the source memory was last seen in any
   *  recall — used to render "X days stale" labels. */
  last_seen_at?: string;
  /** Linked entity / world / character names — for the provenance row. */
  entities?: string[];
}
