// In-app lorebook editor — view + add + edit + delete entries for a
// character's lorebook (namespace = lorebook:<character_id>). Supports the
// full v2/v3 character_book trigger semantics: keys / secondary_keys /
// selective / constant / position / insertion_order / case_sensitive /
// enabled. Saga task #32.
//
// On save:
//   - existing entries patched via memory.update_metadata
//   - new entries created via client.remember with lorebook_entry metadata
//   - deleted entries tombstoned via client.forget

import { useEffect, useState } from "react";
import type { YantrikClient, RememberInput } from "../../lib/yantrikdb/client";
import { rememberAsCanon } from "../../lib/yantrikdb/client";
import type { LorebookEntryMeta } from "../../lib/yantrikdb/types";

interface EntryRow {
  /** Existing entry has rid; new entries have rid=null until first save. */
  rid: string | null;
  /** Tracks unsaved local edits. */
  dirty: boolean;
  /** Marked for deletion at next save. */
  deleted: boolean;
  text: string;
  meta: LorebookEntryMeta;
}

interface Props {
  characterId: string;
  characterName: string;
  worldId?: string;
  client: YantrikClient;
  onClose: () => void;
}

export function LorebookEditor({
  characterId,
  characterName,
  worldId,
  client,
  onClose,
}: Props) {
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  async function load() {
    setLoading(true);
    try {
      const ns = `lorebook:${characterId}`;
      const list = await client.listMemoriesInNamespace(ns, 500);
      // memory.list returns lightweight summaries; fetch full metadata via
      // memory.get for each so we get the lorebook_entry field.
      const records = await Promise.all(
        list.map((m) => client.getMemory((m as { rid: string }).rid).catch(() => null))
      );
      const built: EntryRow[] = [];
      for (const r of records) {
        if (!r) continue;
        const meta = r.metadata?.lorebook_entry as LorebookEntryMeta | undefined;
        if (!meta) continue;
        built.push({
          rid: r.rid,
          dirty: false,
          deleted: false,
          text: r.text,
          meta: { ...meta },
        });
      }
      built.sort((a, b) => a.meta.insertion_order - b.meta.insertion_order);
      setRows(built);
    } finally {
      setLoading(false);
    }
  }

  function patchRow(idx: number, patch: Partial<EntryRow>) {
    setRows((rs) =>
      rs.map((r, i) =>
        i === idx ? { ...r, ...patch, dirty: true } : r
      )
    );
  }

  function patchMeta(idx: number, patch: Partial<LorebookEntryMeta>) {
    setRows((rs) =>
      rs.map((r, i) =>
        i === idx ? { ...r, dirty: true, meta: { ...r.meta, ...patch } } : r
      )
    );
  }

  function addEntry() {
    const blank: EntryRow = {
      rid: null,
      dirty: true,
      deleted: false,
      text: "",
      meta: {
        keys: [],
        secondary_keys: [],
        selective: false,
        constant: false,
        position: "after_char",
        insertion_order: 100,
        case_sensitive: false,
        enabled: true,
        name: "",
      },
    };
    setRows((rs) => [...rs, blank]);
  }

  async function commit() {
    setSaving(true);
    try {
      const ns = `lorebook:${characterId}`;
      // 1. Delete tombstoned rows
      for (const r of rows) {
        if (r.deleted && r.rid) {
          await client.forget(r.rid).catch(() => undefined);
        }
      }
      // 2. Update existing dirty rows
      for (const r of rows) {
        if (r.deleted || !r.dirty || !r.rid) continue;
        await (client as unknown as {
          transport: {
            call: (
              t: string,
              a: Record<string, unknown>
            ) => Promise<unknown>;
          };
        }).transport
          .call("memory", {
            action: "update_metadata",
            rid: r.rid,
            metadata_patch: { lorebook_entry: r.meta },
          })
          .catch(() => undefined);
        // Also update the text via the correct tool
        await client.correct(r.rid, r.text).catch(() => undefined);
      }
      // 3. Create new rows
      const newRows = rows.filter(
        (r) => !r.deleted && r.dirty && !r.rid && r.text.trim().length > 0
      );
      if (newRows.length > 0) {
        const inputs: RememberInput[] = newRows.map((r) => {
          const base = rememberAsCanon(r.text, "lorebook-edit", {
            character_id: characterId,
            world_id: worldId,
            visible_to: ["*"],
            lorebook_entry: r.meta,
          });
          return { ...base, namespace: ns };
        });
        await client.rememberBatch(inputs).catch(() => undefined);
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  const visibleRows = rows.filter((r) => !r.deleted);
  const dirtyCount = rows.filter((r) => r.dirty || r.deleted).length;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-lg w-[820px] max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-neutral-100">
              {characterName} — Lorebook
            </h2>
            <p className="text-[11px] text-neutral-500 mt-0.5 font-mono">
              namespace=lorebook:{characterId} · {visibleRows.length} entr
              {visibleRows.length === 1 ? "y" : "ies"}
              {dirtyCount > 0 && (
                <span className="ml-2 text-amber-400">
                  ({dirtyCount} unsaved)
                </span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-100 text-sm"
          >
            close
          </button>
        </header>

        <section className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="text-xs text-neutral-500 italic px-2 py-8 text-center">
              loading entries…
            </p>
          ) : visibleRows.length === 0 ? (
            <div className="px-2 py-12 text-center">
              <p className="text-sm text-neutral-400">
                No lorebook entries yet for {characterName}.
              </p>
              <p className="text-[11px] text-neutral-600 mt-2">
                Add facts, world rules, or backstory the character should reference when triggers match.
              </p>
              <button
                onClick={addEntry}
                className="mt-4 rounded bg-emerald-700/80 hover:bg-emerald-600 text-white text-xs px-3 py-1.5 font-medium"
              >
                + new entry
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map(
                (r, idx) =>
                  !r.deleted && (
                    <Row
                      key={r.rid ?? `new-${idx}`}
                      row={r}
                      onPatch={(patch) => patchRow(idx, patch)}
                      onPatchMeta={(patch) => patchMeta(idx, patch)}
                      onDelete={() =>
                        patchRow(idx, { deleted: true, dirty: true })
                      }
                    />
                  )
              )}
            </ul>
          )}
        </section>

        <footer className="px-5 py-3 border-t border-neutral-800 flex items-center justify-between">
          <button
            onClick={addEntry}
            className="text-xs rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-2.5 py-1"
          >
            + new entry
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 rounded"
            >
              {dirtyCount > 0 ? "discard" : "close"}
            </button>
            <button
              onClick={commit}
              disabled={saving || dirtyCount === 0}
              className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white rounded"
            >
              {saving ? "saving…" : `save ${dirtyCount || ""}`.trim()}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Row({
  row,
  onPatch,
  onPatchMeta,
  onDelete,
}: {
  row: EntryRow;
  onPatch: (patch: Partial<EntryRow>) => void;
  onPatchMeta: (patch: Partial<LorebookEntryMeta>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(!row.rid); // new entries open by default
  return (
    <li
      className={`rounded border p-3 ${
        row.dirty
          ? "border-amber-700/40 bg-amber-950/10"
          : "border-neutral-800 bg-neutral-950"
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-neutral-500 hover:text-neutral-200 text-xs font-mono"
          title={expanded ? "collapse" : "expand"}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <input
              value={row.meta.name ?? ""}
              onChange={(e) => onPatchMeta({ name: e.currentTarget.value })}
              placeholder="(unnamed entry)"
              className="text-sm font-medium text-neutral-100 bg-transparent border-b border-transparent hover:border-neutral-700 focus:border-neutral-500 focus:outline-none px-0"
            />
            <span className="text-[10px] text-neutral-600 font-mono">
              {row.meta.position} · order {row.meta.insertion_order}
              {row.meta.constant && " · const"}
              {row.meta.selective && " · selective"}
              {!row.meta.enabled && " · disabled"}
            </span>
          </div>
          <p className="text-[11px] text-neutral-500 truncate mt-0.5">
            keys: {row.meta.keys.join(", ") || "(none — won't fire unless constant)"}
          </p>
        </div>
        <button
          onClick={onDelete}
          className="text-[10px] text-neutral-500 hover:text-red-400 px-1"
          title="delete entry"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pl-5 space-y-2">
          <textarea
            value={row.text}
            onChange={(e) => onPatch({ text: e.currentTarget.value })}
            placeholder="entry content — what gets injected when triggered"
            rows={3}
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm text-neutral-100 resize-y focus:outline-none focus:border-neutral-600"
          />
          <div className="grid grid-cols-2 gap-2">
            <Mini label="keys (comma-separated)">
              <input
                value={row.meta.keys.join(", ")}
                onChange={(e) =>
                  onPatchMeta({
                    keys: e.currentTarget.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-100 focus:outline-none focus:border-neutral-600"
              />
            </Mini>
            <Mini label="secondary keys (comma-separated)">
              <input
                value={(row.meta.secondary_keys ?? []).join(", ")}
                onChange={(e) =>
                  onPatchMeta({
                    secondary_keys: e.currentTarget.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-100 focus:outline-none focus:border-neutral-600"
              />
            </Mini>
            <Mini label="position">
              <select
                value={row.meta.position}
                onChange={(e) =>
                  onPatchMeta({
                    position: e.currentTarget.value as
                      | "before_char"
                      | "after_char",
                  })
                }
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-100 focus:outline-none focus:border-neutral-600"
              >
                <option value="before_char">before character prompt</option>
                <option value="after_char">after character prompt</option>
              </select>
            </Mini>
            <Mini label="insertion order (lower = earlier)">
              <input
                type="number"
                value={row.meta.insertion_order}
                onChange={(e) =>
                  onPatchMeta({
                    insertion_order: Number(e.currentTarget.value) || 0,
                  })
                }
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs text-neutral-100 focus:outline-none focus:border-neutral-600"
              />
            </Mini>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-neutral-300">
            <Toggle
              label="enabled"
              value={row.meta.enabled ?? true}
              onChange={(v) => onPatchMeta({ enabled: v })}
            />
            <Toggle
              label="constant (always inject)"
              value={row.meta.constant ?? false}
              onChange={(v) => onPatchMeta({ constant: v })}
            />
            <Toggle
              label="selective (require secondary key)"
              value={row.meta.selective ?? false}
              onChange={(v) => onPatchMeta({ selective: v })}
            />
            <Toggle
              label="case-sensitive"
              value={row.meta.case_sensitive ?? false}
              onChange={(v) => onPatchMeta({ case_sensitive: v })}
            />
          </div>
        </div>
      )}
    </li>
  );
}

function Mini({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
