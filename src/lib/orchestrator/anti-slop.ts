// Anti-slop: spot the phrasing a model keeps reaching for.
//
// Repetitive, cliché prose is the most-cited complaint about AI roleplay, and
// the usual fix is a hand-maintained ban list. Instead, look at what the
// character actually wrote in the last few replies and name the phrases that
// keep coming back, so the model can be told to find fresh wording.

const STOP = new Set(
  (
    "a an the and or but if then so of to in on at by for with from into onto over under as is are was were be been being " +
    "it its this that these those i you he she we they me him her us them my your his their our not no do does did " +
    "have has had will would can could should may might just very more most some any all each there here what when who how"
  ).split(" ")
);

const MIN_N = 3;
const MAX_N = 6;

function words(text: string): string[] {
  // Actions like *smiles* are prose too; keep the words, drop the markup.
  return text
    .toLowerCase()
    .replace(/[*_~`>#]/g, " ")
    .split(/[^a-z']+/)
    .filter(Boolean);
}

function isContentful(gram: string[]): boolean {
  // Needs at least two words that carry meaning, so "and then he was" never
  // qualifies but "a soft, knowing smile" does.
  return gram.filter((w) => !STOP.has(w) && w.length > 2).length >= 2;
}

export interface OverusedOptions {
  /** A phrase must appear in at least this many separate replies. */
  minReplies?: number;
  max?: number;
  /** Words that are supposed to recur (names, places) — never flagged. */
  ignore?: string[];
}

/** Phrases (3-6 words) that recur across `replies`, most repeated first. */
export function findOverusedPhrases(
  replies: string[],
  opts: OverusedOptions = {}
): string[] {
  const minReplies = opts.minReplies ?? 3;
  const max = opts.max ?? 6;
  if (replies.length < minReplies) return [];
  const ignore = new Set((opts.ignore ?? []).map((w) => w.toLowerCase()));

  // gram -> set of reply indexes it appears in
  const support = new Map<string, Set<number>>();
  replies.forEach((reply, idx) => {
    const ws = words(reply);
    for (let n = MIN_N; n <= MAX_N; n++) {
      for (let i = 0; i + n <= ws.length; i++) {
        const gram = ws.slice(i, i + n);
        if (!isContentful(gram)) continue;
        if (gram.some((w) => ignore.has(w))) continue;
        const key = gram.join(" ");
        let s = support.get(key);
        if (!s) support.set(key, (s = new Set()));
        s.add(idx);
      }
    }
  });

  const hits = [...support.entries()]
    .filter(([, s]) => s.size >= minReplies)
    .map(([gram, s]) => ({ gram, count: s.size, len: gram.split(" ").length }))
    // longest and most repeated first, so a long phrase beats its own fragments
    .sort((a, b) => b.count * b.len - a.count * a.len || b.len - a.len);

  const chosen: string[] = [];
  for (const h of hits) {
    if (chosen.some((c) => c.includes(h.gram))) continue; // fragment of a kept phrase
    chosen.push(h.gram);
    if (chosen.length >= max) break;
  }
  return chosen;
}
