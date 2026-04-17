// Context composition with token budget. Default ratios:
//   40% canon / 30% scene / 20% heuristic / 10% graph
// See Saga task #9.

import type { ChatTurn, ComposedContext, TokenBudget, TokenUsage } from "./types";
import { DEFAULT_TOKEN_BUDGET } from "./types";
import type { RetrievalResult } from "./pipeline";

// rough approximation — replace with provider-specific tokenizer later
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function composeContext(
  retrieval: RetrievalResult,
  recentTurns: ChatTurn[],
  budgetOverride?: Partial<TokenBudget>
): ComposedContext {
  const token_budget: TokenBudget = { ...DEFAULT_TOKEN_BUDGET, ...budgetOverride };
  const canonBudget = Math.floor(token_budget.total * token_budget.canon_pct);
  const sceneBudget = Math.floor(token_budget.total * token_budget.scene_pct);
  const heuristicBudget = Math.floor(token_budget.total * token_budget.heuristic_pct);
  const graphBudget = Math.floor(token_budget.total * token_budget.graph_pct);

  const canon = fitToBudget(retrieval.canon, canonBudget, (r) => r.text);
  const scene = fitScene(recentTurns, sceneBudget);
  const heuristic = fitToBudget(
    retrieval.heuristic.filter((r) => (r.score ?? 0) > 0.4),
    heuristicBudget,
    (r) => r.text
  );
  const graph = fitToBudget(retrieval.graph, graphBudget, (r) => r.text);

  const token_usage: TokenUsage = {
    canon: canon.used,
    scene: scene.used,
    heuristic: heuristic.used,
    graph: graph.used,
    system_prompt: 0, // filled by caller
    total: canon.used + scene.used + heuristic.used + graph.used,
  };

  return {
    canon: canon.items,
    scene: scene.items,
    heuristic: heuristic.items,
    graph_neighborhood: graph.items,
    active_temporal_triggers: retrieval.temporal_triggers,
    pending_conflicts_count: retrieval.pending_conflicts,
    token_budget,
    token_usage,
  };
}

function fitToBudget<T>(
  items: T[],
  budget: number,
  text: (t: T) => string
): { items: T[]; used: number } {
  const out: T[] = [];
  let used = 0;
  for (const item of items) {
    const cost = approxTokens(text(item));
    if (used + cost > budget) break;
    out.push(item);
    used += cost;
  }
  return { items: out, used };
}

function fitScene(turns: ChatTurn[], budget: number): { items: ChatTurn[]; used: number } {
  // Scene is chronological but budgeted from most recent back.
  const reversed = [...turns].reverse();
  const kept: ChatTurn[] = [];
  let used = 0;
  for (const t of reversed) {
    const cost = approxTokens(`${t.speaker}: ${t.content}`);
    if (used + cost > budget) break;
    kept.unshift(t);
    used += cost;
  }
  return { items: kept, used };
}

// Render a composed context into the prompt sections expected by the model.
export function renderContext(
  ctx: ComposedContext,
  characterSystemPrompt: string
): { system: string; history: { role: "user" | "assistant"; content: string }[] } {
  // Render each memory with canonical_status-aware prefix. Retconned memories
  // (dream/alternate-timeline) stay retrievable but are framed so the model
  // knows how to treat them. See ADR-002.
  const render = (c: { text: string; metadata?: { canonical_status?: string } }) => {
    const s = c.metadata?.canonical_status;
    if (s === "dream") return `- (dreamt) ${c.text}`;
    if (s === "alternate-timeline")
      return `- (in an alternate scenario) ${c.text}`;
    return `- ${c.text}`;
  };

  const canonFacts = ctx.canon.filter(
    (c) =>
      !c.metadata?.canonical_status ||
      c.metadata.canonical_status === "canon" ||
      c.metadata.canonical_status === "dream" ||
      c.metadata.canonical_status === "alternate-timeline"
  );

  const canonBlock = canonFacts.length
    ? `<canon>\n${canonFacts.map(render).join("\n")}\n</canon>`
    : "<canon>\n(no canon yet)\n</canon>";
  const heuristicBlock = ctx.heuristic.length
    ? `<heuristic>\n${ctx.heuristic
        .map((h) => `- possibly: ${h.text}`)
        .join("\n")}\n</heuristic>`
    : "";
  const triggerBlock = ctx.active_temporal_triggers.length
    ? `<scene_hooks>\n${ctx.active_temporal_triggers.map((t) => `- ${t}`).join("\n")}\n</scene_hooks>`
    : "";

  const system = [
    characterSystemPrompt,
    canonBlock,
    heuristicBlock,
    triggerBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const history = ctx.scene.map((t) => ({
    role: t.role === "user" ? ("user" as const) : ("assistant" as const),
    content: t.content,
  }));

  return { system, history };
}
