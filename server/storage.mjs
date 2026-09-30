// Durable storage for Chronicler: a key-value store for the app's data (chats,
// characters, scene boards…) and a content-addressed store for shared images.
//
// Why it exists: the browser is a poor place to keep the only copy of a long
// roleplay — localStorage is capped at ~5 MB, is per-browser, and vanishes with
// "clear site data". The browser stays the working copy; this is the durable one.
//
// Guarantees, in priority order:
//   1. Never lose data. Writes are atomic (temp file + rename); the previous
//      version of a key is kept as .prev; a forced overwrite of a different
//      revision stashes what it replaced under conflicts/; deletes are
//      tombstones, and the value survives in .prev.
//   2. Never write outside the data directory. File names are hashes; keys and
//      hashes are validated; nothing user-supplied becomes a path.
//   3. Never store secrets. Keys holding API keys / auth tokens are refused
//      here as well as filtered in the client.
//   4. Bounded. Per-value, per-image and whole-store size caps.
//   5. Not open to other websites. Requests carrying a foreign Origin are
//      refused (a page on another origin must not read or write your chats).
//
// Layout under CHRONICLER_DATA_DIR:
//   kv/<h2>/<sha256(key)>.json        {key, value, rev, updated_at, deleted}
//   kv/<h2>/<sha256(key)>.json.prev   the version before the latest write
//   conflicts/<sha>-<ts>.json         values replaced by a forced write
//   attachments/<h2>/<sha256>.bin     raw image bytes, named by their hash

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";

const KEY_RE = /^chronicler\.[A-Za-z0-9_.:\-]{1,200}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
// Keys that hold secrets must never reach the server's disk.
const DENY_KEYS = [/^chronicler\.config\.v1$/, /^chronicler\.mcp\.servers\.v1$/, /^chronicler\.sync\./];

const MAX_VALUE_BYTES = Number(process.env.CHRONICLER_MAX_VALUE_BYTES ?? 8 * 1024 * 1024);
const MAX_IMAGE_BYTES = Number(process.env.CHRONICLER_MAX_IMAGE_BYTES ?? 12 * 1024 * 1024);
const MAX_STORE_BYTES = Number(process.env.CHRONICLER_MAX_STORE_BYTES ?? 4 * 1024 * 1024 * 1024);

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Image type from magic bytes — never trust the client's content-type. */
export function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

export class Storage {
  constructor(dir) {
    this.dir = dir;
    /** key -> {rev, bytes, deleted, updated_at, file} — rebuilt from disk at start */
    this.index = new Map();
    this.storeBytes = 0;
    this.locks = new Map();
  }

  async init() {
    await mkdir(join(this.dir, "kv"), { recursive: true });
    await mkdir(join(this.dir, "conflicts"), { recursive: true });
    await mkdir(join(this.dir, "attachments"), { recursive: true });
    for (const h2 of await readdir(join(this.dir, "kv"))) {
      let names;
      try {
        names = await readdir(join(this.dir, "kv", h2));
      } catch {
        continue;
      }
      for (const n of names) {
        if (!n.endsWith(".json")) continue;
        try {
          const file = join(this.dir, "kv", h2, n);
          const doc = JSON.parse(await readFile(file, "utf8"));
          if (typeof doc.key !== "string") continue;
          const bytes = Buffer.byteLength(doc.value ?? "", "utf8");
          this.index.set(doc.key, { rev: doc.rev, bytes, deleted: !!doc.deleted, updated_at: doc.updated_at, file });
          this.storeBytes += bytes;
        } catch {
          // A torn file can only be a temp leftover; the real file is atomic.
        }
      }
    }
  }

  static validKey(key) {
    return typeof key === "string" && KEY_RE.test(key) && !DENY_KEYS.some((r) => r.test(key));
  }

  fileFor(key) {
    const h = sha256(key);
    return join(this.dir, "kv", h.slice(0, 2), `${h}.json`);
  }

