// Slash commands.
//
// User-typed lines starting with `/` are intercepted in `onSend` before
// they reach the LLM. Currently supports dice (TTRPG floor):
//
//   /dice 2d6              → rolls two six-sided dice
//   /roll 1d20+5           → rolls 1d20 with +5 modifier
//   /roll 3d6+2d4-1        → mixed expression with constant
//   /roll 4d6kh3           → roll 4d6, keep highest 3 (D&D ability scores)
//
// Output is a narrator-style turn (role="system") injected into the chat
// log. It's visible to the user and persisted with the session like any
// other turn, but rendered differently in ChatPane so it doesn't look
// like a character's reply. The LLM sees system turns in scene history
// too — important so the character can react to the roll on the next turn.
//
// Unknown commands return null so the message can fall through to the LLM
// (matching the SillyTavern-style behavior where some commands are RP
// shorthand and some are app utilities).

export type SlashCommandKind = "dice" | "roll" | "init" | "help";

export interface SlashResult {
  /** Pretty narrator output, e.g. "🎲 You rolled 2d6: [4, 5] = 9". Shown
   *  in the chat as a system turn. */
  output: string;
  /** Echo of the parsed expression for the inspector. */
  parsed?: string;
}

/** Parse a leading slash command. Returns null if the message isn't a
 *  recognized command — the caller should send it to the LLM as usual. */
export function parseSlash(message: string): {
  kind: SlashCommandKind;
  args: string;
} | null {
  const m = message.trimStart();
  if (!m.startsWith("/")) return null;
  const space = m.indexOf(" ");
  const head = (space === -1 ? m : m.slice(0, space)).toLowerCase();
  const args = space === -1 ? "" : m.slice(space + 1).trim();
  switch (head) {
    case "/dice":
      return { kind: "dice", args };
    case "/roll":
    case "/r":
      return { kind: "roll", args };
    case "/init":
    case "/initiative":
      return { kind: "init", args };
    case "/help":
    case "/?":
      return { kind: "help", args };
    default:
      return null;
  }
}

/** Execute a parsed slash command. Pure: takes a random source so tests
 *  can stub it. Returns null if execution fails (e.g. unparseable dice
 *  expression) — the caller can surface an error toast. */
export function executeSlash(
  cmd: { kind: SlashCommandKind; args: string },
  ctx: { participants: Array<{ id: string; name: string }>; random: () => number }
): SlashResult | null {
  switch (cmd.kind) {
    case "dice":
    case "roll":
      return rollDiceCommand(cmd.args, ctx.random);
    case "init":
      return rollInitiative(ctx.participants, ctx.random);
    case "help":
      return helpText();
  }
}

function rollDiceCommand(
  expr: string,
  rng: () => number
): SlashResult | null {
  const normalized = expr.trim() || "1d20";
  const result = evaluateDiceExpression(normalized, rng);
  if (!result) return null;
  return {
    parsed: normalized,
    output: `🎲 \`${normalized}\` → ${result.breakdown} = **${result.total}**`,
  };
}

function rollInitiative(
  participants: Array<{ id: string; name: string }>,
  rng: () => number
): SlashResult {
  if (participants.length === 0) {
    return { output: "🎲 No participants in scene to roll initiative for." };
  }
  const rolls = participants
    .map((p) => ({ name: p.name, roll: 1 + Math.floor(rng() * 20) }))
    .sort((a, b) => b.roll - a.roll);
  const lines = rolls.map(
    (r, i) => `${i + 1}. **${r.name}** — ${r.roll}`
  );
  return {
    output: `🎲 **Initiative order** (1d20 each):\n${lines.join("\n")}`,
    parsed: `init x${participants.length}`,
  };
}

function helpText(): SlashResult {
  return {
    output: [
      "**Slash commands**",
      "`/dice 2d6` — roll two six-sided dice",
      "`/roll 1d20+5` — roll with modifier; `/r` works too",
      "`/roll 4d6kh3` — roll 4d6, keep highest 3",
      "`/init` — roll initiative for everyone in the scene",
      "`/help` — this list",
    ].join("\n"),
  };
}

