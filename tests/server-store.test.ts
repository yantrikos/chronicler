// Durable storage server — atomicity, conflicts, tombstones, validation, image
// store. Runs an ISOLATED server on a random port with a temp data directory;
// never touches the real one. Run: npx tsx tests/server-store.test.ts

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const DATA = mkdtempSync(join(tmpdir(), "chronicler-store-"));
const PLUGINS = mkdtempSync(join(tmpdir(), "chronicler-plugins-"));
const PORT = 39000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess | null = null;

async function start(): Promise<void> {
  proc = spawn("node", ["server/index.mjs"], {
    env: { ...process.env, CHRONICLER_PORT: String(PORT), CHRONICLER_BIND: "127.0.0.1", CHRONICLER_DATA_DIR: DATA, CHRONICLER_PLUGINS_DIR: PLUGINS,
      CHRONICLER_MAX_VALUE_BYTES: String(1024 * 1024), CHRONICLER_MAX_IMAGE_BYTES: String(64 * 1024) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 15000);
    proc!.stdout!.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); resolve(); } });
    proc!.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
}
async function stop(): Promise<void> {
  if (!proc) return;
  const p = proc; proc = null;
  p.removeAllListeners("exit");
  p.kill();
  await new Promise((r) => setTimeout(r, 300));
}

const j = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data: any = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
};
const put = (key: string, value: string, extra: object = {}) => j("PUT", `/api/store/kv?key=${encodeURIComponent(key)}`, { value, ...extra });
const get = (key: string) => j("GET", `/api/store/kv?key=${encodeURIComponent(key)}`);
const K = "chronicler.session.abc.turns";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body-for-testing")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpeg-body")]);
const putImg = (hash: string, buf: Buffer) => fetch(`${BASE}/api/attachments/${hash}`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: buf });

