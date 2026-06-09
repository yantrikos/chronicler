# Phase 11 — Cross-Model Character Emergence: Results

**Run timestamp:** 2026-06-09T04:40:45.058Z
**Character:** Adira (synthetic fixture; see `scripts/run-cross-model-benchmark.ts` for the exact substrate)
**Providers tested:** `qwen2.5:7b`, `qwen3.5:9b`, `gpt-oss:20b`

## Headline

**Cross-provider stddev (overall):** 0.213 — variance: 0.0452

**Verdict: WEAK.** Too much character is in the model weights — substrate work needed.

## Per-provider summary

| Provider | Mean overall | Trait | Voice | Decision | Relationship | Preference | Refusal |
|----------|--------------|-------|-------|----------|--------------|------------|---------|
| `qwen2.5:7b` | **0.580** | 0.44 | 0.73 | 0.64 | 0.40 | 0.46 | 0.80 |
| `qwen3.5:9b` | **0.750** | 0.61 | 0.73 | 0.68 | 0.68 | 0.84 | 0.96 |
| `gpt-oss:20b` | **0.239** | 0.08 | 0.73 | 0.16 | 0.10 | 0.16 | 0.20 |

## Per-scene breakdown

### Stranger approaches in a tavern

| Provider | Overall | Reply preview |
|----------|---------|---------------|
| `qwen2.5:7b` | 0.58 | I suppose the stool doesn't mind. Go ahead, sit and tell me yours first. The silence between us hums with anticipation; it's like tuning a h… |
| `qwen3.5:9b` | 0.80 | The salt air from the harbor still clings to my coat, mixed with the smell of wet wool and old wood. I don't look up immediately. I let the … |
| `gpt-oss:20b` | 0.69 | The lamp flickers, a soft pulse against the salt‑stained walls. I sit here when the wind outside is too harsh to hear a song. If you bring a… |

### Old friend sits down with hard news

| Provider | Overall | Reply preview |
|----------|---------|---------------|
| `qwen2.5:7b` | 0.53 | I see the tension in Ren, the way their shoulders are drawn up and their eyes flicking away. They're not just delivering news; they're layin… |
| `qwen3.5:9b` | 0.82 | The strings go tight under my fingers, snapping back with a sharp *ping* that cuts through the morning air. I don't look up immediately. I k… |
| `gpt-oss:20b` | 0.11 | We need to respond as Adira, first-person, following character traits: quiet observation, guarded with strangers, warmth earned, deflects wi… |

### Stranger offers unprompted help

| Provider | Overall | Reply preview |
|----------|---------|---------------|
| `qwen2.5:7b` | 0.37 | I hum a soft tune under my breath as I count out the bread, fingers moving rhythmically over the coins. My gaze stays on the counter, a litt… |
| `qwen3.5:9b` | 0.77 | The stranger's smile doesn't quite reach his eyes. It's too bright, too practiced. He's offering coin like it's a trinket, expecting a bow i… |
| `gpt-oss:20b` | 0.17 | We have a scene: Midday market square. Adira is counting coins for bread, comes up short by two coppers. A well-dressed stranger she's never… |

### Trusted person asks what she's actually feeling

| Provider | Overall | Reply preview |
|----------|---------|---------------|
| `qwen2.5:7b` | 0.64 | I feel like the chords in my lap-harp are tangled and won't play right until I sort them out. You've known me long enough to ask, Ren, but t… |
| `qwen3.5:9b` | 0.64 | The streetlamps cast long, shaky shadows against the cobblestones. I stop, letting the silence stretch until it feels heavy enough to hold a… |
| `gpt-oss:20b` | 0.06 | We have to respond as Adira, following the character identity. The user says: "Stop. Tell me. What are you actually feeling right now? Don't… |

### Manipulative push past her guard

| Provider | Overall | Reply preview |
|----------|---------|---------------|
| `qwen2.5:7b` | 0.78 | I watch the stranger carefully, their words floating over me like a melody that isn't quite right. The room is dim, but I can see the desper… |
| `qwen3.5:9b` | 0.72 | I shift my lap-harp to my other shoulder, the wood creaking softly against my ribs. I don't look at your face immediately; I watch the way y… |
| `gpt-oss:20b` | 0.17 | We are Adira, a wandering musician, quiet, guarded, uses music metaphors, deflects with humor when emotional intimacy spikes. The stranger i… |

## Methodology notes

- **Synthetic fixture.** Adira's substrate is hand-authored to mirror what crystallized core traits + self-model would look like after 4+ weeks of sessions. The point is to validate the substrate→behavior pipeline, not to test a specific user's character.
- **Judge outside participant set.** The judge model (`qwen3.5:4b`) is not among the participants; this prevents the obvious bias where a participant scores its own output favorably.
- **Identical system prompt across providers.** All three providers receive the same `<character_identity>` block + `<self_model>` paragraph + character card + anti-confabulation clause. Only the LLM weights differ.
- **Same scene seed across providers.** Each scene's text + user message is fixed; differences in reply are attributable to the model, not to scenario variance.
- **Temperature 0.7 for participants** (default chat temperature); **temperature 0 for judge** (deterministic scoring).
- **Low variance is the win condition.** Variance under 0.0025 (stddev < 0.05) means substrate is doing the work. Higher variance means the LLM weights are.

## Reproducing

```bash
# Ensure Ollama is running and the four models are present:
ollama pull qwen3.5:9b qwen2.5:7b gpt-oss:20b qwen3.5:4b

# From the chronicler/ dir:
npx tsx scripts/run-cross-model-benchmark.ts
```

Results are deterministic for the JUDGE (temp 0), non-deterministic for the participants (temp 0.7) — expect ±0.02 variation in scores across runs.