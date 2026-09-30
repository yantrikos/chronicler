// The scene status board, shown above the chat: where and when the story is,
// who is present, what is being pursued, what the player carries. The model
// keeps it current; the player can correct it at any time — a correction is
// authoritative, so the model can't quietly rewrite the room.

import { useState } from "react";
import { editScene, isEmptyScene, type SceneState } from "../../lib/scene/state";

interface Props {
  state: SceneState;
  onChange: (next: SceneState) => void;
  onClear: () => void;
  /** on: auto-updating. off: switched off in Settings. needs-model: no real
   *  model provider is configured, so there is nothing to ask. */
  tracking: "on" | "off" | "needs-model";
  /** True while a tracker call is in flight. */
  updating?: boolean;
  /** Open consequences the world has not yet answered. Omitted when off. */
  consequences?: {
    deeds: { id: string; text: string; turn: number; witnesses: string[] }[];
    turn: number;
    answered: number;
    onDismiss: (id: string) => void;
  };
  /** Generated graphics status. Omitted when generated images are off. */
  images?: {
    busy: string | null;
    error?: string;
    hasBackdrop: boolean;
    onRedraw: () => void;
  };
  /** Story pacing (see lib/scene/pacing.ts). Omitted → no pacing row. */
  pacing?: {
    level: "off" | "gentle" | "lively";
    /** Still turns to go before a nudge could fire; null when off. */
    turnsUntil: number | null;
    /** Human label of the last beat used. */
    lastBeat?: string;
    onChange: (level: "off" | "gentle" | "lively") => void;
  };
}

const COLLAPSE_KEY = "chronicler:scene-hud-collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

const csv = (xs: string[]) => xs.join(", ");
const split = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

