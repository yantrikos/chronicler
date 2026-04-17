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
  opts: { greeting_index?: number; author_note?: string; title?: string } = {}
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
    scene_kind: sceneObj.kind,
    scene_participants: sceneObj.participants,
    scene_id: sceneObj.id,
    scene_created_at: sceneObj.created_at,
  };
}

// --- Characters (avatar + raw_card + system_prompt persisted) ---

export function listCharacters(): Character[] {
  return safeGet<Character[]>(K_CHARACTERS) ?? [];
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
