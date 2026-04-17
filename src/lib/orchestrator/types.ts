// Orchestrator types — the policy layer between chat UI and YantrikDB.

import type { RecallResult, Tier } from "../yantrikdb/types";

export interface ChatTurn {
  id: string;
  role: "user" | "assistant" | "system";
  speaker: string; // user id or character id
  content: string;
  created_at: string;
  session_id: string;
  in_reply_to?: string;
  /** All generated alternatives for this turn (assistant only). `content`
   *  always reflects `swipes[swipe_index]`. First entry is the original
   *  reply; each regenerate appends a new entry and bumps swipe_index. */
  swipes?: string[];
  swipe_index?: number;
}

export interface PromptCapture {
  system: string;
  messages: Array<{ role: string; content: string }>;
  model: string;
  token_estimate: {
    system: number;
    messages: number;
    total: number;
  };
  captured_at: string;
}

export interface Character {
  id: string;
  name: string;
  world_id?: string;
  /** Data URL of the card's avatar image, when known. */
  avatar_url?: string;
  description?: string;
  /** first_mes + alternate_greetings from the card, in order. The first
   *  entry is the default. */
  greetings?: string[];
  /** Full system prompt derived from the card (for re-loading across sessions). */
  system_prompt?: string;
  /** Original card JSON (for round-trip export). */
  raw_card?: string;
}

export interface Session {
  id: string;
  character_ids: string[];
  world_id?: string;
  user_id: string;
  created_at: string;
  ended_at?: string;
}

export interface ComposedContext {
  canon: RecallResult[]; // budget-allocated
  scene: ChatTurn[]; // recent turns
  heuristic: RecallResult[]; // labeled "possibly"
  graph_neighborhood: RecallResult[];
  active_temporal_triggers: string[]; // narrative beats
  pending_conflicts_count: number; // shown in sidebar, not injected
  token_budget: TokenBudget;
  token_usage: TokenUsage;
}

export interface TokenBudget {
  total: number;
  canon_pct: number; // default 0.4
  scene_pct: number; // default 0.3
  heuristic_pct: number; // default 0.2
  graph_pct: number; // default 0.1
}

export interface TokenUsage {
  canon: number;
  scene: number;
  heuristic: number;
  graph: number;
  system_prompt: number;
  total: number;
}

export interface TurnRequest {
  session_id: string;
  user_id: string;
  speaker: string; // who is about to speak — user id when user is typing, character id when taking a character's turn
  user_message?: ChatTurn; // present if this turn is a user message the model must reply to
  character: Character;
  token_budget?: Partial<TokenBudget>;
}

export interface WriteClassification {
  reflex: string[]; // texts to write as reflex
  heuristic: string[]; // inferred facts
  canon: string[]; // user-declared truths (e.g. "remember that X")
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  // 4096 picked to fit the default context window of qwen3.5:4b and similar
  // small local models. Users on larger-context models can bump this in the
  // orchestrator constructor. Scene/canon percentages tuned to keep prompt
  // eval time predictable even after many turns of accumulated history.
  total: 4000,
  canon_pct: 0.4,
  scene_pct: 0.25,
  heuristic_pct: 0.2,
  graph_pct: 0.1,
};

export const TIER_INJECTION_LABELS: Record<Tier, string> = {
  canon: "<canon>",
  heuristic: "<heuristic>", // also rendered as "possibly: ..."
  reflex: "<scene>",
};
