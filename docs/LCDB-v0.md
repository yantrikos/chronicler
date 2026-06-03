# LCDB-v0 — Local Character Development Benchmark, v0

The benchmark is the proof that Chronicler's **Verified Character
Learning** loop actually does what it claims: skills detected by
YantrikDB and verified by the LLM surface back into prompts when relevant
and stay quiet when they're not.

This is an **ablation test**, not a quality test. It does not measure
prose quality. It measures whether the contract holds.

## What it tests

For every scenario, we run the same scripted user turns twice — once
with the skill catalog populated, once with it empty — and observe:

1. **Reuse** — at moments where a skill IS relevant, does it surface?
2. **Restraint** — at moments where it isn't, does it stay quiet?
3. **Model uptake** — does the model's reply incorporate the skill
   when it's surfaced?
4. **Inspector faithfulness** — does what the inspector reports
   ("these were the surfaced skills") match what actually landed in the
   rendered system prompt?
5. **Outcome calibration** — does a clean run score `+1` and a
   regeneration-within-window score `-1`?

## Scenarios

| ID | Skill type | Skill body (abridged) | Probes |
|---|---|---|---|
| `scenario_1_emotional_deflection` | pattern | "Ren deflects direct emotional questions with self-deprecating bookshop metaphors" | bookshop hours, postman schedule, rare editions |
| `scenario_2_procedural_ritual` | procedure | "Mei lights a candle, then asks one question before any serious decision" | tea preferences, hometown, harvest |
| `scenario_3_lesson_ask_before_assume` | lesson | "After a misread invitation cost a friend, Tov asks 'do you mean X or Y?' on ambiguous social signals" | bag contents, weather, shorter path |

Each scenario has 3 relevant turns and 3 probes. 6 turns × 2 conditions
× 3 scenarios = 36 captured per-turn observations, plus 6 categorical
checks per scenario, totalling **72 binary signals per run**.

## What the harness is NOT measuring

- **Prose quality.** We use a `MockProvider` whose reply contains a
  fixed signature word (e.g. `bookshop`) iff the skill body is in the
  rendered system prompt. That isolates the surfacing pipeline from
  any specific LLM's behavior.
- **Retrieval ranker quality.** The real YantrikDB ranks skills by
  embedding similarity. The in-memory transport used in this test does
  substring scoring, which underperforms semantic search to the point
  of being useless for short, sparsely-worded queries. To measure the
  *contract* without being bottlenecked by the test transport, we use
  an `OracleSurfaceTransport` that returns score `1.0` for the
  scenario's known-relevant queries and `0.0` for probes — the ceiling
  a perfect retriever would deliver. Tests against real YantrikDB
  embeddings would measure the gap below this ceiling.

## Reproducing

```bash
npx tsx tests/lcdb-v0.test.ts
```

Outputs:

- `docs/LCDB-v0-results.json` — full raw measurements
- `docs/LCDB-v0-results.md` — the markdown table printed below
- exit code `0` only if every contract assertion passes

The test is part of `npm test` so the contract is enforced on every CI
run.

## Latest results

See [LCDB-v0-results.md](./LCDB-v0-results.md) for the most recent run.

## What "passing" means in practice

Every binary signal goes the expected direction:

- Skill surfaces 3/3 when relevant when ON, 0/3 when OFF (and 0/3 on
  probes in both conditions).
- Model output reflects the skill 3/3 when surfaced, 0/3 otherwise.
- Inspector faithfulness 1/1 in both conditions.
- Outcome calibration `+1` and `-1` correctly scored.

If any of those drift — for example, a future change to compose causes
restraint to fail on probes — the test catches it in CI before the
loop's user-facing promise breaks.
