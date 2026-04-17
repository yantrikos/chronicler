// YantrikDB + Chronicler memory metadata conventions.
// See docs/ADR-002-memory-conventions.md

export type Tier = "reflex" | "heuristic" | "canon";

export type CanonicalStatus =
  | "canon"
  | "non-canon"
  | "dream"
  | "alternate-timeline"
  | "deleted-scene";

export type Source =
  | "user"
  | "inference"
  | "document"
  | "system"
  | "imported_seed"
  | "confirmed";

export type MemoryType = "semantic" | "episodic" | "procedural";

export type EmotionalState =
  | "joy"
  | "frustration"
  | "excitement"
  | "concern"
  | "neutral";

export interface PromotionEvent {
  at: string;
  from_tier: Tier;
  to_tier: Tier;
  reason:
    | "user_pin"
    | "user_demote"
    | "threshold_met"
    | "retcon"
    | "imported_seed"
    | "user_confirm";
}

export interface LorebookEntryMeta {
  keys: string[];
  secondary_keys?: string[];
  /** If true, BOTH a primary key AND a secondary key must match to activate. */
  selective?: boolean;
  /** If true, always active regardless of trigger match. */
  constant?: boolean;
  /** Where to inject the entry relative to the character system prompt. */
  position: "before_char" | "after_char";
  /** Lower value = inserted earlier within its position group. */
  insertion_order: number;
  case_sensitive: boolean;
  enabled: boolean;
  name?: string;
  comment?: string;
}

export interface ChroniclerMetadata {
  tier: Tier;
  canonical_status: CanonicalStatus;
  visible_to: string[];
  character_id?: string;
  world_id?: string;
  session_id: string;
  source_turn_id?: string;
  promotion_history?: PromotionEvent[];
  raw_card?: string;
  reinforcement_count?: number;
  last_reinforced_at?: string;
  first_reinforced_in_session?: string;
  /** Present when the memory is a lorebook / character_book entry. */
  lorebook_entry?: LorebookEntryMeta;
}

export interface MemoryRecord {
  rid: string;
  text: string;
  type: MemoryType;
  source: Source;
  certainty: number;
  importance: number;
  valence?: number;
  emotional_state?: EmotionalState;
  namespace: string;
  metadata: ChroniclerMetadata;
  created_at?: string;
  last_accessed?: string;
}

export interface RememberInput {
  text: string;
  memory_type?: MemoryType;
  importance?: number;
  certainty?: number;
  source?: Source;
  valence?: number;
  emotional_state?: EmotionalState;
  namespace: string;
  metadata: ChroniclerMetadata;
}

export interface RecallQuery {
  query: string;
  top_k?: number;
  memory_type?: MemoryType;
  domain?: string;
  source?: Source;
  namespace?: string;
  expand_entities?: boolean;
  include_consolidated?: boolean;
  // Chronicler-specific post-filters (applied client-side on the MCP transport):
  speaker?: string; // enforces visible_to ACL
  tier?: Tier | Tier[];
  canonical_status?: CanonicalStatus | CanonicalStatus[];
}

export interface RecallResult {
  rid: string;
  text: string;
  type: MemoryType;
  score: number;
  importance: number;
  certainty?: number;
  namespace?: string;
  metadata?: Partial<ChroniclerMetadata>;
  why_retrieved?: string[];
}

export interface RecallResponse {
  count: number;
  results: RecallResult[];
  confidence: number;
  hints: string[];
}

// --- Namespace helpers ---
export const ns = {
  character: (id: string) => `character:${id}`,
  world: (id: string) => `world:${id}`,
  session: (id: string) => `session:${id}`,
  user: (id: string) => `user:${id}`,
};

// --- Defaults by tier (centralized policy) ---
export const TIER_DEFAULTS: Record<
  Tier,
  { source: Source; certainty: number; importance: number }
> = {
  reflex: { source: "system", certainty: 0.7, importance: 0.2 },
  heuristic: { source: "inference", certainty: 0.5, importance: 0.4 },
  canon: { source: "user", certainty: 0.9, importance: 0.7 },
};

export const CANON_CERTAINTY_FLOOR = 0.85;
export const HEURISTIC_CERTAINTY_CEILING = 0.7;