export function SceneHud({ state, onChange, onClear, tracking, updating, pacing, images, consequences }: Props) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ location: "", time: "", mood: "", present: "", goals: "", inventory: "" });

  const empty = isEmptyScene(state);

  function toggle(): void {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function startEdit(): void {
    setDraft({
      location: state.location ?? "",
      time: state.time ?? "",
      mood: state.mood ?? "",
      present: csv(state.present),
      goals: csv(state.goals),
      inventory: csv(state.inventory),
    });
    setEditing(true);
    if (collapsed) toggle();
  }

  function save(): void {
    onChange(
      editScene(state, {
        location: draft.location,
        time: draft.time,
        mood: draft.mood,
        present: split(draft.present),
        goals: split(draft.goals),
        inventory: split(draft.inventory),
      })
    );
    setEditing(false);
  }

  const field =
    "w-full rounded-md bg-neutral-900/70 border border-neutral-700 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600";

  return (
    <div className="border-b border-neutral-800 bg-neutral-950/50">
      <div className="px-3 sm:px-6 py-1.5 flex items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 text-neutral-400 hover:text-neutral-100"
          title={collapsed ? "Show the scene board" : "Hide the scene board"}
        >
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
          <span className="uppercase tracking-wider text-[10px] font-semibold">Scene board</span>
          {updating && (
            <span className="text-emerald-400 animate-pulse" title="Updating…" aria-label="Updating">●</span>
          )}
        </button>
        {collapsed && !empty && (
          <span className="truncate text-neutral-500">
            {[state.location, state.time].filter(Boolean).join(" · ")}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {tracking !== "on" && (
            <span className="text-neutral-600">
              {tracking === "off" ? "auto-update off" : "auto-update needs a model"}
            </span>
          )}
          {!editing && (
            <button type="button" onClick={startEdit} className="text-neutral-400 hover:text-neutral-100">
              edit
            </button>
          )}
        </span>
      </div>

      {!collapsed && !editing && consequences && consequences.deeds.length > 0 && (
        <div className="px-3 sm:px-6 pb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="uppercase tracking-wider text-[10px] font-semibold text-neutral-500 mr-1">Consequences</span>
          {consequences.deeds.map((d) => {
            const ago = Math.max(0, consequences.turn - d.turn);
            return (
              <span
                key={d.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-neutral-200"
                title={`${d.text}${d.witnesses.length ? ` — known to ${d.witnesses.join(", ")}` : ""}`}
              >
                <span aria-hidden="true" className="text-amber-400">⚑</span>
                <span className="truncate max-w-[26ch]">{d.text}</span>
                <span className="text-neutral-500">{ago}t</span>
                <button
                  type="button"
                  aria-label="Dismiss — the world has moved on"
                  title="Dismiss — treat as settled"
                  onClick={() => consequences.onDismiss(d.id)}
                  className="text-neutral-500 hover:text-rose-300"
                >
                  ✕
                </button>
              </span>
            );
          })}
          {consequences.answered > 0 && <span className="text-neutral-600">· {consequences.answered} answered</span>}
        </div>
      )}

      {!collapsed && !editing && images && (
        <div className="px-3 sm:px-6 pb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
          <span className="uppercase tracking-wider text-[10px] font-semibold">Images</span>
          {images.busy && <span className="text-emerald-400 animate-pulse">drawing {images.busy}…</span>}
          {!images.busy && images.error && (
            <span className="text-rose-300" title={images.error}>
              image backend problem: {images.error.slice(0, 90)}
            </span>
          )}
          {!images.busy && !images.error && !state.location && <span>backdrop appears once the scene has a location</span>}
          {state.location && (
            <button type="button" onClick={images.onRedraw} disabled={!!images.busy} className="text-neutral-400 hover:text-neutral-100 disabled:opacity-40">
              redraw backdrop
            </button>
          )}
        </div>
      )}

      {!collapsed && !editing && pacing && tracking === "on" && (
        <div className="px-3 sm:px-6 pb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
          <label className="flex items-center gap-1.5">
            <span className="uppercase tracking-wider text-[10px] font-semibold">Pacing</span>
            <select
              value={pacing.level}
              onChange={(e) => pacing.onChange(e.target.value as "off" | "gentle" | "lively")}
              className="rounded-md bg-neutral-900/70 border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-200"
              title="When the scene stands still, the director can give the story a nudge"
            >
              <option value="off">off</option>
              <option value="gentle">gentle — after ~8 still turns</option>
              <option value="lively">lively — after ~5 still turns</option>
            </select>
          </label>
          {pacing.level !== "off" && pacing.turnsUntil !== null && (
            <span>
              {pacing.turnsUntil === 0
                ? "next turn may bring a twist"
                : `twist possible in ~${pacing.turnsUntil} still turn${pacing.turnsUntil === 1 ? "" : "s"}`}
            </span>
          )}
          {pacing.lastBeat && <span>· last nudge: {pacing.lastBeat}</span>}
        </div>
      )}

      {!collapsed && !editing && (
        <div className="px-3 sm:px-6 pb-2.5">
          {empty ? (
            <p className="text-[11px] text-neutral-500">
              {tracking === "on"
                ? "Fills in as you play — location, time, who's present, objectives and what you're carrying. Edit any of it to correct the story."
                : tracking === "off"
                ? "Empty. Turn on auto-update in Settings, or fill it in by hand."
                : "Empty. Auto-update needs a real model provider (Settings); until then, fill it in by hand."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {state.location && <Chip icon="◉" label="Where" value={state.location} />}
              {state.time && <Chip icon="◷" label="When" value={state.time} />}
              {state.mood && <Chip icon="≈" label="Mood" value={state.mood} />}
              {state.present.length > 0 && <Chip icon="◍" label="Present" value={csv(state.present)} />}
              {state.goals.length > 0 && <Chip icon="◎" label="Objectives" value={state.goals.join(" · ")} />}
              {state.inventory.length > 0 && <Chip icon="▣" label="Carrying" value={csv(state.inventory)} />}
            </div>
          )}
        </div>
      )}

      {!collapsed && editing && (
        <div className="px-3 sm:px-6 pb-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Location
            <input className={field} value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="e.g. The Salt Page" />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Time
            <input className={field} value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} placeholder="e.g. late evening" />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Mood
            <input className={field} value={draft.mood} onChange={(e) => setDraft({ ...draft, mood: e.target.value })} placeholder="e.g. quiet, wary" />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Present <span className="normal-case tracking-normal">(comma-separated)</span>
            <input className={field} value={draft.present} onChange={(e) => setDraft({ ...draft, present: e.target.value })} />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Objectives
            <input className={field} value={draft.goals} onChange={(e) => setDraft({ ...draft, goals: e.target.value })} />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Carrying
            <input className={field} value={draft.inventory} onChange={(e) => setDraft({ ...draft, inventory: e.target.value })} />
          </label>
          <div className="sm:col-span-3 flex items-center gap-2 pt-1">
            <button type="button" onClick={save} className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-xs font-medium">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-neutral-700 text-neutral-300 px-3 py-1 text-xs">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onClear();
                setEditing(false);
              }}
              className="ml-auto text-xs text-neutral-500 hover:text-rose-300"
            >
              clear board
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-1.5 max-w-full rounded-full border border-neutral-700/70 bg-neutral-900/60 px-2.5 py-0.5 text-[11px]"
      title={`${label}: ${value}`}
    >
      <span aria-hidden="true" className="text-emerald-400">{icon}</span>
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-200 truncate">{value}</span>
    </span>
  );
}
