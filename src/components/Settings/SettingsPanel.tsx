import { useState } from "react";
import {
  type ChroniclerConfig,
  type ProviderConfigEntry,
  saveConfig,
} from "../../lib/config";

interface Props {
  config: ChroniclerConfig;
  onClose: () => void;
  onSave: (cfg: ChroniclerConfig) => void;
  onExportBackup?: () => void;
  onImportBackup?: (file: File) => void | Promise<void>;
}

export function SettingsPanel({
  config,
  onClose,
  onSave,
  onExportBackup,
  onImportBackup,
}: Props) {
  const [draft, setDraft] = useState<ChroniclerConfig>(config);

  function commit() {
    saveConfig(draft);
    onSave(draft);
    onClose();
  }

  function updateYantrik(next: ChroniclerConfig["yantrikdb"]) {
    setDraft({ ...draft, yantrikdb: next });
  }

  function updateProvider(id: string, patch: Partial<ProviderConfigEntry>) {
    setDraft({
      ...draft,
      providers: draft.providers.map((p) =>
        p.id === id ? { ...p, ...patch } : p
      ),
    });
  }

  function addProvider(kind: ProviderConfigEntry["kind"]) {
    const id = `${kind}-${Math.random().toString(36).slice(2, 6)}`;
    const entry: ProviderConfigEntry =
      kind === "anthropic"
        ? {
            id,
            kind,
            label: "Anthropic",
            api_key: "",
            model: "claude-opus-4-7",
          }
        : kind === "ollama"
        ? {
            id,
            kind,
            label: "Ollama (local)",
            api_key: "",
            base_url: "http://host.docker.internal:11434",
            model: "qwen3.5:4b",
            disable_thinking: true,
          }
        : kind === "openai-compat"
        ? {
            id,
            kind,
            label: "OpenAI",
            api_key: "",
            base_url: "https://api.openai.com/v1",
            model: "gpt-5.4",
          }
        : { id, kind, label: "Mock", api_key: "", model: "mock" };
    setDraft({
      ...draft,
      providers: [...draft.providers, entry],
      active_provider_id: entry.id,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg w-[640px] max-h-[85vh] overflow-y-auto shadow-2xl">
        <header className="px-5 py-3 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-100 text-sm">
            close
          </button>
        </header>

        <section className="p-5 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-neutral-200 mb-2">Your persona</h3>
            <div className="border border-neutral-800 rounded-md p-3 bg-neutral-950 space-y-2">
              <LabeledInput
                label="your name"
                value={draft.user_persona?.name ?? ""}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    user_persona: {
                      ...(draft.user_persona ?? { name: "You" }),
                      name: v || "You",
                    },
                  })
                }
                placeholder="You"
              />
              <label className="block">
                <span className="text-[11px] text-neutral-500 uppercase tracking-wider">
                  description (optional)
                </span>
                <textarea
                  value={draft.user_persona?.description ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      user_persona: {
                        ...(draft.user_persona ?? { name: "You" }),
                        description: e.currentTarget.value,
                      },
                    })
                  }
                  rows={2}
                  placeholder="A traveler visiting the coastal town for the week…"
                  className="mt-0.5 w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm text-neutral-100 resize-y focus:outline-none focus:border-neutral-600"
                />
              </label>
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                Injected into the system prompt so the character knows who they're talking to.
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-neutral-200 mb-2">Proactive messages</h3>
            <div className="border border-neutral-800 rounded-md p-3 bg-neutral-950 space-y-2">
              <LabeledSelect
                label="character takes initiative"
                value={draft.proactive_mode ?? "off"}
                options={[
                  { value: "off", label: "off — only reply to user" },
                  { value: "passive", label: "passive — after idle + strong urge" },
                  { value: "aggressive", label: "aggressive — any pending urge" },
                ]}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    proactive_mode: v as "off" | "passive" | "aggressive",
                  })
                }
              />
              {draft.proactive_mode === "passive" && (
                <LabeledInput
                  label="idle threshold (seconds)"
                  type="number"
                  value={String(draft.proactive_idle_seconds ?? 180)}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      proactive_idle_seconds: Number(v) || 180,
                    })
                  }
                />
              )}
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                The character acts on accumulated urges (YantrikDB triggers). Off by default — try passive first.
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-neutral-200 mb-2">Memory backend</h3>
            <div className="grid grid-cols-2 gap-2">
              <RadioCard
                active={draft.yantrikdb.kind === "memory"}
                title="In-memory"
                subtitle="ephemeral, for testing"
                onClick={() => updateYantrik({ kind: "memory" })}
              />
              <RadioCard
                active={draft.yantrikdb.kind === "mcp"}
                title="YantrikDB (MCP)"
                subtitle="persistent, semantic recall"
                onClick={() =>
                  updateYantrik({
                    kind: "mcp",
                    mcp: draft.yantrikdb.mcp ?? {
                      kind: "streamable-http",
                      url: "/api/mcp",
                    },
                  })
                }
              />
            </div>
            {draft.yantrikdb.kind === "mcp" && (
              <div className="mt-3 space-y-2 border border-neutral-800 rounded-md p-3 bg-neutral-950">
                <LabeledSelect
                  label="transport"
                  value={draft.yantrikdb.mcp?.kind ?? "streamable-http"}
                  options={[
                    { value: "streamable-http", label: "streamable-http" },
                    { value: "sse", label: "sse" },
                  ]}
                  onChange={(v) =>
                    updateYantrik({
                      kind: "mcp",
                      mcp: {
                        ...(draft.yantrikdb.mcp ?? { kind: "sse", url: "" }),
                        kind: v as "sse" | "streamable-http",
                      },
                    })
                  }
                />
                <LabeledInput
                  label="url"
                  value={draft.yantrikdb.mcp?.url ?? ""}
                  onChange={(v) =>
                    updateYantrik({
                      kind: "mcp",
                      mcp: {
                        ...(draft.yantrikdb.mcp ?? { kind: "sse", url: "" }),
                        url: v,
                      },
                    })
                  }
                  placeholder="/api/mcp"
                />
                <LabeledInput
                  label="bearer token"
                  value={draft.yantrikdb.mcp?.authToken ?? ""}
                  onChange={(v) =>
                    updateYantrik({
                      kind: "mcp",
                      mcp: {
                        ...(draft.yantrikdb.mcp ?? { kind: "sse", url: "" }),
                        authToken: v,
                      },
                    })
                  }
                  type="password"
                />
                <p className="text-[11px] text-neutral-500 leading-relaxed">
                  Default is <code className="text-neutral-300">/api/mcp</code> — the Node server proxies to the YantrikDB service defined in <code className="text-neutral-300">docker-compose.yml</code>. Override only if you run YantrikDB elsewhere.
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-neutral-200">LLM providers</h3>
              <div className="flex gap-1">
                <MiniBtn onClick={() => addProvider("ollama")}>+ Ollama</MiniBtn>
                <MiniBtn onClick={() => addProvider("openai-compat")}>+ OpenAI-compat</MiniBtn>
                <MiniBtn onClick={() => addProvider("anthropic")}>+ Anthropic</MiniBtn>
              </div>
            </div>
            {draft.providers.filter((p) => p.kind !== "mock").length > 0 && (
              <div className="mb-3 border border-neutral-800 rounded-md p-3 bg-neutral-950">
                <LabeledSelect
                  label="extraction provider (optional)"
                  value={draft.extraction_provider_id ?? ""}
                  options={[
                    { value: "", label: "(use active provider)" },
                    ...draft.providers.map((p) => ({ value: p.id, label: p.label })),
                  ]}
                  onChange={(v) =>
                    setDraft({
                      ...draft,
                      extraction_provider_id: v || undefined,
                    })
                  }
                />
                <p className="text-[11px] text-neutral-500 leading-relaxed mt-1.5">
                  The fact extractor runs after each reply and classifies turns into reflex/heuristic/canon. A small/fast model here (qwen2.5:1.5b, gemma3:270m) shaves seconds off per-turn latency.
                </p>
              </div>
            )}
            <div className="space-y-2">
              {draft.providers.map((p) => (
                <div
                  key={p.id}
                  className={`border rounded-md p-3 ${
                    draft.active_provider_id === p.id
                      ? "border-emerald-600 bg-emerald-500/5"
                      : "border-neutral-800 bg-neutral-950"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={draft.active_provider_id === p.id}
                        onChange={() => setDraft({ ...draft, active_provider_id: p.id })}
                      />
                      <input
                        className="bg-transparent text-sm font-medium text-neutral-100 focus:outline-none"
                        value={p.label}
                        onChange={(e) => updateProvider(p.id, { label: e.currentTarget.value })}
                      />
                      <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono">
                        {p.kind}
                      </span>
                    </div>
                    <button
                      onClick={() =>
                        setDraft({
                          ...draft,
                          providers: draft.providers.filter((x) => x.id !== p.id),
                        })
                      }
                      className="text-xs text-neutral-500 hover:text-red-400"
                    >
                      remove
                    </button>
                  </div>
                  {p.kind !== "mock" && (
                    <div className="space-y-1.5">
                      <LabeledInput
                        label="model"
                        value={p.model}
                        onChange={(v) => updateProvider(p.id, { model: v })}
                      />
                      {p.kind === "openai-compat" && (
                        <LabeledInput
                          label="base url"
                          value={p.base_url ?? ""}
                          onChange={(v) => updateProvider(p.id, { base_url: v })}
                        />
                      )}
                      <LabeledInput
                        label="api key"
                        value={p.api_key}
                        onChange={(v) => updateProvider(p.id, { api_key: v })}
                        type="password"
                      />
                      {p.kind === "ollama" && (
                        <label className="flex items-center gap-2 text-[11px] text-neutral-400 pt-1">
                          <input
                            type="checkbox"
                            checked={p.disable_thinking ?? false}
                            onChange={(e) =>
                              updateProvider(p.id, {
                                disable_thinking: e.currentTarget.checked,
                              })
                            }
                          />
                          disable thinking (passes <code className="bg-neutral-900 px-1">think: false</code> — huge speedup on Qwen3)
                        </label>
                      )}
                      <details className="pt-1">
                        <summary className="text-[11px] text-neutral-400 cursor-pointer hover:text-neutral-200">
                          sampling (optional)
                        </summary>
                        <div className="grid grid-cols-2 gap-1.5 mt-2">
                          <NumInput
                            label="temperature"
                            value={p.temperature}
                            onChange={(v) => updateProvider(p.id, { temperature: v })}
                            placeholder="0.9"
                            step={0.05}
                          />
                          <NumInput
                            label="top_p"
                            value={p.top_p}
                            onChange={(v) => updateProvider(p.id, { top_p: v })}
                            placeholder="0.95"
                            step={0.01}
                          />
                          {p.kind === "ollama" && (
                            <>
                              <NumInput
                                label="top_k"
                                value={p.top_k}
                                onChange={(v) => updateProvider(p.id, { top_k: v })}
                                placeholder="40"
                                step={1}
                              />
                              <NumInput
                                label="min_p"
                                value={p.min_p}
                                onChange={(v) => updateProvider(p.id, { min_p: v })}
                                placeholder="0.05"
                                step={0.01}
                              />
                              <NumInput
                                label="rep penalty"
                                value={p.repetition_penalty}
                                onChange={(v) =>
                                  updateProvider(p.id, { repetition_penalty: v })
                                }
                                placeholder="1.1"
                                step={0.05}
                              />
                            </>
                          )}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className="px-5 py-3 border-t border-neutral-800 flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {onExportBackup && (
              <button
                onClick={onExportBackup}
                className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                title="Download everything as a single JSON backup"
              >
                export backup
              </button>
            )}
            {onImportBackup && (
              <label className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 cursor-pointer">
                import backup
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f && onImportBackup) {
                      onImportBackup(f);
                      onClose();
                    }
                  }}
                />
              </label>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 rounded"
            >
              cancel
            </button>
            <button
              onClick={commit}
              className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded"
            >
              save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function RadioCard({
  active,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-md border p-3 transition-colors ${
        active
          ? "border-emerald-600 bg-emerald-500/5"
          : "border-neutral-800 bg-neutral-950 hover:border-neutral-700"
      }`}
    >
      <p className="text-sm font-medium text-neutral-100">{title}</p>
      <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>
    </button>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-neutral-500 uppercase tracking-wider">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="mt-0.5 w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm text-neutral-100 focus:outline-none focus:border-neutral-600"
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-neutral-500 uppercase tracking-wider">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="mt-0.5 w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm text-neutral-100 focus:outline-none focus:border-neutral-600"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MiniBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
    >
      {children}
    </button>
  );
}

function NumInput({
  label,
  value,
  onChange,
  placeholder,
  step,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
        {label}
      </span>
      <input
        type="number"
        step={step ?? "any"}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          onChange(raw === "" ? undefined : Number(raw));
        }}
        className="mt-0.5 w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-0.5 text-xs text-neutral-100 focus:outline-none focus:border-neutral-600"
      />
    </label>
  );
}
