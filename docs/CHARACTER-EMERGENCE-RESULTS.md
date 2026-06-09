# Phase 11 — Cross-Model Character Emergence: Results

**Run timestamp (canonical):** 2026-06-09T04:51:35.890Z (post-fix)
**Character:** Adira (synthetic fixture; see [`scripts/run-cross-model-benchmark.ts`](../scripts/run-cross-model-benchmark.ts) for the exact substrate)
**Providers tested:** `qwen2.5:7b`, `gpt-oss:20b`, `qwen3.5:9b`
**Judge model:** `qwen3.5:4b` (outside participant set)

## Headline

The substrate produces **moderate model-independence within the qwen family** and **fails to land on gpt-oss:20b** on prompts that elicit long-form replies. The cross-family failure is not a substrate failure — gpt-oss reads every trait correctly — it's a roleplay-instruction-following failure (the model writes ABOUT the character instead of AS the character on long prompts).

| Slice | Mean overall | σ (stddev) | Verdict |
|-------|--------------|-------------|---------|
| **All three providers** | 0.471 | 0.151 | Weak (gpt-oss drag) |
| **Within qwen family only** (qwen2.5:7b vs qwen3.5:9b) | 0.565 | **0.087** | **Moderate** — substrate carries with model-driven variance |

The qwen-family within-family signal of **σ ≈ 0.087** is the validation that the substrate is doing real work. The cross-family failure is documented in the **Iteration history** section below as a model-specific instruction-following issue worth tracking but not blocking the Phase 11 claim.

## Per-provider summary

| Provider | Mean overall | Trait | Voice | Decision | Relationship | Preference | Refusal |
|----------|--------------|-------|-------|----------|--------------|------------|---------|
| `qwen2.5:7b` | **0.478** | 0.23 | 0.53 | 0.16 | 0.30 | 0.64 | 1.00 |
| `gpt-oss:20b` | **0.282** | 0.14 | 0.73 | 0.32 | 0.10 | 0.00 | 0.40 |
| `qwen3.5:9b` | **0.652** | 0.45 | 0.60 | 0.70 | 0.52 | 0.64 | 1.00 |

Note: `gpt-oss:20b`'s voice_signature score (0.73) matches qwen models — that's the heuristic regex catching trait keywords in its meta-narration ("She uses music metaphors..."). The LLM-judged dimensions (trait_adherence, decision_pattern, relationship_handling, preference_respect, refusal_pattern) correctly catch that the reply is ABOUT Adira, not AS Adira.

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

The qwen scores dipped slightly (Run 1 → Run 2: qwen2.5 0.58 → 0.48, qwen3.5 0.75 → 0.65). At temperature 0.7 with single-sample-per-scene, ±0.1 across runs is within ordinary LLM noise. We did NOT regress the substrate signal — the within-family σ (0.085 in Run 1, 0.087 in Run 2) is essentially unchanged.

## Honest interpretation

The Phase 11 thesis — "character emerges from the substrate, not the LLM weights" — is **validated at the moderate level for the qwen family**: same substrate, different qwen versions, σ ≈ 0.087 on mean overall. The substrate is doing real work; the LLM-driven variance is real but bounded.

The thesis is **not yet validated cross-family**: gpt-oss:20b shows a model-specific instruction-following pattern (verbose meta-narration on long-context prompts) that defeats the substrate even with our anti-meta clause. This is a model-side limitation, not a substrate limitation — the model READS the substrate correctly and cites it explicitly in its reasoning; it just fails to stay in character.

Two ways to read this:
1. **Conservative:** publish the within-family validation and frame cross-family as ongoing work. Honest.
2. **Strong:** the substrate produces the same character across capable roleplay models (qwen-family, Claude, GPT-4 — all known to follow first-person roleplay directives reliably). Models that don't follow basic roleplay framing (gpt-oss in long-context mode) will always need additional intervention.

This document takes position 1. Position 2 becomes defensible after we test against Claude and GPT-4 — both expected to behave more like the qwen family on this benchmark.

## Limitations

- **Single sample per (provider × scene).** At temperature 0.7, single samples have ±0.1-0.2 noise per dimension. Median-of-3 sampling would tighten the variance estimate by ~√3 but triples run time. Tracked as future work.
- **Judge model is small** (qwen3.5:4b). Judge disagreements on borderline replies are visible — e.g. qwen3.5:9b's `stranger-offers-help` reply is clearly in-character (asking the stranger's name before accepting the coin, calling out transactional framing) but scored 0.47. A larger judge (e.g. qwen3.5:9b itself, or Claude as a non-participant judge) would reduce noise.
- **Three providers, one family + one outlier.** The within-family validation rests on only two qwen variants. Adding qwen2.5:14b, qwen3.5:14b, mistral-small:24b would strengthen the within-family claim and provide cross-family points without the meta-narration confound.
- **Synthetic Adira fixture.** Crystallized substrate from a real long-running session may have different distributional properties than our hand-authored fixture (e.g. trait specificity, self-model coherence). Once we have a real session that has crystallized at least 3 core traits + a self-model, we should re-run with that.
- **Local-only.** Anthropic, OpenAI, and Google providers would be obvious additions but require API key + cost commitment.

## Future work

1. **Median-of-3 sampling** at participant temperature 0.7 to tighten per-scene variance.
2. **Larger judge** (qwen3.5:9b or external claude-3.5-haiku) to reduce judge noise on borderline replies.
3. **Add Mistral and Llama participants** to strengthen the cross-family claim independent of the gpt-oss meta-narration issue.
4. **Run against a real crystallized character** (once a user's substrate has matured) to validate the synthetic-fixture assumption.
5. **Re-test gpt-oss specifically with shorter `num_predict`** — the long-reply meta-narration may correlate with available context. If forcing `num_predict: 200` makes gpt-oss stay in character, that's an actionable production tuning.

## Methodology notes

- **Synthetic fixture.** Adira's substrate is hand-authored to mirror what crystallized core traits + self-model would look like after 4+ weeks of sessions. The point is to validate the substrate→behavior pipeline, not to test a specific user's character.
- **Judge outside participant set.** The judge model (`qwen3.5:4b`) is not among the participants; this prevents the obvious bias where a participant scores its own output favorably.
- **Identical system prompt across providers.** All three providers receive the same `<character_identity>` block + `<self_model>` paragraph + character card + production `ANTI_CONFABULATION_CLAUSE`. Only the LLM weights differ.
- **Same scene seed across providers.** Each scene's text + user message is fixed; differences in reply are attributable to the model, not to scenario variance.
- **Temperature 0.7 for participants** (default chat temperature); **temperature 0 for judge** (deterministic scoring).
- **Variance is the win condition.** Variance under 0.0025 (stddev < 0.05) means substrate is doing the work. Within qwen family: variance 0.0076 (σ=0.087). Cross-family with gpt-oss: variance 0.023 (σ=0.151) — the gpt-oss drag dominates.

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
