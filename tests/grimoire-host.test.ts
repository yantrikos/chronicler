// Grimoire PluginHost tests: load, validate, dispose, error isolation.
//
// Mock-driven — no real YantrikDB, no real LLM. Just exercises the host's
// contract: manifest validation, setup() invocation, hook registration,
// dispose, hot-replace, auto-disable on crash.

import {
  PluginHost,
} from "../src/lib/grimoire/host";
import { MemoryStorageBackend } from "../src/lib/grimoire/sdk-runtime";
import {
  defineGrimoire,
  type GrimoireManifest,
} from "../src/lib/grimoire/types";
import type { LlmProvider } from "../src/lib/providers";
import type { YantrikClient } from "../src/lib/yantrikdb/client";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}
function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`assert failed: ${msg} (got ${String(a)}, want ${String(b)})`);
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

const goodManifest: GrimoireManifest = {
  id: "test.plugin",
  name: "Test Plugin",
  version: "0.1.0",
  apiVersion: "^0.1.0",
};

async function test_loadPlugin_validates_and_runs_setup(): Promise<void> {
  console.log("--- loadPlugin: valid manifest runs setup ---");
  const host = newHost();
  let setupCalled = false;
  const def = defineGrimoire({
    id: "test.plugin",
    setup(ctx) {
      eq(ctx.manifest.id, "test.plugin", "ctx.manifest.id");
      setupCalled = true;
      return {};
    },
  });
  const loaded = await host.loadPlugin(goodManifest, def, "test");
  assert(loaded !== null, "loadPlugin returned non-null");
  assert(setupCalled, "setup() was invoked");
  eq(host.list().length, 1, "host.list() has 1 entry");
}

async function test_loadPlugin_rejects_invalid_manifest(): Promise<void> {
  console.log("--- loadPlugin: invalid manifest rejected ---");
  const host = newHost();
  const def = defineGrimoire({
    id: "bad",
    setup() {
      return {};
    },
  });
  const loaded = await host.loadPlugin(
    { id: "bad", name: "X" }, // missing version + apiVersion
    def,
    "bad-test"
  );
  eq(loaded, null, "loadPlugin returned null");
  eq(host.list().length, 0, "no plugins loaded");
  assert(host.getErrors().length > 0, "errors recorded");
}

async function test_loadPlugin_rejects_id_mismatch(): Promise<void> {
  console.log("--- loadPlugin: id mismatch rejected ---");
  const host = newHost();
  const def = defineGrimoire({
    id: "actual.id",
    setup() {
      return {};
    },
  });
  const loaded = await host.loadPlugin(goodManifest, def, "mismatch-test");
  eq(loaded, null, "id-mismatch rejected");
}

async function test_loadPlugin_setup_throw_records_error(): Promise<void> {
  console.log("--- loadPlugin: setup() throw is caught + recorded ---");
  const host = newHost();
  const def = defineGrimoire({
    id: "test.plugin",
    setup() {
      throw new Error("boom");
    },
  });
  const loaded = await host.loadPlugin(goodManifest, def, "throw-test");
  eq(loaded, null, "setup-throw returns null");
  const errs = host.getErrors();
  assert(errs.length > 0, "error recorded");
  assert(errs[0].errors[0].includes("boom"), "error message preserved");
}

async function test_unloadPlugin_calls_dispose(): Promise<void> {
  console.log("--- unloadPlugin: dispose() called ---");
  const host = newHost();
  let disposed = false;
  const def = defineGrimoire({
    id: "test.plugin",
    setup() {
      return {
        dispose() {
          disposed = true;
        },
      };
    },
  });
  await host.loadPlugin(goodManifest, def, "dispose-test");
  await host.unloadPlugin("test.plugin");
  assert(disposed, "dispose() was called");
  eq(host.list().length, 0, "plugin removed from list");
}

async function test_loadPlugin_hot_replace(): Promise<void> {
  console.log("--- loadPlugin: hot replace disposes old ---");
  const host = newHost();
  let disposedV1 = false;
  let setupCount = 0;
  const defV1 = defineGrimoire({
    id: "test.plugin",
    setup() {
      setupCount++;
      return {
        dispose() {
          disposedV1 = true;
        },
      };
    },
  });
  await host.loadPlugin(goodManifest, defV1, "v1");
  // load again with same id — host should dispose v1 first
  const defV2 = defineGrimoire({
    id: "test.plugin",
    setup() {
      setupCount++;
      return {};
    },
  });
  await host.loadPlugin(goodManifest, defV2, "v2");
  assert(disposedV1, "v1 disposed before v2 loaded");
  eq(setupCount, 2, "both setups ran");
  eq(host.list().length, 1, "only one plugin entry remains");
}

