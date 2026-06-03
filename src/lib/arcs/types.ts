// Cross-session narrative arcs — Phase 9 pillar 2.
//
// An Arc is a cluster of canon memories that share linked entities within
// a temporal window. The clusterer is rule-based for v1 (entity intersect
// + time grouping); LLM-driven semantic clustering is a future
// enhancement we don't need yet.
//
// Status derivation is purely a function of timestamps + user overrides.
// The substrate itself stays dumb; client-side state machine decides
// what "active" / "paused" / "abandoned" mean.

export type ArcStatus = "active" | "paused" | "abandoned" | "resolved";

export interface ArcMember {
  rid: string;
  text: string;
  importance: number;
  /** Best-effort timestamp — created_at preferred, last_accessed_at fallback.
   *  Drives status derivation. */
  touched_at: string;
}

export interface Arc {
  /** Stable id derived from primary entity + earliest-member timestamp.
   *  Lets overrides survive re-clustering. */
  id: string;
  /** Title — for v1, "Arc: <primary entity>" or first 60 chars of the
   *  highest-importance member's text. LLM summarization is a follow-up. */
  title: string;
  /** Primary entity that anchors the cluster (the one that appears in the
   *  most members). Other entities go into `entities`. */
  primary_entity?: string;
  entities: string[];
  members: ArcMember[];
  /** Derived: max(member.touched_at). Drives active/paused/abandoned. */
  last_touched_at: string;
  /** Derived from last_touched_at + user override. */
  status: ArcStatus;
}
