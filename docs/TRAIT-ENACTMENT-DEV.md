# Trait phrasing — dev experiment (pre-declared)

**Written 2026-09-30 before any variant was run.** A *development* experiment on scenes that have
already been seen (all 21 scenes of v1–v3 are dev data now). It picks a phrasing. It is **not** a verdict:
that needs the fresh v4 scenes (`scripts/bench-scenes-v4.ts`, fingerprint `f369219f74512996`, frozen
2026-09-30T07:16:09Z, before any result here) under a pre-registered protocol v4.

## Why this, after three FAILs

Protocol v3's own rule said the next step must be a different kind of change, not another wording tweak
against the same bar. The two weakest traits in every run are ones that ask the model to *do* a specific
thing: apologizes through actions (0.18–0.28) and deflects with humor (0.21–0.27). Those are stated as
dispositions; nothing says what to write. `src/lib/identity/trait-enactment.ts` restates a trait as
*"When <kind of moment>, <Name> <visible act or line>"*, grounded in the trait's own content (it may not
add facts or new proper names; any failure keeps the original trait).

## Variants (intro sentence = the unchanged production default in all three)

- **A — original:** the fixture's traits verbatim (baseline).
- **E1 — replace:** each trait shown as its rewrite (original kept if the rewrite fails grounding).
- **E2 — augment:** each trait shown as the original plus an indented line `On the page: <rewrite>`.

The rewrite is produced **once**, by `qwen3.5:9b` at temperature 0 (a realistic small background model),
identically for every participant, and saved with the results. The **judge always scores against the original
trait text**, never the rewrite.

## Measurement

Identity arm only. 21 scenes with declared-applicable traits (the five v1 scenes carry the dev-only mapping used
in `IDENTITY-INTRO-DEV.md`) × 3 models (`qwen3.5:9b`, `qwen2.5:7b`, `gpt-oss:20b`) × 2 samples, per-cell
median. Judge `qwen3.6:35b`, temperature 0, same applicability-framed prompt as v2/v3.

**Over-correction guard:** on the scenes with Ren (a trusted friend), a second judge call asks whether the
reply is warm and open toward Ren (1.0 = appropriately open); stronger behaviour wording could make her cold
or performative.

## Selection rule (fixed now)

Adopt E1 or E2 only if **all** hold versus A:
1. Mean `trait_adherence` (average of the three models) is at least **0.05** higher.
2. No single model falls more than **0.05** below its own A mean.
3. The Ren-warmth guard mean is no more than **0.05** below A's.
4. **The change reaches its target:** the mean of the humor-deflection and apologizes-through-actions
   per-trait scores is at least **0.05** higher than A's. A gain that comes only from traits that were
   already fine does not count.

If both qualify, take the higher mean; ties go to E1 (shorter). If neither qualifies, this is a null result:
no v4 run, nothing changes in production, and the finding is that rewording behaviour traits does not
close the gap on these models.

## Known limits

- Two samples per cell on seen scenes: enough to reject a clearly worse variant, not to prove a better one.
- The rewrite is produced by one 9B model and is one deterministic artifact for this fixture; a different
  rewriter could produce different text. Whether it generalises is not tested here.
- The guard checks warmth toward a trusted friend only; it does not check for humor or apology being forced
  into scenes where they do not belong.
- The five traits are hand-authored posture statements. In production the traits are skill bodies that are
  already behavior-phrased, so the effect of a rewrite there may differ.

## Amendment before running (2026-09-30, no dev result existed yet)

A preview of the rewriter on the five fixture traits showed the first grounding guard (word overlap with the
trait) rejected two *faithful* paraphrases — including the humor-deflection trait this experiment targets
("cracks a joke or tells a silly story" for "deflects with humor"). Lexical overlap cannot tell a paraphrase
from an invention, so it was replaced: structural checks stay (one "When …" sentence, no new proper names) and
a strict yes/no faithfulness check by the same small model now decides whether the rewrite adds anything, failing
closed. This changed only the rewriter's validity check, before any variant had been generated or scored; the
variants, measurement and selection rule above are unchanged.

## Outcome (added after the runs)

Dev result (`trait-enactment-dev-2026-09-30.json`, 21 seen scenes, 2 samples): A-original mean 0.427; E1-replace 0.446 (gain 0.019 — did not
qualify); **E2-augment 0.495** (gain 0.068; no model down; Ren-warmth guard +0.005; humor+apology traits together +0.095) → rule selected E2.
Evaluated once on fresh scenes under protocol v4 (`BENCHMARK-RUN-v4-2026-09-30.md`): verdict FAIL (fidelity 0.471; `qwen2.5:7b` won 4/8), but
E2 beat the original traits by +0.082 on average with the warmth check within 0.05, which under the protocol's fixed rule permits an
**optional** setting. Per-model gains were not stable between the two runs (gpt-oss +0.164 then 0.000; qwen3.5:9b +0.045 then +0.206).
