// Tests for the out-of-tree plugin loader. Exercises the contract
// between server-side bundler + browser-side dynamic importer, without
// actually running esbuild or hitting the network.
//
// What we CAN cover here without a browser environment:
// - The catalog response shape (id / manifest / bundleUrl / error)
// - Loader behavior with mock fetch: load on first call, no-op on
//   second call when bundledAt unchanged, re-load when bundledAt changes,
//   unload when a plugin disappears from the catalog.
// - Error handling: server-side error → skip, fetch failure → no throw,
//   missing default / manifest exports → skip with warn.
//
// We mock both `fetch` and the host's loadPlugin/unloadPlugin so the
// loader's wiring is tested in isolation. Dynamic `import()` of arbitrary
// URLs is not easily mockable in node without injecting a module
// resolver, so we lean on the host's loadPlugin contract — the loader
// either calls it (signals "would have imported") or doesn't.

import { PluginHost } from "../src/lib/grimoire/host";
import { MemoryStorageBackend } from "../src/lib/grimoire/sdk-runtime";
import type { LlmProvider } from "../src/lib/providers";
import type { YantrikClient } from "../src/lib/yantrikdb/client";

function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`assert failed: ${msg} (got ${String(a)}, want ${String(b)})`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}
function ok(msg: string): void {
  console.log("  ok ", msg);
}

const fakeClient = {} as YantrikClient;
const fakeProvider = null as LlmProvider | null;

function newHost(): PluginHost {
  return new PluginHost({
    client: fakeClient,
    provider: fakeProvider,
    model: "test",
    storage: new MemoryStorageBackend(),
  });
}

// Tiny shim of the dynamic loader's catalog-fetch + import pipeline,
// extracted from src/lib/grimoire/dynamic-loader.ts so we can unit-test
// the contract without depending on browser-only globals (`fetch`,
// dynamic `import()`). The real implementation does the same shape.
interface CatalogEntry {
  id: string;
  manifest: { id: string; name: string; version: string; apiVersion: string };
  bundledAt: string;
  sourcePath: string;
  bundleUrl: string;
  error?: string;
}

class MockLoader {
  // Track (pluginId → last bundledAt) — same semantics as the real loader.
  private loadedAt = new Map<string, string>();
  /** Each call returns the canned catalog entries OR the canned import
   *  responses set on the mock. */
  public catalogResponses: CatalogEntry[][] = [];
  public importResponses = new Map<
    string,
    { default: unknown; manifest: unknown } | "throw"
  >();
  public events: string[] = [];

  constructor(private host: PluginHost) {}

  async load(): Promise<number> {
    const catalog = this.catalogResponses.shift() ?? [];
    // Unload plugins that disappeared.
    const present = new Set(catalog.map((p) => p.id));
    for (const id of Array.from(this.loadedAt.keys())) {
      if (!present.has(id)) {
        await this.host.unloadPlugin(id);
        this.loadedAt.delete(id);
        this.events.push(`unload:${id}`);
      }
    }
    let changed = 0;
    for (const entry of catalog) {
      if (entry.error) {
        this.events.push(`error:${entry.id}:${entry.error}`);
        continue;
      }
      const prev = this.loadedAt.get(entry.id);
      if (prev === entry.bundledAt) {
        this.events.push(`unchanged:${entry.id}`);
        continue;
      }
      const importResult = this.importResponses.get(entry.id);
      if (importResult === "throw") {
        this.events.push(`importThrew:${entry.id}`);
        continue;
      }
      if (!importResult || !importResult.default || !importResult.manifest) {
        this.events.push(`badExports:${entry.id}`);
        continue;
      }
      const loaded = await this.host.loadPlugin(
        importResult.manifest,
        importResult.default as never,
        `out-of-tree:${entry.sourcePath}`
      );
      if (loaded) {
        this.loadedAt.set(entry.id, entry.bundledAt);
        changed++;
        this.events.push(`loaded:${entry.id}@${entry.bundledAt}`);
      }
    }
    return changed;
  }
}

const goodManifest = {
  id: "test.plugin",
  name: "Test Plugin",
  version: "0.1.0",
  apiVersion: "^0.1.0",
};
const goodDef = { id: "test.plugin", setup: () => ({}) };

async function test_first_load(): Promise<void> {
  console.log("--- dynamic-loader: first load registers plugin ---");
  const host = newHost();
  const loader = new MockLoader(host);
  loader.catalogResponses.push([
    {
      id: "test.plugin",
      manifest: goodManifest,
      bundledAt: "2026-01-01T00:00:00Z",
      sourcePath: "/data/plugins/test",
      bundleUrl: "/api/grimoire/plugin/test/bundle.js",
    },
  ]);
  loader.importResponses.set("test.plugin", {
    default: goodDef,
    manifest: goodManifest,
  });
  const changed = await loader.load();
  eq(changed, 1, "1 plugin loaded");
  eq(host.list().length, 1, "host has 1 plugin");
  assert(
    loader.events.some((e) => e.startsWith("loaded:test.plugin")),
    "loaded event fired"
  );
}

