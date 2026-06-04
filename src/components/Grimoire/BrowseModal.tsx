// Browse Grimoire modal. Lists installed out-of-tree plugins (from the
// server's /api/grimoire/plugins endpoint), shows their declared
// permissions + load state, and offers install via git URL + uninstall.
//
// Substrate for v0.3's "Browse Codex" experience. Curated community
// catalog (JSON listing of recommended plugins) lands in v0.3.

import { useEffect, useState } from "react";

interface CatalogEntry {
  id: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    apiVersion: string;
    description?: string;
    author?: string;
    homepage?: string;
    permissions?: {
      network?: string[];
      filesystem?: string | false;
      llm?: boolean;
      memory?: string | false;
    };
    contributes?: {
      hooks?: Array<{ point: string; type: string }>;
      commands?: string[];
      ui?: { slots?: string[] };
    };
  };
  bundledAt: string;
  sourcePath: string;
  bundleUrl: string;
  error?: string;
}

interface CatalogResponse {
  version: number;
  plugins: CatalogEntry[];
}

interface Props {
  onClose: () => void;
}

export function BrowseGrimoireModal({ onClose }: Props) {
  const [catalog, setCatalog] = useState<CatalogResponse>({
    version: 0,
    plugins: [],
  });
  const [fetching, setFetching] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installUrl, setInstallUrl] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refreshCatalog(): Promise<void> {
    setFetching(true);
    try {
      const res = await fetch("/api/grimoire/plugins", { cache: "no-cache" });
      if (!res.ok) {
        setFeedback(`catalog fetch failed: ${res.status}`);
        return;
      }
      const data = (await res.json()) as CatalogResponse;
      setCatalog(data);
    } catch (e) {
      setFeedback(
        `catalog fetch threw: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    void refreshCatalog();
  }, []);

  async function onInstall(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const url = installUrl.trim();
    if (!url) return;
    setInstalling(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/grimoire/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gitUrl: url }),
      });
      const json = (await res.json()) as { ok?: boolean; id?: string; error?: string };
      if (!res.ok || !json.ok) {
        setFeedback(`✗ install failed: ${json.error ?? res.status}`);
        return;
      }
      setFeedback(`✓ installed ${json.id} — reloading catalog`);
      setInstallUrl("");
      await refreshCatalog();
    } catch (e) {
      setFeedback(
        `install threw: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setInstalling(false);
    }
  }

  async function onUninstall(id: string): Promise<void> {
    if (!confirm(`Uninstall "${id}"? This deletes the plugin directory.`)) return;
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/grimoire/uninstall/${encodeURIComponent(id)}`,
        { method: "POST" }
      );
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setFeedback(`✗ uninstall failed: ${json.error ?? res.status}`);
        return;
      }
      setFeedback(`✓ uninstalled ${id}`);
      await refreshCatalog();
    } catch (e) {
      setFeedback(
        `uninstall threw: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-12 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg bg-neutral-950 border border-neutral-800 shadow-xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">
              Browse Grimoire
            </h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Plugins installed from <code className="text-emerald-400">~/.chronicler/plugins/</code>.
              Add more by git URL.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-100 text-lg leading-none px-2"
          >
            ×
          </button>
        </header>

        <section className="px-5 py-3 border-b border-neutral-800">
          <form onSubmit={onInstall} className="flex gap-2 items-end">
            <label className="flex-1 space-y-0.5 text-[12px]">
              <span className="text-neutral-400">Install from git URL</span>
              <input
                type="text"
                value={installUrl}
                onChange={(e) => setInstallUrl(e.target.value)}
                placeholder="https://github.com/yantrikos/chronicler-grimoire-stats"
                className="w-full rounded bg-neutral-800 border border-neutral-700 px-2 py-1.5 font-mono text-[11px]"
              />
            </label>
            <button
              type="submit"
              disabled={installing || installUrl.trim().length === 0}
              className="rounded bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-[12px] disabled:bg-neutral-700 disabled:text-neutral-500"
            >
              {installing ? "installing…" : "install"}
            </button>
          </form>
          {feedback && (
            <p className="text-[11px] text-neutral-400 mt-2">{feedback}</p>
          )}
        </section>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] uppercase tracking-wider text-neutral-500">
              Installed ({catalog.plugins.length})
            </h3>
            <button
              type="button"
              onClick={() => void refreshCatalog()}
              disabled={fetching}
              className="text-[10px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
            >
              {fetching ? "refreshing…" : "refresh"}
            </button>
          </div>

          {catalog.plugins.length === 0 ? (
            <p className="text-[12px] text-neutral-600 italic px-2 py-6 text-center">
              No out-of-tree plugins installed yet. Try installing one via git
              URL above, or drop a folder into <code>~/.chronicler/plugins/</code> on
              your host.
            </p>
          ) : (
            <ul className="space-y-2">
              {catalog.plugins.map((p) => (
                <PluginCard
                  key={p.id}
                  entry={p}
                  onUninstall={() => void onUninstall(p.id)}
                />
              ))}
            </ul>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-neutral-800 text-[11px] text-neutral-500 leading-relaxed">
          Plugins ship with declared capabilities (network / filesystem / llm /
          memory). Enforcement applies to the SDK-wrapped api; plugins that
          import raw node modules bypass enforcement. Only install Grimoire
          entries from authors you trust.
        </footer>
      </div>
    </div>
  );
}

interface CardProps {
  entry: CatalogEntry;
  onUninstall: () => void;
}

function PluginCard({ entry, onUninstall }: CardProps) {
  const m = entry.manifest;
  const perms = m.permissions ?? {};
  const contrib = m.contributes ?? {};
  return (
    <li className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3 text-[12px]">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-neutral-100 truncate">
              {m.name}
            </span>
            <span className="text-[10px] font-mono text-neutral-500 whitespace-nowrap">
              v{m.version}
            </span>
            {entry.error && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-700/70 text-rose-100">
                error
              </span>
            )}
          </div>
          <p className="text-[10px] font-mono text-neutral-500 truncate mt-0.5">
            {m.id}
          </p>
          {m.description && (
            <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
              {m.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onUninstall}
          className="rounded border border-rose-800/60 hover:border-rose-700 px-2 py-0.5 text-[10px] text-rose-300"
        >
          uninstall
        </button>
      </header>

      {entry.error && (
        <p className="text-[11px] text-rose-300 mt-2 leading-relaxed">
          {entry.error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        {contrib.hooks?.map((h, i) => (
          <span
            key={`h${i}`}
            className="px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-200"
            title={`${h.type} hook`}
          >
            {h.point}
          </span>
        ))}
        {contrib.commands?.map((c) => (
          <span
            key={c}
            className="px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-200 font-mono"
          >
            /{c}
          </span>
        ))}
        {contrib.ui?.slots?.map((s) => (
          <span
            key={s}
            className="px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-200 font-mono"
          >
            {s}
          </span>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-neutral-500">
        <span>
          network:{" "}
          <code className="text-neutral-400">
            {perms.network && perms.network.length > 0
              ? perms.network.join(", ")
              : "none"}
          </code>
        </span>
        <span>
          llm:{" "}
          <code className="text-neutral-400">
            {perms.llm ? "yes" : "no"}
          </code>
        </span>
        <span>
          fs:{" "}
          <code className="text-neutral-400">
            {String(perms.filesystem ?? "none")}
          </code>
        </span>
        <span>
          memory:{" "}
          <code className="text-neutral-400">
            {String(perms.memory ?? "none")}
          </code>
        </span>
      </div>
    </li>
  );
}
