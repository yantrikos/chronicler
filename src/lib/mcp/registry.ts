// External MCP server registry. Persists server configs to localStorage,
// manages client lifecycle (one ExternalMcpClient per server), surfaces
// catalog + status for the UI.
//
// Subscribers (settings panel, chat renderer) re-read on version bumps.

import { ExternalMcpClient } from "./external-client";
import type {
  McpServerCatalog,
  McpServerConfig,
  McpServerStatus,
  McpToolCallResult,
} from "./types";

const STORAGE_KEY = "chronicler.mcp.servers.v1";

export class McpServerRegistry {
  private servers = new Map<string, McpServerConfig>();
  private clients = new Map<string, ExternalMcpClient>();
  private statuses = new Map<string, McpServerStatus>();
  private version = 0;
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
  }

  /** Replace all server configs in one shot. Useful for bulk-edit flows
   *  (settings panel save). Reinitializes only what changed. */
  setConfigs(configs: McpServerConfig[]): void {
    // Find removed servers and dispose their clients.
    const newIds = new Set(configs.map((c) => c.id));
    for (const [id, client] of this.clients) {
      if (!newIds.has(id)) {
        void client.dispose();
        this.clients.delete(id);
        this.statuses.delete(id);
      }
    }
    // Replace + persist.
    this.servers.clear();
    for (const c of configs) this.servers.set(c.id, { ...c });
    this.persist();
    this.bump();
  }

  upsert(config: McpServerConfig): void {
    const existing = this.clients.get(config.id);
    if (existing) {
      // If transport/url/auth changed, dispose the old client so the next
      // call reconnects with the new settings.
      const prev = this.servers.get(config.id);
      if (
        prev?.url !== config.url ||
        prev?.transport !== config.transport ||
        prev?.authToken !== config.authToken ||
        prev?.enabled !== config.enabled
      ) {
        void existing.dispose();
        this.clients.delete(config.id);
        this.statuses.delete(config.id);
      }
    }
    this.servers.set(config.id, { ...config });
    this.persist();
    this.bump();
  }

  remove(id: string): void {
    this.servers.delete(id);
    const client = this.clients.get(id);
    if (client) void client.dispose();
    this.clients.delete(id);
    this.statuses.delete(id);
    this.persist();
    this.bump();
  }

  list(): McpServerConfig[] {
    return Array.from(this.servers.values()).map((s) => ({ ...s }));
  }

  get(id: string): McpServerConfig | undefined {
    const s = this.servers.get(id);
    return s ? { ...s } : undefined;
  }

  /** Force connect + catalog refresh for a server. Updates status; the
   *  caller (UI button or boot path) is responsible for handling errors. */
  async initialize(id: string): Promise<McpServerCatalog> {
    const config = this.servers.get(id);
    if (!config) throw new Error(`unknown MCP server: ${id}`);
    if (!config.enabled) {
      throw new Error(`MCP server ${id} is disabled`);
    }
    let client = this.clients.get(id);
    if (!client) {
      client = new ExternalMcpClient(config);
      this.clients.set(id, client);
    }
    this.statuses.set(id, { serverId: id, state: "connecting" });
    this.bump();
    try {
      const catalog = await client.refreshCatalog();
      this.statuses.set(id, {
        serverId: id,
        state: "ready",
        lastConnectedAt: new Date().toISOString(),
      });
      this.bump();
      return catalog;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.statuses.set(id, { serverId: id, state: "error", lastError: message });
      this.bump();
      throw e;
    }
  }

  /** Initialize every enabled server in parallel. Errors are caught per
   *  server (status reflects them); the returned promise always resolves. */
  async initializeAll(): Promise<void> {
    const enabled = this.list().filter((s) => s.enabled);
    await Promise.allSettled(enabled.map((s) => this.initialize(s.id)));
  }

  getCatalog(id: string): McpServerCatalog | null {
    return this.clients.get(id)?.getCatalog() ?? null;
  }

  getStatus(id: string): McpServerStatus {
    return (
      this.statuses.get(id) ?? { serverId: id, state: "uninitialized" }
    );
  }

  async testConnection(id: string): Promise<{ ok: boolean; error?: string }> {
    const config = this.servers.get(id);
    if (!config) return { ok: false, error: "unknown server" };
    const client = new ExternalMcpClient(config);
    try {
      return await client.testConnection();
    } finally {
      await client.dispose();
    }
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<McpToolCallResult> {
    const config = this.servers.get(serverId);
    if (!config) {
      return { kind: "error", message: `unknown MCP server: ${serverId}` };
    }
    if (!config.enabled) {
      return { kind: "error", message: `MCP server ${serverId} is disabled` };
    }
    let client = this.clients.get(serverId);
    if (!client) {
      client = new ExternalMcpClient(config);
      this.clients.set(serverId, client);
    }
    if (!client.isReady()) {
      try {
        await this.initialize(serverId);
      } catch (e) {
        return {
          kind: "error",
          message: `failed to initialize ${serverId}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
    return client.callTool(toolName, args);
  }

  async readResource(
    serverId: string,
    uri: string
  ): Promise<McpToolCallResult> {
    const config = this.servers.get(serverId);
    if (!config) {
      return { kind: "error", message: `unknown MCP server: ${serverId}` };
    }
    let client = this.clients.get(serverId);
    if (!client) {
      client = new ExternalMcpClient(config);
      this.clients.set(serverId, client);
    }
    return client.readResource(uri);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion(): number {
    return this.version;
  }

  private bump(): void {
    this.version++;
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        console.warn("[mcp-registry] listener threw", e);
      }
    }
  }

  private persist(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.list()));
    } catch (e) {
      console.warn("[mcp-registry] persist failed", e);
    }
  }

  private load(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const c of parsed) {
        if (isValidConfig(c)) this.servers.set(c.id, c);
      }
    } catch (e) {
      console.warn("[mcp-registry] load failed", e);
    }
  }
}

function isValidConfig(c: unknown): c is McpServerConfig {
  if (!c || typeof c !== "object") return false;
  const x = c as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    typeof x.name === "string" &&
    typeof x.url === "string" &&
    (x.transport === "sse" || x.transport === "streamable-http") &&
    typeof x.enabled === "boolean"
  );
}
