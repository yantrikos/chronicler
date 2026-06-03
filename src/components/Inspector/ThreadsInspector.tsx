// Threads tab — Chronicler's user-facing surface for YantrikDB temporal
// continuity. Two sections in one tab:
//
//   - Open: events with approaching beats (temporal.upcoming).
//   - Stale: important memories that haven't surfaced in a while —
//     the "you promised X 3 sessions ago, never followed up" angle.
//     This is the differentiating screenshot.
//
// Each row shows the thread text, kind chip, source rid + last-seen
// timestamp (provenance), and per-row actions: dismiss, snooze (24h / 7d),
// resolve, pin. Overrides persist via threads/dismissals so they survive
// page reloads but never mutate the underlying memory.
//
// Phase 9: Interactive Memory. Companion: ThinkPanel (which surfaces
// maintenance triggers + conflicts — different mental model, separate UI).

import { useMemo, useState } from "react";
import type { Thread, ThreadKind } from "../../lib/threads/types";
import type {
  ThreadOverride,
  ThreadStatus,
} from "../../lib/threads/dismissals";

interface Props {
  threads: Thread[];
  overrides: Map<string, ThreadOverride>;
  /** Total threads BEFORE filtering by overrides — for the header chip
   *  that shows "N hidden by your overrides." */
  totalBeforeFilter: number;
  onAction: (id: string, status: ThreadStatus, untilIso?: string) => void;
  onClearOverride: (id: string) => void;
  onJumpToMemory?: (rid: string) => void;
}

type Filter = "all" | "open" | "stale" | "hidden";

const kindStyle: Record<ThreadKind, string> = {
  upcoming: "border-sky-500/40 bg-sky-500/5",
  stale: "border-rose-500/40 bg-rose-500/5",
};

const kindPill: Record<ThreadKind, string> = {
  upcoming: "bg-sky-700/70 text-sky-100",
  stale: "bg-rose-700/70 text-rose-100",
};

const statusPill: Record<ThreadStatus, string> = {
  dismissed: "bg-neutral-700 text-neutral-300",
  snoozed: "bg-amber-700/60 text-amber-100",
  resolved: "bg-emerald-700/60 text-emerald-100",
  pinned: "bg-violet-700/60 text-violet-100",
};

