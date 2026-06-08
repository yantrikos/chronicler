// Danger zone — irreversible reset actions. Hidden behind a "show"
// toggle so the buttons aren't a one-misclick foot-gun. Each action
// requires typing a confirmation phrase before it'll fire.
//
// Two scopes:
//   - "Wipe YantrikDB" pages through every memory and forgets each rid.
//     This clears all characters' canon, scene reflex, lorebook entries,
//     preferences — basically everything Chronicler ever wrote.
//   - "Reset local settings" clears every localStorage key under the
//     chronicler.* namespace: persona, providers, sessions, MCP server
//     registry, per-character gating, identity notes, intensity, etc.
//     Plugins on disk (~/.chronicler/plugins/) are NOT touched.

import { useState } from "react";
import type { YantrikClient } from "../../lib/yantrikdb/client";

interface Props {
  client: YantrikClient;
  /** Called after a successful wipe so the parent can reload state.
   *  e.g. window.location.reload(). */
  onWiped?: () => void;
}

export function DangerZone({ client, onWiped }: Props) {
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState<null | "memories" | "localStorage">(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [memoriesConfirm, setMemoriesConfirm] = useState("");
  const [localConfirm, setLocalConfirm] = useState("");

  async function wipeMemories() {
    if (memoriesConfirm !== "WIPE") {
      alert(`Type WIPE in the confirmation box to proceed.`);
      return;
    }
    setBusy("memories");
    setFeedback(null);
    setProgress({ done: 0, total: 0 });
    try {
      const forgotten = await client.wipeAllMemories({
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setFeedback(`✓ Forgot ${forgotten} memories. Reload the page to see a clean state.`);
      setMemoriesConfirm("");
      onWiped?.();
    } catch (e) {
      setFeedback(`✗ Wipe failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      // Leave progress visible so the user can see "564/564".
    }
  }

  function wipeLocalStorage() {
    if (localConfirm !== "RESET") {
      alert(`Type RESET in the confirmation box to proceed.`);
      return;
    }
    if (typeof localStorage === "undefined") return;
    setBusy("localStorage");
    let count = 0;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith("chronicler.")) {
        localStorage.removeItem(key);
        count++;
      }
    }
    setFeedback(
      `✓ Cleared ${count} local settings keys. Reload the page to start fresh.`
    );
    setLocalConfirm("");
    setBusy(null);
  }

  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-rose-300">Danger zone</h3>
          <p className="text-[11px] text-neutral-500 mt-0.5 leading-relaxed">
            Irreversible reset actions. Hidden by default so a misclick can't
            wipe your data.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShown(!shown)}
          className="rounded border border-neutral-700 hover:border-neutral-500 px-2.5 py-1 text-[11px] text-neutral-300"
        >
          {shown ? "hide" : "show"}
        </button>
      </header>

      {shown && (
        <div className="space-y-3 text-[12px]">
          <div className="rounded-md border border-rose-900/60 bg-rose-950/20 p-3 space-y-2">
            <header>
              <h4 className="font-medium text-rose-200">Wipe YantrikDB</h4>
              <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                Forgets every memory — all characters, all sessions, lorebook,
                preferences, world facts. Plugins installed in
                <code className="mx-1 text-emerald-400">~/.chronicler/plugins/</code>
                are NOT affected.
              </p>
            </header>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={memoriesConfirm}
                onChange={(e) => setMemoriesConfirm(e.target.value)}
                placeholder="type WIPE"
                disabled={busy !== null}
                className="flex-1 rounded bg-neutral-900 border border-neutral-700 px-2 py-1 font-mono text-[11px] disabled:opacity-50"
              />
              <button
                type="button"
                onClick={wipeMemories}
                disabled={busy !== null || memoriesConfirm !== "WIPE"}
                className="rounded bg-rose-700 hover:bg-rose-600 text-white px-3 py-1 text-[11px] font-medium disabled:bg-neutral-700 disabled:text-neutral-500"
              >
                {busy === "memories" ? "wiping…" : "wipe memories"}
              </button>
            </div>
            {busy === "memories" && progress && (
              <p className="text-[11px] text-neutral-400 font-mono">
                {progress.done}
                {progress.total > 0 && ` / ${progress.total}`} forgotten
              </p>
            )}
          </div>

          <div className="rounded-md border border-rose-900/60 bg-rose-950/20 p-3 space-y-2">
            <header>
              <h4 className="font-medium text-rose-200">Reset local settings</h4>
              <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                Clears every localStorage key under <code>chronicler.*</code> —
                persona, providers, sessions, MCP server registry, per-character
                gating, intensity, identity notes. Plugin storage and YantrikDB
                memories are not affected.
              </p>
            </header>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={localConfirm}
                onChange={(e) => setLocalConfirm(e.target.value)}
                placeholder="type RESET"
                disabled={busy !== null}
                className="flex-1 rounded bg-neutral-900 border border-neutral-700 px-2 py-1 font-mono text-[11px] disabled:opacity-50"
              />
              <button
                type="button"
                onClick={wipeLocalStorage}
                disabled={busy !== null || localConfirm !== "RESET"}
                className="rounded bg-rose-700 hover:bg-rose-600 text-white px-3 py-1 text-[11px] font-medium disabled:bg-neutral-700 disabled:text-neutral-500"
              >
                reset settings
              </button>
            </div>
          </div>

          {feedback && (
            <p className="text-[12px] text-neutral-300 px-1 py-2">{feedback}</p>
          )}
        </div>
      )}
    </section>
  );
}
