// Tool-calling loop. Sits between Orchestrator.turn()'s "make chat call"
// and "produce final reply" steps.
//
// Flow:
//   1. Collect tool definitions from the MCP registry (filtered by
//      character allowlist when one is configured).
//   2. Call the provider with the tools field set.
//   3. If the response has tool_calls, execute each against the registry,
//      append a tool message per call to the conversation, re-call.
//   4. Loop up to MAX_ITERATIONS (default 3). Stop early when the model
//      returns a normal text reply with no tool_calls.
//   5. Return the final text reply plus a per-iteration log of tool
//      invocations + results — used by the chat UI to render them inline
//      and by the inspector for "what happened this turn."
//
// Per-character gating: when a character has a configured tool allowlist,
// only those tools are passed to the model AND only those are allowed to
// execute (defense in depth — model could hallucinate a tool name from
// system prompt; the executor rejects unlisted ones).

import type {
  ChatMessage,
  ChatRequest,
  ChatToolCall,
  ChatToolDef,
  LlmProvider,
} from "../providers";
import type { McpServerRegistry } from "../mcp/registry";
import type { McpToolCallResult } from "../mcp/types";

export interface ToolInvocation {
  /** Iteration number (0-indexed) within this turn. */
  iteration: number;
  /** The model-assigned tool_call_id. Needed to satisfy the OpenAI
   *  spec when injecting tool result messages — tool_call_id must
   *  match the originating assistant message's tool_calls entry. */
  toolCallId: string;
  /** Server id this tool was provided by. */
  serverId: string;
  /** Tool name on that server. */
  toolName: string;
  /** Display name used in the system prompt (serverId__toolName). */
  qualifiedName: string;
  /** Parsed arguments JSON. */
  args: Record<string, unknown>;
  /** Tool result, shaped for the chat renderer. */
  result: McpToolCallResult;
  /** Wall-clock ms. */
  durationMs: number;
}

export interface ToolLoopResult {
  /** Final text reply from the model after all tool calls resolve. */
  content: string;
  /** Every tool call that fired during this turn, in execution order. */
  invocations: ToolInvocation[];
  /** True when MAX_ITERATIONS was hit (model wanted more tool calls). */
  truncated: boolean;
}

const MAX_ITERATIONS = 3;
/** Separator between server id and tool name in the qualified function
 *  name we expose to the model. Double-underscore is uncommon enough in
 *  real tool names that it disambiguates cleanly. */
const QUALIFIER_SEP = "__";

export interface ToolLoopOpts {
  /** Optional per-character allowlist: tools NOT in this set are filtered
   *  out before passing to the model AND rejected at execution time.
   *  Strings are qualified names ("dice__roll"). When omitted, all
   *  enabled tools from all enabled servers are available. */
  allowedTools?: Set<string>;
  /** Override the iteration cap (default 3). */
  maxIterations?: number;
}

/** Build the list of tools to expose for this turn. */
export function collectTools(
  registry: McpServerRegistry,
  opts: ToolLoopOpts = {}
): ChatToolDef[] {
  const out: ChatToolDef[] = [];
  for (const server of registry.list()) {
    if (!server.enabled) continue;
    const catalog = registry.getCatalog(server.id);
    if (!catalog) continue;
    for (const tool of catalog.tools) {
      const qualified = `${server.id}${QUALIFIER_SEP}${tool.name}`;
      if (opts.allowedTools && !opts.allowedTools.has(qualified)) continue;
      out.push({
        type: "function",
        function: {
          name: qualified,
          description: tool.description,
          parameters: tool.inputSchema ?? { type: "object", properties: {} },
        },
      });
    }
  }
  return out;
}

/** Split a qualified function name back into (serverId, toolName). */
export function splitQualified(
  qualified: string
): { serverId: string; toolName: string } | null {
  const idx = qualified.indexOf(QUALIFIER_SEP);
  if (idx <= 0 || idx >= qualified.length - QUALIFIER_SEP.length) return null;
  return {
    serverId: qualified.slice(0, idx),
    toolName: qualified.slice(idx + QUALIFIER_SEP.length),
  };
}

/** Run the tool-call loop. Caller supplies the base chat request
 *  (system+messages already composed); we add tools, drive the loop,
 *  and return the final text plus the trace. */
