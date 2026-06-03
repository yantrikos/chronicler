// Character library — the homepage when no chat is active OR when the user
// clicks the logo/home. Shows a grid of imported characters with avatars,
// last-used timestamps, and a turn count across all sessions.

import { useState } from "react";
import { Logo } from "../Brand/Logo";
import type { Character } from "../../lib/orchestrator/types";
import type { SessionMeta } from "../../lib/session/store";
import type { World } from "../../lib/worlds/store";
import { DEMOS, DEMO_ORDER, type DemoKey } from "../../lib/cards/demos";

interface Props {
  characters: Character[];
  sessions: SessionMeta[];
  worlds: World[];
  onPickCharacter: (id: string) => void;
  onNewSessionFor: (id: string) => void;
  /** Fires when the user picks a card file from the library's own input. */
  onImportFile: (file: File) => void;
  onDemo: (key: DemoKey) => void;
  onStartStory?: () => void;
  onDeleteCharacter?: (id: string) => void;
  onEditCharacter?: (id: string) => void;
  onOpenSettings: () => void;
  onCreateWorld?: () => void;
  onEditWorld?: (id: string) => void;
  onEditWorldLorebook?: (id: string) => void;
  onDeleteWorld?: (id: string) => void;
}

export function CharacterLibrary({
  characters,
  sessions,
  worlds,
  onPickCharacter,
  onNewSessionFor,
  onImportFile,
  onDemo,
  onStartStory,
  onDeleteCharacter,
  onEditCharacter,
  onOpenSettings,
  onCreateWorld,
  onEditWorld,
  onEditWorldLorebook,
  onDeleteWorld,
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
          {onStartStory && (
            <button
              onClick={onStartStory}
              className="text-xs rounded border border-neutral-700 hover:border-neutral-600 text-neutral-300 hover:text-neutral-100 px-3 py-1.5"
              title="Start a freeform narrative session — narrator + memory, no fixed character"
            >
              + new story
            </button>
          )}
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
        {(worlds.length > 0 || onCreateWorld) && characters.length > 0 && (
          <WorldsSection
            worlds={worlds}
            characters={characters}
            onCreate={onCreateWorld}
            onEdit={onEditWorld}
            onEditLorebook={onEditWorldLorebook}
            onDelete={onDeleteWorld}
          />
        )}
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
                    onEdit={
                      onEditCharacter ? () => onEditCharacter(c.id) : undefined
                    }
                  />
                );
              })}
            </div>
            <DemosSection
              characters={characters}
              onPick={(k) => onDemo(k as DemoKey)}
            />
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
  onEdit,
}: {
  character: Character;
  stats?: { sessions: number; turns: number; last_at: string };
  onOpen: () => void;
  onNewSession: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
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
          <h3 className="text-sm font-semibold text-neutral-100 truncate flex items-center gap-1.5">
            {character.name}
            {(character.tags ?? []).includes("story") && (
              <span
                className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-violet-700/60 text-violet-300"
                title="Freeform story session \u2014 narrator-style"
              >
                story
              </span>
            )}
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
        {onEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="text-[10px] rounded bg-neutral-900/80 hover:bg-neutral-700 text-neutral-200 px-1.5 py-0.5 backdrop-blur"
            title="edit character"
          >
            ✎
          </button>
        )}
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