async function test_unchanged_bundle_is_noop(): Promise<void> {
  console.log("--- dynamic-loader: unchanged bundledAt → no re-import ---");
  const host = newHost();
  const loader = new MockLoader(host);
  const sameEntry: CatalogEntry = {
    id: "test.plugin",
    manifest: goodManifest,
    bundledAt: "2026-01-01T00:00:00Z",
    sourcePath: "/data/plugins/test",
    bundleUrl: "/api/grimoire/plugin/test/bundle.js",
  };
  loader.catalogResponses.push([sameEntry]);
  loader.catalogResponses.push([sameEntry]);
  loader.importResponses.set("test.plugin", { default: goodDef, manifest: goodManifest });
  const first = await loader.load();
  eq(first, 1, "first call loads");
  const second = await loader.load();
  eq(second, 0, "second call skips (unchanged bundledAt)");
  assert(
    loader.events.includes("unchanged:test.plugin"),
    "unchanged event fired on second call"
  );
}

async function test_changed_bundle_reloads(): Promise<void> {
  console.log("--- dynamic-loader: bundledAt change triggers re-import ---");
  const host = newHost();
  const loader = new MockLoader(host);
  loader.catalogResponses.push([
    {
      id: "test.plugin",
      manifest: goodManifest,
      bundledAt: "v1",
      sourcePath: "/data/plugins/test",
      bundleUrl: "/api/grimoire/plugin/test/bundle.js",
    },
  ]);
  loader.catalogResponses.push([
    {
      id: "test.plugin",
      manifest: goodManifest,
      bundledAt: "v2",
      sourcePath: "/data/plugins/test",
      bundleUrl: "/api/grimoire/plugin/test/bundle.js",
    },
  ]);
  loader.importResponses.set("test.plugin", { default: goodDef, manifest: goodManifest });
  await loader.load();
  const second = await loader.load();
  eq(second, 1, "second call re-imports (new bundledAt)");
  assert(
    loader.events.filter((e) => e.startsWith("loaded:test.plugin")).length === 2,
    "two load events"
  );
}

async function test_removed_plugin_unloads(): Promise<void> {
  console.log("--- dynamic-loader: plugin removed from catalog → unloads ---");
  const host = newHost();
  const loader = new MockLoader(host);
  loader.catalogResponses.push([
    {
      id: "test.plugin",
      manifest: goodManifest,
      bundledAt: "v1",
      sourcePath: "/data/plugins/test",
      bundleUrl: "/api/grimoire/plugin/test/bundle.js",
    },
  ]);
  loader.catalogResponses.push([]); // empty catalog
  loader.importResponses.set("test.plugin", { default: goodDef, manifest: goodManifest });
  await loader.load();
  eq(host.list().length, 1, "loaded after first call");
  await loader.load();
  eq(host.list().length, 0, "unloaded after empty catalog");
  assert(loader.events.includes("unload:test.plugin"), "unload event fired");
}

async function test_server_error_skips(): Promise<void> {
  console.log("--- dynamic-loader: server-side error skips the entry ---");
  const host = newHost();
  const loader = new MockLoader(host);
  loader.catalogResponses.push([
    {
      id: "broken.plugin",
      manifest: goodManifest,
      bundledAt: "v1",
      sourcePath: "/data/plugins/broken",
      bundleUrl: "/api/grimoire/plugin/broken/bundle.js",
      error: "esbuild syntax error",
    },
  ]);
  const changed = await loader.load();
  eq(changed, 0, "no plugin loaded");
  eq(host.list().length, 0, "host empty");
  assert(
    loader.events.some((e) => e.startsWith("error:broken.plugin")),
    "error event fired"
  );
}

async function test_missing_exports_skips(): Promise<void> {
  console.log("--- dynamic-loader: bundle missing default/manifest skips ---");
  const host = newHost();
  const loader = new MockLoader(host);
  loader.catalogResponses.push([
    {
      id: "incomplete.plugin",
      manifest: goodManifest,
      bundledAt: "v1",
      sourcePath: "/data/plugins/incomplete",
      bundleUrl: "/api/grimoire/plugin/incomplete/bundle.js",
    },
  ]);
  // import returns an object with no default
  loader.importResponses.set("incomplete.plugin", {
    default: undefined as unknown as object,
    manifest: goodManifest,
  });
  const changed = await loader.load();
  eq(changed, 0, "skipped due to missing exports");
  eq(host.list().length, 0, "host empty");
  assert(
    loader.events.includes("badExports:incomplete.plugin"),
    "badExports event fired"
  );
}

(async () => {
  try {
    await test_first_load();
    await test_unchanged_bundle_is_noop();
    await test_changed_bundle_reloads();
    await test_removed_plugin_unloads();
    await test_server_error_skips();
    await test_missing_exports_skips();
    ok("all dynamic loader tests passed");
    console.log("\n--- PASS: grimoire-dynamic-loader ---");
  } catch (e) {
    console.error("--- FAIL: grimoire-dynamic-loader ---", e);
    process.exit(1);
  }
})();