async function main(): Promise<void> {
  await start();
  console.log("--- key-value ---");
  check(Object.keys((await j("GET", "/api/store/manifest")).data.keys).length === 0, "starts empty");
  let r = await put(K, '["turn 1"]');
  check(r.status === 200 && r.data.rev === 1, "a new key is written at revision 1");
  check((await get(K)).data.value === '["turn 1"]', "and read back");
  r = await put(K, '["turn 1","turn 2"]', { base_rev: 1 });
  check(r.status === 200 && r.data.rev === 2, "an update naming the current revision succeeds");
  r = await put(K, '["stale"]', { base_rev: 1 });
  check(r.status === 409 && r.data.conflict === true && r.data.rev === 2, "an update from a stale revision is refused, not applied");
  check((await get(K)).data.value === '["turn 1","turn 2"]', "…and the newer data is untouched");
  r = await put(K, '["forced"]', { base_rev: 1, force: true });
  check(r.status === 200 && r.data.rev === 3, "a forced write goes through");
  check(readdirSync(join(DATA, "conflicts")).length === 1, "…but what it replaced is stashed under conflicts/");
  r = await j("PUT", `/api/store/kv?key=${K}`, { value: "x" });
  check(r.status === 409, "a write that names no revision to an existing key is refused too");

  console.log("--- deletes are tombstones ---");
  r = await j("DELETE", `/api/store/kv?key=${K}&base_rev=3`);
  check(r.status === 200 && r.data.rev === 4, "delete succeeds");
  const g = (await get(K)).data;
  check(g.deleted === true && g.value === null, "…and reads back as deleted (a tombstone, so another device can't resurrect it)");
  const file = readdirSync(join(DATA, "kv")).flatMap((d) => readdirSync(join(DATA, "kv", d)).map((n) => join(DATA, "kv", d, n))).find((f) => f.endsWith(".json.prev"))!;
  check(JSON.parse(readFileSync(file, "utf8")).value === '["forced"]', "the deleted value survives in .prev — recoverable");
  r = await put(K, '["reborn"]', { base_rev: 4 });
  check(r.status === 200 && r.data.rev === 5, "a key can be written again after deletion");

  console.log("--- validation ---");
  check((await put("../../etc/passwd", "x")).status === 400, "path traversal keys are refused");
  check((await put("session.abc", "x")).status === 400, "keys must be in the chronicler.* namespace");
  check((await put("chronicler.config.v1", "{\"api_key\":\"sk-secret\"}")).status === 400, "the config key (API keys) is refused server-side");
  check((await put("chronicler.mcp.servers.v1", "[]")).status === 400, "MCP server tokens are refused too");
  check((await put("chronicler.sync.meta", "{}")).status === 400, "sync bookkeeping is never stored");
  check((await put(K + "-big", "x".repeat(2 * 1024 * 1024), {})).status === 413, "an over-size value is refused");
  check(!readdirSync(DATA).some((n) => !["kv", "conflicts", "attachments"].includes(n)), "nothing is written outside the three data folders");
  check(!readdirSync(join(DATA, "kv")).flatMap((d) => readdirSync(join(DATA, "kv", d))).some((n) => n.includes(".tmp-")), "no half-written temp files are left behind");

  console.log("--- other websites ---");
  check((await j("GET", "/api/store/manifest", undefined, { origin: "http://evil.example" })).status === 403, "a request from a foreign origin is refused");
  check((await j("GET", "/api/store/manifest", undefined, { origin: BASE })).status === 200, "a same-origin request is fine");
  check((await j("PUT", `/api/store/kv?key=${K}`, { value: "x", force: true }, { origin: "https://evil.example" })).status === 403, "…including writes");

  console.log("--- survives a restart ---");
  await stop();
  await start();
  const m = (await j("GET", "/api/store/manifest")).data.keys;
  check(m[K]?.rev === 5 && (await get(K)).data.value === '["reborn"]', "keys, values and revisions persist across a server restart");

  console.log("--- images ---");
  const h = sha(PNG);
  let ir = await putImg(h, PNG);
  check(ir.status === 201, "an image is stored under its own hash");
  check((await putImg(h, PNG)).status === 200, "storing the same bytes again is a no-op");
  const got = await fetch(`${BASE}/api/attachments/${h}`);
  check(got.status === 200 && got.headers.get("content-type") === "image/png" && Buffer.from(await got.arrayBuffer()).equals(PNG), "it reads back byte-for-byte, typed by its bytes");
  check(/immutable/.test(got.headers.get("cache-control") ?? "") && got.headers.get("x-content-type-options") === "nosniff", "served as immutable and nosniff");
  check((await fetch(`${BASE}/api/attachments/${h}`, { method: "HEAD" })).status === 200, "HEAD works (cheap existence check)");
  check((await putImg("0".repeat(64), PNG)).status === 400, "bytes that don't match the claimed hash are refused");
  const bad = Buffer.from("<script>alert(1)</script>");
  check((await putImg(sha(bad), bad)).status === 415, "non-image bytes are refused, whatever the client says they are");
  const big = Buffer.concat([JPG, Buffer.alloc(80 * 1024)]);
  check((await putImg(sha(big), big)).status === 413, "an over-size image is refused");
  check((await fetch(`${BASE}/api/attachments/..%2F..%2Fkv`)).status === 400, "a non-hash name (path traversal) is refused");
  check((await fetch(`${BASE}/api/attachments/${"a".repeat(64)}`)).status === 404, "an unknown image is a 404");
  await putImg(sha(JPG), JPG);
  const list = (await j("GET", "/api/attachments")).data;
  check(list.hashes.length === 2 && list.bytes === PNG.length + JPG.length, "the list reports count and bytes");
  check((await j("DELETE", "/api/attachments")).status === 400, "clearing all images needs an explicit confirmation header");
  check((await j("DELETE", "/api/attachments", undefined, { "x-confirm": "clear-all" })).data.removed === 2 && (await fetch(`${BASE}/api/attachments/${h}`)).status === 404, "…and with it, clears them");

  console.log("--- info ---");
  const info = (await j("GET", "/api/store/info")).data;
  check(info.keys >= 1 && typeof info.dir === "string", "info reports what is stored");

  await stop();
  rmSync(DATA, { recursive: true, force: true });
  rmSync(PLUGINS, { recursive: true, force: true });
  console.log("\n--- PASS: server-store ---");
}

main().then(() => process.exit(0)).catch(async (e) => { console.error(e); await stop(); process.exit(1); });
