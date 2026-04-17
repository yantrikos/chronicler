// Global keyboard shortcut wiring. Keeps App.tsx light on handler plumbing.

import { useEffect } from "react";

export interface Shortcuts {
  /** ⌘/Ctrl+K — focus the chat textarea (find one on page). */
  onFocusInput?: () => void;
  /** Escape — dismiss any open modal/panel. */
  onEscape?: () => void;
  /** ⌘/Ctrl+G — regenerate the last assistant turn. */
  onRegenerateLast?: () => void;
  /** ? — toggle help overlay. */
  onHelp?: () => void;
}

export function useKeyboardShortcuts(sc: Shortcuts): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      // Don't hijack when user is typing in an input or textarea, EXCEPT for
      // Escape which should always work to close modals.
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (e.key === "Escape") {
        sc.onEscape?.();
        return;
      }

      if (typing) return;

      if (isMeta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        sc.onFocusInput?.();
      } else if (isMeta && e.key.toLowerCase() === "g") {
        e.preventDefault();
        sc.onRegenerateLast?.();
      } else if (e.key === "?" && !isMeta) {
        e.preventDefault();
        sc.onHelp?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sc.onFocusInput, sc.onEscape, sc.onRegenerateLast, sc.onHelp]);
}
