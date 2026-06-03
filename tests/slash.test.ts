// Slash commands — parsing + dice evaluation.
// Run: npx tsx tests/slash.test.ts

import {
  parseSlash,
  executeSlash,
  evaluateDiceExpression,
} from "../src/lib/slash/commands";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

// Deterministic RNG for tests — a simple seeded LCG.
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function main(): void {
  console.log("--- slash commands test ---");

  // --- parseSlash ---
  check(parseSlash("hello") === null, "plain text → not a command");
  check(parseSlash("/dice 2d6")?.kind === "dice", "/dice parsed");
  check(parseSlash("/roll 1d20+5")?.kind === "roll", "/roll parsed");
  check(parseSlash("/r 1d6")?.kind === "roll", "/r alias parsed as roll");
  check(parseSlash("/init")?.kind === "init", "/init parsed");
  check(parseSlash("/initiative")?.kind === "init", "/initiative alias parsed");
  check(parseSlash("/help")?.kind === "help", "/help parsed");
  check(parseSlash("/unknown 42") === null, "unknown command → fallthrough");
  check(parseSlash("  /dice 1d6")?.args === "1d6", "leading whitespace tolerated");

  // --- evaluateDiceExpression ---
  const rng = seeded(42);
  // With seeded RNG, calling Math.floor((seeded() * 6) + 1) twice gives
  // specific numbers. We check structure rather than specific values
  // (other than total = sum of parts).
  const r1 = evaluateDiceExpression("2d6", rng);
  check(r1 !== null, "2d6 parses");
  check(r1!.total >= 2 && r1!.total <= 12, `2d6 total in [2,12] (got ${r1!.total})`);

  const r2 = evaluateDiceExpression("1d20+5", rng);
  check(r2 !== null, "1d20+5 parses");
  check(r2!.total >= 6 && r2!.total <= 25, `1d20+5 total in [6,25] (got ${r2!.total})`);
  check(r2!.breakdown.includes("+ 5"), "breakdown shows modifier");

  const r3 = evaluateDiceExpression("3d6+2d4-1", rng);
  check(r3 !== null, "mixed expression parses");
  check(r3!.total >= 3 + 2 - 1 && r3!.total <= 18 + 8 - 1, "mixed total in range");

  const r4 = evaluateDiceExpression("4d6kh3", rng);
  check(r4 !== null, "keep-highest parses");
  check(r4!.total >= 3 && r4!.total <= 18, "4d6kh3 in [3,18]");
  check(r4!.breakdown.includes("dropped"), "kh shows dropped die");

  const r5 = evaluateDiceExpression("4d6kl3", rng);
  check(r5 !== null, "keep-lowest parses");
  check(r5!.total >= 3 && r5!.total <= 18, "4d6kl3 in [3,18]");

  // Bad expressions
  check(evaluateDiceExpression("", rng) === null, "empty → null");
  check(evaluateDiceExpression("garbage", rng) === null, "garbage → null");
  check(evaluateDiceExpression("0d6", rng) === null, "0 dice → null");
  check(evaluateDiceExpression("1d1", rng) === null, "1-sided → null");
  check(
    evaluateDiceExpression("1000d6", rng) === null,
    "absurd count → null (sanity cap)"
  );
  check(
    evaluateDiceExpression("1d20kh3", rng) === null,
    "keep more than rolled → null"
  );

  // Deterministic exact total via fully-stubbed RNG
  const stub = (() => {
    const seq = [0, 0.5, 0.999]; // first value used; values map to floor(value*faces)+1
    let i = 0;
    return () => seq[i++ % seq.length];
  })();
  const exact = evaluateDiceExpression("1d20", stub);
  check(exact?.total === 1, `seeded 1d20 → 1 (got ${exact?.total})`);

  // --- executeSlash ---
  const detRng = seeded(7);
  const dice = executeSlash(
    { kind: "dice", args: "2d6" },
    { participants: [], random: detRng }
  );
  check(dice !== null, "executeSlash dice returns result");
  check(dice!.output.startsWith("🎲"), "dice output has emoji marker");
  check(dice!.output.includes("2d6"), "dice output echoes expression");

  const init = executeSlash(
    { kind: "init", args: "" },
    {
      participants: [
        { id: "ren", name: "Ren" },
        { id: "mei", name: "Mei" },
      ],
      random: detRng,
    }
  );
  check(init !== null, "executeSlash init returns result");
  check(init!.output.includes("Ren"), "init mentions participant Ren");
  check(init!.output.includes("Mei"), "init mentions participant Mei");
  check(
    init!.output.toLowerCase().includes("initiative"),
    "init output labeled"
  );

  const help = executeSlash(
    { kind: "help", args: "" },
    { participants: [], random: detRng }
  );
  check(help !== null, "executeSlash help returns result");
  check(help!.output.includes("/dice"), "help mentions /dice");
  check(help!.output.includes("/roll"), "help mentions /roll");
  check(help!.output.includes("/init"), "help mentions /init");

  const noOne = executeSlash(
    { kind: "init", args: "" },
    { participants: [], random: detRng }
  );
  check(
    noOne?.output.toLowerCase().includes("no participants"),
    "init with no participants returns friendly message"
  );

  const badDice = executeSlash(
    { kind: "dice", args: "garbage" },
    { participants: [], random: detRng }
  );
  check(badDice === null, "executeSlash returns null on bad dice expression");

  console.log("\n--- PASS: slash commands ---");
}

main();
