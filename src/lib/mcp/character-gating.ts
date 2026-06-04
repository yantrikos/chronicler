// Per-character MCP tool allowlists.
//
// Default behavior: a character with no configured allowlist gets ALL
// enabled tools from ALL enabled servers. This makes "register a server,
// it just works" the happy path.
//
// Once a user explicitly configures a character (any value saved), only
// the checked tools are exposed to the model for that character. The
// distinction matters: an empty Set means "deny all", not "default".
// We persist a `configured: boolean` flag to disambiguate.

const STORAGE_KEY = (characterId: string) =>
  `chronicler.mcp.character_gating_v1.${characterId}`;

export interface CharacterGating {
  /** True iff the user has explicitly saved gating for this character.
   *  When false, downstream code should not call .allowedTools — fall
   *  back to "all tools allowed" (the default). */
  configured: boolean;
  /** Qualified tool names ("serverId__toolName") allowed for this
   *  character. Empty when configured=true means "explicit deny all". */
  allowedTools: string[];
}

export function loadCharacterGating(characterId: string): CharacterGating {
  if (typeof localStorage === "undefined") {
    return { configured: false, allowedTools: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY(characterId));
    if (raw === null) return { configured: false, allowedTools: [] };
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.configured === "boolean" &&
      Array.isArray(parsed.allowedTools)
    ) {
      return {
        configured: parsed.configured,
        allowedTools: parsed.allowedTools.filter(
          (s: unknown) => typeof s === "string"
        ),
      };
    }
  } catch {
    /* fall through */
  }
  return { configured: false, allowedTools: [] };
}

export function saveCharacterGating(
  characterId: string,
  gating: CharacterGating
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY(characterId), JSON.stringify(gating));
  } catch {
    /* ignore quota errors */
  }
}

/** Resolve the effective allowedTools Set for a turn:
 *   - configured=false  → undefined (no filter; orchestrator allows all)
 *   - configured=true   → Set of allowedTools (may be empty = deny all)
 *  The orchestrator's tool-loop interprets `allowedTools: undefined` as
 *  "no filter". */
export function resolveAllowedTools(
  gating: CharacterGating
): Set<string> | undefined {
  if (!gating.configured) return undefined;
  return new Set(gating.allowedTools);
}
