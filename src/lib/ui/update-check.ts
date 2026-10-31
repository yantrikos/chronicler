// A browser tab outlives a server update. After `docker compose pull && up`, a tab that was already open keeps running the
// OLD page's code — which is how a fixed bug can look unfixed. The page knows its own version (baked in at build time) and
// asks the server for its version (/api/health); when they differ, the UI says so and offers a reload.

/** True when both versions are known and differ. Unknown versions (dev server, old server) never nag. */
export function isUpdateAvailable(client: string | undefined | null, server: string | undefined | null): boolean {
  if (!client || !server || client === "unknown" || server === "unknown") return false;
  return client !== server;
}

/** The server's version, or null when it cannot be read (offline, older server, dev server). */
export async function fetchServerVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("/api/health", { cache: "no-store", signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { version?: unknown };
    return typeof j.version === "string" ? j.version : null;
  } catch {
    return null;
  }
}
