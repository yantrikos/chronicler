// Grimoire — Chronicler's extension platform.
//
// This file is the public contract. Plugin ("Grimoire entry") authors import
// from here. Everything in src/lib/grimoire/{host,registry,sdk-runtime}.ts is
// PRIVATE runtime — plugins must not depend on it.
//
// See docs/GRIMOIRE-DESIGN.md for the full spec.

import type { ComponentType } from "react";
import type { Character, ChatTurn } from "../orchestrator/types";
import type { RecallResult, YantrikClient } from "../yantrikdb/client";
import type { SlotPropMap } from "./registry/slots";

/** Reverse-DNS-ish unique id. Convention: "io.org.name" or "@scope/name". */
export type GrimoireId = string;

/** Three hook flavors — see design doc for the why.
 *  - observer: read-only, multiple plugins compose
 *  - augmenter: additive mutation, multiple plugins compose by accumulation
 *  - strategy: singleton replaceable seam, ONE plugin wins per slot */
export type HookType = "observer" | "augmenter" | "strategy";

/** Orchestrator lifecycle points. The set is intentionally small for v1;
 *  expand only when a plugin author has a concrete use case. */
export type HookPoint =
  | "beforeRetrieve"
  | "afterRetrieve"
  | "beforeCompose"
  | "beforeChat"
  | "afterChat"
  | "beforeWrite"
  | "afterWrite";

/** Capability declaration shape. Enforced by the SDK-wrapped api object;
 *  bypass via raw Node APIs is documented as out-of-scope (trust boundary). */
export interface GrimoirePermissions {
  /** Allowed network hosts. ["*"] = any; [] = none. */
  network?: string[];
  /** Filesystem scope. "plugin-data-only" = sandboxed to own dir;
   *  "read-app-data" = read-only app data dir; false = no filesystem. */
  filesystem?: "plugin-data-only" | "read-app-data" | false;
  /** Can the plugin call api.llm.chat()? */
  llm?: boolean;
  /** Memory access. false = none, "read" = recall only, "write" = full. */
  memory?: false | "read" | "write";
}

/** Manifest schema — what `grimoire.json` declares. */
export interface GrimoireManifest {
  id: GrimoireId;
  name: string;
  version: string;
  /** Semver range the plugin targets; the host refuses to load incompatible. */
  apiVersion: string;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  keywords?: string[];
  permissions?: GrimoirePermissions;
  contributes?: {
    hooks?: { point: HookPoint; type: HookType }[];
    commands?: string[];
    ui?: { slots?: GrimoireSlotName[] };
    mcpServers?: { id: string; url: string }[];
  };
  /** Optional JSON Schema path (relative to plugin dir) — auto-renders settings UI. */
  settingsSchema?: string;
  /** Entry path (relative to plugin dir). In-tree plugins ignore this; the
   *  Vite loader uses the directory's `index.ts`. */
  entry?: string;
}

/** Named UI slots a plugin can mount into. v1 = three slots. New slots
 *  added in future versions don't break existing plugins. */
export type GrimoireSlotName =
  | "settings:section"
  | "inspector:tab"
  | "chat:input:toolbar";

// =============================================================================
// Hook context types — what plugin handlers receive
// =============================================================================

export interface BeforeRetrieveContext {
  sessionId: string;
  character: Character;
  userMessage?: ChatTurn;
}

export interface AfterRetrieveContext {
  sessionId: string;
  character: Character;
  results: {
    canon: RecallResult[];
    scene: RecallResult[];
    heuristic: RecallResult[];
  };
}

export interface BeforeComposeContext {
  sessionId: string;
  character: Character;
}

export interface BeforeChatContext {
  sessionId: string;
  character: Character;
  systemPrompt: string;
  messages: { role: string; content: string }[];
}

export interface AfterChatContext {
  sessionId: string;
  character: Character;
  reply: { content: string };
  /** Mutable — augmenter hooks can rewrite. */
  mutatedContent?: string;
}

export interface BeforeWriteContext {
  sessionId: string;
  character: Character;
  userTurn?: ChatTurn;
  assistantTurn: ChatTurn;
}

export interface AfterWriteContext {
  sessionId: string;
  character: Character;
  userTurn?: ChatTurn;
  assistantTurn: ChatTurn;
  turnCount: number;
}

/** Map from hook point → context type. Type-safe handler signatures. */
export interface HookContextMap {
  beforeRetrieve: BeforeRetrieveContext;
  afterRetrieve: AfterRetrieveContext;
  beforeCompose: BeforeComposeContext;
  beforeChat: BeforeChatContext;
  afterChat: AfterChatContext;
  beforeWrite: BeforeWriteContext;
  afterWrite: AfterWriteContext;
}

export type HookHandler<P extends HookPoint> = (
  ctx: HookContextMap[P],
  api: GrimoireApi
) => void | Promise<void> | HookContextMap[P] | Promise<HookContextMap[P]>;

// =============================================================================
// Slash command types
// =============================================================================

