// Fetches opted-in MCP resources and shapes them as RecallResult so
// they slot into the orchestrator's canon retrieval pipeline.
//
// Caching: each resource is fetched at most once per (serverId, uri,
// turnCount) — we don't refetch within a turn even if multiple
// retrieval calls happen. A cross-turn cache with TTL (5 minutes
// default) avoids hammering remote servers on every message.

import type { McpServerRegistry } from "./registry";
import type { McpToolCallResult } from "./types";
import { splitQualifiedResource } from "./resource-opt-in";
import type { RecallResult } from "../yantrikdb/client";

interface CacheEntry {
  rid: string;
  text: string;
  fetchedAt: number;
  serverId: string;
  uri: string;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry>();

/** Fetch all opted-in resources for a character. Each successful fetch
 *  becomes one RecallResult with namespace=mcp:<serverId>:<uri> so the
 *  compose layer can see provenance + the inspector can show "this
 *  came from server X". Failures are dropped silently (we don't want
 *  one broken server to block a turn). */
export async function fetchOptedInResources(
  registry: McpServerRegistry,
  enabledResources: string[]
): Promise<RecallResult[]> {
  if (enabledResources.length === 0) return [];
  const now = Date.now();
  const results = await Promise.all(
    enabledResources.map(async (qualified) => {
      const split = splitQualifiedResource(qualified);
      if (!split) return null;
      const cached = cache.get(qualified);
      if (cached && now - cached.fetchedAt < TTL_MS) {
        return toRecallResult(cached, split);
      }
      const fetched = await registry
        .readResource(split.serverId, split.uri)
        .catch(
          (e): McpToolCallResult => ({
            kind: "error",
            message: e instanceof Error ? e.message : String(e),
          })
        );
      const text = toText(fetched);
      if (!text || text.length === 0) return null;
      const entry: CacheEntry = {
        rid: `mcp:${qualified}`,
        text,
        fetchedAt: now,
        serverId: split.serverId,
        uri: split.uri,
      };
      cache.set(qualified, entry);
      return toRecallResult(entry, split);
    })
  );
  return results.filter((r): r is RecallResult => r !== null);
}

function toText(r: McpToolCallResult): string {
  switch (r.kind) {
    case "text":
      return r.text;
    case "json":
      try {
        return JSON.stringify(r.data, null, 2);
      } catch {
        return "";
      }
    case "image":
    case "audio":
      // Binary URIs aren't directly composable into the prompt; surface
      // a stub so the inspector still shows the resource was pulled.
      return `[${r.kind}: ${r.url}]`;
    case "error":
      return ""; // dropped
  }
}

function toRecallResult(
  entry: CacheEntry,
  split: { serverId: string; uri: string }
): RecallResult {
  return {
    rid: entry.rid,
    text: entry.text,
    type: "semantic",
    score: 0.7, // canonical-equivalent default; user can tune via opt-in
    importance: 0.7,
    certainty: 0.8,
    namespace: `mcp:${split.serverId}:${split.uri}`,
    why_retrieved: [`mcp:${split.serverId}`, `uri:${split.uri.slice(0, 40)}`],
  };
}

/** Test helper — flush the cache. */
export function _clearResourceCache(): void {
  cache.clear();
}
