// PluginHost — loads, validates, sets up, and disposes Grimoire entries.
//
// In v1, plugins are imported via Vite's `import.meta.glob` from
// `src/plugins/*/index.ts`. Each plugin exports `{ default: GrimoireDefinition,
// manifest: GrimoireManifest }`. The host validates the manifest, runs setup
// with a scoped SetupContext, and tracks the resulting runtime for dispose.

import { CommandRegistry } from "./registry/commands";
import { HookRegistry } from "./registry/hooks";
import { SlotRegistry } from "./registry/slots";
import { validateManifest } from "./manifest";
import {
  buildApi,
  type SdkRuntimeContext,
  type SdkRuntimeDeps,
} from "./sdk-runtime";
import type {
  GrimoireDefinition,
  GrimoireId,
  GrimoireManifest,
  GrimoireRuntime,
  GrimoireSetupContext,
  HookHandler,
  HookPoint,
  HookType,
  SlashCommandDef,
} from "./types";

export interface LoadedPlugin {
  manifest: GrimoireManifest;
  definition: GrimoireDefinition;
  runtime: GrimoireRuntime;
  loadedAt: string;
}

export interface PluginLoadError {
  pluginId: string;
  source: string;
  errors: string[];
}

export class PluginHost {
  private plugins = new Map<GrimoireId, LoadedPlugin>();
  private errors: PluginLoadError[] = [];
  public readonly hooks = new HookRegistry();
  public readonly commands = new CommandRegistry();
  public readonly slots = new SlotRegistry();
  /** Bumped each time the host's contribution surface changes
   *  (plugin load/unload, slot registration). Used by React consumers
   *  to re-read the slot list. */
  private version = 0;
  private versionListeners = new Set<() => void>();

  constructor(private deps: SdkRuntimeDeps) {}

