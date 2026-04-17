# The Chronicler Memory Pattern

*A reusable architecture for giving language models a memory that doesn't lie, doesn't leak, and doesn't silently pollute itself.*

This document describes the memory pattern underlying [Chronicler](https://github.com/spranab/chronicler), a local-first roleplay client. The pattern is not roleplay-specific — it applies to any product that runs an LLM over multi-session, multi-speaker conversations and needs the memory layer to be trustworthy rather than merely clever.

The pattern is built on three mechanical decisions and one prompt-level discipline. Each one addresses a specific failure mode that naive "vector store + recall" memory implementations hit.

---

## Failure modes it solves

If you've built a memory layer for an LLM, you've probably hit at least two of these:

1. **Noise becomes canon.** Chat messages get embedded and written as memories. Three sessions later, a throwaway flirtation is being injected into every turn as a fact.
2. **The recap invents things.** You ask the model to summarize prior sessions. It does — along with dynamics, tensions, and "unresolved threads" that never happened.
3. **Group chats leak.** Character A was told a secret by the user. Character B was not. But they share the same embedding space / namespace / retrieval pipeline, and now B can pull up the secret semantically.
4. **Auto-promotion tuning is invisible.** You have a "this memory seems important, let's promote it" heuristic, but you can't tell what's been promoted, why, or what different thresholds would have done.
5. **The model confabulates continuity.** Even with perfect memory, the model reads the system prompt and fills in with plausible-sounding history that never happened.

Each of these is a known hazard in production LLM applications. Chronicler's pattern addresses them structurally, not through better prompting.

---

## The three mechanical decisions

### 1. Three-tier write contract

Every memory you write is classified into exactly one of three tiers:

| Tier | Purpose | Source | Lifetime |
|---|---|---|---|
| **Reflex** | Ephemeral scene state: who's in the room, current objective, active emotion, temporary effects. | Orchestrator writes automatically from in-scene markers. | Session-scoped. Archived at session end. |
| **Heuristic** | Inferred facts, relationship deltas, procedural patterns. "Might be true." | Extraction pass after each turn — LLM-based. | Decays unless reinforced. Visible to user; user can pin, demote, or dismiss. |
| **Canon** | Durable truths. Pinned by the user or imported from authoritative sources (character cards, explicit user commits). | Card import, explicit "remember that X" commands, user-pinned draft, auto-promotion after N reinforcements. | Permanent until retconned. Never overwritten silently. |

**Why it matters:** the vast majority of naive memory systems write *everything* at the same trust level. A throwaway line ends up indistinguishable from "my wife is a doctor." Chronicler's contract makes those inputs *structurally* different, and retrieval treats them accordingly (canon first, scene second, heuristic last, low-certainty items excluded from direct injection entirely).

The tier is metadata on existing memory fields (importance, certainty, namespace, source). It's not a schema change to the underlying store. Implementing it on top of any vector database or memory engine is a weekend project.

### 2. Per-memory visibility ACL

Every memory carries a `visible_to: string[]` field. Defaults to `["*"]` (public). In scenes with multiple participants, each memory is tagged with the audience that was present when the statement was made.

Retrieval filters by `visible_to` **before ranking**, not after. This distinction matters: post-rank filters leak via the ranker's decision to include/exclude based on content similarity. Pre-rank filters make leakage mechanically impossible.

In Chronicler:
- User tells character A a secret in a 1-on-1 scene → stored with `visible_to: [user, A]`
- User joins a group scene with A and B → A's old memory is **not mutated**; its visibility stays `[user, A]`
- Character B querying with `speaker: B` physically cannot retrieve it
- If the user repeats the secret aloud in the group scene, a **new** memory is written with `visible_to: [user, A, B]`. The old one is preserved for provenance.

This is verified by `tests/secret-stays-private.test.ts`. The property is unfakeable by prompt engineering — it's a filter applied at the retrieval layer before the LLM ever sees the candidate set.

The pattern generalizes beyond characters: any multi-principal system (multiple users, multiple agents, multiple tenants) can apply the same ACL to prevent cross-boundary recall.

### 3. Auto-promotion with replay-harness instrumentation

Heuristic memories become canon when they've been **reinforced** — retrieved and used in generation — N times across M separate sessions within a D-day window, with no user correction in the history.

Chronicler's defaults: N=3, M=2, D=14. But these numbers are not hardcoded; they're configuration.

Crucially, **every tier transition emits a structured log entry**:

```jsonc
{
  "at": "2026-04-17T04:52:00Z",
  "memory_id": "mem-abc",
  "from_tier": "heuristic",
  "to_tier": "canon",
  "reason": "threshold_met",
  "reinforcement_count": 3,
  "session_span_days": 5,
  "outcome": null  // "accepted" or "reverted" when user responds
}
```

With every decision logged, a **replay harness** can walk the log and simulate "what would have happened under threshold (4, 2, 14)?" — returning the delta of newly-promoted and no-longer-promoted memories. See `src/lib/instrumentation/session-replay.ts`.

This is the only honest way to tune the promotion threshold — the single most critical tuning knob in a memory-based system. Without replay, you're guessing. With it, you have a direct feedback loop between real usage and policy.

**Implementation note:** the log must redact free-text fields by default. We default to logging IDs, counts, timestamps, tier transitions. The underlying memory text requires an explicit opt-in flag (`CHRONICLER_VERBOSE_LOGS=1`) for local-only debugging.

---

## The prompt-level discipline: anti-confabulation

Even with mechanically correct memory, the LLM will confabulate if given room. The following clause is prepended to every system prompt in Chronicler, and it matters more than you'd think:

```
Ground rules for continuity — these override any competing instruction:

- Treat only the facts in <canon> and <scene> as real.
- Do not reference prior events, relationships, or character history that are
  not present in those sections.
- If asked about something not in memory, respond in character by asking,
  deflecting, saying you don't recall, or changing the subject. Never invent.
- Memories under <heuristic> are clues, not facts. They may be wrong.
- Memories prefixed "in a dream" may or may not be remembered by the character
  depending on what fits the scene; they are not ordinary canon.
```

We observed a clean example of this working in live testing: the user showed a character an NSFW object mid-scene. The character, instead of playing along based on a confabulated prior, replied "*I have no idea who you are*" — because the user hadn't told them their name yet. The anti-confab clause caused the model to defer rather than fabricate.

**Combine this with the recap generator, which is the highest-risk surface:** the recap takes a list of canon facts and generates a "previously on..." summary. Naive prompts let the model editorialize ("the tension between them was growing"). Our recap prompt is deliberately rigid:

- "ONLY paraphrase facts from the FACTS list."
- "Never attribute a fact to the wrong subject — read each fact carefully."
- "Do NOT describe emotions, tensions, dynamics, conflicts unless explicitly listed."
- "Do NOT add connecting narrative."

In early dogfood, we caught the recap saying "Ren, whose name is Kiku, has established a pattern of deflecting emotional questions with humor" — confusing the user's cat (Kiku) with the character (Ren). Tightening the prompt and providing subject-tagged facts fixed it. This is the kind of bug that hides in every naive summarization layer in every memory product.

---

## What this pattern does NOT do

**It is not vector search.** Semantic recall is a component — Chronicler uses YantrikDB for embedding-based retrieval — but the tier contract, ACLs, replay harness, and anti-confab clause sit on top. You can implement the pattern with any memory store.

**It does not make the LLM smarter.** A 4B model is still a 4B model. The pattern ensures that what the model *has* to work with is trustworthy — correctly attributed, appropriately scoped, uncontaminated by noise. Quality of language and reasoning is still the model's responsibility.

**It does not eliminate hallucination.** LLMs hallucinate. The pattern makes the distinction between "the model hallucinated" (bad, but bounded — you can see it in the reply) and "the memory system gave the model bad inputs" (much worse, compounds over time). Only the latter is our problem to solve; the former is the model's.

---

## When to use this pattern

- Multi-session conversations where continuity matters
- Multi-principal scenarios (multi-agent, multi-user, multi-tenant) where recall needs to respect trust boundaries
- Long-running assistants that accumulate user preferences and relationship state
- Any memory system where auto-promotion of inferred facts to durable canon is part of the design
- Domains where confabulation costs user trust disproportionately — roleplay, therapy-adjacent tools, companion apps, long-running research assistants

## When NOT to use it

- Single-turn or short-horizon applications — overhead isn't justified
- Read-only / retrieval-only systems with no auto-writing — you don't need the tier contract
- Fully autonomous agents where the agent itself is the author and auto-promotion aggressiveness is the point — you'd flip the defaults

---

## Reference implementation

- Code: [chronicler/src/lib](https://github.com/spranab/chronicler/tree/main/src/lib) — specifically `orchestrator/`, `yantrikdb/types.ts`, `instrumentation/`
- Full architectural decisions: [ADR-002-memory-conventions](./ADR-002-memory-conventions.md)
- Tests that verify the properties: `tests/secret-stays-private.test.ts`, `tests/auto-promote.test.ts`, `tests/session-replay.test.ts`, `tests/extract.test.ts`
- Dogfooding protocol with the pre-declared ship/no-ship rules: [DOGFOOD.md](./DOGFOOD.md)

---

## A note on YantrikDB

The memory engine underneath Chronicler is [YantrikDB](https://github.com/yantrikos/yantrikdb) — a local-first cognitive memory system with semantic recall, knowledge graph operations, conflict detection, temporal triggers, personality inference from patterns, and procedural memory. The pattern described in this document works on top of YantrikDB cleanly because YantrikDB provides the graph + ACL + namespace + metadata primitives. It's a better fit than a raw vector store for this pattern, but not strictly required.

If you're building your own memory layer for an LLM application and the failure modes at the top of this document are familiar, the three tiers + ACL + replay harness + anti-confab prompt are roughly 400 lines of code to implement, independent of the memory engine. The discipline is the value; the implementation is mechanical.

---

*Written 2026-04-17 during the first successful end-to-end dogfood run of Chronicler. Feedback: `developer@pranab.co.in`.*
