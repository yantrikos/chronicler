// List the models a provider offers, through the same-origin proxy (so no CORS, and keys stay on the host).
//
//   Ollama                        GET {host}/api/tags                  -> { models: [{ name }] }
//   OpenAI-compatible             GET {base}/models                    -> { data: [{ id }] }
//        (vLLM, llama.cpp server incl. Vulkan builds, LM Studio, Ollama's /v1, OpenRouter, OpenAI…)
//   Anthropic                     GET {base}/v1/models                 -> { data: [{ id }] }
//   Gemini                        GET {base}/models?key=…              -> { models: [{ name: "models/…" }] }
//
// Only Ollama's shape was exercised against a live server here; the others follow those projects'
// documented formats and are covered by stubbed-response tests.

import { extractErrorDetail, friendlyProviderError } from "./errors";
import { proxyFetch } from "./index";
import { chatModels, ollamaRoot } from "./ollama-models";

export type ListKind = "ollama" | "openai-compat" | "anthropic" | "gemini";

export interface ModelEntry {
  id: string;
  /** Extra detail worth showing next to the name (size, etc.), if the backend gave any. */
  note?: string;
}

export type ModelList = { ok: true; models: ModelEntry[] } | { ok: false; reason: string };

function gb(n: unknown): string | undefined {
  return typeof n === "number" && n > 0 ? `${(n / 1e9).toFixed(1)} GB` : undefined;
}

/** Parse a models response for a backend. Pure, so it can be tested without a server. */
export function parseModelList(kind: ListKind, data: unknown): ModelEntry[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  let out: ModelEntry[] = [];
  if (kind === "ollama") {
    out = arr(d.models).map((m) => ({ id: String(m.name ?? ""), note: gb(m.size) }));
    const ids = new Set(chatModels(out.map((m) => m.id)));
    out = out.filter((m) => ids.has(m.id)); // drop embedding / image models
  } else if (kind === "gemini") {
    out = arr(d.models)
      .filter((m) => !Array.isArray(m.supportedGenerationMethods) || (m.supportedGenerationMethods as unknown[]).includes("generateContent"))
      .map((m) => ({ id: String(m.name ?? "").replace(/^models\//, "") }));
  } else {
    out = arr(d.data).map((m) => ({ id: String(m.id ?? "") }));
  }
  const seen = new Set<string>();
  return out.filter((m) => m.id && !seen.has(m.id) && !!seen.add(m.id)).sort((a, b) => a.id.localeCompare(b.id));
}

/** The URL and headers to ask a backend for its models. */
export function modelListRequest(kind: ListKind, baseUrl: string, apiKey: string): { url: string; headers: Record<string, string> } | null {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (kind === "ollama") return /^https?:\/\//i.test(base) ? { url: `${ollamaRoot(base)}/api/tags`, headers: {} } : null;
  if (kind === "anthropic") {
    const root = base || "https://api.anthropic.com";
    return { url: `${root}/v1/models`, headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } };
  }
  if (kind === "gemini") {
    const root = base || "https://generativelanguage.googleapis.com/v1beta";
    return { url: `${root}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`, headers: {} };
  }
  if (!/^https?:\/\//i.test(base)) return null;
  return { url: `${base}/models`, headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} };
}

/** Ask the backend what it has. Never throws; failure is a readable reason. */
export async function listModels(kind: ListKind, baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ModelList> {
  const req = modelListRequest(kind, baseUrl, apiKey);
  if (!req) return { ok: false, reason: "Enter the server's address first (for example http://host.docker.internal:11434 or http://localhost:8000/v1)." };
  const label = kind === "ollama" ? "Ollama" : kind === "openai-compat" ? "That server" : kind === "anthropic" ? "Anthropic" : "Gemini";
  try {
    const res = await proxyFetch({ target_url: req.url, method: "GET", headers: req.headers, signal });
    const text = await res.text();
    if (!res.ok) return { ok: false, reason: friendlyProviderError({ label, status: res.status, detail: extractErrorDetail(text), baseUrl: baseUrl.trim() }) };
    const models = parseModelList(kind, JSON.parse(text));
    return { ok: true, models };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { ok: false, reason: "cancelled" };
    return { ok: false, reason: `Couldn't read the model list from ${baseUrl.trim() || label}: ${e instanceof Error ? e.message : String(e)}` };
  }
}
