# Cross-model character benchmark — protocol v2 run, 2026-09-30

Governed by [BENCHMARK-PROTOCOL-v2.md](./BENCHMARK-PROTOCOL-v2.md), written before any reply from these scenes existed.
Raw data: [benchmark-v2-2026-09-30.json](./benchmark-v2-2026-09-30.json) (scene-set fingerprint `4b059137da532a21`).
Judge `qwen3.6:35b`; 3 samples per cell, per-cell median; 8 held-out scenes; trait adherence over declared-applicable traits only.

## Verdict: FAIL (criterion 3 only)

| Model | Identity | Control | Lift | Scenes won |
|---|---|---|---|---|
| qwen2.5:7b | 0.256 | 0.056 | +0.200 | 5/8 |
| qwen3.5:9b | 0.588 | 0.200 | +0.388 | 6/8 |
| gpt-oss:20b | 0.469 | 0.256 | +0.213 | 6/8 |
| **mean** | **0.438** | | **+0.267** | |

- Criterion 1 (mean lift ≥ 0.15): **met** (0.267).
- Criterion 2 (every lift ≥ 0.08): **met** (lowest 0.200).
- Criterion 3 (mean identity fidelity ≥ 0.50): **NOT met** (0.438).
- Criterion 4 (≥ 5/8 scenes won per model): **met** (5, 6, 6).
- σ across models (identity arm) = 0.137, reported and not gated.

Run quality: 0 failed replies of 144; 0 reasoning-leak openings; judge 234 calls, 0 unparseable, 0 errors. The v1 harness artifact is gone.

## What the run shows

Per-trait mean over all models and samples (identity vs control):

| Trait | Identity | Control |
|---|---|---|
| Quiet observation first | 0.46 | 0.19 |
| Guarded with strangers | 0.60 | 0.40 |
| Deflects with humor at intimacy | 0.27 | 0.10 |
| Apologizes through actions | 0.18 | 0.00 |
| Music metaphors for unnamed feelings | 0.87 | 0.35 |

Per-scene medians (identity / control):

| Scene | qwen2.5:7b | qwen3.5:9b | gpt-oss:20b |
|---|---|---|---|
| Stranger at the fire | 0.00 / 0.00 | 0.95 / 0.40 | 0.55 / 0.20 |
| Broken lamp (apology) | 0.00 / 0.00 | 0.30 / 0.00 | 0.50 / 0.00 |
| Missed harbour (apology) | 0.00 / 0.00 | 0.00 / 0.00 | 0.20 / 0.00 |
| Confession | 0.50 / 0.00 | 0.75 / 0.25 | 0.60 / 0.25 |
| Mother song | 0.50 / 0.10 | 0.75 / 0.10 | 0.50 / 0.25 |
| Shore elder | 0.60 / 0.35 | 0.95 / 0.15 | 0.50 / 0.65 |
| Eager stranger | 0.25 / 0.00 | 0.80 / 0.50 | 0.70 / 0.70 |
| Wedding tease | 0.20 / 0.00 | 0.20 / 0.20 | 0.20 / 0.00 |

- The identity layer has a large, consistent effect: lift is at least 0.20 on every model, and the music-metaphor trait moves from 0.35 to 0.87.
- Two behaviours are weak even with the layer: **apologizing through action** (0.18; the two apology scenes are near zero for every model) and **humor deflection** (0.27; wedding-tease is 0.20 for every model). These are traits that ask for a specific *behaviour* rather than a manner of speaking, and small models mostly do not produce it.
- `qwen2.5:7b` scores 0.00 on several scenes in both arms (fire stranger, broken lamp, missed harbour). Its replies are short and the judge sees no embodiment; whether that is the model or judge strictness on terse replies was not investigated.
- On the shore-elder and eager-stranger scenes `gpt-oss:20b` did as well or better *without* the identity layer (0.65 vs 0.50; 0.70 vs 0.70), so its lift comes from other scenes.

## Two runs, two FAILs

v1 (2026-09-30, `BENCHMARK-RUN-2026-09-30.md`) failed criterion 3 at 0.358 with a scoring defect (an untriggerable trait counted as 0). v2 corrected the defect on new scenes with unchanged thresholds and failed the same criterion at 0.438. Fidelity rose by 0.08; it did not reach 0.50. The 0.50 bar was not lowered to fit.

## Limits

- The v2 scenes have now been seen; further work on them is dev data. Any new verdict needs fresh scenes and a new dated protocol.
- Hand-authored character, one LLM judge (temperature 0), three models, `think` off/low.
- This shows an identity block changes behaviour on this fixture. It does not show that real play produces such a block (`IDENTITY-LAYER.md`).
- No claim of model-independent character is supported, and no announcement is authorised by this document.
