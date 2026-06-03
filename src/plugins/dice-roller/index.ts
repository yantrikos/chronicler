// Dice Roller — first-party Grimoire entry demonstrating slash command
// result rendering. /roll 2d6+3 returns a system message in chat with the
// roll breakdown. Pure compute; no permissions needed.
//
// Why dice? The most discoverable extension type in a roleplay client.
// Users immediately understand "I type /roll, dice happen."

import {
  defineGrimoire,
  type GrimoireManifest,
} from "../../lib/grimoire/types";

export const manifest: GrimoireManifest = {
  id: "io.chronicler.dice-roller",
  name: "Dice Roller",
  version: "0.1.0",
  apiVersion: "^0.1.0",
  description: "Slash command for dice notation: /roll 2d6+3, /flip, /pick",
  author: "Chronicler Labs",
  license: "MIT",
  keywords: ["dice", "rp", "ttrpg"],
  permissions: {
    network: [],
    filesystem: "plugin-data-only",
    llm: false,
    memory: false,
  },
  contributes: {
    commands: ["roll", "flip", "pick"],
  },
};

export default defineGrimoire({
  id: "io.chronicler.dice-roller",

  setup(ctx) {
    ctx.commands.register({
      name: "roll",
      description: "Roll dice notation — /roll 2d6+3, /roll d20, /roll 4d6kh3",
      run: (args) => {
        const notation = args.trim() || "d20";
        try {
          const r = rollNotation(notation);
          return {
            kind: "text",
            content: `🎲 **${notation}** → **${r.total}** ${r.breakdown}`,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { kind: "error", content: `/roll: ${msg}` };
        }
      },
    });

    ctx.commands.register({
      name: "flip",
      description: "Flip a coin",
      run: () => {
        const heads = Math.random() < 0.5;
        return {
          kind: "text",
          content: `🪙 ${heads ? "**Heads**" : "**Tails**"}`,
        };
      },
    });

    ctx.commands.register({
      name: "pick",
      description: "Pick one item from a comma-separated list",
      run: (args) => {
        const opts = args
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (opts.length < 2) {
          return {
            kind: "error",
            content: "Usage: /pick option1, option2, option3",
          };
        }
        const picked = opts[Math.floor(Math.random() * opts.length)];
        return { kind: "text", content: `🎯 **${picked}** _(from ${opts.length})_` };
      },
    });

    return {};
  },
});

interface RollResult {
  total: number;
  breakdown: string;
}

/** Parse dice notation: NdS[+/-M] or NdSkhK / NdSklK (keep highest/lowest K).
 *  Returns total + a human-readable breakdown showing each die. */
function rollNotation(input: string): RollResult {
  const s = input.toLowerCase().replace(/\s+/g, "");
  // Match: optional count + 'd' + sides + optional keep-high/low + optional modifier
  const m = s.match(/^(\d*)d(\d+)(k[hl]\d+)?([+-]\d+)?$/);
  if (!m) throw new Error(`bad notation: ${input}`);
  const [, countStr, sidesStr, keep, modStr] = m;
  const count = countStr === "" ? 1 : Number(countStr);
  const sides = Number(sidesStr);
  if (count < 1 || count > 100) throw new Error("dice count must be 1-100");
  if (sides < 2 || sides > 1000) throw new Error("sides must be 2-1000");

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(1 + Math.floor(Math.random() * sides));
  }

  let kept = rolls;
  if (keep) {
    const km = keep.match(/^k([hl])(\d+)$/);
    if (km) {
      const dir = km[1];
      const k = Number(km[2]);
      const sorted = [...rolls].sort((a, b) => (dir === "h" ? b - a : a - b));
      kept = sorted.slice(0, Math.min(k, sorted.length));
    }
  }

  const mod = modStr ? Number(modStr) : 0;
  const subtotal = kept.reduce((a, b) => a + b, 0);
  const total = subtotal + mod;

  const breakdown =
    count > 1 || mod !== 0 || keep
      ? `_(${formatRolls(rolls, kept)}${mod !== 0 ? ` ${mod >= 0 ? "+" : ""}${mod}` : ""})_`
      : "";

  return { total, breakdown };
}

function formatRolls(rolls: number[], kept: number[]): string {
  if (rolls.length === kept.length) {
    return rolls.join(" + ");
  }
  // Strike-through the dropped dice for visual clarity in markdown
  const keptSet = new Set(kept);
  let kCount = 0;
  return rolls
    .map((r) => {
      if (keptSet.has(r) && kCount < kept.filter((k) => k === r).length) {
        kCount++;
        return String(r);
      }
      return `~~${r}~~`;
    })
    .join(" + ");
}
