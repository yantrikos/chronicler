// Types for Chronicler's external-MCP-server registry. This is the
// substrate that lets users register additional MCP servers (TTS, image
// gen, dice, web search, summarizers, anything MCP-shaped) and call
// their tools from chat turns.
//
// Conceptually separate from src/lib/yantrikdb/* which is the
// Chronicler<->YantrikDB transport. External MCP servers are user-
// registered third-party endpoints.

export type McpTransportKind = "sse" | "streamable-http";

export interface McpServerConfig {
  /** Stable id; user-supplied. Used in per-character gating + URLs. */
  id: string;
  /** Human-readable name for the settings UI. */
  name: string;
  /** Server URL. May be a relative path like "/api/mcp/dice" that goes
   *  through Chronicler's proxy, or an absolute URL. */
  url: string;
  transport: McpTransportKind;
  /** Optional bearer token; sent as Authorization: Bearer <token>. */
  authToken?: string;
  /** User-toggleable enable flag. Disabled servers don't initialize. */
  enabled: boolean;
}

export interface McpToolDescriptor {
  /** Tool name as advertised by the MCP server (without server-id prefix). */
  name: string;
  description?: string;
  /** JSON Schema for tool arguments. */
  inputSchema?: unknown;
}

export interface McpResourceDescriptor {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptDescriptor {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; required?: boolean; description?: string }>;
}

/** The full catalog cached after a server initializes. */
export interface McpServerCatalog {
  serverId: string;
  /** Loaded at the time of fetch — surface this in the UI for diagnostics. */
  fetchedAt: string;
  tools: McpToolDescriptor[];
  resources: McpResourceDescriptor[];
  prompts: McpPromptDescriptor[];
}

export interface McpServerStatus {
  serverId: string;
  /** "uninitialized" — never connected. "ready" — catalog loaded.
   *  "error" — last connect/load failed; check lastError. */
  state: "uninitialized" | "connecting" | "ready" | "error";
  lastError?: string;
  /** Wallclock ms of the last successful connect. */
  lastConnectedAt?: string;
}

/** Result type for tool invocations exposed back to the orchestrator /
 *  result renderer. Inspired by MCP's content blocks but flattened for
 *  ease of consumption — the UI keys on `kind` to pick a renderer. */
export type McpToolCallResult =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; mimeType?: string }
  | { kind: "audio"; url: string; mimeType?: string }
  | { kind: "json"; data: unknown }
  | { kind: "error"; message: string };
