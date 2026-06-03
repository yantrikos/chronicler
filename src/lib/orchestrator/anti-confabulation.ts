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
  /** Scene Intensity snippet (Fade to Black / Tasteful / Explicit).
   *  Wrapped in <intensity> tags so the prompt inspector shows it as a
   *  distinct block — users can audit exactly what was injected. Empty
   *  string for Neutral mode (no injection). */
  intensitySnippet?: string;
  /** Active preferences split by sensitivity. Rendered as three blocks:
   *  <preferences> (ordinary), <private_preferences> (intimate user-
   *  confirmed), <limits> (user-confirmed boundaries). A trailing
   *  "tendencies not rules" instruction is appended automatically when
   *  any block is present — load-bearing anti-fossilization clause. */
  preferences?: {
    ordinary: string[];
    private: string[];
    limits: string[];
  };
  /** User-typed identity notes (sub/dom/role labels). Manual-only;
   *  never auto-generated. Rendered as <identity_notes> when set. */
  identityNotes?: string;
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
  if (opts.intensitySnippet && opts.intensitySnippet.trim().length > 0) {
    parts.push(
      `<intensity>\n${opts.intensitySnippet.trim()}\n</intensity>`
    );
  }
  // Preferences — ordinary auto-active, private + limits user-confirmed.
  // Each block only appears when it has content. Trailing "tendencies
  // not rules" instruction is appended once if ANY block is present —
  // it's the load-bearing brake against the model treating preference
  // memory as iron canon and over-performing it.
  const p = opts.preferences;
  const hasAnyPref =
    p && (p.ordinary.length > 0 || p.private.length > 0 || p.limits.length > 0);
  if (hasAnyPref) {
    const sections: string[] = [];
    if (p!.ordinary.length > 0) {
      sections.push(
        `  <ordinary>\n${p!.ordinary.map((s) => `    - ${s}`).join("\n")}\n  </ordinary>`
      );
    }
    if (p!.private.length > 0) {
      sections.push(
        `  <private>\n${p!.private.map((s) => `    - ${s}`).join("\n")}\n  </private>`
      );
    }
    if (p!.limits.length > 0) {
      sections.push(
        `  <limits>\n${p!.limits.map((s) => `    - ${s}`).join("\n")}\n  </limits>`
      );
    }
    parts.push(
      `<character_patterns>\n${sections.join("\n")}\n</character_patterns>\n\nTreat the patterns above as remembered tendencies, not rules. They describe what's been observed in past scenes — prefer what's actually happening in the current moment when it conflicts. The character can grow, change, surprise. Use these as bedrock to come back to, not a script to follow.`
    );
  }
  if (opts.identityNotes && opts.identityNotes.trim().length > 0) {
    parts.push(
      `<identity_notes>\n${opts.identityNotes.trim()}\n</identity_notes>`
    );
  }
  parts.push(ANTI_CONFABULATION_CLAUSE);
  return parts.join("\n\n");
}
