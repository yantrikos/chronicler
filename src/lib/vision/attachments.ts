// Where shared images' bytes live.
//
//   1. memory            — this page load
//   2. IndexedDB         — this browser (raw bytes, own database, never evicted:
//                          a player's own image must not vanish from a chat)
//   3. the storage server — durable, content-addressed by SHA-256
//
// A put writes to the first two and uploads to the third; a get falls through
// them in order and caches what it finds. Every layer is guarded: with no
// server (Vite dev) or blocked IndexedDB it degrades, it never throws into a
// chat. See server/storage.mjs for the server side.

export interface StoredImage {
  id: string;
  mime: string;
  /** Base64, no data: prefix. */
  b64: string;
}

const DB = "chronicler-attachments";
const STORE = "images";
const memory = new Map<string, StoredImage>();

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- server ----

async function serverPut(img: StoredImage): Promise<boolean> {
  try {
    const bytes = b64ToBytes(img.b64);
    const r = await fetch(`/api/attachments/${img.id}`, { method: "PUT", headers: { "content-type": img.mime }, body: bytes as unknown as BodyInit });
    return r.ok;
  } catch {
    return false;
  }
}

async function serverGet(id: string): Promise<StoredImage | undefined> {
  try {
    const r = await fetch(`/api/attachments/${id}`);
    if (!r.ok) return undefined;
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { id, mime: r.headers.get("content-type") ?? "image/jpeg", b64: bytesToB64(bytes) };
  } catch {
    return undefined;
  }
}

// ---- public ----

export async function putImage(img: StoredImage): Promise<void> {
  memory.set(img.id, img);
  if (typeof indexedDB !== "undefined") {
    try {
      await tx("readwrite", (s) => s.put({ id: img.id, mime: img.mime, bytes: b64ToBytes(img.b64) }));
    } catch {
      // blocked storage: memory and the server still have it
    }
  }
  void serverPut(img); // durable copy; a failure is retried by syncImages()
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  const hit = memory.get(id);
  if (hit) return hit;
  if (typeof indexedDB !== "undefined") {
    try {
      const row = (await tx("readonly", (s) => s.get(id))) as { id: string; mime: string; bytes?: Uint8Array; b64?: string } | undefined;
      if (row) {
        // Rows written by the first version stored base64 directly.
        const img = { id, mime: row.mime, b64: row.b64 ?? bytesToB64(row.bytes!) };
        memory.set(id, img);
        return img;
      }
    } catch {
      // fall through to the server
    }
  }
  const fromServer = await serverGet(id);
  if (fromServer) {
    memory.set(id, fromServer);
    if (typeof indexedDB !== "undefined") {
      try {
        await tx("readwrite", (s) => s.put({ id, mime: fromServer.mime, bytes: b64ToBytes(fromServer.b64) }));
      } catch {
        /* cache only */
      }
    }
  }
  return fromServer;
}

/** Upload any locally stored image the server doesn't have (first sync after
 *  upgrading, or uploads that failed earlier). Never removes anything. */
export async function syncImages(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  try {
    const r = await fetch("/api/attachments");
    if (!r.ok) return 0;
    const onServer = new Set<string>((await r.json()).hashes);
    const ids = (await tx("readonly", (s) => s.getAllKeys())) as string[];
    let up = 0;
    for (const id of ids) {
      if (onServer.has(id)) continue;
      const img = await getImage(id);
      if (img && (await serverPut(img))) up++;
    }
    return up;
  } catch {
    return 0;
  }
}

export async function clearImages(): Promise<void> {
  memory.clear();
  if (typeof indexedDB !== "undefined") {
    try {
      await tx("readwrite", (s) => s.clear());
    } catch {
      /* ignore */
    }
  }
  try {
    await fetch("/api/attachments", { method: "DELETE", headers: { "x-confirm": "clear-all" } });
  } catch {
    /* no server */
  }
}

export async function countImages(): Promise<number> {
  if (typeof indexedDB === "undefined") return memory.size;
  try {
    return (await tx("readonly", (s) => s.count())) as number;
  } catch {
    return memory.size;
  }
}
