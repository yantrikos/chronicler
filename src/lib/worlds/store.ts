// World registry. Worlds are global lorebook containers that multiple
// characters can opt into via Character.world_ids[]. The lorebook scanner
// pulls namespaces for the character + every world the character belongs to,
// deduped by rid.
//
// Storage: localStorage, parallel to characters + sessions. Each world has
// a stable id, display name, optional description. The entries themselves
// live in YantrikDB under namespace `lorebook:<world_id>` — same shape as
// per-character lorebook entries, just scoped to the world.

export interface World {
  id: string;
  name: string;
  description?: string;
  created_at: string;
}

const K_WORLDS = "chronicler.worlds.v1";

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
    // ignore quota/serialization errors
  }
}

export function listWorlds(): World[] {
  const xs = safeGet<World[]>(K_WORLDS) ?? [];
  return xs.sort((a, b) => a.name.localeCompare(b.name));
}

export function saveWorld(w: World): void {
  const xs = listWorlds();
  const next = xs.filter((x) => x.id !== w.id).concat(w);
  safeSet(K_WORLDS, next);
}

export function deleteWorld(id: string): void {
  const xs = listWorlds().filter((w) => w.id !== id);
  safeSet(K_WORLDS, xs);
}

export function newWorldId(): string {
  return `world-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}
