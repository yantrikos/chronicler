// Character library — the homepage when no chat is active OR when the user
// clicks the logo/home. Shows a grid of imported characters with avatars,
// last-used timestamps, and a turn count across all sessions.

import { useState } from "react";
import { Logo } from "../Brand/Logo";
import type { Character } from "../../lib/orchestrator/types";
import type { SessionMeta } from "../../lib/session/store";

interface Props {
  characters: Character[];
  sessions: SessionMeta[];
  onPickCharacter: (id: string) => void;
  onNewSessionFor: (id: string) => void;
  /** Fires when the user picks a card file from the library's own input. */
  onImportFile: (file: File) => void;
  onDemo: () => void;
  onDeleteCharacter?: (id: string) => void;
  onOpenSettings: () => void;
}

export function CharacterLibrary({
  characters,
  sessions,
  onPickCharacter,
  onNewSessionFor,
  onImportFile,
  onDemo,
  onDeleteCharacter,
  onOpenSettings,
}: Props) {
  const [q, setQ] = useState("");

  // Aggregate per-character session stats.
  const statsByChar = new Map<string, { sessions: number; turns: number; last_at: string }>();
  for (const s of sessions) {
    for (const cid of s.character_ids) {
      const cur = statsByChar.get(cid);
      if (!cur) {
        statsByChar.set(cid, {
          sessions: 1,
          turns: s.turn_count,
          last_at: s.last_at,
        });
      } else {
        cur.sessions += 1;
        cur.turns += s.turn_count;
        if (s.last_at > cur.last_at) cur.last_at = s.last_at;
      }
    }
  }

  const filtered = characters
    .filter((c) =>
      q.trim()
        ? c.name.toLowerCase().includes(q.toLowerCase()) ||
          (c.description ?? "").toLowerCase().includes(q.toLowerCase())
        : true
    )
    .sort((a, b) => {
      const la = statsByChar.get(a.id)?.last_at ?? "0";
      const lb = statsByChar.get(b.id)?.last_at ?? "0";
      return lb.localeCompare(la);
    });

  return (
    <div className="h-full overflow-y-auto bg-neutral-900">
      <header className="sticky top-0 z-10 px-8 py-5 bg-neutral-950/95 backdrop-blur border-b border-neutral-800 flex items-center justify-between">
        <Logo size={28} />
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            placeholder="Search characters…"
            className="w-64 bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1 text-xs text-neutral-200 focus:outline-none focus:border-neutral-600"
          />
          <label className="text-xs cursor-pointer text-white bg-emerald-700/80 hover:bg-emerald-600 rounded px-3 py-1.5 font-medium">
            + import card
            <input
              type="file"
              accept=".png,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) onImportFile(f);
                e.currentTarget.value = ""; // allow picking the same file again
              }}
            />
          </label>
          <button
            className="text-xs rounded border border-neutral-800 hover:border-neutral-700 text-neutral-400 hover:text-neutral-100 px-2.5 py-1"
            onClick={onOpenSettings}
          >
            settings
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-8">
        {characters.length === 0 ? (
          <EmptyShelf
            onImport={() => {
              // fire a hidden file picker for the empty-state CTA
              const inp = document.createElement("input");
              inp.type = "file";
              inp.accept = ".png,.json";
              inp.onchange = () => {
                const f = inp.files?.[0];
                if (f) onImportFile(f);
              };
              inp.click();
            }}
            onDemo={onDemo}
          />
        ) : (
          <>
            <p className="text-xs text-neutral-500 mb-4">
              {filtered.length} of {characters.length} character
              {characters.length === 1 ? "" : "s"} · click a card to open recent sessions
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filtered.map((c) => {
                const stats = statsByChar.get(c.id);
                return (
                  <CharacterCard
                    key={c.id}
                    character={c}
                    stats={stats}
                    onOpen={() => onPickCharacter(c.id)}
                    onNewSession={() => onNewSessionFor(c.id)}
                    onDelete={
                      onDeleteCharacter
                        ? () => onDeleteCharacter(c.id)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function CharacterCard({
  character,
  stats,
  onOpen,
  onNewSession,
  onDelete,
}: {
  character: Character;
  stats?: { sessions: number; turns: number; last_at: string };
  onOpen: () => void;
  onNewSession: () => void;
  onDelete?: () => void;
}) {
  const initials = character.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const paletteIdx =
    Array.from(character.id).reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5;
  const palettes = [
    "from-rose-700 to-rose-900",
    "from-amber-700 to-amber-900",
    "from-teal-700 to-teal-900",
    "from-sky-700 to-sky-900",
    "from-violet-700 to-violet-900",
  ];

  return (
    <article className="group relative rounded-lg border border-neutral-800 bg-neutral-950 overflow-hidden hover:border-neutral-700 transition-colors">
      <button onClick={onOpen} className="block w-full text-left">
        {character.avatar_url ? (
          <img
            src={character.avatar_url}
            alt=""
            className="w-full aspect-square object-cover"
          />
        ) : (
          <div
            className={`w-full aspect-square bg-gradient-to-br ${palettes[paletteIdx]} flex items-center justify-center`}
          >
            <span className="text-4xl font-semibold text-white/90 tracking-tight">
              {initials}
            </span>
          </div>
        )}
        <div className="p-3">
          <h3 className="text-sm font-semibold text-neutral-100 truncate">
            {character.name}
          </h3>
          <p className="text-[11px] text-neutral-500 line-clamp-2 mt-0.5 h-[28px]">
            {character.description ?? "\u00A0"}
          </p>
          <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-600 font-mono">
            <span>
              {stats
                ? `${stats.sessions} session${stats.sessions === 1 ? "" : "s"} · ${stats.turns} turns`
                : "no sessions yet"}
            </span>
            {stats && (
              <span title={stats.last_at}>
                {new Date(stats.last_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </button>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNewSession();
          }}
          className="text-[10px] rounded bg-emerald-700/80 hover:bg-emerald-600 text-white px-2 py-0.5 backdrop-blur"
          title="start a new session with this character"
        >
          + new chat
        </button>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Remove ${character.name} from the library? Sessions are kept.`))
                onDelete();
            }}
            className="text-[10px] rounded bg-neutral-900/80 hover:bg-red-900 text-neutral-300 hover:text-red-100 px-1.5 py-0.5 backdrop-blur"
            title="remove from library"
          >
            ✕
          </button>
        )}
      </div>
    </article>
  );
}

function EmptyShelf({
  onImport,
  onDemo,
}: {
  onImport: () => void;
  onDemo: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-24 text-center">
      <Logo size={48} showWordmark={false} />
      <h2 className="text-xl font-semibold text-neutral-100 mt-5">
        No characters yet
      </h2>
      <p className="text-sm text-neutral-400 mt-2 max-w-sm">
        Import a v2/v3 character card (PNG or JSON) from chub.ai or anywhere
        else. Or start with the demo character to smoke-test the setup.
      </p>
      <div className="mt-6 flex gap-2">
        <button
          onClick={onImport}
          className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm font-medium"
        >
          Import a character
        </button>
        <button
          onClick={onDemo}
          className="rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-4 py-2 text-sm"
        >
          Try demo: Ren
        </button>
      </div>
    </div>
  );
}
