# Consequences — does the world remember what the player did?

Players ask for this in the same words ("if I jump out of the office window I
want the people in the office to still be there and react"). The ledger records
consequential things the player does, holds them a few exchanges, then hands
open ones to the model so the world can answer — and notes when it has.

**Design.** A cheap text gate (`looksConsequential`, `mentionsOpenDeed`) decides
whether an exchange might contain a deed or answer one; only then is a small
model call made, so ordinary chatter costs nothing. New deeds must be grounded in
the exchange, and a deed can only be marked *answered* if the exchange actually
talks about it. Deeds age in exchanges, surface after 3, and are not repeated for
5 more, so the model isn't nagged. The pacing engine gains a "consequence coming
due" beat that uses an open deed.

## 1. Can a local model keep the ledger? (`scripts/ledger-eval.ts`)

Seven turns: chatter, a theft with a witness, chatter, a promise, chatter, the
theft put right, chatter — 9 checks, plus how many turns needed a model call.

| Model | checks (repeated runs) | model calls |
|---|---|---|
| qwen3.5:4b | 9, 8, 9, 9 of 9 | 3 of 7 turns |
| qwen3.5:9b | 8, 9, 8 of 9 (after the fixes below) | 3 of 7 turns |
| qwen3.6:35b | 9 of 9 | 3 of 7 turns |

**What measuring found:**
- The first gate was too narrow: only 1 of 7 turns triggered a call, so the theft
  ("slip the ledger off the desk and into my coat") and the apology that resolved
  it were silently missed — identically on all three models. Adding verbs
  (slip, pocket, take, sorry, put back, return…) and a topic-overlap trigger fixed
  it. A gate that loses deeds is worse than none.
- The 9B marked an unrelated promise as "answered" when the theft was resolved.
  Requiring the exchange to mention a deed before it can be answered fixed it.
- Remaining miss: witnesses. The models name whoever is in the room (Ren) rather
  than who actually saw it (Odalys). The scene is ambiguous, so it was left.

## 2. Does surfacing a deed make the world respond? (`scripts/consequence-eval.ts`)

Five scenes (theft, a lie, a smashed lantern, a promise, a read letter); the deed
happened 4 exchanges ago and the current exchange is quiet. Replies judged blind
by qwen3.6:35b.

| Writer | world reacts, no block | with `<consequences>` | leaks |
|---|---|---|---|
| qwen3.5:4b | 30% (n=10) | 60% (n=10) | 10% → 0% |
| qwen3.5:9b | 0% (n=10) | 60% (n=10) | 0% → 0% |

Left alone, the 9B never brought up an earlier theft or lie on its own.

## Limits
Small samples (n=10 per cell), one judge model, five scenes, one scripted ledger
scene. The 4B's replies are sometimes muddled (it slips into third person about
the player). Whether players enjoy the world pushing back is untested — hence the
Settings checkbox, the visible chips on the scene board, and per-deed dismiss.
