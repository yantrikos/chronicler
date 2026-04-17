// The think panel — surfaces YantrikDB's think-loop output: urges/triggers,
// conflicts, and consolidation signals. These drive proactive communication
// and give the user a live view of what the character is "thinking about
// between turns."

export interface ThinkTrigger {
  id: string;
  trigger_type: string;
  urgency: number;
  reason: string;
  suggested_action?: string;
  source_rids?: string[];
}

export interface ThinkConflict {
  id: string;
  conflict_type: string;
  priority: string;
  entity?: string;
  detection_reason?: string;
  a?: { rid: string; text: string };
  b?: { rid: string; text: string };
}

interface Props {
  characterName?: string;
  triggers: ThinkTrigger[];
  conflicts: ThinkConflict[];
  onActTrigger?: (id: string) => void;
  onDismissTrigger?: (id: string) => void;
  onResolveConflict?: (
    id: string,
    strategy: "keep_a" | "keep_b" | "merge" | "dismiss"
  ) => void;
  onRunThink?: () => void;
  isThinking?: boolean;
}

export function ThinkPanel({
  characterName,
  triggers,
  conflicts,
  onActTrigger,
  onDismissTrigger,
  onResolveConflict,
  onRunThink,
  isThinking,
}: Props) {
  const hasAnything = triggers.length > 0 || conflicts.length > 0;
  return (
    <div className="border-b border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between px-4 py-2">
        <h3 className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">
          {characterName ? `${characterName} — thinking` : "Thinking"}
        </h3>
        {onRunThink && (
          <button
            onClick={onRunThink}
            disabled={isThinking}
            className="text-[11px] rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 px-2 py-0.5"
            title="Run think() — consolidates memories, detects conflicts, generates urges"
          >
            {isThinking ? "…" : "think"}
          </button>
        )}
      </div>

      {!hasAnything && (
        <p className="text-[11px] text-neutral-600 italic px-4 pb-3">
          No pending urges or conflicts. Hit think to consolidate.
        </p>
      )}

      {triggers.length > 0 && (
        <section className="px-4 py-2 border-t border-neutral-900">
          <p className="text-[10px] uppercase tracking-wider text-amber-500/80 mb-1.5 font-semibold">
            urges ({triggers.length})
          </p>
          <ul className="space-y-1.5">
            {triggers.slice(0, 5).map((t) => (
              <li
                key={t.id}
                className="group rounded border border-amber-900/40 bg-amber-900/10 p-2 text-xs"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono flex-shrink-0 ${triggerBadge(
                      t.trigger_type
                    )}`}
                  >
                    {t.trigger_type}
                  </span>
                  <span className="text-[10px] text-neutral-500 font-mono ml-auto flex-shrink-0">
                    u={t.urgency.toFixed(2)}
                  </span>
                </div>
                <div className="text-neutral-200 leading-snug mt-1">
                  {t.reason || "(no reason given)"}
                </div>
                {t.suggested_action && (
                  <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                    suggest: {t.suggested_action}
                  </div>
                )}
                <div className="opacity-0 group-hover:opacity-100 flex gap-1 mt-1.5">
                  {onActTrigger && (
                    <button
                      onClick={() => onActTrigger(t.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-700/60 hover:bg-emerald-700 text-emerald-50"
                      title={
                        t.trigger_type === "redundancy"
                          ? "Apply the suggested action (consolidate / forget)"
                          : "Have the character act on this now"
                      }
                    >
                      act
                    </button>
                  )}
                  {onDismissTrigger && (
                    <button
                      onClick={() => onDismissTrigger(t.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                    >
                      dismiss
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {triggers.length > 5 && (
            <p className="text-[10px] text-neutral-600 mt-1">
              +{triggers.length - 5} more
            </p>
          )}
        </section>
      )}

      {conflicts.length > 0 && (
        <section className="px-4 py-2 border-t border-neutral-900">
          <p className="text-[10px] uppercase tracking-wider text-red-500/80 mb-1.5 font-semibold">
            conflicts ({conflicts.length})
          </p>
          <ul className="space-y-1.5">
            {conflicts.slice(0, 3).map((c) => (
              <li
                key={c.id}
                className="rounded border border-red-900/40 bg-red-900/10 p-2 text-xs"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] uppercase tracking-wider font-mono text-red-300/80">
                    {c.conflict_type}
                  </span>
                  {c.entity && (
                    <span className="text-[9px] text-neutral-500 font-mono">
                      entity={c.entity}
                    </span>
                  )}
                  <span className="text-[9px] text-neutral-500 font-mono ml-auto">
                    {c.priority}
                  </span>
                </div>
                <div className="space-y-1.5 text-[11px] text-neutral-300">
                  <div className="border-l-2 border-red-600/60 pl-2">
                    <span className="text-[9px] text-neutral-500 font-mono mr-1.5">
                      A
                    </span>
                    {c.a?.text ?? "(memory not found)"}
                  </div>
                  <div className="border-l-2 border-red-400/60 pl-2">
                    <span className="text-[9px] text-neutral-500 font-mono mr-1.5">
                      B
                    </span>
                    {c.b?.text ?? "(memory not found)"}
                  </div>
                </div>
                {c.detection_reason && (
                  <div className="text-[9px] text-neutral-600 mt-1 font-mono">
                    {c.detection_reason}
                  </div>
                )}
                {onResolveConflict && (
                  <div className="flex gap-1 mt-1.5">
                    <button
                      onClick={() => onResolveConflict(c.id, "keep_a")}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                    >
                      keep A
                    </button>
                    <button
                      onClick={() => onResolveConflict(c.id, "keep_b")}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                    >
                      keep B
                    </button>
                    <button
                      onClick={() => onResolveConflict(c.id, "merge")}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                    >
                      merge
                    </button>
                    <button
                      onClick={() => onResolveConflict(c.id, "dismiss")}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-red-900/60 text-neutral-300 ml-auto"
                    >
                      dismiss
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {conflicts.length > 3 && (
            <p className="text-[10px] text-neutral-600 mt-1">
              +{conflicts.length - 3} more conflicts
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function triggerBadge(kind: string): string {
  switch (kind) {
    case "redundancy":
      return "bg-sky-800/50 text-sky-200";
    case "curiosity":
    case "unresolved":
      return "bg-emerald-800/50 text-emerald-200";
    case "contradiction":
      return "bg-red-800/50 text-red-200";
    default:
      return "bg-neutral-800 text-neutral-300";
  }
}
