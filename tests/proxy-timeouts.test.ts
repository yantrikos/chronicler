// The LLM proxy must not cut a slow-but-steady reply, must say when a model never answers, must
// fail a stalled stream loudly, and must cancel the upstream request when the browser goes away.
// Runs an ISOLATED server on a random port against fake "Ollama" upstreams. Run: npx tsx tests/proxy-timeouts.test.ts

import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DATA = mkdtempSync(join(tmpdir(), "chronicler-px-"));
const PLUGINS = mkdtempSync(join(tmpdir(), "chronicler-pxp-"));
const PORT = 38000 + Math.floor(Math.random() * 900);
const UP_PORT = PORT + 1000;
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess | null = null;
let upstreamClosed = false;

/** A fake Ollama: /steady streams N tokens 1s apart; /lead waits before answering; /stall sends 2 tokens then goes silent; /endless never stops. */
const upstream = http.createServer((req, res) => {
  req.resume();
  const url = new URL(req.url ?? "/", "http://x");
  res.on("close", () => { if (url.pathname === "/endless") upstreamClosed = true; });
  const tokens = (n: number, every: number, finish: boolean) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    let i = 0;
    const t = setInterval(() => {
      if (i >= n) { clearInterval(t); if (finish) { res.write(JSON.stringify({ done: true, done_reason: "stop" }) + "\n"); res.end(); } return; }
      res.write(JSON.stringify({ message: { content: `t${i++} ` }, done: false }) + "\n");
    }, every);
    res.on("close", () => clearInterval(t));
  };
  if (url.pathname === "/steady") return tokens(Number(url.searchParams.get("n") ?? 8), 1000, true);
  if (url.pathname === "/lead") return void setTimeout(() => tokens(2, 100, true), Number(url.searchParams.get("s") ?? 6) * 1000);
  if (url.pathname === "/stall") return tokens(2, 200, false);
  if (url.pathname === "/endless") return tokens(1000, 300, true);
  res.writeHead(404).end();
});

async function start(env: Record<string, string>): Promise<void> {
  proc = spawn("node", ["server/index.mjs"], {
    env: { ...process.env, CHRONICLER_PORT: String(PORT), CHRONICLER_BIND: "127.0.0.1", CHRONICLER_DATA_DIR: DATA, CHRONICLER_PLUGINS_DIR: PLUGINS, ...env },
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
  await new Promise((r) => p.once("exit", r));
}
const post = (path: string, signal?: AbortSignal, extra: Record<string, unknown> = {}) =>
  fetch(`${BASE}/api/llm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_url: `http://127.0.0.1:${UP_PORT}${path}`, method: "POST", headers: {}, body: {}, ...extra }), signal });

/** Read the whole body; report what arrived and whether the stream ended cleanly. */
async function drain(res: Response): Promise<{ tokens: number; clean: boolean; sawDone: boolean }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "", tokens = 0, sawDone = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return { tokens, clean: true, sawDone };
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const l of lines) { if (!l.trim()) continue; const o = JSON.parse(l); if (o.done) sawDone = true; else tokens++; }
    }
  } catch {
    return { tokens, clean: false, sawDone };
  }
}

async function main(): Promise<void> {
  await new Promise<void>((r) => upstream.listen(UP_PORT, "127.0.0.1", r));

  console.log("--- a slow but steady reply (8 tokens, 1/s = 8s) with a 3s idle limit ---");
  await start({ CHRONICLER_LLM_TIMEOUT_MS: "5000", CHRONICLER_LLM_IDLE_MS: "3000" });
  const steady = await drain(await post("/steady?n=8"));
  check(steady.tokens === 8 && steady.sawDone && steady.clean, "all 8 tokens and the done marker arrive — the old 5s TOTAL cap would have cut it at ~4");

  console.log("--- the model never starts answering ---");
  const lead = await post("/lead?s=8");
  const leadBody = await lead.json().catch(() => ({}));
  check(lead.status === 502 && /no response from the model after 5s/.test(String((leadBody as { error?: string }).error)), "502 that says the model never responded, and for how long");

  console.log("--- the stream stalls mid-reply ---");
  const t0 = Date.now();
  const stall = await drain(await post("/stall"));
  check(stall.tokens === 2 && !stall.clean && !stall.sawDone, "the client receives the 2 tokens, then the connection FAILS — it does not end cleanly looking complete");
  check(Date.now() - t0 < 8000, "and it fails at the idle limit (3s), not after minutes");

  console.log("--- the browser goes away (Stop pressed) ---");
  upstreamClosed = false;
  const ctl = new AbortController();
  const res = await post("/endless", ctl.signal);
  const reader = res.body!.getReader();
  await reader.read();
  ctl.abort();
  await sleep(1500);
  check(upstreamClosed, "the upstream request is cancelled, so Ollama stops generating instead of finishing a reply nobody will read");

  console.log("--- timeouts chosen in Settings travel with the request ---");
  await stop();
  await start({ CHRONICLER_LLM_TIMEOUT_MS: "20000", CHRONICLER_LLM_IDLE_MS: "20000" });
  const t1 = Date.now();
  const tooSoon = await post("/lead?s=8", undefined, { first_byte_ms: 6000 });
  const tooSoonBody = await tooSoon.json().catch(() => ({}));
  check(tooSoon.status === 502 && /no response from the model after 6s/.test(String((tooSoonBody as { error?: string }).error)) && Date.now() - t1 < 9000, "a first-word timeout of 6s from the browser beats the server's 20s setting");
  const patient = await drain(await post("/lead?s=6", undefined, { first_byte_ms: 15000 }));
  check(patient.tokens === 2 && patient.sawDone, "and a longer one lets a slow start finish");
  const t2 = Date.now();
  const clamped = await post("/lead?s=9", undefined, { first_byte_ms: 10 });
  const clampedBody = await clamped.json().catch(() => ({}));
  check(clamped.status === 502 && /after 5s/.test(String((clampedBody as { error?: string }).error)) && Date.now() - t2 < 8000, "an absurdly small value is clamped to 5s rather than failing every call instantly");
  const junk = await drain(await post("/steady?n=2", undefined, { first_byte_ms: "soon", idle_ms: -1 }));
  check(junk.tokens === 2 && junk.sawDone, "a non-numeric or negative value is ignored (the server's setting applies)");

  await stop();
  upstream.close();
  rmSync(DATA, { recursive: true, force: true });
  rmSync(PLUGINS, { recursive: true, force: true });
  console.log("\n--- PASS: proxy-timeouts ---");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
