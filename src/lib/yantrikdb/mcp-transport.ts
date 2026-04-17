// Real MCP transport. Speaks to the YantrikDB MCP server using the official
// MCP TypeScript SDK. Supports both SSE and streamable-http endpoints.
//
// Addresses Risk #3 from the review: lets Chronicler actually talk to
// production YantrikDB instead of the in-memory shim.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { YantrikDBTransport } from "./client";

export type McpTransportKind = "sse" | "streamable-http";

export interface McpTransportOpts {
  kind: McpTransportKind;
  url: string;
  authToken?: string;
}

/** MCP transport that wraps the official TS SDK. Lazily connects on first
 *  call; reuses the connection for subsequent tool invocations. */
export class McpTransport implements YantrikDBTransport {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(private opts: McpTransportOpts) {}

  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.connect();
    const res = await client.callTool({ name: tool, arguments: args });
    // MCP returns a structured response; our existing transport expects
    // { result: <JSON string> } shape because the YantrikDB tools wrap their
    // payloads that way. Try to preserve that contract.
    const content = (res as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
    const text = content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    return { result: text };
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
    const headers = this.opts.authToken
      ? { Authorization: `Bearer ${this.opts.authToken}` }
      : undefined;

    // Resolve relative URLs (e.g. "/api/mcp") against the current origin so
    // same-origin proxy paths work in the browser. Absolute URLs pass through
    // unchanged; tests run under Node supply an absolute URL.
    const base =
      typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const url = new URL(this.opts.url, base);
    const transport =
      this.opts.kind === "sse"
        ? new SSEClientTransport(url, {
            requestInit: headers ? { headers } : undefined,
          })
        : new StreamableHTTPClientTransport(url, {
            requestInit: headers ? { headers } : undefined,
          });

    const client = new Client(
      { name: "chronicler", version: "0.1.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
    return client;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => undefined);
      this.client = null;
    }
  }
}
