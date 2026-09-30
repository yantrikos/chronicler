import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatTurn, TurnAttachment } from "../../lib/orchestrator/types";
import { getImage } from "../../lib/vision/attachments";
import { isDirectiveOnly, splitOoc } from "../../lib/orchestrator/ooc";

/** Devices with no hover (touch) can never trigger the hover-only message
 *  toolbar, so it is always shown there. */
const CAN_HOVER =
  typeof window === "undefined" || !window.matchMedia
    ? true
    : window.matchMedia("(hover: hover)").matches;


interface Props {
  turns: ChatTurn[];
  /** Resolve `false` when the message was refused (e.g. no model connected) so the composer keeps the text. */
  onSend: (text: string, attachments?: TurnAttachment[]) => void | boolean | Promise<void | boolean>;
  /** Image attachments. When set, the composer offers an attach button (and
   *  accepts paste / drag-drop); the image is described by `describe` and the
   *  player reviews the description before it enters the story. */
  vision?: {
    /** Where the image will be sent, shown on the attach button. */
    label: string;
    describe: (file: Blob) => Promise<DescribeUi>;
  };
  isThinking?: boolean;
  /** A generated scene backdrop is showing behind the chat; make the pane
   *  more see-through so it reads. */
  hasBackdrop?: boolean;
  /** Stops the in-flight generation. When set, the Send button becomes a
   *  Stop button while a reply is being generated (Esc also stops). */
  onStop?: () => void;
  recap?: string;
  /** Deterministic, rule-based summary of active + paused arcs to render
   *  alongside the LLM-generated recap. Pure string; never touches the
   *  recap LLM prompt (the most hallucination-prone surface). */
  activeArcsLine?: string;
  characterName?: string;
  speakerNames?: Record<string, string>;
  speakerAvatars?: Record<string, string>;
  streamingText?: string;
  /** When set, the bubble with this id gets a brief highlight ring so the
   *  user can spot the search-jumped target. */
  highlightTurnId?: string;
  onEditMessage?: (turnId: string, newContent: string) => void | Promise<void>;
  onDeleteMessage?: (turnId: string) => void | Promise<void>;
  onRegenerate?: (turnId: string) => void | Promise<void>;
  onContinue?: (turnId: string) => void | Promise<void>;
  onImpersonate?: (currentDraft: string) => Promise<string | null>;
  onSwipeChange?: (turnId: string, newIndex: number) => void;
  onFork?: (turnId: string) => void | Promise<void>;
  /** Grimoire slash commands available in this session. Pass the list +
   *  the invocation handler from App.tsx. When provided, typing "/" in the
   *  input shows an autocomplete; submitting a /command routes through
   *  onSlashCommand instead of onSend. */
  slashCommands?: { name: string; description: string }[];
  onSlashCommand?: (name: string, args: string) => Promise<void>;
}

/** Result of describing a picked image. `warning` is set when the model could
 *  not describe it — the player can then write the description themselves. */
export type DescribeUi =
  | { ok: true; attachment: TurnAttachment; thumb: string; warning?: string }
  | { ok: false; error: string };

interface PendingImage {
  status: "describing" | "ready";
  thumb: string;
  attachment?: TurnAttachment;
  original?: string;
  warning?: string;
}

