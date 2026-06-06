interface Props {
  pluginId: string;
  characterId: string | null;
}

export function Panel({ pluginId, characterId }: Props) {
  return (
    <div className="h-full overflow-y-auto p-4 text-xs text-neutral-300">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-neutral-100 mb-0.5">
          {{PLUGIN_NAME}}
        </h2>
        <p className="text-[11px] text-neutral-500">
          Plugin <code className="text-emerald-400">{pluginId}</code>{" "}
          {characterId && (
            <>· active: <code className="text-neutral-200">{characterId}</code></>
          )}
        </p>
      </header>
      <p className="text-neutral-400 leading-relaxed">
        Edit <code>Panel.tsx</code> to make this panel useful.
      </p>
    </div>
  );
}
