// Sync engine — every scenario that could lose data, against fakes.
// Run: npx tsx tests/sync-engine.test.ts

import {
  SyncEngine, fingerprint, isSyncedKey,
  type KeyMeta, type LocalKV, type MetaStore, type RemoteResult, type RemoteStore,
} from "../src/lib/storage/sync-engine";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

class FakeRemote implements RemoteStore {
  docs = new Map<string, { value: string | null; rev: number; deleted?: boolean }>();
  stashes: { key: string; value: string }[] = [];
  forced: string[] = [];
  down = false;
  private guard() { if (this.down) throw new Error("network down"); }
  async manifest() { this.guard(); return Object.fromEntries([...this.docs].map(([k, v]) => [k, { rev: v.rev, deleted: v.deleted }])); }
  async get(key: string) { this.guard(); const d = this.docs.get(key); return d ? { value: d.deleted ? null : d.value, rev: d.rev, deleted: d.deleted } : null; }
  private write(key: string, value: string | null, o: { base_rev?: number; force?: boolean }, deleted: boolean): RemoteResult {
    const cur = this.docs.get(key); const curRev = cur?.rev ?? 0;
    if (cur && o.base_rev !== curRev && !o.force) return { ok: false, conflict: true, rev: curRev };
    if (cur && o.base_rev !== curRev && o.force) this.forced.push(key);
    this.docs.set(key, { value, rev: curRev + 1, deleted });
    return { ok: true, rev: curRev + 1 };
  }
  async put(key: string, value: string, o: { base_rev?: number; force?: boolean }) { this.guard(); return this.write(key, value, o, false); }
  async del(key: string, o: { base_rev?: number; force?: boolean }) { this.guard(); return this.write(key, null, o, true); }
  async stash(key: string, value: string) { this.guard(); this.stashes.push({ key, value }); }
  val(key: string) { const d = this.docs.get(key); return d && !d.deleted ? d.value : undefined; }
}

class FakeLocal implements LocalKV {
  m = new Map<string, string>();
  constructor(public limit = Infinity) {}
  keys() { return [...this.m.keys()]; }
  get(k: string) { return this.m.get(k) ?? null; }
  set(k: string, v: string) {
    const used = [...this.m].reduce((n, [kk, vv]) => n + (kk === k ? 0 : vv.length), 0);
    if (used + v.length > this.limit) throw new Error("QuotaExceededError");
    this.m.set(k, v);
  }
  remove(k: string) { this.m.delete(k); }
}
class FakeMeta implements MetaStore {
  data: Record<string, KeyMeta> = {};
  load() { return JSON.parse(JSON.stringify(this.data)); }
  save(m: Record<string, KeyMeta>) { this.data = JSON.parse(JSON.stringify(m)); }
}

const T = (id: string) => `chronicler.session.${id}.turns`;
const mk = (local = new FakeLocal(), remote = new FakeRemote(), meta = new FakeMeta()) => ({ local, remote, meta, eng: new SyncEngine(local, remote, meta) });

