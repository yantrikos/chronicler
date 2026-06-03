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

interface StoredSkill {
  skill_id: string;
  body: string;
  skill_type: string;
  applies_to: string[];
  outcomes: Array<{ succeeded: boolean; note?: string; at: string }>;
  state: string;
}

export class InMemoryTransport implements YantrikDBTransport {
  private mems: StoredMemory[] = [];
  private rid = 0;
  private skills = new Map<string, StoredSkill>();

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
      case "skill":
        return this.skill(args);
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

  private skill(args: Record<string, unknown>): unknown {
    const action = String(args.action ?? "");
    if (action === "define") {
      const skill_id = String(args.skill_id ?? "");
      if (!skill_id) {
        return { result: JSON.stringify({ error: "missing skill_id" }) };
      }
      const existing = this.skills.get(skill_id);
      const on_conflict = String(args.on_conflict ?? "replace");
      if (existing && on_conflict === "reject") {
        return {
          result: JSON.stringify({ error: "skill exists", skill_id }),
        };
      }
      this.skills.set(skill_id, {
        skill_id,
        body: String(args.body ?? ""),
        skill_type: String(args.skill_type ?? "pattern"),
        applies_to: Array.isArray(args.applies_to)
          ? (args.applies_to as string[])
          : [],
        outcomes: existing?.outcomes ?? [],
        state: existing?.state ?? "candidate",
      });
      return { result: JSON.stringify({ status: "defined", skill_id }) };
    }
    if (action === "surface") {
      const query = String(args.query ?? "").toLowerCase();
      const wanted = Array.isArray(args.applies_to)
        ? new Set((args.applies_to as string[]).map((s) => s.toLowerCase()))
        : null;
      const top_k = Number(args.top_k ?? 5);
      const out = [...this.skills.values()]
        .filter((s) => {
          if (!wanted) return true;
          return s.applies_to.some((a) => wanted.has(a.toLowerCase()));
        })
        .map((s) => ({
          skill_id: s.skill_id,
          body: s.body,
          skill_type: s.skill_type,
          applies_to: s.applies_to,
          score: score(query, s.body),
          uses: s.outcomes.length,
          success_rate: s.outcomes.length
            ? s.outcomes.filter((o) => o.succeeded).length / s.outcomes.length
            : 0,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, top_k);
      return { result: JSON.stringify({ skills: out }) };
    }
    if (action === "outcome") {
      const s = this.skills.get(String(args.skill_id ?? ""));
      if (s) {
        s.outcomes.push({
          succeeded: args.succeeded === true,
          note: args.note ? String(args.note) : undefined,
          at: new Date().toISOString(),
        });
      }
      return { result: JSON.stringify({ status: "recorded" }) };
    }
    if (action === "get") {
      const s = this.skills.get(String(args.skill_id ?? ""));
      if (!s) {
        return { result: JSON.stringify({ error: "not found" }) };
      }
      return { result: JSON.stringify(s) };
    }
    if (action === "list") {
      const wanted = Array.isArray(args.applies_to)
        ? new Set((args.applies_to as string[]).map((s) => s.toLowerCase()))
        : null;
      const skillType = args.skill_type ? String(args.skill_type) : null;
      const limit = Number(args.limit ?? 100);
      const out = [...this.skills.values()]
        .filter((s) => (skillType ? s.skill_type === skillType : true))
        .filter((s) =>
          !wanted ? true : s.applies_to.some((a) => wanted.has(a.toLowerCase()))
        )
        .slice(0, limit);
      return { result: JSON.stringify({ skills: out }) };
    }
    return { result: JSON.stringify({ status: "ok" }) };
  }

  // For tests
  skillsAll(): StoredSkill[] {
    return [...this.skills.values()];
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
