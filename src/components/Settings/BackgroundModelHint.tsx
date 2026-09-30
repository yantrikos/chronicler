// Shown when the chat model is big and also does the background work.
//
// After every reply Chronicler runs background calls — fact extraction, the scene board, the ledger,
// the story summary — on the same model unless another is assigned. On a big model that is most of a
// minute of work per turn (measured: qwen3.8 27B at ~5 tok/s). The user's next message now goes first
// (see lib/providers/gate.ts), but the background work still takes that long; a small fast model for it
// is the real fix. One click adds one and assigns it.

import { useEffect, useState } from "react";
import type { ChroniclerConfig, ProviderConfigEntry } from "../../lib/config";
import { listModels, type ListKind } from "../../lib/providers/list-models";
import { paramBillions, suggestChatModel } from "../../lib/providers/ollama-models";

const BIG_B = 12;

/** The active provider when it is a big model that is also doing the background work; otherwise null.
 *  `reportedB` is the size the server itself reports (needed for ":latest" tags, which say nothing). */
export function bigSharedModel(cfg: ChroniclerConfig, reportedB?: number): ProviderConfigEntry | null {
  const active = cfg.providers.find((p) => p.id === cfg.active_provider_id) ?? cfg.providers[0];
  if (!active || active.kind === "mock") return null;
  const b = paramBillions(active.model) ?? reportedB ?? null;
  if (b === null || b < BIG_B) return null;
  const bg = cfg.extraction_provider_id ? cfg.providers.find((p) => p.id === cfg.extraction_provider_id) : undefined;
  return bg && bg.id !== active.id && bg.kind !== "mock" ? null : active; // a separate background model is already set
}

export function BackgroundModelHint({
  value,
  onChange,
}: {
  value: ChroniclerConfig;
  onChange: (cfg: ChroniclerConfig) => void;
}) {
  const [state, setState] = useState<"idle" | "working" | { error: string }>("idle");
  const [reportedB, setReportedB] = useState<number | undefined>(undefined);
  const current = value.providers.find((p) => p.id === value.active_provider_id) ?? value.providers[0];
  // Ollama reports each model's real parameter count, which a ":latest" name does not reveal.
  useEffect(() => {
    setReportedB(undefined);
    if (!current || current.kind !== "ollama" || paramBillions(current.model) !== null) return;
    let cancelled = false;
    void listModels("ollama", current.base_url ?? "http://host.docker.internal:11434", "").then((r) => {
      if (!cancelled && r.ok) setReportedB(r.models.find((m) => m.id === current.model)?.billions);
    });
    return () => {
      cancelled = true;
    };
  }, [current?.id, current?.model, current?.base_url, current?.kind]);
  const active = bigSharedModel(value, reportedB);
  if (!active) return null;
  const big = paramBillions(active.model) ?? reportedB;

  async function add(p: ProviderConfigEntry) {
    setState("working");
    const base = p.base_url ?? (p.kind === "ollama" ? "http://host.docker.internal:11434" : "");
    const list = await listModels(p.kind as ListKind, base, p.api_key ?? "");
    if (!list.ok) return setState({ error: list.reason });
    const sizes: Record<string, number> = {};
    for (const m of list.models) if (m.billions !== undefined) sizes[m.id] = m.billions;
    const pick = suggestChatModel(list.models.map((m) => m.id).filter((id) => id !== p.model), sizes);
    if (!pick) return setState({ error: "That server has no small chat model to use. Pull one first, for example:  ollama pull qwen3.5:4b" });
    const entry: ProviderConfigEntry = {
      ...p,
      id: `bg-${Date.now().toString(36)}`,
      label: `${p.label} (background)`,
      model: pick,
      disable_thinking: true,
    };
    onChange({ ...value, providers: [...value.providers, entry], extraction_provider_id: entry.id });
    setState("idle");
  }

  return (
    <div className="rounded-md border border-amber-700/60 bg-amber-900/20 p-3 text-[11px] leading-relaxed text-amber-100" role="status">
      <strong className="font-semibold">“{active.model}” is a large model ({big}B) and it does the background work too.</strong> After every
      reply Chronicler also runs memory extraction, the scene board, the ledger and the story summary on it, which can add most of a minute per
      turn on a big model. Your next message goes first, but that work still takes that long. A small fast model handles it far better.
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void add(active)}
          disabled={state === "working"}
          className="rounded border border-amber-500/60 px-2.5 py-1 font-medium text-amber-50 hover:bg-amber-800/50 disabled:opacity-50"
        >
          {state === "working" ? "looking…" : "use a small model for background tasks"}
        </button>
        <span className="text-amber-200/70">Needs enough memory to keep both models loaded; if Ollama has to swap them, each swap costs a few seconds.</span>
      </div>
      {typeof state === "object" && <p className="mt-1.5 text-amber-300">⚠ {state.error}</p>}
    </div>
  );
}
