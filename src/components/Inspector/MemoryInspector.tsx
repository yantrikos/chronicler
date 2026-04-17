import { useMemo, useState } from "react";
import type { CanonicalStatus, Tier } from "../../lib/yantrikdb/types";

export interface InspectorMemory {
  rid: string;
  text: string;
  tier: Tier;
  canonical_status?: CanonicalStatus;
  certainty: number;
  importance: number;
  source: string;
  created_at?: string;
  namespace?: string;
  source_turn_id?: string;
}

interface Props {
  memories: InspectorMemory[];
  pendingConflicts?: number;
  onPromote?: (rid: string) => void;
  onDemote?: (rid: string) => void;
  onForget?: (rid: string) => void;
  onRetcon?: (rid: string, status: CanonicalStatus) => void;
}

const tierStyle: Record<Tier, string> = {
  canon: "border-emerald-500/40 bg-emerald-500/5",
  heuristic: "border-amber-500/40 bg-amber-500/5",
  reflex: "border-slate-500/40 bg-slate-500/5",
};

const tierPill: Record<Tier, string> = {
  canon: "bg-emerald-600 text-emerald-50",
  heuristic: "bg-amber-600 text-amber-50",
  reflex: "bg-slate-600 text-slate-50",
};

export function MemoryInspector({
  memories,
  pendingConflicts = 0,
  onPromote,
  onDemote,
  onForget,
  onRetcon,
}: Props) {
  const [filter, setFilter] = useState<"all" | Tier>("all");
  const [retconMenuRid, setRetconMenuRid] = useState<string | null>(null);
  const filtered = useMemo(
    () => memories.filter((m) => filter === "all" || m.tier === filter),
    [memories, filter]
  );

  const counts = useMemo(
    () => ({
      canon: memories.filter((m) => m.tier === "canon").length,
      heuristic: memories.filter((m) => m.tier === "heuristic").length,
      reflex: memories.filter((m) => m.tier === "reflex").length,
    }),
    [memories]
  );

  return (
    <aside className="flex h-full flex-col bg-neutral-950 border-l border-neutral-800">
      <header className="px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Memory</h2>
          {pendingConflicts > 0 && (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full bg-amber-600/80 text-amber-50 font-mono"
              title={`${pendingConflicts} pending canon conflicts`}
            >
              {pendingConflicts} conflict{pendingConflicts > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-500 mt-0.5">
          What Chronicler thinks is true
        </p>
      </header>

      <div className="px-3 py-2 border-b border-neutral-800 flex gap-1 text-xs">
        <TierChip
          active={filter === "all"}
          label={`All ${memories.length}`}
          onClick={() => setFilter("all")}
        />
        <TierChip
          active={filter === "canon"}
          label={`Canon ${counts.canon}`}
          tone="canon"
          onClick={() => setFilter("canon")}
        />
        <TierChip
          active={filter === "heuristic"}
          label={`Drafts ${counts.heuristic}`}
          tone="heuristic"
          onClick={() => setFilter("heuristic")}
        />
        <TierChip
          active={filter === "reflex"}
          label={`Scene ${counts.reflex}`}
          tone="reflex"
          onClick={() => setFilter("reflex")}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filtered.length === 0 && (
          <p className="text-xs text-neutral-600 italic px-2 py-8 text-center">
            Nothing here yet. Chat with a character and memories will show up.
          </p>
        )}
        {filtered.map((m) => (
          <article
            key={m.rid}
            className={`rounded-md border p-3 ${tierStyle[m.tier]}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${tierPill[m.tier]}`}
              >
                {m.tier}
              </span>
              <span className="text-[10px] text-neutral-500 font-mono">
                c={m.certainty.toFixed(2)} i={m.importance.toFixed(2)}
              </span>
            </div>
            <p className="text-sm mt-2 text-neutral-200 leading-snug">
              {m.canonical_status && m.canonical_status !== "canon" && (
                <span className="text-[10px] uppercase tracking-wider text-amber-400 mr-1">
                  [{m.canonical_status}]
                </span>
              )}
              {m.text}
            </p>
            <div className="mt-2 flex gap-1.5 items-center">
              {m.tier !== "canon" && onPromote && (
                <button
                  className="text-[11px] px-2 py-0.5 rounded bg-emerald-700/60 hover:bg-emerald-700 text-emerald-50"
                  onClick={() => onPromote(m.rid)}
                  title="Pin to canon"
                >
                  pin
                </button>
              )}
              {m.tier === "canon" && onDemote && (
                <button
                  className="text-[11px] px-2 py-0.5 rounded bg-amber-700/60 hover:bg-amber-700 text-amber-50"
                  onClick={() => onDemote(m.rid)}
                  title="Demote to draft"
                >
                  demote
                </button>
              )}
              {onRetcon && (
                <div className="relative">
                  <button
                    className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                    onClick={() =>
                      setRetconMenuRid(retconMenuRid === m.rid ? null : m.rid)
                    }
                  >
                    retcon…
                  </button>
                  {retconMenuRid === m.rid && (
                    <div className="absolute z-10 mt-1 right-0 bg-neutral-900 border border-neutral-700 rounded shadow-xl min-w-[140px]">
                      {(
                        [
                          "dream",
                          "alternate-timeline",
                          "non-canon",
                          "deleted-scene",
                        ] as CanonicalStatus[]
                      ).map((status) => (
                        <button
                          key={status}
                          className="block w-full text-left text-[11px] px-3 py-1.5 hover:bg-neutral-800 text-neutral-300"
                          onClick={() => {
                            onRetcon(m.rid, status);
                            setRetconMenuRid(null);
                          }}
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {onForget && (
                <button
                  className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-red-900 text-neutral-300 ml-auto"
                  onClick={() => onForget(m.rid)}
                >
                  forget
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

function TierChip({
  active,
  label,
  tone,
  onClick,
}: {
  active: boolean;
  label: string;
  tone?: Tier;
  onClick: () => void;
}) {
  const base = "px-2 py-0.5 rounded border text-[11px] transition-colors";
  const activeCls = tone
    ? tierPill[tone]
    : "bg-neutral-200 text-neutral-900 border-neutral-200";
  const idleCls = "border-neutral-800 text-neutral-400 hover:text-neutral-200";
  return (
    <button onClick={onClick} className={`${base} ${active ? activeCls : idleCls}`}>
      {label}
    </button>
  );
}
