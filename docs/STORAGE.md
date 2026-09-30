# Storage — where your chats live, and how they stay safe

## The problem
Chats, characters and scene state lived only in the browser's localStorage:
capped at roughly 5 MB, per browser, and gone if you clear site data. A long
roleplay could hit the cap, and shared images could not fit at all.

## The design
The browser stays the **working copy** — the app still reads and writes
localStorage synchronously, exactly as before, so none of the app was rewritten.
A sync layer mirrors changes to the Chronicler server, which holds the **durable
copy** on a Docker volume (`chronicler-data`, mounted at `/data/store`).

- `server/storage.mjs` — a key-value store (chats and their state) and a
  content-addressed image store (`attachments/<sha256>.bin`).
- `src/lib/storage/sync-engine.ts` — pure sync logic, tested with fakes.
- `src/lib/storage/sync.ts` — the browser wiring: a hook on `localStorage`, an
  HTTP remote, a debounced/retrying scheduler, and a start-up gate so the app
  renders *after* the first sync (a browser that lost its data boots with the
  server's chats already in place).
- `src/lib/vision/attachments.ts` — image bytes: memory → IndexedDB → server.
- No storage server (Vite dev mode, static hosting)? Everything stands down and
  the app behaves as it always did.

## What syncs, and what never does
Synced: sessions, turns, characters, worlds, scene boards, ledgers, identity
notes, per-character gating and settings, overrides, plugin data.

Never synced: `chronicler.config.v1` (API keys) and `chronicler.mcp.servers.v1`
(auth tokens) — refused by the client allowlist **and** by the server — plus
device preferences (theme, panel state) and the sync bookkeeping itself.

## Guarantees
1. **Sync only copies.** Existing browser data is pushed up; nothing local is
   deleted because the server lacks it. If the server's data is lost, the browser
   copy is put back.
2. **Atomic writes** (temp file + rename). The previous version of every key is
   kept as `.prev`; a deletion is a tombstone whose value survives in `.prev`.
3. **Conflicts lose nothing.** Decided by revision numbers, never clocks. If both
   this browser and the server changed a key, this device's latest edit wins and
   the server stashes what it replaced under `conflicts/`. With no shared history
   (a second device with different data) the server's copy is kept and the local
   one is stashed on the server.
4. **A failed local write is still durable.** If the browser is full, the value
   is pushed to the server anyway; cold chats the server already has are dropped
   from the browser cache to make room (never the open chat, never one with an
   unsynced edit) and are fetched back when opened. Full backups fetch them back
   first.
5. **Bounded and safe.** Per-value, per-image and whole-store size caps; keys and
   hashes are validated (nothing user-supplied becomes a path); image type comes
   from magic bytes, not the client; the hash must match the bytes; requests
   carrying a foreign `Origin` are refused so another website can't read or write
   your chats.
6. **A deliberate wipe propagates.** "Reset local settings" removes chats on the
   server too (otherwise the next reload would bring them back); the server keeps
   a recoverable copy of each removed item.

## How it was verified
- `tests/server-store.test.ts` (40 checks) runs an isolated server on a random
  port with a temp data directory: revisions, conflicts, tombstones, validation,
  cross-origin refusal, restart persistence, image rules.
- `tests/sync-engine.test.ts` (~35 checks): first sync, a new device, edits,
  offline, restart with pending changes, edits made while sync wasn't running,
  both sides changed, deletion, the server losing its data, a full browser.
- An isolated two-browser end-to-end run (separate server on port 3055): browser
  A plays and attaches an image; a **brand-new profile with no local data** opens
  the app and sees the whole conversation and the image; a real Chrome quota error
  is handled with nothing lost; an evicted chat is fetched back on demand.

**That end-to-end run caught a data-destroying bug in the first version** — an
`await` inserted between `setSessionId()` and `setTurns()` in `switchSession()`
let the turns-saving effect run with the new session id and the *old* turns,
overwriting a real chat with `[]`. It was fixed (hydrate before any state change)
and is now the regression test. See the note in the project memory.

## Limits
- Single user. There is no login; the server is bound to localhost by default,
  like the rest of the app. Do not expose it beyond your machine without a proxy
  that adds authentication.
- Conflicts between two devices editing the same chat at once resolve to "the
  last device to sync wins" — with the other side stashed, not merged.
- The API-key config and personas (which live inside it) are not synced, so a
  fresh browser needs its providers set up again.
- Cross-chat search only sees chats cached in the browser.
- The first write after the browser fills can still throw if every cold chat has
  an unsynced edit; the value is on the server and returns on reload.
