// Character card types (v2 and v3) — the community-standard format used by
// chub.ai and other card libraries.

export interface CardV2Data {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  character_book?: CharacterBookV2;
  tags?: string[];
  creator?: string;
  character_version?: string;
  extensions?: Record<string, unknown>;
}

export interface CardV2 {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: CardV2Data;
}

export interface CharacterBookV2 {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, unknown>;
  entries: CharacterBookEntry[];
}

export interface CharacterBookEntry {
  keys: string[];
  content: string;
  enabled?: boolean;
  insertion_order?: number;
  case_sensitive?: boolean;
  priority?: number;
  id?: number;
  comment?: string;
  name?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: "before_char" | "after_char";
}

// v3 spec is a superset — accept same structure with spec string "chara_card_v3".
export interface CardV3 extends Omit<CardV2, "spec" | "spec_version"> {
  spec: "chara_card_v3";
  spec_version: "3.0";
  data: CardV2Data & {
    creator_notes?: string;
    source?: string[];
    group_only_greetings?: string[];
    creation_date?: number;
    modification_date?: number;
    assets?: Array<{ type: string; uri: string; name?: string; ext?: string }>;
    nickname?: string;
  };
}

export type AnyCard = CardV2 | CardV3;
