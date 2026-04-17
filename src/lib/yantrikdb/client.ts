// Typed client for YantrikDB accessed via its MCP server. Chronicler speaks
// to YantrikDB through this module exclusively. Anything that wants to
// read/write memory goes through here.
//
// Default transport in production: McpTransport (see ./mcp-transport.ts)
// pointing at same-origin /api/mcp, which the Node proxy server forwards to
// the real YantrikDB endpoint. For tests and isolated dev, InMemoryTransport
// (see ./memory-transport.ts) is swapped in instead.

import type {
  ChroniclerMetadata,
  RecallQuery,
  RecallResponse,
  RememberInput,
  Tier,
} from "./types";

export interface YantrikDBTransport {
  call(tool: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * HTTP transport — hits a local shim that forwards to the MCP server.
 * In production we'll replace this with a Tauri invoke-based transport
 * that calls into the Rust side which owns the SSE connection.
 */
export class HttpTransport implements YantrikDBTransport {
  constructor(private baseUrl: string, private authToken?: string) {}

  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/tool/${tool}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.authToken
          ? { Authorization: `Bearer ${this.authToken}` }
          : {}),
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      throw new Error(
        `YantrikDB ${tool} failed: ${res.status} ${await res.text()}`
      );
    }
    return res.json();
  }
}

export interface RememberArgs {
  text: string;
  memory_type?: string;
  importance?: number;
  certainty?: number;
  source?: string;
  namespace?: string;
  metadata?: Record<string, unknown>;
  emotional_state?: string;
  valence?: number;
  [key: string]: unknown;
}

function metadataForYantrik(
  metadata: ChroniclerMetadata
): Record<string, unknown> {
  // Flatten Chronicler metadata into the loose `metadata` map YantrikDB accepts.
  return { ...metadata };
}

export class YantrikClient {
  constructor(private transport: YantrikDBTransport) {}

  async remember(input: RememberInput): Promise<{ rid: string }> {
    const args: RememberArgs = {
      text: input.text,
      memory_type: input.memory_type ?? "semantic",
      importance: input.importance ?? 0.5,
      certainty: input.certainty ?? 0.8,
      source: input.source ?? "user",
      namespace: input.namespace,
      metadata: metadataForYantrik(input.metadata),
      valence: input.valence ?? 0,
    };
    if (input.emotional_state) args.emotional_state = input.emotional_state;
    const res = (await this.transport.call("remember", args)) as {
      result?: string;
    };
    const parsed = typeof res.result === "string"
      ? JSON.parse(res.result)
      : res;
    const rid = parsed.rid ?? parsed.rids?.[0];
    if (!rid) throw new Error("remember returned no rid");
    return { rid };
  }

  async rememberBatch(inputs: RememberInput[]): Promise<string[]> {
    const memories = inputs.map((i) => ({
      text: i.text,
      memory_type: i.memory_type ?? "semantic",
      importance: i.importance ?? 0.5,
      certainty: i.certainty ?? 0.8,
      source: i.source ?? "user",
      namespace: i.namespace,
      metadata: metadataForYantrik(i.metadata),
      valence: i.valence ?? 0,
      ...(i.emotional_state ? { emotional_state: i.emotional_state } : {}),
    }));
    const res = (await this.transport.call("remember", { memories })) as {
      result?: string;
    };
    const parsed = typeof res.result === "string"
      ? JSON.parse(res.result)
      : res;
    return parsed.rids ?? [];
  }

