# ADR-002: Memory Metadata Conventions (Three-Tier Write Contract)

**Status:** Accepted
**Date:** 2026-04-17
**Relates to:** Saga task #4

## Decision

Chronicler encodes the three-tier write contract as a metadata convention layered on YantrikDB's existing fields. No engine fork. The convention is a stable contract between the orchestrator and any future consumer (bothn TV, etc.).

## Schema

Every memory Chronicler writes carries this metadata:

```ts
interface ChroniclerMemoryMetadata {
  tier: "reflex" | "heuristic" | "canon";
  canonical_status:
    | "canon"
    | "non-canon"
    | "dream"
    | "alternate-timeline"
    | "deleted-scene";
  visible_to: string[]; // e.g. ["user", "char_a"]; ["*"] for world canon
  character_id?: string;
  world_id?: string;
  session_id: string;
  source_turn_id?: string;
  promotion_history?: Array<{
    at: string; // ISO timestamp
    from_tier: "reflex" | "heuristic" | "canon";
    to_tier: "reflex" | "heuristic" | "canon";
    reason: string; // "user_pin" | "threshold_met" | "user_demote" | "retcon" | ...
  }>;
  raw_card?: string; // for card import, preserved for round-trip export
}
```

## Tier Semantics

### Reflex
- **Purpose:** ephemeral scene state (who's in the room, active objective, disguise, timers).
- **Mapping:** `source=system`, `importance<=0.3`, `namespace=session:<id>`.
- **Lifetime:** TTL-archived at session end. Never promoted to canon without explicit user action.
- **Retrieval:** eligible for the "recent scene" budget slice only.

### Heuristic
- **Purpose:** inferred preferences, relationship deltas, procedural patterns, `think()` outputs.
- **Mapping:** `source=inference`, `certainty<0.7`.
- **Lifetime:** decays unless reinforced. Visible in inspector. Clearly labeled "possibly" when injected into context.
- **Promotion path:** auto-promoted to canon per ADR-003 (auto-promotion heuristic) or manually by user.

### Canon
- **Purpose:** durable facts. Card-imported seeds. User-pinned truths. Confirmed retcons.
- **Mapping:** `source ∈ {user, confirmed, imported_seed}`, `certainty>=0.9`.
- **Lifetime:** never overwritten silently; updates flow through the conflict queue.
- **Retrieval:** exact-match priority; first slice of token budget.

## canonical_status (Retcon Model)

Independent of tier. Retrieval always returns the memory; the orchestrator decides injection treatment.

| status | orchestrator treatment |
|---|---|
| `canon` | inject as fact |
| `non-canon` | inspector only, do not inject |
| `dream` | inject prefixed "character may have dreamt: ..." |
| `alternate-timeline` | inject prefixed "in an alternate scenario: ..." |
| `deleted-scene` | inspector only, do not inject |

This replaces ad-hoc use of `forget` (tombstone) or `correct` (replace). Retconned memories stay retrievable for flavor and meta-references.

## visible_to (ACL)

- Default `["*"]` for world canon and anything lacking a speaker.
- Private scene between user and character A: `["user", "<char_a_id>"]`.
- Secret told by A to user: `["user", "<char_a_id>"]`.
- Applied as a **pre-ranking filter** in recall. Filtering after ranking leaks through the ranker.
- When a character learns something new (user tells B a secret), orchestrator writes a **new** memory rather than mutating visibility on the old one — preserves provenance.

## Mapping to YantrikDB fields

Chronicler's tier convention maps cleanly onto existing YantrikDB primitives:

| Convention | YantrikDB field |
|---|---|
| tier | `metadata.tier` (new) |
| canonical_status | `metadata.canonical_status` (new) |
| visible_to | `metadata.visible_to` (new) |
| certainty (by tier) | `certainty` |
| namespace by character/world | `namespace` |
| source | `source` |
| importance | `importance` |

## Why this is a metadata convention, not an engine change

- Keeps YantrikDB generic. Other orchestration profiles (bothn TV) use the same primitives with different policies.
- Lets us iterate the tier model without versioning the engine.
- The convention is a contract. Breaking it is as disruptive as a schema change — treat edits to this ADR accordingly.
