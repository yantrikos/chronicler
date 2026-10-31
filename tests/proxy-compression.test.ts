// A compressed upstream reply must reach the browser readable. Real APIs (Anthropic, OpenAI, …) compress larger JSON
// bodies; Node's fetch decompresses them, so the proxy must not also forward `content-encoding`. When it did, the
// browser failed to decode the (already plain) body and reported a bare "Failed to fetch" — which broke model lists and
// non-streaming calls while small error bodies and uncompressed streams still worked.
// Runs an ISOLATED server on a random port. Run: npx tsx tests/proxy-compression.test.ts

import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const PORT = 37000 + Math.floor(Math.random() * 900);
const UP = PORT + 1000;
const DATA = mkdtempSync(join(tmpdir(), "chronicler-cmp-"));
const PLUGINS = mkdtempSync(join(tmpdir(), "chronicler-cmpp-"));
const big = JSON.stringify({ data: Array.from({ length: 120 }, (_, i) => ({ id: `claude-model-${i}`, display_name: `Claude Model ${i}`, created_at: "2026-01-01T00:00:00Z" })) });

/** Compresses when the client says it can, like a CDN-fronted API. */
const upstream = http.createServer((req, res) => {
  req.resume();
  const url = new URL(req.url ?? "/", "http://x");
  const accept = String(req.headers["accept-encoding"] ?? "");
  if (url.pathname.startsWith("/sse")) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"n":1}\n\n');
    setTimeout(() => { res.write('data: {"n":2}\n\n'); res.end(); }, 80);
    return;
  }
  if (url.pathname.startsWith("/plain") || !/gzip|br/.test(accept)) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(big);
  }
  const brotli = url.pathname.startsWith("/br") && /\bbr\b/.test(accept);
  const body = brotli ? zlib.brotliCompressSync(big) : zlib.gzipSync(big);
  res.writeHead(200, { "content-type": "application/json", "content-encoding": brotli ? "br" : "gzip", "content-length": String(body.length) });
  res.end(body);
});

let proc: ChildProcess | null = null;
async function start(): Promise<void> {
  proc = spawn("node", ["server/index.mjs"], {
    env: { ...process.env, CHRONICLER_PORT: String(PORT), CHRONICLER_BIND: "127.0.0.1", CHRONICLER_DATA_DIR: DATA, CHRONICLER_PLUGINS_DIR: PLUGINS, CHRONICLER_YANTRIKDB_URL: `http://127.0.0.1:${UP}/mcp` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 15000);
    proc!.stdout!.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); resolve(); } });
    proc!.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
}
const viaLlm = (path: string) =>
  fetch(`http://127.0.0.1:${PORT}/api/llm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_url: `http://127.0.0.1:${UP}${path}`, method: "GET", headers: {} }) });
async function readable(res: Response): Promise<{ ok: boolean; models?: number; why?: string }> {
  try {
    return { ok: true, models: (JSON.parse(await res.text()) as { data: unknown[] }).data.length };
  } catch (e) {
    return { ok: false, why: `${(e as Error).message} / ${(e as { cause?: { code?: string } }).cause?.code ?? ""}` };
  }
}

async function main(): Promise<void> {
  await new Promise<void>((r) => upstream.listen(UP, "127.0.0.1", r));
  await start();

  console.log("--- LLM proxy ---");
  const gz = await viaLlm("/v1/models");
  const g = await readable(gz);
  check(g.ok && g.models === 120, `a gzip-compressed reply is readable by the browser${g.ok ? "" : " — " + g.why}`);
  check(!gz.headers.get("content-encoding"), "and the proxy does not pass the stale content-encoding on");
  const br = await readable(await viaLlm("/br/v1/models"));
  check(br.ok && br.models === 120, `a brotli-compressed reply is readable too${br.ok ? "" : " — " + br.why}`);
  const plain = await viaLlm("/plain/v1/models");
  check((await readable(plain)).models === 120 && plain.headers.get("content-type") === "application/json", "an uncompressed reply is unchanged, with its content-type");
  const sse = await viaLlm("/sse");
  check(sse.headers.get("content-type") === "text/event-stream" && (await sse.text()).includes('"n":2'), "a streaming (SSE) reply still passes straight through");

  console.log("--- memory-database proxy ---");
  const mcp = await fetch(`http://127.0.0.1:${PORT}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const m = await readable(mcp);
  check(m.ok && m.models === 120, `a compressed reply on the database route is readable too${m.ok ? "" : " — " + m.why}`);

  proc!.removeAllListeners("exit");
  proc!.kill();
  upstream.close();
  rmSync(DATA, { recursive: true, force: true });
  rmSync(PLUGINS, { recursive: true, force: true });
  console.log("\n--- PASS: proxy-compression ---");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
