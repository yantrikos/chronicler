// MCP resources retrieval tests.
//
// Covers:
//   - resource-opt-in.ts: persistence round-trip, default semantics
//     (configured=false → enabledResources is "deny by default"),
//     malformed handling, qualifyResourceUri + splitQualifiedResource
//     round-trip
//   - resource-fetcher.ts: fetches via the registry's readResource,
//     drops error results, caches by (serverId, uri), shapes as
//     RecallResult with mcp:<server>:<uri> namespace

import {
  loadCharacterResourceOptIn,
  qualifyResourceUri,
  resolveEnabledResources,
  saveCharacterResourceOptIn,
  splitQualifiedResource,
} from "../src/lib/mcp/resource-opt-in";
import {
  _clearResourceCache,
  fetchOptedInResources,
} from "../src/lib/mcp/resource-fetcher";
import { McpServerRegistry } from "../src/lib/mcp/registry";
import type { ExternalMcpClient } from "../src/lib/mcp/external-client";
import type { McpServerCatalog, McpToolCallResult } from "../src/lib/mcp/types";

function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`assert failed: ${msg} (got ${String(a)}, want ${String(b)})`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}
function ok(msg: string): void {
  console.log("  ok ", msg);
}

// Stub localStorage.
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
  _clearResourceCache();
}

// ────────────────────────────────────────────────────────────────────
// resource-opt-in
// ────────────────────────────────────────────────────────────────────

function test_default_is_not_configured(): void {
  console.log("--- resources: default character has configured=false ---");
  reset();
  const r = loadCharacterResourceOptIn("char-1");
  eq(r.configured, false, "configured defaults to false");
  eq(r.enabledResources.length, 0, "enabledResources empty by default");
}

function test_resolve_default_returns_empty(): void {
  console.log("--- resources: default-deny semantics ---");
  // Unlike tools (default-allow), resources default to deny: returning
  // [] means the pipeline doesn't pull anything.
  const empty = resolveEnabledResources({ configured: false, enabledResources: [] });
  eq(empty.length, 0, "default returns []");
  const config = resolveEnabledResources({
    configured: true,
    enabledResources: ["server::lore://x"],
  });
  eq(config.length, 1, "configured returns enabled list");
  eq(config[0], "server::lore://x", "URI preserved");
}

function test_save_and_load_round_trip(): void {
  console.log("--- resources: save + load round-trip ---");
  reset();
  saveCharacterResourceOptIn("char-a", {
    configured: true,
    enabledResources: ["s1::uri-a", "s2::uri-b"],
  });
  const loaded = loadCharacterResourceOptIn("char-a");
  eq(loaded.configured, true, "configured persisted");
  eq(loaded.enabledResources.length, 2, "both URIs persisted");
  eq(loaded.enabledResources[0], "s1::uri-a", "first URI");
  eq(loaded.enabledResources[1], "s2::uri-b", "second URI");
}

function test_load_rejects_malformed(): void {
  console.log("--- resources: load rejects malformed stored data ---");
  reset();
  storage.setItem(
    "chronicler.mcp.character_resources_v1.char-bad",
    JSON.stringify({ configured: "yes", enabledResources: [1, 2] })
  );
  const r = loadCharacterResourceOptIn("char-bad");
  eq(r.configured, false, "malformed treated as default");
  eq(r.enabledResources.length, 0, "empty");
}

function test_qualify_and_split_round_trip(): void {
  console.log("--- resources: qualify + split round-trip ---");
  const q = qualifyResourceUri("lore-server", "lore://saltcoast/towns/port-llyr");
  const split = splitQualifiedResource(q);
  assert(split, "split succeeds");
  eq(split?.serverId, "lore-server", "server preserved");
  eq(split?.uri, "lore://saltcoast/towns/port-llyr", "URI preserved (with :// inside)");
  // No separator → null
  eq(splitQualifiedResource("no-separator"), null, "no separator → null");
  // Empty sides rejected
  eq(splitQualifiedResource("::uri"), null, "empty server → null");
  eq(splitQualifiedResource("server::"), null, "empty URI → null");
}

// ────────────────────────────────────────────────────────────────────
// resource-fetcher
// ────────────────────────────────────────────────────────────────────

function injectFakeServer(
  registry: McpServerRegistry,
  serverId: string,
  catalog: McpServerCatalog,
  readImpl: (uri: string) => Promise<McpToolCallResult>
): void {
  registry.upsert({
    id: serverId,
    name: serverId,
    url: "http://fake",
    transport: "streamable-http",
    enabled: true,
  });
  const fakeClient = {
    isReady: () => true,
    getCatalog: () => catalog,
    callTool: async () => ({ kind: "text" as const, text: "ok" }),
    refreshCatalog: async () => catalog,
    testConnection: async () => ({ ok: true }),
    dispose: async () => undefined,
    readResource: async (uri: string) => readImpl(uri),
  };
  (registry as unknown as { clients: Map<string, ExternalMcpClient> }).clients.set(
    serverId,
    fakeClient as unknown as ExternalMcpClient
  );
  (registry as unknown as { statuses: Map<string, unknown> }).statuses.set(
    serverId,
    { serverId, state: "ready", lastConnectedAt: new Date().toISOString() }
  );
}