export function ChatPane({
  turns,
  onSend,
  vision,
  isThinking,
  hasBackdrop,
  onStop,
  recap,
  activeArcsLine,
  characterName,
  speakerNames = {},
  speakerAvatars = {},
  streamingText,
  highlightTurnId,
  onEditMessage,
  onDeleteMessage,
  onRegenerate,
  onContinue,
  onImpersonate,
  onSwipeChange,
  onFork,
  slashCommands = [],
  onSlashCommand,
}: Props) {
  const [draft, setDraft] = useState("");
  const [impersonating, setImpersonating] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Follow the conversation. The list stays pinned to the newest message —
  // including while a reply streams in — unless the reader has scrolled up on
  // purpose, in which case it leaves them alone and offers a way back down.
  const listRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const firstTurnId = useRef<string | undefined>(undefined);
  const [away, setAway] = useState(false);

  // Image attachment being prepared / reviewed (one at a time).
  const [pending, setPending] = useState<PendingImage | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const attachToken = useRef(0);

  async function attach(file: Blob | null | undefined): Promise<void> {
    if (!file || !vision) return;
    const token = ++attachToken.current;
    setAttachError(null);
    setPending({ status: "describing", thumb: URL.createObjectURL(file) });
    const r = await vision.describe(file);
    if (token !== attachToken.current) return; // removed or replaced meanwhile
    if (!r.ok) {
      setPending(null);
      setAttachError(r.error);
      return;
    }
    setPending({ status: "ready", thumb: r.thumb, attachment: r.attachment, original: r.attachment.description, warning: r.warning });
  }

  function removePending(): void {
    attachToken.current++;
    setPending(null);
    setAttachError(null);
  }

  function editDescription(text: string): void {
    setPending((p) =>
      p?.attachment
        ? { ...p, attachment: { ...p.attachment, description: text, user_edited: text.trim() !== (p.original ?? "").trim() } }
        : p
    );
  }

  const readyAttachment = pending?.status === "ready" && pending.attachment && pending.attachment.description.trim() ? pending.attachment : undefined;
  const canSend = !isThinking && pending?.status !== "describing" && (draft.trim().length > 0 || !!readyAttachment) && !(pending?.status === "ready" && !readyAttachment);

  function scrollToBottom(smooth = false): void {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  useEffect(() => {
    // A different conversation (session switch) starts at the bottom.
    if (turns[0]?.id !== firstTurnId.current) {
      firstTurnId.current = turns[0]?.id;
      pinned.current = true;
    }
    // What you just sent is always followed, wherever you were scrolled.
    if (turns[turns.length - 1]?.role === "user") pinned.current = true;
    if (pinned.current) {
      requestAnimationFrame(() => scrollToBottom());
      setAway(false);
    }
  }, [turns, streamingText, isThinking]);

  async function submit() {
    const text = draft.trim();
    const att = readyAttachment;
    if ((!text && !att) || !canSend) return;
    // Slash command path: route through onSlashCommand (Grimoire host)
    // instead of treating it as a regular chat message.
    if (!att && text.startsWith("/") && onSlashCommand) {
      const space = text.indexOf(" ");
      const name = (space === -1 ? text.slice(1) : text.slice(1, space)).trim();
      const args = space === -1 ? "" : text.slice(space + 1).trim();
      setDraft("");
      await onSlashCommand(name, args);
      taRef.current?.focus();
      return;
    }
    setDraft("");
    setPending(null);
    const sent = await onSend(text, att ? [att] : undefined);
    if (sent === false) setDraft(text); // refused — don't lose what they typed
    taRef.current?.focus();
  }

  // Compute autocomplete matches when draft starts with "/" and no space yet.
  const slashMatches = (() => {
    if (!onSlashCommand || !draft.startsWith("/") || draft.includes(" ")) {
      return [] as { name: string; description: string }[];
    }
    const prefix = draft.slice(1).toLowerCase();
    return slashCommands
      .filter((c) => c.name.toLowerCase().startsWith(prefix))
      .slice(0, 6);
  })();

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
    <section className={`relative flex h-full flex-col backdrop-blur-sm ${hasBackdrop ? "bg-neutral-900/35" : "bg-neutral-900/70"}`}>
      {/* Arcs are clustered from the same canon as the recap, so a fresh
          character's card text shows up as "active arcs" too. Both are only
          meaningful once there is story to look back on (see recap/history). */}
      {recap && (
        <div className="px-3 sm:px-6 py-3 border-b border-neutral-800 bg-neutral-950/60">
          <p className="text-[11px] uppercase tracking-wider text-emerald-500/70 font-semibold">
            Previously on…
          </p>
          {recap && (
            <div className="text-sm text-neutral-300 mt-1 leading-relaxed prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{recap}</ReactMarkdown>
            </div>
          )}
          {activeArcsLine && (
            <p className="text-[12px] text-neutral-400 mt-2 leading-snug">
              <span className="text-[10px] uppercase tracking-wider text-violet-400/80 font-semibold mr-1.5">
                arcs:
              </span>
              {activeArcsLine}
            </p>
          )}
        </div>
      )}

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          pinned.current = nearBottom;
          setAway(!nearBottom);
        }}
        className="flex-1 overflow-y-auto px-3 sm:px-6 py-6"
      >
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {turns.length === 0 && (
          <EmptyChat characterName={characterName} onPick={(t) => void onSend(t)} />
        )}
        {turns.map((t, idx) => {
          // System turns are narrator-style (dice rolls, scene markers,
          // /help output). Centered, italic, less prominent than character
          // dialogue but still selectable + deletable.
          if (t.role === "user" && isDirectiveOnly(t.content)) {
            return <DirectorRow key={t.id} turn={t} onDelete={onDeleteMessage} />;
          }
          if (t.role === "system") {
            return (
              <NarratorRow
                key={t.id}
                turn={t}
                onDelete={onDeleteMessage}
              />
            );
          }
          return (
            <MessageBubble
              key={t.id}
              turn={t}
              isLastAssistant={
                idx === turns.length - 1 && t.role === "assistant"
              }
              isHighlighted={t.id === highlightTurnId}
              displayName={speakerNames[t.speaker]}
              avatarUrl={speakerAvatars[t.speaker]}
              onEdit={onEditMessage}
              onDelete={onDeleteMessage}
              onRegenerate={onRegenerate}
              onContinue={onContinue}
              onSwipeChange={onSwipeChange}
              onFork={onFork}
            />
          );
        })}
        {streamingText !== undefined && streamingText.length > 0 && (
          <div className="flex justify-start gap-2">
            <div className="max-w-[92%] sm:max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-7 msg-text bg-neutral-800/85 border border-neutral-700/60 shadow-md shadow-black/20 text-neutral-100 opacity-90">
              <p className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5 font-semibold">
                {characterName ?? "…"}
              </p>
              <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
                <ReactMarkdown>{`${streamingText}▎`}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}
        {/* Pre-stream indicator: from the moment the user sends until the
            first chunk lands (retrieval + LLM TTFT), there's a multi-
            second gap where streamingText is "" — not undefined. The
            previous condition (=== undefined) hid the indicator during
            exactly the window when feedback matters most. Show a real
            bubble so the user can see the character is composing. */}
        {isThinking &&
          (streamingText === undefined || streamingText.length === 0) && (
            <ThinkingBubble characterName={characterName} />
          )}
      </div>
      </div>

      {slashMatches.length > 0 && (
        <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-1.5 text-[11px] space-y-0.5">
          <p className="text-neutral-500 uppercase tracking-wider text-[9px] mb-1">
            Slash commands
          </p>
          {slashMatches.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => {
                setDraft("/" + c.name + " ");
                taRef.current?.focus();
              }}
              className="block w-full text-left rounded px-2 py-1 hover:bg-neutral-800/60"
            >
              <span className="text-emerald-400 font-mono">/{c.name}</span>
              <span className="text-neutral-500 ml-2">{c.description}</span>
            </button>
          ))}
        </div>
      )}
      {away && (
        <button
          type="button"
          onClick={() => {
            pinned.current = true;
            scrollToBottom(true);
            setAway(false);
          }}
          className="absolute left-1/2 -translate-x-1/2 bottom-36 z-10 rounded-full border border-emerald-500/60 bg-neutral-900/90 backdrop-blur px-3.5 py-1 text-xs text-neutral-100 shadow-lg shadow-black/30 hover:border-emerald-400"
        >
          ↓ newer messages
        </button>
      )}
      {turns.length > 0 && !isThinking && (
        <div className="px-3 sm:px-6 pt-2">
          <div
            className="mx-auto max-w-3xl flex gap-2 overflow-x-auto pb-1"
            role="group"
            aria-label="Steer the story"
          >
            {STEERS.map((st) => (
              <button
                key={st.label}
                type="button"
                title={st.directive}
                onClick={() => void onSend(`((${st.directive}))`)}
                className="shrink-0 rounded-full border border-neutral-700/80 bg-neutral-900/50 px-3 py-1 text-[11px] text-neutral-300 hover:border-emerald-500/70 hover:text-neutral-100"
              >
                <span aria-hidden="true" className="text-emerald-400 mr-1">{st.glyph}</span>
                {st.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <form
        className="px-3 sm:px-6 pb-4 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div
          onDragOver={(e) => {
            if (vision && [...e.dataTransfer.items].some((i) => i.kind === "file")) e.preventDefault();
          }}
          onDrop={(e) => {
            const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
            if (vision && f) {
              e.preventDefault();
              void attach(f);
            }
          }}
          className="mx-auto max-w-3xl rounded-2xl border border-neutral-700/80 bg-neutral-900/85 backdrop-blur shadow-xl shadow-black/25 focus-within:border-emerald-500/70 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-emerald-500)_20%,transparent)] transition-shadow">
          {attachError && (
            <p className="px-4 pt-3 text-[11px] text-rose-300" role="alert">
              {attachError}
            </p>
          )}
          {pending && (
            <div className="flex items-start gap-3 px-3 pt-3">
              <img
                src={pending.thumb}
                alt={pending.attachment?.description || "Attached image"}
                className="h-16 w-16 shrink-0 rounded-lg border border-neutral-700 object-cover"
              />
              <div className="min-w-0 flex-1">
                {pending.status === "describing" ? (
                  <p className="pt-1 text-xs text-emerald-300 animate-pulse">Describing the image… ({vision?.label})</p>
                ) : (
                  <>
                    <label className="block text-[10px] uppercase tracking-wider text-neutral-500">
                      What the story will be told about this image — edit it if it's wrong
                    </label>
                    <textarea
                      value={pending.attachment?.description ?? ""}
                      onChange={(e) => editDescription(e.target.value)}
                      rows={2}
                      className="mt-1 w-full resize-none rounded-md border border-neutral-700 bg-neutral-950/60 px-2 py-1 text-xs text-neutral-100"
                    />
                    {pending.warning && <p className="mt-0.5 text-[11px] text-amber-300">{pending.warning}</p>}
                    {pending.attachment && !pending.attachment.description.trim() && (
                      <p className="mt-0.5 text-[11px] text-neutral-500">Write a short description to send this image.</p>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={removePending}
                aria-label="Remove image"
                title="Remove image"
                className="text-neutral-500 hover:text-rose-300"
              >
                ✕
              </button>
            </div>
          )}
          <textarea
            ref={taRef}
            value={draft}
            onPaste={(e) => {
              const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
              if (vision && f) {
                e.preventDefault();
                void attach(f);
              }
            }}
            onChange={(e) => setDraft(e.target.value)}
            onInput={(e) => {
              // Grow with the message, up to ~8 lines.
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape" && isThinking && onStop) {
                e.preventDefault();
                onStop();
              }
            }}
            placeholder={`Message ${characterName ?? "the character"}…  ( / for commands )`}
            rows={1}
            className="msg-text block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[15px] leading-6 text-neutral-100 placeholder:text-neutral-500 border-0 focus:outline-none focus:!shadow-none focus:!border-transparent"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1">
            <span className="flex items-center gap-2 pl-1 text-[10px] text-neutral-500">
              {vision && (
                <label
                  className="cursor-pointer rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-emerald-500/60 hover:text-neutral-100"
                  title={`Attach an image — it is described by ${vision.label} (paste or drop also works)`}
                >
                  <span aria-hidden="true">📎</span> image
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      void attach(e.currentTarget.files?.[0]);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
              )}
              <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line · (( … )) steers the story</span>
            </span>
            <div className="flex items-center gap-2 ml-auto">
              {onImpersonate && (
                <button
                  type="button"
                  onClick={impersonate}
                  disabled={isThinking || impersonating}
                  title="Have the model suggest what you might say next"
                  className="rounded-lg border border-neutral-700 hover:border-emerald-500/60 disabled:opacity-50 text-neutral-300 hover:text-neutral-100 px-2.5 py-1.5 text-xs"
                >
                  {impersonating ? "…" : "✦ suggest"}
                </button>
              )}
              {isThinking && onStop ? (
                <button
                  type="button"
                  onClick={onStop}
                  title="Stop generating (Esc)"
                  className="rounded-lg border border-rose-500/70 bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 px-3.5 py-1.5 text-sm font-medium"
                >
                  ■ Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  className="rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 disabled:from-neutral-700 disabled:to-neutral-700 disabled:text-neutral-500 text-white px-4 py-1.5 text-sm font-medium shadow-md shadow-black/20"
                >
                  Send ↵
                </button>
              )}
            </div>
          </div>
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
  isHighlighted?: boolean;
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
  isHighlighted,
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
  const showActions = hovered || !CAN_HOVER;

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
      id={`turn-${turn.id}`}
      className={`group flex gap-2 ${isUser ? "justify-end" : "justify-start"} ${
        isHighlighted ? "ring-2 ring-emerald-500/60 rounded-xl" : ""
      } transition-shadow`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isUser &&
        (avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="w-9 h-9 rounded-full object-cover ring-2 ring-neutral-700/60 flex-shrink-0 mt-0.5"
          />
        ) : (
          <div
            className={`w-9 h-9 rounded-full ring-2 ring-neutral-700/60 flex items-center justify-center text-[11px] font-semibold text-white flex-shrink-0 mt-0.5 ${palette[paletteIdx]}`}
          >
            {initials}
          </div>
        ))}
      <div
        className={`relative max-w-[92%] sm:max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-7 msg-text shadow-md shadow-black/20 ${
          isUser
            ? "bg-gradient-to-br from-emerald-600 to-emerald-700 text-emerald-50"
            : "bg-neutral-800/85 border border-neutral-700/60 text-neutral-100"
        }`}
      >
        {!isUser && (
          <p className="text-[10px] uppercase tracking-wider text-neutral-400 mb-0.5 font-semibold">
            {displayName ?? turn.speaker}
          </p>
        )}
        {turn.attachments && turn.attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-2">
            {turn.attachments.map((a) => (
              <AttachmentThumb key={a.id} a={a} />
            ))}
          </div>
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

        {!editing && showActions && (onEdit || onDelete || onRegenerate || onContinue) && (
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
      aria-label={title}
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

// "Character is thinking" bubble — shown from the moment the user
// sends until the first stream chunk lands (or, for non-streaming
// providers, until the final reply replaces it). Three pulsing dots in
// a bubble that mirrors the assistant style so the layout doesn't jump
// when the real reply takes its place.
function ThinkingBubble({ characterName }: { characterName?: string }) {
  return (
    <div
      className="flex justify-start gap-2"
      aria-live="polite"
      aria-label={`${characterName ?? "Character"} is composing a reply`}
    >
      <div className="rounded-xl px-3.5 py-2.5 bg-neutral-800/70 border border-neutral-800">
        <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 font-semibold">
          {characterName ?? "…"}
        </p>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

// Narrator-style row for system turns — dice rolls, /help output, scene
// markers. Centered, muted, but still selectable + deletable so users can
// clean up accidental commands.
function NarratorRow({
  turn,
  onDelete,
}: {
  turn: ChatTurn;
  onDelete?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      id={`turn-${turn.id}`}
      className="group flex justify-center my-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="relative max-w-[92%] sm:max-w-[78%] rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-1.5 text-[12px] text-neutral-400 italic leading-relaxed">
        <div className="prose prose-invert prose-sm max-w-none [&_p]:my-0 [&_p]:text-neutral-400 [&_strong]:text-neutral-200 [&_code]:text-emerald-300">
          <ReactMarkdown>{turn.content}</ReactMarkdown>
        </div>
        {hovered && onDelete && (
          <button
            className="absolute -right-7 top-1.5 text-[10px] text-neutral-600 hover:text-red-400"
            onClick={() => onDelete(turn.id)}
            title="Remove this narrator line"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

/** Openers offered on an empty chat. Plain text with *action* markup — the
 *  same convention the character replies use — so they read naturally. */
const OPENERS: { label: string; text: string }[] = [
  { label: "Set the scene", text: "*I step inside and take a moment to look around.*" },
  { label: "Introduce yourself", text: "Hello. Who are you, and what brings you here?" },
  { label: "Start with a question", text: "*I hesitate at the door.* Can I ask you something?" },
  { label: "Pick up a thread", text: "Tell me about something that's been on your mind lately." },
];

function EmptyChat({
  characterName,
  onPick,
}: {
  characterName?: string;
  onPick: (text: string) => void;
}) {
  const who = characterName ?? "the character";
  return (
    <div className="flex flex-col items-center text-center py-10 sm:py-16 px-2">
      <div
        className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-800 shadow-lg shadow-black/30 flex items-center justify-center text-xl font-semibold text-emerald-50"
        aria-hidden="true"
      >
        {who.charAt(0).toUpperCase()}
      </div>
      <h2 className="mt-4 text-lg font-semibold text-neutral-100">
        Begin your story with {who}
      </h2>
      <p className="mt-1 text-xs text-neutral-400 max-w-sm">
        Everything said here is remembered — facts, feelings and promises carry
        into later scenes. Write your own opening below, or start with one of these.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2 max-w-xl">
        {OPENERS.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => onPick(o.text)}
            title={o.text}
            className="rounded-full border border-neutral-700 bg-neutral-900/60 px-3.5 py-1.5 text-xs text-neutral-200 hover:border-emerald-500/70"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One-click story steering. Each sends an out-of-character directive
 *  ((…)) — the same channel players type by hand — so the model is told what
 *  to do next without it becoming dialogue or a remembered fact. */
const STEERS: { label: string; glyph: string; directive: string }[] = [
  {
    label: "Push the plot",
    glyph: "↗",
    directive:
      "Move the story forward: bring in a development, decision or discovery that changes the situation. Don't wait for me to drive.",
  },
  {
    label: "Add friction",
    glyph: "⚡",
    directive:
      "Let there be real friction: characters may disagree, refuse or push back. Don't smooth things over or agree too quickly.",
  },
  {
    label: "Complication",
    glyph: "✦",
    directive:
      "Introduce a believable complication or obstacle that raises the stakes, consistent with what is already established.",
  },
  {
    label: "Slow down",
    glyph: "◔",
    directive:
      "Slow the pace: linger on this moment, on sensory detail and the characters' inner reactions, before moving on.",
  },
  {
    label: "Time skip",
    glyph: "⏭",
    directive:
      "Skip ahead a short while to the next meaningful moment, summarising what passes in a line or two.",
  },
];

/** A user turn that was only a directive — shown as the director stepping in,
 *  not as something the player said in the story. */
function DirectorRow({
  turn,
  onDelete,
}: {
  turn: ChatTurn;
  onDelete?: (turnId: string) => void | Promise<void>;
}) {
  const note = splitOoc(turn.content).directives.join(" · ");
  return (
    <div id={`turn-${turn.id}`} className="group flex justify-center">
      <div className="relative max-w-[92%] sm:max-w-[80%] rounded-full border border-dashed border-emerald-500/40 bg-emerald-500/10 px-4 py-1.5 text-[12px] text-emerald-200 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-emerald-400/90 font-semibold">
          Director
        </span>
        <span className="italic text-neutral-300">{note}</span>
        {onDelete && (
          <button
            type="button"
            aria-label="delete"
            title="delete"
            onClick={() => void onDelete(turn.id)}
            className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-rose-300 text-[11px]"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/** A shared image in the chat. The bytes come from IndexedDB; the description
 *  is its alt text (and tooltip), so it is readable to screen readers too. */
function AttachmentThumb({ a }: { a: TurnAttachment }) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    void getImage(a.id).then((img) => {
      if (!live) return;
      if (img) setSrc(`data:${img.mime};base64,${img.b64}`);
      else setMissing(true);
    });
    return () => {
      live = false;
    };
  }, [a.id]);
  if (missing) {
    return (
      <span className="rounded-md border border-dashed border-neutral-600 px-2 py-1 text-[11px] text-neutral-400" title={a.description}>
        image not stored on this device — {a.description.slice(0, 60)}
      </span>
    );
  }
  return src ? (
    <img src={src} alt={a.description} title={a.description} className="max-h-44 max-w-full rounded-lg border border-white/10 object-cover" />
  ) : (
    <span className="block h-20 w-28 animate-pulse rounded-lg bg-white/10" aria-hidden="true" />
  );
}
