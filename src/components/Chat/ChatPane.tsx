import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatTurn } from "../../lib/orchestrator/types";

interface Props {
  turns: ChatTurn[];
  onSend: (text: string) => void | Promise<void>;
  isThinking?: boolean;
  recap?: string;
  characterName?: string;
  speakerNames?: Record<string, string>;
  speakerAvatars?: Record<string, string>;
  streamingText?: string;
  onEditMessage?: (turnId: string, newContent: string) => void | Promise<void>;
  onDeleteMessage?: (turnId: string) => void | Promise<void>;
  onRegenerate?: (turnId: string) => void | Promise<void>;
  onContinue?: (turnId: string) => void | Promise<void>;
  onImpersonate?: (currentDraft: string) => Promise<string | null>;
  onSwipeChange?: (turnId: string, newIndex: number) => void;
  onFork?: (turnId: string) => void | Promise<void>;
}

export function ChatPane({
  turns,
  onSend,
  isThinking,
  recap,
  characterName,
  speakerNames = {},
  speakerAvatars = {},
  streamingText,
  onEditMessage,
  onDeleteMessage,
  onRegenerate,
  onContinue,
  onImpersonate,
  onSwipeChange,
  onFork,
}: Props) {
  const [draft, setDraft] = useState("");
  const [impersonating, setImpersonating] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  async function submit() {
    const text = draft.trim();
    if (!text || isThinking) return;
    setDraft("");
    await onSend(text);
    taRef.current?.focus();
  }

  async function impersonate() {
    if (!onImpersonate || impersonating || isThinking) return;
    setImpersonating(true);
    try {
      const suggested = await onImpersonate(draft);
      if (suggested) setDraft(suggested);
      taRef.current?.focus();
    } finally {
      setImpersonating(false);
    }
  }

  return (
    <section className="flex h-full flex-col bg-neutral-900">
      {recap && (
        <div className="px-6 py-3 border-b border-neutral-800 bg-neutral-950/60">
          <p className="text-[11px] uppercase tracking-wider text-emerald-500/70 font-semibold">
            Previously on…
          </p>
          <div className="text-sm text-neutral-300 mt-1 leading-relaxed prose prose-invert prose-sm max-w-none">
            <ReactMarkdown>{recap}</ReactMarkdown>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {turns.length === 0 && (
          <p className="text-xs text-neutral-600 italic text-center py-12">
            No turns yet. Say something to {characterName ?? "the character"}.
          </p>
        )}
        {turns.map((t, idx) => (
          <MessageBubble
            key={t.id}
            turn={t}
            isLastAssistant={
              idx === turns.length - 1 && t.role === "assistant"
            }
            displayName={speakerNames[t.speaker]}
            avatarUrl={speakerAvatars[t.speaker]}
            onEdit={onEditMessage}
            onDelete={onDeleteMessage}
            onRegenerate={onRegenerate}
            onContinue={onContinue}
            onSwipeChange={onSwipeChange}
            onFork={onFork}
          />
        ))}
        {streamingText !== undefined && streamingText.length > 0 && (
          <div className="flex justify-start gap-2">
            <div className="max-w-[75%] rounded-xl px-3.5 py-2 text-sm leading-relaxed bg-neutral-800 text-neutral-100 opacity-90">
              <p className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5 font-semibold">
                {characterName ?? "…"}
              </p>
              <div className="whitespace-pre-wrap">{streamingText}▎</div>
            </div>
          </div>
        )}
        {isThinking && streamingText === undefined && (
          <div className="text-xs text-neutral-500 italic">thinking…</div>
        )}
      </div>

      <form
        className="border-t border-neutral-800 px-4 py-3 flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Type a message. Shift+Enter for newline. **markdown** works."
          rows={2}
          className="flex-1 rounded-md bg-neutral-800 text-neutral-100 border border-neutral-700 px-3 py-2 text-sm resize-none focus:outline-none focus:border-neutral-500"
        />
        <div className="flex flex-col gap-1.5">
          {onImpersonate && (
            <button
              type="button"
              onClick={impersonate}
              disabled={isThinking || impersonating}
              title="Have the LLM suggest what you might say next"
              className="rounded-md border border-neutral-700 hover:border-neutral-500 disabled:opacity-50 text-neutral-300 hover:text-neutral-100 px-3 py-1 text-xs font-medium"
            >
              {impersonating ? "…" : "impersonate"}
            </button>
          )}
          <button
            type="submit"
            disabled={isThinking || draft.trim().length === 0}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white px-4 py-2 text-sm font-medium"
          >
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

interface BubbleProps {
  turn: ChatTurn;
  displayName?: string;
  avatarUrl?: string;
  isLastAssistant: boolean;
  onEdit?: (turnId: string, newContent: string) => void | Promise<void>;
  onDelete?: (turnId: string) => void | Promise<void>;
  onRegenerate?: (turnId: string) => void | Promise<void>;
  onContinue?: (turnId: string) => void | Promise<void>;
  onSwipeChange?: (turnId: string, newIndex: number) => void;
  onFork?: (turnId: string) => void | Promise<void>;
}

function MessageBubble({
  turn,
  displayName,
  avatarUrl,
  isLastAssistant,
  onEdit,
  onDelete,
  onRegenerate,
  onContinue,
  onSwipeChange,
  onFork,
}: BubbleProps) {
  const isUser = turn.role === "user";
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(turn.content);
  const [hovered, setHovered] = useState(false);

  function startEdit() {
    setEditDraft(turn.content);
    setEditing(true);
  }

  function commitEdit() {
    const next = editDraft.trim();
    if (!next || next === turn.content) {
      setEditing(false);
      return;
    }
    onEdit?.(turn.id, next);
    setEditing(false);
  }

  const initials = (displayName ?? turn.speaker)
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const palette = [
    "bg-rose-700/60",
    "bg-amber-700/60",
    "bg-teal-700/60",
    "bg-sky-700/60",
    "bg-violet-700/60",
  ];
  const paletteIdx =
    Array.from(turn.speaker).reduce((n, ch) => n + ch.charCodeAt(0), 0) %
    palette.length;

  return (
    <div
      className={`group flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isUser &&
        (avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-0.5"
          />
        ) : (
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0 mt-0.5 ${palette[paletteIdx]}`}
          >
            {initials}
          </div>
        ))}
      <div
        className={`relative max-w-[78%] rounded-xl px-3.5 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-emerald-700/80 text-emerald-50"
            : "bg-neutral-800 text-neutral-100"
        }`}
      >
        {!isUser && (
          <p className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5 font-semibold">
            {displayName ?? turn.speaker}
          </p>
        )}
        {editing ? (
          <div>
            <textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              className="w-full bg-neutral-950 text-neutral-100 border border-neutral-600 rounded px-2 py-1 text-sm resize-y"
              rows={Math.min(10, Math.max(2, editDraft.split("\n").length + 1))}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit();
              }}
            />
            <div className="flex justify-end gap-1.5 mt-1">
              <button
                className="text-[11px] px-2 py-0.5 rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-200"
                onClick={() => setEditing(false)}
              >
                cancel
              </button>
              <button
                className="text-[11px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white"
                onClick={commitEdit}
              >
                save
              </button>
            </div>
          </div>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
            <ReactMarkdown>{turn.content}</ReactMarkdown>
          </div>
        )}

        {/* Swipe nav — last assistant turn only, when there are alternatives */}
        {!editing &&
          !isUser &&
          isLastAssistant &&
          (turn.swipes?.length ?? 0) > 1 &&
          onSwipeChange && (
            <div className="mt-1.5 flex items-center gap-1 text-[11px] text-neutral-400">
              <button
                disabled={(turn.swipe_index ?? 0) <= 0}
                onClick={() =>
                  onSwipeChange(turn.id, (turn.swipe_index ?? 0) - 1)
                }
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-700 disabled:opacity-30"
                title="previous swipe"
              >
                ‹
              </button>
              <span className="font-mono">
                {(turn.swipe_index ?? 0) + 1} / {turn.swipes?.length ?? 1}
              </span>
              <button
                onClick={() => {
                  const cur = turn.swipe_index ?? 0;
                  const len = turn.swipes?.length ?? 1;
                  if (cur < len - 1) onSwipeChange(turn.id, cur + 1);
                  else onRegenerate?.(turn.id); // generate a new one
                }}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-700"
                title={
                  (turn.swipe_index ?? 0) < (turn.swipes?.length ?? 1) - 1
                    ? "next swipe"
                    : "generate new swipe"
                }
              >
                ›
              </button>
            </div>
          )}

        {!editing && hovered && (onEdit || onDelete || onRegenerate || onContinue) && (
          <div
            className={`absolute -top-2.5 ${
              isUser ? "left-2" : "right-2"
            } flex gap-0.5 bg-neutral-900 border border-neutral-700 rounded shadow px-0.5 py-0.5`}
          >
            {onEdit && (
              <IconBtn title="edit" onClick={startEdit}>
                ✎
              </IconBtn>
            )}
            {onRegenerate && !isUser && (
              <IconBtn title="regenerate" onClick={() => onRegenerate(turn.id)}>
                ↻
              </IconBtn>
            )}
            {onContinue && !isUser && isLastAssistant && (
              <IconBtn title="continue" onClick={() => onContinue(turn.id)}>
                ⇢
              </IconBtn>
            )}
            {onFork && (
              <IconBtn
                title="fork — branch a new session from this turn"
                onClick={() => onFork(turn.id)}
              >
                ⑂
              </IconBtn>
            )}
            {onDelete && (
              <IconBtn
                title="delete"
                onClick={() => onDelete(turn.id)}
                danger
              >
                ✕
              </IconBtn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
  danger,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`w-6 h-6 flex items-center justify-center rounded text-[11px] ${
        danger
          ? "text-neutral-400 hover:bg-red-900/60 hover:text-red-100"
          : "text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}
