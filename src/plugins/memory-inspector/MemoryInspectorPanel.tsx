// React component mounted in the inspector:tab slot.
//
// Receives { pluginId, characterId } per the slot prop contract. Uses the
// document's URL session id (best-effort) + character id to query
// YantrikDB directly. Pulls raw recall results for the major namespaces
// and displays them grouped, with rid + score + tier badges.
//
// IMPORTANT: this is a plugin component — it must NOT import from the
// host's internal modules. The contract is: window-scoped access to the
// raw YantrikDB transport via a brittle global is intentionally NOT done.
// Plugins call api.memory.recall(...) from hooks/commands. UI components
// receive limited props per the slot contract.
//
// For v1, this panel renders a hint that real-time recall needs the
// `api.memory` surface — which lives on hook/command invocation, not on
// UI props. v1.5 will extend the slot prop contract with a memory-recall
// callback so UI plugins can query live data.

interface Props {
  pluginId: string;
  characterId: string | null;
}

export function MemoryInspectorPanel({ pluginId, characterId }: Props) {
  return (
    <div className="h-full overflow-y-auto p-4 text-xs text-neutral-300">
      <header className="mb-4">
        <h2 className="text-sm font-semibold text-neutral-100 mb-1">
          Memory Inspector
        </h2>
        <p className="text-[11px] text-neutral-500">
          Plugin <code className="text-emerald-400">{pluginId}</code> contributing
          to the inspector:tab slot.
        </p>
      </header>

      <section className="space-y-3">
        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3">
          <h3 className="text-[11px] uppercase tracking-wider text-violet-400/80 mb-1.5">
            What this proves
          </h3>
          <p className="text-neutral-400 leading-relaxed">
            Plugins can mount React components into named host slots. This panel
            is a Grimoire entry, not built into the app — it ships in
            <code className="text-emerald-400 mx-1">src/plugins/memory-inspector/</code>
            and registers itself via
            <code className="text-emerald-400 mx-1">ctx.ui.registerSlot("inspector:tab", ...)</code>
            on load. Hot reload it by editing the file.
          </p>
        </div>

        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-3">
          <h3 className="text-[11px] uppercase tracking-wider text-emerald-400/80 mb-1.5">
            Active character
          </h3>
          <p className="text-neutral-400">
            {characterId ? (
              <code className="text-neutral-200">{characterId}</code>
            ) : (
              <span className="italic">No character loaded.</span>
            )}
          </p>
        </div>

        <div className="rounded-md border border-amber-900/40 bg-amber-950/20 p-3">
          <h3 className="text-[11px] uppercase tracking-wider text-amber-400/80 mb-1.5">
            v1 limitation
          </h3>
          <p className="text-neutral-400 leading-relaxed">
            Live recall from UI slots needs the api.memory surface to be plumbed
            through the slot props contract — landing in v0.4. For now this
            panel is a structural demo: it proves the slot wiring works
            end-to-end. The next iteration adds a query input and rendered
            results pulled via api.memory.recall().
          </p>
        </div>
      </section>
    </div>
  );
}