  /** Serialise operations per key so two writes can't interleave. */
  async withLock(key, fn) {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release;
    const next = new Promise((r) => (release = r));
    this.locks.set(key, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }

  manifest() {
    const keys = {};
    for (const [k, v] of this.index) keys[k] = { rev: v.rev, bytes: v.bytes, deleted: v.deleted, updated_at: v.updated_at };
    return { server_time: new Date().toISOString(), keys };
  }

  async get(key) {
    const meta = this.index.get(key);
    if (!meta) return null;
    const doc = JSON.parse(await readFile(meta.file, "utf8"));
    return { key, value: doc.deleted ? null : doc.value, rev: doc.rev, deleted: !!doc.deleted, updated_at: doc.updated_at };
  }

  async writeDoc(file, doc) {
    await mkdir(join(file, ".."), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    await writeFile(tmp, JSON.stringify(doc), "utf8");
    try {
      await copyFile(file, `${file}.prev`); // keep the version we are about to replace
    } catch {
      // first write: nothing to keep
    }
    await rename(tmp, file); // atomic: readers see the old file or the new one, never half
  }

  /** Write (or tombstone) a key. base_rev guards against clobbering a newer
   *  revision; `force` overrides but stashes what it replaces. */
  async put(key, value, { base_rev, force = false, deleted = false } = {}) {
    if (!deleted && Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) return { ok: false, status: 413, error: "value too large" };
    return this.withLock(key, async () => {
      const cur = this.index.get(key);
      const curRev = cur?.rev ?? 0;
      if (cur && base_rev !== curRev && !force) return { ok: false, status: 409, conflict: true, rev: curRev };
      const bytes = deleted ? 0 : Buffer.byteLength(value, "utf8");
      if (this.storeBytes - (cur?.bytes ?? 0) + bytes > MAX_STORE_BYTES) return { ok: false, status: 507, error: "storage full" };
      if (cur && base_rev !== curRev && force) {
        // Overwriting a revision the writer had not seen: keep what it replaced.
        try {
          await copyFile(cur.file, join(this.dir, "conflicts", `${sha256(key).slice(0, 16)}-${Date.now()}.json`));
        } catch {
          // best effort
        }
      }
      const rev = curRev + 1;
      const updated_at = new Date().toISOString();
      const file = this.fileFor(key);
      await this.writeDoc(file, { key, value: deleted ? null : value, rev, updated_at, deleted });
      this.storeBytes += bytes - (cur?.bytes ?? 0);
      this.index.set(key, { rev, bytes, deleted, updated_at, file });
      return { ok: true, status: 200, rev };
    });
  }

  /** Keep a copy of a value that lost a first-time conflict, so nothing is lost. */
  async stash(key, value) {
    const name = `${sha256(key).slice(0, 16)}-${Date.now()}-stash.json`;
    await writeFile(join(this.dir, "conflicts", name), JSON.stringify({ key, value, stashed_at: new Date().toISOString() }), "utf8");
    return { ok: true, status: 200 };
  }

  // ---- attachments (content-addressed) ----

  attachmentPath(hash) {
    return join(this.dir, "attachments", hash.slice(0, 2), `${hash}.bin`);
  }

  async putAttachment(hash, buf) {
    if (!HASH_RE.test(hash)) return { ok: false, status: 400, error: "bad hash" };
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: "image size out of range" };
    if (!sniffImage(buf)) return { ok: false, status: 415, error: "not a supported image (jpeg/png/webp)" };
    if (sha256(buf) !== hash) return { ok: false, status: 400, error: "hash does not match the bytes" };
    const file = this.attachmentPath(hash);
    try {
      await stat(file);
      return { ok: true, status: 200, existed: true }; // same bytes already stored
    } catch {
      /* not stored yet */
    }
    if (this.storeBytes + buf.length > MAX_STORE_BYTES) return { ok: false, status: 507, error: "storage full" };
    await mkdir(join(file, ".."), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    await writeFile(tmp, buf);
    await rename(tmp, file);
    this.storeBytes += buf.length;
    return { ok: true, status: 201 };
  }

  async getAttachment(hash) {
    if (!HASH_RE.test(hash)) return null;
    try {
      const buf = await readFile(this.attachmentPath(hash));
      return { buf, mime: sniffImage(buf) ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async listAttachments() {
    const out = [];
    let bytes = 0;
    for (const h2 of await readdir(join(this.dir, "attachments"))) {
      let names = [];
      try {
        names = await readdir(join(this.dir, "attachments", h2));
      } catch {
        continue;
      }
      for (const n of names) {
        if (!n.endsWith(".bin")) continue;
        out.push(n.slice(0, -4));
        try {
          bytes += (await stat(join(this.dir, "attachments", h2, n))).size;
        } catch {
          /* raced with a delete */
        }
      }
    }
    return { hashes: out, bytes };
  }

  async clearAttachments() {
    const { hashes, bytes } = await this.listAttachments();
    for (const h of hashes) await rm(this.attachmentPath(h), { force: true });
    this.storeBytes = Math.max(0, this.storeBytes - bytes);
    return { removed: hashes.length };
  }

  info() {
    let live = 0;
    let tombstones = 0;
    for (const v of this.index.values()) (v.deleted ? tombstones++ : live++);
    return { dir: this.dir, keys: live, tombstones, bytes: this.storeBytes, max_bytes: MAX_STORE_BYTES };
  }
}

// ---------------------------------------------------------------- HTTP layer

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, {
    "content-type": isBuf ? headers["content-type"] ?? "application/octet-stream" : "application/json",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(isBuf ? body : JSON.stringify(body));
}

/** A page on another origin must not be able to read or write chats. Browsers
 *  attach Origin to cross-site requests (and to same-site non-GET ones), so a
 *  present-but-foreign Origin is refused. No Origin (curl, same-origin GET) is
 *  fine — the server is bound to localhost by default. */
function foreignOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

async function body(req, max) {
  const chunks = [];
  let size = 0;
  let tooBig = false;
  await new Promise((resolve, reject) => {
    req.on("data", (c) => {
      size += c.length;
      if (size > max) tooBig = true;
      else chunks.push(c);
    });
    req.on("end", resolve);
    req.on("error", reject);
  });
  return tooBig ? null : Buffer.concat(chunks);
}

/** Returns true if the request was handled. */
export async function handleStorageRequest(storage, req, res) {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  const isStore = path.startsWith("/api/store/");
  const isAtt = path === "/api/attachments" || path.startsWith("/api/attachments/");
  if (!isStore && !isAtt) return false;
  if (foreignOrigin(req)) {
    send(res, 403, { error: "cross-origin request refused" });
    return true;
  }
  try {
    if (isStore) {
      if (path === "/api/store/manifest" && req.method === "GET") return send(res, 200, storage.manifest()), true;
      if (path === "/api/store/info" && req.method === "GET") return send(res, 200, storage.info()), true;
      if (path === "/api/store/stash" && req.method === "POST") {
        const raw = await body(req, MAX_VALUE_BYTES + 4096);
        if (!raw) return send(res, 413, { error: "too large" }), true;
        const j = JSON.parse(raw.toString("utf8"));
        if (!Storage.validKey(j.key) || typeof j.value !== "string") return send(res, 400, { error: "bad stash" }), true;
        return send(res, 200, await storage.stash(j.key, j.value)), true;
      }
      if (path === "/api/store/kv") {
        const key = url.searchParams.get("key");
        if (!Storage.validKey(key)) return send(res, 400, { error: "invalid or forbidden key" }), true;
        if (req.method === "GET") {
          const got = await storage.get(key);
          return got ? send(res, 200, got) : send(res, 404, { error: "not found" }), true;
        }
        if (req.method === "PUT" || req.method === "DELETE") {
          let base_rev;
          let force = false;
          let value = "";
          if (req.method === "PUT") {
            const raw = await body(req, MAX_VALUE_BYTES + 4096);
            if (!raw) return send(res, 413, { error: "value too large" }), true;
            const j = JSON.parse(raw.toString("utf8"));
            if (typeof j.value !== "string") return send(res, 400, { error: "value must be a string" }), true;
            value = j.value;
            base_rev = typeof j.base_rev === "number" ? j.base_rev : undefined;
            force = j.force === true;
          } else {
            const br = url.searchParams.get("base_rev");
            base_rev = br === null ? undefined : Number(br);
            force = url.searchParams.get("force") === "1";
          }
          const r = await storage.put(key, value, { base_rev, force, deleted: req.method === "DELETE" });
          return send(res, r.status, r.ok ? { rev: r.rev } : { error: r.error, conflict: r.conflict, rev: r.rev }), true;
        }
      }
      return send(res, 404, { error: "unknown store endpoint" }), true;
    }

    // attachments
    if (path === "/api/attachments" && req.method === "GET") return send(res, 200, await storage.listAttachments()), true;
    if (path === "/api/attachments" && req.method === "DELETE") {
      if (req.headers["x-confirm"] !== "clear-all") return send(res, 400, { error: "send x-confirm: clear-all" }), true;
      return send(res, 200, await storage.clearAttachments()), true;
    }
    const hash = path.slice("/api/attachments/".length);
    if (!HASH_RE.test(hash)) return send(res, 400, { error: "bad hash" }), true;
    if (req.method === "PUT") {
      const buf = await body(req, MAX_IMAGE_BYTES);
      if (!buf) return send(res, 413, { error: "image too large" }), true;
      const r = await storage.putAttachment(hash, buf);
      return send(res, r.status, r.ok ? { ok: true, existed: !!r.existed } : { error: r.error }), true;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      const a = await storage.getAttachment(hash);
      if (!a) return send(res, 404, { error: "not found" }), true;
      res.writeHead(200, {
        "content-type": a.mime,
        "content-length": a.buf.length,
        // The name IS the content hash, so it can never change: cache forever.
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      });
      res.end(req.method === "HEAD" ? undefined : a.buf);
      return true;
    }
    return send(res, 405, { error: "method not allowed" }), true;
  } catch (err) {
    console.error("[chronicler-storage]", err);
    if (!res.headersSent) send(res, 500, { error: "storage error" });
    return true;
  }
}