async function main(): Promise<void> {
  console.log("--- what is synced ---");
  check(isSyncedKey("chronicler.sessions.v1") && isSyncedKey(T("abc")) && isSyncedKey("chronicler.characters.v1") && isSyncedKey("chronicler.scene.v1.s1") && isSyncedKey("chronicler.ledger.v1.s1") && isSyncedKey("chronicler.chronicle.v1.s1") && isSyncedKey("chronicler.audit.v1.s1") && isSyncedKey("chronicler.audit.traits.v1.ren"), "chats and their state (story so far, audit results, trait lists) are synced");
  check(!isSyncedKey("chronicler.config.v1") && !isSyncedKey("chronicler.mcp.servers.v1"), "the config (API keys) and MCP tokens are never synced");
  check(!isSyncedKey("chronicler:theme") && !isSyncedKey("chronicler.onboarding_v1_dismissed") && !isSyncedKey("chronicler.sync.meta") && !isSyncedKey("other.key"), "device preferences, our own bookkeeping and foreign keys are not");

  console.log("--- first sync (existing browser data, empty server) ---");
  let a = mk();
  a.local.m.set("chronicler.sessions.v1", '[{"id":"s1"}]');
  a.local.m.set(T("s1"), '["hi"]');
  a.local.m.set("chronicler.config.v1", '{"api_key":"sk-secret"}');
  let sum = await a.eng.reconcile();
  check(sum.pushed === 2 && a.remote.val(T("s1")) === '["hi"]', "existing data is copied to the server");
  check(a.remote.val("chronicler.config.v1") === undefined, "…but the secret-bearing config is not");
  check(a.local.m.size === 3 && a.local.get(T("s1")) === '["hi"]', "local data is untouched");
  sum = await a.eng.reconcile();
  check(sum.pushed === 0 && sum.pulled === 0, "syncing again does nothing (idempotent)");

  console.log("--- a new device / cleared browser ---");
  const fresh = mk(new FakeLocal(), a.remote);
  sum = await fresh.eng.reconcile();
  check(sum.pulled === 2 && fresh.local.get(T("s1")) === '["hi"]', "an empty browser gets everything back from the server");

  console.log("--- edits ---");
  a.local.set(T("s1"), '["hi","there"]'); a.eng.noteWrite(T("s1"), '["hi","there"]');
  check(a.eng.status().pending === 1, "an edit is pending until it reaches the server");
  await a.eng.flush();
  check(a.remote.val(T("s1")) === '["hi","there"]' && a.eng.status().pending === 0 && a.remote.docs.get(T("s1"))!.rev === 2, "a flush pushes it and clears the pending mark");
  a.eng.noteWrite("chronicler.config.v1", "x");
  check(a.eng.status().pending === 0, "writes to non-synced keys are ignored");

  console.log("--- offline ---");
  a.local.set(T("s1"), '["a","b","c"]'); a.eng.noteWrite(T("s1"), '["a","b","c"]');
  a.remote.down = true;
  await a.eng.flush();
  check(a.eng.status().state === "offline" && a.eng.status().pending === 1, "an unreachable server leaves the edit pending and reports offline");
  a.remote.down = false;
  await a.eng.flush();
  check(a.remote.val(T("s1")) === '["a","b","c"]' && a.eng.status().state === "idle", "it goes through once the server is back");

  console.log("--- edits made while sync wasn't running ---");
  const restart = mk(a.local, a.remote, a.meta);
  a.local.set(T("s1"), '["edited while closed"]'); // no noteWrite: e.g. a crash, or another tab
  await restart.eng.reconcile();
  check(a.remote.val(T("s1")) === '["edited while closed"]', "a changed value is noticed by fingerprint at start-up and pushed");
  const dirtyMeta = mk(new FakeLocal(), new FakeRemote());
  dirtyMeta.local.m.set(T("q"), "1"); await dirtyMeta.eng.reconcile();
  dirtyMeta.local.set(T("q"), "2"); dirtyMeta.eng.noteWrite(T("q"), "2");
  dirtyMeta.remote.down = true; await dirtyMeta.eng.flush(); dirtyMeta.remote.down = false;
  const afterCrash = new SyncEngine(dirtyMeta.local, dirtyMeta.remote, dirtyMeta.meta);
  await afterCrash.reconcile();
  check(dirtyMeta.remote.val(T("q")) === "2", "the pending mark survives a restart, so the edit is not lost");

  console.log("--- both sides changed ---");
  const b = mk();
  b.local.m.set(T("c"), "v1"); await b.eng.reconcile();
  b.remote.docs.set(T("c"), { value: "server edit", rev: 5 }); // another device
  b.local.set(T("c"), "local edit"); b.eng.noteWrite(T("c"), "local edit");
  await b.eng.flush();
  check(b.remote.val(T("c")) === "local edit", "this device's latest edit wins");
  check(b.remote.forced.includes(T("c")) && b.eng.status().conflicts === 1, "…as a forced write the server records (it stashes what it replaces) and counts");
  const c = mk();
  c.local.m.set(T("d"), "device A"); const other = new FakeRemote(); other.docs.set(T("d"), { value: "device B", rev: 3 });
  const c2 = mk(c.local, other, c.meta);
  sum = await c2.eng.reconcile();
  check(sum.conflicts === 1 && other.stashes.some((s) => s.value === "device A"), "with no shared history the server's copy is kept and the local one is stashed on the server");
  check(c.local.get(T("d")) === "device B", "…and the browser takes the server's version");
  const same = mk(); same.local.m.set(T("e"), "same"); same.remote.docs.set(T("e"), { value: "same", rev: 2 });
  sum = await same.eng.reconcile();
  check(sum.conflicts === 0 && sum.pulled === 0 && same.remote.stashes.length === 0, "identical values on both sides are not a conflict");

  console.log("--- deletion ---");
  const del = mk(); del.local.m.set(T("x"), "1"); await del.eng.reconcile();
  const dev2 = mk(new FakeLocal(), del.remote); await dev2.eng.reconcile();
  del.local.remove(T("x")); del.eng.noteRemove(T("x")); await del.eng.flush();
  check(del.remote.docs.get(T("x"))!.deleted === true, "a deletion reaches the server as a tombstone");
  await dev2.eng.reconcile();
  check(dev2.local.get(T("x")) === null, "another device that hasn't touched it removes it too");
  const keep = mk(); keep.local.m.set(T("y"), "1"); await keep.eng.reconcile();
  keep.remote.docs.set(T("y"), { value: null, rev: 9, deleted: true });
  keep.local.set(T("y"), "edited since"); // edited here after the other device deleted
  await keep.eng.reconcile();
  check(keep.local.get(T("y")) === "edited since" && keep.remote.val(T("y")) === "edited since", "a key edited here is not removed by someone else's deletion");

  console.log("--- the server loses its data ---");
  const lost = mk(); lost.local.m.set(T("z"), "precious"); await lost.eng.reconcile();
  lost.remote.docs.clear();
  await lost.eng.reconcile();
  check(lost.remote.val(T("z")) === "precious", "if the server's copy vanishes, the browser copy is put back");
  const never = mk(new FakeLocal(), new FakeRemote()); never.local.m.set(T("k"), "v"); never.remote.down = true;
  await never.eng.reconcile();
  check(never.local.get(T("k")) === "v", "an unreachable server never causes local data to be removed");

  console.log("--- a full browser (quota) ---");
  const q = mk(new FakeLocal(40));
  q.local.m.set(T("old1"), "x".repeat(15)); q.local.m.set(T("old2"), "y".repeat(10));
  await q.eng.reconcile();
  q.eng.pin(T("old2"));
  const big = "N".repeat(25);
  check(q.eng.setWithEviction(T("new"), big), "a write that doesn't fit evicts cold synced chats until it does");
  check(q.local.get(T("old1")) === null && q.local.get(T("old2")) !== null, "…the largest cold one first, and never the pinned (open) chat");
  check(q.remote.val(T("old1")) === "x".repeat(15), "the evicted chat is still safe on the server");
  const ev = mk(new FakeLocal(30)); ev.local.m.set(T("cold"), "c".repeat(20)); await ev.eng.reconcile();
  ev.eng.setWithEviction(T("hot"), "h".repeat(25));
  check(ev.local.get(T("cold")) === null && (await ev.eng.ensureLocal(T("cold"))) === false, "an evicted chat that would not fit again stays on the server rather than failing");
  const room = mk(new FakeLocal(200)); room.local.m.set(T("cold"), "c".repeat(20)); await room.eng.reconcile();
  room.eng.setWithEviction(T("hot"), "h".repeat(190));
  room.local.remove(T("hot"));
  check((await room.eng.ensureLocal(T("cold"))) === true && room.local.get(T("cold")) === "c".repeat(20), "…and is fetched back on demand when there is room (lazy hydration)");
  const dirtyEvict = mk(new FakeLocal(30)); dirtyEvict.local.m.set(T("d1"), "d".repeat(20)); await dirtyEvict.eng.reconcile();
  dirtyEvict.local.set(T("d1"), "e".repeat(20)); dirtyEvict.eng.noteWrite(T("d1"), "e".repeat(20)); // unsynced edit
  check(dirtyEvict.eng.setWithEviction(T("n"), "n".repeat(20)) === false && dirtyEvict.local.get(T("d1")) === "e".repeat(20), "a chat with an unsynced edit is NEVER evicted");

  console.log("--- a write that fails locally is still durable ---");
  const w = mk(new FakeLocal(30)); w.local.m.set(T("w"), "old!"); await w.eng.reconcile();
  const newest = "z".repeat(50); // won't fit and nothing can be evicted
  let threw = false; try { w.local.set(T("w"), newest); } catch { threw = true; }
  check(threw, "(the browser write really failed)");
  w.eng.noteWrite(T("w"), newest); await w.eng.flush();
  check(w.remote.val(T("w")) === newest, "the value is pushed to the server anyway");
  const w2 = mk(w.local, w.remote, w.meta);
  sum = await w2.eng.reconcile();
  check(w.remote.val(T("w")) === newest, "after a restart the stale local value does NOT overwrite the newer server one");

  console.log("--- fingerprint ---");
  check(fingerprint("a") === fingerprint("a") && fingerprint("a") !== fingerprint("b") && fingerprint(null) === "∅", "stable, and sensitive to change");

  console.log("\n--- PASS: sync-engine ---");
}

main().then(() => process.exit(0));
