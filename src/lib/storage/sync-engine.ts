// Keeps the browser's working copy of the app's data in step with the durable
// copy on the server. Pure logic behind three small interfaces so every
// scenario — first sync, new device, conflict, offline, quota — can be tested
// without a browser or a network.
//
// Rules (the order matters):
//   1. Sync only ever COPIES. Local data is never deleted because the server
//      lacks it, and never overwritten without the older value being kept.
//   2. Two sides changed → neither is silently lost: the loser is stashed on
//      the server. Which side wins is decided by revisions, never by clocks.
//   3. A local write that fails (quota) is still pushed, so it is durable; the
//      engine then remembers what local really holds so it can't later mistake
//      the stale local value for a newer edit.
//   4. Never sync secrets (the allowlist decides), and never sync our own
//      bookkeeping.

export interface KeyMeta {
  /** Server revision this device last saw for the key. */
  rev: number;
  /** Fingerprint of what THIS device held at that time (see fingerprint()). */
  hash: string;
  /** Changed here and not yet confirmed on the server. Persisted. */
  dirty?: boolean;
}

export interface RemoteResult {
  ok: boolean;
  rev?: number;
  conflict?: boolean;
}

export interface RemoteStore {
  manifest(): Promise<Record<string, { rev: number; deleted?: boolean }>>;
  get(key: string): Promise<{ value: string | null; rev: number; deleted?: boolean } | null>;
  put(key: string, value: string, o: { base_rev?: number; force?: boolean }): Promise<RemoteResult>;
  del(key: string, o: { base_rev?: number; force?: boolean }): Promise<RemoteResult>;
  /** Keep a copy of a value that lost a first-time conflict. */
  stash(key: string, value: string): Promise<void>;
}

/** The browser's localStorage, WITHOUT the sync hook (so the engine's own
 *  writes are not mistaken for the user's). set() may throw on quota. */
export interface LocalKV {
  keys(): string[];
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface MetaStore {
  load(): Record<string, KeyMeta>;
  save(meta: Record<string, KeyMeta>): void;
}

export type SyncState = "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  /** Keys changed here and not yet confirmed on the server. */
  pending: number;
  /** Keys that exist on the server but are not cached in this browser. */
  notCached: number;
  /** Times a key had different versions on both sides (loser stashed). */
  conflicts: number;
  lastSyncAt?: number;
  lastError?: string;
}

export interface ReconcileSummary {
  pushed: number;
  pulled: number;
  conflicts: number;
  notCached: number;
}

