// Character gating tests: localStorage round-trip + resolveAllowedTools
// semantics (configured=false → undefined; configured=true with empty
// list → empty Set means "deny all", distinct from default-allow).

import {
  loadCharacterGating,
  resolveAllowedTools,
  saveCharacterGating,
  type CharacterGating,
} from "../src/lib/mcp/character-gating";

function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`assert failed: ${msg} (got ${String(a)}, want ${String(b)})`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}
function ok(msg: string): void {
  console.log("  ok ", msg);
}

class MemStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
  removeItem(k: string): void { this.data.delete(k); }
  clear(): void { this.data.clear(); }
  get length(): number { return this.data.size; }
  key(n: number): string | null { return Array.from(this.data.keys())[n] ?? null; }
}
const storage = new MemStorage();
(globalThis as unknown as { localStorage: MemStorage }).localStorage = storage;

function reset(): void {
  storage.clear();
}

function test_default_unconfigured(): void {
  console.log("--- gating: unconfigured character returns default ---");
  reset();
  const g = loadCharacterGating("char-1");
  eq(g.configured, false, "configured=false by default");
  eq(g.allowedTools.length, 0, "allowedTools empty by default");
}

function test_save_and_load_round_trip(): void {
  console.log("--- gating: save + load round-trip ---");
  reset();
  const gating: CharacterGating = {
    configured: true,
    allowedTools: ["dice__roll", "tts__speak"],
  };
  saveCharacterGating("char-1", gating);
  const loaded = loadCharacterGating("char-1");
  eq(loaded.configured, true, "configured persisted");
  eq(loaded.allowedTools.length, 2, "allowedTools length persisted");
  eq(loaded.allowedTools[0], "dice__roll", "first tool");
  eq(loaded.allowedTools[1], "tts__speak", "second tool");
}

function test_per_character_isolation(): void {
  console.log("--- gating: characters isolated by id ---");
  reset();
  saveCharacterGating("char-a", { configured: true, allowedTools: ["a__t"] });
  saveCharacterGating("char-b", { configured: true, allowedTools: ["b__t"] });
  const a = loadCharacterGating("char-a");
  const b = loadCharacterGating("char-b");
  eq(a.allowedTools[0], "a__t", "char-a unaffected");
  eq(b.allowedTools[0], "b__t", "char-b unaffected");
}

function test_resolve_default_returns_undefined(): void {
  console.log("--- gating: resolveAllowedTools: default→undefined ---");
  const g: CharacterGating = { configured: false, allowedTools: [] };
  const r = resolveAllowedTools(g);
  eq(r, undefined, "undefined = no filter");
}

function test_resolve_configured_returns_set(): void {
  console.log("--- gating: resolveAllowedTools: configured→Set ---");
  const g: CharacterGating = {
    configured: true,
    allowedTools: ["dice__roll"],
  };
  const r = resolveAllowedTools(g);
  assert(r instanceof Set, "returns a Set");
  eq(r?.size, 1, "size 1");
  assert(r?.has("dice__roll"), "has the tool");
}

function test_resolve_configured_empty_returns_empty_set(): void {
  console.log("--- gating: configured=true + empty list → empty Set (deny all) ---");
  const g: CharacterGating = { configured: true, allowedTools: [] };
  const r = resolveAllowedTools(g);
  assert(r instanceof Set, "returns a Set even when empty");
  eq(r?.size, 0, "size 0 (explicit deny)");
}

function test_load_rejects_malformed(): void {
  console.log("--- gating: load rejects malformed entries ---");
  reset();
  storage.setItem(
    "chronicler.mcp.character_gating_v1.char-bad",
    JSON.stringify({ configured: "yes", allowedTools: [1, 2, 3] })
  );
  const g = loadCharacterGating("char-bad");
  eq(g.configured, false, "malformed treated as default");
  eq(g.allowedTools.length, 0, "empty allowedTools");
}

function test_load_filters_non_string_tool_names(): void {
  console.log("--- gating: load filters non-string entries from allowedTools ---");
  reset();
  storage.setItem(
    "chronicler.mcp.character_gating_v1.char-mixed",
    JSON.stringify({
      configured: true,
      allowedTools: ["valid", 42, null, "also-valid"],
    })
  );
  const g = loadCharacterGating("char-mixed");
  eq(g.configured, true, "configured preserved");
  eq(g.allowedTools.length, 2, "non-strings dropped");
  eq(g.allowedTools[0], "valid", "valid first");
  eq(g.allowedTools[1], "also-valid", "valid second");
}

(() => {
  try {
    test_default_unconfigured();
    test_save_and_load_round_trip();
    test_per_character_isolation();
    test_resolve_default_returns_undefined();
    test_resolve_configured_returns_set();
    test_resolve_configured_empty_returns_empty_set();
    test_load_rejects_malformed();
    test_load_filters_non_string_tool_names();
    ok("all character gating tests passed");
    console.log("\n--- PASS: character-gating ---");
  } catch (e) {
    console.error("--- FAIL: character-gating ---", e);
    process.exit(1);
  }
})();
