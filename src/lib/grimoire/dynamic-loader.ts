// Browser-side dynamic plugin loader. Fetches the catalog from the
// server's /api/grimoire/plugins endpoint, dynamic-imports each bundle,
// and registers with the host.
//
// Out-of-tree plugins live on the user's host filesystem in
// ~/.chronicler/plugins/<id>/ (volume-mounted into the docker container)
// and are bundled server-side by esbuild. Each bundle is a regular ESM
// module that exports default GrimoireDefinition + named manifest.
//
// Hot reload: the server emits SSE events on /api/grimoire/events when
// it rebundles a plugin. We re-fetch the catalog and re-load any
// changed bundles. Bundle URLs are cache-busted by the bundle's
// version counter so the browser actually re-downloads.

import type { PluginHost } from "./host";
import type { GrimoireDefinition, GrimoireManifest } from "./types";

interface CatalogEntry {
  id: string;
  manifest: GrimoireManifest;
  bundledAt: string;
  sourcePath: string;
  bundleUrl: string;
  error?: string;
}

interface CatalogResponse {
  version: number;
  plugins: CatalogEntry[];
}

/** Track which (id, bundledAt) we've loaded so SSE-driven reloads only
 *  re-import the entries that actually changed. */
const loadedAt = new Map<string, string>();

/** Track active SSE connection so the cleanup hook can close it. */
let activeEventSource: EventSource | null = null;

/** Load all out-of-tree plugins from the server. Idempotent — re-call
 *  on each SSE event to pick up changes. Returns count of plugins
 *  loaded or refreshed this pass. */
export async function loadOutOfTreePlugins(host: PluginHost): Promise<number> {
  let catalog: CatalogResponse;
  try {
    const res = await fetch("/api/grimoire/plugins", { cache: "no-cache" });
    if (!res.ok) {
      console.warn(
        "[grimoire/dynamic] catalog fetch failed:",
        res.status,
        await res.text()
      );
      return 0;
    }
    catalog = await res.json();
  } catch (e) {
    console.warn("[grimoire/dynamic] catalog fetch threw:", e);
    return 0;
  }

  // Unload plugins that disappeared from the catalog.
  const present = new Set(catalog.plugins.map((p) => p.id));
  for (const id of Array.from(loadedAt.keys())) {
    if (!present.has(id)) {
      console.log(`[grimoire/dynamic] unloading ${id} (gone from server)`);
      await host.unloadPlugin(id);
      loadedAt.delete(id);
    }
  }

  let changed = 0;
  for (const entry of catalog.plugins) {
    if (entry.error) {
      console.warn(
        `[grimoire/dynamic] server-side bundle error for ${entry.id}: ${entry.error}`
      );
      continue;
    }
    const prevTs = loadedAt.get(entry.id);
    if (prevTs === entry.bundledAt) continue; // already current
    try {
      // Cache-bust by bundledAt so HMR-style re-edits actually reload.
      const url = `${entry.bundleUrl}?v=${encodeURIComponent(entry.bundledAt)}`;
      const mod = (await import(/* @vite-ignore */ url)) as {
        default?: GrimoireDefinition;
        manifest?: GrimoireManifest;
      };
      if (!mod.default || !mod.manifest) {
        console.warn(
          `[grimoire/dynamic] ${entry.id}: bundle missing default or manifest export`
        );
        continue;
      }
      const loaded = await host.loadPlugin(
        mod.manifest,
        mod.default,
        `out-of-tree:${entry.sourcePath}`
      );
      if (loaded) {
        loadedAt.set(entry.id, entry.bundledAt);
        changed++;
      }
    } catch (e) {
      console.warn(`[grimoire/dynamic] failed to import ${entry.id}:`, e);
    }
  }
  if (changed > 0) {
    console.log(
      `[grimoire/dynamic] loaded/refreshed ${changed} out-of-tree plugin(s)`
    );
  }
  return changed;
}

/** Subscribe to server-side plugin events. Triggers a catalog re-fetch
 *  + re-load whenever the server reports a change. Returns a cleanup
 *  function. */
export function subscribeToPluginEvents(host: PluginHost): () => void {
  if (typeof EventSource === "undefined") return () => undefined;
  try {
    activeEventSource = new EventSource("/api/grimoire/events");
    activeEventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "reload") {
          void loadOutOfTreePlugins(host);
        }
      } catch {
        /* malformed message — ignore */
      }
    };
    activeEventSource.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };
  } catch (e) {
    console.warn("[grimoire/dynamic] SSE subscription failed:", e);
  }
  return () => {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
  };
}
