// The limits registry, and a guard so hard-coded token limits cannot creep back in.
// Run: npx tsx tests/limits.test.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defaultTokenBudget } from "../src/lib/orchestrator/types";
import { LIMITS, limit, limitFrom, limitDef, limitOverride, sanitizeLimit, setLimitOverrides, type LimitKey } from "../src/lib/limits";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

console.log("--- the registry itself ---");
const keys = LIMITS.map((l) => l.key);
check(new Set(keys).size === keys.length, "every limit has a unique key");
check(LIMITS.every((l) => l.label.length > 3 && l.help.length > 10), "every limit has a label and a help text");
check(LIMITS.every((l) => l.default >= l.min && l.default <= l.max && l.min <= l.max), "every default lies inside its own range");
check(limit("bg.extract") === 600 && limit("bg.scene_board") === 300 && limit("bg.self_model") === 4000 && limit("reply.default_tokens") === 1024 && limit("prompt.total_tokens") === 4000 && limit("prompt.scene_pct") === 0.25 && limit("proxy.first_byte_s") === 600 && limit("proxy.idle_s") === 180 && limit("gate.quiet_ms") === 1500 && limit("gate.max_retries") === 3, "the defaults are exactly the values that used to be hard-coded");

console.log("--- overrides ---");
setLimitOverrides({ "bg.extract": 900, "prompt.canon_pct": 0.5 });
check(limit("bg.extract") === 900 && limit("prompt.canon_pct") === 0.5 && limit("bg.scene_board") === 300, "an override changes only its own limit");
check(limitOverride("bg.extract") === 900 && limitOverride("bg.scene_board") === undefined, "an override can be told apart from a default (so 'use the server's setting' works)");
setLimitOverrides({ "bg.extract": 1 });
check(limit("bg.extract") === limitDef("bg.extract").min, "a value below the range is raised to the minimum, not trusted");
setLimitOverrides({ "bg.extract": 10_000_000 });
check(limit("bg.extract") === limitDef("bg.extract").max, "a value above the range is lowered to the maximum");
setLimitOverrides({ "bg.extract": "750" as unknown as number, "bg.ledger": "" as unknown as number, "bg.recap": NaN, "bg.drift": null as unknown as number, "nope.nope": 5 });
check(limit("bg.extract") === 750 && limit("bg.ledger") === 300 && limit("bg.recap") === 240 && limit("bg.drift") === 360, "numeric strings are accepted; blanks, NaN and null fall back to the default; unknown keys are ignored");
check(sanitizeLimit("prompt.scene_pct", 0.123456) === 0.123 && sanitizeLimit("bg.extract", 600.7) === 601, "shares keep three decimals, token counts are whole numbers");
setLimitOverrides(undefined);
check(limit("bg.extract") === 600, "clearing the overrides restores every default");
setLimitOverrides({ "bg.extract": 900 });
setLimitOverrides({});
check(limit("bg.extract") === 600, "saving a config with no overrides clears the earlier ones");

console.log("--- the prompt budget follows the registry ---");
check(JSON.stringify(defaultTokenBudget()) === JSON.stringify({ total: 4000, canon_pct: 0.4, scene_pct: 0.25, heuristic_pct: 0.2, graph_pct: 0.1 }), "with no overrides the budget is exactly what it always was");
setLimitOverrides({ "prompt.total_tokens": 12000, "prompt.scene_pct": 0.5 });
check(defaultTokenBudget().total === 12000 && defaultTokenBudget().scene_pct === 0.5 && defaultTokenBudget().canon_pct === 0.4, "raising it in Settings raises the budget the prompt is composed with");
setLimitOverrides(undefined);
check(limitFrom({ "bg.extract": 900 }, "bg.extract") === 900 && limitFrom(undefined, "bg.extract") === 600 && limitFrom({ "bg.extract": 1 }, "bg.extract") === 16, "limitFrom previews an unsaved draft (used by the Settings warnings)");

console.log("--- no hard-coded token limits in the app code ---");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
// The benchmark harness in instrumentation/ is a test tool, not app behaviour; limits.ts defines the numbers.
const files = walk("src").filter((f) => !f.endsWith("src/lib/limits.ts") && !f.includes("src/lib/instrumentation/"));
const PATTERNS: Array<[RegExp, string]> = [
  [/max_tokens:\s*\d+/, "max_tokens: <number>"],
  [/max_tokens\s*\?\?\s*\d+/, "max_tokens ?? <number>"],
  [/maxResponseTokens\s*\?\?\s*\d+/, "maxResponseTokens ?? <number>"],
  [/maxOutputTokens:\s*[^,\n]*\?\?\s*\d+/, "maxOutputTokens ?? <number>"],
  [/num_predict:\s*[^,\n]*\?\?\s*\d+/, "num_predict ?? <number>"],
];
const offenders: string[] = [];
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments may mention numbers
    for (const [re, label] of PATTERNS) if (re.test(line)) offenders.push(`${f}:${i + 1}  ${label}  → ${line.trim().slice(0, 70)}`);
  });
}
if (offenders.length) {
  console.error("FAIL: hard-coded token limits found — add them to src/lib/limits.ts and call limit(\"…\"):\n  " + offenders.join("\n  "));
  process.exit(1);
}
check(true, `none of the ${files.length} source files hard-codes a token limit`);
check((keys as LimitKey[]).length >= 28, "and the registry covers the background tasks, prompt budget, timeouts and scheduling");

console.log("\n--- PASS: limits ---");
process.exit(0);
