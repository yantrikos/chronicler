// Slash command registry. Plugins register typed `/name` commands; the
// chat input renders autocomplete suggestions; invocation routes by name.

import type {
  GrimoireApi,
  GrimoireId,
  SlashCommandDef,
  SlashResult,
} from "../types";

interface Registration {
  pluginId: GrimoireId;
  def: SlashCommandDef;
}

export class CommandRegistry {
  private byName = new Map<string, Registration>();

  register(pluginId: GrimoireId, def: SlashCommandDef): void {
    const name = def.name.replace(/^\/+/, "").trim();
    if (!name) throw new Error("slash command name must be non-empty");
    if (this.byName.has(name)) {
      const existing = this.byName.get(name)!;
      throw new Error(
        `[grimoire] slash command conflict: /${name} already registered by ${existing.pluginId}, ${pluginId} rejected`
      );
    }
    this.byName.set(name, { pluginId, def: { ...def, name } });
  }

  unregisterPlugin(pluginId: GrimoireId): void {
    for (const [name, reg] of this.byName) {
      if (reg.pluginId === pluginId) this.byName.delete(name);
    }
  }

  /** All registered commands, sorted by name for stable autocomplete. */
  list(): SlashCommandDef[] {
    return Array.from(this.byName.values())
      .map((r) => r.def)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Filter commands by name prefix for autocomplete UX. */
  match(prefix: string): SlashCommandDef[] {
    const p = prefix.replace(/^\/+/, "").toLowerCase();
    return this.list().filter((d) => d.name.toLowerCase().startsWith(p));
  }

  async trigger(
    name: string,
    args: string,
    buildApi: (pluginId: GrimoireId) => GrimoireApi
  ): Promise<SlashResult | void> {
    const clean = name.replace(/^\/+/, "").trim();
    const reg = this.byName.get(clean);
    if (!reg) {
      return { kind: "error", content: `Unknown command: /${clean}` };
    }
    try {
      const result = await reg.def.run(args, buildApi(reg.pluginId));
      return result ?? undefined;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        kind: "error",
        content: `/${clean} failed: ${msg}`,
      };
    }
  }
}
