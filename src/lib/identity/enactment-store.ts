// Browser-local cache of trait restatements (see trait-enactment.ts).
//
// Local only, not synced to the server: a restatement is cheap to regenerate,
// and a device that has none simply shows the plain trait until one is made.

import type { EnactmentCache } from "./trait-enactment";

const KEY = "chronicler.identity.enact.v1";

export function loadEnactments(): EnactmentCache {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: EnactmentCache = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function saveEnactments(cache: EnactmentCache): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable or full — the plain trait is used */
  }
}
