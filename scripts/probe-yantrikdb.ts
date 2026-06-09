import { McpTransport } from "../src/lib/yantrikdb/mcp-transport";

const URL_ = process.env.CHRONICLER_URL ?? "http://127.0.0.1:3001/api/mcp";

async function main(): Promise<void> {
  const t = new McpTransport({ kind: "streamable-http", url: URL_ });
  console.log("calling stats...");
  const stats = await t.call("stats", {});
  console.log("stats:", JSON.stringify(stats).slice(0, 600));
  console.log("\ncalling remember (single)...");
  const remember = await t.call("remember", {
    text: "probe memory: Pranab is testing chronicler from a Node script",
    memory_type: "semantic",
    importance: 0.6,
    namespace: "probe-spin",
  });
  console.log("remember:", JSON.stringify(remember).slice(0, 600));
  console.log("\ncalling remember (batch)...");
  const batch = await t.call("remember", {
    memories: [
      { text: "Probe fact A", memory_type: "semantic", namespace: "probe-spin" },
      { text: "Probe fact B", memory_type: "semantic", namespace: "probe-spin" },
    ],
  });
  console.log("batch:", JSON.stringify(batch).slice(0, 800));
  await t.close();
}

main().catch((e) => {
  console.error("probe error:", e);
  process.exit(1);
});
