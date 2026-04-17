interface Props {
  onClose: () => void;
}

const SHORTCUTS: Array<[string, string]> = [
  ["⌘K / Ctrl+K", "Focus the chat input"],
  ["⌘G / Ctrl+G", "Regenerate the last reply (new swipe)"],
  ["⌘Enter in edit", "Save an inline message edit"],
  ["Esc", "Close any open modal or panel"],
  ["Enter", "Send message (Shift+Enter for newline)"],
  ["Hover a message", "Reveal edit / delete / regenerate / continue toolbar"],
  ["‹ ›", "On last reply: previous / next swipe (or generate new)"],
  ["?", "Show this help"],
];

export function HelpOverlay({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-lg w-[520px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-100">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-100 text-sm"
          >
            close
          </button>
        </header>
        <div className="p-5">
          <dl className="space-y-2">
            {SHORTCUTS.map(([keys, desc]) => (
              <div
                key={keys}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <dt>
                  <kbd className="font-mono text-[11px] bg-neutral-800 border border-neutral-700 text-neutral-200 px-1.5 py-0.5 rounded">
                    {keys}
                  </kbd>
                </dt>
                <dd className="text-neutral-400 text-right">{desc}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] text-neutral-500 mt-6 pt-3 border-t border-neutral-800">
            Shortcuts don't trigger while you're typing in an input (except
            Esc).
          </p>
        </div>
      </div>
    </div>
  );
}
