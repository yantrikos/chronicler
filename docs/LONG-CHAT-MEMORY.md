# Long-chat memory — "the story so far"

## The problem
The model reads only the last ~10 messages. Everything older survives only as
scattered extracted facts, so in a long roleplay the thread of *what happened, and
in what order* is lost — a promise, a name, where something was hidden. Players
patch this by hand with manual summaries. This makes it native.

## The design
- **Chapters, not one running summary.** Rewriting a summary over and over
  slowly corrupts it (the game of telephone). Each chapter is written **once**,
  straight from the raw messages (a chunk of 6), and is never re-summarised. Only
  the very oldest chapters are ever folded into a coarser "earlier" paragraph.
- **No message is ever in neither place.** The raw history the model reads starts
  at the first message no chapter covers (never fewer than 10 messages, never more
  than 15), so the boundary can't hide anything. (Checked at every chat length
  0–79 in a test.)
- **Visible and editable.** The chapters sit above the chat. Edit or delete any;
  an edited chapter is the player's and is never rewritten or merged away.
- **Real history in the prompt.** Framed as `<story_so_far>`, "treat it as canon".
- **Never stalls, never invents on a hiccup.** Model unreachable → nothing is
  written, try later. Unusable output → retry once without the context (the usual
  trigger for a small model copying it), then a plain extract of the messages so
  coverage still advances. A chunk that is only steering directives is skipped.
- Cost: about one small model call per three exchanges. Synced to the server with
  the rest of a chat; a Settings checkbox turns it off.

## Measured (`scripts/chronicle-eval.ts`)
A scripted story with facts planted early, then questions asked as the character,
first with today's behaviour (last 10 messages only), then with the chronicle.
Keyword-graded. Writers and readers were qwen3.5:4b and qwen3.5:9b; three runs.

**38 messages, 6 questions** (facts from messages 4–28; no merging needed):

| Reader | today | with the chronicle |
|---|---|---|
| 4B | 2–4 of 6 | 6 of 6 in 11 of 12 runs (one 5/6) |
| 9B | 3–4 of 6 | 6 of 6 in 12 of 12 runs |

**86 messages, 10 questions** (oldest facts sit behind merged chapters):

| | today | with the chronicle |
|---|---|---|
| pooled 4B + 9B readers | about 30% | **93%** (112/120, larger-budget config) |

**What measuring found and fixed**
1. A rejected duplicate chapter blocked every later chunk → the stall-proof step
   (retry without context, then extract).
2. Small models re-told earlier events *reworded*, defeating exact-match dedupe →
   fuzzy overlap check.
3. **Merging chopped off the oldest facts.** The "earlier" paragraph kept only its
   newest 1,600 characters, so the keeper's name and the hidden key vanished. It
   now re-condenses the old paragraph *together with* the chapters folded in
   (compress, never truncate).
4. A larger budget for the earlier paragraph and the prompt block (1,100 and
   2,800 characters) lifted the long-story score from about 84% to about 93%.
5. One "miss" was my own ambiguous question (the lantern was also lent). Fixed.

## Limits (be honest)
- One scripted story (two blocks for the long one), regex-graded, 3 runs. A real
  100+ message roleplay is messier; minor details (a smuggler's name, a lent
  compass) are still the first to be squeezed out of merged chapters.
- Each merge is a lossy re-summarisation of the oldest material. In a very long
  chat the "earlier" paragraph will keep the big beats and lose small ones — edit
  it if something matters.
- The first pass over an existing long chat runs in the background, one chapter
  per few seconds; the chat works normally meanwhile.
- Chapters describe the story; they are not canon facts and are not written to
  memory. The prompt block is out of band of the 4,000-token composer budget
  (about 700 tokens at most).
