# Cross-model character benchmark — protocol v3 (pre-registered)

**Written 2026-09-30, before any v3 reply was generated.**
v1 and v2 stand as recorded (both FAIL, criterion 3 only). This protocol tests one specific change.

## What is being tested

The wording of the sentence that introduces `<character_identity>` (variant **B — enact**, chosen in
`IDENTITY-INTRO-DEV.md` by its pre-declared rule on already-seen scenes). The selection was
marginal: mean gain 0.052 against a 0.05 bar, two samples per cell, and the gain came mostly from
one model (`qwen3.5:9b` +0.11; `gpt-oss:20b` −0.01). Its behaviour-trait effect was small
(apologizes-through-action 0.11 → 0.23; humor deflection 0.25 → 0.29). **It is a candidate, not a
finding.** Production still uses the original wording until this protocol reports.

## Design

| Element | Choice |
|---|---|
| Scenes | **8 fresh scenes** in `scripts/bench-scenes-v3.ts`, fingerprint `ee00498f76a69862`, written and frozen at 2026-09-30T05:26:15Z — *before* the dev experiment's results were known — and never used in any dev run |
| Declared applicability | per scene (0/1: ferry passenger, gate officer · 3: torn songbook, forgotten medicine · 2+4: inscribed gift, old teacher · 1+4: widower · 2: stage fright), fixed in the scene file; every trait covered ≥ 2 times |
| Arms (verdict) | `identity` = **variant B** intro; `control` = card + ground rules only |
| Arm (exploratory, not gated) | `identity-default` = the current production intro, to see whether B beats it on unseen scenes |
| Participants / judge / sampling | as v2: `qwen3.5:9b`, `qwen2.5:7b`, `gpt-oss:20b`; judge `qwen3.6:35b` at temperature 0; 3 samples per cell, per-cell median |
| Metric | `trait_adherence` over the scene's declared-applicable traits, applicability-framed judge prompt (identical to v2) |

## Pass criteria (identical numbers to v1 and v2)

Lift(m) = identity(B) − control, mean over the 8 scenes, per-cell medians.

1. Mean lift across the three models ≥ **0.15**.
2. Every model's lift ≥ **0.08**.
3. Mean identity(B) `trait_adherence` ≥ **0.50**.
4. For every model, identity(B) beats control on ≥ **5 of 8** scenes.
5. σ across models is reported, not gated.

**PASS** only if 1–4 all hold. Any failure is a **FAIL**, naming the criterion. Thresholds are the
same as v1 and v2 — not lowered after two misses and not raised.

## Exploratory reading (never a verdict)

The `identity-default` arm is reported alongside as B − default (mean and per model). Because
three arms × 8 scenes is a small sample, this comparison is descriptive: if B does not beat the
default here, the honest reading is that the intro wording did not matter measurably, whatever
the dev experiment suggested.

## What happens after the result

- **PASS:** the claim is limited to this fixture and setup. B may then be made the production
  default on the grounds that it is at least as good as the default; no announcement without
  the user's explicit go-ahead.
- **FAIL:** the result is recorded. B stays out of production unless the exploratory arm shows it
  clearly ahead of the default (B − default ≥ 0.05 on this fresh set); that judgment is made
  and stated explicitly, not implied.
- **No fourth attempt on the same numbers.** After three failures, the honest position is that the
  0.50 fidelity bar is not reached by these models with this identity block, and the next step is
  a different kind of change (for example how behaviour traits are extracted and phrased), not
  another wording tweak against the same bar.

## Known limits

- Same hand-authored character, same judge model, same three participants as v1/v2.
- Eight scenes; a per-scene 5-of-8 requirement is a coarse test.
- The v3 scenes were written after v2's per-trait results were known (apology and humor deflection
  were weak). Their trait coverage is the same as v2's (apology 2 scenes, humor 3, music 3, quiet
  observation 2, guarded 3 vs 4), so I did not make the set easier or harder for those traits
  by count, but the situations themselves are new and absolute scores are not directly comparable
  to v2's.
- This says nothing about whether real play produces such an identity block.
