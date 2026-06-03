// Grimoire slash command tests: registration, autocomplete prefix match,
// dispatch, error handling, conflict detection.

import { PluginHost } from "../src/lib/grimoire/host";
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

const baseManifest: GrimoireManifest = {
  id: "test.slash",
  name: "Slash Test",
  version: "0.1.0",
  apiVersion: "^0.1.0",
};

async function test_register_and_list(): Promise<void> {
  console.log("--- slash: register + list ---");
  const host = newHost();
  const def = defineGrimoire({
    id: "test.slash",
    setup(ctx) {
      ctx.commands.register({
        name: "roll",
        description: "roll dice",
        run: () => ({ kind: "text", content: "rolled" }),
      });
      ctx.commands.register({
        name: "export",
        description: "export transcript",
        run: () => ({ kind: "system", content: "exported" }),
      });
      return {};
    },
  });
  await host.loadPlugin(baseManifest, def, "register-list");
  const cmds = host.commands.list();
  eq(cmds.length, 2, "two commands registered");
  eq(cmds[0].name, "export", "alphabetical sort");
  eq(cmds[1].name, "roll", "alphabetical sort");
}

async function test_register_strips_leading_slash(): Promise<void> {
  console.log("--- slash: name normalization strips leading '/' ---");
  const host = newHost();
  const def = defineGrimoire({
    id: "test.slash",
    setup(ctx) {
      ctx.commands.register({
        name: "/foo",
        description: "leading slash",
        run: () => ({ kind: "text", content: "ok" }),
      });
      return {};
    },
  });
  await host.loadPlugin(baseManifest, def, "norm");
  const cmds = host.commands.list();
  eq(cmds[0].name, "foo", "leading slash stripped");
}

async function test_match_prefix(): Promise<void> {
  console.log("--- slash: prefix match for autocomplete ---");
  const host = newHost();
  const def = defineGrimoire({
    id: "test.slash",
    setup(ctx) {
      ctx.commands.register({
        name: "roll",
        description: "",
        run: () => undefined,
      });
      ctx.commands.register({
        name: "remind",
        description: "",
        run: () => undefined,
      });
      ctx.commands.register({
        name: "export",
        description: "",
        run: () => undefined,
      });
      return {};
    },
  });
  await host.loadPlugin(baseManifest, def, "match");
  const matches = host.commands.match("/re");
  eq(matches.length, 1, "only /remind matches 're' prefix");
  eq(matches[0].name, "remind", "correct match");
  const broader = host.commands.match("r");
  eq(broader.length, 2, "'r' matches both roll + remind");
}

async function test_trigger_dispatch(): Promise<void> {
  console.log("--- slash: trigger dispatch returns result ---");
  const host = newHost();
  let receivedArgs = "";
  const def = defineGrimoire({
    id: "test.slash",
    setup(ctx) {
      ctx.commands.register({
        name: "echo",
        description: "echo args",
        run: (args) => {
          receivedArgs = args;
          return { kind: "text", content: `echo: ${args}` };
        },
      });
      return {};
    },
  });
  await host.loadPlugin(baseManifest, def, "trigger");
  const result = await host.triggerCommand("echo", "hello world");
  eq(receivedArgs, "hello world", "args passed through");
  assert(result, "result returned");
  if (result) {
    eq(result.kind, "text", "kind is text");
    eq(result.content, "echo: hello world", "content correct");
  }
}

async function test_trigger_unknown_command(): Promise<void> {
  console.log("--- slash: unknown command returns error ---");
  const host = newHost();
  const result = await host.triggerCommand("nope", "");
  assert(result, "result returned");
  if (result) {
    eq(result.kind, "error", "unknown command returns error");
  }
}

async function test_trigger_run_throws(): Promise<void> {
  console.log("--- slash: handler throw is caught + returned as error ---");
  const host = newHost();
  const def = defineGrimoire({
    id: "test.slash",
    setup(ctx) {
      ctx.commands.register({
        name: "crash",
        description: "",
        run: () => {
          throw new Error("boom");
        },
      });
      return {};
    },
  });
  await host.loadPlugin(baseManifest, def, "crash");
  const result = await host.triggerCommand("crash", "");
  assert(result, "result returned");
  if (result) {
    eq(result.kind, "error", "kind is error");
    assert(
      result.content.includes("boom"),
      "error message preserved"
    );
  }
}

async function test_command_conflict_rejected(): Promise<void> {
  console.log("--- slash: duplicate command name across plugins rejected ---");
  const host = newHost();
  const defA = defineGrimoire({
    id: "test.slash.a",
    setup(ctx) {
      ctx.commands.register({
        name: "shared",
        description: "",
        run: () => undefined,
      });
      return {};
    },
  });
  await host.loadPlugin({ ...baseManifest, id: "test.slash.a" }, defA, "A");

  const defB = defineGrimoire({
    id: "test.slash.b",
    setup(ctx) {
      ctx.commands.register({
        name: "shared",
        description: "",
        run: () => undefined,
      });
      return {};
    },
  });
  const loaded = await host.loadPlugin(
    { ...baseManifest, id: "test.slash.b" },
    defB,
    "B"
  );
  eq(loaded, null, "second plugin rejected due to command conflict");
}

async function test_dispose_unregisters_commands(): Promise<void> {
  console.log("--- slash: unload removes plugin's commands ---");
  const host = newHost();
  const def = defineGrimoire({
    id: "test.slash",
    setup(ctx) {
      ctx.commands.register({
        name: "temp",
        description: "",
        run: () => undefined,
      });
      return {};
    },
  });
  await host.loadPlugin(baseManifest, def, "dispose");
  eq(host.commands.list().length, 1, "command registered");
  await host.unloadPlugin("test.slash");
  eq(host.commands.list().length, 0, "command removed on unload");
}

(async () => {
  try {
    await test_register_and_list();
    await test_register_strips_leading_slash();
    await test_match_prefix();
    await test_trigger_dispatch();
    await test_trigger_unknown_command();
    await test_trigger_run_throws();
    await test_command_conflict_rejected();
    await test_dispose_unregisters_commands();
    ok("all slash command tests passed");
    console.log("\n--- PASS: grimoire-slash ---");
  } catch (e) {
    console.error("--- FAIL: grimoire-slash ---", e);
    process.exit(1);
  }
})();
