// Shown when the server is newer than the page you have open (see lib/ui/update-check.ts). It never reloads by itself —
// that could lose a message you are typing — it just says so and offers the button.

import { useEffect, useState } from "react";
import { fetchServerVersion, isUpdateAvailable } from "../../lib/ui/update-check";

const RECHECK_MS = 5 * 60_000;

export function UpdateBar() {
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () => void fetchServerVersion().then((v) => alive && v && setServer(v));
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const t = window.setInterval(check, RECHECK_MS);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(t);
    };
  }, []);
  if (!isUpdateAvailable(__APP_VERSION__, server)) return null;
  return (
    <div role="alert" className="px-6 py-2 bg-sky-900/50 border-b border-sky-700/70 text-sky-100 text-xs flex items-center justify-between gap-4">
      <span>
        <strong className="font-semibold">Chronicler was updated</strong> — the server is now v{server}, but this page is still v{__APP_VERSION__}.
        Reload to use the new version. Your chats are saved.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded border border-sky-500/60 px-2.5 py-1 font-medium text-sky-50 hover:bg-sky-800/60"
      >
        reload
      </button>
    </div>
  );
}
