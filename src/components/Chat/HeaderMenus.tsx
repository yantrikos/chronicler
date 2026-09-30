// Header popovers: a live theme switcher and a "more" overflow menu.
//
// The theme menu is a popover rather than a modal on purpose — a modal dims
// the whole app, which hides the very change you are trying to judge.

import { useEffect, useRef, useState } from "react";
import { THEMES, applyTheme, getStoredThemeId } from "../../lib/ui/theme";
import { syncAvailable } from "../../lib/storage/sync";
import { useSyncStatus } from "../Settings/StorageSection";

/** Open/close state that also closes on outside click and Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const CHIP =
  "text-xs rounded-lg border border-neutral-700/70 bg-neutral-900/40 hover:border-emerald-500/60 text-neutral-300 hover:text-neutral-100 px-2.5 py-1.5 flex items-center gap-1.5";

export function ThemeMenu() {
  const { open, setOpen, ref } = usePopover();
  const [active, setActive] = useState(getStoredThemeId);
  const current = THEMES.find((t) => t.id === active) ?? THEMES[0];

  function choose(id: string): void {
    applyTheme(id, { persist: true });
    setActive(id);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={CHIP}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Change theme"
      >
        <span
          className="w-3.5 h-3.5 rounded-full border border-white/20"
          style={{
            background: `linear-gradient(135deg, ${current.swatch[1]} 0 50%, ${current.swatch[2]} 50% 100%)`,
          }}
          aria-hidden="true"
        />
        <span className="hidden sm:inline">{current.name}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-[280px] rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/40 p-2 z-40"
        >
          <p className="px-2 pt-1 pb-2 text-[10px] uppercase tracking-wider text-neutral-500">
            Theme
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {THEMES.map((t) => {
              const selected = t.id === active;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => choose(t.id)}
                  className={`text-left rounded-lg border p-2 ${
                    selected
                      ? "border-emerald-500 bg-emerald-500/15"
                      : "border-neutral-700 hover:border-neutral-500"
                  }`}
                >
                  <div
                    className="h-7 rounded-md flex items-end gap-1 p-1 border border-black/20"
                    style={{ background: t.swatch[0] }}
                    aria-hidden="true"
                  >
                    <span className="flex-1 h-3 rounded-sm" style={{ background: t.swatch[1] }} />
                    <span className="w-5 h-3 rounded-sm" style={{ background: t.swatch[2] }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs font-medium text-neutral-100">{t.name}</span>
                    <span className="text-[9px] text-neutral-500">{t.mode}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function MoreMenu({
  onImportCard,
  onOpenPrompt,
  onOpenGrimoire,
  onOpenHelp,
  onOpenAudit,
}: {
  onImportCard: (file: File) => void;
  onOpenPrompt: () => void;
  onOpenGrimoire: () => void;
  onOpenHelp: () => void;
  onOpenAudit: () => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const item =
    "w-full text-left px-3 py-2 text-xs text-neutral-200 flex items-center gap-2.5 cursor-pointer";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`${CHIP} w-8 justify-center`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="More actions"
        title="More"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl shadow-black/40 py-1.5 z-40 overflow-hidden"
        >
          {/* A <label> so the native file picker opens; the menu stays open
              until a file is chosen, otherwise unmounting the input would
              drop the change event. */}
          <label className={item}>
            <span aria-hidden="true">＋</span> Import character card
            <input
              type="file"
              accept=".png,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) onImportCard(f);
                setOpen(false);
              }}
            />
          </label>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              onOpenPrompt();
            }}
          >
            <span aria-hidden="true">⌘</span> Inspect last prompt
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              onOpenAudit();
            }}
          >
            <span aria-hidden="true">◎</span> Check character consistency
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              onOpenGrimoire();
            }}
          >
            <span aria-hidden="true">✦</span> Grimoire plugins
          </button>
          <div className="my-1 border-t border-neutral-800" />
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              onOpenHelp();
            }}
          >
            <span aria-hidden="true">?</span> Keyboard shortcuts
          </button>
        </div>
      )}
    </div>
  );
}

/** A quiet indicator that your chats are safe on the server. Hidden when there
 *  is no storage server; turns amber when changes are only on this device. */
export function SyncBadge() {
  const s = useSyncStatus();
  if (!syncAvailable() || !s) return null;
  const trouble = s.state === "offline" || s.state === "error";
  const label = s.state === "syncing" ? "saving…" : trouble ? "not saved to server" : s.pending > 0 ? "saving…" : "saved";
  return (
    <span
      className={`hidden md:inline-flex items-center gap-1.5 text-[11px] ${trouble ? "text-amber-300" : "text-neutral-500"}`}
      title={trouble ? `The server is unreachable. ${s.pending} change(s) are kept on this device and will save when it is back.` : "Your chats are saved on the Chronicler server"}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${trouble ? "bg-amber-400" : s.state === "syncing" || s.pending > 0 ? "bg-emerald-400 animate-pulse" : "bg-emerald-500/70"}`} />
      {label}
    </span>
  );
}
