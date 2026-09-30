# Pacing — does a story beat move a stalled scene?

When the scene board has not changed for several turns (5 on "lively", 8 on
"gentle"), the director gives the model one private `<story_beat>` — an
arrival, a revelation, a deadline, an NPC acting on their own agenda — to work
in. Which beat, and when, is plain deterministic code (`src/lib/scene/pacing.ts`,
27 unit checks); only the writing is the model's.

**Method.** `scripts/pacing-eval.ts`: five deliberately quiet scenes (tea in a
shop, a beach walk, dinner talk, a train ride, a library) × 2 samples. Each reply
is generated with and without a beat, then judged blind by qwen3.6:35b on
(1) does it introduce a genuinely new development, and (2) does it leak the
machinery (mention a note/beat/director or step out of the fiction).

| Writer | new development, no beat | new development, with beat | leaks |
|---|---|---|---|
| qwen3.5:4b | 0% (n=10) | 50% (n=10) | 0% |
| qwen3.5:9b | 10% (n=10) | 80% (n=10) | 0% |

**What it shows.** Left alone, quiet scenes essentially never move — that is the
"nothing ever happens" complaint reproduced. A beat changes that without
breaking character.

**Limits.** n=10 per cell, one judge model, five scenes. The 4B's beats are
often vague ("someone staring through me from the street") where the 9B's are
concrete. The judge is a model, not a person. Whether players *like* the twists
is untested; that is why pacing is user-tunable, visible in the scene board
("twist possible in ~N still turns", "last nudge: …"), and can be switched off.

**Guardrails.** Never fires on regenerate/continue; a 4-turn cooldown after
each beat; the same beat is never chosen twice in a row; the player is never
given an "agenda"; needs the scene board (and so a real model) to measure
stillness.
