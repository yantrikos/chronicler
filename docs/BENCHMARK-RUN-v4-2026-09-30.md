# Cross-model character benchmark — protocol v4 run, 2026-09-30

Governed by [BENCHMARK-PROTOCOL-v4.md](./BENCHMARK-PROTOCOL-v4.md), written before this run. Raw data:
[benchmark-v4-2026-09-30.json](./benchmark-v4-2026-09-30.json). Frozen inputs, verified by the runner at start: fresh scenes
`f369219f74512996` (frozen before any dev result) and the trait restatements `dab4649505921558`.
Identity arm = each trait shown as its original text plus an `On the page:` restatement (variant E2 of
[TRAIT-ENACTMENT-DEV.md](./TRAIT-ENACTMENT-DEV.md)); default intro; judge `qwen3.6:35b` scoring against the ORIGINAL trait text;
3 samples per cell, per-cell median; declared-applicable traits only.

## Verdict: FAIL (criteria 3 and 4)

| Model | Identity (E2) | Control | Lift | Scenes won |
|---|---|---|---|---|
| qwen3.5:9b | 0.731 | 0.237 | +0.494 | 8/8 |
| gpt-oss:20b | 0.519 | 0.119 | +0.400 | 8/8 |
| qwen2.5:7b | 0.162 | 0.013 | +0.150 | **4/8** |
| **mean** | **0.471** | | **+0.348** | |

- Criterion 1 (mean lift ≥ 0.15): met. Criterion 2 (every lift ≥ 0.08): met.
- Criterion 3 (mean identity fidelity ≥ 0.50): **not met** (0.471).
- Criterion 4 (≥ 5 of 8 scenes won by every model): **not met** — `qwen2.5:7b` won 4/8. On four scenes it scored 0.00 in *both* arms
  (spilled ink, missed vigil, promise ring, first solo), and a tie is not a win: the judge sees no embodiment in either arm.
- σ across models (identity) = 0.235, reported and not gated.
- Run quality: 0 failed replies of 216, 0 reasoning-leak openings, judge 351 calls with 0 unparseable / 0 errors.

## Exploratory: restated traits vs the traits as-is (same fresh scenes)

| Model | E2 | Original | E2 − original |
|---|---|---|---|
| qwen3.5:9b | 0.731 | 0.525 | +0.206 |
| qwen2.5:7b | 0.162 | 0.122 | +0.041 |
| gpt-oss:20b | 0.519 | 0.519 | **0.000** |
| **mean** | **0.471** | **0.389** | **+0.082** |

Warmth toward Ren (reported, not gated): E2 0.813 vs original 0.828 (Δ −0.015).

By the rule fixed in the protocol, this branch applies: **FAIL, but E2 beats the original traits by ≥ 0.05 with the warmth check within 0.05**
→ the feature may be built as an **optional** setting on the strength of that improvement, with the FAIL stated alongside it.

**Which model benefits is not stable.** In the dev run the gain came from `gpt-oss:20b` (+0.164) and `qwen3.5:9b` (+0.045); here
`gpt-oss:20b` gained 0.000 and `qwen3.5:9b` +0.206. The average is positive both times (+0.068 dev, +0.082 fresh), but per-model
gains move by ±0.2 between runs, so no claim about any *particular* model is supported. What is supported is a small positive
average effect.

## Per-trait (all models, identity E2 vs control)

| Trait | Identity | Control |
|---|---|---|
| Quiet observation first | 0.44 | 0.10 |
| Guarded with strangers | 0.60 | 0.29 |
| Deflects with humor at intimacy | 0.31 | 0.03 |
| Apologizes through actions | 0.32 | 0.02 |
| Music metaphors for unnamed feelings | 0.73 | 0.24 |

The two behavior traits, weak in every earlier run (0.21 and 0.28 in v3), are at 0.31 and 0.32 — better, still the lowest.

Per-scene medians (identity / control; qwen2.5:7b · qwen3.5:9b · gpt-oss:20b): crowded well 0.35/0.10 · 0.93/0.55 · 0.65/0.20;
spilled ink 0.00/0.00 · 0.80/0.00 · 0.30/0.00; missed vigil 0.00/0.00 · 0.50/0.00 · 0.50/0.00; promise ring 0.00/0.00 · 0.90/0.25 ·
0.60/0.50; father's letter 0.25/0.00 · 0.60/0.35 · 0.50/0.00; lock-keeper 0.10/0.00 · 0.68/0.20 · 0.35/0.00; tavern widow
0.60/0.00 · 0.95/0.35 · 0.75/0.25; first solo 0.00/0.00 · 0.50/0.20 · 0.50/0.00.

## Four runs

| Run | Change | Mean lift | Mean identity fidelity | Verdict |
|---|---|---|---|---|
| v1 | (5 scenes, all traits averaged) | +0.195 | 0.358 | FAIL (measure defect) |
| v2 | applicable traits, new scenes | +0.267 | 0.438 | FAIL |
| v3 | intro wording B | +0.306 | 0.417 | FAIL |
| v4 | trait restatements (E2) | +0.348 | 0.471 | FAIL |

- **Consistent:** the identity layer has a large positive effect on this fixture; lift rose with each change and is at least +0.13 for every
  model in every run.
- **Not reached:** the 0.50 fidelity bar. The nearest miss is 0.471, 0.029 short.
- **Model tiers:** `qwen3.5:9b` cleared the bar in v2, v3 and v4 (0.588 / 0.653 / 0.731). `gpt-oss:20b` sits at 0.43–0.52 (0.519 here, just over).
  `qwen2.5:7b` stays at 0.16–0.26 and is at the floor on many scenes with or without the identity layer. The mean is dragged down by the 7B.
  That "the layer works on ~9B-class models and up but not on a 7B" is a hypothesis formed after seeing these results and is **not established**;
  testing it needs its own pre-registered protocol declaring the claim first.
- **Per protocol:** no further run against this bar with these three models.

## Limits

- All 29 scenes across v1–v4 are now seen. Any new verdict needs a new fresh set and a new dated protocol.
- One hand-authored character, one LLM judge, three models; one rewriter model made one deterministic restatement artifact.
- In production the traits are skill bodies already phrased as behavior, so the effect there may differ; it is untested there.
- This does not show that real play produces an identity block (`IDENTITY-LAYER.md`).
- No claim of model-independent character is supported, and no announcement is authorised by this document.
