// Grimoire UI slot registry tests.
//
// React components can't render in a node test environment without JSDOM,
// so these tests use the SlotRegistry directly (not the host's plugin
// loader) and pass dummy "components" (functions tagged as ComponentType
// via the registry's type system). The wiring through PluginHost is
// covered indirectly by tests/grimoire-host.test.ts; here we focus on
// the registry's invariants: register, get by slot, plugin scoping for
// unregister, ordering.

import type { ComponentType } from "react";
import { SlotRegistry } from "../src/lib/grimoire/registry/slots";

function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`assert failed: ${msg} (got ${String(a)}, want ${String(b)})`);
}
function ok(msg: string): void {
  console.log("  ok ", msg);
}

// Dummy "component" — just a function with the right shape for the registry.
const DummyA: ComponentType<{ pluginId: string; characterId: string | null }> = () => null;
const DummyB: ComponentType<{ pluginId: string; characterId: string | null }> = () => null;
const DummyToolbar: ComponentType<{ pluginId: string; draft: string }> = () => null;

function test_register_and_get(): void {
  console.log("--- slots: register + get ---");
  const r = new SlotRegistry();
  r.register("plugin.a", "inspector:tab", DummyA, { title: "A tab" });
  r.register("plugin.b", "inspector:tab", DummyB, { title: "B tab" });
  const got = r.get("inspector:tab");
  eq(got.length, 2, "two contributions in inspector:tab");
  eq(got[0].pluginId, "plugin.a", "registration order preserved");
  eq(got[0].title, "A tab", "title carried");
  eq(got[1].pluginId, "plugin.b", "registration order preserved");
}

function test_slot_isolation(): void {
  console.log("--- slots: per-slot isolation ---");
  const r = new SlotRegistry();
  r.register("plugin.a", "inspector:tab", DummyA);
  r.register("plugin.a", "chat:input:toolbar", DummyToolbar);
  eq(r.get("inspector:tab").length, 1, "inspector:tab has 1");
  eq(r.get("chat:input:toolbar").length, 1, "chat:input:toolbar has 1");
  eq(r.get("settings:section").length, 0, "settings:section has 0");
}

function test_unregister_by_plugin(): void {
  console.log("--- slots: unregisterPlugin scopes correctly ---");
  const r = new SlotRegistry();
  r.register("plugin.a", "inspector:tab", DummyA);
  r.register("plugin.b", "inspector:tab", DummyB);
  r.register("plugin.a", "chat:input:toolbar", DummyToolbar);
  r.unregisterPlugin("plugin.a");
  eq(r.get("inspector:tab").length, 1, "only plugin.b remains in inspector:tab");
  eq(r.get("inspector:tab")[0].pluginId, "plugin.b", "correct plugin remains");
  eq(r.get("chat:input:toolbar").length, 0, "plugin.a's toolbar contribution removed");
}

function test_list_all(): void {
  console.log("--- slots: list() returns all contributions ---");
  const r = new SlotRegistry();
  r.register("plugin.a", "inspector:tab", DummyA);
  r.register("plugin.b", "chat:input:toolbar", DummyToolbar);
  const all = r.list();
  eq(all.length, 2, "list returns both contributions");
}

function test_register_same_slot_multiple_times(): void {
  console.log("--- slots: same plugin can register multiple slots ---");
  const r = new SlotRegistry();
  r.register("plugin.a", "inspector:tab", DummyA);
  r.register("plugin.a", "settings:section", DummyA);
  eq(r.get("inspector:tab").length, 1, "inspector:tab has plugin.a");
  eq(r.get("settings:section").length, 1, "settings:section has plugin.a");
}

(() => {
  try {
    test_register_and_get();
    test_slot_isolation();
    test_unregister_by_plugin();
    test_list_all();
    test_register_same_slot_multiple_times();
    ok("all slot registry tests passed");
    console.log("\n--- PASS: grimoire-slots ---");
  } catch (e) {
    console.error("--- FAIL: grimoire-slots ---", e);
    process.exit(1);
  }
})();
