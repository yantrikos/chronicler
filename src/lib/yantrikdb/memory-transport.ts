// In-memory YantrikDB transport — for tests and local dogfood when the real
// server isn't reachable. Implements the subset of tools Chronicler needs.
//
// Enough fidelity to validate the orchestrator + write path + recap loop.
// Semantic recall is faked with naive substring scoring.

import type { YantrikDBTransport } from "./client";

interface StoredMemory {
  rid: string;
  text: string;
  memory_type: string;
  importance: number;
  certainty: number;
  source: string;
  namespace: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export class InMemoryTransport implements YantrikDBTransport {
  private mems: StoredMemory[] = [];
  private rid = 0;

  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    switch (tool) {
      case "remember":
        return this.remember(args);
      case "recall":
        return this.recall(args);
      case "forget":
        this.mems = this.mems.filter((m) => m.rid !== args.rid);
        return { result: JSON.stringify({ status: "ok" }) };
      case "correct": {
        const m = this.mems.find((x) => x.rid === args.rid);
        if (m) m.text = String(args.text);
        return { result: JSON.stringify({ status: "ok" }) };
      }
      case "memory": {
        if (args.action === "update_importance") {
          const m = this.mems.find((x) => x.rid === args.rid);
          if (m && typeof args.importance === "number")
            m.importance = args.importance;
        }
        if (args.action === "archive") {
          this.mems = this.mems.filter((x) => x.rid !== args.rid);
        }
        if (args.action === "update_metadata") {
          const m = this.mems.find((x) => x.rid === args.rid);
          if (m) {
            const patch = (args.metadata_patch as Record<string, unknown>) ?? {};
            for (const [k, v] of Object.entries(patch)) {
              if (k === "promotion_history_append") {
                const cur =
                  (m.metadata.promotion_history as unknown[]) ?? [];
                m.metadata.promotion_history = [...cur, v];
              } else {
                m.metadata[k] = v;
              }
            }
          }
        }
        return { result: JSON.stringify({ status: "ok" }) };
      }
      case "session":
      case "graph":
      case "think":
      case "conflict":
      case "temporal":
      case "personality":
      case "procedure":
      case "trigger":
      case "category":
      case "stats":
      case "correct":
        return { result: JSON.stringify({ status: "ok" }) };
      default:
        return { result: JSON.stringify({ status: "ok" }) };
    }
  }

  private remember(args: Record<string, unknown>): unknown {
    const rids: string[] = [];
    const inputs = Array.isArray(args.memories)
      ? (args.memories as Array<Record<string, unknown>>)
      : [args];
    for (const i of inputs) {
      const rid = `mem-${++this.rid}`;
      this.mems.push({
        rid,
        text: String(i.text ?? ""),
        memory_type: String(i.memory_type ?? "semantic"),
        importance: Number(i.importance ?? 0.5),
        certainty: Number(i.certainty ?? 0.8),
        source: String(i.source ?? "user"),
        namespace: String(i.namespace ?? "default"),
        metadata:
          (i.metadata as Record<string, unknown>) ?? ({} as Record<string, unknown>),
        created_at: new Date().toISOString(),
      });
      rids.push(rid);
    }
    return {
      result: JSON.stringify(
        Array.isArray(args.memories)
          ? { rids, count: rids.length, status: "recorded" }
          : { rid: rids[0], status: "recorded" }
      ),
    };
  }

  private recall(args: Record<string, unknown>): unknown {
    const query = String(args.query ?? "").toLowerCase();
    const ns = args.namespace ? String(args.namespace) : undefined;
    const top_k = Number(args.top_k ?? 10);
    const scored = this.mems
      .filter((m) => (ns ? m.namespace === ns : true))
      .map((m) => ({
        rid: m.rid,
        text: m.text,
        type: m.memory_type,
        score: score(query, m.text) + m.importance * 0.2,
        importance: m.importance,
        certainty: m.certainty,
        namespace: m.namespace,
        metadata: m.metadata,
        why_retrieved: ["in-memory"],
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, top_k);
    return {
      result: JSON.stringify({
        count: scored.length,
        results: scored,
        confidence: scored.length ? 0.7 : 0,
        hints: [],
      }),
    };
  }

  // For tests
  all(): StoredMemory[] {
    return [...this.mems];
  }
  clear(): void {
    this.mems = [];
    this.rid = 0;
  }
}

function score(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  let hits = 0;
  for (const w of words) if (t.includes(w)) hits++;
  return hits / Math.max(1, words.length);
}
