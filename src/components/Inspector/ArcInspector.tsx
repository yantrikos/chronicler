// Arcs tab — cross-session narrative arcs surfaced from clustered canon.
//
// Each arc card shows: title, derived status badge (active/paused/
// abandoned/resolved), entity chips, member count + most-recent member
// snippet, and per-arc actions (pin / mark resolved / archive / reset).
// Click any member rid to jump to it in the Memory tab.
//
// Phase 9 pillar 2. Companion: ThreadsInspector (continuity at the
// promise level), MemoryInspector (raw substrate), SkillInspector
// (character development).

import { useMemo, useState } from "react";
import type { Arc, ArcStatus } from "../../lib/arcs/types";
import type {
  ArcOverride,
  ArcOverrideStatus,
} from "../../lib/arcs/overrides";

interface Props {
  arcs: Arc[];
  overrides: Map<string, ArcOverride>;
  onAction: (id: string, status: ArcOverrideStatus) => void;
  onClearOverride: (id: string) => void;
  onJumpToMemory?: (rid: string) => void;
}

type Filter = "all" | "active" | "paused" | "abandoned" | "archived";

const statusStyle: Record<ArcStatus, string> = {
  active: "border-emerald-500/40 bg-emerald-500/5",
  paused: "border-amber-500/40 bg-amber-500/5",
  abandoned: "border-rose-500/40 bg-rose-500/5 opacity-70",
  resolved: "border-neutral-700 bg-neutral-900/50 opacity-70",
};

const statusPill: Record<ArcStatus, string> = {
  active: "bg-emerald-700/70 text-emerald-50",
  paused: "bg-amber-700/70 text-amber-50",
  abandoned: "bg-rose-700/70 text-rose-50",
  resolved: "bg-neutral-700 text-neutral-200",
};

const overridePill: Record<ArcOverrideStatus, string> = {
  pinned: "bg-violet-700/60 text-violet-100",
  resolved: "bg-emerald-700/60 text-emerald-100",
  archived: "bg-neutral-700 text-neutral-300",
};

