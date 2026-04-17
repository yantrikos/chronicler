import type { SessionMeta } from "../../lib/session/store";

interface Props {
  sessions: SessionMeta[];
  activeId?: string;
  characterAvatars?: Record<string, string>;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onExport?: (id: string) => void;
}

export function SessionList({
  sessions,
  activeId,
  characterAvatars = {},
  onSelect,
  onNew,
  onDelete,
  onRename,
  onExport,
}: Props) {
  return (
    <div className="border-b border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between px-4 py-2">
        <h3 className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">
          Sessions
        </h3>
        <button
          onClick={onNew}
          title="Start a new chat with the current character"
          className="text-[11px] rounded bg-emerald-700/70 hover:bg-emerald-600 text-white px-2 py-0.5"
        >
          + new
        </button>
      </div>
      <div className="max-h-[280px] overflow-y-auto">
        {sessions.length === 0 && (
          <p className="text-[11px] text-neutral-600 italic px-4 py-3">
            No prior sessions yet.
          </p>
        )}
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeId}
            avatarUrl={characterAvatars[s.character_ids[0]]}
            onSelect={() => onSelect(s.id)}
            onDelete={onDelete ? () => onDelete(s.id) : undefined}
            onRename={
              onRename
                ? (t) => onRename(s.id, t)
                : undefined
            }
            onExport={onExport ? () => onExport(s.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function SessionRow({
  session,
  active,
  avatarUrl,
  onSelect,
  onDelete,
  onRename,
  onExport,
}: {
  session: SessionMeta;
  active: boolean;
  avatarUrl?: string;
  onSelect: () => void;
  onDelete?: () => void;
  onRename?: (title: string) => void;
  onExport?: () => void;
}) {
  return (
    <div
      className={`group px-4 py-2 cursor-pointer border-l-2 ${
        active
          ? "bg-neutral-900 border-emerald-500"
          : "border-transparent hover:bg-neutral-900/60"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start gap-2">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="w-7 h-7 rounded-full object-cover flex-shrink-0 mt-0.5"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-neutral-800 text-[10px] flex items-center justify-center text-neutral-400 flex-shrink-0 mt-0.5">
            {session.title.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-neutral-100 truncate">
              {session.title}
            </p>
            <span className="text-[10px] text-neutral-600 font-mono flex-shrink-0 ml-1">
              {session.turn_count}
            </span>
          </div>
          <p className="text-[11px] text-neutral-500 truncate mt-0.5">
            {session.preview}
          </p>
        </div>
        {(onRename || onDelete || onExport) && (
          <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 flex-shrink-0">
            {onExport && (
              <button
                title="export as markdown"
                onClick={(e) => {
                  e.stopPropagation();
                  onExport();
                }}
                className="w-5 h-5 text-[10px] text-neutral-500 hover:text-neutral-200"
              >
                ↓
              </button>
            )}
            {onRename && (
              <button
                title="rename"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = prompt("Rename session:", session.title);
                  if (next && next.trim()) onRename(next.trim());
                }}
                className="w-5 h-5 text-[10px] text-neutral-500 hover:text-neutral-200"
              >
                ✎
              </button>
            )}
            {onDelete && (
              <button
                title="delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete session "${session.title}"?`)) onDelete();
                }}
                className="w-5 h-5 text-[10px] text-neutral-500 hover:text-red-400"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
