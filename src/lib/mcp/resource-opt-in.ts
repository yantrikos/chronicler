// Per-character MCP resource opt-in.
//
// MCP servers can expose three kinds of primitives: tools (callable
// functions, gated by character-gating.ts), resources (URI-addressable
// data, gated by THIS module), and prompts (parameterized templates,
// future).
//
// The retrieval path queries opted-in resources alongside character/
// world canon — community lore databases, world-fact servers, sourcebook
// scrapers, anything an MCP server can expose as URIs.
//
// Storage model mirrors character-gating: localStorage per character,
// configured boolean disambiguates "no opt-ins yet" (default deny —
// resources cost network + need explicit choice) from "explicit empty
// allowlist".
//
// Why default-deny for resources but default-allow for tools? Tools
// don't compose with retrieval implicitly — they fire only when the
// model decides to call. Resources are pulled in EVERY turn. Implicit
// "all resources from all servers" would explode token budgets and
// leak unrelated worlds into the model's context.

const STORAGE_KEY = (characterId: string) =>
  `chronicler.mcp.character_resources_v1.${characterId}`;

export interface CharacterResourceOptIn {
  configured: boolean;
  /** Qualified resource URIs ("serverId::uri") opted in for this character. */
  enabledResources: string[];
}

export function loadCharacterResourceOptIn(
  characterId: string
): CharacterResourceOptIn {
  if (typeof localStorage === "undefined") {
    return { configured: false, enabledResources: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY(characterId));
    if (raw === null) return { configured: false, enabledResources: [] };
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.configured === "boolean" &&
      Array.isArray(parsed.enabledResources)
    ) {
      return {
        configured: parsed.configured,
        enabledResources: parsed.enabledResources.filter(
          (s: unknown) => typeof s === "string"
        ),
      };
    }
  } catch {
    /* fall through */
  }
  return { configured: false, enabledResources: [] };
}

export function saveCharacterResourceOptIn(
  characterId: string,
  optIn: CharacterResourceOptIn
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY(characterId), JSON.stringify(optIn));
  } catch {
    /* ignore quota errors */
  }
}

/** Returns the qualified URIs to fetch for this turn. Default
 *  (configured=false) returns []; the character has opted into nothing
 *  yet. Configured + empty = explicit "no resources" (same observable
 *  behavior). */
export function resolveEnabledResources(
  optIn: CharacterResourceOptIn
): string[] {
  if (!optIn.configured) return [];
  return [...optIn.enabledResources];
}

/** Build the qualified URI for a (serverId, uri) pair. The :: separator
 *  is used because URIs can contain __, so the tool-gating separator
 *  would collide. */
const QUALIFIER_SEP = "::";

export function qualifyResourceUri(serverId: string, uri: string): string {
  return `${serverId}${QUALIFIER_SEP}${uri}`;
}

export function splitQualifiedResource(
  qualified: string
): { serverId: string; uri: string } | null {
  const idx = qualified.indexOf(QUALIFIER_SEP);
  if (idx <= 0 || idx >= qualified.length - QUALIFIER_SEP.length) return null;
  return {
    serverId: qualified.slice(0, idx),
    uri: qualified.slice(idx + QUALIFIER_SEP.length),
  };
}
