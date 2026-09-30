// "Load models" for a provider: asks the server what it has and lets you click one.
// Works for Ollama, OpenAI-compatible servers (vLLM, llama.cpp incl. Vulkan builds, LM Studio,
// Ollama's /v1, OpenRouter…), Anthropic and Gemini — see lib/providers/list-models.ts.

import { useState } from "react";
import type { ProviderConfigEntry } from "../../lib/config";
import { listModels, type ListKind, type ModelList } from "../../lib/providers/list-models";

const DEFAULT_BASE: Record<ListKind, string> = {
  ollama: "http://host.docker.internal:11434",
  "openai-compat": "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

export function ProviderModelPicker({
  provider,
  onPick,
}: {
  provider: ProviderConfigEntry;
  onPick: (model: string) => void;
}) {
  const [state, setState] = useState<ModelList | "loading" | null>(null);
  if (provider.kind === "mock") return null;
  const kind = provider.kind as ListKind;

  async function load() {
    setState("loading");
    setState(await listModels(kind, provider.base_url ?? DEFAULT_BASE[kind], provider.api_key ?? ""));
  }
  const missing = state && state !== "loading" && state.ok && provider.model.trim() !== "" && !state.models.some((m) => m.id === provider.model.trim());

  return (
    <div className="pt-0.5">
      <button
        type="button"
        onClick={() => void load()}
        disabled={state === "loading"}
        className="text-[11px] rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-emerald-500/60 disabled:opacity-50"
      >
        {state === "loading" ? "loading…" : "load models from this server"}
      </button>
      {state && state !== "loading" && !state.ok && (
        <p className="mt-1 text-[11px] leading-relaxed text-amber-300" role="status">
          ⚠ {state.reason}
        </p>
      )}
      {state && state !== "loading" && state.ok && (
        <div className="mt-1.5" role="status">
          {state.models.length === 0 ? (
            <p className="text-[11px] text-amber-300">Connected, but the server lists no models.</p>
          ) : (
            <>
              <p className={`text-[11px] ${missing ? "text-amber-300" : "text-emerald-300"}`}>
                {missing
                  ? `⚠ “${provider.model}” isn't on this server. Pick one of its ${state.models.length} models:`
                  : `✓ ${state.models.length} model${state.models.length === 1 ? "" : "s"} available — click one to use it:`}
              </p>
              <div className="mt-1 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {state.models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onPick(m.id)}
                    title={m.note ? `${m.id} · ${m.note}` : m.id}
                    className={`rounded border px-2 py-0.5 text-[11px] ${
                      m.id === provider.model ? "border-emerald-500 text-emerald-200" : "border-neutral-700 text-neutral-200 hover:border-emerald-500/60"
                    }`}
                  >
                    {m.id}
                    {m.note ? <span className="ml-1 text-neutral-500">{m.note}</span> : null}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
