# Cross-model character benchmark — protocol v3 run, 2026-09-30

Governed by [BENCHMARK-PROTOCOL-v3.md](./BENCHMARK-PROTOCOL-v3.md), written before this run. Raw data:
[benchmark-v3-2026-09-30.json](./benchmark-v3-2026-09-30.json). Fresh scenes, fingerprint `ee00498f76a69862`
(frozen before the dev experiment's results were known; the runner refuses to start if they change).
Identity arm = intro variant B ([IDENTITY-INTRO-DEV.md](./IDENTITY-INTRO-DEV.md)); judge `qwen3.6:35b`; 3 samples per
cell, per-cell median; trait adherence over declared-applicable traits only.

## Verdict: FAIL (criterion 3 only)

| Model | Identity (B) | Control | Lift | Scenes won |
|---|---|---|---|---|
| qwen3.5:9b | 0.653 | 0.200 | +0.453 | 8/8 |
| gpt-oss:20b | 0.428 | 0.094 | +0.334 | 8/8 |
| qwen2.5:7b | 0.169 | 0.038 | +0.131 | 5/8 |
| **mean** | **0.417** | | **+0.306** | |

- Criterion 1 (mean lift ≥ 0.15): met (0.306). Criterion 2 (every lift ≥ 0.08): met (lowest 0.131).
- Criterion 3 (mean identity fidelity ≥ 0.50): **not met** (0.417). Criterion 4 (≥ 5/8 scenes won per model): met.
- σ across models (identity) = 0.198, reported and not gated.
- Run quality: 0 failed replies of 216, 0 reasoning-leak openings, judge 351 calls with 0 unparseable / 0 errors.

## Exploratory: does the new wording beat the current default?

| Model | B | Default | B − default |
|---|---|---|---|
| qwen3.5:9b | 0.653 | 0.556 | +0.097 |
| qwen2.5:7b | 0.169 | 0.150 | +0.019 |
| gpt-oss:20b | 0.428 | 0.400 | +0.028 |
| **mean** | **0.417** | **0.369** | **+0.048** |

The pre-stated rule for a FAIL was that B enters production only if B − default ≥ 0.05 on this fresh set.
It is **0.048**, so **B does not enter production**; the default intro stays. The direction agrees with the dev
experiment (B ahead everywhere) but the size is at the edge of what three models × eight scenes can resolve, and
almost all of it is one model.

## Per-trait (all models, identity B vs control)

| Trait | Identity | Control |
|---|---|---|
| Quiet observation first | 0.40 | 0.16 |
| Guarded with strangers | 0.59 | 0.34 |
| Deflects with humor at intimacy | 0.21 | 0.00 |
| Apologizes through actions | 0.28 | 0.04 |
| Music metaphors for unnamed feelings | 0.61 | 0.18 |

Per-scene medians (identity / control): ferry passenger 0.10/0.10 · 0.93/0.68 · 0.65/0.20; torn songbook 0.00/0.00 ·
0.50/0.00 · 0.30/0.00; forgotten medicine 0.00/0.00 · 0.50/0.00 · 0.20/0.00; inscribed gift 0.20/0.00 · 0.65/0.00 ·
0.50/0.25; old teacher 0.25/0.00 · 0.60/0.25 · 0.35/0.10; gate officer 0.25/0.10 · 0.80/0.25 · 0.10/0.00; widower
0.35/0.10 · 0.75/0.42 · 0.82/0.20; stage fright 0.20/0.00 · 0.50/0.00 · 0.50/0.00 (each triple is
qwen2.5:7b · qwen3.5:9b · gpt-oss:20b).

## What three runs say

| Run | Mean lift | Mean identity fidelity | Verdict |
|---|---|---|---|
| v1 (5 scenes, all 5 traits averaged) | +0.195 | 0.358 | FAIL (measure defect) |
| v2 (8 new scenes, applicable traits) | +0.267 | 0.438 | FAIL |
| v3 (8 fresh scenes, wording B) | +0.306 | 0.417 | FAIL |

- **Consistent:** the identity layer changes behaviour on this fixture. Lift is at least +0.13 on every model in every run and identity beat control on 5–8 of 8 scenes for every model in v2 and v3.
- **Consistent:** absolute fidelity stays under 0.50 (0.36 / 0.44 / 0.42) and does not move much with the wording change.
- **Model-dependent, not uniform:** `qwen3.5:9b` scored above the bar in both v2 (0.588) and v3 (0.653). `gpt-oss:20b` sits at 0.43–0.47 and `qwen2.5:7b` at 0.17–0.26. The mean is pulled down by the 7B. That suggests the layer works well on a 9B-class model and poorly on a 7B one — but that is a hypothesis formed *after* seeing these results, and it would need its own pre-registered protocol with the claim declared in advance; it is not established here.
- **Still weak in every run:** humor deflection (0.21) and apologizing through action (0.28), the two traits that ask the model to do a specific thing. A wording change did not fix them.

## Limits

- All 21 scenes across v1–v3 are now seen. Another verdict needs another fresh set.
- One hand-authored character, one LLM judge, three models; `think` off (low for gpt-oss).
- This does not show that real play produces such an identity block (`IDENTITY-LAYER.md`).
- No claim of model-independent character is supported, and no announcement is authorised by this document.
