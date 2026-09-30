// Whether a character has any story worth recapping.
//
// The recap is built from a character's canon, but a freshly imported card's
// canon is just its own description — "Previously: Description of Ren: …" —
// which is not a previous anything. YantrikDB strips metadata on read, so
// card-import canon can't be told apart from learned canon at recall time.
// The reliable signal is on the app side: has this character actually been
// played in a session?

import type { SessionMeta } from "../session/store";

/** A greeting alone is one turn; a reply makes two. Anything under that is an
 *  opened-but-untouched chat, not history. */
const MIN_TURNS_FOR_HISTORY = 2;

export function hasStoryHistory(
  sessions: Pick<SessionMeta, "character_ids" | "turn_count">[],
  characterId: string
): boolean {
  return sessions.some(
    (s) => s.character_ids.includes(characterId) && s.turn_count >= MIN_TURNS_FOR_HISTORY
  );
}
