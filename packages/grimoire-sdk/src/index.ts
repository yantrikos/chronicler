// @chronicler/grimoire — TypeScript SDK for Chronicler plugins.
//
// Plugin authors import types + the defineGrimoire helper from here.
// The runtime side (PluginHost, registries) lives in the chronicler
// app itself — plugins just declare what they contribute via this
// typed surface.
//
// IMPORTANT: this package is the PUBLIC contract. Adding fields is
// non-breaking (existing plugins ignore them); removing or renaming
// requires a major version bump. The actual runtime in chronicler may
// move faster — keeping this stable is what makes the plugin ecosystem
// possible.

import type { ComponentType } from "react";

/** Reverse-DNS-ish unique id. Convention: "io.org.name" or "@scope/name". */
export type GrimoireId = string;

/** Three hook flavors with distinct composition semantics:
 *  - observer: read-only listener. Multiple plugins compose freely.
 *  - augmenter: additive mutator. Multiple plugins compose by accumulation
 *    in registration order. Errors auto-disable the plugin.
 *  - strategy: singleton replaceable seam (summarizer, reranker, etc).
 *    ONE plugin per hook point; conflicts rejected at registration. */
export type HookType = "observer" | "augmenter" | "strategy";

/** Orchestrator lifecycle points. */
export type HookPoint =
  | "beforeRetrieve"
  | "afterRetrieve"
  | "beforeCompose"
  | "beforeChat"
  | "afterChat"
  | "beforeWrite"
  | "afterWrite";

export interface GrimoirePermissions {
  /** Allowed network hosts. ["*"] = any; [] = none. */
  network?: string[];
  /** Filesystem scope. */
  filesystem?: "plugin-data-only" | "read-app-data" | false;
  /** Can the plugin call api.llm.chat()? */
  llm?: boolean;
  /** Memory access. */
  memory?: false | "read" | "write";
}

export interface GrimoireManifest {
  id: GrimoireId;
  name: string;
  version: string;
  /** Semver range targeting the SDK version. */
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
  settingsSchema?: string;
  entry?: string;
}

/** Named UI slots a plugin can mount React components into. */
export type GrimoireSlotName =
  | "settings:section"
  | "inspector:tab"
  | "chat:input:toolbar";

export interface SlotPropMap {
  "settings:section": { pluginId: GrimoireId };
  "inspector:tab": {
    pluginId: GrimoireId;
    characterId: string | null;
  };
  "chat:input:toolbar": {
    pluginId: GrimoireId;
    draft: string;
  };
}

// ─── Hook context types ─────────────────────────────────────────────

export interface ChatTurnShape {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  speaker: string;
  content: string;
  created_at: string;
  session_id?: string;
  in_reply_to?: string;
}

export interface RecallResultShape {
  rid: string;
  text: string;
  type: string;
  score: number;
  importance: number;
  certainty?: number;
  namespace?: string;
  metadata?: Record<string, unknown>;
  why_retrieved?: string[];
}

export interface CharacterShape {
  id: string;
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  world_id?: string;
  world_ids?: string[];
}

export interface BeforeRetrieveContext {
  sessionId: string;
  character: CharacterShape;
  userMessage?: ChatTurnShape;
}

export interface AfterRetrieveContext {
  sessionId: string;
  character: CharacterShape;
  results: {
    canon: RecallResultShape[];
    scene: RecallResultShape[];
    heuristic: RecallResultShape[];
  };
}

export interface BeforeComposeContext {
  sessionId: string;
  character: CharacterShape;
}

export interface BeforeChatContext {
  sessionId: string;
  character: CharacterShape;
  systemPrompt: string;
  messages: { role: string; content: string }[];
}

export interface AfterChatContext {
  sessionId: string;
  character: CharacterShape;
  reply: { content: string };
  /** Mutable — augmenter hooks set this to rewrite the assistant reply. */
  mutatedContent?: string;
}

export interface BeforeWriteContext {
  sessionId: string;
  character: CharacterShape;
  userTurn?: ChatTurnShape;
  assistantTurn: ChatTurnShape;
}

export interface AfterWriteContext {
  sessionId: string;
  character: CharacterShape;
  userTurn?: ChatTurnShape;
  assistantTurn: ChatTurnShape;
  turnCount: number;
}

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

// ─── Slash commands ─────────────────────────────────────────────────

export interface SlashCommandDef {
  name: string;
  description: string;
  run: (args: string, api: GrimoireApi) => Promise<SlashResult | void> | SlashResult | void;
}

export type SlashResult =
  | { kind: "text"; content: string }
  | { kind: "system"; content: string }
  | { kind: "error"; content: string };

// ─── API object passed to hook + command handlers ───────────────────

export interface GrimoireApi {
  readonly plugin: { id: GrimoireId; manifest: GrimoireManifest };
  readonly logger: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  readonly storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  readonly settings: {
    get(): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  };
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly llm: {
    chat(req: {
      model?: string;
      system?: string;
      messages: { role: string; content: string }[];
      temperature?: number;
      max_tokens?: number;
    }): Promise<{ content: string }>;
  };
  readonly memory: {
    recall(query: {
      query: string;
      namespace?: string;
      top_k?: number;
    }): Promise<RecallResultShape[]>;
    write(req: {
      text: string;
      namespace?: string;
      tier?: "reflex" | "heuristic" | "canon";
      importance?: number;
    }): Promise<string>;
  };
  readonly commands: {
    list(): SlashCommandDef[];
    trigger(name: string, args?: string): Promise<SlashResult | void>;
  };
}

// ─── Plugin definition ─────────────────────────────────────────────

export interface GrimoireDefinition {
  id: GrimoireId;
  settingsSchema?: object;
  defaultSettings?: Record<string, unknown>;
  setup(ctx: GrimoireSetupContext): GrimoireRuntime | Promise<GrimoireRuntime>;
}

export interface GrimoireSetupContext {
  readonly manifest: GrimoireManifest;
  readonly logger: GrimoireApi["logger"];
  readonly hooks: {
    beforeRetrieve: HookRegistrationApi<"beforeRetrieve">;
    afterRetrieve: HookRegistrationApi<"afterRetrieve">;
    beforeCompose: HookRegistrationApi<"beforeCompose">;
    beforeChat: HookRegistrationApi<"beforeChat">;
    afterChat: HookRegistrationApi<"afterChat">;
    beforeWrite: HookRegistrationApi<"beforeWrite">;
    afterWrite: HookRegistrationApi<"afterWrite">;
  };
  readonly commands: {
    register(def: SlashCommandDef): void;
  };
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
  strategy(handler: HookHandler<P>): void;
}

export interface GrimoireRuntime {
  dispose?: () => void | Promise<void>;
}

/** Factory used by plugin authors. Identity at runtime — just a typed
 *  pass-through that lets editors infer the GrimoireDefinition shape
 *  for the setup() callback. */
export function defineGrimoire(def: GrimoireDefinition): GrimoireDefinition {
  return def;
}

/** Current SDK version. Plugin manifests' apiVersion must satisfy this
 *  via semver — the chronicler host refuses incompatible plugins. */
export const GRIMOIRE_SDK_VERSION = "0.1.0";
