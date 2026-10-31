// A tab left open across an update must notice. Run: npx tsx tests/update-check.test.ts

import { fetchServerVersion, isUpdateAvailable } from "../src/lib/ui/update-check";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}
const realFetch = globalThis.fetch;

async function main(): Promise<void> {
  console.log("--- isUpdateAvailable ---");
  check(isUpdateAvailable("0.6.5", "0.6.6"), "a newer server means this page is out of date");
  check(isUpdateAvailable("0.6.6", "0.6.5"), "any difference counts (a rollback also needs a reload)");
  check(!isUpdateAvailable("0.6.6", "0.6.6"), "the same version never nags");
  check(!isUpdateAvailable("0.6.6", null) && !isUpdateAvailable("0.6.6", undefined) && !isUpdateAvailable(undefined, "0.6.6"), "an unknown version never nags (older server, offline)");
  check(!isUpdateAvailable("unknown", "0.6.6") && !isUpdateAvailable("0.6.6", "unknown"), "'unknown' (a dev build) never nags");

  console.log("--- fetchServerVersion ---");
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, version: "0.6.6" }), { status: 200 })) as typeof fetch;
  check((await fetchServerVersion()) === "0.6.6", "reads the version from /api/health");
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
  check((await fetchServerVersion()) === null, "an older server with no version field gives null");
  globalThis.fetch = (async () => new Response("<html>dev server</html>", { status: 200 })) as typeof fetch;
  check((await fetchServerVersion()) === null, "a non-JSON reply gives null");
  globalThis.fetch = (async () => new Response("nope", { status: 502 })) as typeof fetch;
  check((await fetchServerVersion()) === null, "an error status gives null");
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  check((await fetchServerVersion()) === null, "being offline gives null instead of throwing");

  globalThis.fetch = realFetch;
  console.log("\n--- PASS: update-check ---");
}
main().then(() => process.exit(0));
