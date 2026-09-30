// Shown whenever no real model is connected. Without it, a browser that has never been set up
// (a second device, a new profile, cleared site data — provider settings are not synced because
// they hold API keys) would still show the user's chats while the built-in mock provider
// answered every message with a placeholder line. That looks exactly like a broken character.

/** The message shown when a send is refused because no model is connected. */
export const NO_MODEL_MESSAGE =
  "No model is connected, so the character can't reply yet. Open settings → Providers, connect one (Ollama, OpenAI, Anthropic…), then send again — your message was kept.";

export function NoModelBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div
      role="alert"
      className="px-6 py-2 bg-amber-900/50 border-b border-amber-700/70 text-amber-100 text-xs flex items-center justify-between gap-4"
    >
      <span>
        <strong className="font-semibold">No model is connected on this browser yet,</strong> so characters can't really reply.
        Your chats are here, but the connection to a model (Ollama, OpenAI, Anthropic…) is set up per browser and isn't
        carried over.
      </span>
      <button
        type="button"
        onClick={onOpenSettings}
        className="shrink-0 rounded border border-amber-500/60 px-2.5 py-1 font-medium text-amber-50 hover:bg-amber-800/60"
      >
        connect a model
      </button>
    </div>
  );
}
