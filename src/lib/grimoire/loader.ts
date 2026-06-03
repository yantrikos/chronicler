// Vite-based plugin loader. Discovers in-tree plugins under src/plugins/*/
// at build time via import.meta.glob, then asks the host to load each one.
//
// Each in-tree plugin must export:
//   export default <GrimoireDefinition>
//   export const manifest: GrimoireManifest
//
// Hot reload comes for free via Vite HMR — when an in-tree plugin file
// changes, Vite re-runs the module and the host re-loads it.

import type { PluginHost } from "./host";
import type { GrimoireDefinition, GrimoireManifest } from "./types";

interface PluginModule {
  default: GrimoireDefinition;
  manifest: GrimoireManifest;
}

/** Load all in-tree plugins discovered via Vite. Safe to call multiple
 *  times — the host will hot-replace existing entries. */
export async function loadInTreePlugins(host: PluginHost): Promise<number> {
  // eager: true so we don't deal with async module promises at startup
  const modules = import.meta.glob<PluginModule>("/src/plugins/*/index.ts", {
    eager: true,
  });
  let loaded = 0;
  for (const [path, mod] of Object.entries(modules)) {
    if (!mod || !mod.default || !mod.manifest) {
      console.warn(`[grimoire] ${path} missing default or manifest export — skipped`);
      continue;
    }
    const result = await host.loadPlugin(mod.manifest, mod.default, path);
    if (result) loaded++;
  }
  console.log(`[grimoire] in-tree loader registered ${loaded} plugin(s)`);
  return loaded;
}
