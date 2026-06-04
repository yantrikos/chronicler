// Tool-loop tests. Mock the LlmProvider + McpServerRegistry to verify:
//   - When no tools exist, the loop short-circuits to a plain chat call.
//   - When the model emits tool_calls, they execute and results are
//     injected into the followup conversation.
//   - The loop terminates when the model returns a plain text reply.
//   - The iteration cap kicks in for runaway tool-call loops.
//   - allowedTools filter excludes unauthorized tools at both
//     definition-collection time AND execution time.
//   - splitQualified correctly parses server__tool names.

import type {
  ChatRequest,
  ChatResponse,
  ChatToolCall,
  LlmProvider,
} from "../src/lib/providers";
import { McpServerRegistry } from "../src/lib/mcp/registry";
import type { ExternalMcpClient } from "../src/lib/mcp/external-client";
import type { McpServerCatalog, McpToolCallResult } from "../src/lib/mcp/types";
import {
  collectTools,
  runToolLoop,
  splitQualified,
} from "../src/lib/orchestrator/tool-loop";

function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`assert failed: ${msg} (got ${String(a)}, want ${String(b)})`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}
function ok(msg: string): void {
  console.log("  ok ", msg);
}

// Stub localStorage for Node (registry persists configs).
class MemStorage {
  private data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
  removeItem(k: string): void { this.data.delete(k); }
  clear(): void { this.data.clear(); }
  get length(): number { return this.data.size; }
  key(n: number): string | null { return Array.from(this.data.keys())[n] ?? null; }
}
(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();

/** Scripted provider — returns pre-canned responses in order. */
function scriptedProvider(responses: ChatResponse[]): LlmProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  let i = 0;
  return {
    name: "scripted",
    calls,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      calls.push(req);
      if (i >= responses.length) {
        throw new Error(`scripted provider out of responses at call ${i}`);
      }
      return responses[i++];
    },
  };
}

/** Inject a fake client + catalog into the registry for testing. The
 *  registry doesn't expose these as public seams; we reach through with
 *  test-only casts. */
