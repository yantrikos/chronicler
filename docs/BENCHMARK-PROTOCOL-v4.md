# Cross-model character benchmark — protocol v4 (pre-registered)

**Written 2026-09-30T08:11Z, before any v4 reply was generated.**
v1–v3 stand as recorded (all FAIL, criterion 3 only). v3's own rule said the next attempt must be a
different kind of change than wording; this tests one.

## What is being tested

**Trait enactment phrasing.** Each core trait is shown to the model as the original text plus an indented line
`On the page: <a one-sentence restatement: "When <kind of moment>, <Name> <visible act or line>.">`
(variant **E2-augment** of `TRAIT-ENACTMENT-DEV.md`). The restatement is produced once by `qwen3.5:9b` at
temperature 0 with a structural check and a faithfulness check (`src/lib/identity/trait-enactment.ts`). The intro
sentence is the unchanged production default.

Selected by the dev experiment's pre-declared rule on already-seen scenes: mean gain +0.068 over the original
traits (bar +0.05), the two behavior traits together +0.095 (bar +0.05), no model down more than 0.05, trusted-friend
warmth guard +0.005. **It is a candidate, not a finding.** In that dev run `qwen2.5:7b` did not move (0.220 →
0.214); the gain was carried by `gpt-oss:20b` (+0.16) and `qwen3.5:9b` (+0.045). Production is unchanged.

## Frozen inputs (the run refuses to start if either differs)

| Input | Fingerprint |
|---|---|
| 8 fresh scenes, `scripts/bench-scenes-v4.ts`, with declared per-scene trait applicability (well 0,1 · spilled ink 3 · missed vigil 3 · promise ring 2,4 · father's letter 2,4 · lock-keeper 0,1 · tavern widow 1,4 · first solo 2), frozen 2026-09-30T07:16:09Z before any dev result | `f369219f74512996` |
| The restatements, `docs/trait-enactment-rewrites-2026-09-30.json` | sha256[:16] `dab4649505921558` |

## Design (as v2/v3 except where stated)

| Element | Choice |
|---|---|
| Arms (verdict) | `identity` = fixture traits + `On the page:` lines, default intro · `control` = card + ground rules only |
| Arm (exploratory, not gated) | `identity-original` = the fixture's traits as-is, default intro |
| Participants, judge, sampling | `qwen3.5:9b`, `qwen2.5:7b`, `gpt-oss:20b`; judge `qwen3.6:35b` (temperature 0); 3 samples per cell, per-cell median |
| Metric | `trait_adherence` over the scene's declared-applicable traits, applicability-framed prompt. **The judge always scores against the original trait text, never the restatement.** |
| Reported, not gated | A trusted-friend warmth check (1.0 = appropriately warm/open toward Ren) on the Ren scenes (missed vigil, promise ring, first solo), for both `identity` and `identity-original` |

## Pass criteria (numbers identical to v1–v3)

Lift(m) = identity − control, mean over the 8 scenes, per-cell medians.

1. Mean lift across the three models ≥ **0.15**.
2. Every model's lift ≥ **0.08**.
3. Mean `identity` `trait_adherence` ≥ **0.50**.
4. For every model, `identity` beats control on ≥ **5 of 8** scenes.
5. σ across models is reported, not gated.

**PASS** only if 1–4 all hold; any failure is a **FAIL** naming the criterion.

## After the result (fixed now)

- **PASS:** the claim is limited to this fixture, these models and this judge. Turning restatements into a
  production feature (a promotion-time rewrite stored with each trait and rendered as `On the page:`) is then
  justified, behind a setting, and still gets the user's explicit go-ahead before it ships. No announcement.
- **FAIL, but `identity` beats `identity-original` by ≥ 0.05 on this fresh set, with the warmth check not worse by
  more than 0.05:** the feature may be built as an **optional** setting on the strength of that improvement over
  today's behaviour, and the FAIL is stated with it. The fidelity bar is still unmet and no claim is made.
- **FAIL otherwise:** nothing changes in production. Rewording and restating traits are then both tried and
  neither closes the gap; the honest positions left are a scoped claim (a pre-registered protocol for a
  larger-model tier) or a different kind of change. **No further run against this bar with these three
  models.**

## Known limits

- Same hand-authored character, one judge, three participants.
- Eight scenes; 5-of-8 is coarse.
- One rewriter model produced one deterministic artifact; whether restatements generalise to other traits,
  characters or rewriters is not tested.
- In production the traits are skill bodies already phrased as behavior, so the effect there may differ from the
  effect on this hand-authored posture fixture.
- Says nothing about whether real play produces an identity block.
