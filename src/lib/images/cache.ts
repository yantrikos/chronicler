// Where generated images live. Each is paid for once (a model call, or money)
// so they are kept in the browser's IndexedDB — localStorage's ~5 MB would hold
// only a handful. Every access is guarded: storage can be blocked (private
// windows) and images are a convenience, so a failure degrades to "regenerate
// next time", never to an error in the chat.

export interface ImageCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, url: string): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

const MAX_ENTRIES = 80;

export class MemoryImageCache implements ImageCache {
  private m = new Map<string, string>();
  constructor(private max = MAX_ENTRIES) {}
  async get(key: string) {
    const v = this.m.get(key);
    if (v !== undefined) {
      this.m.delete(key); // refresh recency
      this.m.set(key, v);
    }
    return v;
  }
  async set(key: string, url: string) {
    this.m.delete(key);
    this.m.set(key, url);
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
  async clear() {
    this.m.clear();
  }
  async count() {
    return this.m.size;
  }
}

const DB = "chronicler-images";
const STORE = "images";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

class IdbImageCache implements ImageCache {
  async get(key: string) {
    const row = (await tx("readonly", (s) => s.get(key))) as { url: string } | undefined;
    return row?.url;
  }
  async set(key: string, url: string) {
    await tx("readwrite", (s) => s.put({ key, url, at: Date.now() }));
    const all = (await tx("readonly", (s) => s.getAll())) as { key: string; at: number }[];
    if (all.length > MAX_ENTRIES) {
      const oldest = all.sort((a, b) => a.at - b.at).slice(0, all.length - MAX_ENTRIES);
      for (const o of oldest) await tx("readwrite", (s) => s.delete(o.key));
    }
  }
  async clear() {
    await tx("readwrite", (s) => s.clear());
  }
  async count() {
    return (await tx("readonly", (s) => s.count())) as number;
  }
}

/** IndexedDB when the browser has it, otherwise (and on any failure) memory. */
export function createImageCache(): ImageCache {
  const memory = new MemoryImageCache();
  if (typeof indexedDB === "undefined") return memory;
  const idb = new IdbImageCache();
  const safe = async <T>(run: () => Promise<T>, fallback: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch {
      return fallback();
    }
  };
  return {
    get: (k) => safe(async () => (await idb.get(k)) ?? memory.get(k), () => memory.get(k)),
    set: async (k, u) => {
      await memory.set(k, u);
      await safe(() => idb.set(k, u), async () => undefined);
    },
    clear: async () => {
      await memory.clear();
      await safe(() => idb.clear(), async () => undefined);
    },
    count: () => safe(() => idb.count(), () => memory.count()),
  };
}
