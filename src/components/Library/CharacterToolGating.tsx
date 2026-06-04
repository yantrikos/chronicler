// Per-character MCP tool gating UI. Lives inside CharacterEditor.
//
// Shows every tool from every enabled MCP server as a checkbox grouped
// by server. The "all tools available" default is preserved until the
// user explicitly saves — then only checked tools reach the model for
// this character.

import { useEffect, useMemo, useState } from "react";
import {
  loadCharacterGating,
  saveCharacterGating,
  type CharacterGating,
} from "../../lib/mcp/character-gating";
import type { McpServerRegistry } from "../../lib/mcp/registry";

interface Props {
  characterId: string;
  characterName?: string;
  registry: McpServerRegistry;
}

export function CharacterToolGating({ characterId, characterName, registry }: Props) {
  // Re-render on registry changes (server added/removed/catalog refresh).
  const [registryVersion, setRegistryVersion] = useState(0);
  useEffect(
    () => registry.subscribe(() => setRegistryVersion((v) => v + 1)),
    [registry]
  );
  void registryVersion;

  const [gating, setGating] = useState<CharacterGating>(() =>
    loadCharacterGating(characterId)
  );

  // Reload when the character changes (parent may re-mount or just
  // pass a new id; this defends against the latter).
  useEffect(() => {
    setGating(loadCharacterGating(characterId));
  }, [characterId]);

  const allTools = useMemo(() => {
    const out: Array<{
      serverId: string;
      serverName: string;
      toolName: string;
      qualifiedName: string;
      description?: string;
    }> = [];
    for (const server of registry.list()) {
      if (!server.enabled) continue;
      const catalog = registry.getCatalog(server.id);
      if (!catalog) continue;
      for (const tool of catalog.tools) {
        out.push({
          serverId: server.id,
          serverName: server.name,
          toolName: tool.name,
          qualifiedName: `${server.id}__${tool.name}`,
          description: tool.description,
        });
      }
    }
    return out;
  }, [registry, registryVersion]);

  const allowedSet = useMemo(
    () => new Set(gating.allowedTools),
    [gating.allowedTools]
  );

  function toggle(qualifiedName: string): void {
    const next = new Set(allowedSet);
    if (next.has(qualifiedName)) next.delete(qualifiedName);
    else next.add(qualifiedName);
    const updated: CharacterGating = {
      configured: true,
      allowedTools: Array.from(next),
    };
    setGating(updated);
    saveCharacterGating(characterId, updated);
  }

  function setAll(serverId: string, enabled: boolean): void {
    const next = new Set(allowedSet);
    for (const t of allTools) {
      if (t.serverId !== serverId) continue;
      if (enabled) next.add(t.qualifiedName);
      else next.delete(t.qualifiedName);
    }
    const updated: CharacterGating = {
      configured: true,
      allowedTools: Array.from(next),
    };
    setGating(updated);
    saveCharacterGating(characterId, updated);
  }

  function resetToDefault(): void {
    const updated: CharacterGating = { configured: false, allowedTools: [] };
    setGating(updated);
    saveCharacterGating(characterId, updated);
  }

  if (allTools.length === 0) {
    return (
      <div className="text-[12px] text-neutral-500 italic px-2 py-3">
        No MCP servers registered or no catalogs loaded yet. Add servers in
        Settings → Tool servers, then refresh their catalogs.
      </div>
    );
  }

  // Group by server for display.
  const byServer = new Map<
    string,
    { serverName: string; tools: typeof allTools }
  >();
  for (const t of allTools) {
    const entry = byServer.get(t.serverId);
    if (entry) entry.tools.push(t);
    else
      byServer.set(t.serverId, {
        serverName: t.serverName,
        tools: [t],
      });
  }

  return (
    <div className="space-y-3 text-[12px]">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium text-neutral-200">
            Tools available to {characterName ?? "this character"}
          </h4>
          <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
            {gating.configured
              ? "Custom allowlist — only checked tools reach the model."
              : "Default: all tools from all enabled servers are available."}
          </p>
        </div>
        {gating.configured && (
          <button
            type="button"
            onClick={resetToDefault}
            className="rounded border border-neutral-700 hover:border-neutral-500 px-2 py-0.5 text-[10px] text-neutral-300"
            title="Drop the custom allowlist; the character gets all tools"
          >
            reset to default
          </button>
        )}
      </header>

      <div className="space-y-2">
        {Array.from(byServer.entries()).map(([serverId, group]) => {
          const allChecked = group.tools.every((t) =>
            gating.configured ? allowedSet.has(t.qualifiedName) : true
          );
          const noneChecked = gating.configured
            ? group.tools.every((t) => !allowedSet.has(t.qualifiedName))
            : false;
          return (
            <div
              key={serverId}
              className="rounded border border-neutral-800 bg-neutral-950/40 p-2.5"
            >
              <header className="flex items-center justify-between mb-1.5">
                <div>
                  <span className="font-medium text-neutral-200">
                    {group.serverName}
                  </span>
                  <span className="ml-2 text-[10px] font-mono text-neutral-500">
                    {serverId}
                  </span>
                </div>
                <div className="flex gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setAll(serverId, true)}
                    disabled={allChecked && gating.configured}
                    className="rounded border border-neutral-700 hover:border-neutral-500 px-1.5 py-0.5 text-neutral-300 disabled:opacity-50"
                  >
                    all
                  </button>
                  <button
                    type="button"
                    onClick={() => setAll(serverId, false)}
                    disabled={noneChecked}
                    className="rounded border border-neutral-700 hover:border-neutral-500 px-1.5 py-0.5 text-neutral-300 disabled:opacity-50"
                  >
                    none
                  </button>
                </div>
              </header>
              <ul className="space-y-0.5">
                {group.tools.map((t) => {
                  // When NOT configured, every checkbox shows "checked"
                  // as a visual hint of the default-allow state.
                  const checked = gating.configured
                    ? allowedSet.has(t.qualifiedName)
                    : true;
                  return (
                    <li
                      key={t.qualifiedName}
                      className="flex items-start gap-2 text-neutral-300"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(t.qualifiedName)}
                        className="mt-0.5 accent-emerald-500"
                      />
                      <div className="min-w-0 flex-1">
                        <code className="text-emerald-400 font-mono text-[11px]">
                          {t.toolName}
                        </code>
                        {t.description && (
                          <p className="text-[11px] text-neutral-500 truncate">
                            {t.description}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
