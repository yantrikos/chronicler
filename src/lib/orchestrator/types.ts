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
  /** Per-segment token breakdown from the composer, for the budget bar in
   *  the PromptInspector. `total` here is the sum of the composed sections
   *  (canon + scene + heuristic + graph), distinct from the overall prompt
   *  total which also includes anti-confabulation framing + lorebook etc. */
  breakdown?: TokenUsage;
  /** The full token budget for this turn (allocation ceiling per section).
   *  Lets the visualizer show "used vs budgeted" per slot. */
  budget?: TokenBudget;
  /** Which composer sections got truncated this turn (i.e. tried to fit
   *  more than the budget allowed and dropped items). UI flags them with
   *  a warning glyph so users know context was lost. */
  truncated_sections?: Array<"canon" | "scene" | "heuristic" | "graph">;
  captured_at: string;
}

export interface Character {
  id: string;
  name: string;
  /** @deprecated Single-world field kept for back-compat. New code should
   *  read world_ids; loadCharacters() migrates legacy data so this can be
   *  empty in fresh installs. */
  world_id?: string;
  /** All worlds this character belongs to. Lorebook scanner unions every
   *  world's namespace with the character's own. Empty / undefined = no
   *  shared worldbooks, only the character's private lorebook applies. */
  world_ids?: string[];
  /** Data URL of the card's avatar image, when known. */
  avatar_url?: string;
  description?: string;
  /** Personality field from the card. Editable in the in-app character editor. */
  personality?: string;
  /** Scenario / setting where the chat takes place. */
  scenario?: string;
  /** Example dialogues from the card (mes_example). */
  mes_example?: string;
  /** first_mes + alternate_greetings from the card, in order. The first
   *  entry is the default. */
  greetings?: string[];
  /** Tags from the card metadata. */
  tags?: string[];
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
  /** Skills that survived state filtering and made it into the prompt.
   *  Tracked here so the outcome loop can score them post-turn. */
  surfaced_skills: Array<{
    skill_id: string;
    body: string;
    skill_type: string;
  }>;
  token_budget: TokenBudget;
  token_usage: TokenUsage;
  /** Composer sections that hit their budget cap and had to drop items.
   *  Surfaced by the PromptInspector budget bar so users can see when
   *  context was lost. */
  truncated_sections: Array<"canon" | "scene" | "heuristic" | "graph">;
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
