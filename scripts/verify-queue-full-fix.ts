// Verify the queue-full fix end-to-end against a LIVE YantrikDB.
//
// Reproduce the failure mode: flood remember calls so the ingest queue
// overflows, then prove the new client transparently retries instead
// of surfacing "Unexpected token 'E', 'Error exec'…".
//
// Run:  npx tsx scripts/verify-queue-full-fix.ts

import { YantrikClient, YantrikError } from "../src/lib/yantrikdb/client";
import { McpTransport } from "../src/lib/yantrikdb/mcp-transport";

const STACK = process.env.CHRONICLER_URL ?? "http://127.0.0.1:3001/api/mcp";
const FLOOD_COUNT = Number(process.env.FLOOD ?? 400);
const NAMESPACE = `verify-queue-fix-${Date.now().toString(36)}`;

async function main(): Promise<void> {
  console.log(`Verify queue-full fix — flooding ${FLOOD_COUNT} writes at ${STACK}`);
  const t = new McpTransport({ kind: "streamable-http", url: STACK });
  const client = new YantrikClient(t);

  // Fire in parallel to actually stress the queue. Individual failures
  // would previously crash with SyntaxError; with the new client they
  // should either succeed transparently or throw a typed YantrikError.
  const started = Date.now();
  const outcomes = { succeeded: 0, retried: 0, hard_failed: 0, uncaught_syntaxerror: 0 };
  const promises: Promise<void>[] = [];
  for (let i = 0; i < FLOOD_COUNT; i++) {
    promises.push((async () => {
      try {
        await client.remember({
          text: `flood-${i}: probe memory to stress the ingest queue`,
          memory_type: "semantic",
          importance: 0.3,
          namespace: NAMESPACE,
          metadata: {},
        });
        outcomes.succeeded++;
      } catch (e) {
        if (e instanceof YantrikError) {
          if (e.kind === "queue_full") {
            outcomes.hard_failed++;
            console.log(`  ! index ${i} exhausted retries: ${e.serverMessage.slice(0, 80)}`);
          } else {
            outcomes.hard_failed++;
            console.log(`  ! index ${i} typed error (${e.kind}): ${e.serverMessage.slice(0, 80)}`);
          }
        } else if (e instanceof SyntaxError) {
          outcomes.uncaught_syntaxerror++;
          console.log(`  ✗ index ${i} LEAKED SyntaxError (regression!): ${e.message}`);
        } else {
          outcomes.hard_failed++;
          console.log(`  ! index ${i} unknown: ${String(e).slice(0, 100)}`);
        }
      }
    })());
  }
  await Promise.all(promises);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\ndone in ${elapsed}s`);
  console.log(`  succeeded: ${outcomes.succeeded}/${FLOOD_COUNT}`);
  console.log(`  hard-failed (typed YantrikError, no crash): ${outcomes.hard_failed}`);
  console.log(`  LEAKED SyntaxError (regression): ${outcomes.uncaught_syntaxerror}`);

  await t.close();

  if (outcomes.uncaught_syntaxerror > 0) {
    console.log("\n✗ FAIL — SyntaxError still leaks. Fix did not hold.");
    process.exit(1);
  }
  if (outcomes.succeeded === 0) {
    console.log("\n? INCONCLUSIVE — nothing succeeded; queue may not have refused writes.");
    process.exit(1);
  }
  console.log("\n✓ PASS — no SyntaxError leaked. Any hard-failures were typed YantrikError.");
}

main().catch((e) => {
  console.error("verify script threw:", e);
  process.exit(1);
});
