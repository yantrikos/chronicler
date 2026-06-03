// Context composition with token budget. Default ratios:
//   40% canon / 30% scene / 20% heuristic / 10% graph
// See Saga task #9.

import type { ChatTurn, ComposedContext, TokenBudget, TokenUsage } from "./types";
import { DEFAULT_TOKEN_BUDGET } from "./types";
import type { RetrievalResult, SurfacedSkill } from "./pipeline";
import type { SkillState } from "../instrumentation/skill-transition-log";

export interface ComposeOptions {
  /** Per-skill state lookup. Returning "suppressed" or "archived" excludes
   *  the skill from the prompt. Unknown → treated as "candidate" (still
   *  surfaceable, just unproven). */
  getSkillState?: (skill_id: string) => SkillState | undefined;
  /** Cap on skills surfaced into the prompt (after state filter). */
  maxSkills?: number;
  /** Minimum substrate relevance score required for a skill to be
   *  surfaced. Defaults to 0.15 — anything that scores zero (no query
   *  overlap) gets excluded so off-topic skills don't fossilize into
   *  every prompt. */
  minSkillScore?: number;
}

// rough approximation — replace with provider-specific tokenizer later
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function composeContext(
  retrieval: RetrievalResult,
  recentTurns: ChatTurn[],
  budgetOverride?: Partial<TokenBudget>,
  options?: ComposeOptions
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

  const surfacedSkills = filterSkillsByState(
    retrieval.surfaced_skills ?? [],
    options
  );

  const token_usage: TokenUsage = {
    canon: canon.used,
    scene: scene.used,
    heuristic: heuristic.used,
    graph: graph.used,
    system_prompt: 0, // filled by caller
    total: canon.used + scene.used + heuristic.used + graph.used,
  };

  const truncated_sections: Array<"canon" | "scene" | "heuristic" | "graph"> =
    [];
  if (canon.dropped > 0) truncated_sections.push("canon");
  if (scene.dropped > 0) truncated_sections.push("scene");
  if (heuristic.dropped > 0) truncated_sections.push("heuristic");
  if (graph.dropped > 0) truncated_sections.push("graph");

  return {
    canon: canon.items,
    scene: scene.items,
    heuristic: heuristic.items,
    graph_neighborhood: graph.items,
    active_temporal_triggers: retrieval.temporal_triggers,
    pending_conflicts_count: retrieval.pending_conflicts,
    surfaced_skills: surfacedSkills,
    token_budget,
    token_usage,
    truncated_sections,
  };
}

function filterSkillsByState(
  skills: SurfacedSkill[],
  options?: ComposeOptions
): Array<{ skill_id: string; body: string; skill_type: string }> {
  const max = options?.maxSkills ?? 5;
  const minScore = options?.minSkillScore ?? 0.15;
  const out: Array<{ skill_id: string; body: string; skill_type: string }> = [];
  for (const s of skills) {
    const state = options?.getSkillState?.(s.skill_id) ?? "candidate";
    if (state === "suppressed" || state === "archived") continue;
    // Substrate scores below `minScore` are off-topic for this turn —
    // surfacing them anyway clutters every prompt with stale catalog
    // entries and erodes the restraint contract.
    if (typeof s.score === "number" && s.score < minScore) continue;
    out.push({
      skill_id: s.skill_id,
      body: s.body,
      skill_type: s.skill_type,
    });
    if (out.length >= max) break;
  }
  return out;
}

function fitToBudget<T>(
  items: T[],
  budget: number,
  text: (t: T) => string
): { items: T[]; used: number; dropped: number } {
  const out: T[] = [];
  let used = 0;
  let dropped = 0;
  for (const item of items) {
    const cost = approxTokens(text(item));
    if (used + cost > budget) {
      dropped++;
      continue;
    }
    out.push(item);
    used += cost;
  }
  return { items: out, used, dropped };
}

function fitScene(
  turns: ChatTurn[],
  budget: number
): { items: ChatTurn[]; used: number; dropped: number } {
  // Scene is chronological but budgeted from most recent back.
  const reversed = [...turns].reverse();
  const kept: ChatTurn[] = [];
  let used = 0;
  let dropped = 0;
  for (const t of reversed) {
    const cost = approxTokens(`${t.speaker}: ${t.content}`);
    if (used + cost > budget) {
      dropped++;
      continue;
    }
    kept.unshift(t);
    used += cost;
  }
  return { items: kept, used, dropped };
}

// Render a composed context into the prompt sections expected by the model.
export function renderContext(
  ctx: ComposedContext,
  characterSystemPrompt: string
): {
  system: string;
  history: { role: "user" | "assistant" | "system"; content: string }[];
} {
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
  // Learned character behaviors verified across multiple sessions. The label
  // "character_skills" stays internal; the system prompt frames them as
  // habitual patterns the character has shown so the model treats them as
  // characterization, not as instruction-following directives.
  const skillsBlock = ctx.surfaced_skills.length
    ? `<character_development>\nThe character has shown these patterns across past scenes — stay consistent with them when relevant:\n${ctx.surfaced_skills
        .map((s) => `- (${s.skill_type}) ${s.body}`)
        .join("\n")}\n</character_development>`
    : "";

  const system = [
    characterSystemPrompt,
    canonBlock,
    heuristicBlock,
    triggerBlock,
    skillsBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const history = ctx.scene.map((t) => ({
    role: t.role === "user" ? ("user" as const) : ("assistant" as const),
    content: t.content,
  }));

  return { system, history };
}
