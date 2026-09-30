# Cross-model character benchmark — protocol (pre-registered)

**Written 2026-09-29, before the run it governs.** The pass criteria below were fixed
before any reply was generated. If the results miss them, the result is reported as a
miss; the criteria are not adjusted afterwards. If a criterion turns out to be
badly chosen, that is recorded as a new dated protocol and the run is repeated — the old
verdict stays on the record.

## Question

Does adding Chronicler's identity layer (`<character_identity>` + `<self_model>`) make a
model embody a character's traits **more than the same model without it**, and does that
hold across model families and sizes?

This is deliberately *not* "do the models agree with each other". Agreement measures
similarity, not fidelity (see the retraction in `CHARACTER-EMERGENCE-RESULTS.md`).

## Design

| Element | Choice | Why |
|---|---|---|
| Arms | `identity` and `control` (card + anti-confabulation only) | Without a control nothing is attributable to the substrate |
| Participants | `qwen3.5:9b`, `qwen2.5:7b`, `gpt-oss:20b` | Same as the retracted run, so results are comparable |
| Judge | `qwen3.6:35b` | Larger than every participant and outside the participant set; the earlier 4B judge scored an in-character reply at 0.47 |
| Scenes | the 5 existing scenes; `refusal_pattern` scored only on `limit-test` | No free 1.0 |
| Samples | 3 replies per (model, scene, arm) at temperature 0.7; the **median** per cell is used | One sample cannot separate signal from sampling noise |
| Judge temperature | 0 | Deterministic scoring |
| Headline metric | `trait_adherence`, never a blend | The only dimension that tests the thesis |

## Pass criteria (fixed now)

The verdict is decided per model, then combined. Let `lift(m)` = identity − control mean
`trait_adherence` for model *m*, computed over the 5 scenes using per-cell medians.

1. **Effect exists.** Mean `lift` across the three models ≥ **0.15**.
2. **It is not one model.** `lift(m)` ≥ **0.08** for **every** model. A model with a
   lift below that is reported as a failure of transfer, even if the mean passes.
3. **Absolute fidelity.** Mean identity-arm `trait_adherence` ≥ **0.50**.
4. **Not a sampling artifact.** For every model, the identity arm beats the control arm on
   at least **3 of the 5** scenes (by per-cell median).
5. **Stability is reported, not gated.** Cross-provider σ of identity-arm
   `trait_adherence` is reported next to fidelity and never used as evidence of success.

**Verdict:** *PASS* only if 1–4 all hold. Any of 1–4 failing → *FAIL*, and the verdict names
which. Nothing in this repository or any announcement may say the identity layer
"produces model-independent character" unless the verdict is PASS **and** the user has given
an explicit go-ahead to announce.

### Why these numbers

The earlier run put `qwen3.5:9b` at 0.452 and the mean at 0.275 without a control, so
a lift of 0.15 would roughly correspond to an identity arm reaching the level the best
model already showed. 0.50 is "the average model embodies about half the traits", which
is a low bar on purpose: failing it would mean the layer is not visibly working at all.
The per-model floor (0.08) exists because a mean can hide a model that gains nothing.
These are judgment calls, not derived quantities; they are written down so they cannot
drift toward whatever the data says.

## Known limits of this run (stated in advance)

- **Hand-authored character.** Adira's traits are a fixture, not produced by play. The
  benchmark therefore tests *whether an identity block changes behaviour*, not whether
  Chronicler's pipeline forms a good block from real play. A PASS does not close that gap;
  the identity-layer promotion path is documented separately in `IDENTITY-LAYER.md`.
- **One character, five scenes, three models.** A PASS is evidence for this setup,
  not a general claim.
- **LLM judge.** Even at 35B, the judge is a model. A subset of scores is
  hand-inspected and reported alongside the verdict.
- **`think: false`** is used for all participants (required to get content out of the
  reasoning models within the token budget); results may not carry over to thinking mode.

## Reproducing

```bash
# Isolated: talks directly to Ollama, touches no Chronicler server or database.
npx tsx scripts/run-cross-model-benchmark.ts
```

Environment: `BENCH_SAMPLES` (default 3), `BENCH_JUDGE` (default `qwen3.6:35b`).
