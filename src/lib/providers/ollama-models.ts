// Ask an Ollama server which models it has, through the same-origin proxy.
//
// Used by the first-run wizard: the most common reason a brand-new install
// "never replies" is that the default model isn't installed on the user's
// Ollama, or that Ollama isn't reachable from where Chronicler runs (Docker).
// Checking at setup time turns both into a visible message before the first
// message is sent.

import { extractErrorDetail, friendlyProviderError } from "./errors";
import { proxyFetch } from "./index";

export type OllamaProbe = { ok: true; models: string[] } | { ok: false; reason: string };

/** The Ollama host root, whether the user typed ".../", ".../v1" or the bare host. */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

/** List installed models. Never throws; failure is reported as a readable reason. */
export async function probeOllama(baseUrl: string, signal?: AbortSignal): Promise<OllamaProbe> {
  const root = ollamaRoot(baseUrl);
  if (!/^https?:\/\/\S+$/i.test(root)) return { ok: false, reason: "Enter the address of your Ollama server, e.g. http://host.docker.internal:11434" };
  try {
    const res = await proxyFetch({ target_url: `${root}/api/tags`, method: "GET", signal });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, reason: friendlyProviderError({ label: "Ollama", status: res.status, detail: extractErrorDetail(text), baseUrl: root }) };
    }
    const data = JSON.parse(text) as { models?: Array<{ name?: unknown }> };
    const models = (data.models ?? []).map((m) => (typeof m.name === "string" ? m.name : "")).filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { ok: false, reason: "cancelled" };
    return { ok: false, reason: `Couldn't check Ollama at ${root}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Models that are not for chat (embeddings, image generators, rerankers, speech). */
const NOT_CHAT = /embed|image|clip|rerank|whisper|bge|minilm|vision-only|stable-?diffusion|flux/i;

/** The installed models worth offering for chat. */
export function chatModels(installed: string[]): string[] {
  return installed.filter((m) => !NOT_CHAT.test(m));
}

/** Parameter count in billions from a tag like "qwen3.5:4b" or "llama3:70b-instruct", if present. */
export function paramBillions(model: string): number | null {
  const m = model.toLowerCase().match(/(?:^|[:\-_])(\d+(?:\.\d+)?)b(?:$|[-_:])/);
  return m ? Number(m[1]) : null;
}

/** A sensible chat model from what is installed: not an embedding or image model, and the
 *  SMALLEST one of at least 3B (big models are slow on most machines; under ~3B they roleplay
 *  poorly). Null when nothing clearly qualifies — better to ask than to guess. */
export function suggestChatModel(installed: string[]): string | null {
  const sized = installed
    .filter((m) => !NOT_CHAT.test(m))
    .map((m) => ({ m, b: paramBillions(m) }))
    .filter((x): x is { m: string; b: number } => x.b !== null && x.b >= 3);
  if (sized.length === 0) return null;
  sized.sort((x, y) => x.b - y.b);
  return sized[0].m;
}

/** Keep what the person typed; only replace the untouched factory default, and only when it is
 *  missing and there is a clearly sensible alternative. Otherwise the wizard lists what is
 *  installed and lets the person choose. */
export function pickModel(current: string, factoryDefault: string, installed: string[], touched: boolean): string {
  if (touched || current !== factoryDefault) return current;
  if (installed.includes(current) || installed.length === 0) return current;
  return suggestChatModel(installed) ?? current;
}

/** Whether a model name counts as installed ("qwen3:4b" matches "qwen3:4b" and, for a bare
 *  name with no tag, "name:latest"). */
export function isInstalled(model: string, installed: string[]): boolean {
  const m = model.trim();
  if (!m) return false;
  return installed.includes(m) || (!m.includes(":") && installed.includes(`${m}:latest`));
}