export interface SlashCommandDef {
  /** Plain name without "/" — e.g. "roll" not "/roll". */
  name: string;
  description: string;
  /** Free-form arg parsing for v1. Future: zod-schema-based parsing. */
  run: (args: string, api: GrimoireApi) => Promise<SlashResult | void> | SlashResult | void;
}

/** What a slash command returns. The host renders this in the chat. */
export type SlashResult =
  | { kind: "text"; content: string }
  | { kind: "system"; content: string }
  | { kind: "error"; content: string };

// =============================================================================
// API object passed to all handlers — capability-wrapped
// =============================================================================

export interface GrimoireApi {
  /** Plugin metadata (immutable). */
  readonly plugin: { id: GrimoireId; manifest: GrimoireManifest };

  /** Logger with the plugin id prefix. */
  readonly logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };

  /** Plugin-scoped persistent KV. Backed by localStorage in v1 (browser-side);
   *  YantrikDB-backed in v1.5. Per-plugin namespace enforced. */
  readonly storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };

  /** Plugin settings, validated against the manifest's settingsSchema if set. */
  readonly settings: {
    get(): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  };

  /** Network access — host-allowlisted per permissions.network. */
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;

  /** LLM access — gated by permissions.llm. */
  readonly llm: {
    chat(req: {
      model?: string;
      system?: string;
      messages: { role: string; content: string }[];
      temperature?: number;
      max_tokens?: number;
    }): Promise<{ content: string }>;
  };

  /** Memory access — gated by permissions.memory. */
  readonly memory: {
    recall(query: {
      query: string;
      namespace?: string;
      top_k?: number;
    }): Promise<RecallResult[]>;
    write(req: {
      text: string;
      namespace?: string;
      tier?: "reflex" | "heuristic" | "canon";
      importance?: number;
    }): Promise<string>;
  };

  /** Direct YantrikDB client — power escape hatch. */
  readonly yantrik: () => YantrikClient;

  /** Slash command registry — invoke other plugins' commands programmatically. */
  readonly commands: {
    list(): SlashCommandDef[];
    trigger(name: string, args?: string): Promise<SlashResult | void>;
  };
}

// =============================================================================
// Plugin definition — what plugin authors export
// =============================================================================

export interface GrimoireDefinition {
  /** Must match the id in grimoire.json. */
  id: GrimoireId;

  /** Optional settings schema in JSON Schema form. Overrides manifest's
   *  settingsSchema file pointer for in-tree plugins. */
  settingsSchema?: object;

  /** Default settings values. */
  defaultSettings?: Record<string, unknown>;

  /** Called once when the plugin loads. Register hooks, commands, UI here.
   *  Return value is the plugin runtime (with hooks/commands/dispose). */
  setup(ctx: GrimoireSetupContext): GrimoireRuntime | Promise<GrimoireRuntime>;
}

export interface GrimoireSetupContext {
  /** Manifest, immutable. */
  readonly manifest: GrimoireManifest;

  /** Logger scoped to this plugin. */
  readonly logger: GrimoireApi["logger"];

  /** Hook registration — declares the hook + type. Handlers run later
   *  with the full api object. */
  readonly hooks: {
    beforeRetrieve: HookRegistrationApi<"beforeRetrieve">;
    afterRetrieve: HookRegistrationApi<"afterRetrieve">;
    beforeCompose: HookRegistrationApi<"beforeCompose">;
    beforeChat: HookRegistrationApi<"beforeChat">;
    afterChat: HookRegistrationApi<"afterChat">;
    beforeWrite: HookRegistrationApi<"beforeWrite">;
    afterWrite: HookRegistrationApi<"afterWrite">;
  };

  /** Slash command registry. */
  readonly commands: {
    register(def: SlashCommandDef): void;
  };

  /** UI slot registry — mount React components into named host slots.
   *  See SlotPropMap for the props contract per slot. */
  readonly ui: {
    registerSlot<S extends GrimoireSlotName>(
      slot: S,
      component: ComponentType<SlotPropMap[S]>,
      opts?: { title?: string }
    ): void;
  };
}

export interface HookRegistrationApi<P extends HookPoint> {
  observe(handler: HookHandler<P>): void;
  augment(handler: HookHandler<P>): void;
  /** v1.5 — singleton replaceable seam. Throws if another plugin already
   *  registered a strategy for this hook point. */
  strategy(handler: HookHandler<P>): void;
}

export interface GrimoireRuntime {
  /** Called when the plugin is being disposed (hot reload, disable, etc).
   *  Use this to release timers, subscriptions, file handles. */
  dispose?: () => void | Promise<void>;
}

/** Factory used by plugin authors. Just a typed pass-through. */
export function defineGrimoire(def: GrimoireDefinition): GrimoireDefinition {
  return def;
}

/** Current SDK version. Manifest apiVersion must satisfy this via semver. */
export const GRIMOIRE_SDK_VERSION = "0.1.0";
