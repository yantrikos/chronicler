// In-chat search overlay. Cmd/Ctrl+F opens a small bar above the chat that
// substring-matches across current-session turns and (optionally) all
// stored sessions. Saga task #33.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatTurn } from "../../lib/orchestrator/types";
import { listSessions, loadTurns, type SessionMeta } from "../../lib/session/store";

interface MatchHit {
  session_id: string;
  session_title?: string;
  turn: ChatTurn;
}

interface Props {
  /** Turns of the currently active session — searched first/locally. */
  currentTurns: ChatTurn[];
  currentSessionId?: string | null;
  onClose: () => void;
  /** Scroll the chat to a specific turn id. Caller wires this to chat scroll. */
  onJumpToTurn: (turnId: string) => void;
  /** Switch to a different session and jump to a turn. */
  onJumpToSession?: (sessionId: string, turnId: string) => void;
}

export function ChatSearch({
  currentTurns,
  currentSessionId,
  onClose,
  onJumpToTurn,
  onJumpToSession,
}: Props) {
  const [q, setQ] = useState("");
  const [allSessions, setAllSessions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [] as MatchHit[];
    const out: MatchHit[] = [];
    if (allSessions) {
      const sessions: SessionMeta[] = listSessions();
      for (const s of sessions) {
        const turns = s.id === currentSessionId ? currentTurns : loadTurns(s.id);
        for (const t of turns) {
          if (t.content.toLowerCase().includes(term)) {
            out.push({ session_id: s.id, session_title: s.title, turn: t });
          }
        }
      }
    } else {
      for (const t of currentTurns) {
        if (t.content.toLowerCase().includes(term)) {
          out.push({
            session_id: currentSessionId ?? "current",
            turn: t,
          });
        }
      }
    }
    return out;
  }, [q, allSessions, currentTurns, currentSessionId]);

  useEffect(() => {
    setActiveIdx(0);
  }, [q, allSessions]);

  function step(delta: number) {
    if (hits.length === 0) return;
    const next = (activeIdx + delta + hits.length) % hits.length;
    setActiveIdx(next);
    const hit = hits[next];
    if (hit.session_id === currentSessionId || !onJumpToSession) {
      onJumpToTurn(hit.turn.id);
    } else {
      onJumpToSession(hit.session_id, hit.turn.id);
    }
  }

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 w-[640px] max-w-[90vw]">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">
            search
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="find in chat (Enter to step, Shift+Enter back, Esc close)"
            className="flex-1 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1 text-sm text-neutral-100 focus:outline-none focus:border-neutral-600"
          />
          <label className="flex items-center gap-1 text-[11px] text-neutral-400 cursor-pointer">
            <input
              type="checkbox"
              checked={allSessions}
              onChange={(e) => setAllSessions(e.currentTarget.checked)}
            />
            all sessions
          </label>
          <span className="text-[11px] text-neutral-500 font-mono w-[64px] text-right">
            {hits.length === 0
              ? q.trim() ? "0 matches" : ""
              : `${activeIdx + 1} / ${hits.length}`}
          </span>
          <button
            onClick={() => step(-1)}
            className="w-6 h-6 flex items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30"
            disabled={hits.length === 0}
            title="previous match (Shift+Enter)"
          >
            ‹
          </button>
          <button
            onClick={() => step(1)}
            className="w-6 h-6 flex items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-30"
            disabled={hits.length === 0}
            title="next match (Enter)"
          >
            ›
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            title="close (Esc)"
          >
            ✕
          </button>
        </div>
        {q.trim() && hits.length > 0 && (
          <ul className="mt-2 max-h-60 overflow-y-auto border-t border-neutral-800 pt-2 space-y-1">
            {hits.map((h, i) => (
              <li
                key={`${h.session_id}-${h.turn.id}`}
                className={`text-xs cursor-pointer rounded px-2 py-1 ${
                  i === activeIdx
                    ? "bg-emerald-700/40 text-emerald-50"
                    : "hover:bg-neutral-800 text-neutral-300"
                }`}
                onClick={() => {
                  setActiveIdx(i);
                  if (h.session_id === currentSessionId || !onJumpToSession) {
                    onJumpToTurn(h.turn.id);
                  } else {
                    onJumpToSession(h.session_id, h.turn.id);
                  }
                }}
              >
                {allSessions && h.session_title && (
                  <span className="text-[10px] text-neutral-500 font-mono mr-2">
                    {h.session_title}
                  </span>
                )}
                <span className="line-clamp-1">
                  {highlight(h.turn.content, q.trim())}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function highlight(text: string, term: string): React.ReactNode {
  if (!term) return text;
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  const idx = lower.indexOf(t);
  if (idx < 0) return text;
  // Surround with ~30 chars of context on each side, clipped
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + t.length + 30);
  const before = (start > 0 ? "…" : "") + text.slice(start, idx);
  const match = text.slice(idx, idx + t.length);
  const after = text.slice(idx + t.length, end) + (end < text.length ? "…" : "");
  return (
    <>
      {before}
      <mark className="bg-amber-500/40 text-amber-100 rounded px-0.5">
        {match}
      </mark>
      {after}
    </>
  );
}
