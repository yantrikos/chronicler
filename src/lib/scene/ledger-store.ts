// Per-session persistence for the consequence ledger (browser localStorage).
// Guarded like the scene board: storage can be blocked or full.

import { emptyLedger, type Deed, type Ledger } from "./ledger";

const KEY = (sessionId: string) => `chronicler.ledger.v1.${sessionId}`;

export function loadLedger(sessionId: string): Ledger {
  try {
    const raw = window.localStorage.getItem(KEY(sessionId));
    if (!raw) return emptyLedger();
    const o = JSON.parse(raw) as Partial<Ledger>;
    const deeds = (Array.isArray(o.deeds) ? o.deeds : []).filter(
      (d): d is Deed => !!d && typeof d.id === "string" && typeof d.text === "string" && typeof d.turn === "number"
    );
    return { deeds, next: typeof o.next === "number" ? o.next : deeds.length + 1 };
  } catch {
    return emptyLedger();
  }
}

export function saveLedger(sessionId: string, l: Ledger): void {
  try {
    window.localStorage.setItem(KEY(sessionId), JSON.stringify(l));
  } catch {
    // storage blocked or full — consequences just won't survive a reload
  }
}

export function clearLedger(sessionId: string): void {
  try {
    window.localStorage.removeItem(KEY(sessionId));
  } catch {
    // ignore
  }
}
