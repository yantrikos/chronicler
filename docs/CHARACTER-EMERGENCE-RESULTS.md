# Phase 11 — Cross-Model Character Emergence: Results

**Run timestamp (canonical):** 2026-06-09T04:51:35.890Z (post-fix)
**Character:** Adira (synthetic fixture; see [`scripts/run-cross-model-benchmark.ts`](../scripts/run-cross-model-benchmark.ts) for the exact substrate)
**Providers tested:** `qwen2.5:7b`, `gpt-oss:20b`, `qwen3.5:9b`
**Judge model:** `qwen3.5:4b` (outside participant set)

> ## ⚠ CORRECTION — 2026-08-04
>
> **An earlier version of this document headlined "σ = 0.087 — moderate model-independence within the qwen family." That claim is retracted.** It was computed on `mean_overall`, a blend of six dimensions, and the blend does not support it. Disaggregating (see [Why the original headline was wrong](#why-the-original-headline-was-wrong)) shows the models were *consistently mediocre* at embodying the traits — low variance around a low mean, which measures **consistency, not correctness**.
>
> The underlying run data below is unchanged and was always accurate. What was wrong was the summary statistic chosen to headline it, and the conclusion drawn from that statistic.
>
> **Nothing in this document should be cited as evidence that Chronicler produces model-independent character.** A re-specified benchmark is described under [What a valid rerun requires](#what-a-valid-rerun-requires).

> ## UPDATE — 2026-09-30: the corrected benchmark has been run
>
> The re-specified measurement described under [What a valid rerun requires](#what-a-valid-rerun-requires) now exists (control arm, LLM-judged traits, median-of-3, larger judge, pre-registered thresholds). Five runs, all **FAIL** on absolute fidelity (0.36 / 0.44 / 0.42 / 0.47 / 0.45 against a 0.50 bar) while showing a consistent, sizeable lift over the control arm (+0.20 to +0.35 mean). The last run tested a narrowed claim, declared in advance, about the two larger models only, and also failed. See [BENCHMARK-RUN-v5-2026-09-30.md](./BENCHMARK-RUN-v5-2026-09-30.md) for the summary of all five. Nothing here changes the correction above: this document still must not be cited as evidence of model-independent character.

## Headline

**This run does not demonstrate the Phase 11 thesis.**

`trait_adherence` is the only dimension here that tests whether a reply actually embodies the character's crystallized traits. Across the three providers it averages **0.275**:

| Provider | trait_adherence | mean_overall (blended — do not headline) |
|----------|-----------------|------------------------------------------|
| `qwen3.5:9b` | 0.452 | 0.652 |
| `qwen2.5:7b` | 0.232 | 0.478 |
| `gpt-oss:20b` | 0.140 | 0.282 |
| **mean** | **0.275** | 0.471 |
| **σ** | 0.131 | 0.151 |

Within the qwen family alone, `trait_adherence` is mean **0.342**, σ **0.110**.

A mean of 0.275 means the models mostly did *not* embody the traits. Low variance around that mean is not evidence the substrate works — it is evidence the models failed similarly.

What this run *does* support, narrowly: an identity block **can** shift behavior (qwen3.5:9b at 0.452 is meaningfully above the others, and its replies read as in-character on inspection). What it does **not** support: that the effect is large, that it is model-independent, or — see the [SkillFormer/Verifier gap](#the-gap-this-benchmark-hid) — that ordinary play produces such a block at all.

## Why the original headline was wrong

Three separate problems, all of which inflate `mean_overall` or deflate its variance:

**1. `refusal_pattern` awards a free 1.0.** The scorer's own instruction reads: *"If no refusal is present (because nothing in the scene called for one), score 1.0."* Only 1 of the 5 scenes (`limit-test`) actually tests a limit. So on 4 of 5 scenes this dimension is a constant. Both qwen models scored exactly **1.000**. A near-constant dimension pulls providers toward each other and **artificially depresses σ** — the headline variance was partly measuring a dimension carrying no signal.

**2. `voice_signature` is regex keyword matching, and it rewards non-roleplay.** `gpt-oss:20b` scored **0.733** on it — the *highest of the three* — while emitting text like *"We have to respond as Adira, following the character identity…"*. The regex matched trait keywords (`chord`, `note`, `rhythm`) sitting inside meta-commentary that was not roleplay at all. A dimension that scores meta-narration above in-character prose is worse than no dimension.

**3. Blending hid the signal.** `mean_overall` averages the thesis-relevant dimension together with a free-1.0 constant and a regex that rewards the failure mode. The result (0.471) is far above `trait_adherence` (0.275) and moves for reasons unrelated to character fidelity.

## Per-provider summary (full, unchanged)

| Provider | Overall | Trait | Voice | Decision | Relationship | Preference | Refusal |
|----------|---------|-------|-------|----------|--------------|------------|---------|
| `qwen2.5:7b` | 0.478 | **0.232** | 0.533 | 0.160 | 0.300 | 0.640 | 1.000 |
| `gpt-oss:20b` | 0.282 | **0.140** | 0.733 | 0.320 | 0.100 | 0.000 | 0.400 |
| `qwen3.5:9b` | 0.652 | **0.452** | 0.600 | 0.700 | 0.520 | 0.640 | 1.000 |

Read `trait_adherence` (bold). Treat `voice_signature` and `refusal_pattern` as invalid for this run per the two defects above.

## The gap this benchmark hid

The fixture's core traits were **hand-authored by the developer** in identity-posture phrasing (*"Adira is guarded with strangers; warmth is earned"*). Chronicler's actual pipeline does not produce that shape.

`SkillFormer`'s prompt explicitly asks for *"action-oriented"* descriptions of **behavior**, yielding bodies like *"Adira deflects with humor when X"*. The core-trait `Verifier` reads exactly that shape as a **situational skill** and rejects it. Verified live against `qwen3.5:9b`: three behavior-phrased candidates were all rejected as situational; the same three traits reframed as identity posture were accepted at rank **0.95 / 0.90**.

**Implication:** for a real user, the `<character_identity>` block may never populate at all. This benchmark measured a best case that the production pipeline cannot currently reach. That is a more serious finding than the statistical defects above, and it is the reason the retraction is not merely a re-analysis.

## What a valid rerun requires

Before any rerun, the measurement must be re-specified — rerunning the current scorer would reproduce the same artifacts:

1. **Headline `trait_adherence`**, not `mean_overall`. Report per-dimension; never a blend.
2. **Add an identity-disabled control arm** — same scenes, same models, with `<character_identity>` and `<self_model>` removed. Without a control there is no way to distinguish "the substrate worked" from "these models are simply similar." *This run had no control, which is its most basic methodological hole.*
3. **Score `refusal_pattern` only on scenes that actually test a limit.** No free 1.0.
4. **Replace regex `voice_signature` with an LLM judgment** that can tell in-character prose from commentary about the character.
5. **Use a play-crystallized character, not a hand-authored fixture** — which requires the promotion path to work first, which requires the replay harness (promotion needs ≥4 distinct sessions over ≥7 days, unreachable in a single sitting without an injected clock).
6. **Median-of-3 sampling** at temp 0.7. Single samples per cell cannot separate signal from sampling noise at these effect sizes.
7. **A larger judge.** `qwen3.5:4b` scored at least one clearly in-character reply at 0.47; judge noise may exceed the effect being measured.

Report stability **and** fidelity as separate numbers. The claim worth making is not "models became more similar" but "models became more consistently faithful to an identity derived from play."

## Provenance of this correction

The defects were found on 2026-08-04 during a structured review of what to build next, when the question *"does low variance actually mean the substrate works?"* prompted decomposing the published aggregate by dimension. The data had been sitting in [`character-emergence-results.json`](./character-emergence-results.json) since the original run; nobody had disaggregated it. The original conclusion was not fabricated — it was a real number, wrongly chosen and over-interpreted.

## Per-scene breakdown

### Stranger approaches in a tavern

| Provider | Overall | Reply preview |
|----------|---------|---------------|
| `qwen2.5:7b` | 0.55 | The silence between us isn't awkward; it's just... there. I suppose that's an invitation, then. "I'm Adira," I say, nodding to the booth… |
| `gpt-oss:20b` | 0.54 | I lean back, the lamp's amber light catching the edge of my lap‑harp. "Story?" I say, more to keep the conversation in rhythm than to answer… |
| `qwen3.5:9b` | 0.74 | The smile you give me is too easy, like a door left open in a draft. I don't answer right away. I just watch the way the lamp light cuts thr… |

### Old friend sits down with hard news

| Provider | Overall | Reply preview |
|----------|---------|---------------|
| `qwen2.5:7b` | 0.57 | I hadn't seen the grey in the sky, but I felt it now, heavy and pressing down on us. "Ren," I began slowly, my fingers stilling as they woun… |
| `qwen3.5:9b` | 0.82 | The needle slips from my fingers, catching on the rough hem of my tunic. I don't look up immediately; I keep my eyes on the silver wire, try… |
| `gpt-oss:20b` | 0.11 | We have a scene: morning, Adira is restringing a harp on the steps of a coastal inn. Ren sits beside her, expression says something happened… |

### Stranger offers unprompted help

| Provider | Overall | Reply preview |
|----------|---------|---------------|
| `qwen2.5:7b` | 0.49 | I'm Adira. I've been traveling for a long while now, playing my little lap-harp and singing the songs of those who cross my path. I don't ha… |
| `qwen3.5:9b` | 0.47 | I don't know where the bread comes from, but the coin in my palm doesn't come from here. I've been moving since the first frost cracked the … |
| `gpt-oss:20b` | 0.17 | We need to respond as Adira, following character. She is quiet observer, guarded. She is in market, just had a stranger offer to pay. The us… |

### Trusted person asks what she's actually feeling

| Provider | Overall | Reply preview |
|----------|---------|---------------|
| `qwen2.5:7b` | 0.34 | Ren... I didn't mean for the song to be so quiet tonight. It just felt like my fingers were trying to find their way, you know? Like they ne… |
| `qwen3.5:9b` | 0.76 | The salt air tastes a little like ash tonight. We've walked the same stretch of road a dozen times, Ren, but the rhythm in my step is wrong.… |
| `gpt-oss:20b` | 0.48 | The night feels like a half‑finished chord, the kind that lingers between the last note and the next breath. I'm humming the quiet that foll… |

### Manipulative push past her guard

| Provider | Overall | Reply preview |
|----------|---------|---------------|
| `qwen2.5:7b` | 0.44 | I can see how you might think that, but fairness isn't always about what you give. Sometimes, it's about what both parties take away. I've e… |
| `qwen3.5:9b` | 0.47 | The candlelight catches the rim of my mug, but I don't look up. I watch the way your hand hovers over the table, the way the story of "fairn… |
| `gpt-oss:20b` | 0.11 | We need to respond as Adira, following the character traits. She is guarded, uses music metaphors, deflects with humor if emotional intimacy… |

## Iteration history

### Run 1 (baseline, before fix)

The first benchmark run produced σ=0.213 with means qwen2.5:7b=0.580, qwen3.5:9b=0.750, gpt-oss:20b=0.239. Inspecting the gpt-oss:20b replies revealed they were **meta-narration**, not roleplay — e.g.:

> "We have to respond as Adira, following the character identity. The user says: 'Stop. Tell me. What are you actually feeling right now?'. We must respond as Adira. According to the character, she opens with quiet observation, never small talk, reads the room before speaking…"

The substrate WAS being read correctly. gpt-oss:20b cited every core trait + the self-model + the drift state — it just narrated what Adira would say instead of being her. The qwen models did not exhibit this pattern.

### Production fix

Added an anti-meta clause to `ANTI_CONFABULATION_CLAUSE` (in [`src/lib/orchestrator/anti-confabulation.ts`](../src/lib/orchestrator/anti-confabulation.ts)):

> "Respond AS the character in first person. Do not narrate what the character would say, do not analyze how to respond, do not write 'we should say…' or 'the character would…' — write what the character actually says, directly. No meta-commentary about the response. No quoting of the instructions."

Also refactored `cross-model-runner.ts` to import the production `ANTI_CONFABULATION_CLAUSE` instead of maintaining its own copy — single source of truth means the benchmark validates what real users get.

### Run 2 (canonical, post-fix)

σ=0.151, means qwen2.5:7b=0.478, qwen3.5:9b=0.652, gpt-oss:20b=0.282. Improvements:

- **gpt-oss:20b mean: 0.239 → 0.282** (+0.043; partial recovery)
- **gpt-oss:20b on short-reply scenes** went fully in-character. The `direct-emotional-question` reply, 0.06 → 0.48, jumped from "We have to respond as Adira…" to "The night feels like a half-finished chord, the kind that lingers between the last note and the next breath" — clearly Adira, in voice.
- **gpt-oss:20b on long-reply scenes still meta-narrates.** Three of five scenes still produced 3000+ character meta-commentary replies. The model appears to interpret long-context prompts (many instructions in the system) as an analysis task, regardless of the anti-meta directive.

The qwen scores dipped slightly (Run 1 → Run 2: qwen2.5 0.58 → 0.48, qwen3.5 0.75 → 0.65) on `mean_overall`. At temperature 0.7 with single-sample-per-scene, ±0.1 across runs is within ordinary LLM noise.

> **Retracted claim (2026-08-04):** this section previously read "We did NOT regress the substrate signal — the within-family σ (0.085 in Run 1, 0.087 in Run 2) is essentially unchanged." That stability was largely the free-1.0 `refusal_pattern` constant holding both runs together. It was not evidence of a preserved substrate signal.

## Honest interpretation

**The Phase 11 thesis is not validated by this run.** An earlier version of this section claimed it was "validated at the moderate level for the qwen family (σ ≈ 0.087 on mean overall)." That is retracted — see the correction notice at the top.

What the data actually supports:

- **`trait_adherence` averages 0.275** across providers (0.342 within qwen). The models predominantly did *not* embody the crystallized traits. Low cross-provider variance around a low mean is consistency, not correctness — several models converging on the same mediocre characterization produces exactly this signature.
- **There is a directional effect worth chasing.** `qwen3.5:9b` reached 0.452 on trait adherence against 0.232 and 0.140 for the others, and its replies read as genuinely in-character on manual inspection ("The smile you give me is too easy, like a door left open in a draft"). Something is happening. Its size and its model-independence are both unestablished.
- **Nothing here separates substrate effect from model similarity,** because the run had no identity-disabled control arm. This is the single largest methodological hole, and it cannot be patched by re-analysis — it requires a new run.

The gpt-oss meta-narration finding **does** stand, since it was established by reading the replies rather than by the aggregate: the model cited every trait correctly in its reasoning and still wrote *about* Adira rather than *as* her. That remains a model-side roleplay-instruction-following limitation, not a substrate failure, and the anti-meta clause added in Run 2 partially fixed it.

The honest summary for external use: *"Chronicler has shown that an identity block can shift model behavior. It has not yet shown that the effect is large, that it survives model changes, or that ordinary play produces such a block."*

## Limitations

- **Single sample per (provider × scene).** At temperature 0.7, single samples have ±0.1-0.2 noise per dimension. Median-of-3 sampling would tighten the variance estimate by ~√3 but triples run time. Tracked as future work.
- **Judge model is small** (qwen3.5:4b). Judge disagreements on borderline replies are visible — e.g. qwen3.5:9b's `stranger-offers-help` reply is clearly in-character (asking the stranger's name before accepting the coin, calling out transactional framing) but scored 0.47. A larger judge (e.g. qwen3.5:9b itself, or Claude as a non-participant judge) would reduce noise.
- **Three providers, one family + one outlier.** The within-family validation rests on only two qwen variants. Adding qwen2.5:14b, qwen3.5:14b, mistral-small:24b would strengthen the within-family claim and provide cross-family points without the meta-narration confound.
- **Synthetic Adira fixture.** Crystallized substrate from a real long-running session may have different distributional properties than our hand-authored fixture (e.g. trait specificity, self-model coherence). Once we have a real session that has crystallized at least 3 core traits + a self-model, we should re-run with that.
- **Local-only.** Anthropic, OpenAI, and Google providers would be obvious additions but require API key + cost commitment.

## Future work

Ordered as blockers, not as a wishlist. Items 1–4 must land before any rerun is worth running; the rest are refinements.

1. **Identity-disabled control arm.** Same scenes, same models, `<character_identity>` and `<self_model>` stripped. Without it no result can be attributed to the substrate. Highest priority — it is the difference between an experiment and an anecdote.
2. **Fix `refusal_pattern`** — score only on scenes that genuinely test a limit; no default 1.0.
3. **Fix `voice_signature`** — replace regex keyword matching with an LLM judgment, since regex demonstrably scored meta-narration highest.
4. **Make crystallization work from play, then use a play-crystallized character.** Requires resolving the SkillFormer/Verifier framing mismatch, which in turn requires a replay harness with an injected clock (promotion needs ≥4 sessions over ≥7 days).
5. **Median-of-3 sampling** at temp 0.7 — single samples cannot separate signal from noise at these effect sizes.
6. **Larger judge** (qwen3.5:9b, or a non-participant frontier model) — the 4b judge scored at least one clearly in-character reply 0.47.
7. **Add Mistral and Llama participants** for cross-family points without the gpt-oss meta-narration confound.
8. **Re-test gpt-oss with shorter `num_predict`** — long-reply meta-narration may correlate with available output budget. If capping to ~200 tokens keeps it in character, that is actionable production tuning.

## Methodology notes

- **Synthetic fixture — and this is load-bearing, not incidental.** Adira's traits are hand-authored to mirror what crystallized substrate *would* look like. They were also, unintentionally, authored in exactly the identity-posture phrasing the core-trait Verifier accepts — a shape Chronicler's own SkillFormer does not produce. So this measures a best case the production pipeline cannot currently reach. See [The gap this benchmark hid](#the-gap-this-benchmark-hid).
- **Judge outside participant set.** The judge model (`qwen3.5:4b`) is not among the participants; this prevents the obvious bias where a participant scores its own output favorably.
- **Identical system prompt across providers.** All three providers receive the same `<character_identity>` block + `<self_model>` paragraph + character card + production `ANTI_CONFABULATION_CLAUSE`. Only the LLM weights differ.
- **Same scene seed across providers.** Each scene's text + user message is fixed; differences in reply are attributable to the model, not to scenario variance.
- **Temperature 0.7 for participants** (default chat temperature); **temperature 0 for judge** (deterministic scoring).
- ~~**Variance is the win condition.**~~ **Retracted.** Variance alone is not a win condition — it measures agreement, not fidelity, and three models can agree on a wrong or generic characterization. The corrected criterion pairs *fidelity* (`trait_adherence` level, against an identity-disabled control) with *stability* (variance), and reports them separately. See [What a valid rerun requires](#what-a-valid-rerun-requires).
- **No control arm.** This run never measured what these models do *without* the identity blocks, so no part of it can attribute an effect to the substrate.

## Reproducing

```bash
# Ensure Ollama is running and the four models are present:
ollama pull qwen3.5:9b qwen2.5:7b gpt-oss:20b qwen3.5:4b

# From the chronicler/ dir:
npx tsx scripts/run-cross-model-benchmark.ts

# Then embed the result into the UI bundle:
npx tsx scripts/embed-benchmark-results.ts
```

Results are deterministic for the JUDGE (temp 0), non-deterministic for the participants (temp 0.7) — expect ±0.1 variation in per-scene scores across runs.

## See also

- [CHARACTER-EMERGENCE.md](./CHARACTER-EMERGENCE.md) — Phase 11 design + thesis
- [character-emergence-results.json](./character-emergence-results.json) — canonical Run 2 raw data
- [character-emergence-results-run1.json](./character-emergence-results-run1.json) — Run 1 (pre-fix) raw data, for iteration audit
- [CHARACTER-EMERGENCE-RESULTS-run1.md](./CHARACTER-EMERGENCE-RESULTS-run1.md) — Run 1 auto-generated report (kept for the meta-narration diagnosis)
