// Per-session persistence for the chronicle (browser localStorage, and synced
// to the server with the rest of a session's data). Guarded like the other
// stores: storage can be blocked or full.

import { emptyChronicle, parseChronicle, type Chronicle } from "./chronicle";

const KEY = (sessionId: string) => `chronicler.chronicle.v1.${sessionId}`;

export function loadChronicle(sessionId: string): Chronicle {
  try {
    const raw = window.localStorage.getItem(KEY(sessionId));
    return raw ? parseChronicle(JSON.parse(raw)) : emptyChronicle();
  } catch {
    return emptyChronicle();
  }
}

export function saveChronicle(sessionId: string, c: Chronicle): void {
  try {
    window.localStorage.setItem(KEY(sessionId), JSON.stringify(c));
  } catch {
    // storage blocked or full — the chronicle is rebuilt from the chat if lost
  }
}

export function clearChronicle(sessionId: string): void {
  try {
    window.localStorage.removeItem(KEY(sessionId));
  } catch {
    // ignore
  }
}
