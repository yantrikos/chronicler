# Scene tracker — what we measured

The scene board (location, time, mood, who is present, objectives, what the
player carries) is kept current by one small model call per reply. This is how
well that works on local models, and what changed as a result of measuring it.

**Method.** `scripts/scene-tracker-eval.ts` plays a scripted six-turn scene
(bookshop → docks; a key is received, pocketed and handed over; a character
arrives and leaves; a final turn where nothing should change) and checks 13
facts against the board. Ollama, `temperature 0.1`, thinking off, JSON mode.

**Limits.** One scripted scene, 13 checks, a handful of runs. It shows the
approach is sound and where it breaks; it is not a benchmark. Real play is
messier (pronouns, long replies, several NPCs).

## Results

| Model | "delta" prompt | "board" prompt | + evidence guard |
|---|---|---|---|
| qwen2.5:1.5b | 7/13 | 6/13 | 6/13 |
| qwen3.5:4b (Chronicler default) | 7/13 | 12/13 | 13, 11, 13, 11 of 13 |
| qwen3.5:9b | 6/13 | 10/13 | 13/13 in 4 of 4 runs |
| qwen3.6:35b | 12/13 | — | 13/13 |

## What we learned

1. **The first design was wrong for small models.** Asking for "only what
   changed, as add/remove operations" is hard: small models miss moves and
   almost never emit removals. Asking for the *complete updated board* and
   letting code compute the change took the 4B from 7/13 to 12/13.
2. **A model's own claim is not evidence.** Even the 35B listed a key as "used
   up" when the player merely pocketed it. So a person or item is dropped from
   the board only if a sentence naming it also says it went (handed over,
   dropped, left, vanished…). A pronoun sentence ("She tips her cap and walks
   off") borrows the name from up to three sentences back, unless someone else
   on the board is named in between.
3. **Additions must be grounded.** A new person or item has to be mentioned in
   the exchange, which stops invented characters.
4. **Small bugs hide in markup.** Roleplay action markup (`*she nods.*`) glued
   sentences together and hid who had left; stripping it before splitting fixed
   two failures.

## Known weaknesses

- The 4B sometimes fails to drop an item the player hands over (about half the
  runs here). It is the model's omission; forcing removals from verbs would get
  "she hands me the key" wrong.
- Models add trivial items ("coat") that are technically mentioned.
- 1–2B models are not usable for this; Settings says so.
- `delta` mode remains in the code for strong models but is not the default.