  async recall(query: RecallQuery): Promise<RecallResponse> {
    const args: Record<string, unknown> = {
      query: query.query,
      top_k: query.top_k ?? 10,
      expand_entities: query.expand_entities ?? true,
    };
    if (query.memory_type) args.memory_type = query.memory_type;
    if (query.domain) args.domain = query.domain;
    if (query.source) args.source = query.source;
    if (query.namespace) args.namespace = query.namespace;
    if (query.include_consolidated)
      args.include_consolidated = query.include_consolidated;
    const res = (await this.transport.call("recall", args)) as {
      result?: string;
    };
    const parsed = typeof res.result === "string"
      ? JSON.parse(res.result)
      : res;
    // Client-side filter for visibility ACL + tier + canonical_status.
    // YantrikDB itself doesn't know these conventions; we filter here.
    const filtered = (parsed.results ?? []).filter(
      (r: { metadata?: Partial<ChroniclerMetadata> }) =>
        this.passesChroniclerFilters(r.metadata, query)
    );
    return {
      count: filtered.length,
      results: filtered,
      confidence: parsed.confidence ?? 0,
      hints: parsed.hints ?? [],
    };
  }

  private passesChroniclerFilters(
    metadata: Partial<ChroniclerMetadata> | undefined,
    query: RecallQuery
  ): boolean {
    if (query.speaker && metadata?.visible_to) {
      const allowed =
        metadata.visible_to.includes("*") ||
        metadata.visible_to.includes(query.speaker);
      if (!allowed) return false;
    }
    if (query.tier && metadata?.tier) {
      const wanted = Array.isArray(query.tier) ? query.tier : [query.tier];
      if (!wanted.includes(metadata.tier)) return false;
    }
    if (query.canonical_status && metadata?.canonical_status) {
      const wanted = Array.isArray(query.canonical_status)
        ? query.canonical_status
        : [query.canonical_status];
      if (!wanted.includes(metadata.canonical_status)) return false;
    }
    return true;
  }

  async forget(rid: string): Promise<void> {
    await this.transport.call("forget", { rid });
  }

  async correct(rid: string, newText: string): Promise<void> {
    await this.transport.call("correct", { rid, text: newText });
  }

  /**
   * Set the canonical_status of a memory — retcon support. See ADR-002.
   * Doesn't tombstone; retrieval still finds the memory, but the orchestrator
   * renders it with a status-appropriate prefix.
   */
  async setCanonicalStatus(
    rid: string,
    status: import("./types").CanonicalStatus
  ): Promise<void> {
    await this.transport.call("memory", {
      action: "update_metadata",
      rid,
      metadata_patch: { canonical_status: status },
    });
  }

  async promoteToCanon(rid: string, reason: string = "user_pin"): Promise<void> {
    await this.transport.call("memory", {
      action: "update_metadata",
      rid,
      metadata_patch: {
        tier: "canon",
        promotion_history_append: {
          at: new Date().toISOString(),
          to_tier: "canon",
          reason,
        },
      },
    });
  }

  async demoteToHeuristic(
    rid: string,
    reason: string = "user_demote"
  ): Promise<void> {
    await this.transport.call("memory", {
      action: "update_metadata",
      rid,
      metadata_patch: {
        tier: "heuristic",
        promotion_history_append: {
          at: new Date().toISOString(),
          to_tier: "heuristic",
          reason,
        },
      },
    });
  }

  async updateImportance(rid: string, importance: number): Promise<void> {
    await this.transport.call("memory", {
      action: "update_importance",
      rid,
      importance,
    });
  }

  async archive(rid: string): Promise<void> {
    await this.transport.call("memory", { action: "archive", rid });
  }

  async graphRelate(
    entity: string,
    target: string,
    relationship: string
  ): Promise<void> {
    await this.transport.call("graph", {
      action: "relate",
      entity,
      target,
      relationship,
    });
  }

  async graphProfile(entity: string): Promise<unknown> {
    return this.transport.call("graph", { action: "profile", entity });
  }

  async graphDepth(
    entity: string,
    depth: number = 1
  ): Promise<unknown> {
    return this.transport.call("graph", {
      action: "depth",
      entity,
      depth,
    });
  }

  async sessionStart(
    sessionId: string,
    namespace: string
  ): Promise<void> {
    await this.transport.call("session", {
      action: "start",
      session_id: sessionId,
      namespace,
    });
  }

  async sessionEnd(sessionId: string): Promise<void> {
    await this.transport.call("session", {
      action: "end",
      session_id: sessionId,
    });
  }

