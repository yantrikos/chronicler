// Browser-side session persistence. Sessions live in localStorage so they
// survive reloads. Turns per session are keyed under a separate prefix so
// loading metadata is cheap even with long chats.
//
// Keys:
//   chronicler.sessions.v1            — SessionMeta[]
//   chronicler.session.<id>.turns     — ChatTurn[]
//   chronicler.characters.v1          — serialized Character[]
//
// Not encrypted. This is local-first software; filesystem access controls
// are the trust boundary. Same contract as SillyTavern / Open WebUI.

import type { Character, ChatTurn } from "../orchestrator/types";
import type { Scene } from "../orchestrator/scene";

export interface SessionMeta {
  id: string;
  title: string;
  character_ids: string[];
  world_id?: string;
  created_at: string;
  last_at: string;
  preview: string; // first ~80 chars of last message
  turn_count: number;
  greeting_index?: number;
  author_note?: string;
  scene_kind: "solo" | "group";
  scene_participants: string[];
  scene_id: string;
  scene_created_at: string;
  /** If this session was forked from another, the source session id + the
   *  turn id at which it branched. Used by SessionList to show lineage. */
  parent_session_id?: string;
  forked_at_turn_id?: string;
  /** Active sampling preset id for this session. Switching presets in the
   *  header only affects the current session; new sessions fall back to
   *  the app-level default. See src/lib/sampling/presets.ts. */
  preset_id?: string;
  /** Author's note injection depth, measured in turns from the END of the
   *  history. 0 = system prompt only (default — note lives outside the
   *  message stream). N > 0 = inject the note as a synthetic system
   *  message at history[length - N], so the model sees it closer to the
   *  reply it's about to generate. Higher depth = weaker steering. */
  author_note_depth?: number;
  /** Active user persona id for this session. Switching personas in the
   *  scene strip only affects the current session; new sessions fall back
   *  to ChroniclerConfig.active_persona_id. */
  persona_id?: string;
  /** Scene Intensity for this session — prompt-only steering of how
   *  directly the model writes intimate scenes. Default "neutral" = no
   *  injection. See src/lib/intensity/registry.ts.
   *  IMPORTANT: this is steering, not a filter. Chronicler never filters
   *  model input or output. The mode just adds a snippet to the system
   *  prompt; the model decides whether to follow it. */
  intensity_id?: string;
}

const K_SESSIONS = "chronicler.sessions.v1";
const K_CHARACTERS = "chronicler.characters.v1";
const K_TURNS = (id: string) => `chronicler.session.${id}.turns`;

function safeGet<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeSet(key: string, val: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // Quota exceeded or similar — swallow. Chat still works in-memory.
  }
}

// --- Sessions ---

export function listSessions(): SessionMeta[] {
  const xs = safeGet<SessionMeta[]>(K_SESSIONS) ?? [];
  return xs.sort((a, b) => b.last_at.localeCompare(a.last_at));
}

export function saveSessionMeta(meta: SessionMeta): void {
  const all = safeGet<SessionMeta[]>(K_SESSIONS) ?? [];
  const idx = all.findIndex((s) => s.id === meta.id);
  if (idx >= 0) all[idx] = meta;
  else all.unshift(meta);
  safeSet(K_SESSIONS, all);
}

export function deleteSession(id: string): void {
  const all = safeGet<SessionMeta[]>(K_SESSIONS) ?? [];
  safeSet(K_SESSIONS, all.filter((s) => s.id !== id));
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(K_TURNS(id));
  }
}

export function loadTurns(sessionId: string): ChatTurn[] {
  return safeGet<ChatTurn[]>(K_TURNS(sessionId)) ?? [];
}

export function saveTurns(sessionId: string, turns: ChatTurn[]): void {
  safeSet(K_TURNS(sessionId), turns);
}

export function metaFromScene(
  sessionId: string,
  sceneObj: Scene,
  characters: Character[],
  turns: ChatTurn[],
  opts: {
    greeting_index?: number;
    author_note?: string;
    author_note_depth?: number;
    intensity_id?: string;
    title?: string;
  } = {}
): SessionMeta {
  const last = turns[turns.length - 1];
  const now = new Date().toISOString();
  const firstChar = characters[0];
  const title =
    opts.title ??
    (characters.length === 1
      ? `${firstChar?.name ?? "session"}`
      : characters.map((c) => c.name).join(" & "));
  return {
    id: sessionId,
    title,
    character_ids: characters.map((c) => c.id),
    world_id: firstChar?.world_id,
    created_at: turns[0]?.created_at ?? now,
    last_at: last?.created_at ?? now,
    preview:
      last?.content.replace(/\s+/g, " ").slice(0, 80) ??
      `new chat with ${firstChar?.name ?? "character"}`,
    turn_count: turns.length,
    greeting_index: opts.greeting_index,
    author_note: opts.author_note,
    author_note_depth: opts.author_note_depth,
    intensity_id: opts.intensity_id,
    scene_kind: sceneObj.kind,
    scene_participants: sceneObj.participants,
    scene_id: sceneObj.id,
    scene_created_at: sceneObj.created_at,
  };
}

// --- Characters (avatar + raw_card + system_prompt persisted) ---

export function listCharacters(): Character[] {
  const raw = safeGet<Character[]>(K_CHARACTERS) ?? [];
  // Migration: legacy characters carry only `world_id`. Project that into
  // the new `world_ids` array so all downstream consumers can read the
  // multi-world shape uniformly. We don't strip world_id (back-compat).
  return raw.map((c) => {
    if (c.world_ids && c.world_ids.length > 0) return c;
    if (c.world_id) return { ...c, world_ids: [c.world_id] };
    return c;
  });
}

export function saveCharacter(char: Character): void {
  const all = safeGet<Character[]>(K_CHARACTERS) ?? [];
  const idx = all.findIndex((c) => c.id === char.id);
  if (idx >= 0) all[idx] = char;
  else all.push(char);
  safeSet(K_CHARACTERS, all);
}

export function deleteCharacter(id: string): void {
  const all = safeGet<Character[]>(K_CHARACTERS) ?? [];
  safeSet(K_CHARACTERS, all.filter((c) => c.id !== id));
}
