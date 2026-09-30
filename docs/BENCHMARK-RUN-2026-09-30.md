# Cross-model character benchmark — run of 2026-09-30

Governed by [BENCHMARK-PROTOCOL.md](./BENCHMARK-PROTOCOL.md); criteria were fixed before this run. Judge: `qwen3.6:35b`. Samples per cell: 3 (median used). Character: hand-authored fixture (see protocol, "Known limits").

## Verdict: FAIL

Failed criteria:

- 3. mean identity fidelity 0.358 < 0.5

## Fidelity and lift (trait adherence, per-cell medians)

| Model | Identity | Control | Lift | Scenes won |
|---|---|---|---|---|
| `qwen2.5:7b` | 0.224 | 0.088 | **0.136** | 4/5 |
| `qwen3.5:9b` | 0.526 | 0.272 | **0.254** | 5/5 |
| `gpt-oss:20b` | 0.324 | 0.128 | **0.196** | 4/5 |
| **mean** | **0.358** | | **0.195** | |

Thresholds: mean lift ≥ 0.15; every model's lift ≥ 0.08; mean identity fidelity ≥ 0.5; identity beats control on ≥ 3 scenes per model.

**Stability (reported, not gated):** cross-provider σ of identity-arm trait adherence = 0.126. Low σ is not evidence of success.

## Per-scene trait adherence (median)

| Scene | qwen2.5:7b id / ctl | qwen3.5:9b id / ctl | gpt-oss:20b id / ctl |
|---|---|---|---|
| Stranger approaches in a tavern | 0.10 / 0.00 | 0.60 / 0.30 | 0.46 / 0.04 |
| Old friend sits down with hard news | 0.30 / 0.00 | 0.56 / 0.14 | 0.16 / 0.10 |
| Stranger offers unprompted help | 0.08 / 0.04 | 0.60 / 0.34 | 0.34 / 0.10 |
| Trusted person asks what she's actually feeling | 0.20 / 0.20 | 0.40 / 0.24 | 0.20 / 0.20 |
| Manipulative push past her guard | 0.44 / 0.20 | 0.47 / 0.34 | 0.46 / 0.20 |

## Judge health and run quality

- Judge calls: 828; unparseable: 2; errors: 0. Each of those was scored a neutral 0.5.
- Failed or empty participant replies: 0 (scored 0, counted against the model).

## What this does and does not show

- It measures whether an identity block changes behaviour for one hand-authored character over five scenes and three models, judged by one LLM. It does not show that Chronicler's pipeline forms a good identity block from real play.
- No claim of model-independent character may be made from this document unless the verdict is PASS **and** an explicit go-ahead to announce has been given.
## Post-run observations (added after the verdict; the verdict above is unchanged)

- **Reasoning leakage in `gpt-oss:20b`.** 6 of its 30 replies begin with the model's own reasoning ("We need to respond as Adira…") rather than in-character prose; `think: false` is not honoured by this model and the harness falls back to the thinking field. Neither qwen model did this (0 of 30 each). This depresses `gpt-oss`'s scores and is a measurement artifact of this harness, not evidence about the identity layer. It does not change the outcome: the two qwen models alone average identity fidelity (0.224 + 0.526) / 2 = 0.375, still below the 0.50 criterion.
- **Where the shortfall is.** Lift is real and present on every model (0.136 / 0.254 / 0.196; identity beat control on 13 of 15 scene-cells). What fails is absolute fidelity: even with the identity layer, models embody well under half of the declared traits by this judge. `qwen2.5:7b` reaches only 0.224.
- **Criteria met:** 1 (mean lift 0.195 ≥ 0.15), 2 (all lifts ≥ 0.08), 4 (≥ 3 of 5 scenes won by every model). **Criterion failed:** 3.
- **Not concluded here:** whether a different judge, thinking-mode participants, or a play-formed rather than hand-authored identity block would score higher. Those are new experiments and need a new dated protocol; this one stands as a FAIL.
- **Judge health:** 828 calls, 2 unparseable, 0 errors.
