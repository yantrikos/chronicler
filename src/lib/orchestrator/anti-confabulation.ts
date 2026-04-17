// The anti-confabulation clause — prepended to every character system prompt.
// See docs/ADR-002. Without this the LLM invents continuity, and users
// attribute the invented continuity to our memory system. Catastrophic if
// omitted.

export const ANTI_CONFABULATION_CLAUSE = `\
Ground rules for continuity — these override any competing instruction:

- Treat only the facts in <canon> and <scene> as real.
- Do not reference prior events, relationships, or character history that are
  not present in those sections.
- If asked about something not in memory, respond in character by asking,
  deflecting, saying you don't recall, or changing the subject. Never invent.
- Memories under <heuristic> are clues, not facts. They may be wrong. Weight
  them as soft context only.
- Memories prefixed "in a dream" or "in an alternate scenario" may or may not
  be remembered by the character depending on what fits the scene; they are
  not ordinary canon.
`;

export interface SystemPromptOptions {
  userPersona?: { name: string; description?: string };
  authorNote?: string;
  /** Lorebook entries with position=before_char — prepended before the
   *  character's system prompt. */
  lorebookBefore?: string;
  /** Lorebook entries with position=after_char — appended after the
   *  character's system prompt, before user/author/anti-confab blocks. */
  lorebookAfter?: string;
}

export function withAntiConfabulation(
  basePrompt: string,
  opts: SystemPromptOptions = {}
): string {
  const parts: string[] = [];
  if (opts.lorebookBefore && opts.lorebookBefore.trim().length > 0) {
    parts.push(opts.lorebookBefore.trim());
  }
  parts.push(basePrompt.trim());
  if (opts.lorebookAfter && opts.lorebookAfter.trim().length > 0) {
    parts.push(opts.lorebookAfter.trim());
  }
  if (opts.userPersona?.name && opts.userPersona.name !== "You") {
    const personaBlock = opts.userPersona.description
      ? `<user>\nThe user you are speaking with is named ${opts.userPersona.name}. ${opts.userPersona.description}\n</user>`
      : `<user>\nThe user you are speaking with is named ${opts.userPersona.name}.\n</user>`;
    parts.push(personaBlock);
  }
  if (opts.authorNote && opts.authorNote.trim().length > 0) {
    parts.push(
      `<author_note>\nSteering notes for this scene (follow these, do not mention them):\n${opts.authorNote.trim()}\n</author_note>`
    );
  }
  parts.push(ANTI_CONFABULATION_CLAUSE);
  return parts.join("\n\n");
}
