// Per-skill core_trait promotion verdicts.
//
// State is otherwise derived from outcomes (skill-outcomes.ts → deriveState).
// Core trait promotion adds two non-quantitative inputs that can't be
// derived from outcomes alone:
//   1. The LLM verifier's accept verdict — "is this an identity trait or
//      just a situational skill?"
//   2. A `crystallized_at` timestamp for the developmental timeline UI.
//
// Both live in localStorage as a JSON map keyed by skill_id. Parallel
// to overrides.ts — same trust/persistence model. Wiping localStorage
// loses crystallizations but the verifier can re-run them since the
// quantitative criteria are deterministic from substrate outcomes.

const STORAGE_KEY = "chronicler.skill.core_trait_promotions.v1";

export interface CoreTraitPromotion {
  /** ISO timestamp when the verifier accepted this as a core trait. */
  crystallized_at: string;
  /** Frozen snapshot of the quantitative evidence at promotion time. */
  evidence: {
    total_net_score: number;
    reinforcement_count: number;
    distinct_sessions: number;
    days_active: number;
    success_rate: number;
  };
  /** Rank 0..1 — relative importance among this character's core traits.
   *  Used to truncate the <character_identity> block under token budget
   *  pressure. Top-7 rule (Miller's number) caps the visible set. */
  rank: number;
  /** Verifier's accept reasoning — one short paragraph. Surfaced in the
   *  identity inspector when the user expands a trait. */
  verifier_reasoning: string;
  /** Which character this trait belongs to. Skill substrate uses
   *  applies_to[] which can be multi; we pin to a single character at
   *  crystallization time because identity is per-character. */
  character_id: string;
}

export function loadCoreTraitPromotions(): Map<string, CoreTraitPromotion> {
  if (typeof localStorage === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Map();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return new Map();
    const out = new Map<string, CoreTraitPromotion>();
    for (const [skill_id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidPromotion(value)) {
        out.set(skill_id, value as CoreTraitPromotion);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

export function saveCoreTraitPromotions(
  map: Map<string, CoreTraitPromotion>
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const obj: Record<string, CoreTraitPromotion> = {};
    for (const [k, v] of map) obj[k] = v;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* quota etc — silent */
  }
}

export function setCoreTraitPromotion(
  skill_id: string,
  promotion: CoreTraitPromotion
): void {
  const map = loadCoreTraitPromotions();
  map.set(skill_id, promotion);
  saveCoreTraitPromotions(map);
}

export function clearCoreTraitPromotion(skill_id: string): void {
  const map = loadCoreTraitPromotions();
  map.delete(skill_id);
  saveCoreTraitPromotions(map);
}

export function getCoreTraitPromotion(
  skill_id: string
): CoreTraitPromotion | undefined {
  return loadCoreTraitPromotions().get(skill_id);
}

/** Pull all crystallized traits for a character, ranked highest first.
 *  This is the read path for the <character_identity> block + identity
 *  inspector. */
export function listCoreTraitsForCharacter(
  character_id: string
): Array<{ skill_id: string; promotion: CoreTraitPromotion }> {
  const all = loadCoreTraitPromotions();
  const filtered: Array<{ skill_id: string; promotion: CoreTraitPromotion }> = [];
  for (const [skill_id, promotion] of all) {
    if (promotion.character_id === character_id) {
      filtered.push({ skill_id, promotion });
    }
  }
  filtered.sort((a, b) => b.promotion.rank - a.promotion.rank);
  return filtered;
}

function isValidPromotion(v: unknown): v is CoreTraitPromotion {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.crystallized_at === "string" &&
    typeof o.rank === "number" &&
    typeof o.verifier_reasoning === "string" &&
    typeof o.character_id === "string" &&
    o.evidence !== null &&
    typeof o.evidence === "object"
  );
}