export function ArcInspector({
  arcs,
  overrides,
  onAction,
  onClearOverride,
  onJumpToMemory,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  // Apply overrides: override status > derived status. Archived hides
  // the arc from default views (still in Archived filter).
  const resolved = useMemo(() => {
    return arcs.map((a) => {
      const o = overrides.get(a.id);
      if (!o) return a;
      if (o.status === "resolved") return { ...a, status: "resolved" as ArcStatus };
      if (o.status === "archived") return { ...a, status: "resolved" as ArcStatus };
      return a; // pinned doesn't change status, only sort order
    });
  }, [arcs, overrides]);

  const counts = useMemo(() => {
    const c = {
      total: resolved.length,
      active: 0,
      paused: 0,
      abandoned: 0,
      archived: 0,
    };
    for (const a of resolved) {
      const o = overrides.get(a.id);
      if (o?.status === "archived") {
        c.archived++;
        continue;
      }
      if (a.status === "active") c.active++;
      else if (a.status === "paused") c.paused++;
      else if (a.status === "abandoned") c.abandoned++;
    }
    return c;
  }, [resolved, overrides]);

  const visible = useMemo(() => {
    const hidden = (a: Arc) => overrides.get(a.id)?.status === "archived";
    const list = resolved.filter((a) => {
      if (filter === "archived") return hidden(a);
      if (hidden(a)) return false;
      if (filter === "all") return true;
      return a.status === filter;
    });
    // Pinned arcs always float to the top within the visible set.
    return list.sort((a, b) => {
      const ap = overrides.get(a.id)?.status === "pinned" ? 0 : 1;
      const bp = overrides.get(b.id)?.status === "pinned" ? 0 : 1;
      return ap - bp;
    });
  }, [resolved, filter, overrides]);

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Arcs</h2>
          {counts.abandoned > 0 && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-700/60 text-rose-50"
              title={`${counts.abandoned} arcs untouched for 14+ days`}
            >
              {counts.abandoned} abandoned
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-500 mt-0.5">
          Narrative threads clustered across sessions by who and when.
        </p>
      </header>

      <div className="px-3 py-2 border-b border-neutral-800 flex gap-1 text-xs flex-wrap">
        <Chip
          active={filter === "all"}
          label={`All ${counts.total - counts.archived}`}
          onClick={() => setFilter("all")}
        />
        <Chip
          active={filter === "active"}
          label={`Active ${counts.active}`}
          tone="active"
          onClick={() => setFilter("active")}
        />
        <Chip
          active={filter === "paused"}
          label={`Paused ${counts.paused}`}
          tone="paused"
          onClick={() => setFilter("paused")}
        />
        <Chip
          active={filter === "abandoned"}
          label={`Abandoned ${counts.abandoned}`}
          tone="abandoned"
          onClick={() => setFilter("abandoned")}
        />
        {counts.archived > 0 && (
          <Chip
            active={filter === "archived"}
            label={`Archived ${counts.archived}`}
            onClick={() => setFilter("archived")}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {visible.length === 0 && <EmptyState filter={filter} total={counts.total} />}
        {visible.map((a) => (
          <ArcCard
            key={a.id}
            arc={a}
            override={overrides.get(a.id)}
            onAction={onAction}
            onClearOverride={onClearOverride}
            onJumpToMemory={onJumpToMemory}
          />
        ))}
      </div>
    </div>
  );
}

function ArcCard({
  arc,
  override,
  onAction,
  onClearOverride,
  onJumpToMemory,
}: {
  arc: Arc;
  override: ArcOverride | undefined;
  onAction: (id: string, status: ArcOverrideStatus) => void;
  onClearOverride: (id: string) => void;
  onJumpToMemory?: (rid: string) => void;
}) {
  const pinned = override?.status === "pinned";
  const recent = arc.members[0];
  const moreCount = Math.max(0, arc.members.length - 1);
  return (
    <article
      className={`rounded-md border p-3 ${statusStyle[arc.status]} ${
        pinned ? "ring-1 ring-violet-500/60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${statusPill[arc.status]}`}
        >
          {arc.status}
        </span>
        {override && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${overridePill[override.status]}`}
          >
            {override.status}
          </span>
        )}
        <span className="text-[10px] text-neutral-500 font-mono ml-auto">
          {arc.members.length} memor{arc.members.length === 1 ? "y" : "ies"} · {shortDate(arc.last_touched_at)}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-neutral-100 mt-2 leading-snug">
        {arc.title}
      </h3>
      {recent && (
        <div className="mt-1.5 text-[12px] text-neutral-400 leading-snug">
          <span className="text-neutral-500 text-[10px] uppercase tracking-wider mr-1">
            recent:
          </span>
          <button
            onClick={() => recent.rid && onJumpToMemory?.(recent.rid)}
            disabled={!onJumpToMemory}
            className="hover:text-neutral-200 disabled:hover:text-neutral-400 text-left"
            title={onJumpToMemory ? `Jump to ${recent.rid}` : recent.rid}
          >
            {recent.text.slice(0, 140)}
            {recent.text.length > 140 ? "…" : ""}
          </button>
        </div>
      )}
      {moreCount > 0 && (
        <p className="text-[10px] text-neutral-600 mt-1 font-mono">
          + {moreCount} more memor{moreCount === 1 ? "y" : "ies"}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!pinned && (
          <button
            onClick={() => onAction(arc.id, "pinned")}
            className="text-[11px] px-2 py-0.5 rounded bg-violet-700/50 hover:bg-violet-700 text-violet-100"
            title="Keep this arc at the top of the list"
          >
            pin
          </button>
        )}
        {arc.status !== "resolved" && override?.status !== "resolved" && (
          <button
            onClick={() => onAction(arc.id, "resolved")}
            className="text-[11px] px-2 py-0.5 rounded bg-emerald-700/50 hover:bg-emerald-700 text-emerald-100"
            title="Mark this arc as resolved"
          >
            resolve
          </button>
        )}
        {override?.status !== "archived" && (
          <button
            onClick={() => onAction(arc.id, "archived")}
            className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-red-900 text-neutral-300 ml-auto"
            title="Archive this arc"
          >
            archive
          </button>
        )}
        {override && (
          <button
            onClick={() => onClearOverride(arc.id)}
            className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
            title="Undo this override"
          >
            reset
          </button>
        )}
      </div>
    </article>
  );
}

function EmptyState({ filter, total }: { filter: Filter; total: number }) {
  if (total === 0) {
    return (
      <p className="text-xs text-neutral-600 italic px-2 py-8 text-center leading-relaxed">
        No arcs yet. As canon accumulates around recurring characters,
        places, or conflicts, they'll cluster into arcs here. Active arcs
        feed into the session recap.
      </p>
    );
  }
  return (
    <p className="text-xs text-neutral-600 italic px-2 py-8 text-center">
      Nothing in "{filter}". Switch to "All" to see everything.
    </p>
  );
}

function Chip({
  active,
  label,
  tone,
  onClick,
}: {
  active: boolean;
  label: string;
  tone?: ArcStatus;
  onClick: () => void;
}) {
  const base = "px-2 py-0.5 rounded border text-[11px] transition-colors";
  const activeCls = tone
    ? statusPill[tone]
    : "bg-neutral-200 text-neutral-900 border-neutral-200";
  const idleCls = "border-neutral-800 text-neutral-400 hover:text-neutral-200";
  return (
    <button onClick={onClick} className={`${base} ${active ? activeCls : idleCls}`}>
      {label}
    </button>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffDays = Math.round(
    (Date.now() - d.getTime()) / (24 * 3600 * 1000)
  );
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1d ago";
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}
