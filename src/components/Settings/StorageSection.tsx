// Settings → Storage. Where your chats live and whether they are safe.

import { useEffect, useState } from "react";
import { getSyncEngine, syncAvailable, type SyncStatus } from "../../lib/storage/sync";

interface ServerInfo {
  dir: string;
  keys: number;
  bytes: number;
}

const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function useSyncStatus(): SyncStatus | null {
  const [s, setS] = useState<SyncStatus | null>(() => getSyncEngine()?.status() ?? null);
  useEffect(() => {
    const eng = getSyncEngine();
    if (!eng) return;
    setS(eng.status());
    return eng.onStatus(setS);
  }, []);
  return s;
}

export function StorageSection() {
  const status = useSyncStatus();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [images, setImages] = useState<{ count: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    try {
      const [a, b] = await Promise.all([fetch("/api/store/info"), fetch("/api/attachments")]);
      if (a.ok) setInfo(await a.json());
      if (b.ok) {
        const j = await b.json();
        setImages({ count: j.hashes.length, bytes: j.bytes });
      }
    } catch {
      /* no server */
    }
  }
  useEffect(() => {
    if (syncAvailable()) void load();
  }, [status?.lastSyncAt]);

  return (
    <div>
      <h3 className="text-sm font-semibold text-neutral-200 mb-2">Storage</h3>
      <div className="border border-neutral-800 rounded-md p-3 bg-neutral-950 space-y-2">
        {!syncAvailable() ? (
          <p className="text-[12px] text-neutral-400 leading-relaxed">
            Your chats are stored only in this browser (no Chronicler storage server was found — this is normal in
            development mode). They can be lost if you clear this site's data. Use <em>Export backup</em> regularly.
          </p>
        ) : (
          <>
            <p className="text-[12px] text-neutral-300 leading-relaxed">
              Chats, characters and scene state are copied to the Chronicler server a moment after every change, so
              clearing your browser's data does not lose them. API keys and other settings that hold secrets stay in
              this browser only.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
              <span className={status?.state === "offline" || status?.state === "error" ? "text-amber-300" : "text-emerald-300"}>
                {status?.state === "syncing"
                  ? "● saving…"
                  : status?.state === "offline"
                  ? `● server unreachable — ${status.pending} change${status.pending === 1 ? "" : "s"} kept on this device`
                  : status && status.pending > 0
                  ? `● ${status.pending} change${status.pending === 1 ? "" : "s"} waiting to save`
                  : "● everything is saved"}
              </span>
              {status?.lastSyncAt && <span className="text-neutral-500">last sync {new Date(status.lastSyncAt).toLocaleTimeString()}</span>}
              {status && status.notCached > 0 && (
                <span className="text-neutral-500" title="Older chats are kept on the server and loaded when opened">
                  {status.notCached} older chat{status.notCached === 1 ? "" : "s"} kept on the server only
                </span>
              )}
              {status && status.conflicts > 0 && (
                <span className="text-amber-300" title="Both this browser and the server had different versions; the loser is kept in the server's conflicts folder">
                  {status.conflicts} conflict{status.conflicts === 1 ? "" : "s"} resolved (nothing lost)
                </span>
              )}
            </div>
            {info && (
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                On the server: {info.keys} items, {mb(info.bytes)}
                {images ? `, including ${images.count} image${images.count === 1 ? "" : "s"} (${mb(images.bytes)})` : ""}. Folder:{" "}
                <code className="text-neutral-400">{info.dir}</code>
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await getSyncEngine()?.reconcile();
                await getSyncEngine()?.flush();
                await load();
                setBusy(false);
              }}
              className="rounded-md border border-neutral-700 hover:border-emerald-500/60 px-3 py-1 text-xs text-neutral-200 disabled:opacity-50"
            >
              {busy ? "Syncing…" : "Sync now"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
