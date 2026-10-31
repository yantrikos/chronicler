// The server reports its version, and never writes a secret from a proxied URL into its log.
// Runs ISOLATED servers on random ports. Run: npx tsx tests/server-meta.test.ts

import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
const PORT = 36000 + Math.floor(Math.random() * 800);
const UP = PORT + 1000;
const DATA = mkdtempSync(join(tmpdir(), "chronicler-meta-"));
const PLUGINS = mkdtempSync(join(tmpdir(), "chronicler-metap-"));
const pkgVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

async function run(env: Record<string, string>, fn: (base: string, log: () => string) => Promise<void>): Promise<void> {
  let out = "";
  const proc: ChildProcess = spawn("node", ["server/index.mjs"], {
    env: { ...process.env, CHRONICLER_PORT: String(PORT), CHRONICLER_BIND: "127.0.0.1", CHRONICLER_DATA_DIR: DATA, CHRONICLER_PLUGINS_DIR: PLUGINS, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout!.on("data", (d) => (out += String(d)));
  proc.stderr!.on("data", (d) => (out += String(d)));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 15000);
    const id = setInterval(() => { if (out.includes("listening")) { clearTimeout(t); clearInterval(id); resolve(); } }, 50);
  });
  try {
    await fn(`http://127.0.0.1:${PORT}`, () => out);
  } finally {
    proc.kill();
    await new Promise((r) => proc.once("exit", r));
  }
}

async function main(): Promise<void> {
  console.log("--- version ---");
  await run({}, async (base) => {
    const h = (await (await fetch(`${base}/api/health`)).json()) as { version?: string; ok?: boolean };
    check(h.ok === true && h.version === pkgVersion, `/api/health reports the package version (${pkgVersion})`);
  });
  await run({ CHRONICLER_VERSION_OVERRIDE: "9.9.9" }, async (base) => {
    check(((await (await fetch(`${base}/api/health`)).json()) as { version?: string }).version === "9.9.9", "a test can simulate an updated server");
  });

  console.log("--- secrets in proxied URLs ---");
  const upstream = http.createServer((req, res) => { req.resume(); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  await new Promise<void>((r) => upstream.listen(UP, "127.0.0.1", r));
  await run({}, async (base, log) => {
    const SECRET = "AIzaSyTOPSECRETKEY123";
    const post = (url: string) => fetch(`${base}/api/llm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_url: url, method: "POST", headers: {}, body: {} }) });
    await post(`http://127.0.0.1:${UP}/v1beta/models/gemini-2.5-flash:generateContent?key=${SECRET}`);
    await post(`http://user:PASSWORD99@127.0.0.1:${UP}/x?alt=sse&api_key=${SECRET}&token=${SECRET}`);
    await new Promise((r) => setTimeout(r, 200));
    const text = log();
    check(text.includes("[llm] →") && text.includes("/v1beta/models/gemini-2.5-flash:generateContent"), "the call is still logged, with its path");
    check(!text.includes(SECRET), "the API key in the query string never reaches the log (key / api_key / token)");
    check(!text.includes("PASSWORD99"), "a password in the URL's user-info never reaches the log either");
    check(text.includes("alt=sse"), "harmless query parameters are kept, so the log stays useful");
  });
  upstream.close();
  rmSync(DATA, { recursive: true, force: true });
  rmSync(PLUGINS, { recursive: true, force: true });
  console.log("\n--- PASS: server-meta ---");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
