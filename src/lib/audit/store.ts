// Persistence for audit results and per-character trait lists (localStorage,
// synced to the server with the rest of a chat's data). Guarded like the other
// stores: storage can be blocked or full.

import type { AuditReport } from "./run";

const REPORT = (sessionId: string) => `chronicler.audit.v1.${sessionId}`;
const TRAITS = (characterId: string) => `chronicler.audit.traits.v1.${characterId}`;

export function loadReport(sessionId: string): AuditReport | null {
  try {
    const raw = window.localStorage.getItem(REPORT(sessionId));
    const o = raw ? JSON.parse(raw) : null;
    return o && Array.isArray(o.findings) && Array.isArray(o.traits) ? (o as AuditReport) : null;
  } catch {
    return null;
  }
}

export function saveReport(sessionId: string, r: AuditReport): void {
  try {
    window.localStorage.setItem(REPORT(sessionId), JSON.stringify(r));
  } catch {
    /* the report can simply be re-run */
  }
}

export function loadTraits(characterId: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(TRAITS(characterId));
    const o = raw ? JSON.parse(raw) : null;
    return Array.isArray(o) ? o.filter((t): t is string => typeof t === "string") : null;
  } catch {
    return null;
  }
}

export function saveTraits(characterId: string, traits: string[]): void {
  try {
    window.localStorage.setItem(TRAITS(characterId), JSON.stringify(traits));
  } catch {
    /* ignore */
  }
}