  async think(namespace?: string): Promise<unknown> {
    return this.transport.call("think", namespace ? { namespace } : {});
  }

  async conflictPending(namespace?: string): Promise<unknown> {
    return this.transport.call(
      "conflict",
      namespace ? { action: "list", namespace } : { action: "list" }
    );
  }

  async temporalStale(namespace?: string): Promise<unknown> {
    return this.transport.call(
      "temporal",
      namespace ? { action: "stale", namespace } : { action: "stale" }
    );
  }

  async temporalUpcoming(namespace?: string): Promise<unknown> {
    return this.transport.call(
      "temporal",
      namespace ? { action: "upcoming", namespace } : { action: "upcoming" }
    );
  }

  async personalityGet(characterId: string): Promise<unknown> {
    return this.transport.call("personality", {
      action: "get",
      namespace: `character:${characterId}`,
    });
  }

  async personalitySet(
    characterId: string,
    traits: Record<string, number>
  ): Promise<void> {
    await this.transport.call("personality", {
      action: "set",
      namespace: `character:${characterId}`,
      traits,
    });
  }
}

// --- Tier-aware convenience helpers ---
import { TIER_DEFAULTS } from "./types";

export function rememberAsReflex(
  text: string,
  sessionId: string,
  extra: Partial<ChroniclerMetadata> = {}
): RememberInput {
  return {
    text,
    importance: TIER_DEFAULTS.reflex.importance,
    certainty: TIER_DEFAULTS.reflex.certainty,
    source: TIER_DEFAULTS.reflex.source,
    namespace: `session:${sessionId}`,
    metadata: {
      tier: "reflex" as Tier,
      canonical_status: "canon",
      visible_to: extra.visible_to ?? ["*"],
      session_id: sessionId,
      ...extra,
    },
  };
}

export function rememberAsHeuristic(
  text: string,
  sessionId: string,
  extra: Partial<ChroniclerMetadata> = {}
): RememberInput {
  return {
    text,
    importance: TIER_DEFAULTS.heuristic.importance,
    certainty: TIER_DEFAULTS.heuristic.certainty,
    source: TIER_DEFAULTS.heuristic.source,
    namespace: extra.character_id
      ? `character:${extra.character_id}`
      : `session:${sessionId}`,
    metadata: {
      tier: "heuristic" as Tier,
      canonical_status: "canon",
      visible_to: extra.visible_to ?? ["*"],
      session_id: sessionId,
      reinforcement_count: 0,
      first_reinforced_in_session: sessionId,
      ...extra,
    },
  };
}

export function rememberAsCanon(
  text: string,
  sessionId: string,
  extra: Partial<ChroniclerMetadata> = {}
): RememberInput {
  // Namespace precedence: character > world > session.
  // Character-scoped facts (relationships, secrets, per-character state)
  // must live in character:<id> so retrieval scoped to a character picks
  // them up. World namespace is for shared lore (visible_to=["*"]).
  return {
    text,
    importance: TIER_DEFAULTS.canon.importance,
    certainty: TIER_DEFAULTS.canon.certainty,
    source: TIER_DEFAULTS.canon.source,
    namespace: extra.character_id
      ? `character:${extra.character_id}`
      : extra.world_id
      ? `world:${extra.world_id}`
      : `session:${sessionId}`,
    metadata: {
      tier: "canon" as Tier,
      canonical_status: "canon",
      visible_to: extra.visible_to ?? ["*"],
      session_id: sessionId,
      promotion_history: [
        {
          at: new Date().toISOString(),
          from_tier: "canon",
          to_tier: "canon",
          reason: "imported_seed",
        },
      ],
      ...extra,
    },
  };
}

// Export a default module for easy construction from config.
export function makeClient(opts: {
  baseUrl?: string;
  authToken?: string;
  transport?: YantrikDBTransport;
}): YantrikClient {
  const transport =
    opts.transport ??
    new HttpTransport(opts.baseUrl ?? "http://localhost:8420", opts.authToken);
  return new YantrikClient(transport);
}

export * from "./types";
