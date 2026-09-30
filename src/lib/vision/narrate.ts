// How a shared image reads inside the story.
//
// The model never sees the image — it sees a stage direction carrying the
// (player-approved) description. That direction is built here and ONLY here,
// so the rules stay in one place:
//   • it goes to the chat model's prompt and the lorebook scan;
//   • it does NOT go to memory extraction, the scene board or the ledger —
//     those read what the player actually typed, so a vision model's guess
//     ("possibly her mother") can never become a remembered fact;
//   • it is attached to the USER turn, which is never regenerated, so
//     swiping the reply never re-describes.

import type { ChatTurn } from "../orchestrator/types";
import { forNarrative } from "../orchestrator/ooc";

/** e.g. `*[An image is shown: A brass key on a table.]*` — reads as stage
 *  direction, not as something the player said. */
export function imageDirection(turn: Pick<ChatTurn, "attachments">): string {
  const ds = (turn.attachments ?? []).map((a) => a.description.trim()).filter(Boolean);
  if (ds.length === 0) return "";
  return ds.map((d) => `*[An image is shown: ${d.replace(/[\]]+/g, ")")}]*`).join("\n");
}

/** A user turn as the story model should read it: image directions first, then
 *  what was said (with any out-of-character directives removed). */
export function narrateUserTurn(turn: Pick<ChatTurn, "content" | "attachments">): string {
  const dir = imageDirection(turn);
  if (!dir) return forNarrative(turn.content);
  const spoken = turn.content.trim() ? forNarrative(turn.content) : "";
  // forNarrative supplies "*The scene continues.*" for directive-only turns;
  // with an image present the direction already carries the turn.
  const said = spoken === "*The scene continues.*" ? "" : spoken;
  return said ? `${dir}\n${said}` : dir;
}
