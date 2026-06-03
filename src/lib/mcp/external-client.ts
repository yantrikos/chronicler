// External MCP client. One instance per registered server.
//
// Wraps the official @modelcontextprotocol/sdk Client with lazy connect,
// catalog loading (tools + resources + prompts), and typed tool invocation
// returning shaped results the chat-rendering UI knows how to display.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  McpServerCatalog,
  McpServerConfig,
  McpToolCallResult,
} from "./types";

export class ExternalMcpClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private catalog: McpServerCatalog | null = null;

  constructor(private readonly config: McpServerConfig) {}

  get serverId(): string {
    return this.config.id;
  }

  isReady(): boolean {
    return this.client !== null && this.catalog !== null;
  }

  /** Connect (if not connected) and refresh the tool/resource/prompt
   *  catalog. Idempotent — calling it on a ready client re-fetches the
   *  catalog (server may have added tools). */
  async refreshCatalog(): Promise<McpServerCatalog> {
    const client = await this.connect();
    const toolsRes = await safeList(() => client.listTools()).catch(() => ({
      tools: [],
    }));
    const resourcesRes = await safeList(() => client.listResources()).catch(
      () => ({ resources: [] })
    );
    const promptsRes = await safeList(() => client.listPrompts()).catch(
      () => ({ prompts: [] })
    );
    this.catalog = {
      serverId: this.config.id,
      fetchedAt: new Date().toISOString(),
      tools: (toolsRes.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      resources: (resourcesRes.resources ?? []).map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
      prompts: (promptsRes.prompts ?? []).map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      })),
    };
    return this.catalog;
  }

  getCatalog(): McpServerCatalog | null {
    return this.catalog;
  }

  /** Connect-only smoke test for the UI's "test connection" button. */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.connect();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Call a tool by name. Returns a shaped result the orchestrator and
   *  chat renderer can both consume. */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<McpToolCallResult> {
    try {
      const client = await this.connect();
      const res = await client.callTool({ name, arguments: args });
      return mapToolContent(res);
    } catch (e) {
      return {
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** Read an MCP resource by URI. Returns the body text or an error. */
  async readResource(uri: string): Promise<McpToolCallResult> {
    try {
      const client = await this.connect();
      const res = await client.readResource({ uri });
      const contents = (res as { contents?: Array<{ text?: string; mimeType?: string; uri?: string; blob?: string }> })
        .contents ?? [];
      const textBlocks = contents
        .filter((c) => typeof c.text === "string")
        .map((c) => c.text as string);
      if (textBlocks.length > 0) {
        return { kind: "text", text: textBlocks.join("\n\n") };
      }
      return { kind: "json", data: contents };
    } catch (e) {
      return {
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async dispose(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        /* ignore */
      }
      this.client = null;
      this.catalog = null;
    }
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect();
    try {
      this.client = await this.connecting;
      return this.client;
    } finally {
      this.connecting = null;
    }
  }

  private async doConnect(): Promise<Client> {
    const headers = this.config.authToken
      ? { Authorization: `Bearer ${this.config.authToken}` }
      : undefined;
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost";
    const url = new URL(this.config.url, base);
    const transport =
      this.config.transport === "sse"
        ? new SSEClientTransport(url, {
            requestInit: headers ? { headers } : undefined,
          })
        : new StreamableHTTPClientTransport(url, {
            requestInit: headers ? { headers } : undefined,
          });
    const client = new Client(
      { name: `chronicler-grimoire-mcp/${this.config.id}`, version: "0.1.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
    return client;
  }
}

/** Wrap an MCP call that may not be implemented by the server; squash
 *  "method not found" errors into an empty result shape. */
async function safeList<T extends Record<string, unknown>>(
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Method not found") || msg.includes("not implemented")) {
      // Return an empty shape — caller uses optional chaining.
      return {} as T;
    }
    throw e;
  }
}

/** Map an MCP tool call's content blocks to a single shaped result. MCP
 *  tools can return mixed-content arrays; we collapse them to the most
 *  useful single shape for the chat UI. */
function mapToolContent(res: unknown): McpToolCallResult {
  const content =
    (res as { content?: Array<{ type?: string; text?: string; uri?: string; mimeType?: string; data?: string }> })
      .content ?? [];
  if (content.length === 0) {
    return { kind: "text", text: "(no content)" };
  }
  // Image first if present (more visually obvious).
  const image = content.find((c) => c.type === "image" && c.uri);
  if (image && image.uri) {
    return { kind: "image", url: image.uri, mimeType: image.mimeType };
  }
  const audio = content.find((c) => c.type === "audio" && c.uri);
  if (audio && audio.uri) {
    return { kind: "audio", url: audio.uri, mimeType: audio.mimeType };
  }
  const textBlocks = content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  if (textBlocks.length > 0) {
    return { kind: "text", text: textBlocks.join("\n\n") };
  }
  return { kind: "json", data: content };
}
