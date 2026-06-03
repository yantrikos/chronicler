// Builds the capability-wrapped `api` object that plugins receive at every
// hook/command invocation. This is the enforcement boundary for the SDK
// permission model.

import type { LlmProvider } from "../providers";
import type { YantrikClient } from "../yantrikdb/client";
import {
  assertLlm,
  assertMemoryRead,
  assertMemoryWrite,
  assertNetwork,
  effectivePermissions,
} from "./capabilities";
import type { CommandRegistry } from "./registry/commands";
import type {
  GrimoireApi,
  GrimoireId,
  GrimoireManifest,
} from "./types";

export interface SdkRuntimeDeps {
  client: YantrikClient;
  provider: LlmProvider | null;
  model: string;
  /** Storage backend. v1 = localStorage; v1.5 = YantrikDB-backed. */
  storage: StorageBackend;
}

/** SDK construction needs registry access too, but the PluginHost owns
 *  those — so buildApi takes them via a context object rather than packing
 *  into deps. Avoids the circular-construction hack in App.tsx, and lets
 *  plugin-to-plugin command calls resolve through the host (so the target
 *  plugin runs with ITS OWN manifest/permissions, not the caller's). */
export interface SdkRuntimeContext {
  deps: SdkRuntimeDeps;
  commands: CommandRegistry;
  /** Host-mediated command invocation. Used so target plugin runs with
   *  its own manifest/permissions rather than the caller's. */
  triggerCommand: (name: string, args: string) => Promise<import("./types").SlashResult | void>;
}

export interface StorageBackend {
  get(pluginId: GrimoireId, key: string): Promise<unknown>;
  set(pluginId: GrimoireId, key: string, value: unknown): Promise<void>;
  delete(pluginId: GrimoireId, key: string): Promise<void>;
  clear(pluginId: GrimoireId): Promise<void>;
  /** Settings live in a separate namespace from storage. */
  getSettings(pluginId: GrimoireId): Promise<Record<string, unknown>>;
  setSettings(pluginId: GrimoireId, values: Record<string, unknown>): Promise<void>;
}

/** Build an api object scoped to one plugin. Called per-invocation so
 *  capability checks always reflect the latest manifest (hot-reload safe). */
export function buildApi(
  pluginId: GrimoireId,
  manifest: GrimoireManifest,
  ctx: SdkRuntimeContext
): GrimoireApi {
  const { deps, commands } = ctx;
  const perms = effectivePermissions(manifest.permissions);
  const logger = makeLogger(pluginId);

  return {
    plugin: { id: pluginId, manifest },
    logger,
    storage: {
      get: (key) => deps.storage.get(pluginId, key) as Promise<never>,
      set: (key, value) => deps.storage.set(pluginId, key, value),
      delete: (key) => deps.storage.delete(pluginId, key),
      clear: () => deps.storage.clear(pluginId),
    },
    settings: {
      get: () => deps.storage.getSettings(pluginId),
      set: (values) => deps.storage.setSettings(pluginId, values),
    },
    fetch: async (url, init) => {
      assertNetwork(pluginId, url, perms);
      return fetch(url, init);
    },
    llm: {
      chat: async (req) => {
        assertLlm(pluginId, perms);
        if (!deps.provider) {
          throw new Error(`[${pluginId}] no LLM provider configured`);
        }
        const reply = await deps.provider.chat({
          model: req.model ?? deps.model,
          system: req.system ?? "",
          messages: req.messages.map((m) => ({
            role: m.role as "system" | "user" | "assistant",
            content: m.content,
          })),
          temperature: req.temperature,
          max_tokens: req.max_tokens ?? 1024,
        });
        return { content: reply.content };
      },
    },
    memory: {
      recall: async (query) => {
        assertMemoryRead(pluginId, perms);
        const res = await deps.client.recall({
          query: query.query,
          namespace: query.namespace,
          top_k: query.top_k ?? 10,
        });
        return res.results;
      },
      write: async (req) => {
        assertMemoryWrite(pluginId, perms);
        const namespace = req.namespace ?? `grimoire:${pluginId}`;
        const { rid } = await deps.client.remember({
          text: req.text,
          namespace,
          importance: req.importance,
          source: "system",
          metadata: {
            tier: req.tier ?? "heuristic",
            canonical_status: "canon",
            visible_to: ["*"],
            session_id: `grimoire-${pluginId}`,
          },
        });
        return rid;
      },
    },
    yantrik: () => deps.client,
    commands: {
      list: () => commands.list(),
      trigger: (name, args) => ctx.triggerCommand(name, args ?? ""),
    },
  };
}

function makeLogger(pluginId: GrimoireId) {
  const prefix = `[grimoire/${pluginId}]`;
  return {
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}

/** Default localStorage-backed storage. Sufficient for v1 (browser-side).
 *  v1.5 will swap to YantrikDB-backed scoped KV. */
export class LocalStorageBackend implements StorageBackend {
  private key(pluginId: GrimoireId, k: string): string {
    return `chronicler.grimoire.storage.${pluginId}.${k}`;
  }
  private settingsKey(pluginId: GrimoireId): string {
    return `chronicler.grimoire.settings.${pluginId}`;
  }

  async get(pluginId: GrimoireId, key: string): Promise<unknown> {
    try {
      const raw = localStorage.getItem(this.key(pluginId, key));
      if (raw === null) return undefined;
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  async set(pluginId: GrimoireId, key: string, value: unknown): Promise<void> {
    localStorage.setItem(this.key(pluginId, key), JSON.stringify(value));
  }
  async delete(pluginId: GrimoireId, key: string): Promise<void> {
    localStorage.removeItem(this.key(pluginId, key));
  }
  async clear(pluginId: GrimoireId): Promise<void> {
    const prefix = `chronicler.grimoire.storage.${pluginId}.`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) localStorage.removeItem(k);
    }
  }
  async getSettings(pluginId: GrimoireId): Promise<Record<string, unknown>> {
    try {
      const raw = localStorage.getItem(this.settingsKey(pluginId));
      if (raw === null) return {};
      const parsed = JSON.parse(raw);
      return (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  async setSettings(
    pluginId: GrimoireId,
    values: Record<string, unknown>
  ): Promise<void> {
    localStorage.setItem(this.settingsKey(pluginId), JSON.stringify(values));
  }
}

/** In-memory storage backend for tests. */
export class MemoryStorageBackend implements StorageBackend {
  private data = new Map<string, unknown>();
  private settingsData = new Map<GrimoireId, Record<string, unknown>>();
  private key(pluginId: GrimoireId, k: string): string {
    return `${pluginId}::${k}`;
  }
  async get(pluginId: GrimoireId, key: string): Promise<unknown> {
    return this.data.get(this.key(pluginId, key));
  }
  async set(pluginId: GrimoireId, key: string, value: unknown): Promise<void> {
    this.data.set(this.key(pluginId, key), value);
  }
  async delete(pluginId: GrimoireId, key: string): Promise<void> {
    this.data.delete(this.key(pluginId, key));
  }
  async clear(pluginId: GrimoireId): Promise<void> {
    for (const k of this.data.keys()) {
      if (k.startsWith(pluginId + "::")) this.data.delete(k);
    }
  }
  async getSettings(pluginId: GrimoireId): Promise<Record<string, unknown>> {
    return this.settingsData.get(pluginId) ?? {};
  }
  async setSettings(
    pluginId: GrimoireId,
    values: Record<string, unknown>
  ): Promise<void> {
    this.settingsData.set(pluginId, values);
  }
}
