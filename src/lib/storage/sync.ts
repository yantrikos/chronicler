// Browser wiring for the sync engine: the HTTP remote, a hook on localStorage
// so existing code keeps working unchanged, a debounced/retrying scheduler, and
// a start-up gate so the app boots with server data already in place.
//
// The app still reads and writes localStorage synchronously, exactly as before.
// Every write to a synced key is noted, and pushed shortly after. If there is
// no server (Vite dev mode, static hosting) all of this quietly stands down.

import { syncImages } from "../vision/attachments";
import { SyncEngine, isSyncedKey, type KeyMeta, type LocalKV, type MetaStore, type RemoteResult, type RemoteStore, type SyncStatus } from "./sync-engine";

const META_KEY = "chronicler.sync.meta";
const FLUSH_DELAY_MS = 1200;
const MAX_BACKOFF_MS = 60_000;

let engine: SyncEngine | null = null;
let available = false;

export const getSyncEngine = (): SyncEngine | null => engine;
/** False when there is no storage server to sync with. */
export const syncAvailable = (): boolean => available;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
}

class HttpRemote implements RemoteStore {
  async manifest() {
    const r = await api("/api/store/manifest");
    if (!r.ok) throw Object.assign(new Error(`manifest ${r.status}`), { status: r.status });
    return (await r.json()).keys as Record<string, { rev: number; deleted?: boolean }>;
  }
  async get(key: string) {
    const r = await api(`/api/store/kv?key=${encodeURIComponent(key)}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`get ${r.status}`);
    return (await r.json()) as { value: string | null; rev: number; deleted?: boolean };
  }
  private async result(r: Response): Promise<RemoteResult> {
    if (r.ok) return { ok: true, rev: (await r.json()).rev };
    if (r.status === 409) return { ok: false, conflict: true, rev: (await r.json()).rev };
    throw new Error(`server ${r.status}`);
  }
  async put(key: string, value: string, o: { base_rev?: number; force?: boolean }) {
    return this.result(await api(`/api/store/kv?key=${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value, base_rev: o.base_rev, force: o.force }) }));
  }
  async del(key: string, o: { base_rev?: number; force?: boolean }) {
    const q = `key=${encodeURIComponent(key)}${o.base_rev !== undefined ? `&base_rev=${o.base_rev}` : ""}${o.force ? "&force=1" : ""}`;
    return this.result(await api(`/api/store/kv?${q}`, { method: "DELETE" }));
  }
  async stash(key: string, value: string) {
    await api("/api/store/stash", { method: "POST", body: JSON.stringify({ key, value }) });
  }
}

/** localStorage as the engine sees it: the ORIGINAL methods, so the engine's
 *  own writes are never mistaken for the user's (and never re-pushed). */
function makeLocal(origSet: Storage["setItem"], origRemove: Storage["removeItem"]): LocalKV {
  return {
    keys() {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("chronicler.")) out.push(k);
      }
      return out;
    },
    get: (k) => localStorage.getItem(k),
    set: (k, v) => origSet.call(localStorage, k, v),
    remove: (k) => origRemove.call(localStorage, k),
  };
}

function makeMetaStore(origSet: Storage["setItem"]): MetaStore {
  return {
    load() {
      try {
        return JSON.parse(localStorage.getItem(META_KEY) ?? "{}") as Record<string, KeyMeta>;
      } catch {
        return {};
      }
    },
    save(meta) {
      origSet.call(localStorage, META_KEY, JSON.stringify(meta));
    },
  };
}

const isQuota = (e: unknown) =>
  e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22);

/** Start syncing. Resolves once the first reconcile is done (or `timeoutMs`
 *  passes) so the caller can render with server data already in place.
 *  Safe to call once at boot; a no-op without a storage server. */
export async function bootSync(opts: { timeoutMs?: number } = {}): Promise<void> {
  if (engine || typeof window === "undefined") return;
  const proto = Storage.prototype;
  const origSet = proto.setItem;
  const origRemove = proto.removeItem;
  const remote = new HttpRemote();

  // Is there a storage server at all? (Vite dev mode has none.)
  try {
    const r = await api("/api/store/manifest");
    if (!r.ok) return;
  } catch {
    return;
  }
  available = true;

  const eng = new SyncEngine(makeLocal(origSet, origRemove), remote, makeMetaStore(origSet));
  engine = eng;
  // Diagnostics handle (read-only use): window.__chroniclerSync.status()
  (window as unknown as Record<string, unknown>).__chroniclerSync = eng;

  let timer: number | undefined;
  let backoff = 3000;
  const schedule = (delay = FLUSH_DELAY_MS) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      await eng.flush();
      const s = eng.status();
      if (s.pending > 0) {
        // Offline (or the server refused): try again, backing off.
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        schedule(backoff);
      } else {
        backoff = 3000;
      }
    }, delay);
  };

  // The hook: same behaviour as before for callers, plus a note to the engine.
  proto.setItem = function (this: Storage, key: string, value: string) {
    if (this !== window.localStorage || !isSyncedKey(key)) return origSet.call(this, key, value);
    try {
      origSet.call(this, key, value);
    } catch (e) {
      // Browser full: drop cold chats the server already has and retry. Either
      // way the value is pushed, so it is durable even if it can't be cached.
      const fitted = isQuota(e) && eng.handleQuota(key, String(value));
      eng.noteWrite(key, String(value));
      schedule();
      if (fitted) return;
      throw e;
    }
    eng.noteWrite(key, String(value));
    schedule();
  };
  proto.removeItem = function (this: Storage, key: string) {
    origRemove.call(this, key);
    if (this === window.localStorage && isSyncedKey(key)) {
      eng.noteRemove(key);
      schedule();
    }
  };

  window.addEventListener("pagehide", () => void eng.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void eng.flush();
  });
  window.addEventListener("online", () => {
    void eng.reconcile().then(() => schedule(500));
  });

  // First reconcile, but never let a slow server block the app for long.
  const first = eng.reconcile();
  await Promise.race([first, new Promise((r) => setTimeout(r, opts.timeoutMs ?? 4000))]);
  void first.then(() => {
    schedule(2000);
    void syncImages();
  });
}

export type { SyncStatus };
