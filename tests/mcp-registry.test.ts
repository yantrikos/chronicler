// MCP server registry tests. No network — exercises persistence,
// add/remove/upsert lifecycle, version-bump subscriptions, and the
// validator's rejection of malformed configs.
//
// External client (catalog fetch, tool calling) is covered by manual
// integration testing against a real MCP server; doing that in unit
// tests would require a mock MCP server, which is more weight than the
// registry's invariants warrant.

import { McpServerRegistry } from "../src/lib/mcp/registry";
import type { McpServerConfig } from "../src/lib/mcp/types";

function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`assert failed: ${msg} (got ${String(a)}, want ${String(b)})`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}
function ok(msg: string): void {
  console.log("  ok ", msg);
}

// Stub localStorage for Node tests.
class MemStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
  clear(): void {
    this.data.clear();
  }
  get length(): number {
    return this.data.size;
  }
  key(n: number): string | null {
    return Array.from(this.data.keys())[n] ?? null;
  }
}
(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();

const sample: McpServerConfig = {
  id: "dice",
  name: "Dice Server",
  url: "http://localhost:8765/mcp",
  transport: "streamable-http",
  enabled: true,
};

function reset(): void {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage.clear();
}

function test_upsert_and_list(): void {
  console.log("--- registry: upsert + list ---");
  reset();
  const r = new McpServerRegistry();
  r.upsert(sample);
  const list = r.list();
  eq(list.length, 1, "one server registered");
  eq(list[0].id, "dice", "id preserved");
  eq(list[0].name, "Dice Server", "name preserved");
}

function test_upsert_replaces_existing(): void {
  console.log("--- registry: upsert replaces existing by id ---");
  reset();
  const r = new McpServerRegistry();
  r.upsert(sample);
  r.upsert({ ...sample, name: "Renamed Dice" });
  const list = r.list();
  eq(list.length, 1, "still one server");
  eq(list[0].name, "Renamed Dice", "name updated");
}

function test_remove(): void {
  console.log("--- registry: remove ---");
  reset();
  const r = new McpServerRegistry();
  r.upsert(sample);
  r.upsert({ ...sample, id: "tts" });
  r.remove("dice");
  const list = r.list();
  eq(list.length, 1, "one server left");
  eq(list[0].id, "tts", "correct server remains");
}

function test_persistence_across_instances(): void {
  console.log("--- registry: persists to localStorage across instances ---");
  reset();
  const r1 = new McpServerRegistry();
  r1.upsert(sample);
  r1.upsert({ ...sample, id: "tts", name: "TTS" });
  // Fresh instance should re-hydrate from localStorage.
  const r2 = new McpServerRegistry();
  const list = r2.list();
  eq(list.length, 2, "both servers re-loaded");
  const ids = list.map((s) => s.id).sort();
  eq(ids[0], "dice", "dice persisted");
  eq(ids[1], "tts", "tts persisted");
}

function test_subscribe_fires_on_changes(): void {
  console.log("--- registry: subscribers fire on changes ---");
  reset();
  const r = new McpServerRegistry();
  let calls = 0;
  const unsub = r.subscribe(() => calls++);
  r.upsert(sample);
  r.upsert({ ...sample, id: "tts" });
  r.remove("dice");
  eq(calls, 3, "three change events");
  unsub();
  r.upsert({ ...sample, id: "third" });
  eq(calls, 3, "no events after unsubscribe");
}

function test_setConfigs_diffs_removed(): void {
  console.log("--- registry: setConfigs removes servers no longer in the set ---");
  reset();
  const r = new McpServerRegistry();
  r.upsert(sample);
  r.upsert({ ...sample, id: "tts" });
  r.setConfigs([{ ...sample, id: "tts" }]); // dice gone
  const list = r.list();
  eq(list.length, 1, "only tts remains");
  eq(list[0].id, "tts", "correct id");
}

function test_load_skips_malformed(): void {
  console.log("--- registry: load skips malformed entries from storage ---");
  reset();
  const storage = (globalThis as unknown as { localStorage: MemStorage })
    .localStorage;
  // Mix of valid + invalid configs
  storage.setItem(
    "chronicler.mcp.servers.v1",
    JSON.stringify([
      sample,
      { id: "bad", name: 42 }, // bad: name not a string
      { name: "missing-id", url: "x", transport: "sse", enabled: true },
      { ...sample, id: "good2", transport: "weird" }, // bad: invalid transport
    ])
  );
  const r = new McpServerRegistry();
  const list = r.list();
  eq(list.length, 1, "only the well-formed config survives");
  eq(list[0].id, "dice", "correct one survived");
}

function test_version_increases_monotonically(): void {
  console.log("--- registry: getVersion increases on every change ---");
  reset();
  const r = new McpServerRegistry();
  const v0 = r.getVersion();
  r.upsert(sample);
  const v1 = r.getVersion();
  r.remove("dice");
  const v2 = r.getVersion();
  assert(v1 > v0, "version bumps on upsert");
  assert(v2 > v1, "version bumps on remove");
}

(() => {
  try {
    test_upsert_and_list();
    test_upsert_replaces_existing();
    test_remove();
    test_persistence_across_instances();
    test_subscribe_fires_on_changes();
    test_setConfigs_diffs_removed();
    test_load_skips_malformed();
    test_version_increases_monotonically();
    ok("all MCP registry tests passed");
    console.log("\n--- PASS: mcp-registry ---");
  } catch (e) {
    console.error("--- FAIL: mcp-registry ---", e);
    process.exit(1);
  }
})();