  /** Load a single plugin from a definition + manifest pair. Used by the
   *  Vite loader and by tests. Returns null on validation failure (errors
   *  collected in this.errors). */
  async loadPlugin(
    rawManifest: unknown,
    definition: GrimoireDefinition,
    source: string = "<unknown>"
  ): Promise<LoadedPlugin | null> {
    const v = validateManifest(rawManifest);
    if (!v.ok || !v.manifest) {
      this.errors.push({
        pluginId: (rawManifest as { id?: string })?.id ?? "<invalid>",
        source,
        errors: v.errors,
      });
      console.warn(`[grimoire] manifest invalid for ${source}:`, v.errors);
      return null;
    }
    const manifest = v.manifest;

    if (manifest.id !== definition.id) {
      this.errors.push({
        pluginId: manifest.id,
        source,
        errors: [
          `manifest id (${manifest.id}) does not match definition id (${definition.id})`,
        ],
      });
      return null;
    }

    if (this.plugins.has(manifest.id)) {
      // Already loaded — dispose first (hot reload path).
      await this.unloadPlugin(manifest.id);
    }

    const setupCtx = this.buildSetupContext(manifest);
    let runtime: GrimoireRuntime;
    try {
      runtime = await definition.setup(setupCtx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.errors.push({
        pluginId: manifest.id,
        source,
        errors: [`setup() threw: ${msg}`],
      });
      console.warn(`[grimoire] setup failed for ${manifest.id}:`, e);
      return null;
    }

    const loaded: LoadedPlugin = {
      manifest,
      definition,
      runtime,
      loadedAt: new Date().toISOString(),
    };
    this.plugins.set(manifest.id, loaded);
    this.bumpVersion();
    console.log(
      `[grimoire] loaded ${manifest.id} v${manifest.version} (${source})`
    );
    return loaded;
  }

  /** Subscribe to host version bumps. Returns an unsubscribe function.
   *  React consumers use this to re-render when plugins load/unload. */
  subscribe(listener: () => void): () => void {
    this.versionListeners.add(listener);
    return () => this.versionListeners.delete(listener);
  }

  getVersion(): number {
    return this.version;
  }

  private bumpVersion(): void {
    this.version++;
    for (const l of this.versionListeners) {
      try {
        l();
      } catch (e) {
        console.warn("[grimoire] version listener threw", e);
      }
    }
  }

  /** Dispose a plugin: call its dispose() (if any), unregister hooks +
   *  commands, drop from the registry. */
  async unloadPlugin(id: GrimoireId): Promise<void> {
    const p = this.plugins.get(id);
    if (!p) return;
    try {
      if (p.runtime.dispose) await p.runtime.dispose();
    } catch (e) {
      console.warn(`[grimoire] dispose threw for ${id}:`, e);
    }
    this.hooks.unregisterPlugin(id);
    this.commands.unregisterPlugin(id);
    this.slots.unregisterPlugin(id);
    this.plugins.delete(id);
    this.bumpVersion();
  }

  /** Dispose every loaded plugin (page teardown / explicit reset). */
  async unloadAll(): Promise<void> {
    for (const id of Array.from(this.plugins.keys())) {
      await this.unloadPlugin(id);
    }
    this.errors = [];
  }

  list(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  getErrors(): PluginLoadError[] {
    return [...this.errors];
  }

  /** Build the SetupContext passed to plugin.setup(). Provides type-safe
   *  registration shorthands that close over this.hooks / this.commands. */
  private buildSetupContext(manifest: GrimoireManifest): GrimoireSetupContext {
    const pluginId = manifest.id;
    const makeHookApi = <P extends HookPoint>(point: P) => ({
      observe: (handler: HookHandler<P>) =>
        this.hooks.register(pluginId, point, "observer" as HookType, handler),
      augment: (handler: HookHandler<P>) =>
        this.hooks.register(pluginId, point, "augmenter" as HookType, handler),
      strategy: (handler: HookHandler<P>) =>
        this.hooks.register(pluginId, point, "strategy" as HookType, handler),
    });
    return {
      manifest,
      logger: {
        info: (...a: unknown[]) =>
          console.log(`[grimoire/${pluginId}]`, ...a),
        warn: (...a: unknown[]) =>
          console.warn(`[grimoire/${pluginId}]`, ...a),
        error: (...a: unknown[]) =>
          console.error(`[grimoire/${pluginId}]`, ...a),
      },
      hooks: {
        beforeRetrieve: makeHookApi("beforeRetrieve"),
        afterRetrieve: makeHookApi("afterRetrieve"),
        beforeCompose: makeHookApi("beforeCompose"),
        beforeChat: makeHookApi("beforeChat"),
        afterChat: makeHookApi("afterChat"),
        beforeWrite: makeHookApi("beforeWrite"),
        afterWrite: makeHookApi("afterWrite"),
      },
      commands: {
        register: (def: SlashCommandDef) => {
          this.commands.register(pluginId, def);
        },
      },
      ui: {
        registerSlot: (slot, component, opts) => {
          this.slots.register(pluginId, slot, component, opts);
          this.bumpVersion();
        },
      },
    };
  }

  /** Build a scoped api object for invocation. Exposed so callers (the
   *  orchestrator wrapper) can invoke commands/hooks without rebuilding the
   *  api each time. */
  buildApiFor(pluginId: GrimoireId): import("./types").GrimoireApi {
    const p = this.plugins.get(pluginId);
    if (!p) {
      throw new Error(`[grimoire] no plugin loaded with id ${pluginId}`);
    }
    const ctx: SdkRuntimeContext = {
      deps: this.deps,
      commands: this.commands,
      triggerCommand: (name, args) => this.triggerCommand(name, args),
    };
    return buildApi(pluginId, p.manifest, ctx);
  }

  /** Convenience — dispatch a hook point with the right api-builder. */
  async dispatchHook<P extends HookPoint>(
    point: P,
    context: import("./types").HookContextMap[P]
  ): Promise<import("./types").HookContextMap[P]> {
    const result = await this.hooks.dispatch(point, context, (id) =>
      this.buildApiFor(id)
    );
    if (result.errors.length > 0) {
      for (const e of result.errors) {
        console.warn(`[grimoire] hook ${point} error in ${e.pluginId}:`, e.error);
      }
    }
    return result.context;
  }

  /** Convenience — invoke a slash command by name. */
  async triggerCommand(name: string, args: string = "") {
    return this.commands.trigger(name, args, (id) => this.buildApiFor(id));
  }
}
