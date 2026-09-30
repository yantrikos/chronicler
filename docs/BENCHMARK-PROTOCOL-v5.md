# Cross-model character benchmark — protocol v5: a scoped claim (pre-registered)

**Written 2026-09-30T15:06Z, before any v5 reply was generated.** This is the last benchmark against the 0.50 fidelity bar.

## The claim, declared first

> For the two locally available models of 9B parameters and up — `qwen3.5:9b` and `gpt-oss:20b` — Chronicler's **default**
> identity layer makes a model embody a character's declared traits more than the same model without it, and to the
> level of the pre-registered bar: mean lift ≥ 0.15 (each model ≥ 0.08), mean fidelity ≥ 0.50, and identity ahead of control
> on at least 6 of 10 scenes for each model.

This is narrower than "the identity layer works" and much narrower than "model-independent character". It is about **two** models,
one fixture character, one judge.

## Why this claim, and how much to discount a PASS

v1–v4 tested three models (`qwen3.5:9b`, `gpt-oss:20b`, `qwen2.5:7b`) and failed the 0.50 fidelity bar each time (best 0.471), with a
consistent, large lift over control. The 7B stayed near the floor with or without the identity layer; the 9B cleared 0.50 in v2, v3 and v4
(0.588 / 0.556 / 0.525 with the default traits and intro); `gpt-oss:20b` sat around 0.40–0.52. This claim was **formed after seeing
those results**. A fresh scene set and a declared claim make this test valid — the scenes are unseen and nothing is tuned — but the choice
of *which* models to claim about is a fork taken after the data. So:

- A PASS supports only the sentence above. It is not a rescue of the original thesis.
- The expected outcome is close: the two models' earlier default-arm fidelity averaged 0.53 (v2), 0.48 (v3) and 0.52 (v4). **Neither result is assumed.**

## Frozen inputs (the run refuses to start if any differs)

| Input | Fingerprint |
|---|---|
| 10 fresh scenes, `scripts/bench-scenes-v5.ts`, declared applicability (bridge toll 0,1 · cracked bow 3 · missed wedding 3 · mother and child 1,4 · rain shelter 0,1 · grandfather 2,4 · settle down 2 · ten years 2,4 · apprentice 0,1 · loose skiff 3); coverage 0:3 1:4 2:3 3:3 4:3; frozen 2026-09-30T15:06:10Z | `f0b07a73f29b8754` |
| Restatement artifact (used only by the exploratory E2 arm), `docs/trait-enactment-rewrites-2026-09-30.json` | sha256[:16] `dab4649505921558` |

## Design

| Element | Choice |
|---|---|
| Verdict arms | `identity` = **the default**: fixture traits as-is with the unchanged production intro · `control` = card + ground rules only |
| Verdict participants | `qwen3.5:9b`, `gpt-oss:20b` |
| Judge | `qwen3.6:35b`, temperature 0 (outside the participant set) |
| Sampling | 3 samples per (model, scene, arm) at temperature 0.7; per-cell median |
| Metric | `trait_adherence` over each scene's declared-applicable traits, applicability-framed judge prompt (as v2–v4), scored against the original trait text |
| Reported, not gated | (a) the `On the page:` restatement arm (E2, the optional setting) for the same two models; (b) `qwen2.5:7b`, both arms, as a floor tier; (c) warmth toward a trusted friend on the Ren scenes (missed wedding, grandfather, settle down, loose skiff) for default vs E2 |

## Pass criteria

Lift(m) = identity − control, mean over the 10 scenes, per-cell medians.

1. Mean lift across the **two** verdict models ≥ **0.15**.
2. Each model's lift ≥ **0.08**.
3. Mean identity `trait_adherence` ≥ **0.50**.
4. For each model, identity beats control on ≥ **6 of 10** scenes (v1–v4's 60%; ties are not wins).
5. σ across models reported, not gated.

**PASS** only if 1–4 all hold; any failure is a **FAIL** naming the criterion.

## After the result (fixed now)

- **PASS:** the docs may state the scoped sentence above, with its limits (two models, one fixture character, one LLM judge, hand-authored traits,
  discount for a post-hoc claim). No public announcement without the user's explicit go-ahead. The optional setting stays optional.
- **FAIL:** the docs state that the identity layer's lift over control is large and consistent, and that it does not reach the 0.50 fidelity
  bar even on the two larger models. The public framing remains "an auditable identity substrate with honest measurement", not a fidelity claim.
- **Either way this is the end of benchmarking against this bar.** No fifth attempt, no re-scoping to a third model subset, no new thresholds on
  these scenes. Further work on identity is a different kind of question (for example whether real play forms a good identity block) and gets its
  own pre-registration.

## Known limits (stated in advance)

- Two verdict models; one of them (`gpt-oss:20b`) is a different family from the other, so the claim cannot be read as "9B-class models in general".
- One hand-authored character, one judge model; the judge is a model too. Judge health (unparseable/error counts) is reported.
- The E2 and 7B results are exploratory. Per-model E2 gains varied by ±0.2 between two earlier runs; no per-model claim will be made from them.
- Nothing here bears on whether real play produces an identity block.