// ----------------------------------------------------------------------
// Dice expression evaluator
// ----------------------------------------------------------------------
//
// Grammar:
//   expression := term (('+'|'-') term)*
//   term       := dice | integer
//   dice       := <count>d<faces>(kh<N>|kl<N>)?    // keep-highest / keep-lowest
//
// Examples:
//   "2d6"
//   "1d20+5"
//   "3d6+2d4-1"
//   "4d6kh3"
//
// The breakdown string reports every individual die so users can see the
// roll, e.g. "[4, 5] + 2 = 11".

interface DiceEvalResult {
  total: number;
  breakdown: string;
}

const TOKEN_RE = /\s*([+-])?\s*((?:\d+d\d+(?:k[hl]\d+)?)|\d+)/gi;

export function evaluateDiceExpression(
  expr: string,
  rng: () => number
): DiceEvalResult | null {
  const cleaned = expr.replace(/\s+/g, "");
  if (!cleaned) return null;
  let total = 0;
  const parts: string[] = [];
  let cursor = 0;
  let lastIndex = 0;
  // Implicit leading +
  let sign = 1;
  TOKEN_RE.lastIndex = 0;
  const expanded = cleaned.startsWith("+") || cleaned.startsWith("-")
    ? cleaned
    : `+${cleaned}`;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(expanded)) !== null) {
    const [whole, op, token] = match;
    if (match.index !== lastIndex) return null; // gap → bad expression
    lastIndex = match.index + whole.length;
    if (op === "-") sign = -1;
    else if (op === "+") sign = 1;
    if (/^\d+d\d+/i.test(token)) {
      const rolled = rollDicePart(token, rng);
      if (!rolled) return null;
      total += sign * rolled.sum;
      parts.push(
        `${sign === -1 ? "- " : parts.length === 0 ? "" : "+ "}${rolled.label}`
      );
    } else {
      const n = parseInt(token, 10);
      if (Number.isNaN(n)) return null;
      total += sign * n;
      parts.push(
        `${sign === -1 ? "- " : parts.length === 0 ? "" : "+ "}${n}`
      );
    }
    cursor = lastIndex;
  }
  if (cursor !== expanded.length) return null;
  return { total, breakdown: parts.join(" ") };
}

function rollDicePart(
  token: string,
  rng: () => number
): { sum: number; label: string } | null {
  const m = /^(\d+)d(\d+)(?:(k[hl])(\d+))?$/i.exec(token);
  if (!m) return null;
  const count = parseInt(m[1], 10);
  const faces = parseInt(m[2], 10);
  const keepKind = m[3]?.toLowerCase() as "kh" | "kl" | undefined;
  const keepN = m[4] ? parseInt(m[4], 10) : undefined;
  if (count <= 0 || count > 100) return null; // sanity caps
  if (faces <= 1 || faces > 1000) return null;
  if (keepN !== undefined && (keepN <= 0 || keepN > count)) return null;
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(1 + Math.floor(rng() * faces));
  }
  let kept = rolls;
  let dropped: number[] = [];
  if (keepKind && keepN !== undefined) {
    const sorted = [...rolls]
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (keepKind === "kh" ? b.r - a.r : a.r - b.r));
    const keepIdx = new Set(sorted.slice(0, keepN).map((x) => x.i));
    kept = rolls.filter((_, i) => keepIdx.has(i));
    dropped = rolls.filter((_, i) => !keepIdx.has(i));
  }
  const sum = kept.reduce((s, r) => s + r, 0);
  const droppedStr = dropped.length > 0 ? ` (dropped ${dropped.join(", ")})` : "";
  return {
    sum,
    label: `${token}: [${kept.join(", ")}]${droppedStr}`,
  };
}
