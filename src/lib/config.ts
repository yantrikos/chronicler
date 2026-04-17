// Runtime config. Read from localStorage for dev; later read from Tauri
// secure store.

import type { McpTransportKind } from "./yantrikdb/mcp-transport";

export interface YantrikConfig {
  kind: "memory" | "mcp";
  mcp?: { kind: McpTransportKind; url: string; authToken?: string };
}

export interface ProviderConfigEntry {
  id: string;
  kind: "openai-compat" | "anthropic" | "ollama" | "mock";
  label: string;
  base_url?: string;
  api_key: string;
  model: string;
  /** For Qwen3 / thinking-capable models on Ollama: pass `think: false` in
   *  the request body to skip the hidden reasoning phase. */
  disable_thinking?: boolean;
  /** Sampling parameters. Unset values fall back to provider defaults. */
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
}

export interface UserPersona {
  name: string;
  description?: string;
}

export interface ChroniclerConfig {
  yantrikdb: YantrikConfig;
  active_provider_id?: string;
  extraction_provider_id?: string;
  providers: ProviderConfigEntry[];
  user_persona?: UserPersona;
  auto_promotion_policy?: {
    min_reinforcements: number;
    min_unique_sessions: number;
    max_days_span: number;
  };
}

const STORAGE_KEY = "chronicler.config.v1";

export function loadConfig(): ChroniclerConfig {
  if (typeof localStorage === "undefined") return defaultConfig();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultConfig();
  try {
    const parsed = JSON.parse(raw) as ChroniclerConfig;
    return { ...defaultConfig(), ...parsed };
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(cfg: ChroniclerConfig): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function defaultConfig(): ChroniclerConfig {
  return {
    yantrikdb: {
      kind: "mcp",
      mcp: { kind: "streamable-http", url: "/api/mcp" },
    },
    providers: [
      {
        id: "mock",
        kind: "mock",
        label: "Mock (scripted)",
        api_key: "",
        model: "mock",
      },
    ],
    active_provider_id: "mock",
    user_persona: { name: "You" },
  };
}

export function activeProvider(cfg: ChroniclerConfig): ProviderConfigEntry | undefined {
  return cfg.providers.find((p) => p.id === cfg.active_provider_id) ?? cfg.providers[0];
}

export function extractionProvider(
  cfg: ChroniclerConfig
): ProviderConfigEntry | undefined {
  if (cfg.extraction_provider_id) {
    const p = cfg.providers.find((p) => p.id === cfg.extraction_provider_id);
    if (p) return p;
  }
  return activeProvider(cfg);
}