/** FNV-1a — a cheap fingerprint to notice that a value changed. Not security. */
export function fingerprint(value: string | null): string {
  if (value === null) return "∅";
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${value.length}:${h.toString(16)}`;
}

/** What is durable: chats and the state that belongs to them. Anything not
 *  matched here — including the config (API keys), MCP server tokens, theme
 *  and other per-device preferences — never leaves the browser. */
const SYNCED = [
  /^chronicler\.sessions\.v1$/,
  /^chronicler\.session\.[^.]+\.turns$/,
  /^chronicler\.characters\.v1$/,
  /^chronicler\.worlds\.v1$/,
  /^chronicler\.scene\.v1\./,
  /^chronicler\.ledger\.v1\./,
  /^chronicler\.chronicle\.v1\./,
  /^chronicler\.audit\.(v1|traits\.v1)\./,
  /^chronicler\.identity_notes_v1\./,
  /^chronicler\.character_pref_settings_v1\./,
  /^chronicler\.mcp\.character_(resources|gating)_v1\./,
  /^chronicler\.skill_overrides$/,
  /^chronicler\.skill\.(outcome_mirror|core_trait_promotions)\.v1$/,
  /^chronicler\.thread_overrides_v1$/,
  /^chronicler\.arc_overrides_v1$/,
  /^chronicler\.intensity_snippets_v1$/,
  /^chronicler\.grimoire\.(storage|settings)\./,
];
export const isSyncedKey = (key: string): boolean => SYNCED.some((r) => r.test(key));

/** Chats are the bulk of the data and are safe to drop from the browser cache
 *  (the server has them) when it fills up; nothing else is evicted. */
const EVICTABLE = /^chronicler\.session\.[^.]+\.turns$/;

export class SyncEngine {
  private meta: Record<string, KeyMeta>;
  /** Latest value attempted for a key — pushed even if the local write failed. */
  private pending = new Map<string, string | null>();
  private remoteKeys = new Set<string>();
  private pinned = new Set<string>();
  private listeners = new Set<(s: SyncStatus) => void>();
  private conflicts = 0;
  private notCached = 0;
  private state: SyncState = "idle";
  private lastSyncAt: number | undefined;
  private lastError: string | undefined;
  private flushing: Promise<void> | null = null;

  constructor(
    private local: LocalKV,
    private remote: RemoteStore,
    private metaStore: MetaStore,
    private include: (key: string) => boolean = isSyncedKey
  ) {
    this.meta = metaStore.load();
  }

  // ---- status ----

  status(): SyncStatus {
    return {
      state: this.state,
      pending: Object.values(this.meta).filter((m) => m.dirty).length,
      notCached: this.notCached,
      conflicts: this.conflicts,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    };
  }

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(state?: SyncState): void {
    if (state) this.state = state;
    const s = this.status();
    this.listeners.forEach((l) => l(s));
  }

  private saveMeta(): void {
    try {
      this.metaStore.save(this.meta);
    } catch {
      // bookkeeping that can't be persisted degrades to in-memory for this page
    }
  }

  /** Keep the session being read out of the eviction pool. */
  pin(key: string | null): void {
    this.pinned.clear();
    if (key) this.pinned.add(key);
  }

  // ---- called by the storage hook ----

  noteWrite(key: string, value: string): void {
    if (!this.include(key)) return;
    this.pending.set(key, value);
    this.meta[key] = { rev: this.meta[key]?.rev ?? 0, hash: this.meta[key]?.hash ?? fingerprint(null), dirty: true };
    this.saveMeta();
    this.emit();
  }

  noteRemove(key: string): void {
    if (!this.include(key)) return;
    this.pending.set(key, null);
    this.meta[key] = { rev: this.meta[key]?.rev ?? 0, hash: this.meta[key]?.hash ?? fingerprint(null), dirty: true };
    this.saveMeta();
    this.emit();
  }

  // ---- pushing ----

  /** Push every dirty key. Resolves when done; network failure leaves keys
   *  dirty for the next attempt. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const dirty = Object.keys(this.meta).filter((k) => this.meta[k].dirty && this.include(k));
    if (dirty.length === 0) return;
    this.emit("syncing");
    try {
      for (const key of dirty) await this.pushKey(key);
      this.lastSyncAt = Date.now();
      this.lastError = undefined;
      this.emit("idle");
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.emit("offline");
    }
  }

  private async pushKey(key: string): Promise<void> {
    const attempted = this.pending.has(key) ? this.pending.get(key)! : this.local.get(key);
    const m = this.meta[key];
    const send = (force: boolean) =>
      attempted === null
        ? this.remote.del(key, { base_rev: m.rev || undefined, force })
        : this.remote.put(key, attempted, { base_rev: m.rev || undefined, force });
    let r = await send(false);
    if (!r.ok && r.conflict) {
      // The server has a revision this device never saw. This device's edit is
      // the user's latest action, so it wins — and the server keeps what it
      // replaced under conflicts/.
      this.conflicts++;
      r = await send(true);
    }
    if (!r.ok) throw new Error(`server refused ${key}`);
    // Record what THIS device really holds, which differs from `attempted` when
    // the local write failed (quota). That keeps a later start-up from taking
    // the stale local value for a fresh edit.
    this.meta[key] = { rev: r.rev ?? m.rev, hash: fingerprint(this.local.get(key)), dirty: false };
    attempted === null ? this.remoteKeys.delete(key) : this.remoteKeys.add(key);
    this.pending.delete(key);
    this.saveMeta();
  }

  // ---- start-up reconciliation ----

  async reconcile(): Promise<ReconcileSummary> {
    const sum: ReconcileSummary = { pushed: 0, pulled: 0, conflicts: 0, notCached: 0 };
    this.emit("syncing");
    let manifest: Record<string, { rev: number; deleted?: boolean }>;
    try {
      manifest = await this.remote.manifest();
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.emit("offline");
      return sum;
    }
    this.remoteKeys = new Set(Object.entries(manifest).filter(([, v]) => !v.deleted).map(([k]) => k));
    const localKeys = this.local.keys().filter((k) => this.include(k));
    const all = new Set([...localKeys, ...Object.keys(manifest).filter((k) => this.include(k))]);

    try {
      for (const key of all) {
        const r = manifest[key];
        const l = this.local.get(key);
        const m = this.meta[key];
        const remoteLive = !!r && !r.deleted;

        // Did this device change the key while sync wasn't watching?
        const changedHere = !!m && (m.dirty || fingerprint(l) !== m.hash);

        if (!m) {
          // Never synced on this device.
          if (l !== null && !remoteLive && !r) {
            await this.pushLocal(key, l, undefined);
            sum.pushed++;
          } else if (l === null && remoteLive) {
            if (await this.pull(key)) sum.pulled++;
            else sum.notCached++;
          } else if (l !== null && remoteLive) {
            const remoteVal = await this.remote.get(key);
            if (remoteVal && remoteVal.value === l) {
              this.meta[key] = { rev: remoteVal.rev, hash: fingerprint(l) };
            } else if (remoteVal) {
              // Both sides have a different value and no shared history: keep
              // the server's (it is the durable copy) and stash ours.
              await this.remote.stash(key, l);
              this.conflicts++;
              sum.conflicts++;
              this.meta[key] = { rev: remoteVal.rev, hash: fingerprint(l) };
              if (await this.pull(key)) sum.pulled++;
            }
          } else if (l !== null && r?.deleted) {
            // Deleted elsewhere but still held here: treat as a new local value.
            await this.pushLocal(key, l, r.rev);
            sum.pushed++;
          }
          continue;
        }

        if (changedHere) {
          if (!r || r.rev === m.rev) {
            l === null ? await this.pushDelete(key, m.rev) : await this.pushLocal(key, l, m.rev || undefined);
            sum.pushed++;
          } else {
            // Changed here AND on the server: this device's edit wins; the
            // server's version is stashed by the forced push.
            this.conflicts++;
            sum.conflicts++;
            l === null ? await this.pushDelete(key, m.rev, true) : await this.pushLocal(key, l, m.rev, true);
            sum.pushed++;
          }
          continue;
        }

        // Unchanged here.
        if (!r && l !== null) {
          // The server has lost this key (wiped volume, restored backup…). The
          // browser copy is now the only one: put it back.
          await this.pushLocal(key, l, undefined);
          sum.pushed++;
          continue;
        }
        if (r && r.rev > m.rev) {
          if (r.deleted) {
            this.local.remove(key); // deleted on another device
            this.meta[key] = { rev: r.rev, hash: fingerprint(null) };
          } else if (await this.pull(key)) sum.pulled++;
          else sum.notCached++;
        } else if (l === null && remoteLive) {
          sum.notCached++; // cold: on the server, not cached in this browser
        }
      }
      this.notCached = sum.notCached;
      this.lastSyncAt = Date.now();
      this.lastError = undefined;
      this.saveMeta();
      this.emit("idle");
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.saveMeta();
      this.emit("offline");
    }
    return sum;
  }

  private async pushLocal(key: string, value: string, base_rev: number | undefined, force = false): Promise<void> {
    const r = await this.remote.put(key, value, { base_rev, force });
    if (!r.ok) throw new Error(`server refused ${key}`);
    this.remoteKeys.add(key);
    this.meta[key] = { rev: r.rev ?? 0, hash: fingerprint(value) };
  }

  private async pushDelete(key: string, base_rev: number, force = false): Promise<void> {
    const r = await this.remote.del(key, { base_rev, force });
    if (!r.ok) throw new Error(`server refused delete of ${key}`);
    this.remoteKeys.delete(key);
    this.meta[key] = { rev: r.rev ?? 0, hash: fingerprint(null) };
  }

  /** Copy the server's value into the browser. False if it would not fit. */
  private async pull(key: string): Promise<boolean> {
    const got = await this.remote.get(key);
    if (!got || got.value === null) return false;
    if (!this.setWithEviction(key, got.value)) return false;
    this.meta[key] = { rev: got.rev, hash: fingerprint(got.value) };
    return true;
  }

  // ---- lazy hydration and quota ----

  /** Make sure a key that lives on the server is cached locally before it is
   *  read. True if it is available afterwards. */
  async ensureLocal(key: string): Promise<boolean> {
    if (this.local.get(key) !== null) return true;
    if (!this.include(key) || !this.remoteKeys.has(key)) return false;
    try {
      const ok = await this.pull(key);
      if (ok) {
        this.notCached = Math.max(0, this.notCached - 1);
        this.saveMeta();
        this.emit();
      }
      return ok;
    } catch {
      return false;
    }
  }

  /** Try a write; if the browser is full, drop cold chats that the server has
   *  (never unsynced ones, never the pinned one) and retry. */
  setWithEviction(key: string, value: string): boolean {
    try {
      this.local.set(key, value);
      return true;
    } catch {
      return this.evictThenSet(key, value);
    }
  }

  private evictThenSet(key: string, value: string): boolean {
    const candidates = this.local
      .keys()
      .filter((k) => EVICTABLE.test(k) && k !== key && !this.pinned.has(k) && this.meta[k] && !this.meta[k].dirty && this.meta[k].rev > 0 && this.remoteKeys.has(k))
      .sort((a, b) => (this.local.get(b)?.length ?? 0) - (this.local.get(a)?.length ?? 0));
    for (const k of candidates.slice(0, 20)) {
      this.local.remove(k); // raw: not a user deletion, the server keeps it
      this.meta[k] = { rev: this.meta[k].rev, hash: fingerprint(null) };
      this.notCached++;
      try {
        this.local.set(key, value);
        this.saveMeta();
        this.emit();
        return true;
      } catch {
        /* keep evicting */
      }
    }
    this.saveMeta();
    return false;
  }

  /** Used by the hook: a write that hit the quota. */
  handleQuota(key: string, value: string): boolean {
    if (!this.include(key)) return false;
    return this.evictThenSet(key, value);
  }
}
