// "The story so far" — the chapters that stand in for everything older than the
// recent messages. Visible and editable on purpose: players hand-write summaries
// today because they can't trust or correct an invisible one. An edited chapter
// is the player's and is never rewritten.

import { useState } from "react";
import type { Chronicle } from "../../lib/story/chronicle";

interface Props {
  chronicle: Chronicle;
  busy: boolean;
  onEditChapter: (id: string, text: string) => void;
  onDeleteChapter: (id: string) => void;
  onEditEarlier: (text: string) => void;
  onRebuild: () => void;
}

const OPEN_KEY = "chronicler:story-hud-open";

export function StoryHud({ chronicle, busy, onEditChapter, onDeleteChapter, onEditEarlier, onRebuild }: Props) {
  const [open, setOpen] = useState(() => {
    try {
      return window.localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const count = chronicle.chapters.length + (chronicle.earlier ? 1 : 0);
  if (count === 0 && !busy) return null;

  function toggle(): void {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  const start = (id: string, text: string) => {
    setEditing(id);
    setDraft(text);
  };
  const save = () => {
    if (editing === "earlier") onEditEarlier(draft);
    else if (editing) onEditChapter(editing, draft);
    setEditing(null);
  };

  const box = "w-full resize-y rounded-md border border-neutral-700 bg-neutral-950/60 px-2 py-1 text-xs text-neutral-100";

  return (
    <div className="border-b border-neutral-800 bg-neutral-950/40">
      <div className="px-3 sm:px-6 py-1.5 flex items-center gap-2 text-[11px]">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex items-center gap-1.5 text-neutral-400 hover:text-neutral-100">
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="uppercase tracking-wider text-[10px] font-semibold">Story so far</span>
          <span className="text-neutral-500">
            {chronicle.chapters.length} chapter{chronicle.chapters.length === 1 ? "" : "s"}
            {chronicle.earlier ? " + earlier" : ""}
          </span>
          {busy && <span className="text-emerald-400 animate-pulse" aria-label="Writing">●</span>}
        </button>
        {open && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Rebuild the whole story summary from the chat? Chapters you edited will be replaced.")) onRebuild();
            }}
            className="ml-auto text-neutral-500 hover:text-neutral-100"
          >
            rebuild
          </button>
        )}
      </div>
      {open && (
        <div className="px-3 sm:px-6 pb-2.5 space-y-1.5 max-h-56 overflow-y-auto">
          <p className="text-[10px] text-neutral-600 leading-snug">
            Older messages are summarised here so the story remembers them after they leave the recent window. Edit anything
            that's wrong — an edited chapter is never rewritten.
          </p>
          {chronicle.earlier && (
            <Entry label="earlier" text={chronicle.earlier} editing={editing === "earlier"} draft={draft} setDraft={setDraft} box={box}
              onEdit={() => start("earlier", chronicle.earlier ?? "")} onSave={save} onCancel={() => setEditing(null)} />
          )}
          {chronicle.chapters.map((ch, i) => (
            <Entry key={ch.id} label={`${i + 1}${ch.edited ? " · edited" : ""}${ch.fallback ? " · plain extract" : ""}`} text={ch.text}
              editing={editing === ch.id} draft={draft} setDraft={setDraft} box={box}
              onEdit={() => start(ch.id, ch.text)} onSave={save} onCancel={() => setEditing(null)} onDelete={() => onDeleteChapter(ch.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Entry(p: {
  label: string; text: string; editing: boolean; draft: string; setDraft: (s: string) => void; box: string;
  onEdit: () => void; onSave: () => void; onCancel: () => void; onDelete?: () => void;
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 px-2.5 py-1.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-neutral-500">
        <span>{p.label}</span>
        {!p.editing && (
          <span className="ml-auto flex gap-2 normal-case tracking-normal">
            <button type="button" onClick={p.onEdit} className="hover:text-neutral-100">edit</button>
            {p.onDelete && (
              <button type="button" onClick={p.onDelete} className="hover:text-rose-300" aria-label="Delete this chapter" title="Delete this chapter">✕</button>
            )}
          </span>
        )}
      </div>
      {p.editing ? (
        <div className="mt-1 space-y-1">
          <textarea className={p.box} rows={4} value={p.draft} onChange={(e) => p.setDraft(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" onClick={p.onSave} className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] text-white">Save</button>
            <button type="button" onClick={p.onCancel} className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300">Cancel</button>
          </div>
        </div>
      ) : (
        <p className="mt-0.5 text-xs leading-relaxed text-neutral-300">{p.text}</p>
      )}
    </div>
  );
}