async function test_hook_registration_and_dispatch(): Promise<void> {
  console.log("--- hooks: observer + augmenter registration + dispatch ---");
  const host = newHost();
  const calls: string[] = [];
  const def = defineGrimoire({
    id: "test.plugin",
    setup(ctx) {
      ctx.hooks.afterChat.observe((event) => {
        calls.push(`observer:${event.reply.content}`);
      });
      ctx.hooks.afterChat.augment((event) => {
        calls.push(`augmenter:${event.reply.content}`);
        return { ...event, mutatedContent: event.reply.content + "+mutated" };
      });
      return {};
    },
  });
  await host.loadPlugin(goodManifest, def, "hooks-test");
  const result = await host.dispatchHook("afterChat", {
    sessionId: "s1",
    character: { id: "c1" } as never,
    reply: { content: "hello" },
  });
  // augmenter runs first, then observer
  eq(calls.length, 2, "two hook handlers fired");
  eq(calls[0], "augmenter:hello", "augmenter ran first");
  // The augmenter set mutatedContent but didn't rewrite reply.content,
  // so the observer still sees the original content (this is correct —
  // augmenters return a new context with the mutation flag; the
  // orchestrator pulls mutatedContent out to apply it downstream).
  eq(calls[1], "observer:hello", "observer ran after augmenter");
  eq(result.mutatedContent, "hello+mutated", "mutatedContent passed through to orchestrator");
}

async function test_hook_error_observer_does_not_disable(): Promise<void> {
  console.log("--- hooks: observer crash does NOT disable plugin ---");
  const host = newHost();
  const def = defineGrimoire({
    id: "test.plugin",
    setup(ctx) {
      ctx.hooks.afterChat.observe(() => {
        throw new Error("observer-boom");
      });
      return {};
    },
  });
  await host.loadPlugin(goodManifest, def, "observer-crash");
  await host.dispatchHook("afterChat", {
    sessionId: "s1",
    character: { id: "c1" } as never,
    reply: { content: "x" },
  });
  eq(host.hooks.isDisabled("test.plugin"), false, "plugin NOT disabled");
}

async function test_hook_error_augmenter_DOES_disable(): Promise<void> {
  console.log("--- hooks: augmenter crash DOES disable plugin ---");
  const host = newHost();
  const def = defineGrimoire({
    id: "test.plugin",
    setup(ctx) {
      ctx.hooks.afterChat.augment(() => {
        throw new Error("augmenter-boom");
      });
      return {};
    },
  });
  await host.loadPlugin(goodManifest, def, "augmenter-crash");
  await host.dispatchHook("afterChat", {
    sessionId: "s1",
    character: { id: "c1" } as never,
    reply: { content: "x" },
  });
  eq(host.hooks.isDisabled("test.plugin"), true, "plugin disabled");
}

async function test_strategy_singleton_conflict(): Promise<void> {
  console.log("--- hooks: strategy conflict throws on registration ---");
  const host = newHost();
  const defA = defineGrimoire({
    id: "test.plugin",
    setup(ctx) {
      ctx.hooks.afterChat.strategy(() => {});
      return {};
    },
  });
  await host.loadPlugin(goodManifest, defA, "strategy-A");

  // Second plugin with same hook strategy
  const defB = defineGrimoire({
    id: "test.plugin.b",
    setup(ctx) {
      ctx.hooks.afterChat.strategy(() => {});
      return {};
    },
  });
  const manifestB: GrimoireManifest = { ...goodManifest, id: "test.plugin.b" };
  const loaded = await host.loadPlugin(manifestB, defB, "strategy-B");
  // Setup throws inside register; host should catch + reject the plugin
  eq(loaded, null, "second strategy registration rejected");
}

(async () => {
  try {
    await test_loadPlugin_validates_and_runs_setup();
    await test_loadPlugin_rejects_invalid_manifest();
    await test_loadPlugin_rejects_id_mismatch();
    await test_loadPlugin_setup_throw_records_error();
    await test_unloadPlugin_calls_dispose();
    await test_loadPlugin_hot_replace();
    await test_hook_registration_and_dispatch();
    await test_hook_error_observer_does_not_disable();
    await test_hook_error_augmenter_DOES_disable();
    await test_strategy_singleton_conflict();
    ok("all PluginHost tests passed");
    console.log("\n--- PASS: grimoire-host ---");
  } catch (e) {
    console.error("--- FAIL: grimoire-host ---", e);
    process.exit(1);
  }
})();
