// Out-of-character (OOC) directives.
//
// Roleplayers steer stories with inline asides — ((push the plot)), [OOC: …]
// — and every other tool makes the model read them as dialogue. Here a
// directive is a first-class channel: it is lifted out of the in-fiction text,
// handed to the model once as a private director's note, and never stored as
// something a character said or a fact to remember.

const PATTERNS: RegExp[] = [
  /\(\(([\s\S]*?)\)\)/g, // ((like this))
  /\[\s*OOC\s*:\s*([\s\S]*?)\]/gi, // [OOC: like this]
  /\(\s*OOC\s*:\s*([\s\S]*?)\)/gi, // (OOC: like this)
];

/** What a turn that was only a directive reads as inside the fiction. */
export const OOC_PLACEHOLDER = "*The scene continues.*";

export interface OocSplit {
  /** The in-character text with every directive removed. */
  spoken: string;
  /** Each directive's inner text, in order. */
  directives: string[];
}

export function splitOoc(text: string): OocSplit {
  const directives: string[] = [];
  let spoken = text;
  for (const re of PATTERNS) {
    spoken = spoken.replace(re, (_m, inner: string) => {
      const d = inner.trim();
      if (d) directives.push(d);
      return " ";
    });
  }
  return { spoken: spoken.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(), directives };
}

/** A user turn as the model should read it in the story: directives removed,
 *  and a neutral line when nothing in-character was left (an empty message
 *  would be rejected by most providers). */
export function forNarrative(text: string): string {
  const { spoken, directives } = splitOoc(text);
  if (spoken) return spoken;
  return directives.length > 0 ? OOC_PLACEHOLDER : text;
}

/** True when a message was purely a directive, with nothing spoken. */
export function isDirectiveOnly(text: string): boolean {
  const { spoken, directives } = splitOoc(text);
  return spoken === "" && directives.length > 0;
}
