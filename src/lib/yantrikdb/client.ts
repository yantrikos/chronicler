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

  /**
   * Fetch the full record for a single memory by rid.
   *
   * `recall` and `memory.list` return lightweight summaries intentionally —
   * the retrieval hot path can't afford to hydrate full metadata per
   * candidate. `memory.get` is the "give me the exact record" path.
   * Use this when you need ground-truth tier / canonical_status /
   * visible_to / source_turn_id metadata.
   */
  async getMemory(rid: string): Promise<{
    rid: string;
    text: string;
    importance: number;
    certainty?: number;
    namespace?: string;
    source?: string;
    metadata: Record<string, unknown>;
    created_at?: number;
  } | null> {
    try {
      const res = await this.transport.call("memory", {
        action: "get",
        rid,
      });
      const parsed = parseMaybeWrapped(res);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (obj.error) return null;
        return {
          rid: String(obj.rid ?? rid),
          text: String(obj.text ?? ""),
          importance: Number(obj.importance ?? 0.5),
          certainty:
            typeof obj.certainty === "number" ? obj.certainty : undefined,
          namespace:
            typeof obj.namespace === "string" ? obj.namespace : undefined,
          source: typeof obj.source === "string" ? obj.source : undefined,
          metadata:
            (obj.metadata as Record<string, unknown>) ??
            ({} as Record<string, unknown>),
          created_at:
            typeof obj.created_at === "number" ? obj.created_at : undefined,
        };
      }
    } catch {
      // swallow — caller falls back to list-level summary
    }
    return null;
  }

  /**
   * List memories in a namespace. Used by the memory inspector to populate
   * the view against a real YantrikDB transport (InMemoryTransport reads
   * from its own array).
   *
   * YantrikDB's MCP surface exposes both `memory action=list` and `recall`
   * with a broad query; recall returns a cleaner shape for our metadata
   * needs and reuses a code path that's already battle-tested. We pass an
   * empty query with a large top_k; YantrikDB treats that as "list all in
   * namespace" in practice.
   */
  async listMemoriesInNamespace(
    namespace: string,
    limit: number = 150
  ): Promise<RecallResponse["results"]> {
    try {
      const res = await this.transport.call("memory", {
        action: "list",
        namespace,
        limit,
      });
      const parsed = parseMaybeWrapped(res);
      if (Array.isArray(parsed)) {
        return parsed as RecallResponse["results"];
      }
      if (parsed?.memories && Array.isArray(parsed.memories)) {
        return parsed.memories as RecallResponse["results"];
      }
      // Fall through to recall fallback if list doesn't return an array shape.
    } catch {
      // memory.list not available on this server version — recall fallback.
    }
    try {
      const recall = await this.recall({
        query: "list all memories",
        namespace,
        top_k: limit,
        expand_entities: false,
      });
      return recall.results;
    } catch {
      return [];
    }
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

  /** Pending triggers. YantrikDB returns:
   *    { trigger_id, trigger_type, urgency, reason, suggested_action, source_rids }
   *  We normalize to Chronicler-friendly field names but preserve the raw
   *  response so the UI can show trigger_type as a badge. */
  async triggerPending(namespace?: string): Promise<
    Array<{
      id: string;
      trigger_type: string;
      urgency: number;
      reason: string;
      suggested_action?: string;
      source_rids?: string[];
    }>
  > {
    try {
      const res = await this.transport.call(
        "trigger",
        namespace ? { action: "pending", namespace } : { action: "pending" }
      );
      const parsed = parseMaybeWrapped(res);
      const raw = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>)?.triggers ??
          (parsed as Record<string, unknown>)?.pending ??
          [];
      if (!Array.isArray(raw)) return [];
      return (raw as Array<Record<string, unknown>>).map((t) => ({
        id: String(t.trigger_id ?? t.id ?? ""),
        trigger_type: String(t.trigger_type ?? t.kind ?? "trigger"),
        urgency: Number(t.urgency ?? t.pressure ?? 0),
        reason: String(t.reason ?? t.text ?? t.rationale ?? ""),
        suggested_action:
          typeof t.suggested_action === "string"
            ? t.suggested_action
            : undefined,
        source_rids: Array.isArray(t.source_rids)
          ? (t.source_rids as string[])
          : undefined,
      }));
    } catch {
      return [];
    }
  }

  async triggerAct(id: string): Promise<void> {
    await this.transport
      .call("trigger", { action: "act", trigger_id: id })
      .catch(() => undefined);
  }

  async triggerDismiss(id: string): Promise<void> {
    await this.transport
      .call("trigger", { action: "dismiss", trigger_id: id })
      .catch(() => undefined);
  }

  /** Conflict list. YantrikDB returns rids (memory_a, memory_b) — we
   *  hydrate the texts here so the UI can show them side-by-side. */
  async conflictList(
    namespace?: string,
    limit: number = 500
  ): Promise<
    Array<{
      id: string;
      conflict_type: string;
      priority: string;
      entity?: string;
      detection_reason?: string;
      a?: { rid: string; text: string };
      b?: { rid: string; text: string };
    }>
  > {
    try {
      const args: Record<string, unknown> = { action: "list", limit };
      if (namespace) args.namespace = namespace;
      const res = await this.transport.call("conflict", args);
      const parsed = parseMaybeWrapped(res);
      const raw = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>)?.conflicts ?? [];
      if (!Array.isArray(raw)) return [];
      const normalized = (raw as Array<Record<string, unknown>>).map((c) => ({
        id: String(c.conflict_id ?? c.id ?? ""),
        conflict_type: String(c.conflict_type ?? "unknown"),
        priority: String(c.priority ?? "low"),
        entity: typeof c.entity === "string" ? c.entity : undefined,
        detection_reason:
          typeof c.detection_reason === "string"
            ? c.detection_reason
            : undefined,
        a_rid:
          typeof c.memory_a === "string"
            ? c.memory_a
            : (c.a as { rid?: string } | undefined)?.rid,
        b_rid:
          typeof c.memory_b === "string"
            ? c.memory_b
            : (c.b as { rid?: string } | undefined)?.rid,
      }));
      // Hydrate memory texts for conflicts that might actually need display.
      // Skip hydration for YantrikDB's own minor+low noise — we'll bulk
      // dismiss those without ever showing them, so firing 100+ memory.get
      // calls just to populate text we'll throw away is pure waste.
      const rids = new Set<string>();
      for (const n of normalized) {
        if (n.priority === "low" && n.conflict_type === "minor") continue;
        if (n.a_rid) rids.add(n.a_rid);
        if (n.b_rid) rids.add(n.b_rid);
      }
      const ridList = [...rids];
      const records = await Promise.all(
        ridList.map((rid) => this.getMemory(rid).catch(() => null))
      );
      const textByRid = new Map<string, string>();
      for (let i = 0; i < ridList.length; i++) {
        const rec = records[i];
        if (rec) textByRid.set(ridList[i], rec.text);
      }
      return normalized.map((n) => ({
        id: n.id,
        conflict_type: n.conflict_type,
        priority: n.priority,
        entity: n.entity,
        detection_reason: n.detection_reason,
        a: n.a_rid
          ? { rid: n.a_rid, text: textByRid.get(n.a_rid) ?? "(text unavailable)" }
          : undefined,
        b: n.b_rid
          ? { rid: n.b_rid, text: textByRid.get(n.b_rid) ?? "(text unavailable)" }
          : undefined,
      }));
    } catch {
      return [];
    }
  }

  async conflictResolve(
    id: string,
    strategy: "keep_a" | "keep_b" | "merge" | "dismiss"
  ): Promise<void> {
    await this.transport
      .call("conflict", { action: "resolve", conflict_id: id, strategy })
      .catch(() => undefined);
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

// --- Helpers ---

function parseMaybeWrapped(res: unknown): Record<string, unknown> | unknown[] | null {
  const r = res as { result?: unknown };
  if (typeof r.result === "string") {
    try {
      return JSON.parse(r.result);
    } catch {
      return null;
    }
  }
  if (typeof res === "object" && res !== null) {
    return res as Record<string, unknown>;
  }
  return null;
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