export async function runToolLoop(
  provider: LlmProvider,
  registry: McpServerRegistry,
  baseRequest: Omit<ChatRequest, "tools" | "tool_choice">,
  opts: ToolLoopOpts = {}
): Promise<ToolLoopResult> {
  const tools = collectTools(registry, opts);
  // No tools available? Skip the loop entirely — plain chat call.
  if (tools.length === 0) {
    const reply = await provider.chat(baseRequest);
    return { content: reply.content, invocations: [], truncated: false };
  }

  const invocations: ToolInvocation[] = [];
  const max = opts.maxIterations ?? MAX_ITERATIONS;
  // We mutate `messages` across iterations so the model sees its own
  // prior tool_calls + the tool results when deciding what to do next.
  const messages: ChatMessage[] = [...baseRequest.messages];

  for (let i = 0; i < max; i++) {
    const reply = await provider.chat({
      ...baseRequest,
      messages,
      tools,
      tool_choice: "auto",
    });

    // No tool calls → final reply.
    if (!reply.tool_calls || reply.tool_calls.length === 0) {
      return { content: reply.content, invocations, truncated: false };
    }

    // Reflect the assistant's tool_calls into the running messages so
    // the next iteration has continuity (OpenAI spec requires the
    // assistant tool_calls message to precede tool result messages).
    messages.push({
      role: "assistant",
      content: reply.content ?? "",
      tool_calls: reply.tool_calls,
    });

    // Execute each call. We do them in parallel — independent tools
    // shouldn't pay sequential latency. If a tool depends on another's
    // output, that's a multi-iteration flow; the model emits one call
    // per iteration in that case.
    const results = await Promise.all(
      reply.tool_calls.map(async (tc) => {
        return executeOne(registry, tc, i, opts.allowedTools);
      })
    );

    for (const r of results) {
      invocations.push(r);
      messages.push({
        role: "tool",
        tool_call_id: r.toolCallId,
        content: formatToolResultForModel(r.result),
        tool_name: r.qualifiedName,
      });
    }
  }

  // Hit the iteration cap with the model still wanting to call tools.
  // Pull the last assistant content (if any) as a best-effort reply.
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  return {
    content:
      lastAssistant?.content ??
      "(tool-call iteration limit reached; model wanted more calls but stopped)",
    invocations,
    truncated: true,
  };
}

async function executeOne(
  registry: McpServerRegistry,
  tc: ChatToolCall,
  iteration: number,
  allowedTools?: Set<string>
): Promise<ToolInvocation> {
  const started = Date.now();
  const qualified = tc.function.name;
  const toolCallId = tc.id;
  const split = splitQualified(qualified);
  if (!split) {
    return {
      iteration,
      toolCallId,
      serverId: "?",
      toolName: qualified,
      qualifiedName: qualified,
      args: {},
      result: {
        kind: "error",
        message: `malformed tool name: ${qualified} (expected serverId__toolName)`,
      },
      durationMs: Date.now() - started,
    };
  }
  if (allowedTools && !allowedTools.has(qualified)) {
    return {
      iteration,
      toolCallId,
      serverId: split.serverId,
      toolName: split.toolName,
      qualifiedName: qualified,
      args: {},
      result: {
        kind: "error",
        message: `tool ${qualified} not in character's allowed-tool list`,
      },
      durationMs: Date.now() - started,
    };
  }
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tc.function.arguments || "{}");
    if (typeof args !== "object" || args === null) args = {};
  } catch {
    return {
      iteration,
      toolCallId,
      serverId: split.serverId,
      toolName: split.toolName,
      qualifiedName: qualified,
      args: {},
      result: {
        kind: "error",
        message: `tool arguments are not valid JSON: ${tc.function.arguments}`,
      },
      durationMs: Date.now() - started,
    };
  }
  const result = await registry.callTool(split.serverId, split.toolName, args);
  return {
    iteration,
    toolCallId,
    serverId: split.serverId,
    toolName: split.toolName,
    qualifiedName: qualified,
    args,
    result,
    durationMs: Date.now() - started,
  };
}

/** Render an MCP tool call result as a string for the model's
 *  followup-context. The chat UI uses the structured McpToolCallResult
 *  directly for rendering. */
function formatToolResultForModel(r: McpToolCallResult): string {
  switch (r.kind) {
    case "text":
      return r.text;
    case "image":
      return `[image] ${r.url}`;
    case "audio":
      return `[audio] ${r.url}`;
    case "json":
      try {
        return JSON.stringify(r.data, null, 2);
      } catch {
        return "[json result]";
      }
    case "error":
      return `Tool returned an error: ${r.message}`;
  }
}