export function ThreadsInspector({
  threads,
  overrides,
  totalBeforeFilter,
  onAction,
  onClearOverride,
  onJumpToMemory,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c = { open: 0, stale: 0, hidden: 0, pinned: 0 };
    for (const t of threads) {
      if (t.kind === "upcoming") c.open++;
      if (t.kind === "stale") c.stale++;
      const o = overrides.get(t.id);
      if (o?.status === "pinned") c.pinned++;
    }
    c.hidden = totalBeforeFilter - threads.length;
    return c;
  }, [threads, totalBeforeFilter, overrides]);

  const filtered = useMemo(() => {
    if (filter === "all") return threads;
    if (filter === "open") return threads.filter((t) => t.kind === "upcoming");
    if (filter === "stale") return threads.filter((t) => t.kind === "stale");
    // "hidden" tab: invert — show the threads currently overridden so the
    // user can undo. Caller passes already-filtered threads, so for this
    // view we lean on overrides directly.
    return [];
  }, [filter, threads]);

  return (
    <div className="flex h-full flex-col">
      <header className="px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">
            Open threads
          </h2>
          {counts.stale > 0 && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-700/60 text-rose-50"
              title={`${counts.stale} stale thread${counts.stale === 1 ? "" : "s"} need attention`}
            >
              {counts.stale} stale
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-500 mt-0.5">
          Promises, scene hooks, and dropped threads grounded in canon.
        </p>
      </header>

      <div className="px-3 py-2 border-b border-neutral-800 flex gap-1 text-xs flex-wrap">
        <Chip
          active={filter === "all"}
          label={`All ${threads.length}`}
          onClick={() => setFilter("all")}
        />
        <Chip
          active={filter === "open"}
          label={`Open ${counts.open}`}
          tone="upcoming"
          onClick={() => setFilter("open")}
        />
        <Chip
          active={filter === "stale"}
          label={`Stale ${counts.stale}`}
          tone="stale"
          onClick={() => setFilter("stale")}
        />
        {counts.hidden > 0 && (
          <Chip
            active={filter === "hidden"}
            label={`Hidden ${counts.hidden}`}
            onClick={() => setFilter("hidden")}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filter === "hidden" && (
          <HiddenThreadsView
            overrides={overrides}
            onClearOverride={onClearOverride}
          />
        )}
        {filter !== "hidden" && filtered.length === 0 && (
          <EmptyState totalBeforeFilter={totalBeforeFilter} />
        )}
        {filter !== "hidden" &&
          filtered.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              override={overrides.get(t.id)}
              onAction={onAction}
              onClearOverride={onClearOverride}
              onJumpToMemory={onJumpToMemory}
            />
          ))}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  override,
  onAction,
  onClearOverride,
  onJumpToMemory,
}: {
  thread: Thread;
  override: ThreadOverride | undefined;
  onAction: (id: string, status: ThreadStatus, untilIso?: string) => void;
  onClearOverride: (id: string) => void;
  onJumpToMemory?: (rid: string) => void;
}) {
  const pinned = override?.status === "pinned";
  return (
    <article
      className={`rounded-md border p-3 ${kindStyle[thread.kind]} ${
        pinned ? "ring-1 ring-violet-500/60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${kindPill[thread.kind]}`}
        >
          {thread.kind === "upcoming" ? "scene hook" : "stale"}
        </span>
        {override && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${statusPill[override.status]}`}
          >
            {override.status}
            {override.status === "snoozed" && override.until
              ? ` · ${shortDate(override.until)}`
              : ""}
          </span>
        )}
        {thread.importance !== undefined && (
          <span className="text-[10px] text-neutral-500 font-mono ml-auto">
            i={thread.importance.toFixed(2)}
          </span>
        )}
      </div>
      <p className="text-sm mt-2 text-neutral-200 leading-snug">{thread.text}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-neutral-500 font-mono">
        {thread.rid && (
          <button
            onClick={() => thread.rid && onJumpToMemory?.(thread.rid)}
            disabled={!onJumpToMemory}
            className="hover:text-neutral-300 disabled:hover:text-neutral-500"
            title={onJumpToMemory ? "Jump to source memory" : thread.rid}
          >
            {thread.rid.slice(0, 14)}…
          </button>
        )}
        {thread.last_seen_at && (
          <span title={thread.last_seen_at}>
            last seen {shortDate(thread.last_seen_at)}
          </span>
        )}
        {thread.entities &&
          thread.entities.length > 0 &&
          thread.entities.map((e) => (
            <span
              key={e}
              className="px-1 py-0 rounded bg-neutral-800/60 text-neutral-400"
            >
              {e}
            </span>
          ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!pinned && (
          <button
            onClick={() => onAction(thread.id, "pinned")}
            className="text-[11px] px-2 py-0.5 rounded bg-violet-700/50 hover:bg-violet-700 text-violet-100"
            title="Keep this thread visible until you resolve or dismiss it"
          >
            pin
          </button>
        )}
        {override?.status !== "resolved" && (
          <button
            onClick={() => onAction(thread.id, "resolved")}
            className="text-[11px] px-2 py-0.5 rounded bg-emerald-700/50 hover:bg-emerald-700 text-emerald-100"
            title="Mark this thread as resolved — hides it from the list"
          >
            resolve
          </button>
        )}
        {override?.status !== "snoozed" && (
          <>
            <button
              onClick={() =>
                onAction(
                  thread.id,
                  "snoozed",
                  new Date(Date.now() + 24 * 3600 * 1000).toISOString()
                )
              }
              className="text-[11px] px-2 py-0.5 rounded bg-amber-700/40 hover:bg-amber-700 text-amber-100"
              title="Hide until tomorrow"
            >
              snooze 24h
            </button>
            <button
              onClick={() =>
                onAction(
                  thread.id,
                  "snoozed",
                  new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
                )
              }
              className="text-[11px] px-2 py-0.5 rounded bg-amber-700/40 hover:bg-amber-700 text-amber-100"
              title="Hide for a week"
            >
              7d
            </button>
          </>
        )}
        {override?.status !== "dismissed" && (
          <button
            onClick={() => onAction(thread.id, "dismissed")}
            className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-red-900 text-neutral-300 ml-auto"
            title="Hide this thread permanently"
          >
            dismiss
          </button>
        )}
        {override && (
          <button
            onClick={() => onClearOverride(thread.id)}
            className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
            title="Undo your override and let the engine decide"
          >
            reset
          </button>
        )}
      </div>
    </article>
  );
}

function HiddenThreadsView({
  overrides,
  onClearOverride,
}: {
  overrides: Map<string, ThreadOverride>;
  onClearOverride: (id: string) => void;
}) {
  const entries = [...overrides.entries()].filter(
    ([, o]) =>
      o.status === "dismissed" ||
      o.status === "resolved" ||
      o.status === "snoozed"
  );
  if (entries.length === 0) {
    return (
      <p className="text-xs text-neutral-600 italic px-2 py-8 text-center">
        No hidden threads. Dismiss / resolve / snooze from the list to hide
        items here.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {entries.map(([id, o]) => (
        <div
          key={id}
          className="flex items-center justify-between gap-2 rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-[12px]"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${statusPill[o.status]}`}
              >
                {o.status}
              </span>
              <span className="font-mono text-neutral-500 text-[10px] truncate">
                {id}
              </span>
            </div>
            {o.status === "snoozed" && o.until && (
              <p className="text-[10px] text-neutral-500 mt-0.5">
                until {shortDate(o.until)}
              </p>
            )}
          </div>
          <button
            onClick={() => onClearOverride(id)}
            className="text-[11px] text-neutral-400 hover:text-emerald-300 px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700"
            title="Show this thread again"
          >
            restore
          </button>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ totalBeforeFilter }: { totalBeforeFilter: number }) {
  if (totalBeforeFilter === 0) {
    return (
      <p className="text-xs text-neutral-600 italic px-2 py-8 text-center leading-relaxed">
        No open threads yet. As the scene accumulates promises, planned
        events, or important moments, they'll surface here. Stale items
        appear when something important hasn't been touched in a while.
      </p>
    );
  }
  return (
    <p className="text-xs text-neutral-600 italic px-2 py-8 text-center">
      Nothing in this filter. Switch to "All" to see everything.
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
  tone?: ThreadKind;
  onClick: () => void;
}) {
  const base = "px-2 py-0.5 rounded border text-[11px] transition-colors";
  const activeCls = tone
    ? kindPill[tone]
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
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.round(diffMs / (24 * 3600 * 1000));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays === -1) return "tomorrow";
  if (diffDays > 0 && diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 0 && diffDays > -30) return `in ${-diffDays}d`;
  return d.toLocaleDateString();
}