async function test_empty_input_returns_empty(): Promise<void> {
  console.log("--- fetcher: empty enabledResources → no fetch ---");
  reset();
  const registry = new McpServerRegistry();
  const out = await fetchOptedInResources(registry, []);
  eq(out.length, 0, "empty returns empty");
}

async function test_text_resource_fetched_and_shaped(): Promise<void> {
  console.log("--- fetcher: text resource → shaped RecallResult ---");
  reset();
  const registry = new McpServerRegistry();
  injectFakeServer(
    registry,
    "lore",
    {
      serverId: "lore",
      fetchedAt: new Date().toISOString(),
      tools: [],
      resources: [{ uri: "lore://town/port-llyr" }],
      prompts: [],
    },
    async (uri) => {
      eq(uri, "lore://town/port-llyr", "called with full URI");
      return { kind: "text", text: "Port Llyr — coastal trading hub." };
    }
  );
  const out = await fetchOptedInResources(registry, ["lore::lore://town/port-llyr"]);
  eq(out.length, 1, "one result");
  eq(out[0].text, "Port Llyr — coastal trading hub.", "text shaped");
  eq(out[0].namespace, "mcp:lore:lore://town/port-llyr", "namespace tagged");
  eq(out[0].rid, "mcp:lore::lore://town/port-llyr", "rid prefixed");
  assert(out[0].why_retrieved?.length, "provenance hints attached");
}

async function test_error_result_dropped(): Promise<void> {
  console.log("--- fetcher: error result is dropped silently ---");
  reset();
  const registry = new McpServerRegistry();
  injectFakeServer(
    registry,
    "broken",
    {
      serverId: "broken",
      fetchedAt: new Date().toISOString(),
      tools: [],
      resources: [{ uri: "lore://missing" }],
      prompts: [],
    },
    async () => ({ kind: "error", message: "not found" })
  );
  const out = await fetchOptedInResources(registry, ["broken::lore://missing"]);
  eq(out.length, 0, "error dropped, not appended");
}

async function test_cache_reused_within_ttl(): Promise<void> {
  console.log("--- fetcher: results cached within TTL ---");
  reset();
  const registry = new McpServerRegistry();
  let callCount = 0;
  injectFakeServer(
    registry,
    "lore",
    {
      serverId: "lore",
      fetchedAt: new Date().toISOString(),
      tools: [],
      resources: [{ uri: "lore://x" }],
      prompts: [],
    },
    async () => {
      callCount++;
      return { kind: "text", text: "stuff" };
    }
  );
  await fetchOptedInResources(registry, ["lore::lore://x"]);
  await fetchOptedInResources(registry, ["lore::lore://x"]);
  await fetchOptedInResources(registry, ["lore::lore://x"]);
  eq(callCount, 1, "only one underlying fetch (cache hit on 2 + 3)");
}

async function test_malformed_qualified_dropped(): Promise<void> {
  console.log("--- fetcher: malformed qualified URI dropped ---");
  reset();
  const registry = new McpServerRegistry();
  const out = await fetchOptedInResources(registry, ["no-separator", "::empty", "lore::"]);
  eq(out.length, 0, "all malformed entries dropped");
}

async function test_multiple_servers_parallel(): Promise<void> {
  console.log("--- fetcher: multiple servers fetch in parallel ---");
  reset();
  const registry = new McpServerRegistry();
  injectFakeServer(
    registry,
    "a",
    {
      serverId: "a",
      fetchedAt: "",
      tools: [],
      resources: [{ uri: "lore://a" }],
      prompts: [],
    },
    async () => ({ kind: "text", text: "from-a" })
  );
  injectFakeServer(
    registry,
    "b",
    {
      serverId: "b",
      fetchedAt: "",
      tools: [],
      resources: [{ uri: "lore://b" }],
      prompts: [],
    },
    async () => ({ kind: "text", text: "from-b" })
  );
  const out = await fetchOptedInResources(registry, [
    "a::lore://a",
    "b::lore://b",
  ]);
  eq(out.length, 2, "both fetched");
  const texts = out.map((r) => r.text).sort();
  eq(texts[0], "from-a", "from-a present");
  eq(texts[1], "from-b", "from-b present");
}

(async () => {
  try {
    // resource-opt-in
    test_default_is_not_configured();
    test_resolve_default_returns_empty();
    test_save_and_load_round_trip();
    test_load_rejects_malformed();
    test_qualify_and_split_round_trip();
    // resource-fetcher
    await test_empty_input_returns_empty();
    await test_text_resource_fetched_and_shaped();
    await test_error_result_dropped();
    await test_cache_reused_within_ttl();
    await test_malformed_qualified_dropped();
    await test_multiple_servers_parallel();
    ok("all MCP resources tests passed");
    console.log("\n--- PASS: mcp-resources ---");
  } catch (e) {
    console.error("--- FAIL: mcp-resources ---", e);
    process.exit(1);
  }
})();
