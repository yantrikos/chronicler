// Provider templates — pre-filled configs for common LLM hosts.
//
// Most of the "missing" providers in the wider LLM ecosystem speak the
// OpenAI chat-completions wire format, so the only thing that varies is
// the base URL + label + suggested model. Templates collapse the "add a
// provider" flow from "look up the URL on the web" to "pick from a list".
//
// To add a new template: just append an entry below. To support a
// genuinely new wire protocol (e.g. Gemini), add a dedicated adapter
// class to providers/index.ts instead.

import type { ProviderConfigEntry } from "../config";

export interface ProviderTemplate {
  /** Short id used as the `key` and a hint when generating instance ids. */
  key: string;
  /** Human label shown in the picker. */
  label: string;
  /** One-line hint shown under the label in the picker — what this is for. */
  hint: string;
  /** Returns a fresh ProviderConfigEntry. Caller fills in api_key + tweaks
   *  model name. Each call should produce a unique id. */
  build: () => ProviderConfigEntry;
}

let templateInstanceCounter = 1;
function nextId(prefix: string): string {
  // Stable-ish unique id without Date.now (kept off the hot path so it
  // doesn't matter, but worth keeping deterministic-friendly).
  templateInstanceCounter += 1;
  return `${prefix}-${templateInstanceCounter}`;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    key: "ollama",
    label: "Ollama (local)",
    hint: "Run open models on this machine. No API key. Default port 11434.",
    build: () => ({
      id: nextId("ollama"),
      kind: "ollama",
      label: "Ollama (local)",
      base_url: "http://host.docker.internal:11434",
      api_key: "",
      model: "qwen3:4b",
      disable_thinking: true,
    }),
  },
  {
    key: "openai",
    label: "OpenAI",
    hint: "Official OpenAI API. GPT-4o / GPT-4.1 / GPT-5 lines.",
    build: () => ({
      id: nextId("openai"),
      kind: "openai-compat",
      label: "OpenAI",
      base_url: "https://api.openai.com/v1",
      api_key: "",
      model: "gpt-4o-mini",
    }),
  },
  {
    key: "anthropic",
    label: "Anthropic",
    hint: "Native Claude API. Sonnet / Opus lines.",
    build: () => ({
      id: nextId("anthropic"),
      kind: "anthropic",
      label: "Anthropic",
      api_key: "",
      model: "claude-sonnet-4-6",
    }),
  },
  {
    key: "gemini",
    label: "Google Gemini",
    hint: "Native Gemini API (different wire format from OpenAI).",
    build: () => ({
      id: nextId("gemini"),
      kind: "gemini",
      label: "Google Gemini",
      base_url: "https://generativelanguage.googleapis.com/v1beta",
      api_key: "",
      model: "gemini-2.5-pro",
    }),
  },
  {
    key: "mistral",
    label: "Mistral",
    hint: "Official Mistral API (OpenAI-compatible).",
    build: () => ({
      id: nextId("mistral"),
      kind: "openai-compat",
      label: "Mistral",
      base_url: "https://api.mistral.ai/v1",
      api_key: "",
      model: "mistral-large-latest",
    }),
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    hint: "Routes to many providers under one API key (OpenAI-compatible).",
    build: () => ({
      id: nextId("openrouter"),
      kind: "openai-compat",
      label: "OpenRouter",
      base_url: "https://openrouter.ai/api/v1",
      api_key: "",
      model: "anthropic/claude-sonnet-4-6",
    }),
  },
  {
    key: "together",
    label: "Together AI",
    hint: "Hosted open models (OpenAI-compatible).",
    build: () => ({
      id: nextId("together"),
      kind: "openai-compat",
      label: "Together AI",
      base_url: "https://api.together.xyz/v1",
      api_key: "",
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    }),
  },
  {
    key: "groq",
    label: "Groq",
    hint: "Very fast inference on open models (OpenAI-compatible).",
    build: () => ({
      id: nextId("groq"),
      kind: "openai-compat",
      label: "Groq",
      base_url: "https://api.groq.com/openai/v1",
      api_key: "",
      model: "llama-3.3-70b-versatile",
    }),
  },
  {
    key: "koboldcpp",
    label: "KoboldCpp / KoboldAI",
    hint: "Local Kobold endpoint (OpenAI-compatible at /v1).",
    build: () => ({
      id: nextId("kobold"),
      kind: "openai-compat",
      label: "KoboldCpp",
      base_url: "http://localhost:5001/v1",
      api_key: "",
      model: "default",
    }),
  },
  {
    key: "llamacpp",
    label: "llama.cpp server",
    hint: "Local llama.cpp HTTP server (OpenAI-compatible at /v1).",
    build: () => ({
      id: nextId("llamacpp"),
      kind: "openai-compat",
      label: "llama.cpp",
      base_url: "http://localhost:8080/v1",
      api_key: "",
      model: "default",
    }),
  },
  {
    key: "vllm",
    label: "vLLM",
    hint: "Self-hosted vLLM server (OpenAI-compatible).",
    build: () => ({
      id: nextId("vllm"),
      kind: "openai-compat",
      label: "vLLM",
      base_url: "http://localhost:8000/v1",
      api_key: "",
      model: "default",
    }),
  },
  {
    key: "openai-compat",
    label: "Other (OpenAI-compatible)",
    hint: "Any endpoint speaking the OpenAI chat-completions wire format.",
    build: () => ({
      id: nextId("oai"),
      kind: "openai-compat",
      label: "Custom OpenAI-compatible",
      base_url: "",
      api_key: "",
      model: "",
    }),
  },
];

export function getProviderTemplate(key: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((t) => t.key === key);
}
