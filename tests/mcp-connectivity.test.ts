// Smoke test: verify our McpTransport can actually connect to a running
// yantrikdb-mcp server and execute a tool call.
//
// Requires a local server running. Start with:
//   YANTRIKDB_DB_PATH=/tmp/chronicler-dogfood-test/test.db \
//   YANTRIKDB_API_KEY=test-token-123 \
//   uvx yantrikdb-mcp --transport streamable-http --host 127.0.0.1 --port 8421
//
// Run: npx tsx tests/mcp-connectivity.test.ts

import { YantrikClient } from "../src/lib/yantrikdb/client";
import { McpTransport } from "../src/lib/yantrikdb/mcp-transport";
import { rememberAsCanon } from "../src/lib/yantrikdb/client";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

async function main(): Promise<void> {
  const url = process.env.YANTRIKDB_MCP_URL ?? "http://127.0.0.1:8421/mcp";
  const token = process.env.YANTRIKDB_API_KEY ?? "test-token-123";

  console.log(`--- mcp connectivity test (url=${url}) ---`);

  const transport = new McpTransport({
    kind: "streamable-http",
    url,
    authToken: token,
  });
  const client = new YantrikClient(transport);

  // 1. stats — cheapest call, verifies round-trip
  const stats = (await transport.call("stats", { action: "health" })) as {
    result?: string;
  };
  check(
    typeof stats.result === "string",
    `health check returned a string result (got: ${typeof stats.result})`
  );
  const parsed = JSON.parse(stats.result ?? "{}");
  check(
    parsed.status === "ok" || typeof parsed.active_memories === "number",
    `health check reports ok (got ${JSON.stringify(parsed).slice(0, 80)})`
  );
  console.log(`  · latency: ${parsed.latency_ms ?? "?"}ms, memories: ${parsed.active_memories ?? "?"}`);

  // 2. Write a memory, read it back
  const input = rememberAsCanon(
    `mcp-connectivity-test-marker ${Date.now()}`,
    "mcp-test-session",
    {
      character_id: "mcp-test-char",
      visible_to: ["*"],
    }
  );
  const { rid } = await client.remember(input);
  check(rid.length > 0, `remember returned a rid (${rid})`);

  const recalled = await client.recall({
    query: "mcp-connectivity-test-marker",
    namespace: "character:mcp-test-char",
    top_k: 5,
  });
  check(
    recalled.results.some((r) => r.rid === rid),
    `recall finds the just-written memory (${recalled.count} results)`
  );

  // 3. Clean up the test memory
  await client.forget(rid);

  await transport.close();
  console.log("\n--- PASS: mcp connectivity ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
