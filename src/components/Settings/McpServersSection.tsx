// MCP server registration UI. Lives in the SettingsPanel. Lets users add,
// remove, enable/disable, test-connect, and refresh-catalog for external
// MCP servers — the substrate that lets characters call third-party
// tools (TTS, image gen, dice, web search, summarizers, anything MCP).
//
// v1 surfaces tool / resource / prompt catalogs in browse-only form.
// Tool calling in the chat loop lands in v0.4 (saga #54).

import { useEffect, useMemo, useState } from "react";
import type { McpServerRegistry } from "../../lib/mcp/registry";
import type {
  McpServerConfig,
  McpServerStatus,
  McpToolDescriptor,
} from "../../lib/mcp/types";

interface Props {
  registry: McpServerRegistry;
}

export function McpServersSection({ registry }: Props) {
  // Re-render on registry changes (add / remove / status update).
  const [version, setVersion] = useState(0);
  useEffect(() => registry.subscribe(() => setVersion((v) => v + 1)), [registry]);
  void version; // makes the dep explicit for React's tracking
  const servers = useMemo(() => registry.list(), [registry, version]);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<McpServerConfig>({
    id: "",
    name: "",
    url: "",
    transport: "streamable-http",
    enabled: true,
  });

  function resetDraft() {
    setDraft({
      id: "",
      name: "",
      url: "",
      transport: "streamable-http",
      enabled: true,
    });
  }

  function commitDraft() {
    const id = draft.id.trim();
    if (!id || !/^[a-z0-9_-]+$/.test(id)) {
      alert("id must be lowercase alphanumeric (a-z, 0-9, _, -)");
      return;
    }
    if (!draft.name.trim()) {
      alert("name is required");
      return;
    }
    if (!draft.url.trim()) {
      alert("url is required");
      return;
    }
    if (registry.get(id)) {
      alert(`server id "${id}" already exists`);
      return;
    }
    registry.upsert(draft);
    setAdding(false);
    resetDraft();
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-neutral-200">Tool servers</h3>
          <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
            Register MCP servers as tool providers — TTS, image generation,
            dice, web search, summarizers. Same protocol as Claude Code, Cline,
            Zed. v0.3 shows the catalog; v0.4 wires tool calling into the
            chat loop.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded border border-emerald-700/60 hover:border-emerald-600 px-2.5 py-1 text-[11px] text-emerald-300 hover:text-emerald-200"
          >
            + add server
          </button>
        )}
      </header>

      {adding && (
        <div className="rounded-md border border-neutral-700 bg-neutral-900 p-3 space-y-2 text-[12px]">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-0.5">
              <span className="text-neutral-400">id</span>
              <input
                className="w-full rounded bg-neutral-800 border border-neutral-700 px-2 py-1 font-mono text-[11px]"
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                placeholder="dice, tts-elevenlabs, …"
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-neutral-400">name</span>
              <input
                className="w-full rounded bg-neutral-800 border border-neutral-700 px-2 py-1"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Dice Roller"
              />
            </label>
          </div>
          <label className="block space-y-0.5">
            <span className="text-neutral-400">url</span>
            <input
              className="w-full rounded bg-neutral-800 border border-neutral-700 px-2 py-1 font-mono text-[11px]"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="http://localhost:8765/mcp or /api/mcp/dice"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-0.5">
              <span className="text-neutral-400">transport</span>
              <select
                className="w-full rounded bg-neutral-800 border border-neutral-700 px-2 py-1"
                value={draft.transport}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    transport: e.target.value as McpServerConfig["transport"],
                  })
                }
              >
                <option value="streamable-http">streamable-http</option>
                <option value="sse">sse</option>
              </select>
            </label>
            <label className="space-y-0.5">
              <span className="text-neutral-400">auth token (optional)</span>
              <input
                type="password"
                className="w-full rounded bg-neutral-800 border border-neutral-700 px-2 py-1 font-mono text-[11px]"
                value={draft.authToken ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, authToken: e.target.value || undefined })
                }
                placeholder="Bearer token"
              />
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={commitDraft}
              className="rounded bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-[11px]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                resetDraft();
              }}
              className="rounded border border-neutral-700 hover:border-neutral-500 px-3 py-1 text-[11px] text-neutral-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {servers.length === 0 && !adding && (
        <p className="text-[11px] text-neutral-600 italic px-2 py-3">
          No tool servers registered yet.
        </p>
      )}

      <div className="space-y-2">
        {servers.map((s) => (
          <McpServerCard key={s.id} server={s} registry={registry} />
        ))}
      </div>
    </section>
  );
}

