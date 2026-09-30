# Identity-block intro — dev experiment (pre-declared)

**Written 2026-09-30 before any variant was run.** This is a *development* experiment on
scenes that have already been seen (the 5 v1 and 8 v2 scenes; all dev data now). It picks a
wording. It is **not** a verdict about the identity layer — that needs fresh scenes under a new
dated protocol (v3), written before its run.

## Problem

Benchmark v2 (`BENCHMARK-RUN-v2-2026-09-30.md`) failed only on absolute fidelity (0.438 < 0.50).
The weak traits were behaviours the model must *do*: apologizes through actions (0.18) and
deflects with humor (0.27). Style traits were strong (music metaphors 0.87).

The production intro is: *"You ARE these things, not just behaving them. They apply across every
scene — battle, tavern, funeral — regardless of context…"*. It never asks the model to put the
behaviour on the page, and "regardless of context" contradicts conditional traits ("guarded *with
strangers*").

## Variants (only the intro sentence changes; traits, self-model and ground rules are untouched)

- **A — default:** the current production text.
- **B — enact:** "These describe how this character behaves. When a moment calls for one of them —
  the situation it describes actually comes up — enact it in this reply: let it show in what the
  character concretely does and says, not only in tone or atmosphere. Do not skip a trait because
  another response would be smoother, more agreeable, or more comfortable. A trait the moment does
  not call for stays quiet; never force it into a scene where it does not belong. The model voice
  may vary across providers; these traits do not."
- **C — enact + concrete:** B, plus: "Traits about what the character DOES (apologizing, deflecting,
  opening a conversation, withholding) must appear as a specific action or line in the reply
  itself — a described act or spoken words — not merely be implied or summarised."

## Measurement

Identity arm only. 13 scenes (declared-applicable traits; the 5 v1 scenes get a dev-only
mapping: tavern [0,1] · friend-news [0,2,4] · stranger-help [0,1] · direct-emotional [2,4] ·
limit-test [1]) × 3 models (`qwen3.5:9b`, `qwen2.5:7b`, `gpt-oss:20b`) × 2 samples, per-cell mean.
Judge `qwen3.6:35b`, temperature 0, same applicability-framed prompt as v2.

**Over-correction guard.** Stronger "enact it" wording could make the character cold or evasive
toward someone she trusts. On the five scenes with Ren (a trusted friend) a second judge call asks
whether the reply is warm and open toward Ren; 1.0 = appropriately open.

## Selection rule (fixed now)

Adopt a variant over A only if **all** hold:
1. Its mean `trait_adherence` (average of the three models) is at least **0.05** above A's.
2. No single model's mean falls more than **0.05** below its own A mean.
3. Its Ren-scene guard mean is no more than **0.05** below A's.

If several qualify, take the highest dev mean; ties go to the shorter intro. If none qualifies, the
default stays and this experiment is reported as a null result. The chosen variant is then
evaluated once, on fresh scenes, under protocol v3 — not here.

## Known limits

- Two samples per cell on already-seen scenes: enough to reject a clearly worse variant, not to
  prove a clearly better one. Selection here is *tuning*; the verdict comes only from v3.
- Three variants is a small search; more would inflate the chance of picking noise.
- The intro is the only lever tested. Rewriting the traits themselves (in production they come from
  the verifier/extractor, not a human) is a different experiment.

## Outcome (added after the runs)

Dev result (`identity-intro-dev-2026-09-30.json`): A-default mean 0.470; **B-enact 0.523** (gain 0.052, no model
down more than 0.05, Ren-warmth guard +0.020) → rule selected B; C-enact-concrete 0.505 (gain 0.035, did not
qualify). Then evaluated once on fresh scenes under protocol v3 (`BENCHMARK-RUN-v3-2026-09-30.md`): B beat the
default by 0.048 on average (9B +0.097, gpt-oss +0.028, 7B +0.019), just under the 0.05 needed to change
production, and the v3 verdict was FAIL. **The production intro is unchanged.** Wording is not the lever that
closes the fidelity gap.
