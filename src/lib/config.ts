// Runtime config. Read from localStorage for dev; later read from Tauri
// secure store.

import type { McpTransportKind } from "./yantrikdb/mcp-transport";

export interface YantrikConfig {
  kind: "memory" | "mcp";
  mcp?: { kind: McpTransportKind; url: string; authToken?: string };
}

export interface ProviderConfigEntry {
  id: string;
  kind: "openai-compat" | "anthropic" | "ollama" | "gemini" | "mock";
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
  /** Max tokens the model is allowed to generate per reply. Unset
   *  falls back to DEFAULT_MAX_RESPONSE_TOKENS. The previous hardcoded
   *  420 cut long-form prose mid-sentence; the default is now 1024,
   *  enough for ~750 words. Users running tiny local models (or who
   *  prefer terse replies) can lower it per-provider in Settings. */
  max_response_tokens?: number;
}

/** Default cap on a single LLM reply. ~750 words. */
export const DEFAULT_MAX_RESPONSE_TOKENS = 1024;

export interface UserPersona {
  /** Stable id used by SessionMeta.persona_id + ChroniclerConfig.active_persona_id.
   *  Legacy single-persona configs get migrated with id="default". */
  id: string;
  name: string;
  description?: string;
}

export interface ChroniclerConfig {
  yantrikdb: YantrikConfig;
  active_provider_id?: string;
  extraction_provider_id?: string;
  providers: ProviderConfigEntry[];
  /** @deprecated Single persona kept for migration. Read user_personas instead;
   *  loadConfig() migrates legacy data so this field is empty in new installs. */
  user_persona?: UserPersona;
  /** Multi-persona library. Users swap between personas per session (e.g.
   *  detective Volkov for noir, Aeron for fantasy). The active one is
   *  injected as <user> in the anti-confab system prompt. */
  user_personas?: UserPersona[];
  /** App-level default persona id for newly-created sessions. Sessions
   *  remember their own choice via SessionMeta.persona_id. */
  active_persona_id?: string;
  auto_promotion_policy?: {
    min_reinforcements: number;
    min_unique_sessions: number;
    max_days_span: number;
  };
  /** Proactive messaging: the character takes initiative when accumulated
   *  urges cross a threshold. off = never. passive = only when user has
   *  been idle N seconds AND a trigger exists. aggressive = any time a
   *  trigger arrives at high pressure. */
  proactive_mode?: "off" | "passive" | "aggressive";
  /** Idle threshold in seconds for passive mode. */
  proactive_idle_seconds?: number;
  /** Default sampling preset id for newly-created sessions. Sessions remember
   *  their own preset once set. Default: "slow_burn". */
  default_preset_id?: string;
  /** Default scene intensity for newly-created sessions. Default:
   *  "neutral" (no prompt injection). Sessions remember their own
   *  choice via SessionMeta.intensity_id. */
  default_intensity_id?: string;
}

const STORAGE_KEY = "chronicler.config.v1";

export function loadConfig(): ChroniclerConfig {
  if (typeof localStorage === "undefined") return defaultConfig();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultConfig();
  try {
    const parsed = JSON.parse(raw) as ChroniclerConfig;
    return migratePersonas({ ...defaultConfig(), ...parsed });
  } catch {
    return defaultConfig();
  }
}

/** One-shot migration: pre-multi-persona configs only had `user_persona`.
 *  Promote that single record into the personas[] list with id="default"
 *  so the rest of the codebase only has to handle the multi-shape. */
function migratePersonas(cfg: ChroniclerConfig): ChroniclerConfig {
  if (cfg.user_personas && cfg.user_personas.length > 0) return cfg;
  const seed: UserPersona =
    cfg.user_persona && cfg.user_persona.name && cfg.user_persona.name !== "You"
      ? {
          id: cfg.user_persona.id ?? "default",
          name: cfg.user_persona.name,
          description: cfg.user_persona.description,
        }
      : { id: "default", name: "You" };
  return {
    ...cfg,
    user_personas: [seed],
    active_persona_id: cfg.active_persona_id ?? seed.id,
  };
}

/** Returns the active persona for the given config, resolving the
 *  app-level default or falling back to the first persona or a default
 *  "You". Safe to call before migration runs. */
export function activePersona(cfg: ChroniclerConfig): UserPersona {
  const list = cfg.user_personas ?? [];
  if (cfg.active_persona_id) {
    const found = list.find((p) => p.id === cfg.active_persona_id);
    if (found) return found;
  }
  if (list.length > 0) return list[0];
  if (cfg.user_persona)
    return {
      id: cfg.user_persona.id ?? "default",
      name: cfg.user_persona.name,
      description: cfg.user_persona.description,
    };
  return { id: "default", name: "You" };
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
    user_persona: { id: "default", name: "You" },
    user_personas: [{ id: "default", name: "You" }],
    active_persona_id: "default",
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