// Worlds list — shared lorebooks that multiple characters can opt into.
// Lives above the character grid in the Library since worlds are the
// "where" that characters belong to.
function WorldsSection({
  worlds,
  characters,
  onCreate,
  onEdit,
  onEditLorebook,
  onDelete,
}: {
  worlds: World[];
  characters: Character[];
  onCreate?: () => void;
  onEdit?: (id: string) => void;
  onEditLorebook?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const memberCount = (worldId: string) =>
    characters.filter((c) => (c.world_ids ?? []).includes(worldId)).length;

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-200">Worlds</h2>
          <p className="text-[11px] text-neutral-500">
            Shared lorebooks. Characters opt in; entries are unioned with
            their private lorebook at scan time.
          </p>
        </div>
        {onCreate && (
          <button
            onClick={onCreate}
            className="text-[11px] rounded border border-neutral-700 hover:border-neutral-600 text-neutral-300 hover:text-neutral-100 px-2.5 py-1"
          >
            + new world
          </button>
        )}
      </div>
      {worlds.length === 0 ? (
        <p className="text-[11px] text-neutral-600 italic">
          No worlds yet. Create one to share lorebook entries across multiple
          characters.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          {worlds.map((w) => (
            <article
              key={w.id}
              className="rounded-md border border-neutral-800 bg-neutral-950 p-3 group"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-neutral-100 truncate">
                  {w.name}
                </h3>
                <span className="text-[10px] text-neutral-500 font-mono shrink-0">
                  {memberCount(w.id)} char
                  {memberCount(w.id) === 1 ? "" : "s"}
                </span>
              </div>
              {w.description && (
                <p className="text-[11px] text-neutral-500 leading-snug mt-1 line-clamp-2">
                  {w.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {onEditLorebook && (
                  <button
                    onClick={() => onEditLorebook(w.id)}
                    className="text-[11px] rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 px-2 py-0.5"
                    title="Edit shared lorebook entries"
                  >
                    lorebook
                  </button>
                )}
                {onEdit && (
                  <button
                    onClick={() => onEdit(w.id)}
                    className="text-[11px] rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-2 py-0.5"
                  >
                    rename
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          `Delete world "${w.name}"? Characters stay; their world assignment is removed.`
                        )
                      )
                        onDelete(w.id);
                    }}
                    className="text-[11px] rounded bg-neutral-800 hover:bg-red-900 text-neutral-400 hover:text-red-200 px-2 py-0.5 ml-auto"
                  >
                    delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

// "Try another demo" section under the character grid. Lets existing
// users access the demo characters they DON'T already have without
// having to delete everything first. Filters out demos that are
// already in the library (no point re-loading what's already there).
function DemosSection({
  characters,
  onPick,
}: {
  characters: Character[];
  onPick: (key: DemoKey) => void;
}) {
  // Demo character ids embed shortHash(rawCardJson); to detect "is this
  // demo already in the library?" we check name-prefix matches since
  // the demos are short enough that names are unique among them.
  const have = new Set(
    characters.map((c) => c.name.toLowerCase())
  );
  const available = DEMO_ORDER.filter((k) => k !== "mei").filter(
    (k) => !have.has(DEMOS[k].label.toLowerCase())
  );
  if (available.length === 0) return null;
  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-200">
            Try another demo
          </h2>
          <p className="text-[11px] text-neutral-500">
            One per major roleplay style. Each is a real persistent character
            — your sessions with them stick.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {available.map((k) => {
          const d = DEMOS[k];
          return (
            <button
              key={k}
              onClick={() => onPick(k)}
              className="text-left rounded-md border border-neutral-800 bg-neutral-950 hover:border-neutral-700 hover:bg-neutral-900 transition-colors p-3"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${categoryDot[d.category] ?? "bg-neutral-500"}`}
                  aria-hidden
                />
                <span className="text-sm font-semibold text-neutral-100">
                  {d.label}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-neutral-600 font-mono ml-auto">
                  {d.recommended_preset.replace("_", " ")}
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 leading-snug">
                {d.subtitle}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const categoryDot: Record<string, string> = {
  romance: "bg-rose-500",
  companion: "bg-emerald-500",
  fiction: "bg-violet-500",
  ttrpg: "bg-amber-500",
  fandom_ip: "bg-sky-500",
  practice: "bg-teal-500",
};

function EmptyShelf({
  onImport,
  onDemo,
}: {
  onImport: () => void;
  onDemo: (key: DemoKey) => void;
}) {
  return (
    <div className="py-16">
      <div className="flex flex-col items-center text-center">
        <Logo size={48} showWordmark={false} />
        <h2 className="text-xl font-semibold text-neutral-100 mt-5">
          No characters yet
        </h2>
        <p className="text-sm text-neutral-400 mt-2 max-w-sm">
          Import a v2/v3 card (PNG or JSON) from chub.ai or anywhere, or pick
          a demo below to smoke-test the loop.
        </p>
        <div className="mt-5">
          <button
            onClick={onImport}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm font-medium"
          >
            Import a character
          </button>
        </div>
      </div>

      <div className="mt-10 max-w-3xl mx-auto">
        <p className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold mb-3 text-center">
          Demo characters — one per major roleplay style
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {DEMO_ORDER.filter((k) => k !== "mei").map((k) => {
            const d = DEMOS[k];
            return (
              <button
                key={k}
                onClick={() => onDemo(k)}
                className="text-left rounded-md border border-neutral-800 bg-neutral-950 hover:border-neutral-700 hover:bg-neutral-900 transition-colors p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${categoryDot[d.category] ?? "bg-neutral-500"}`}
                    aria-hidden
                  />
                  <span className="text-sm font-semibold text-neutral-100">
                    {d.label}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-neutral-600 font-mono ml-auto">
                    {d.recommended_preset.replace("_", " ")}
                  </span>
                </div>
                <p className="text-[11px] text-neutral-500 leading-snug">
                  {d.subtitle}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