function injectFakeServer(
  registry: McpServerRegistry,
  serverId: string,
  catalog: McpServerCatalog,
  callImpl: (tool: string, args: Record<string, unknown>) => Promise<McpToolCallResult>
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
    callTool: callImpl,
    refreshCatalog: async () => catalog,
    testConnection: async () => ({ ok: true }),
    dispose: async () => undefined,
    readResource: async () => ({ kind: "text" as const, text: "" }),
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

function reset(registry: McpServerRegistry): void {
  for (const s of registry.list()) registry.remove(s.id);
}

const baseRequest: Omit<ChatRequest, "tools" | "tool_choice"> = {
  model: "test",
  system: "you are a test",
  messages: [{ role: "user", content: "hi" }],
};

async function test_no_tools_plain_chat(): Promise<void> {
  console.log("--- tool-loop: no tools → plain chat call ---");
  const registry = new McpServerRegistry();
  reset(registry);
  const provider = scriptedProvider([{ content: "hello" }]);
  const result = await runToolLoop(provider, registry, baseRequest);
  eq(result.content, "hello", "reply passed through");
  eq(result.invocations.length, 0, "no tool invocations");
  eq(result.truncated, false, "not truncated");
  eq(provider.calls.length, 1, "exactly one provider call");
  assert(!provider.calls[0].tools, "tools not set on plain call");
}

async function test_one_tool_call_then_reply(): Promise<void> {
  console.log("--- tool-loop: tool call → execute → final reply ---");
  const registry = new McpServerRegistry();
  reset(registry);
  injectFakeServer(
    registry,
    "dice",
    {
      serverId: "dice",
      fetchedAt: new Date().toISOString(),
      tools: [{ name: "roll", description: "Roll dice", inputSchema: { type: "object" } }],
      resources: [],
      prompts: [],
    },
    async (tool, args) => {
      eq(tool, "roll", "called with tool name");
      eq((args as { sides: number }).sides, 6, "args parsed");
      return { kind: "text", text: "rolled 4" };
    }
  );

  const tc: ChatToolCall = {
    id: "tc1",
    type: "function",
    function: { name: "dice__roll", arguments: '{"sides":6}' },
  };
  const provider = scriptedProvider([
    { content: "", tool_calls: [tc] },
    { content: "I rolled a 4!" },
  ]);

  const result = await runToolLoop(provider, registry, baseRequest);
  eq(result.content, "I rolled a 4!", "final reply correct");
  eq(result.invocations.length, 1, "one invocation");
  eq(result.invocations[0].serverId, "dice", "correct server");
  eq(result.invocations[0].toolName, "roll", "correct tool");
  eq(result.invocations[0].toolCallId, "tc1", "tool_call_id preserved");
  eq(result.invocations[0].result.kind, "text", "result kind");
  eq(provider.calls.length, 2, "two provider calls (initial + after tool result)");
  // Second call must include the tool message
  const secondMessages = provider.calls[1].messages;
  const toolMsg = secondMessages.find((m) => m.role === "tool");
  assert(toolMsg, "tool message included in followup");
  eq(toolMsg?.tool_call_id, "tc1", "tool_call_id matches");
  eq(toolMsg?.content, "rolled 4", "tool content matches");
}

async function test_truncation_at_iteration_cap(): Promise<void> {
  console.log("--- tool-loop: iteration cap kicks in for runaway loops ---");
  const registry = new McpServerRegistry();
  reset(registry);
  injectFakeServer(
    registry,
    "loop",
    {
      serverId: "loop",
      fetchedAt: new Date().toISOString(),
      tools: [{ name: "more", inputSchema: { type: "object" } }],
      resources: [],
      prompts: [],
    },
    async () => ({ kind: "text", text: "k" })
  );

  // Model always asks for another tool call. We feed enough responses
  // that the loop would run forever without the cap.
  const callMore = (id: string): ChatResponse => ({
    content: "",
    tool_calls: [{ id, type: "function", function: { name: "loop__more", arguments: "{}" } }],
  });
  const provider = scriptedProvider([
    callMore("t1"),
    callMore("t2"),
    callMore("t3"),
    callMore("t4"), // shouldn't be reached; cap is 3
  ]);
  const result = await runToolLoop(provider, registry, baseRequest, { maxIterations: 3 });
  eq(result.truncated, true, "truncated=true");
  eq(result.invocations.length, 3, "3 invocations executed (one per iteration)");
  eq(provider.calls.length, 3, "exactly 3 provider calls before bailing");
}

async function test_allowedTools_filter(): Promise<void> {
  console.log("--- tool-loop: allowedTools filters at definition + execution time ---");
  const registry = new McpServerRegistry();
  reset(registry);
  injectFakeServer(
    registry,
    "dice",
    {
      serverId: "dice",
      fetchedAt: new Date().toISOString(),
      tools: [
        { name: "roll" },
        { name: "flip" },
        { name: "pick" },
      ],
      resources: [],
      prompts: [],
    },
    async () => ({ kind: "text", text: "ok" })
  );

  const allowed = new Set(["dice__roll"]); // only roll is allowed
  const tools = collectTools(registry, { allowedTools: allowed });
  eq(tools.length, 1, "only one tool collected");
  eq(tools[0].function.name, "dice__roll", "correct tool");

  // Even if the model hallucinates "dice__flip", execution rejects it.
  const tcDenied: ChatToolCall = {
    id: "tc-deny",
    type: "function",
    function: { name: "dice__flip", arguments: "{}" },
  };
  const provider = scriptedProvider([
    { content: "", tool_calls: [tcDenied] },
    { content: "k" },
  ]);
  const result = await runToolLoop(provider, registry, baseRequest, {
    allowedTools: allowed,
  });
  eq(result.invocations.length, 1, "execution happened");
  eq(result.invocations[0].result.kind, "error", "denied tool returned an error");
  if (result.invocations[0].result.kind === "error") {
    assert(
      result.invocations[0].result.message.includes("not in character's allowed-tool list"),
      "error message mentions allowlist"
    );
  }
}

function test_splitQualified_round_trips(): void {
  console.log("--- tool-loop: splitQualified ---");
  const a = splitQualified("dice__roll");
  assert(a, "split succeeds");
  eq(a?.serverId, "dice", "server");
  eq(a?.toolName, "roll", "tool");
  // Underscore in tool name preserved (split on FIRST occurrence)
  const b = splitQualified("server__some__tool__name");
  eq(b?.serverId, "server", "server");
  eq(b?.toolName, "some__tool__name", "tool with internal __ preserved");
  // No separator → null
  eq(splitQualified("notqualified"), null, "no separator → null");
  // Empty server or tool → null
  eq(splitQualified("__tool"), null, "empty server → null");
  eq(splitQualified("server__"), null, "empty tool → null");
}

async function test_malformed_args_safe(): Promise<void> {
  console.log("--- tool-loop: malformed JSON args produce error not crash ---");
  const registry = new McpServerRegistry();
  reset(registry);
  injectFakeServer(
    registry,
    "dice",
    {
      serverId: "dice",
      fetchedAt: new Date().toISOString(),
      tools: [{ name: "roll" }],
      resources: [],
      prompts: [],
    },
    async () => ({ kind: "text", text: "should not be called" })
  );
  const tc: ChatToolCall = {
    id: "tc-bad",
    type: "function",
    function: { name: "dice__roll", arguments: "not json{{{" },
  };
  const provider = scriptedProvider([
    { content: "", tool_calls: [tc] },
    { content: "I tried but the JSON was bad" },
  ]);
  const result = await runToolLoop(provider, registry, baseRequest);
  eq(result.invocations.length, 1, "one invocation logged");
  eq(result.invocations[0].result.kind, "error", "result is error");
}

(async () => {
  try {
    await test_no_tools_plain_chat();
    await test_one_tool_call_then_reply();
    await test_truncation_at_iteration_cap();
    await test_allowedTools_filter();
    test_splitQualified_round_trips();
    await test_malformed_args_safe();
    ok("all tool-loop tests passed");
    console.log("\n--- PASS: mcp-tool-loop ---");
  } catch (e) {
    console.error("--- FAIL: mcp-tool-loop ---", e);
    process.exit(1);
  }
})();
