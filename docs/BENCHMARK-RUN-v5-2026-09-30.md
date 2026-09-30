# Cross-model character benchmark — protocol v5 (scoped claim), run of 2026-09-30

Governed by [BENCHMARK-PROTOCOL-v5.md](./BENCHMARK-PROTOCOL-v5.md), written before this run. Raw data: [benchmark-v5-2026-09-30.json](./benchmark-v5-2026-09-30.json).
Frozen inputs, verified by the runner at start: 10 fresh scenes `f0b07a73f29b8754`; restatement artifact `dab4649505921558` (exploratory arm only).
Judge `qwen3.6:35b` (outside the participant set); 3 samples per cell, per-cell median; declared-applicable traits only.

## The claim that was tested

> For `qwen3.5:9b` and `gpt-oss:20b`, Chronicler's **default** identity layer raises trait embodiment over a no-identity control by a mean of ≥ 0.15
> (each ≥ 0.08), reaches mean fidelity ≥ 0.50, and beats control on ≥ 6 of 10 scenes for each model.

## Verdict: FAIL (criterion 3 only)

| Model | Identity (default) | Control | Lift | Scenes won |
|---|---|---|---|---|
| qwen3.5:9b | 0.498 | 0.158 | +0.340 | 8/10 |
| gpt-oss:20b | 0.403 | 0.200 | +0.203 | 7/10 |
| **mean** | **0.450** | | **+0.271** | |

- Criterion 1 (mean lift ≥ 0.15): met. Criterion 2 (each lift ≥ 0.08): met. Criterion 4 (each ≥ 6/10 scenes): met (8 and 7).
- Criterion 3 (mean identity fidelity ≥ 0.50): **not met** — 0.450. `qwen3.5:9b` landed at 0.498, 0.002 under the bar; `gpt-oss:20b` at 0.403.
- σ across the two models = 0.048, reported and not gated.
- Run quality: 0 failed replies of 240, 0 reasoning-leak openings, judge 384 calls with 0 unparseable / 0 errors.

The claim as declared is **not supported**. The bar was not moved after seeing the result.

## Exploratory, not gated (reported as pre-declared)

**Restatement arm (the optional setting), same two models:**

| Model | Default | E2 | E2 − default |
|---|---|---|---|
| qwen3.5:9b | 0.498 | 0.652 | +0.155 |
| gpt-oss:20b | 0.403 | 0.415 | +0.013 |
| **mean** | **0.450** | **0.534** | **+0.084** |

The E2 mean is above 0.50. It was **not** the verdict arm and the claim was about the default layer, so this does not convert the FAIL into a PASS and
must not be read as one. It does repeat the pattern of the last two runs: a positive average gain (+0.068 dev, +0.082 v4, +0.084 here) that is carried by
one model at a time (`gpt-oss:20b` first, then `qwen3.5:9b` twice). Warmth toward Ren (reported, not gated): default 0.735, E2 0.694 (Δ −0.041).

**Floor tier, `qwen2.5:7b`:** identity 0.195, control 0.070, lift +0.125, 5/10 scenes won — again near the floor, with a real but small lift.

## Per-trait (the two claim models, default identity vs control)

| Trait | Identity | Control |
|---|---|---|
| Quiet observation first | 0.49 | 0.21 |
| Guarded with strangers | 0.83 | 0.44 |
| Deflects with humor at intimacy | 0.28 | 0.04 |
| Apologizes through actions | 0.22 | 0.00 |
| Music metaphors for unnamed feelings | 0.82 | 0.46 |

Per-scene medians (identity / control; `qwen3.5:9b` · `gpt-oss:20b`): bridge toll 0.70/0.10 · 0.55/0.25; cracked bow 0.20/0.00 · 0.00/0.00; missed
wedding 0.00/0.00 · 0.00/0.00; child and mother 0.88/0.38 · 0.75/0.50; rain shelter 0.85/0.25 · 0.57/0.10; grandfather 0.60/0.25 · 0.50/0.25; settle down
0.30/0.00 · 0.20/0.00; ten years 0.75/0.10 · 0.50/0.25; market apprentice 0.70/0.50 · 0.65/0.65; loose skiff 0.00/0.00 · 0.30/0.00.

## Five benchmark runs, one picture

| Run | What changed | Mean lift | Mean identity fidelity | Verdict |
|---|---|---|---|---|
| v1 | first corrected benchmark (measure defect) | +0.195 | 0.358 | FAIL |
| v2 | applicable traits, new scenes | +0.267 | 0.438 | FAIL |
| v3 | intro wording | +0.306 | 0.417 | FAIL |
| v4 | trait restatements | +0.348 | 0.471 | FAIL |
| v5 | scoped to the two larger models, default layer | +0.271 | 0.450 | FAIL |

What is supported by all of it:

- The identity layer has a large, consistent effect on trait embodiment: lift over control of +0.13 to +0.49 for every model in every run, and identity ahead of
  control on most scenes.
- Style traits (music metaphors 0.82, guardedness with strangers 0.83) are embodied well. Traits that ask for a specific behavior (deflecting with humor 0.28,
  apologizing through action 0.22) are embodied poorly, and a rewording and a restatement each moved them only part of the way.
- Absolute fidelity has not reached 0.50 in any run at the mean, and reached it for the mean only in the exploratory restatement arm here (not gated).

What is **not** supported: that the layer produces model-independent character; that it reaches the pre-registered fidelity bar, even on the two larger
models; any per-model claim about who benefits from restatements.

## Per protocol: this is the end of benchmarking against this bar

The protocol fixed the consequence in advance. The identity layer's lift over control is large and consistent, and it does not reach the 0.50 fidelity bar even
on the two larger models. The public framing remains **an auditable identity substrate with honest measurement**, not a fidelity claim. There is no further
run against this bar, no re-scoping to another model subset, and no new thresholds on these scenes. All 39 scenes across v1–v5 have been seen.

## Limits

- One hand-authored character, one LLM judge, three local models; `think` off (low for `gpt-oss`).
- The scoped claim was formed after four earlier runs; even a PASS would have carried that discount.
- Nothing here shows that real play produces an identity block (`IDENTITY-LAYER.md`).
- No announcement is authorised by this document.
