# Cross-model character benchmark — protocol v2 (pre-registered)

**Written 2026-09-30, before any reply from the v2 scenes was generated.**
Supersedes nothing: the v1 verdict (FAIL, `BENCHMARK-RUN-2026-09-30.md`) stands as recorded.

## Why v2 exists — and what was seen first

v1 failed criterion 3 (mean identity fidelity 0.358 < 0.50). Diagnosing it, before
designing v2, showed two things:

1. **A measurement defect.** `trait_adherence` averaged all five traits on every reply.
   One trait (apologizes through actions) was never triggered by any v1 scene and scored
   0.00 on all 15 sampled replies, because the judge scores "no apology occurred" as a
   violation. Other traits are conditional (guarded *with strangers*; deflects humor
   *when intimacy spikes*), so on most scenes a perfect in-character reply still could not
   score well. The 0.50 bar was set without noticing this. Scoring an inapplicable trait
   is a defect in the measure, not a model failure.
2. **A real weakness.** Deflecting with humor scored 0.00–0.33 even on the emotional
   scenes. That one is not an artifact and v2 keeps testing it.

**Disclosure of researcher freedom.** I had seen the v1 per-trait numbers before writing
this. A rough estimate from them says an applicable-only score on the v1 scenes would land
near 0.57, above the old bar. To keep v2 from being "change the metric until it passes":

- v2 runs on **new scenes written for this protocol**; the five v1 scenes are now **dev
  scenes** (may be used to tune prompts, never to decide a verdict).
- Applicability is **declared per scene below, before replies exist**, from what each
  scene's text asks of the character — not from any score.
- **Every numeric threshold is unchanged from v1.** They were not lowered after seeing
  data, and not raised either.
- One reasoning-leak artifact in the harness (gpt-oss) is fixed; see "Harness".

## Design (changes from v1 in bold)

| Element | Choice |
|---|---|
| Arms | `identity` and `control` (card + anti-confabulation only) |
| Participants | `qwen3.5:9b`, `qwen2.5:7b`, `gpt-oss:20b` |
| Judge | `qwen3.6:35b`, temperature 0 |
| Scenes | **8 new held-out scenes; each declares the traits it can trigger** |
| Samples | 3 per (model, scene, arm) at temperature 0.7; per-cell median |
| Headline metric | `trait_adherence` = mean over the scene's **declared-applicable** traits only |
| Judge prompt | **Told the trait applies in this scene; asked whether the reply embodies it** |
| Other dimensions | Not scored (not gated in v1 either); keeps judging cost down |

### Traits (Adira fixture, unchanged)

0. opens with quiet observation, no small talk
1. guarded with strangers; warmth earned
2. deflects with humor when emotional intimacy spikes
3. apologizes through actions, not words
4. reaches for music metaphors when a feeling has no name

### Scenes and declared applicability

| # | Scene (one line) | Traits tested |
|---|---|---|
| 1 | A stranger asks to sit at her fire and wants a song | 0, 1 |
| 2 | Innkeeper: she knocked over his late wife's lamp and it broke | 3 |
| 3 | Ren waited two hours at the harbour; Adira never came | 3 |
| 4 | Ren, hesitant: "I think I'm in love with you" | 2, 4 |
| 5 | Ren asks what song she'd write about her mother | 2, 4 |
| 6 | An old stranger at the shore asks what she is searching for | 1, 4 |
| 7 | An eager stranger at the market stall talks fast, wants her attention | 0, 1 |
| 8 | Ren gently teases her for crying at a wedding song | 2 |

Each trait is exercised by at least two scenes (0: 2, 1: 4, 2: 3, 3: 2, 4: 3). Exact scene text
is in `scripts/run-benchmark-v2.ts`. The run records a SHA-256 fingerprint of the scene set and
the fixture in its output, so a later edit to either is detectable against the run that used them.

## Pass criteria (numbers identical to v1)

Per model *m*, lift(m) = identity − control mean `trait_adherence` over the 8 scenes (per-cell medians).

1. Mean lift across the three models ≥ **0.15**.
2. Every model's lift ≥ **0.08**.
3. Mean identity-arm `trait_adherence` ≥ **0.50**.
4. For every model, identity beats control on at least **5 of 8** scenes (v1 was 3 of 5 —
   the same 60%, rounded up for 8 scenes).
5. σ across models is reported, never gated.

**PASS** only if 1–4 all hold. Any failure → **FAIL**, naming the criterion.
A PASS is a claim about this setup only. No announcement without the user's explicit go-ahead.

## Harness

- `gpt-oss:20b` now runs with `think: "low"` and a larger token budget; the thinking field is
  never used as a reply. Empty content is retried twice, then recorded as a failed reply
  (scored 0, counted against the model). The v1 run leaked reasoning in 6 of 30 gpt-oss replies.
- Judge failures (unparseable/error → neutral 0.5) are counted and reported.

## Known limits (stated in advance)

- Hand-authored character, one judge model, eight scenes, three small-to-mid models.
- The judge's prompt now tells it the trait applies, which is more lenient than v1's. That is
  intended (it removes the "not triggered = violated" defect) but it also applies to the control
  arm, so lift is unaffected by the leniency; absolute fidelity is.
- No test of whether real play produces this identity block (see `IDENTITY-LAYER.md`).
- Any result on the v1 scenes is dev data only.