interface CardProps {
  server: McpServerConfig;
  registry: McpServerRegistry;
}

function McpServerCard({ server, registry }: CardProps) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const status: McpServerStatus = registry.getStatus(server.id);
  const catalog = registry.getCatalog(server.id);

  async function onTest() {
    setBusy(true);
    setFeedback(null);
    try {
      const r = await registry.testConnection(server.id);
      setFeedback(r.ok ? "✓ connection OK" : `✗ ${r.error}`);
    } finally {
      setBusy(false);
    }
  }

  async function onRefresh() {
    setBusy(true);
    setFeedback(null);
    try {
      await registry.initialize(server.id);
      setFeedback("✓ catalog refreshed");
    } catch (e) {
      setFeedback(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function onToggle() {
    registry.upsert({ ...server, enabled: !server.enabled });
  }

  function onRemove() {
    if (!confirm(`Remove MCP server "${server.name}"?`)) return;
    registry.remove(server.id);
  }

  const stateChip =
    status.state === "ready"
      ? "bg-emerald-700/60 text-emerald-100"
      : status.state === "connecting"
        ? "bg-amber-700/60 text-amber-100"
        : status.state === "error"
          ? "bg-rose-700/70 text-rose-100"
          : "bg-neutral-700 text-neutral-300";

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3 text-[12px]">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-neutral-100 truncate">{server.name}</span>
          <span className="text-[10px] font-mono text-neutral-500 truncate">
            {server.id}
          </span>
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${stateChip}`}>
            {status.state}
          </span>
          {!server.enabled && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-500">
              disabled
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onToggle}
            className="rounded border border-neutral-700 hover:border-neutral-500 px-2 py-0.5 text-[10px] text-neutral-300"
          >
            {server.enabled ? "disable" : "enable"}
          </button>
          <button
            type="button"
            onClick={onTest}
            disabled={busy}
            className="rounded border border-neutral-700 hover:border-neutral-500 px-2 py-0.5 text-[10px] text-neutral-300 disabled:opacity-50"
          >
            test
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy || !server.enabled}
            className="rounded border border-emerald-700/60 hover:border-emerald-600 px-2 py-0.5 text-[10px] text-emerald-300 disabled:opacity-50"
          >
            refresh
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-rose-800/60 hover:border-rose-700 px-2 py-0.5 text-[10px] text-rose-300"
          >
            remove
          </button>
        </div>
      </header>

      <p className="text-[10px] font-mono text-neutral-500 mt-1 truncate">
        {server.transport} · {server.url}
      </p>

      {feedback && (
        <p className="text-[11px] mt-2 text-neutral-300">{feedback}</p>
      )}
      {status.lastError && !feedback && (
        <p className="text-[11px] mt-2 text-rose-300">{status.lastError}</p>
      )}

      {catalog && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <CatalogSection
            label="Tools"
            count={catalog.tools.length}
            items={catalog.tools.map((t) => ({
              label: t.name,
              hint: t.description,
            }))}
          />
          <CatalogSection
            label="Resources"
            count={catalog.resources.length}
            items={catalog.resources.map((r) => ({
              label: r.name ?? r.uri,
              hint: r.description ?? r.uri,
            }))}
          />
          <CatalogSection
            label="Prompts"
            count={catalog.prompts.length}
            items={catalog.prompts.map((p) => ({
              label: p.name,
              hint: p.description,
            }))}
          />
        </div>
      )}
    </div>
  );
}

interface CatalogSectionProps {
  label: string;
  count: number;
  items: Array<{ label: string; hint?: string }>;
}

function CatalogSection({ label, count, items }: CatalogSectionProps) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-950/50 p-2">
      <p className="text-[9px] uppercase tracking-wider text-neutral-500 mb-1">
        {label} · {count}
      </p>
      {items.length === 0 ? (
        <p className="text-[10px] text-neutral-600 italic">none</p>
      ) : (
        <ul className="space-y-0.5">
          {items.slice(0, 6).map((it, i) => (
            <li key={i} className="text-neutral-300 truncate" title={it.hint ?? ""}>
              <code className="text-emerald-400 font-mono text-[10px]">
                {it.label}
              </code>
            </li>
          ))}
          {items.length > 6 && (
            <li className="text-[10px] text-neutral-600">
              + {items.length - 6} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// Re-exported for tests; lets tests poke at the catalog shape without
// instantiating the full component tree.
export type { McpToolDescriptor };
