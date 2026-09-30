# Identity layer — the verifier fix, and a consistency audit

## 1. The verifier that rejected almost everything

**The suspicion** (from the launch-gate notes): SkillFormer writes behaviors in
action-oriented, situational language ("Ren deflects emotional questions with
bookshop metaphors") and the core-trait verifier rejects that shape, so the
identity layer may never fill from ordinary play.

**Measured** (`scripts/core-trait-eval.ts`): 34 labelled candidates written the way
SkillFormer writes them — 8 real identity patterns, 8 situational habits, 8 generic
model tics, and 10 *hard* negatives (verbal tics, mannerisms triggered by a
situation, topical enthusiasm, vague virtues).

| Model | real traits accepted, before | after the fix | wrongly accepted after (of 26 negatives) |
|---|---|---|---|
| qwen3.5:4b | 0 / 8 | 5–6 / 8 | 0 |
| qwen3.5:9b | 1 / 8 | 6 / 8 | 0 |
| qwen3.6:35b | 2 / 8 | 6 / 8 | 0 |

(After = two runs. The 26 negatives = 8 situational + 8 tics — the first 16 —
plus the 10 hard ones, all rejected in every run.)

**The cause was the verifier's own criterion**, not (only) SkillFormer's phrasing:
"if you can construct a scene where the candidate trait would not apply, it is not
an identity trait" is unsatisfiable — such a scene exists for *any* behavior. It
also contradicted the prompt's own list of qualifying examples. It now says a
trait may be triggered by a *kind* of situation (emotional pressure, being accused,
being shown kindness…) because those recur across unrelated scenes, and rejects only
what is tied to a place, object, task or time, physical mannerisms, procedures,
single-topic reactions, capabilities and vague virtues.

**Tried and removed:** an *abstraction* step (restate the behavior as a
context-independent posture before verifying). The postures were good, but it did
not raise acceptance (5–6 / 8 vs 6 / 8) and once let a situational habit through
on the 35B. Unnecessary, so it was deleted.

**Still true:** the two real patterns still rejected are arguably tied to an object
("jokes about her guitar") and a role ("critiques prose"). And promotion has
quantitative gates too (net score ≥ 8 over ≥ 4 sessions and ≥ 7 days), so in real
use traits will take days of play to appear. Nothing here shows the layer working
end to end on real play, or that it improves the cross-model benchmark (mean trait
adherence was 0.275).

## 2. The consistency audit

Drift from the character card is the complaint players raise most. The audit
measures it directly: **Menu → Check character consistency**.

- **What it checks against:** declared traits extracted once from the card into
  short, checkable statements (one per described behavior), plus any core traits.
  Editable before running — it audits exactly the list you see. It therefore works
  even if the identity layer never fills.
- **How:** a model reads each reply (up to the newest 60) against the traits, four
  at a time, and must **quote** the offending words; a flag is discarded if the
  quote isn't in the reply, if the trait number is invalid, or if its own
  explanation says the reply is consistent.
- **Shows:** a score (% of replies with no contradiction), per-trait counts, and
  each flagged reply with the quote, the reason, and a jump to it in the chat.

**Measured** (`scripts/audit-eval.ts`: 2 characters × 16 replies written to be
consistent, plainly contradicting, subtly contradicting, or neutral):

| Judge | plain contradictions caught | subtle caught | false flags on 18 innocent replies |
|---|---|---|---|
| qwen3.5:4b | 8 / 10 | 4 / 4 | 1 |
| qwen3.5:9b | 10 / 10 | 4 / 4 | 0 |
| qwen3.6:35b | 10 / 10 | 4 / 4 | 0 |

**Found while building it**
1. Judging all traits in one call let the 9B miss a plain contradiction it caught in
   two groups of four → groups of four.
2. Asking for "3–6 traits" made models drop described behaviors (covering 3–4 of 5);
   "one per described behavior" covers 5 of 5 on every model.
3. A flag whose own reasoning said "this aligns with the trait" was still reported →
   such flags are dropped.
4. **The audit can only check what is on the list.** With traits extracted before
   the coverage fix, a torn-page reply went unflagged because "protective of his
   books" had been dropped. After it, all three planted contradictions in a
   12-reply chat were caught and the nine innocent replies left alone (real 9B,
   run inside the app).

**Limits.** 32 hand-written replies, two characters, one run per model. The one
recurring false flag is a borderline reply ("Nothing. It's nothing." for a
character who goes quiet when walled off). A valid flag sometimes drags in an extra
trait the reply merely doesn't show, inflating per-trait counts. A clean score is
not proof, and small models miss more. It measures consistency *with the card*, not
whether the card is a good character.

## Optional: "On the page:" restatements of core traits (default off)

Setting: **Settings → Character identity → "Spell out what a character's core traits look like on the page"** (`enact_traits`).

When on, each core trait shown in `<character_identity>` gets one extra line, for example:

```
- Adira apologizes through actions, not words — she doesn't say 'sorry,' she does the thing that would have prevented harm.
    On the page: When she realizes her mistake has caused harm, Adira immediately performs the corrective action needed to fix it without uttering an apology.
```

How it works: the background model restates a trait once ("When <kind of moment>, <Name> <visible act or line>"), with a structural check
(one "When …" sentence, no new proper names) and a faithfulness check ("does this add anything the trait does not say?"); both fail closed to the
plain trait. Restatements are cached in the browser by trait text (`chronicler.identity.enact.v1`, not synced), so an edited trait gets a fresh one
and a rejected one is not retried every turn. They go only into the prompt; the consistency audit still sees the plain traits.

What the evidence supports (`BENCHMARK-RUN-v4-2026-09-30.md`): on fresh scenes the restated traits scored +0.082 over the same traits shown plainly
(mean of three models), with warmth toward a trusted friend unchanged within noise. **What it does not support:** per-model gains were not stable
between two runs (`gpt-oss:20b` +0.164 then 0.000; `qwen3.5:9b` +0.045 then +0.206), the five-run benchmark series still fails its 0.50 fidelity
bar (best 0.471; the last run tested a narrowed two-model claim and also failed), and a 7B model stays near the floor with or without it. It is offered as experimental for that reason, not as a fix.

Verified: the pure logic and cache (`tests/trait-enactment.test.ts`, 32 checks), the settings toggle in a real browser against an isolated
server (renders, defaults off, persists, reload-stable). **Not verified end to end:** the background generation effect and the prompt change on a
character that has actually crystallised core traits — that needs skills in the database, which the isolated in-memory run does not have.
